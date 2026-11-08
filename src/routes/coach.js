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
