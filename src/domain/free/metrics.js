'use strict';
// Cálculos opcionales del resultado, solo con cifras reales ya capturadas (adaptador
// de catálogos que piden ingresos y gastos exactos). El catálogo FREE_25_V2_ES no los
// pide: Q18, Q23 y Q25 son metas o presupuestos y jamás alimentan estos indicadores.
const { D } = require('../../lib/money');

// Factores de normalización a un mes. «diario» exige conocer los días pagados al mes.
const FACTORS = {
  monthly: new D(1),
  weekly: new D(52).div(12),
  every_14_days: new D(26).div(12),
  twice_monthly: new D(2),
  annual: new D(1).div(12),
};

/** Convierte un flujo { amount, period, days_per_month? } a un importe mensual. */
function toMonthly(flow) {
  if (!flow || flow.amount === undefined || flow.amount === null) return null;
  const amount = new D(flow.amount);
  if (flow.period === 'daily') {
    if (!flow.days_per_month || !(Number(flow.days_per_month) > 0)) return null;
    return { value: amount.mul(flow.days_per_month), factor: `× ${flow.days_per_month} días` };
  }
  const f = FACTORS[flow.period || 'monthly'];
  if (!f) return null;
  return { value: amount.mul(f), factor: `× ${f.toString()}` };
}

const FORMULAS = {
  balance: 'B = I − G − D (G sin deuda) · B = I − G (G ya incluye D)',
  margin: 'max(B, 0) / I × 100',
  reserve_months: 'A / GB',
  housing_pct: 'V / I × 100',
};

/**
 * input: { I, G, D, V, A, GB: { amount, currency, period?, days_per_month? },
 *          g_includes_debt: boolean|null, v_in_g: boolean }
 * Devuelve { metrics[], invalid_metrics[] }. Un indicador sin datos suficientes se
 * oculta y se informa por qué; nunca se divide por cero ni se mezclan monedas.
 */
function compute(input = {}) {
  const metrics = [];
  const invalid = [];
  const bad = (code, reason) => invalid.push({ code, reason, message: 'No pudimos calcularlo con los datos disponibles.' });
  const norm = {};
  for (const k of ['I', 'G', 'D', 'V']) if (input[k]) norm[k] = toMonthly(input[k]);
  const stock = (k) => (input[k] && input[k].amount !== undefined ? new D(input[k].amount) : null);
  const cur = (k) => (input[k] ? input[k].currency : null);
  const same = (...ks) => ks.every((k) => cur(k) === cur(ks[0]));
  const val = (k) => (norm[k] ? norm[k].value : null);
  const refs = (...ks) => ks.filter((k) => input[k]);

  // Saldo
  if (val('I') === null || val('G') === null) {
    bad('balance', 'MISSING_DATA');
  } else if (!same(...refs('I', 'G', 'D'))) {
    bad('balance', 'CURRENCY_MISMATCH');
  } else {
    const d = val('D');
    let balance = null;
    if (d !== null && d.isZero()) balance = val('I').minus(val('G'));
    else if (input.g_includes_debt === true) balance = val('I').minus(val('G'));
    else if (d === null) bad('balance', 'MISSING_DATA');
    else if (input.g_includes_debt === false) balance = val('I').minus(val('G')).minus(d);
    else bad('balance', 'AMBIGUOUS_SCOPE');
    if (balance !== null) {
      if (input.g_includes_debt === true && d !== null && val('G').lt(d)) bad('balance', 'INCONSISTENT_TOTALS');
      else metrics.push({ code: 'balance', value: balance.toFixed(2), currency: cur('I'), formula: FORMULAS.balance, input_refs: refs('I', 'G', 'D') });
    }
  }
  const bal = metrics.find((m) => m.code === 'balance');

  // Margen positivo sobre ingresos
  if (bal) {
    if (val('I').lte(0)) bad('margin', 'ZERO_INCOME');
    else metrics.push({ code: 'margin', label: 'Margen disponible estimado', value: D.max(new D(bal.value), 0).div(val('I')).mul(100).toFixed(1), currency: null, formula: FORMULAS.margin, input_refs: refs('I', 'G', 'D') });
  }

  // Meses de reserva: solo ahorro líquido personal conocido y gasto básico > 0.
  const A = stock('A');
  const GB = stock('GB');
  if (A !== null && GB !== null) {
    if (cur('A') !== cur('GB')) bad('reserve_months', 'CURRENCY_MISMATCH');
    else if (GB.lte(0)) bad('reserve_months', 'ZERO_EXPENSES');
    else metrics.push({ code: 'reserve_months', value: A.div(GB).toFixed(1), currency: null, formula: FORMULAS.reserve_months, input_refs: ['A', 'GB'] });
  }

  // Porcentaje de vivienda: V/I; si V forma parte de G debe cumplir V ≤ G. No se reinterpreta el decimal.
  if (val('V') !== null) {
    if (val('I') === null) bad('housing_pct', 'MISSING_DATA');
    else if (!same('V', 'I') || (input.v_in_g && input.G && cur('G') !== cur('V'))) bad('housing_pct', 'CURRENCY_MISMATCH');
    else if (val('I').lte(0)) bad('housing_pct', 'ZERO_INCOME');
    else if (input.v_in_g && val('G') !== null && val('V').gt(val('G'))) bad('housing_pct', 'INCONSISTENT_TOTALS');
    else metrics.push({ code: 'housing_pct', value: val('V').div(val('I')).mul(100).toFixed(1), currency: null, formula: FORMULAS.housing_pct, input_refs: refs('V', 'I', 'G') });
  }
  return { metrics, invalid_metrics: invalid };
}

module.exports = { compute, toMonthly };
