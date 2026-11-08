'use strict';
// F10 Calculadora financiera: movimientos (valores reales), presupuesto mensual
// (valores previstos), deudas con saldos, metas y simulación de escenarios.
// Los totales siempre se recalculan desde los registros: editar o borrar no duplica.
const db = require('../db');
const money = require('../lib/money');
const calc = require('./calc');

const { D } = money;
const ZERO = new D(0);

const KINDS = {
  ingreso: 'Ingreso',
  gasto: 'Gasto',
  pago_deuda: 'Pago de deuda',
  ahorro: 'Aporte a ahorro',
  retiro_ahorro: 'Retiro de ahorro',
  transferencia: 'Transferencia entre ahorros propios',
};

const CATEGORIES = {
  ingreso: { sueldo: 'Sueldo', independiente: 'Trabajo independiente', negocio: 'Negocio', renta: 'Rentas', extra: 'Ingreso extra', otros: 'Otros ingresos' },
  gasto: {
    vivienda: 'Vivienda',
    alimentacion: 'Alimentación',
    transporte: 'Transporte',
    servicios: 'Servicios',
    salud: 'Salud',
    educacion: 'Educación y cuidados',
    ocio: 'Ocio y suscripciones',
    otros: 'Otros gastos',
  },
  pago_deuda: { cuota: 'Cuota', extra: 'Pago extra' },
  ahorro: { reserva: 'Reserva', meta: 'Meta', otros: 'Otro ahorro' },
  retiro_ahorro: { emergencia: 'Emergencia', meta: 'Uso para una meta', otros: 'Otro retiro' },
  transferencia: { entre_ahorros: 'Entre ahorros propios' },
};

const BUDGET_KINDS = ['ingreso', 'gasto', 'pago_deuda', 'ahorro'];

function monthOf(date) {
  return String(date).slice(0, 7);
}
function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}
function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}
function validMonth(v) {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null;
}
function validDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

function baseCurrency(userId) {
  return db.value('SELECT base_currency FROM users WHERE id = ?', userId) || 'USD';
}

// ───────── Movimientos ─────────

function validateMovement(userId, body) {
  const errors = {};
  const currency = baseCurrency(userId);
  const kind = body.kind;
  if (!KINDS[kind]) errors.kind = 'Elige el tipo de movimiento.';
  const category = body.category;
  if (KINDS[kind] && !CATEGORIES[kind][category]) errors.category = 'Elige una categoría.';
  const date = validDate(body.date);
  if (!date) errors.date = 'Escribe una fecha válida.';
  else if (Date.parse(date) > Date.now() + 366 * 86400000) errors.date = 'La fecha no puede ser de dentro de más de un año.';
  const amount = money.parseAmount(body.amount, currency);
  if (amount.empty) errors.amount = 'Escribe el importe.';
  else if (!amount.ok) errors.amount = amount.error;
  else if (new D(amount.value).lte(0)) errors.amount = 'El importe debe ser mayor que 0.';
  if (body.currency && body.currency !== currency) errors.currency = `Tu cuenta usa ${currency}. No hacemos conversiones entre monedas: registra el importe ya convertido.`;
  const note = String(body.note || '').trim().slice(0, 140) || null;
  const owned = (table, id) => (id ? db.value(`SELECT id FROM ${table} WHERE id = ? AND user_id = ?`, Number(id), userId) : null);
  let debtId = null;
  let goalId = null;
  let toGoalId = null;
  if (kind === 'pago_deuda' && body.debt_id) {
    debtId = owned('debts', body.debt_id);
    if (!debtId) errors.debt_id = 'Elige una de tus deudas.';
  }
  if (['ahorro', 'retiro_ahorro', 'transferencia'].includes(kind) && body.goal_id) {
    goalId = owned('goals', body.goal_id);
    if (!goalId) errors.goal_id = 'Elige una de tus metas.';
  }
  if (kind === 'transferencia') {
    toGoalId = owned('goals', body.to_goal_id);
    if (!goalId) errors.goal_id = 'Elige de qué ahorro sale.';
    if (!toGoalId) errors.to_goal_id = 'Elige a qué ahorro va.';
    if (goalId && goalId === toGoalId) errors.to_goal_id = 'El origen y el destino deben ser distintos.';
  }
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { kind, category, date, amount: amount.value, currency, note, debtId, goalId, toGoalId } : null };
}

function createMovement(userId, v, source = 'usuario') {
  const r = db.run(
    `INSERT INTO movements (user_id, date, kind, category, amount, currency, note, debt_id, goal_id, to_goal_id, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    v.date,
    v.kind,
    v.category,
    v.amount,
    v.currency,
    v.note,
    v.debtId,
    v.goalId,
    v.toGoalId,
    source,
    db.now(),
    db.now()
  );
  return r.lastId;
}

function updateMovement(userId, id, v) {
  return db.run(
    'UPDATE movements SET date = ?, kind = ?, category = ?, amount = ?, currency = ?, note = ?, debt_id = ?, goal_id = ?, to_goal_id = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    v.date,
    v.kind,
    v.category,
    v.amount,
    v.currency,
    v.note,
    v.debtId,
    v.goalId,
    v.toGoalId,
    db.now(),
    id,
    userId
  ).changes;
}

function deleteMovement(userId, id) {
  return db.run('DELETE FROM movements WHERE id = ? AND user_id = ?', id, userId).changes;
}

function getMovement(userId, id) {
  return db.one('SELECT * FROM movements WHERE id = ? AND user_id = ?', id, userId);
}

function listMovements(userId, month) {
  return db.all("SELECT * FROM movements WHERE user_id = ? AND substr(date, 1, 7) = ? ORDER BY date DESC, id DESC", userId, month);
}

/** Totales reales del mes. Las transferencias entre ahorros propios no cuentan. */
function monthSummary(userId, month = currentMonth()) {
  const rows = db.all("SELECT kind, category, amount FROM movements WHERE user_id = ? AND substr(date, 1, 7) = ? AND kind <> 'transferencia'", userId, month);
  const t = { ingreso: ZERO, gasto: ZERO, pago_deuda: ZERO, ahorro: ZERO, retiro_ahorro: ZERO };
  const byCategory = {};
  for (const r of rows) {
    t[r.kind] = t[r.kind].plus(r.amount);
    const key = `${r.kind}:${r.category}`;
    byCategory[key] = (byCategory[key] || ZERO).plus(r.amount);
  }
  const balance = t.ingreso.minus(t.gasto).minus(t.pago_deuda);
  const netSaving = t.ahorro.minus(t.retiro_ahorro);
  return { month, ...t, balance, netSaving, free: balance.minus(netSaving), byCategory, count: rows.length };
}

// ───────── Presupuesto (previsto) ─────────

function budget(userId, month) {
  return db.all('SELECT * FROM budget_lines WHERE user_id = ? AND month = ?', userId, month);
}

function budgetSummary(userId, month) {
  const lines = budget(userId, month);
  if (!lines.length) return null;
  const t = { ingreso: ZERO, gasto: ZERO, pago_deuda: ZERO, ahorro: ZERO };
  const byCategory = {};
  for (const l of lines) {
    t[l.kind] = t[l.kind].plus(l.amount);
    byCategory[`${l.kind}:${l.category}`] = new D(l.amount);
  }
  const balance = t.ingreso.minus(t.gasto).minus(t.pago_deuda);
  return { month, ...t, balance, free: balance.minus(t.ahorro), byCategory };
}

function budgetFields() {
  const out = [{ kind: 'ingreso', category: 'total', label: 'Ingresos del mes' }];
  for (const [k, l] of Object.entries(CATEGORIES.gasto)) out.push({ kind: 'gasto', category: k, label: l });
  out.push({ kind: 'pago_deuda', category: 'cuota', label: 'Cuotas y pagos de deuda' });
  out.push({ kind: 'ahorro', category: 'total', label: 'Ahorro previsto' });
  return out;
}

function saveBudget(userId, month, body) {
  const currency = baseCurrency(userId);
  const errors = {};
  const values = [];
  for (const f of budgetFields()) {
    const key = `${f.kind}.${f.category}`;
    const raw = body.b && body.b[f.kind] ? body.b[f.kind][f.category] : undefined;
    const p = money.parseAmount(raw, currency);
    if (p.empty) continue;
    if (!p.ok) errors[`b.${key}`] = p.error;
    else values.push({ ...f, amount: p.value });
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  db.tx(() => {
    db.run('DELETE FROM budget_lines WHERE user_id = ? AND month = ?', userId, month);
    for (const v of values) {
      db.run('INSERT INTO budget_lines (user_id, month, kind, category, amount, updated_at) VALUES (?, ?, ?, ?, ?, ?)', userId, month, v.kind, v.category, v.amount, db.now());
    }
  });
  return { ok: true };
}

function copyBudget(userId, from, to) {
  const lines = budget(userId, from);
  if (!lines.length) return 0;
  db.tx(() => {
    db.run('DELETE FROM budget_lines WHERE user_id = ? AND month = ?', userId, to);
    for (const l of lines) db.run('INSERT INTO budget_lines (user_id, month, kind, category, amount, updated_at) VALUES (?, ?, ?, ?, ?, ?)', userId, to, l.kind, l.category, l.amount, db.now());
  });
  return lines.length;
}

// ───────── Deudas ─────────

function debts(userId, { includePaid = false } = {}) {
  const rows = db.all(`SELECT * FROM debts WHERE user_id = ? ${includePaid ? '' : "AND status = 'activa'"} ORDER BY created_at`, userId);
  return rows.map((d) => {
    const last = db.one('SELECT balance, date FROM debt_balances WHERE debt_id = ? ORDER BY date DESC, id DESC LIMIT 1', d.id);
    const history = db.all('SELECT date, balance FROM debt_balances WHERE debt_id = ? ORDER BY date, id', d.id);
    return { ...d, balance: last ? last.balance : '0.00', balanceDate: last ? last.date : null, history };
  });
}

function validateDebt(userId, body) {
  const currency = baseCurrency(userId);
  const errors = {};
  const name = String(body.name || '').trim().slice(0, 60);
  if (!name) errors.name = 'Ponle un nombre.';
  const kinds = ['tarjeta', 'personal', 'auto', 'hipoteca', 'estudios', 'familiar', 'otra'];
  if (!kinds.includes(body.kind)) errors.kind = 'Elige el tipo.';
  const bal = money.parseAmount(body.balance, currency);
  if (!bal.ok) errors.balance = bal.empty ? 'Escribe el saldo.' : bal.error;
  const pay = money.parseAmount(body.payment, currency);
  if (!pay.ok) errors.payment = pay.empty ? 'Escribe la cuota mensual.' : pay.error;
  let rate = null;
  if (String(body.rate || '').trim()) {
    const r = String(body.rate).replace(',', '.').replace('%', '').trim();
    if (!/^\d+(\.\d+)?$/.test(r) || Number(r) > 500) errors.rate = 'Escribe una tasa válida, por ejemplo 36.';
    else rate = r;
  }
  const rateType = Object.keys(calc.RATE_TYPES).includes(body.rate_type) ? body.rate_type : null;
  if (!rateType) errors.rate_type = 'Elige el tipo de tasa o «No lo sé».';
  let fees = null;
  if (String(body.fees || '').trim()) {
    const fp = money.parseAmount(body.fees, currency);
    if (!fp.ok) errors.fees = fp.error;
    else fees = fp.value;
  }
  const ok = !Object.keys(errors).length;
  return { ok, errors, value: ok ? { name, kind: body.kind, balance: bal.value, payment: pay.value, rate, rateType, fees } : null };
}

function createDebt(userId, v) {
  return db.tx(() => {
    const r = db.run(
      "INSERT INTO debts (user_id, name, kind, rate, rate_type, payment, fees, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'activa', ?, ?)",
      userId,
      v.name,
      v.kind,
      v.rate,
      v.rateType,
      v.payment,
      v.fees,
      db.now(),
      db.now()
    );
    db.run('INSERT INTO debt_balances (debt_id, user_id, date, balance, note, created_at) VALUES (?, ?, ?, ?, ?, ?)', r.lastId, userId, new Date().toISOString().slice(0, 10), v.balance, 'Saldo inicial', db.now());
    return r.lastId;
  });
}

function updateDebtBalance(userId, debtId, { balance, date }) {
  const d = db.one('SELECT id FROM debts WHERE id = ? AND user_id = ?', debtId, userId);
  if (!d) return false;
  db.run('INSERT INTO debt_balances (debt_id, user_id, date, balance, note, created_at) VALUES (?, ?, ?, ?, ?, ?)', debtId, userId, date, balance, 'Saldo actualizado', db.now());
  db.run("UPDATE debts SET status = ?, updated_at = ? WHERE id = ?", new D(balance).lte(0) ? 'pagada' : 'activa', db.now(), debtId);
  return true;
}

function deleteDebt(userId, debtId) {
  return db.run('DELETE FROM debts WHERE id = ? AND user_id = ?', debtId, userId).changes;
}

// ───────── Metas ─────────

function goals(userId, { includeArchived = false } = {}) {
  const rows = db.all(`SELECT * FROM goals WHERE user_id = ? ${includeArchived ? '' : "AND status <> 'archivada'"} ORDER BY kind = 'reserva' DESC, created_at`, userId);
  const now = new Date();
  const months = [0, 1, 2].map((i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1 - i, 1)).toISOString().slice(0, 7));
  return rows.map((g) => {
    const flows = db.all('SELECT kind, amount, goal_id, to_goal_id, date FROM movements WHERE user_id = ? AND (goal_id = ? OR to_goal_id = ?)', userId, g.id, g.id);
    let saved = new D(g.initial_saved);
    const perMonth = {};
    for (const f of flows) {
      let delta = ZERO;
      if (f.kind === 'ahorro' && f.goal_id === g.id) delta = new D(f.amount);
      else if (f.kind === 'retiro_ahorro' && f.goal_id === g.id) delta = new D(f.amount).neg();
      else if (f.kind === 'transferencia' && f.goal_id === g.id) delta = new D(f.amount).neg();
      else if (f.kind === 'transferencia' && f.to_goal_id === g.id) delta = new D(f.amount);
      saved = saved.plus(delta);
      const m = monthOf(f.date);
      if (f.kind !== 'transferencia') perMonth[m] = (perMonth[m] || ZERO).plus(delta);
    }
    // Aporte mensual: promedio de los últimos tres meses completos.
    const monthly = months.reduce((a, m) => a.plus(perMonth[m] || ZERO), ZERO).div(3);
    const gp = calc.goalProgress({ target: g.target_amount, saved, monthly, desiredMonths: g.target_months });
    return { ...g, saved: money.str(saved), monthly: money.str(monthly), progress: gp };
  });
}

function validateGoal(userId, body) {
  const currency = baseCurrency(userId);
  const errors = {};
  const name = String(body.name || '').trim().slice(0, 60);
  if (!name) errors.name = 'Ponle un nombre.';
  const t = money.parseAmount(body.target, currency);
  if (!t.ok) errors.target = t.empty ? 'Escribe el objetivo.' : t.error;
  else if (new D(t.value).lte(0)) errors.target = 'El objetivo debe ser mayor que 0.';
  let saved = '0.00';
  if (String(body.saved || '').trim()) {
    const sv = money.parseAmount(body.saved, currency);
    if (!sv.ok) errors.saved = sv.error;
    else saved = sv.value;
  }
  let months = null;
  if (String(body.months || '').trim()) {
    if (!/^\d+$/.test(String(body.months).trim()) || Number(body.months) < 1 || Number(body.months) > 600) errors.months = 'Escribe un número de meses entre 1 y 600.';
    else months = Number(body.months);
  }
  const ok = !Object.keys(errors).length;
  return { ok, errors, value: ok ? { name, target: t.value, saved, months } : null };
}

function createGoal(userId, v, source = 'usuario') {
  return db.run(
    "INSERT INTO goals (user_id, name, kind, target_amount, initial_saved, target_months, status, source, created_at, updated_at) VALUES (?, ?, 'meta', ?, ?, ?, 'activa', ?, ?, ?)",
    userId,
    v.name,
    v.target,
    v.saved,
    v.months,
    source,
    db.now(),
    db.now()
  ).lastId;
}

function updateGoal(userId, goalId, { target, months }) {
  return db.run('UPDATE goals SET target_amount = COALESCE(?, target_amount), target_months = ?, updated_at = ? WHERE id = ? AND user_id = ?', target, months, db.now(), goalId, userId).changes;
}

function archiveGoal(userId, goalId) {
  return db.run("UPDATE goals SET status = 'archivada', updated_at = ? WHERE id = ? AND user_id = ?", db.now(), goalId, userId).changes;
}

// ───────── Simulación (no altera datos reales) ─────────

/** Escenario actual: presupuesto del mes si existe; si no, el último diagnóstico. */
function baseScenario(userId) {
  const month = currentMonth();
  const b = budgetSummary(userId, month);
  const diagRow = db.one('SELECT result_json FROM diagnoses WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', userId);
  const diag = diagRow ? JSON.parse(diagRow.result_json) : null;
  let base;
  if (b) {
    base = { source: 'presupuesto', income: b.ingreso, expenses: b.gasto, debtPayments: b.pago_deuda, saving: b.ahorro };
  } else if (diag) {
    base = {
      source: 'diagnostico',
      income: money.dec(diag.income.total) ?? ZERO,
      expenses: money.dec(diag.expenses.total) ?? ZERO,
      debtPayments: money.dec(diag.debtPayments) ?? ZERO,
      saving: money.dec(diag.saving) ?? ZERO,
    };
  } else {
    return null;
  }
  const tracked = debts(userId);
  base.debts = tracked.length
    ? tracked.map((d) => ({ name: d.name, balance: d.balance, payment: d.payment, rate: d.rate, rateType: d.rate_type, fees: d.fees }))
    : (diag ? diag.debts : []).map((d) => ({ name: d.name, balance: d.balance, payment: d.payment, rate: d.rate, rateType: d.rateType, fees: d.fees }));
  const reserve = goals(userId).find((g) => g.kind === 'reserva');
  base.savingsAvailable = reserve ? new D(reserve.saved) : diag && diag.reserve.available ? new D(diag.reserve.available) : ZERO;
  base.goals = goals(userId).filter((g) => g.kind === 'meta').map((g) => ({ name: g.name, target: g.target_amount, saved: g.saved }));
  base.currency = baseCurrency(userId);
  return base;
}

function parseSimInputs(userId, body) {
  const currency = baseCurrency(userId);
  const errors = {};
  const out = {};
  const fields = {
    ahorro_extra: { neg: true, label: 'Cambio en tu ahorro mensual' },
    cambio_gasto: { neg: true, label: 'Cambio en tus gastos' },
    pago_extra_deuda: { neg: false, label: 'Pago extra a deudas' },
    ingreso_extra: { neg: false, label: 'Ingreso extra (supuesto)' },
  };
  for (const [k, f] of Object.entries(fields)) {
    const raw = body[k];
    if (raw === undefined || String(raw).trim() === '') {
      out[k] = '0.00';
      continue;
    }
    const p = money.parseAmount(raw, currency, { allowNegative: f.neg });
    if (!p.ok) errors[k] = p.error;
    else out[k] = p.value;
  }
  return { ok: !Object.keys(errors).length, errors, value: out };
}

function evaluate(sc, extraDebt = ZERO) {
  const free = sc.income.minus(sc.expenses).minus(sc.debtPayments).minus(sc.saving);
  const rate = calc.savingsRate(sc.saving, sc.income);
  const proj = sc.debts.length ? calc.projectDebts(sc.debts, { extra: extraDebt }) : null;
  const outflow = sc.expenses.plus(sc.debtPayments);
  const reserveIn12 = sc.savingsAvailable.plus(D.max(sc.saving, ZERO).times(12));
  const goalsOut = sc.goals.map((g) => {
    const share = sc.goals.length ? D.max(sc.saving, ZERO).div(sc.goals.length + 1) : ZERO;
    const gp = calc.goalProgress({ target: g.target, saved: g.saved, monthly: share });
    return { name: g.name, months: gp.months, reachable: gp.reachable, monthly: money.str(share) };
  });
  return {
    income: money.str(sc.income),
    expenses: money.str(sc.expenses),
    debtPayments: money.str(sc.debtPayments),
    saving: money.str(sc.saving),
    free: money.str(free),
    savingsRate: rate.value === null ? null : rate.value.toFixed(4),
    reserveMonths12: outflow.gt(0) ? reserveIn12.div(outflow).toFixed(2) : null,
    debtMonths: proj ? proj.months : null,
    debtInterest: proj ? money.str(proj.totalInterest) : null,
    debtIncomplete: proj ? proj.incomplete : [],
    debtUnresolved: proj ? proj.unresolved : [],
    goals: goalsOut,
  };
}

/**
 * Compara el escenario actual con uno modificado. El pago extra a deuda se cuenta
 * una sola vez: sube los pagos de deuda del mes y se aplica al capital en la proyección.
 */
function simulate(userId, inputs) {
  const base = baseScenario(userId);
  if (!base) return null;
  const i = { ahorro_extra: new D(inputs.ahorro_extra || 0), cambio_gasto: new D(inputs.cambio_gasto || 0), pago_extra_deuda: new D(inputs.pago_extra_deuda || 0), ingreso_extra: new D(inputs.ingreso_extra || 0) };
  const scen = {
    ...base,
    income: base.income.plus(i.ingreso_extra),
    expenses: D.max(base.expenses.plus(i.cambio_gasto), ZERO),
    debtPayments: base.debtPayments.plus(i.pago_extra_deuda),
    saving: base.saving.plus(i.ahorro_extra),
  };
  return {
    source: base.source,
    currency: base.currency,
    inputs: Object.fromEntries(Object.entries(i).map(([k, v]) => [k, v.toFixed(2)])),
    base: evaluate(base),
    scenario: evaluate(scen, i.pago_extra_deuda),
    assumptions: i.ingreso_extra.gt(0) ? ['El ingreso extra es una estimación, no un ingreso garantizado.'] : [],
  };
}

function saveScenario(userId, name, inputs) {
  const result = simulate(userId, inputs);
  if (!result) return null;
  return db.run(
    'INSERT INTO scenarios (user_id, name, base_source, inputs_json, results_json, calc_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    userId,
    String(name || '').trim().slice(0, 80) || 'Escenario',
    result.source,
    JSON.stringify(result.inputs),
    JSON.stringify({ base: result.base, scenario: result.scenario }),
    calc.CALC_VERSION,
    db.now()
  ).lastId;
}

/** Fecha del último cambio de datos de seguimiento (para ofrecer recalcular). */
function lastDataChange(userId) {
  return db.value(
    "SELECT MAX(t) FROM (SELECT MAX(updated_at) AS t FROM movements WHERE user_id = ? UNION ALL SELECT MAX(created_at) FROM debt_balances WHERE user_id = ? AND note <> 'Saldo de la evaluación profunda' UNION ALL SELECT MAX(updated_at) FROM goals WHERE user_id = ? AND source <> 'plan')",
    userId,
    userId,
    userId
  );
}

module.exports = {
  KINDS,
  CATEGORIES,
  BUDGET_KINDS,
  currentMonth,
  prevMonth,
  validMonth,
  validDate,
  baseCurrency,
  validateMovement,
  createMovement,
  updateMovement,
  deleteMovement,
  getMovement,
  listMovements,
  monthSummary,
  budget,
  budgetSummary,
  budgetFields,
  saveBudget,
  copyBudget,
  debts,
  validateDebt,
  createDebt,
  updateDebtBalance,
  deleteDebt,
  goals,
  validateGoal,
  createGoal,
  updateGoal,
  archiveGoal,
  baseScenario,
  parseSimInputs,
  simulate,
  saveScenario,
  lastDataChange,
};
