'use strict';
// Inicio del usuario (siguiente paso), cuenta, compras, privacidad y avisos.
const express = require('express');
const db = require('../db');
const { html } = require('../lib/html');
const money = require('../lib/money');
const qs = require('../domain/questionnaire');
const engine = require('../domain/free/engine');
const entitlements = require('../domain/entitlements');
const planDomain = require('../domain/plan');
const tasks = require('../domain/tasks');
const deep = require('../domain/deep');
const c = require('../views/components');
const { audit } = require('../lib/services');
const { requireUser } = require('./guards');
const gv = require('../views/game');

const router = express.Router();

function journey(user) {
  const o = { userId: user.id };
  const freeDone = engine.findLatestResultSession(o);
  const freeOpen = engine.findOwned(o, 'en_curso');
  const ents = entitlements.active(user.id);
  const diag = deep.latestDiagnosis(user.id);
  const deepOpen = qs.findEvaluation('profundo', o, 'en_curso');
  const plan = planDomain.current(user.id);
  const pend = planDomain.pending(user.id);
  const steps = [
    {
      title: 'Test gratuito',
      sub: freeDone ? `Terminado el ${c.dateEs(freeDone.completed_at)}` : freeOpen ? 'En curso' : 'Sin empezar',
      state: freeDone ? 'done' : 'current',
      href: freeDone ? '/resultado' : '/test',
      go: freeDone ? 'Ver resultado' : freeOpen ? 'Continuar' : 'Empezar',
    },
    {
      title: 'Evaluación profunda',
      sub: diag ? `Diagnóstico del ${c.dateEs(diag.created_at)}` : deepOpen ? 'En curso' : ents.evaluacion_profunda ? 'Incluida en tu compra' : 'De pago',
      state: diag ? 'done' : freeDone ? 'current' : '',
      href: diag ? '/diagnostico' : ents.evaluacion_profunda ? '/evaluacion' : '/comprar/evaluacion',
      go: diag ? 'Ver diagnóstico' : ents.evaluacion_profunda ? (deepOpen ? 'Continuar' : 'Empezar') : 'Ver precio',
    },
    {
      title: 'Plan Maestro',
      sub: plan ? `Versión ${plan.version_number} vigente` : pend && pend.status !== 'fallido' ? 'Generando' : ents.plan_maestro ? 'Incluido en tu compra' : 'De pago',
      state: plan ? 'done' : diag ? 'current' : '',
      href: ents.plan_maestro ? '/plan' : '/comprar/plan_maestro',
      go: plan ? 'Abrir' : ents.plan_maestro ? 'Crear' : 'Ver precio',
    },
    {
      title: 'Coach y calculadora',
      sub: ents.acompanamiento ? 'Activo' : 'De pago',
      state: ents.acompanamiento && plan ? 'done' : plan ? 'current' : '',
      href: ents.acompanamiento ? '/coach' : '/comprar/acompanamiento',
      go: ents.acompanamiento ? 'Abrir' : 'Ver precio',
    },
  ];
  let next;
  if (!freeDone) next = { kicker: 'Siguiente paso', title: freeOpen ? 'Termina tu test gratuito' : 'Haz tu test gratuito', text: 'Veinticinco preguntas para conocer tus fortalezas, riesgos y prioridades.', href: '/test', cta: freeOpen ? 'Continuar el test' : 'Empezar el test' };
  else if (!diag && !ents.evaluacion_profunda) next = { kicker: 'Siguiente paso', title: 'Conoce tu situación con cifras exactas', text: 'La evaluación profunda revisa tus ingresos, gastos, deudas, tasas y metas, y te entrega un diagnóstico detallado.', href: '/comprar/evaluacion', cta: 'Ver la evaluación profunda' };
  else if (!diag) next = { kicker: 'Siguiente paso', title: deepOpen ? 'Termina tu evaluación profunda' : 'Empieza tu evaluación profunda', text: 'Ten a mano tus estados de cuenta: te pediremos saldos, cuotas y tasas.', href: '/evaluacion', cta: deepOpen ? 'Continuar' : 'Empezar' };
  else if (!ents.plan_maestro) next = { kicker: 'Siguiente paso', title: 'Convierte tu diagnóstico en un plan', text: 'El Plan Maestro ordena tus próximos 90 días y traza tu hoja de ruta de 12 meses.', href: '/comprar/plan_maestro', cta: 'Ver el Plan Maestro' };
  else if (!plan) next = { kicker: 'Siguiente paso', title: pend && pend.status !== 'fallido' ? 'Tu plan se está preparando' : 'Elige tu Día Uno y genera tu plan', text: 'El Plan Maestro está incluido en lo que adquiriste.', href: '/plan', cta: 'Ir a mi plan' };
  return { steps, next, plan, ents };
}

router.get('/inicio', requireUser, (req, res) => {
  const u = req.user;
  const j = journey(u);
  const t = j.plan ? tasks.next(u.id) : null;
  const content = j.plan ? JSON.parse(j.plan.content_json) : null;
  const day = content ? planDomain.dayNumber(content.startDate) : null;
  const ctx = res.locals.ctx;
  res.active('inicio').page({
    title: 'Inicio',
    body: html`<h1>${u.name ? `Hola, ${u.name}` : 'Hola'}</h1>
      ${ctx.game ? gv.playerCard(u, ctx.game) : ''}
      ${!u.email_verified_at
        ? html`<div class="note small label-line"><span>Confirma tu correo con el enlace que te enviamos a ${u.email}.</span><form class="inline-form" method="post" action="/verificar/reenviar">${c.csrfField(ctx)}<button class="btn btn-quiet btn-small" type="submit">Reenviar enlace</button></form></div>`
        : ''}
      ${content
        ? html`<div class="day">
            ${day >= 1
              ? html`<p class="day-number">Día ${day}<span>de 90</span></p><p class="day-caption">Empezaste el ${c.dateEs(content.startDate)}.</p>`
              : html`<p class="day-number">${1 - day}<span>${1 - day === 1 ? 'día' : 'días'}</span></p><p class="day-caption">para tu Día Uno, el ${c.dateEs(content.startDate)}.</p>`}
            ${c.ticks(Array.from({ length: 90 }, (_, i) => (i + 1 < day ? 'done' : i + 1 === day ? 'now' : '')), { days: true })}
          </div>`
        : ''}
      ${t
        ? html`<section class="next-step" aria-labelledby="h-next">
            <p class="kicker">Tu siguiente paso${t.due_date ? `, ${t.due_date <= planDomain.today() ? 'para hoy' : `para el ${c.dateEs(t.postponed_until || t.due_date)}`}` : ''}</p>
            <h2 id="h-next">${t.title} ${gv.xpTag(40)}</h2>
            ${t.reason ? html`<p class="muted">${t.reason}</p>` : ''}
            ${t.done_criteria ? html`<p class="small"><strong>Terminada cuando:</strong> ${t.done_criteria}</p>` : ''}
            <div class="actions">
              <form class="inline-form" method="post" action="/tareas/${t.id}/completar">${c.csrfField(ctx)}<input type="hidden" name="volver" value="/inicio" /><button class="btn btn-primary" type="submit">Marcar como hecha</button></form>
              <a class="btn btn-quiet" href="/tablero">Ver todas las tareas</a>
            </div>
          </section>`
        : j.next
          ? html`<section class="next-step" aria-labelledby="h-next">
              <p class="kicker">${j.next.kicker}</p>
              <h2 id="h-next">${j.next.title}</h2>
              <p class="muted">${j.next.text}</p>
              <div class="actions"><a class="btn btn-primary" href="${j.next.href}">${j.next.cta}</a></div>
            </section>`
          : html`<section class="next-step"><p class="kicker">Al día</p><h2>No tienes tareas pendientes</h2><p class="muted">Revisa tu tablero o conversa con el coach para decidir tu próxima acción.</p><div class="actions"><a class="btn btn-secondary" href="/tablero">Abrir el tablero</a></div></section>`}

      <section class="section" aria-labelledby="h-rec">
        <h2 id="h-rec">Tu recorrido</h2>
        ${gv.worldMap(
          j.steps.map((s) => s.state),
          j.steps.map((s) => [s.href, s.go])
        )}
        <p class="small muted center">${j.steps.map((s) => `${s.title}: ${s.sub}`).join('. ')}.</p>
      </section>
      ${ctx.game
        ? html`<section class="section" aria-labelledby="h-logros">
            <div class="label-line"><h2 id="h-logros">Tus logros</h2><a class="small" href="/logros">Ver todos</a></div>
            ${gv.achievementGrid([...ctx.game.achievements.filter((a) => a.unlocked), ...ctx.game.achievements.filter((a) => !a.unlocked)].slice(0, 6))}
          </section>`
        : ''}`,
  });
});

router.get('/cuenta', requireUser, (req, res) => {
  const u = db.one('SELECT * FROM users WHERE id = ?', req.user.id);
  const orders = db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', u.id);
  const ents = entitlements.list(u.id);
  const requests = db.all('SELECT * FROM privacy_requests WHERE user_id = ? ORDER BY created_at DESC', u.id);
  const ctx = res.locals.ctx;
  const now = db.now();
  res.active('cuenta').page({
    title: 'Tu cuenta',
    body: html`<h1>Tu cuenta</h1>
      <ul class="figures">
        <li><span class="k">Correo</span><span class="v">${u.email}</span></li>
        <li><span class="k">Correo verificado</span><span class="v">${u.email_verified_at ? 'Sí' : html`No. <form class="inline-form" method="post" action="/verificar/reenviar">${c.csrfField(ctx)}<button class="btn btn-quiet btn-small" type="submit">Reenviar enlace</button></form>`}</span></li>
        <li><span class="k">Moneda de la cuenta</span><span class="v">${u.base_currency ? money.CURRENCIES[u.base_currency]?.label || u.base_currency : 'Se define en tu test'}</span></li>
        <li><span class="k">Cuenta creada</span><span class="v">${c.dateEs(u.created_at)}</span></li>
      </ul>

      <section class="section" aria-labelledby="h-accesos">
        <h2 id="h-accesos">Accesos</h2>
        ${ents.length
          ? html`<table class="data stack-sm"><thead><tr><th>Acceso</th><th>Origen</th><th>Vence</th><th>Estado</th></tr></thead><tbody>
              ${ents.map((e) => {
                const active = !e.revoked_at && (!e.expires_at || e.expires_at > now);
                return html`<tr><td data-label="Acceso">${c.GRANT_LABELS[e.code]}</td><td data-label="Origen">${e.source === 'compra' ? 'Compra' : 'Activación manual'}</td><td data-label="Vence">${e.expires_at ? c.dateEs(e.expires_at) : 'Sin vencimiento'}</td><td data-label="Estado">${active ? c.badge('Activo', 'ok') : e.revoked_at ? c.badge('Retirado') : c.badge('Vencido')}</td></tr>`;
              })}
            </tbody></table>`
          : html`<p class="muted">Aún no tienes accesos de pago. El test gratuito y su resultado siempre están disponibles.</p>`}
      </section>

      <section class="section" aria-labelledby="h-compras">
        <h2 id="h-compras">Compras</h2>
        ${orders.length
          ? html`<table class="data stack-sm"><thead><tr><th>Producto</th><th class="r">Importe</th><th>Fecha</th><th>Estado</th></tr></thead><tbody>
              ${orders.map((o) => html`<tr><td data-label="Producto">${o.product_name}<br /><span class="small faint">${o.ref}</span></td><td data-label="Importe" class="r">${money.formatCents(o.amount_cents, o.currency)} ${o.currency}</td><td data-label="Fecha">${c.dateEs(o.created_at)}</td><td data-label="Estado">${c.badge(...c.ORDER_STATUS[o.status])}</td></tr>`)}
            </tbody></table>`
          : html`<p class="muted">No tienes compras.</p>`}
      </section>

      <section class="section" aria-labelledby="h-priv">
        <h2 id="h-priv">Privacidad</h2>
        <p class="muted">Puedes pedir una copia de todos tus datos o la eliminación de tu cuenta. El equipo de Día Uno atenderá la solicitud y te avisará por correo.</p>
        ${requests.length ? html`<ul class="small">${requests.map((r) => html`<li>${r.kind === 'exportar' ? 'Copia de datos' : 'Eliminación de cuenta'} solicitada el ${c.dateEs(r.created_at)}: ${{ pendiente: 'pendiente', completada: 'completada', rechazada: 'rechazada' }[r.status]}</li>`)}</ul>` : ''}
        <div class="actions">
          <form class="inline-form" method="post" action="/cuenta/privacidad">${c.csrfField(ctx)}<input type="hidden" name="kind" value="exportar" /><button class="btn btn-secondary" type="submit">Pedir una copia de mis datos</button></form>
          <form class="inline-form" method="post" action="/cuenta/privacidad" data-confirm="¿Seguro que quieres pedir la eliminación de tu cuenta? Se borrarán tus respuestas, planes y conversaciones.">${c.csrfField(ctx)}<input type="hidden" name="kind" value="eliminar" /><button class="btn btn-danger" type="submit">Pedir la eliminación de mi cuenta</button></form>
        </div>
      </section>`,
  });
});

router.post('/cuenta/privacidad', requireUser, (req, res) => {
  const kind = req.body.kind === 'eliminar' ? 'eliminar' : 'exportar';
  const open = db.one("SELECT id FROM privacy_requests WHERE user_id = ? AND kind = ? AND status = 'pendiente'", req.user.id, kind);
  if (!open) {
    const r = db.run("INSERT INTO privacy_requests (user_id, user_email, kind, status, created_at) VALUES (?, ?, ?, 'pendiente', ?)", req.user.id, req.user.email, kind, db.now());
    audit(req.user.id, `privacidad.solicitud_${kind}`, { targetType: 'solicitud', targetId: r.lastId });
  }
  res.redirect(303, '/cuenta?aviso=solicitud_enviada');
});

router.get('/avisos', requireUser, (req, res) => {
  const list = db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', req.user.id);
  db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', db.now(), req.user.id);
  res.locals.ctx.unread = 0;
  res.active('avisos').page({
    title: 'Avisos',
    body: html`<h1>Avisos</h1>
      ${list.length
        ? html`<ul class="review">${list.map(
            (n) => html`<li><span class="n">${n.read_at ? '' : html`<span class="badge badge--ok">Nuevo</span>`}</span><span class="q">${n.link ? html`<a href="${n.link}">${n.title}</a>` : n.title}</span><span class="a">${n.body || ''} <span class="faint">${c.dateEs(n.created_at, { time: true })}</span></span><span></span></li>`
          )}</ul>`
        : html`<div class="empty"><h3>Sin avisos</h3><p>Aquí verás recordatorios de tareas y metas, y confirmaciones de pago.</p></div>`}`,
  });
});

router.get('/logros', requireUser, (req, res) => {
  const g = res.locals.ctx.game || require('../domain/game').profile(req.user.id);
  const game = require('../domain/game');
  res.active('logros').page({
    title: 'Logros',
    body: html`<h1>Logros y nivel</h1>
      ${gv.playerCard(req.user, g)}
      <section class="section" aria-labelledby="h-ach">
        <h2 id="h-ach">Logros (${g.unlockedCount} de ${g.achievements.length})</h2>
        ${gv.achievementGrid(g.achievements)}
      </section>
      <div class="cols section">
        <section class="panel" aria-labelledby="h-xp">
          <div class="panel-head"><h2 id="h-xp">De dónde sale tu XP</h2></div>
          <ul class="figures">${g.breakdown.map(([k, n]) => html`<li><span class="k">${k}</span><span class="v num">+${n.toLocaleString('es')} XP</span></li>`)}</ul>
        </section>
        <section class="panel" aria-labelledby="h-niv">
          <div class="panel-head"><h2 id="h-niv">Niveles</h2></div>
          <ul class="figures">${game.LEVELS.map(([xp, name], i) => html`<li class="${i + 1 === g.level ? 'total' : ''}"><span class="k">${i + 1}. ${name}${i + 1 === g.level ? ' (tú)' : ''}</span><span class="v num">${xp.toLocaleString('es')} XP</span></li>`)}</ul>
        </section>
      </div>
      <section class="panel section" aria-labelledby="h-gana">
        <div class="panel-head"><h2 id="h-gana">Cómo ganar XP</h2></div>
        <ul class="figures">
          <li><span class="k">Completar una misión del plan</span><span class="v">+${game.XP.tarea} XP</span></li>
          <li><span class="k">Terminar la evaluación profunda</span><span class="v">+${game.XP.evaluacion} XP</span></li>
          <li><span class="k">Generar tu Plan Maestro</span><span class="v">+${game.XP.plan} XP</span></li>
          <li><span class="k">Armar el presupuesto del mes</span><span class="v">+${game.XP.presupuesto} XP</span></li>
          <li><span class="k">Alcanzar una meta</span><span class="v">+${game.XP.metaAlcanzada} XP</span></li>
          <li><span class="k">Marcar un hito del año</span><span class="v">+${game.XP.hito} XP</span></li>
          <li><span class="k">Actualizar el saldo de una deuda</span><span class="v">+${game.XP.saldoDeuda} XP</span></li>
          <li><span class="k">Registrar un movimiento</span><span class="v">+${game.XP.movimiento} XP</span></li>
        </ul>
        <p class="small faint">El XP premia tu constancia, no cuánto dinero tienes. No es una calificación financiera.</p>
      </section>`,
  });
});

module.exports = router;
module.exports.journey = journey;
