'use strict';
// Métricas del test gratuito V4. Reutiliza las fórmulas de metrics3 (mismo cálculo con
// decimal.js) adaptando las respuestas V4: reserva en Q13 y deudas en Q10/Q11.
// Reglas del documento de correcciones §6:
//   · «No tengo deudas» en Q10 o en Q11 → cuotas en 0.
//   · «Sí, pero este mes no tengo pagos» → cuota del mes en 0 (la deuda existe).
//   · «No lo sé» se conserva como desconocido: nunca cero.
//   · Con rangos, el saldo se presenta como intervalo (balance_range), no como un número.
const D = require('decimal.js');
const metrics3 = require('./metrics3');

const VERSION = 'METRICS_FREE_V4_ES';
const val = (a) => (a && a.status === 'answered' ? a.value : null);

/** Respuestas V4 → forma que esperan las fórmulas de metrics3. */
function adapt(answers, currency) {
  const q10 = val(answers.Q10);
  const q11 = val(answers.Q11);
  let debt = answers.Q10 && answers.Q10.status !== 'answered' ? { status: answers.Q10.status, value: null } : null;
  if (q11 && q11.codes.includes('NONE')) debt = { status: 'answered', value: { presence: 'NO' } };
  else if (q10 && q10.status === 'NO') debt = { status: 'answered', value: { presence: 'NO' } };
  else if (q10 && q10.status === 'DUE') debt = { status: 'answered', value: { presence: 'YES', monthly_due: q10.monthly_due } };
  else if (q10 && q10.status === 'NO_DUE') debt = { status: 'answered', value: { presence: 'YES', monthly_due: { amount: '0.00', min: null, max: null, currency, period: 'MONTH', precision: 'exact' } } };
  return { Q06: answers.Q06, Q08: answers.Q08, Q09: answers.Q09, Q10: debt, Q14: answers.Q13 };
}

/** Intervalo del saldo cuando algún monto es un rango: [mínimo, máximo]. */
function balanceRange(answers, currency) {
  const bounds = (a) => {
    const v = val(a);
    if (!v || v.currency !== currency) return null;
    if (v.amount !== null && v.amount !== undefined) return [new D(v.amount), new D(v.amount)];
    return [new D(v.min), new D(v.max)];
  };
  const inc = bounds(answers.Q06);
  const ess = bounds(answers.Q08);
  const oth = bounds(answers.Q09);
  const ad = adapt(answers, currency).Q10;
  let due = null;
  if (ad && ad.status === 'answered') due = ad.value.presence === 'NO' ? [new D(0), new D(0)] : bounds({ status: 'answered', value: ad.value.monthly_due });
  if (!inc || !ess || !oth || !due) return null;
  const anyRange = [answers.Q06, answers.Q08, answers.Q09].some((a) => val(a).amount === null) || due[0].toString() !== due[1].toString();
  if (!anyRange) return null;
  return { min: inc[0].minus(ess[1]).minus(oth[1]).minus(due[1]).toFixed(2), max: inc[1].minus(ess[0]).minus(oth[0]).minus(due[0]).toFixed(2) };
}

function compute(answers, currency) {
  const m = metrics3.compute(adapt(answers, currency), currency);
  return { version: VERSION, currency, metrics: m.metrics, balance_range: balanceRange(answers, currency) };
}

function authorizedNumbers(answers, metrics, extra = []) {
  const set = metrics3.authorizedNumbers(answers, metrics);
  for (const x of extra) if (x !== null && x !== undefined) metrics3.authorizedNumbers({ x: { status: 'answered', value: String(x) } }, []).forEach((n) => set.add(n));
  return set;
}

module.exports = { VERSION, compute, adapt, balanceRange, authorizedNumbers };
