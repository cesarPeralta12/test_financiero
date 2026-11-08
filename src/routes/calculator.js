'use strict';
// F10 Calculadora financiera (requiere el acceso de acompañamiento).
const express = require('express');
const db = require('../db');
const { html, raw } = require('../lib/html');
const money = require('../lib/money');
const tracker = require('../domain/tracker');
const calc = require('../domain/calc');
const qs = require('../domain/questionnaire');
const c = require('../views/components');
const { requireEntitlement } = require('./guards');
const { intParam, notFound } = require('./util');

const router = express.Router();
const guard = requireEntitlement('acompanamiento');

const TABS = [
  ['movimientos', 'Movimientos'],
  ['presupuesto', 'Presupuesto'],
  ['deudas', 'Deudas'],
  ['metas', 'Metas'],
  ['simulador', 'Simulador'],
];

function tabs(active) {
  return html`<nav class="tabs" aria-label="Secciones de la calculadora">${TABS.map(([k, l]) => html`<a href="/calculadora/${k}" ${k === active ? raw('aria-current="page"') : ''}>${l}</a>`)}</nav>`;
}

function monthLabel(m) {
  return new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(m + '-15T12:00:00Z'));
}

function monthNav(base, month) {
  const prev = tracker.prevMonth(month);
  const [y, mm] = month.split('-').map(Number);
  const next = new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 7);
  return html`<div class="label-line"><h2 class="num">${monthLabel(month)}</h2><span class="small links"><a href="${base}?mes=${prev}">Mes anterior</a>${month < tracker.currentMonth() ? html`<a href="${base}?mes=${next}">Mes siguiente</a>` : ''}</span></div>`;
}

function page(res, active, title, body) {
  return res.active('calculadora').page({ title: `${title} | Calculadora`, wide: true, body: html`<h1>Calculadora</h1>${tabs(active)}${body}` });
}

router.get('/calculadora', guard, (req, res) => res.redirect(303, '/calculadora/movimientos'));

// ───────── Movimientos ─────────
function kindOptions(selected) {
  return html`${Object.entries(tracker.CATEGORIES).map(
    ([k, cats]) => html`<optgroup label="${tracker.KINDS[k]}">${Object.entries(cats).map(([ck, cl]) => html`<option value="${k}:${ck}" ${selected === `${k}:${ck}` ? raw('selected') : ''}>${tracker.KINDS[k]}: ${cl}</option>`)}</optgroup>`
  )}`;
}

function movementForm(ctx, { userId, action, form = {}, errors = {}, submit = 'Guardar movimiento' }) {
  const cur = tracker.baseCurrency(userId);
  const debts = tracker.debts(userId);
  const goals = tracker.goals(userId);
  const sel = (name, list, value, placeholder, labelFn) =>
    html`<select class="input" id="${c.fieldId(name)}" name="${name}" ${c.invalid(errors, name)}><option value="">${placeholder}</option>${list.map((x) => html`<option value="${x.id}" ${String(value) === String(x.id) ? raw('selected') : ''}>${labelFn(x)}</option>`)}</select>${c.errorText(errors, name)}`;
  return html`<form method="post" action="${action}" novalidate>
    ${c.csrfField(ctx)}
    ${c.errorSummary(errors)}
    <div class="grid-3">
      <div class="field"><label for="f-date">Fecha</label><input class="input" type="date" id="f-date" name="date" value="${form.date || new Date().toISOString().slice(0, 10)}" ${c.invalid(errors, 'date')} />${c.errorText(errors, 'date')}</div>
      <div class="field"><label for="f-kindcat">Tipo y categoría</label><select class="input" id="f-kindcat" name="kindcat" ${c.invalid(errors, 'kind')}>${kindOptions(form.kindcat || 'gasto:alimentacion')}</select>${c.errorText(errors, 'kind')}${c.errorText(errors, 'category')}</div>
      <div class="field"><label for="f-amount">Importe</label>${c.moneyInput({ name: 'amount', value: form.amount, currency: cur, errors })}</div>
    </div>
    <div class="grid-3">
      <div class="field"><label for="f-debt-id">Deuda (si es un pago de deuda)</label>${sel('debt_id', debts, form.debt_id, 'Ninguna', (d) => d.name)}</div>
      <div class="field"><label for="f-goal-id">Meta o ahorro (aportes, retiros u origen)</label>${sel('goal_id', goals, form.goal_id, 'Ninguna', (g) => g.name)}</div>
      <div class="field"><label for="f-to-goal-id">Destino (solo transferencias)</label>${sel('to_goal_id', goals, form.to_goal_id, 'Ninguno', (g) => g.name)}</div>
    </div>
    <div class="field"><label for="f-note">Nota (opcional)</label><input class="input" id="f-note" name="note" maxlength="140" value="${form.note || ''}" /></div>
    <p class="small muted">Moneda: ${cur}. Las transferencias entre tus propios ahorros no cuentan como ingreso ni como gasto.</p>
    <div class="actions"><button class="btn btn-primary" type="submit">${submit}</button></div>
  </form>`;
}

function bodyToMovement(body) {
  const [kind, category] = String(body.kindcat || '').split(':');
  return { ...body, kind, category };
}

function summaryBlock(cur, actual, planned) {
  const f = (v) => money.format(v, cur);
  const row = (label, a, p) => html`<tr><td>${label}</td><td class="r">${f(a)}</td><td class="r">${p === null ? '—' : f(p)}</td></tr>`;
  return html`<table class="data compare">
      <thead><tr><th>Este mes</th><th class="r">Real ${c.src('dato')}</th><th class="r">Previsto</th></tr></thead>
      <tbody>
        ${row('Ingresos', actual.ingreso, planned ? planned.ingreso : null)}
        ${row('Gastos', actual.gasto, planned ? planned.gasto : null)}
        ${row('Pagos de deuda', actual.pago_deuda, planned ? planned.pago_deuda : null)}
        <tr><td><strong>Saldo del mes</strong> ${c.src('calculo')}</td><td class="r"><strong class="${actual.balance.lt(0) ? 'neg' : ''}">${f(actual.balance)}</strong></td><td class="r">${planned ? f(planned.balance) : '—'}</td></tr>
        ${row('Ahorro neto', actual.netSaving, planned ? planned.ahorro : null)}
      </tbody>
    </table>
    <p class="small faint">Lo previsto viene de tu presupuesto y lo real de tus movimientos. Se muestran por separado y nunca se suman.</p>`;
}

router.get('/calculadora/movimientos', guard, (req, res) => {
  const userId = req.user.id;
  const month = tracker.validMonth(req.query.mes) || tracker.currentMonth();
  const cur = tracker.baseCurrency(userId);
  const list = tracker.listMovements(userId, month);
  const actual = tracker.monthSummary(userId, month);
  const planned = tracker.budgetSummary(userId, month);
  const goalsById = Object.fromEntries(tracker.goals(userId, { includeArchived: true }).map((g) => [g.id, g.name]));
  const debtsById = Object.fromEntries(tracker.debts(userId, { includePaid: true }).map((d) => [d.id, d.name]));
  page(res, 'movimientos', 'Movimientos', html`
    ${monthNav('/calculadora/movimientos', month)}
    <div class="cols">
      <section aria-labelledby="h-resumen"><h3 id="h-resumen" class="visually-hidden">Resumen</h3>${summaryBlock(cur, actual, planned)}</section>
      <section aria-labelledby="h-nuevo"><h3 id="h-nuevo">Registrar un movimiento</h3>${movementForm(res.locals.ctx, { userId, action: '/calculadora/movimientos' })}</section>
    </div>
    <section class="section" aria-labelledby="h-lista">
      <h3 id="h-lista">Movimientos de ${monthLabel(month)}</h3>
      ${list.length
        ? html`<table class="data stack-sm"><thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th class="r">Importe</th><th></th></tr></thead><tbody>
            ${list.map(
              (m) => html`<tr>
                <td data-label="Fecha">${c.dateShort(m.date)}</td>
                <td data-label="Tipo">${tracker.KINDS[m.kind]}<br /><span class="small faint">${tracker.CATEGORIES[m.kind][m.category]}</span></td>
                <td data-label="Detalle">${m.note || ''}${m.debt_id ? html`<br /><span class="small faint">Deuda: ${debtsById[m.debt_id]}</span>` : ''}${m.goal_id ? html`<br /><span class="small faint">${m.kind === 'transferencia' ? 'De' : 'Meta'}: ${goalsById[m.goal_id]}${m.to_goal_id ? ` a ${goalsById[m.to_goal_id]}` : ''}</span>` : ''}${m.source === 'coach' ? html`<br /><span class="small faint">Registrado desde el coach</span>` : ''}</td>
                <td data-label="Importe" class="r ${['gasto', 'pago_deuda'].includes(m.kind) ? '' : m.kind === 'ingreso' ? 'pos' : ''}">${money.format(m.amount, m.currency)}</td>
                <td data-label=""><a href="/calculadora/movimientos/${m.id}/editar">Editar</a></td>
              </tr>`
            )}
          </tbody></table>`
        : html`<div class="empty"><h3>Sin movimientos este mes</h3><p>Registra tu primer ingreso o gasto con el formulario.</p></div>`}
    </section>`);
});

router.post('/calculadora/movimientos', guard, (req, res) => {
  const v = tracker.validateMovement(req.user.id, bodyToMovement(req.body));
  if (!v.ok) {
    res.status(422);
    return page(res, 'movimientos', 'Movimientos', html`<h2>Registrar un movimiento</h2>${movementForm(res.locals.ctx, { userId: req.user.id, action: '/calculadora/movimientos', form: req.body, errors: v.errors })}`);
  }
  tracker.createMovement(req.user.id, v.value);
  res.redirect(303, `/calculadora/movimientos?mes=${v.value.date.slice(0, 7)}&aviso=guardado`);
});

router.get('/calculadora/movimientos/:id/editar', guard, (req, res, next) => {
  const id = intParam(req.params.id);
  const m = id && tracker.getMovement(req.user.id, id);
  if (!m) return next(notFound());
  const form = { ...m, kindcat: `${m.kind}:${m.category}` };
  page(res, 'movimientos', 'Editar movimiento', html`<h2>Editar movimiento</h2>
    ${movementForm(res.locals.ctx, { userId: req.user.id, action: `/calculadora/movimientos/${m.id}`, form, submit: 'Guardar cambios' })}
    <form method="post" action="/calculadora/movimientos/${m.id}/eliminar" data-confirm="¿Eliminar este movimiento? Los totales se recalcularán.">${c.csrfField(res.locals.ctx)}<button class="btn btn-danger" type="submit">Eliminar movimiento</button></form>`);
});

router.post('/calculadora/movimientos/:id', guard, (req, res, next) => {
  const id = intParam(req.params.id);
  const m = id && tracker.getMovement(req.user.id, id);
  if (!m) return next(notFound());
  const v = tracker.validateMovement(req.user.id, bodyToMovement(req.body));
  if (!v.ok) {
    res.status(422);
    return page(res, 'movimientos', 'Editar movimiento', html`<h2>Editar movimiento</h2>${movementForm(res.locals.ctx, { userId: req.user.id, action: `/calculadora/movimientos/${m.id}`, form: req.body, errors: v.errors, submit: 'Guardar cambios' })}`);
  }
  tracker.updateMovement(req.user.id, id, v.value);
  res.redirect(303, `/calculadora/movimientos?mes=${v.value.date.slice(0, 7)}&aviso=guardado`);
});

router.post('/calculadora/movimientos/:id/eliminar', guard, (req, res, next) => {
  const id = intParam(req.params.id);
  const m = id && tracker.getMovement(req.user.id, id);
  if (!m) return next(notFound());
  tracker.deleteMovement(req.user.id, id);
  res.redirect(303, `/calculadora/movimientos?mes=${m.date.slice(0, 7)}&aviso=eliminado`);
});

// ───────── Presupuesto ─────────
router.get('/calculadora/presupuesto', guard, (req, res) => {
  const userId = req.user.id;
  const month = tracker.validMonth(req.query.mes) || tracker.currentMonth();
  renderBudget(req, res, month, {});
});

function renderBudget(req, res, month, errors) {
  const userId = req.user.id;
  const cur = tracker.baseCurrency(userId);
  const lines = Object.fromEntries(tracker.budget(userId, month).map((l) => [`${l.kind}.${l.category}`, l.amount]));
  const prevHas = tracker.budget(userId, tracker.prevMonth(month)).length > 0;
  const sum = tracker.budgetSummary(userId, month);
  const ctx = res.locals.ctx;
  page(res, 'presupuesto', 'Presupuesto', html`
    ${monthNav('/calculadora/presupuesto', month)}
    <p class="muted">El presupuesto guarda lo que prevés para el mes. Tus movimientos guardan lo que realmente pasó.</p>
    ${c.errorSummary(errors)}
    <form method="post" action="/calculadora/presupuesto?mes=${month}" novalidate>
      ${c.csrfField(ctx)}
      <div class="breakdown">
        ${tracker.budgetFields().map(
          (f) => html`<div class="field"><label for="${c.fieldId(`b.${f.kind}.${f.category}`)}">${f.label}</label>${c.moneyInput({ name: `b[${f.kind}][${f.category}]`, errorKey: `b.${f.kind}.${f.category}`, value: lines[`${f.kind}.${f.category}`] ? money.formatNumber(lines[`${f.kind}.${f.category}`], cur) : '', currency: cur, errors })}</div>`
        )}
      </div>
      ${sum ? html`<ul class="figures section"><li class="total"><span class="k">Saldo previsto (ingresos − gastos − deudas)</span><span class="v num">${money.format(sum.balance, cur)}</span></li><li><span class="k">Libre después del ahorro</span><span class="v num ${sum.free.lt(0) ? 'neg' : ''}">${money.format(sum.free, cur)}</span></li></ul>` : ''}
      <div class="actions"><button class="btn btn-primary" type="submit">Guardar presupuesto</button></div>
    </form>
    ${prevHas ? html`<form method="post" action="/calculadora/presupuesto/copiar?mes=${month}" class="section" data-confirm="Se reemplazará el presupuesto de este mes por el del mes anterior.">${c.csrfField(ctx)}<button class="btn btn-secondary btn-small" type="submit">Copiar el presupuesto del mes anterior</button></form>` : ''}`);
}

router.post('/calculadora/presupuesto', guard, (req, res) => {
  const month = tracker.validMonth(req.query.mes) || tracker.currentMonth();
  const r = tracker.saveBudget(req.user.id, month, req.body);
  if (!r.ok) {
    res.status(422);
    return renderBudget(req, res, month, r.errors);
  }
  res.redirect(303, `/calculadora/presupuesto?mes=${month}&aviso=guardado`);
});

router.post('/calculadora/presupuesto/copiar', guard, (req, res) => {
  const month = tracker.validMonth(req.query.mes) || tracker.currentMonth();
  tracker.copyBudget(req.user.id, tracker.prevMonth(month), month);
  res.redirect(303, `/calculadora/presupuesto?mes=${month}&aviso=guardado`);
});

// ───────── Deudas ─────────
function debtSpark(history, cur) {
  if (history.length < 2) return '';
  const vals = history.map((h) => Number(h.balance));
  const max = Math.max(...vals) || 1;
  const w = 220;
  const h = 40;
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`).join(' ');
  return html`<svg class="chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Evolución del saldo: de ${money.format(vals[0], cur)} a ${money.format(vals.at(-1), cur)}"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" class="pos" /></svg>`;
}

router.get('/calculadora/deudas', guard, (req, res) => renderDebts(req, res, {}));

function renderDebts(req, res, { errors = {}, form = {}, balanceErrors = {} }) {
  const userId = req.user.id;
  const cur = tracker.baseCurrency(userId);
  const list = tracker.debts(userId, { includePaid: true });
  const ctx = res.locals.ctx;
  page(res, 'deudas', 'Deudas', html`
    ${list.length
      ? list.map((d) => {
          const p = calc.projectDebt({ balance: d.balance, payment: d.payment, ratePercent: d.rate, rateType: d.rate_type, fees: d.fees });
          return html`<section class="row-card section" aria-labelledby="debt-${d.id}">
            <div class="label-line"><h3 id="debt-${d.id}">${d.name} ${d.status === 'pagada' ? c.badge('Pagada', 'ok') : ''}</h3><span class="num"><strong>${money.format(d.balance, cur)}</strong> <span class="small faint">al ${c.dateShort(d.balanceDate)}</span></span></div>
            <p class="small muted">Cuota ${money.format(d.payment, cur)} al mes. Tasa ${d.rate ? `${String(d.rate).replace('.', ',')} % ${calc.RATE_TYPES[d.rate_type].toLowerCase()}` : 'desconocida'}.
              ${p.status === 'proyectada' ? `Al ritmo actual terminas en ${c.monthsText(p.months)}.` : p.status === 'pago_no_cubre_interes' ? html`<span class="neg">La cuota no cubre el interés: la deuda no baja.</span>` : p.status === 'tasa_desconocida' ? 'Sin tasa no podemos proyectarla.' : ''}</p>
            ${debtSpark(d.history, cur)}
            <form method="post" action="/calculadora/deudas/${d.id}/saldo" class="pair" novalidate>
              ${c.csrfField(ctx)}
              <div class="field"><label for="f-bal-${d.id}">Saldo según tu estado de cuenta</label>${c.moneyInput({ name: 'balance', id: `f-bal-${d.id}`, errorKey: `balance_${d.id}`, currency: cur, errors: balanceErrors })}</div>
              <div class="field"><label for="f-bdate-${d.id}">Fecha</label><input class="input" type="date" id="f-bdate-${d.id}" name="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
              <div class="actions"><button class="btn btn-secondary btn-small" type="submit">Actualizar saldo</button></div>
            </form>
          </section>`;
        })
      : html`<div class="empty"><h3>Sin deudas registradas</h3><p>Si generaste tu plan, tus deudas aparecen aquí automáticamente. También puedes añadirlas.</p></div>`}
    <section class="section" aria-labelledby="h-nueva-deuda">
      <h2 id="h-nueva-deuda">Añadir una deuda</h2>
      ${c.errorSummary(errors)}
      <form method="post" action="/calculadora/deudas" novalidate>
        ${c.csrfField(ctx)}
        <div class="grid-3">
          ${c.textField({ name: 'name', label: 'Nombre', value: form.name, errors, maxlength: 60 })}
          <div class="field"><label for="f-kind">Tipo</label>${c.select({ name: 'kind', options: [['tarjeta', 'Tarjeta de crédito'], ['personal', 'Préstamo personal'], ['auto', 'Crédito de auto'], ['hipoteca', 'Hipoteca'], ['estudios', 'Crédito educativo'], ['familiar', 'Préstamo familiar'], ['otra', 'Otra']].map(([value, label]) => ({ value, label })), value: form.kind, errors, placeholder: 'Elige el tipo' })}</div>
          <div class="field"><label for="f-balance">Saldo</label>${c.moneyInput({ name: 'balance', value: form.balance, currency: cur, errors })}</div>
          <div class="field"><label for="f-payment">Cuota mensual</label>${c.moneyInput({ name: 'payment', value: form.payment, currency: cur, errors })}</div>
          ${c.textField({ name: 'rate', label: 'Tasa (%)', value: form.rate, errors, inputmode: 'decimal' })}
          <div class="field"><label for="f-rate-type">Tipo de tasa</label>${c.select({ name: 'rate_type', options: qs.RATE_TYPE_OPTIONS, value: form.rate_type, errors, placeholder: 'Elige el tipo de tasa' })}</div>
        </div>
        <div class="field"><label for="f-fees">Comisiones y seguros al mes (opcional)</label>${c.moneyInput({ name: 'fees', value: form.fees, currency: cur, errors })}</div>
        <div class="actions"><button class="btn btn-primary" type="submit">Añadir deuda</button></div>
      </form>
    </section>`);
}

router.post('/calculadora/deudas', guard, (req, res) => {
  const v = tracker.validateDebt(req.user.id, req.body);
  if (!v.ok) {
    res.status(422);
    return renderDebts(req, res, { errors: v.errors, form: req.body });
  }
  tracker.createDebt(req.user.id, v.value);
  res.redirect(303, '/calculadora/deudas?aviso=guardado');
});

router.post('/calculadora/deudas/:id/saldo', guard, (req, res, next) => {
  const id = intParam(req.params.id);
  const cur = tracker.baseCurrency(req.user.id);
  const p = money.parseAmount(req.body.balance, cur);
  const date = tracker.validDate(req.body.date) || new Date().toISOString().slice(0, 10);
  if (!id) return next(notFound());
  if (!p.ok) {
    res.status(422);
    return renderDebts(req, res, { balanceErrors: { [`balance_${id}`]: p.empty ? 'Escribe el saldo.' : p.error } });
  }
  if (!tracker.updateDebtBalance(req.user.id, id, { balance: p.value, date })) return next(notFound());
  res.redirect(303, '/calculadora/deudas?aviso=guardado');
});

// ───────── Metas ─────────
router.get('/calculadora/metas', guard, (req, res) => renderGoals(req, res, {}));

function goalStatus(g, cur) {
  const p = g.progress;
  const f = (v) => money.format(v, cur);
  if (!p.valid) return 'Objetivo no válido';
  if (p.reason === 'meta_cumplida') return 'Meta cumplida';
  const parts = [`Faltan ${f(p.pending)}`];
  if (p.reachable === false) parts.push(p.reason === 'sin_aporte' ? 'Con el aporte actual no hay un plazo alcanzable' : 'El plazo supera los 50 años');
  else if (p.months) parts.push(`al ritmo de ${f(g.monthly)} al mes, en ${c.monthsText(p.months)}`);
  if (p.needed) parts.push(`para lograrla en ${p.desiredMonths} meses necesitas ${f(p.needed)} al mes${p.onTrack === false ? ' (no es viable con el aporte actual)' : ''}`);
  return parts.join('; ') + '.';
}

function renderGoals(req, res, { errors = {}, form = {} }) {
  const userId = req.user.id;
  const cur = tracker.baseCurrency(userId);
  const list = tracker.goals(userId);
  const ctx = res.locals.ctx;
  page(res, 'metas', 'Metas', html`
    <p class="muted">El aporte mensual es el promedio de lo que apartaste en los últimos tres meses. Registra aportes como movimientos de tipo «Aporte a ahorro».</p>
    ${list.length
      ? list.map(
          (g) => html`<div class="goal">
            <div class="label-line"><strong>${g.name} ${g.status === 'alcanzada' ? c.badge('Alcanzada', 'ok') : ''}</strong><span class="num">${money.format(g.saved, cur)} de ${money.format(g.target_amount, cur)}</span></div>
            <div class="meter" role="img" aria-label="Avance ${g.progress.valid ? money.formatPercent(g.progress.progress, 0) : ''}"><span style="width:${g.progress.valid ? Math.round(Number(g.progress.progress) * 100) : 0}%"></span></div>
            <p class="small muted">${goalStatus(g, cur)}</p>
            <form class="inline-form" method="post" action="/calculadora/metas/${g.id}/archivar" data-confirm="¿Archivar esta meta?">${c.csrfField(ctx)}<button class="btn btn-quiet btn-small" type="submit">Archivar</button></form>
          </div>`
        )
      : html`<div class="empty"><h3>Sin metas</h3><p>Añade una meta con una cifra y un plazo.</p></div>`}
    <section class="section" aria-labelledby="h-nueva-meta">
      <h2 id="h-nueva-meta">Añadir una meta</h2>
      ${c.errorSummary(errors)}
      <form method="post" action="/calculadora/metas" novalidate>
        ${c.csrfField(ctx)}
        <div class="grid-2">
          ${c.textField({ name: 'name', label: 'Nombre', value: form.name, errors, maxlength: 60 })}
          <div class="field"><label for="f-target">Objetivo</label>${c.moneyInput({ name: 'target', value: form.target, currency: cur, errors })}</div>
          <div class="field"><label for="f-saved">Ya ahorrado</label>${c.moneyInput({ name: 'saved', value: form.saved, currency: cur, errors })}</div>
          ${c.textField({ name: 'months', label: 'Plazo en meses (opcional)', value: form.months, errors, inputmode: 'numeric' })}
        </div>
        <div class="actions"><button class="btn btn-primary" type="submit">Añadir meta</button></div>
      </form>
    </section>`);
}

router.post('/calculadora/metas', guard, (req, res) => {
  const v = tracker.validateGoal(req.user.id, req.body);
  if (!v.ok) {
    res.status(422);
    return renderGoals(req, res, { errors: v.errors, form: req.body });
  }
  tracker.createGoal(req.user.id, v.value);
  res.redirect(303, '/calculadora/metas?aviso=guardado');
});

router.post('/calculadora/metas/:id/archivar', guard, (req, res, next) => {
  const id = intParam(req.params.id);
  if (!id || !tracker.archiveGoal(req.user.id, id)) return next(notFound());
  res.redirect(303, '/calculadora/metas?aviso=guardado');
});

// ───────── Simulador ─────────
function simulatorView(res, userId, { form = {}, errors = {}, result = null }) {
  const cur = tracker.baseCurrency(userId);
  const ctx = res.locals.ctx;
  const saved = db.all('SELECT * FROM scenarios WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', userId);
  const base = tracker.baseScenario(userId);
  const f = (v) => (v === null || v === undefined ? '—' : money.format(v, cur));
  const m = (v, unresolved) => (v ? c.monthsText(v) : unresolved && unresolved.length ? 'No se alcanza' : '—');
  const field = (name, label, hint) => html`<div class="field"><label for="${c.fieldId(name)}">${label}</label><span class="hint">${hint}</span>${c.moneyInput({ name, value: form[name], currency: cur, errors })}</div>`;
  return page(res, 'simulador', 'Simulador', html`
    <p class="muted">Compara tu escenario actual con uno modificado. La simulación no cambia tus datos reales ni tu plan; solo se guarda si lo pides.</p>
    ${!base
      ? html`<div class="empty"><h3>Faltan cifras base</h3><p>Completa tu evaluación profunda o registra tu presupuesto del mes para simular.</p></div>`
      : html`<p class="small faint">Escenario actual tomado de ${base.source === 'presupuesto' ? 'tu presupuesto de este mes' : 'tu último diagnóstico'}.</p>
        ${c.errorSummary(errors)}
        <form method="post" action="/calculadora/simulador" novalidate>
          ${c.csrfField(ctx)}
          <div class="grid-2">
            ${field('ahorro_extra', 'Cambio en tu ahorro mensual', 'Usa un número negativo para ahorrar menos.')}
            ${field('cambio_gasto', 'Cambio en tus gastos mensuales', 'Usa un número negativo para gastar menos.')}
            ${field('pago_extra_deuda', 'Pago extra mensual a deudas', 'Se aplica a la deuda con la tasa más alta.')}
            ${field('ingreso_extra', 'Ingreso extra mensual (supuesto)', 'Una estimación, no un ingreso garantizado.')}
          </div>
          <div class="actions"><button class="btn btn-primary" type="submit">Simular</button></div>
        </form>`}
    ${result
      ? html`<section class="section" aria-labelledby="h-res">
          <h2 id="h-res">Resultado</h2>
          <span class="msg-tag">Simulación: tus datos reales no cambiaron</span>
          <table class="data compare">
            <thead><tr><th></th><th>Actual</th><th>Escenario</th></tr></thead>
            <tbody>
              <tr><td>Ingresos</td><td class="num">${f(result.base.income)}</td><td class="num">${f(result.scenario.income)}</td></tr>
              <tr><td>Gastos</td><td class="num">${f(result.base.expenses)}</td><td class="num">${f(result.scenario.expenses)}</td></tr>
              <tr><td>Pagos de deuda</td><td class="num">${f(result.base.debtPayments)}</td><td class="num">${f(result.scenario.debtPayments)}</td></tr>
              <tr><td>Ahorro</td><td class="num">${f(result.base.saving)}</td><td class="num">${f(result.scenario.saving)}</td></tr>
              <tr><td><strong>Saldo libre del mes</strong></td><td class="num"><strong>${f(result.base.free)}</strong></td><td class="num"><strong class="${Number(result.scenario.free) < 0 ? 'neg' : ''}">${f(result.scenario.free)}</strong></td></tr>
              <tr><td>Tasa de ahorro</td><td class="num">${result.base.savingsRate ? money.formatPercent(result.base.savingsRate, 1) : '—'}</td><td class="num">${result.scenario.savingsRate ? money.formatPercent(result.scenario.savingsRate, 1) : '—'}</td></tr>
              <tr><td>Meses de egresos cubiertos en 12 meses</td><td class="num">${result.base.reserveMonths12 ? money.formatNumber(result.base.reserveMonths12, cur, 1) : '—'}</td><td class="num">${result.scenario.reserveMonths12 ? money.formatNumber(result.scenario.reserveMonths12, cur, 1) : '—'}</td></tr>
              <tr><td>Sin deudas en</td><td>${m(result.base.debtMonths, result.base.debtUnresolved)}</td><td>${m(result.scenario.debtMonths, result.scenario.debtUnresolved)}</td></tr>
              <tr><td>Intereses totales</td><td class="num">${f(result.base.debtInterest)}</td><td class="num">${f(result.scenario.debtInterest)}</td></tr>
            </tbody>
          </table>
          ${result.scenario.debtIncomplete.length ? html`<p class="small muted">Simulación incompleta para ${result.scenario.debtIncomplete.join(', ')}: falta la tasa.</p>` : ''}
          ${result.assumptions.map((a) => html`<p class="small muted">${c.src('supuesto')} ${a}</p>`)}
          ${Number(result.scenario.free) < 0 ? html`<div class="note note--warn"><strong>Este escenario deja tu saldo libre en negativo.</strong> Necesitarías reducir gastos o el aporte para sostenerlo.</div>` : ''}
          <form method="post" action="/calculadora/simulador/guardar" class="section" novalidate>
            ${c.csrfField(ctx)}
            ${Object.entries(result.inputs).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}" />`)}
            <div class="pair">
              ${c.textField({ name: 'name', label: 'Nombre del escenario', value: '', maxlength: 80 })}
              <div class="actions"><button class="btn btn-secondary" type="submit">Guardar este escenario</button></div>
            </div>
          </form>
        </section>`
      : ''}
    ${saved.length
      ? html`<section class="section" aria-labelledby="h-guardados"><h2 id="h-guardados">Escenarios guardados</h2>
          <table class="data stack-sm"><thead><tr><th>Nombre</th><th>Fecha</th><th class="r">Saldo libre</th><th>Sin deudas en</th></tr></thead><tbody>
          ${saved.map((s) => {
            const r = JSON.parse(s.results_json);
            return html`<tr><td data-label="Nombre">${s.name}</td><td data-label="Fecha">${c.dateEs(s.created_at)}</td><td data-label="Saldo libre" class="r">${f(r.scenario.free)}</td><td data-label="Sin deudas en">${m(r.scenario.debtMonths, r.scenario.debtUnresolved)}</td></tr>`;
          })}
          </tbody></table></section>`
      : ''}`);
}

router.get('/calculadora/simulador', guard, (req, res) => simulatorView(res, req.user.id, {}));

router.post('/calculadora/simulador', guard, (req, res) => {
  const p = tracker.parseSimInputs(req.user.id, req.body);
  if (!p.ok) {
    res.status(422);
    return simulatorView(res, req.user.id, { form: req.body, errors: p.errors });
  }
  simulatorView(res, req.user.id, { form: req.body, result: tracker.simulate(req.user.id, p.value) });
});

router.post('/calculadora/simulador/guardar', guard, (req, res) => {
  const p = tracker.parseSimInputs(req.user.id, req.body);
  if (!p.ok) return res.redirect(303, '/calculadora/simulador');
  tracker.saveScenario(req.user.id, req.body.name, p.value);
  res.redirect(303, '/calculadora/simulador?aviso=escenario_guardado');
});

module.exports = router;
