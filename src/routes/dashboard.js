'use strict';
// F11 Tablero de progreso: saldo mensual, ahorro acumulado, evolución de deuda,
// metas, tareas (completar, posponer, reabrir) e hitos.
const express = require('express');
const db = require('../db');
const { html } = require('../lib/html');
const money = require('../lib/money');
const entitlements = require('../domain/entitlements');
const tracker = require('../domain/tracker');
const tasks = require('../domain/tasks');
const planDomain = require('../domain/plan');
const c = require('../views/components');
const { requireUser, safeNext } = require('./guards');
const { intParam, notFound } = require('./util');

const router = express.Router();

function canTrack(req, res, next) {
  const e = entitlements.active(req.user.id);
  if (e.plan_maestro || e.acompanamiento) return next();
  return require('./guards').requireEntitlement('plan_maestro')(req, res, next);
}

/** Evolución de la deuda total por mes (último saldo conocido de cada deuda). */
function debtSeries(userId) {
  const rows = db.all('SELECT debt_id, date, balance FROM debt_balances WHERE user_id = ? ORDER BY date, id', userId);
  if (!rows.length) return [];
  const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))].sort();
  const last = {};
  const out = [];
  for (const m of months) {
    for (const r of rows.filter((x) => x.date.slice(0, 7) === m)) last[r.debt_id] = r.balance;
    out.push({ month: m, total: money.sum(Object.values(last)) });
  }
  return out.slice(-12);
}

function debtChart(series, cur) {
  if (series.length < 2) return '';
  const W = 560;
  const H = 160;
  const pad = { l: 8, r: 8, t: 12, b: 24 };
  const max = Math.max(...series.map((s) => Number(s.total))) || 1;
  const bw = Math.min(36, (W - pad.l - pad.r) / series.length - 6);
  const step = (W - pad.l - pad.r) / series.length;
  const label = (m) => new Intl.DateTimeFormat('es', { month: 'short', timeZone: 'UTC' }).format(new Date(m + '-15T12:00:00Z'));
  return html`<figure class="section">
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Deuda total por mes, de ${money.format(series[0].total, cur)} a ${money.format(series.at(-1).total, cur)}">
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" stroke="var(--line-2)" stroke-width="1" />
      ${series.map((s, i) => {
        const h = Math.max(((Number(s.total) / max) * (H - pad.t - pad.b)), 1);
        const x = pad.l + i * step + (step - bw) / 2;
        const y = H - pad.b - h;
        return html`<g class="bar-mark"><title>${label(s.month)}: ${money.format(s.total, cur)}</title>
          <rect x="${x.toFixed(1)}" y="${pad.t}" width="${bw.toFixed(1)}" height="${H - pad.t - pad.b}" fill="transparent" />
          <path d="M${x.toFixed(1)},${(H - pad.b).toFixed(1)} V${(y + 4).toFixed(1)} q0,-4 4,-4 H${(x + bw - 4).toFixed(1)} q4,0 4,4 V${(H - pad.b).toFixed(1)} Z" fill="${i === series.length - 1 ? 'var(--pine)' : 'var(--ink-3)'}" />
          <text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${label(s.month)}</text></g>`;
      })}
    </svg>
    <details class="more"><summary>Ver como tabla</summary>
      <table class="data"><thead><tr><th>Mes</th><th class="r">Deuda total</th></tr></thead><tbody>${series.map((s) => html`<tr><td>${s.month}</td><td class="r">${money.format(s.total, cur)}</td></tr>`)}</tbody></table>
    </details>
  </figure>`;
}

function taskRow(ctx, t) {
  const today = planDomain.today();
  const due = t.postponed_until || t.due_date;
  const overdue = t.status !== 'completada' && due && due < today;
  return html`<div class="task ${t.status === 'completada' ? 'is-done' : ''}">
    <div>
      <div class="task-title">${t.title}</div>
      <div class="task-meta">
        ${t.status === 'completada' ? `Completada el ${c.dateEs(t.completed_at)}` : t.status === 'pospuesta' ? `Pospuesta hasta el ${c.dateEs(t.postponed_until)}` : due ? `${overdue ? 'Vencida: ' : 'Para el '}${c.dateEs(due)}` : ''}
        ${t.day_offset ? `. Día ${t.day_offset} del plan` : ''}${t.source === 'coach' ? '. Propuesta por el coach' : ''}
      </div>
      ${t.status !== 'completada' && t.done_criteria ? html`<div class="task-meta"><strong>Terminada cuando:</strong> ${t.done_criteria}</div>` : ''}
    </div>
    <div class="task-actions">
      ${t.status === 'completada'
        ? html`<form class="inline-form" method="post" action="/tareas/${t.id}/reabrir">${c.csrfField(ctx)}<button class="btn btn-quiet btn-small" type="submit">Reabrir</button></form>`
        : html`<form class="inline-form" method="post" action="/tareas/${t.id}/completar">${c.csrfField(ctx)}<button class="btn btn-secondary btn-small" type="submit">Completar</button></form>
            <details class="more"><summary>Posponer</summary>
              <form method="post" action="/tareas/${t.id}/posponer" class="stack">${c.csrfField(ctx)}
                <label class="visually-hidden" for="pp-${t.id}">Nueva fecha</label>
                <input class="input" type="date" id="pp-${t.id}" name="hasta" value="${planDomain.addDays(today, 7)}" />
                <button class="btn btn-quiet btn-small" type="submit">Guardar fecha</button>
              </form>
            </details>
            ${t.status === 'pospuesta' ? html`<form class="inline-form" method="post" action="/tareas/${t.id}/reabrir">${c.csrfField(ctx)}<button class="btn btn-quiet btn-small" type="submit">Reabrir</button></form>` : ''}`}
    </div>
  </div>`;
}

router.get('/tablero', requireUser, canTrack, (req, res) => {
  const userId = req.user.id;
  const ctx = res.locals.ctx;
  const ents = entitlements.active(userId);
  const cur = tracker.baseCurrency(userId);
  const f = (v) => money.format(v, cur);
  const plan = planDomain.current(userId);
  const list = tasks.list(userId);
  const open = list.filter((t) => t.status !== 'completada');
  const done = list.filter((t) => t.status === 'completada');
  const goals = tracker.goals(userId);
  const month = tracker.currentMonth();
  const actual = tracker.monthSummary(userId, month);
  const planned = tracker.budgetSummary(userId, month);
  const savedTotal = money.sum(goals.map((g) => g.saved));
  const debtsNow = tracker.debts(userId);
  const debtTotal = money.sum(debtsNow.map((d) => d.balance));
  const series = debtSeries(userId);
  const milestones = plan ? db.all('SELECT * FROM milestones WHERE plan_version_id = ? ORDER BY month, id', plan.id) : [];
  const events = db.all(
    `SELECT e.*, t.title FROM task_events e JOIN tasks t ON t.id = e.task_id WHERE e.user_id = ? AND e.from_status IS NOT NULL ORDER BY e.id DESC LIMIT 8`,
    userId
  );
  const next = tasks.next(userId);

  res.active('tablero').page({
    title: 'Tablero',
    wide: true,
    body: html`<div class="board-head">
        <h1>Tablero</h1>
        ${plan ? html`<p class="muted">Plan versión ${plan.version_number}. Día Uno: ${c.dateEs(JSON.parse(plan.content_json).startDate)}. Hoy es el día ${Math.max(planDomain.dayNumber(JSON.parse(plan.content_json).startDate), 0)}.</p>` : html`<p class="muted">Aún no tienes un Plan Maestro vigente. <a href="/plan">Créalo aquí</a>.</p>`}
      </div>
      <div class="stats stats--cards">
        <div class="stat"><span class="k">Saldo del mes (real)</span><span class="v ${actual.balance.lt(0) ? 'neg' : ''}">${ents.acompanamiento ? f(actual.balance) : '—'}</span><span class="s">${planned ? `Previsto: ${f(planned.balance)}` : 'Sin presupuesto del mes'}</span></div>
        <div class="stat"><span class="k">Ahorro acumulado</span><span class="v">${f(savedTotal)}</span><span class="s">En ${goals.length} ${goals.length === 1 ? 'meta' : 'metas'}</span></div>
        <div class="stat"><span class="k">Deuda total</span><span class="v">${debtsNow.length ? f(debtTotal) : '—'}</span><span class="s">${debtsNow.length ? `${debtsNow.length} ${debtsNow.length === 1 ? 'deuda activa' : 'deudas activas'}` : 'Sin deudas registradas'}</span></div>
        <div class="stat"><span class="k">Tareas</span><span class="v">${done.length} de ${list.length}</span><span class="s">completadas</span></div>
      </div>
      ${next ? html`<div class="next-step"><p class="kicker">Siguiente paso</p><h2>${next.title}</h2>${next.reason ? html`<p class="muted">${next.reason}</p>` : ''}</div>` : ''}
      <div class="board">
        <div class="board-col">
        <section class="panel" aria-labelledby="h-tareas">
          <div class="panel-head"><h2 id="h-tareas">Tareas</h2>${plan ? html`<a class="small" href="/plan">Ver el plan</a>` : ''}</div>
          ${open.length ? open.slice(0, 5).map((t) => taskRow(ctx, t)) : html`<p class="muted">No hay tareas pendientes.</p>`}
          ${open.length > 5 ? html`<details class="more section"><summary>Más tareas pendientes (${open.length - 5})</summary>${open.slice(5).map((t) => taskRow(ctx, t))}</details>` : ''}
          ${done.length
            ? html`<details class="more section"><summary>Completadas (${done.length})</summary>${done.map((t) => taskRow(ctx, t))}</details>`
            : ''}
        </section>
        </div>
        <div class="board-col">
        <section class="panel" aria-labelledby="h-metas">
          <div class="panel-head"><h2 id="h-metas">Metas</h2>${ents.acompanamiento ? html`<a class="small" href="/calculadora/metas">Gestionar</a>` : ''}</div>
          ${goals.length
            ? goals.map(
                (g) => html`<div class="goal">
                  <div class="label-line"><strong>${g.name}</strong><span class="num small">${f(g.saved)} de ${f(g.target_amount)}</span></div>
                  <div class="meter" role="img" aria-label="Avance ${g.progress.valid ? money.formatPercent(g.progress.progress, 0) : ''}"><span style="width:${g.progress.valid ? Math.round(Number(g.progress.progress) * 100) : 0}%"></span></div>
                  <div class="goal-line"><span>${g.progress.valid ? money.formatPercent(g.progress.progress, 0) : ''}</span><span>${g.progress.reason === 'meta_cumplida' ? 'Cumplida' : g.progress.reachable === false ? 'Sin plazo con el aporte actual' : g.progress.months ? c.monthsText(g.progress.months) : ''}</span></div>
                </div>`
              )
            : html`<p class="muted">Sin metas todavía.</p>`}
        </section>
        <section class="panel" aria-labelledby="h-deuda">
          <div class="panel-head"><h2 id="h-deuda">Evolución de la deuda</h2>${ents.acompanamiento ? html`<a class="small" href="/calculadora/deudas">Actualizar saldos</a>` : ''}</div>
          ${series.length >= 2 ? debtChart(series, cur) : html`<p class="muted small">Actualiza el saldo de tus deudas cada mes en la calculadora para ver su evolución.</p>`}
          ${ents.acompanamiento ? '' : html`<p class="small muted">Activa el acompañamiento para registrar movimientos, saldos y metas.</p>`}
        </section>
        </div>
        ${milestones.length
          ? html`<section class="panel panel--wide" aria-labelledby="h-hitos">
              <div class="panel-head"><h2 id="h-hitos">Hitos del año</h2></div>
              <ol class="timeline">${milestones.map(
                (m) => html`<li><span class="when">Mes ${m.month}</span><div><h3>${m.title} ${m.status === 'alcanzado' ? c.badge('Alcanzado', 'ok') : ''}</h3><p class="meta">${m.condition}</p>
                  <form class="inline-form" method="post" action="/hitos/${m.id}/${m.status === 'alcanzado' ? 'reabrir' : 'alcanzado'}">${c.csrfField(ctx)}<button class="btn btn-quiet btn-small" type="submit">${m.status === 'alcanzado' ? 'Marcar como pendiente' : 'Marcar como alcanzado'}</button></form></div></li>`
              )}</ol>
            </section>`
          : ''}
        ${events.length
          ? html`<section class="panel panel--wide" aria-labelledby="h-hist"><div class="panel-head"><h2 id="h-hist">Cambios recientes</h2></div>
              <ul class="small muted history">${events.map((e) => html`<li>${c.dateEs(e.created_at, { time: true })}: «${e.title}» pasó de ${e.from_status} a ${e.to_status}${e.note ? ` (${e.note})` : ''}.</li>`)}</ul>
              ${plan ? html`<p class="small faint">Plan iniciado el ${c.dateEs(plan.completed_at)} con Día Uno el ${c.dateEs(JSON.parse(plan.content_json).startDate)}.</p>` : ''}</section>`
          : ''}
      </div>`,
  });
});

function back(req, fallback = '/tablero') {
  return safeNext(req.body.volver) || fallback;
}

router.post('/tareas/:id/completar', requireUser, (req, res, next) => {
  const id = intParam(req.params.id);
  if (!id || !tasks.get(req.user.id, id)) return next(notFound());
  tasks.complete(req.user.id, id);
  res.redirect(303, `${back(req)}?aviso=tarea_completada`);
});

router.post('/tareas/:id/posponer', requireUser, (req, res, next) => {
  const id = intParam(req.params.id);
  if (!id || !tasks.get(req.user.id, id)) return next(notFound());
  const until = tracker.validDate(req.body.hasta) || planDomain.addDays(planDomain.today(), 7);
  tasks.postpone(req.user.id, id, until < planDomain.today() ? planDomain.addDays(planDomain.today(), 1) : until);
  res.redirect(303, `${back(req)}?aviso=tarea_pospuesta`);
});

router.post('/tareas/:id/reabrir', requireUser, (req, res, next) => {
  const id = intParam(req.params.id);
  if (!id || !tasks.get(req.user.id, id)) return next(notFound());
  tasks.reopen(req.user.id, id);
  res.redirect(303, `${back(req)}?aviso=tarea_reabierta`);
});

router.post('/hitos/:id/:accion', requireUser, (req, res, next) => {
  const id = intParam(req.params.id);
  const m = id && db.one('SELECT * FROM milestones WHERE id = ? AND user_id = ?', id, req.user.id);
  if (!m || !['alcanzado', 'reabrir'].includes(req.params.accion)) return next(notFound());
  const reached = req.params.accion === 'alcanzado';
  db.run('UPDATE milestones SET status = ?, reached_at = ? WHERE id = ?', reached ? 'alcanzado' : 'pendiente', reached ? db.now() : null, id);
  res.redirect(303, '/tablero?aviso=guardado');
});

module.exports = router;
