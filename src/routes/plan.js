'use strict';
// F08 Plan Maestro: generación, estado, reintento, versiones y PDF.
const express = require('express');
const db = require('../db');
const { html, raw } = require('../lib/html');
const money = require('../lib/money');
const planDomain = require('../domain/plan');
const deep = require('../domain/deep');
const { planPdf } = require('../domain/pdf');
const c = require('../views/components');
const { requireEntitlement } = require('./guards');
const { intParam, notFound } = require('./util');

const router = express.Router();
const guard = requireEntitlement('plan_maestro');

function validDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + 'T12:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
  const diff = (d - Date.now()) / 86400000;
  return diff > -31 && diff < 120 ? v : null;
}

function startForm(ctx, { action, label, error = null, defaultDate = planDomain.today() }) {
  return html`<form method="post" action="${action}" novalidate>
    ${c.csrfField(ctx)}
    <div class="field">
      <label for="f-start">Elige tu Día Uno</label>
      <span class="hint" id="f-start-hint">La fecha en que empiezas el plan. Las acciones de los 90 días se cuentan desde ahí.</span>
      <input class="input input--short" type="date" id="f-start" name="start_date" value="${defaultDate}" aria-describedby="f-start-hint${error ? ' f-start-err' : ''}" ${error ? raw('aria-invalid="true"') : ''} />
      ${error ? html`<span class="error-text" id="f-start-err">${error}</span>` : ''}
    </div>
    <div class="actions"><button class="btn btn-primary" type="submit">${label}</button></div>
  </form>`;
}

function statusBanner(ctx, p) {
  if (!p) return '';
  if (p.status === 'en_cola' || p.status === 'generando') {
    return html`<div class="note note--ok" role="status"><p><span class="spinner" aria-hidden="true"></span> <strong>Estamos preparando la versión ${p.version_number} de tu plan.</strong> Calculamos las cifras y redactamos las explicaciones. Esta página se actualiza sola.</p>${p.error_message ? html`<p class="small">Hubo un fallo temporal; lo reintentamos automáticamente.</p>` : ''}</div>`;
  }
  if (p.status === 'fallido') {
    return html`<div class="note note--risk" role="alert"><p><strong>No pudimos generar la versión ${p.version_number}.</strong> ${p.error_message || ''} No se hizo ningún cobro.</p>
      <form method="post" action="/plan/${p.id}/reintentar">${c.csrfField(ctx)}<button class="btn btn-secondary btn-small" type="submit">Reintentar sin costo</button></form></div>`;
  }
  return '';
}

function allocBar(content) {
  const a = content.presupuesto.alloc;
  const total = Number(content.presupuesto.available) || 0;
  if (total <= 0) return '';
  const parts = [
    ['a1', 'Reserva', a.reserva],
    ['a2', 'Pago extra a deudas', a.deuda],
    ['a3', 'Metas', a.metas],
    ['a4', 'Libre', a.libre],
  ].filter((x) => Number(x[2]) > 0);
  return html`<div class="alloc" role="img" aria-label="${parts.map((x) => `${x[1]} ${money.formatPercent(Number(x[2]) / total, 0)}`).join(', ')}">
      ${parts.map((x) => html`<span class="${x[0]}" style="width:${((Number(x[2]) / total) * 100).toFixed(2)}%"></span>`)}
    </div>
    <ul class="figures">
      ${parts.map((x) => html`<li><span class="k"><span><i class="swatch alloc-${x[0]}" aria-hidden="true"></i>${x[1]}</span></span><span class="v num">${c.fmt(x[2], content.currency)}</span></li>`)}
      <li class="total"><span class="k">Disponible para el plan cada mes ${c.src('calculo')}</span><span class="v num">${c.fmt(content.presupuesto.available, content.currency)}</span></li>
    </ul>`;
}

function planView(ctx, { plan, content, narrative, versions, pendingPlan, dataChanged, readOnly = false }) {
  const cur = content.currency;
  const f = (v) => (v === null || v === undefined ? 'Sin dato' : c.fmt(v, cur));
  const day = planDomain.dayNumber(content.startDate);
  const st = content.presupuesto.strategy;
  const N = (k) => (narrative && narrative[k] ? html`<p class="narrative">${narrative[k]}</p>` : '');
  const totalDays = 90;
  const dayStates = Array.from({ length: totalDays }, (_, i) => (i + 1 < day ? 'done' : i + 1 === day ? 'now' : ''));

  return html`<div class="label-line"><span class="status-pill">Plan Maestro, versión ${plan.version_number}${plan.is_current ? '' : ' (anterior)'}</span>
      <a class="small" href="/plan/version/${plan.id}/pdf">Descargar PDF</a></div>
    ${!readOnly ? statusBanner(ctx, pendingPlan) : ''}
    ${dataChanged && !readOnly
      ? html`<div class="note note--warn"><p><strong>Tus datos cambiaron desde esta versión.</strong> Puedes generar una nueva versión con tu último diagnóstico; esta se conservará.</p>
          <form method="post" action="/plan/actualizar">${c.csrfField(ctx)}<input type="hidden" name="start_date" value="${planDomain.today()}" /><button class="btn btn-secondary btn-small" type="submit">Generar una nueva versión</button></form></div>`
      : ''}

    <div class="day">
      ${day >= 1
        ? html`<p class="day-number">Día ${Math.min(day, 999)}<span>de ${totalDays}</span></p>
            <p class="day-caption">Tu Día Uno fue el ${c.dateEs(content.startDate)}.</p>`
        : html`<p class="day-number">${1 - day}<span>${1 - day === 1 ? 'día' : 'días'}</span></p>
            <p class="day-caption">para tu Día Uno, el ${c.dateEs(content.startDate)}.</p>`}
      ${c.ticks(dayStates, { days: true, label: `Día ${day} de ${totalDays}` })}
    </div>

    <section class="plan-block" aria-labelledby="b1">
      <h2 id="b1">Diagnóstico</h2>
      ${N('diagnostico')}
      <ul class="figures">${content.diagnostico.situacion.map((x) => html`<li><span class="k">${x.label} ${c.src(x.src)}</span><span class="v num ${Number(x.value) < 0 ? 'neg' : ''}">${f(x.value)}</span></li>`)}</ul>
      <h3 class="section">Prioridades</h3>
      <ol class="priority-list">${content.diagnostico.prioridades.map((p) => html`<li>${p.title}</li>`)}</ol>
      ${content.diagnostico.faltantes.length ? html`<h3 class="section">Datos faltantes</h3><ul class="findings findings--missing">${content.diagnostico.faltantes.map((m) => html`<li>${m}</li>`)}</ul>` : ''}
    </section>

    <section class="plan-block" aria-labelledby="b2">
      <h2 id="b2">Presupuesto y deuda</h2>
      ${N('presupuesto')}
      ${Number(content.presupuesto.deficit) > 0 ? html`<div class="note note--risk"><strong>Hay un faltante de ${f(content.presupuesto.deficit)} al mes.</strong> Antes de repartir, el plan se enfoca en equilibrar ingresos y egresos.</div>` : ''}
      ${allocBar(content)}
      <h3 class="section">Distribución propuesta del mes</h3>
      <ul class="figures">${content.presupuesto.lines.map((l) => html`<li><span class="k">${l.label} ${c.src(l.src)}</span><span class="v num">${f(l.value)}</span></li>`)}</ul>
      ${Number(content.presupuesto.adjustment) > 0 ? html`<p class="small muted">${c.src('supuesto')} Incluye un ajuste de ${f(content.presupuesto.adjustment)} en gastos flexibles (${money.formatPercent(content.presupuesto.adjustmentPct, 0)}), según lo que dijiste estar dispuesto a ajustar.</p>` : ''}
      ${st.order.length || st.incomplete.length || st.alerts.length
        ? html`<h3 class="section">Estrategia de pagos</h3>
            ${st.order.length ? html`<p class="muted">Método avalancha: cubre todas las cuotas y dirige el pago extra a la deuda con la tasa más alta. Al terminar una, su cuota pasa a la siguiente.</p><ol class="priority-list">${st.order.map((n) => html`<li>${n}</li>`)}</ol>` : ''}
            ${st.baseMonths || st.planMonths
              ? html`<table class="data compare section">
                  <thead><tr><th>Escenario</th><th>Sin deudas en</th><th>Intereses</th></tr></thead>
                  <tbody>
                    <tr><td>Solo cuotas</td><td>${st.baseMonths ? c.monthsText(st.baseMonths) : 'No se alcanza'}</td><td class="num">${f(st.baseInterest)}</td></tr>
                    <tr><td>Con el plan</td><td>${st.planMonths ? c.monthsText(st.planMonths) : 'No se alcanza'}</td><td class="num">${f(st.planInterest)}</td></tr>
                  </tbody>
                </table>
                ${Number(st.interestSaved) > 0 ? html`<p class="small muted">${c.src('calculo')} Ahorras unos ${f(st.interestSaved)} en intereses.</p>` : ''}`
              : ''}
            ${st.alerts.length ? html`<div class="note note--risk"><strong>La cuota no cubre los intereses</strong> de ${st.alerts.join(', ')}. Sin un pago mayor, esa deuda no termina: no mostramos una fecha ficticia.</div>` : ''}
            ${st.incomplete.length ? html`<p class="small muted">Simulación incompleta para ${st.incomplete.join(', ')}: falta la tasa o su tipo.</p>` : ''}`
        : ''}
    </section>

    <section class="plan-block" aria-labelledby="b3">
      <h2 id="b3">Metas y escenarios</h2>
      ${N('metas')}
      ${content.metas.reserve
        ? html`<div class="goal"><div class="label-line"><strong>Reserva para emergencias</strong><span class="num">${f(content.metas.reserve.saved)} de ${f(content.metas.reserve.target)}</span></div>
            <div class="goal-line"><span>Aporte del plan: ${f(content.metas.reserve.monthly)} al mes</span><span>${content.metas.reserve.months !== null ? c.monthsText(content.metas.reserve.months) : 'Sin plazo alcanzable con estos datos'}</span></div></div>`
        : ''}
      ${content.metas.goals.map(
        (g) => html`<div class="goal"><div class="label-line"><strong>${g.name}</strong><span class="num">${f(g.saved)} de ${f(g.target)}</span></div>
          <div class="goal-line"><span>Aporte: ${f(g.monthly)} al mes</span><span>${g.reachable ? `Plazo: ${c.monthsText(g.months)}` : g.reason === 'sin_aporte' ? 'Sin aporte: no hay un plazo alcanzable con estos datos' : 'Plazo mayor a 50 años'}</span></div>
          ${g.desiredMonths && g.needed ? html`<p class="small ${g.onTrack ? 'pos' : 'muted'}">${g.onTrack ? `Llegas en el plazo que querías (${g.desiredMonths} meses).` : `Para lograrla en ${g.desiredMonths} meses necesitarías ${f(g.needed)} al mes.`}</p>` : ''}</div>`
      )}
      <h3 class="section">Escenarios a 12 meses</h3>
      <div class="table-wrap">
        <table class="data compare stack-sm">
          <thead><tr><th>Escenario</th><th>Reserva en 12 meses</th><th>Sin deudas en</th></tr></thead>
          <tbody>
            ${content.metas.scenarios.map(
              (sc) => html`<tr><td data-label="Escenario"><strong>${sc.name}</strong> ${c.src(sc.kind)}<br /><span class="small faint">${sc.note}</span></td>
                <td data-label="Reserva en 12 meses" class="num">${f(sc.reserveIn12)}</td>
                <td data-label="Sin deudas en">${sc.debtMonths ? c.monthsText(sc.debtMonths) : sc.debtUnresolved && sc.debtUnresolved.length ? 'No se alcanza' : '—'}</td></tr>`
            )}
          </tbody>
        </table>
      </div>
    </section>

    <section class="plan-block" aria-labelledby="b4">
      <h2 id="b4">Plan de 90 días</h2>
      ${N('plan90')}
      <ol class="timeline">
        ${content.plan90.map(
          (a) => html`<li><span class="when">Día ${a.day}<br /><span class="small faint">${c.dateShort(planDomain.addDays(content.startDate, a.day - 1))}</span></span>
            <div><h3>${a.title}</h3><p>${a.reason}</p><p class="meta"><strong>Terminada cuando:</strong> ${a.criteria}</p><p class="meta"><strong>Indicador:</strong> ${a.indicator}</p></div></li>`
        )}
      </ol>
      ${!readOnly ? html`<div class="actions"><a class="btn btn-secondary" href="/tablero">Ver mis tareas</a></div>` : ''}
    </section>

    <section class="plan-block" aria-labelledby="b5">
      <h2 id="b5">Hoja de ruta de 12 meses</h2>
      ${N('hoja12')}
      <ol class="timeline">${content.hoja12.map((m) => html`<li><span class="when">Mes ${m.month}</span><div><h3>${m.title}</h3><p class="meta">${m.condition}</p></div></li>`)}</ol>
      <h3 class="section">Revisa el plan</h3>
      <ul class="ticklist">${content.review.map((r) => html`<li>${r}</li>`)}</ul>
    </section>

    <p class="narrative-note section">Las cifras las calcula Día Uno con tus datos y reglas versionadas. Los textos explicativos los redacta una IA a partir de esas cifras.</p>

    ${versions && versions.length > 1
      ? html`<details class="more section"><summary>Versiones del plan (${versions.length})</summary>
          <table class="data versions"><thead><tr><th>Versión</th><th>Estado</th><th>Fecha</th><th></th></tr></thead><tbody>
          ${versions.map((v) => html`<tr><td>${v.version_number}${v.is_current ? ' (vigente)' : ''}</td><td>${{ completo: 'Completa', en_cola: 'En cola', generando: 'Generando', fallido: 'Fallida' }[v.status]}</td><td>${c.dateEs(v.completed_at || v.created_at)}</td><td>${v.status === 'completo' ? html`<a href="/plan/version/${v.id}">Ver</a>` : ''}</td></tr>`)}
          </tbody></table></details>`
      : ''}`;
}

router.get('/plan', guard, (req, res) => {
  const userId = req.user.id;
  const cur = planDomain.current(userId);
  const pend = planDomain.pending(userId);
  const diag = deep.latestDiagnosis(userId);
  res.active('plan');
  if (!cur) {
    if (!diag) {
      return res.page({
        title: 'Plan Maestro',
        body: html`<h1>Tu Plan Maestro</h1>
          <p class="lead">El plan se calcula a partir de tu evaluación profunda. Complétala primero.</p>
          <div class="actions"><a class="btn btn-primary" href="/evaluacion">Ir a la evaluación profunda</a></div>`,
      });
    }
    return res.page({
      title: 'Plan Maestro',
      refresh: pend && ['en_cola', 'generando'].includes(pend.status) ? 3 : null,
      body: html`<h1>Tu Plan Maestro</h1>
        ${statusBanner(res.locals.ctx, pend)}
        ${!pend || pend.status === 'fallido'
          ? html`<p class="lead">Con tu diagnóstico del ${c.dateEs(diag.created_at)} prepararemos un presupuesto, una estrategia de deuda, tus metas y escenarios, un plan de 90 días y una hoja de ruta de 12 meses.</p>
              ${!pend ? startForm(res.locals.ctx, { action: '/plan/generar', label: 'Generar mi Plan Maestro' }) : ''}`
          : ''}`,
    });
  }
  const versions = db.all('SELECT id, version_number, status, is_current, created_at, completed_at FROM plan_versions WHERE user_id = ? ORDER BY version_number DESC', userId);
  res.page({
    title: 'Plan Maestro',
    wide: false,
    refresh: pend && ['en_cola', 'generando'].includes(pend.status) ? 4 : null,
    body: html`<h1 class="visually-hidden">Plan Maestro</h1>${planView(res.locals.ctx, {
      plan: cur,
      content: JSON.parse(cur.content_json),
      narrative: JSON.parse(cur.narrative_json || 'null'),
      versions,
      pendingPlan: pend,
      dataChanged: planDomain.dataChangedSince(userId, cur) && !pend,
    })}
    ${!db.value("SELECT 1 FROM tasks WHERE plan_version_id = ? AND status = 'completada'", cur.id)
      ? html`<details class="more section"><summary>Cambiar mi Día Uno</summary>${startForm(res.locals.ctx, { action: `/plan/${cur.id}/dia-uno`, label: 'Guardar fecha', defaultDate: JSON.parse(cur.content_json).startDate })}</details>`
      : ''}`,
  });
});

router.post('/plan/generar', guard, (req, res) => {
  const start = validDate(req.body.start_date);
  if (!start) {
    return res.status(422).page({
      title: 'Plan Maestro',
      body: html`<h1>Tu Plan Maestro</h1>${startForm(res.locals.ctx, { action: '/plan/generar', label: 'Generar mi Plan Maestro', error: 'Elige una fecha válida entre hace un mes y los próximos cuatro meses.' })}`,
    });
  }
  try {
    planDomain.request(req.user.id, { startDate: start, reason: 'primera_version' });
  } catch (e) {
    if (e.status === 409) return res.redirect(303, '/evaluacion');
    throw e;
  }
  res.redirect(303, '/plan?aviso=plan_en_cola');
});

router.post('/plan/actualizar', guard, (req, res) => {
  const start = validDate(req.body.start_date) || planDomain.today();
  planDomain.request(req.user.id, { startDate: start, reason: 'datos_actualizados' });
  res.redirect(303, '/plan?aviso=plan_en_cola');
});

router.post('/plan/:id/reintentar', guard, (req, res, next) => {
  const id = intParam(req.params.id);
  if (!id || !planDomain.retry(req.user.id, id)) return next(notFound());
  res.redirect(303, '/plan?aviso=plan_en_cola');
});

router.post('/plan/:id/dia-uno', guard, (req, res, next) => {
  const id = intParam(req.params.id);
  const start = validDate(req.body.start_date);
  if (!id || !start || !planDomain.changeStart(req.user.id, id, start)) return next(notFound());
  res.redirect(303, '/plan?aviso=guardado');
});

function ownedPlan(req) {
  const id = intParam(req.params.id);
  return id ? db.one("SELECT * FROM plan_versions WHERE id = ? AND user_id = ? AND status = 'completo'", id, req.user.id) : null;
}

router.get('/plan/version/:id', guard, (req, res, next) => {
  const p = ownedPlan(req);
  if (!p) return next(notFound());
  res.active('plan').page({
    title: `Plan Maestro, versión ${p.version_number}`,
    body: html`<p class="small"><a href="/plan">Volver al plan vigente</a></p>${planView(res.locals.ctx, { plan: p, content: JSON.parse(p.content_json), narrative: JSON.parse(p.narrative_json || 'null'), readOnly: !p.is_current })}`,
  });
});

router.get('/plan/version/:id/pdf', guard, (req, res, next) => {
  const p = ownedPlan(req);
  if (!p) return next(notFound());
  const user = db.one('SELECT name FROM users WHERE id = ?', req.user.id);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="plan-maestro-v${p.version_number}.pdf"`, 'Cache-Control': 'no-store' });
  planPdf({ user, plan: p, content: JSON.parse(p.content_json), narrative: JSON.parse(p.narrative_json || 'null') }).pipe(res);
});

module.exports = router;
module.exports.planView = planView;
