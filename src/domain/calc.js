'use strict';
// Motor de cálculo (servidor). Funciones puras y reproducibles: la IA nunca
// calcula cifras, solo explica estos resultados. Ver docs/CALCULOS.md.
const { D, dec } = require('../lib/money');

const CALC_VERSION = '1.0.0';
const MAX_MONTHS = 600; // horizonte máximo de proyección: 50 años

// Factores para normalizar a periodicidad mensual.
const PERIODS = {
  semanal: { label: 'Semanal', factor: new D(52).div(12) },
  quincenal: { label: 'Quincenal (dos veces al mes)', factor: new D(2) },
  catorcenal: { label: 'Cada 14 días', factor: new D(26).div(12) },
  mensual: { label: 'Mensual', factor: new D(1) },
  bimestral: { label: 'Cada 2 meses', factor: new D(1).div(2) },
  trimestral: { label: 'Trimestral', factor: new D(1).div(3) },
  semestral: { label: 'Semestral', factor: new D(1).div(6) },
  anual: { label: 'Anual', factor: new D(1).div(12) },
};

const RATE_TYPES = {
  nominal_anual: 'Nominal anual',
  efectiva_anual: 'Efectiva anual',
  mensual: 'Mensual',
  desconocido: 'No lo sé',
};

const r2 = (d) => d.toDecimalPlaces(2, D.ROUND_HALF_UP);

/** Convierte un importe periódico a mensual. Devuelve null si falta el dato. */
function toMonthly(amount, period = 'mensual') {
  const a = dec(amount);
  if (a === null) return null;
  const p = PERIODS[period];
  if (!p) throw new Error(`Periodicidad desconocida: ${period}`);
  return a.times(p.factor);
}

/**
 * Saldo disponible = ingresos netos − gastos − pagos de deuda.
 * Si falta cualquier componente, no se calcula (no se asume cero).
 */
function availableBalance({ income, expenses, debtPayments }) {
  const missing = [];
  if (dec(income) === null) missing.push('ingresos');
  if (dec(expenses) === null) missing.push('gastos');
  if (dec(debtPayments) === null) missing.push('pagos de deuda');
  if (missing.length) return { value: null, missing };
  return { value: dec(income).minus(dec(expenses)).minus(dec(debtPayments)), missing: [] };
}

/** Tasa de ahorro = ahorro mensual ÷ ingresos netos, solo si los ingresos son mayores que cero. */
function savingsRate(saving, income) {
  const s = dec(saving);
  const i = dec(income);
  if (s === null || i === null) return { value: null, reason: 'dato_desconocido' };
  if (i.lte(0)) return { value: null, reason: 'ingresos_cero' };
  return { value: s.div(i), reason: null };
}

/**
 * Meta: avance = ahorro asignado ÷ objetivo; plazo = monto pendiente ÷ aporte mensual.
 * Con aporte cero o negativo no existe un plazo alcanzable con esos datos.
 */
function goalProgress({ target, saved, monthly, desiredMonths = null }) {
  const t = dec(target);
  const s = dec(saved) ?? new D(0);
  const m = dec(monthly);
  if (t === null || t.lte(0)) return { valid: false, reason: 'objetivo_invalido' };
  const pending = D.max(t.minus(s), 0);
  const progress = D.min(s.div(t), 1);
  const out = { valid: true, target: t, saved: s, pending, progress, monthly: m, months: null, reachable: null, reason: null, needed: null };
  if (pending.isZero()) {
    out.months = 0;
    out.reachable = true;
    out.reason = 'meta_cumplida';
  } else if (m === null) {
    out.reachable = null;
    out.reason = 'aporte_desconocido';
  } else if (m.lte(0)) {
    out.reachable = false;
    out.reason = 'sin_aporte';
  } else {
    out.monthsExact = pending.div(m);
    out.months = out.monthsExact.ceil().toNumber();
    out.reachable = out.months <= MAX_MONTHS;
    if (!out.reachable) out.reason = 'plazo_excesivo';
  }
  if (desiredMonths && Number(desiredMonths) > 0) {
    out.desiredMonths = Number(desiredMonths);
    out.needed = pending.div(desiredMonths);
    out.onTrack = m !== null && m.gte(out.needed);
  }
  return out;
}

/**
 * Tasa mensual a partir del tipo de tasa:
 *  - nominal anual (mensualizable): tasa ÷ 12
 *  - efectiva anual: (1 + tasa)^(1/12) − 1
 *  - mensual: tasa
 *  - desconocido: null (simulación incompleta)
 * `ratePercent` en porcentaje (24 = 24 %).
 */
function monthlyRate(ratePercent, rateType) {
  const r = dec(ratePercent);
  if (r === null || !rateType || rateType === 'desconocido') return null;
  const annual = r.div(100);
  if (rateType === 'nominal_anual') return annual.div(12);
  if (rateType === 'efectiva_anual') return annual.plus(1).pow(new D(1).div(12)).minus(1);
  if (rateType === 'mensual') return annual;
  throw new Error(`Tipo de tasa desconocido: ${rateType}`);
}

/** Tasa efectiva anual equivalente a una tasa mensual (para comparar deudas). */
function effectiveAnnual(monthly) {
  if (monthly === null) return null;
  return monthly.plus(1).pow(12).minus(1);
}

/**
 * Proyección de una deuda por periodos mensuales.
 * Interés del periodo = saldo × tasa mensual, redondeado a centavos (ROUND_HALF_UP).
 * Comisiones y seguros solo se suman si se conocen.
 * Si el pago no cubre interés + cargos, se alerta y no se devuelve fecha de cancelación.
 */
function projectDebt({ balance, payment, ratePercent, rateType, fees = null, extra = 0, maxMonths = MAX_MONTHS }) {
  const b0 = dec(balance);
  const pay = dec(payment);
  const ex = dec(extra) ?? new D(0);
  const f = dec(fees) ?? new D(0);
  const i = monthlyRate(ratePercent, rateType);
  const base = { balance: b0, payment: pay, monthlyRate: i, feesKnown: dec(fees) !== null };
  if (b0 === null || pay === null) return { ...base, status: 'datos_incompletos', complete: false, reason: 'saldo_o_pago_desconocido' };
  if (b0.lte(0)) return { ...base, status: 'pagada', complete: true, months: 0, totalInterest: new D(0), schedule: [] };
  if (i === null) return { ...base, status: 'tasa_desconocida', complete: false, reason: 'tasa_desconocida' };
  const totalPay = pay.plus(ex);
  const firstInterest = r2(b0.times(i));
  if (totalPay.lte(firstInterest.plus(f))) {
    return {
      ...base,
      status: 'pago_no_cubre_interes',
      complete: true,
      alert: true,
      firstInterest,
      fees: f,
      shortfall: firstInterest.plus(f).minus(totalPay),
      months: null,
    };
  }
  let bal = b0;
  let totalInterest = new D(0);
  let totalFees = new D(0);
  let totalPaid = new D(0);
  const schedule = [];
  let month = 0;
  while (bal.gt(0) && month < maxMonths) {
    month++;
    const interest = r2(bal.times(i));
    const owed = bal.plus(interest).plus(f);
    const paid = D.min(totalPay, owed);
    const principal = paid.minus(interest).minus(f);
    bal = r2(bal.minus(principal));
    if (bal.lt(0)) bal = new D(0);
    totalInterest = totalInterest.plus(interest);
    totalFees = totalFees.plus(f);
    totalPaid = totalPaid.plus(paid);
    schedule.push({ month, interest, fees: f, payment: paid, principal, balance: bal });
  }
  if (bal.gt(0)) {
    return { ...base, status: 'plazo_excesivo', complete: true, months: null, totalInterest, schedule: schedule.slice(0, 24) };
  }
  return { ...base, status: 'proyectada', complete: true, months: month, totalInterest, totalFees, totalPaid, schedule };
}

/**
 * Proyección de varias deudas con pago extra dirigido (método avalancha: primero la
 * de mayor tasa mensual conocida). Las deudas sin tasa conocida no reciben el extra
 * y se marcan como incompletas. Al liquidar una deuda, su cuota pasa a la siguiente.
 */
function projectDebts(debts, { extra = 0, maxMonths = MAX_MONTHS } = {}) {
  const ex = dec(extra) ?? new D(0);
  const items = debts.map((d, idx) => {
    const i = monthlyRate(d.rate, d.rateType);
    return {
      idx,
      name: d.name,
      balance: dec(d.balance),
      payment: dec(d.payment),
      fees: dec(d.fees) ?? new D(0),
      rate: i,
      known: i !== null && dec(d.balance) !== null && dec(d.payment) !== null,
      paidOffMonth: null,
      totalInterest: new D(0),
    };
  });
  const known = items.filter((it) => it.known && it.balance.gt(0));
  const incomplete = items.filter((it) => !it.known);
  const alerts = [];
  for (const it of known) {
    const first = r2(it.balance.times(it.rate)).plus(it.fees);
    if (it.payment.lte(first) && ex.isZero()) alerts.push({ name: it.name, code: 'pago_no_cubre_interes' });
  }
  const order = [...known].sort((a, b) => b.rate.comparedTo(a.rate) || a.balance.comparedTo(b.balance));
  let month = 0;
  let freed = new D(0);
  const timeline = [];
  while (order.some((it) => it.balance.gt(0)) && month < maxMonths) {
    month++;
    let pool = ex.plus(freed);
    for (const it of order) {
      if (it.balance.lte(0)) continue;
      const interest = r2(it.balance.times(it.rate));
      it.totalInterest = it.totalInterest.plus(interest);
      const owed = it.balance.plus(interest).plus(it.fees);
      let pay = D.min(it.payment, owed);
      it.balance = r2(it.balance.plus(interest).plus(it.fees).minus(pay));
      if (it.balance.lt(0)) it.balance = new D(0);
      void pay;
    }
    // El extra (y las cuotas liberadas) van a la deuda prioritaria que siga abierta.
    for (const it of order) {
      if (pool.lte(0)) break;
      if (it.balance.lte(0)) continue;
      const use = D.min(pool, it.balance);
      it.balance = r2(it.balance.minus(use));
      pool = pool.minus(use);
    }
    for (const it of order) {
      if (it.balance.lte(0) && it.paidOffMonth === null) {
        it.paidOffMonth = month;
        freed = freed.plus(it.payment);
      }
    }
    const total = order.reduce((a, it) => a.plus(it.balance), new D(0));
    timeline.push({ month, total });
  }
  const unresolved = order.filter((it) => it.balance.gt(0));
  return {
    months: unresolved.length ? null : month,
    alerts,
    incomplete: incomplete.map((it) => it.name),
    perDebt: items.map((it) => ({
      name: it.name,
      known: it.known,
      paidOffMonth: it.paidOffMonth,
      totalInterest: it.totalInterest,
    })),
    totalInterest: order.reduce((a, it) => a.plus(it.totalInterest), new D(0)),
    timeline,
    unresolved: unresolved.map((it) => it.name),
  };
}

/** Meses de gastos que cubre el ahorro disponible. */
function reserveMonths(savings, monthlyOutflow) {
  const s = dec(savings);
  const o = dec(monthlyOutflow);
  if (s === null || o === null) return null;
  if (o.lte(0)) return null;
  return s.div(o);
}

function ratio(a, b) {
  const x = dec(a);
  const y = dec(b);
  if (x === null || y === null || y.lte(0)) return null;
  return x.div(y);
}

module.exports = {
  CALC_VERSION,
  MAX_MONTHS,
  PERIODS,
  RATE_TYPES,
  toMonthly,
  availableBalance,
  savingsRate,
  goalProgress,
  monthlyRate,
  effectiveAnnual,
  projectDebt,
  projectDebts,
  reserveMonths,
  ratio,
  r2,
};
