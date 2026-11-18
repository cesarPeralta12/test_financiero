'use strict';
// F09 Coach de IA (requiere el acceso de acompañamiento).
const express = require('express');
const { html, prose } = require('../lib/html');
const money = require('../lib/money');
const coach = require('../domain/coach');
const ai = require('../domain/ai/provider');
const tracker = require('../domain/tracker');
const c = require('../views/components');
const { requireEntitlement } = require('./guards');
const { intParam, notFound, wrap } = require('./util');
const { rateLimit } = require('../lib/security');
const db = require('../db');
const { getSetting } = require('../lib/services');
const { CoachError } = require('../domain/coach/respuesta');
const { responderConIA } = require('../domain/coach/respuestaIA');
const { sugerencias } = require('../domain/coach/sugerencias');
const v2view = require('../views/coachV2');

const v2 = (user) => require('../domain/coach/rollout').activoPara(user && user.id);

const router = express.Router();
const guard = requireEntitlement('acompanamiento');

function simTable(sim) {
  const cur = sim.currency;
  const f = (v) => (v === null || v === undefined ? '—' : money.format(v, cur));
  const m = (v) => (v ? c.monthsText(v) : 'No se alcanza');
  return html`<table class="data compare small">
    <thead><tr><th></th><th>Actual</th><th>Escenario</th></tr></thead>
    <tbody>
      <tr><td>Saldo libre del mes</td><td class="num">${f(sim.base.free)}</td><td class="num">${f(sim.scenario.free)}</td></tr>
      <tr><td>Ahorro del mes</td><td class="num">${f(sim.base.saving)}</td><td class="num">${f(sim.scenario.saving)}</td></tr>
      ${sim.base.debtMonths !== null || sim.scenario.debtMonths !== null || sim.base.debtUnresolved.length
        ? html`<tr><td>Sin deudas en</td><td>${m(sim.base.debtMonths)}</td><td>${m(sim.scenario.debtMonths)}</td></tr>
            <tr><td>Intereses totales</td><td class="num">${f(sim.base.debtInterest)}</td><td class="num">${f(sim.scenario.debtInterest)}</td></tr>`
        : ''}
    </tbody>
  </table>`;
}

function messageView(ctx, m, cur) {
  const data = m.data_json ? JSON.parse(m.data_json) : null;
  const proposal = m.proposal_json ? JSON.parse(m.proposal_json) : null;
  if (m.role === 'usuario') return html`<div class="msg msg--usuario" role="listitem"><span class="visually-hidden">Tú: </span>${m.content}</div>`;
  if (m.role === 'sistema') return html`<div class="msg msg--sistema" role="listitem"><div class="bubble">${m.content}</div></div>`;
  const d = proposal ? coach.describeProposal(proposal, cur) : null;
  return html`<div class="msg msg--coach" role="listitem">
    <p class="who">Coach de IA</p>
    <div class="bubble">
      ${m.kind === 'hipotetico' ? html`<span class="msg-tag">Consulta hipotética: no cambia tus datos</span>` : ''}
      ${prose(m.content)}
      ${data && data.simulation ? simTable(data.simulation) : ''}
      ${d
        ? html`<div class="proposal">
            <h4>Propuesta: ${d.title}</h4>
            <p>${d.text}</p>
            ${m.proposal_status === 'pendiente'
              ? html`<div class="actions">
                  <form class="inline-form" method="post" action="/coach/propuesta/${m.id}/confirmar">${c.csrfField(ctx)}<button class="btn btn-primary btn-small" type="submit">Confirmar</button></form>
                  <form class="inline-form" method="post" action="/coach/propuesta/${m.id}/descartar">${c.csrfField(ctx)}<button class="btn btn-secondary btn-small" type="submit">Descartar</button></form>
                </div>`
              : html`<p class="small faint">${m.proposal_status === 'confirmada' ? 'Confirmada.' : 'Descartada. No se guardó.'}</p>`}
          </div>`
        : ''}
    </div>
  </div>`;
}

// ───────── Coach v2: conversación de tarjetas (bandera coach_v2_enabled) ─────────
function paginaV2(req, res) {
  const conv = coach.conversation(req.user.id);
  const filas = db.all('SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY id DESC LIMIT 40) ORDER BY id', conv.id, req.user.id).map((f) => ({ ...f, payload: db.parse(f.payload_json, {}) || {} }));
  const vacia = !filas.some((f) => f.origin);
  res.active('coach').page({
    title: 'Coach',
    body: v2view.pagina(res.locals.ctx, { filas, cur: tracker.baseCurrency(req.user.id), vacia, sugerencias: sugerencias(req.user.id) }),
  });
}

/** Un mensaje o un botón: con `X-Fragment: 1` devuelve la tarjeta para agregarla sin recargar; sin JavaScript, redirige. */
router.post('/coach/enviar', guard, wrap(async (req, res, next) => {
  if (!v2(req.user)) return next(notFound());
  const fragmento = req.get('x-fragment') === '1';
  const b = req.body || {};
  const cur = tracker.baseCurrency(req.user.id);
  const mostrar = String(b.texto || b.etiqueta || '').slice(0, 80);
  const enviar = (extra) => res.type('html').send(v2view.fragmento(res.locals.ctx, { texto: mostrar, sugerencias: sugerencias(req.user.id), cur, ...extra }).toString());
  const rl = rateLimit({ key: `coachv2web:${req.user.id}`, limit: 20, windowMs: 60_000 });
  if (!rl.allowed) return fragmento ? res.status(429).type('html').send(v2view.fragmento(res.locals.ctx, { error: 'Vas muy rápido. Espera un momento y vuelve a intentarlo.', sugerencias: sugerencias(req.user.id), cur }).toString()) : res.redirect(303, '/coach?aviso=coach_error#cv-fin');
  try {
    const out = await responderConIA(req.user.id, { texto: b.texto, accion: b.accion, mensaje_id: b.mensaje_id, campo: b.campo, valor: b.valor, intencion: b.intencion });
    if (!fragmento) return res.redirect(303, '/coach#cv-fin');
    return enviar({ respuesta: out });
  } catch (e) {
    if (!(e instanceof CoachError)) throw e;
    if (!fragmento) return res.redirect(303, '/coach?aviso=coach_error#cv-fin');
    return res.status(e.status === 409 ? 200 : e.status).type('html').send(v2view.fragmento(res.locals.ctx, { texto: mostrar, error: e.message, sugerencias: sugerencias(req.user.id), cur }).toString());
  }
}));

router.get('/coach', guard, (req, res, next) => (v2(req.user) ? paginaV2(req, res) : next()));

router.get('/coach', guard, (req, res) => {
  const conv = coach.conversation(req.user.id);
  const list = coach.messages(conv.id, req.user.id);
  const cur = tracker.baseCurrency(req.user.id);
  const u = ai.usage(req.user.id, 'coach');
  const ctx = res.locals.ctx;
  res.active('coach').page({
    title: 'Coach',
    body: html`<div class="label-line"><h1>Coach</h1><span class="status-pill">Asistente de IA</span></div>
      <p class="muted small">Responde con tus cifras calculadas por Día Uno. Puede equivocarse y no sustituye a un profesional. No guarda cambios sin tu confirmación.</p>
      <div class="chat" role="list" aria-label="Conversación" id="chat">
        ${list.map((m) => messageView(ctx, m, cur))}
      </div>
      <div class="composer">
        <div class="suggestions" aria-label="Sugerencias">
          ${['¿Cuál es mi siguiente paso?', '¿Qué pasa si pago 500 más a mi deuda?', 'Explícame mi saldo disponible', 'Ya terminé mi tarea'].map(
            (s) => html`<button type="button" data-suggest="${s}">${s}</button>`
          )}
        </div>
        <form method="post" action="/coach/mensajes" data-chat>
          ${c.csrfField(ctx)}
          <label class="visually-hidden" for="f-msg">Mensaje para el coach</label>
          <textarea class="input" id="f-msg" name="mensaje" rows="1" maxlength="2000" placeholder="Escribe tu pregunta" required></textarea>
          <button class="btn btn-primary" type="submit">Enviar</button>
        </form>
        <p class="small faint">Has usado ${u.used} de ${u.limit} respuestas del coach este mes.</p>
      </div>`,
  });
});

router.post('/coach/mensajes', guard, wrap(async (req, res) => {
  const rl = rateLimit({ key: `coach:${req.user.id}`, limit: 12, windowMs: 60_000 });
  if (rl.allowed) await coach.send(req.user.id, req.body.mensaje);
  res.redirect(303, '/coach#f-msg');
}));

router.post('/coach/propuesta/:id/confirmar', guard, (req, res, next) => {
  const id = intParam(req.params.id);
  if (!id || coach.confirm(req.user.id, id) === null) return next(notFound());
  res.redirect(303, '/coach#chat');
});

router.post('/coach/propuesta/:id/descartar', guard, (req, res, next) => {
  const id = intParam(req.params.id);
  if (!id || !coach.discard(req.user.id, id)) return next(notFound());
  res.redirect(303, '/coach#chat');
});

module.exports = router;
