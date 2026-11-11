'use strict';
// Métricas autorizadas del test gratuito V3 (documento 07 §4). Las calcula SOLO el
// servidor con decimal.js; la IA nunca recalcula. Si falta un operando, hay un rango,
// mezcla de monedas o contradicción, value = null con el motivo. Desconocido ≠ cero.
// Con estas 25 preguntas no se calcula patrimonio neto, ahorro efectivo, rendimiento
// ni amortización.
const D = require('decimal.js');

const VERSION = 'METRICS_FREE_V3_ES';

/** Lector de montos: devuelve { value: Decimal|null, reason }. */
function reader(answers, currency) {
  const a = (s) => answers[s] || null;
  const point = (m, src) => {
    if (!m) return { value: null, reason: `${src}_MISSING` };
    if (m.currency !== currency) return { value: null, reason: 'CURRENCY_MISMATCH' };
    if (m.amount === null) return { value: null, reason: `${src}_RANGE` };
    return { value: new D(m.amount), reason: null, approximate: m.precision !== 'exact' };
  };
  const money = (s) => {
    const x = a(s);
    if (!x) return { value: null, reason: `${s}_NOT_ANSWERED` };
    if (x.status !== 'answered') return { value: null, reason: `${s}_UNKNOWN` };
    return point(x.value, s);
  };
  /** Cuota del mes: cero SOLO si Q10 y Q11 declaran, de forma coherente, que no hay deudas. */
  const debtDue = () => {
    const q10 = a('Q10');
    const q11 = a('Q11');
    if (!q10 || q10.status !== 'answered') return { value: null, reason: 'Q10_UNKNOWN' };
    const p10 = q10.value.presence;
    const p11 = q11 && q11.status === 'answered' ? q11.value.presence : null;
    if (p10 === 'NO') {
      if (p11 === 'NO') return { value: new D(0), reason: null, explicitZero: true };
      if (p11 === 'YES') return { value: null, reason: 'DEBT_CONTRADICTION' };
      return { value: null, reason: 'Q11_UNKNOWN' };
    }
    if (p10 !== 'YES') return { value: null, reason: 'Q10_UNSURE' };
    return point(q10.value.monthly_due, 'Q10');
  };
  return { money, debtDue };
}

/**
 * Calcula las métricas de una sesión V3.
 * @returns {{ version, currency, metrics: [{id, label, value, unit, formula, operands, approximate, reason}] }}
 */
function compute(answers, currency) {
  const r = reader(answers, currency);
  const income = r.money('Q06');
  const essential = r.money('Q08');
  const other = r.money('Q09');
  const due = r.debtDue();
  const cash = r.money('Q14');
  const out = [];
  const approx = (...xs) => xs.some((x) => x.approximate);
  const add = (id, label, unit, formula, operands, fn) => {
    const missing = operands.find(([, x]) => x.value === null);
    let value = null;
    let reason = missing ? missing[1].reason : null;
    if (!missing) {
      const res = fn(...operands.map(([, x]) => x.value));
      if (res && res.reason) reason = res.reason;
      else value = res;
    }
    out.push({
      id,
      label,
      unit,
      formula,
      operands: Object.fromEntries(operands.map(([k, x]) => [k, x.value === null ? null : x.value.toFixed(2)])),
      value: value === null ? null : unit === 'ratio' ? value.toDecimalPlaces(4, D.ROUND_HALF_UP).toString() : unit === 'months' ? value.toDecimalPlaces(2, D.ROUND_HALF_UP).toString() : value.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2),
      approximate: approx(...operands.map(([, x]) => x)),
      reason: value === null ? reason || 'MISSING' : null,
    });
  };

  add('outflow_month', 'Gastos y cuotas del mes', 'money', 'gastos básicos + otros gastos + cuotas de deuda', [['basicos', essential], ['otros', other], ['cuotas', due]], (e, o, d) => e.plus(o).plus(d));
  add('monthly_balance', 'Lo que queda al mes', 'money', 'ingreso neto − (gastos básicos + otros gastos + cuotas)', [['ingreso', income], ['basicos', essential], ['otros', other], ['cuotas', due]], (i, e, o, d) => i.minus(e).minus(o).minus(d));
  add('essential_gap', 'Margen sobre lo básico y las cuotas', 'money', 'ingreso neto − gastos básicos − cuotas (no es ahorro)', [['ingreso', income], ['basicos', essential], ['cuotas', due]], (i, e, d) => i.minus(e).minus(d));
  add('essential_reserve_months', 'Meses de gastos básicos cubiertos por tu reserva (sin cuotas)', 'months', 'reserva ÷ gastos básicos', [['reserva', cash], ['basicos', essential]], (c, e) => (e.gt(0) ? c.div(e) : { reason: 'ZERO_DENOMINATOR' }));
  add('committed_reserve_months', 'Meses de gastos básicos y cuotas cubiertos por tu reserva', 'months', 'reserva ÷ (gastos básicos + cuotas)', [['reserva', cash], ['basicos', essential], ['cuotas', due]], (c, e, d) => (e.plus(d).gt(0) ? c.div(e.plus(d)) : { reason: 'ZERO_DENOMINATOR' }));
  add('all_outflow_coverage', 'Parte de un mes de gastos y cuotas que cubre tu reserva', 'ratio', 'reserva ÷ (gastos básicos + otros + cuotas)', [['reserva', cash], ['basicos', essential], ['otros', other], ['cuotas', due]], (c, e, o, d) => (e.plus(o).plus(d).gt(0) ? c.div(e.plus(o).plus(d)) : { reason: 'ZERO_DENOMINATOR' }));

  // Brecha con el objetivo: solo si Q05 es un ingreso total mensual en la misma moneda.
  const goal = answers.Q05 && answers.Q05.status === 'answered' ? answers.Q05.value : null;
  if (goal && goal.amount && goal.target_kind === 'TOTAL_INCOME' && goal.currency === currency) {
    add('income_goal_gap', 'Distancia a tu ingreso objetivo', 'money', 'ingreso objetivo − ingreso neto actual', [['objetivo', { value: new D(goal.amount), reason: null }], ['ingreso', income]], (g, i) => g.minus(i));
  } else if (goal && goal.amount && goal.target_kind === 'ADDITIONAL_INCOME' && goal.currency === currency) {
    // Un objetivo «adicional» ya es el incremento: se guarda tal cual, sin restar otra vez.
    out.push({ id: 'income_goal_increment', label: 'Ingreso adicional que buscas al mes', unit: 'money', formula: 'objetivo declarado (incremento)', operands: { objetivo: new D(goal.amount).toFixed(2) }, value: new D(goal.amount).toFixed(2), approximate: true, reason: null });
  }
  return { version: VERSION, currency, metrics: out };
}

/** Números que la IA puede citar: montos declarados y métricas calculadas, en varias formas de escribirlos. */
function authorizedNumbers(answers, metrics) {
  const set = new Set();
  const addNum = (x) => {
    if (x === null || x === undefined || x === '') return;
    const d = new D(x);
    const forms = [d.toFixed(2), d.toFixed(0), d.toString(), d.abs().toFixed(2), d.abs().toFixed(0), d.abs().toString()];
    for (const f of forms) {
      set.add(f);
      set.add(Number(f).toLocaleString('es-BO'));
      set.add(Number(f).toLocaleString('en-US'));
      set.add(f.replace('.', ','));
    }
  };
  const walk = (v) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'number') addNum(v);
    else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) addNum(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const a of Object.values(answers)) if (a.status === 'answered') walk(a.value);
  for (const m of metrics) {
    addNum(m.value);
    if (m.unit === 'ratio' && m.value !== null) addNum(new D(m.value).times(100).toDecimalPlaces(1).toString());
    Object.values(m.operands || {}).forEach((x) => x !== null && addNum(x));
  }
  return set;
}

module.exports = { VERSION, compute, authorizedNumbers };
