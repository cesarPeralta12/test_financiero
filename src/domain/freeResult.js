'use strict';
// Orientación preliminar del test gratuito. Reglas deterministas y versionadas:
// fortalezas, riesgos, prioridades, una o dos acciones iniciales y datos faltantes.
// No incluye proyecciones del plan completo.
const db = require('../db');
const calc = require('./calc');
const rulesRepo = require('./rules');
const money = require('../lib/money');

function v(map, code) {
  const a = map[code];
  if (!a || a.unknown || a.skipped) return null;
  return a.value;
}
function flow(map, code) {
  const val = v(map, code);
  return val ? calc.toMonthly(val.amount, val.period) : null;
}
const pct = (d) => money.formatPercent(d, 0);

function compute(map, rules) {
  const cur = v(map, 'moneda') || 'USD';
  const fmt = (d) => money.format(d, cur, { decimals: 0 });
  const hasDebts = v(map, 'tiene_deudas') === 'si';
  const income = flow(map, 'ingreso_mensual');
  const expenses = flow(map, 'gasto_mensual');
  const debtPay = hasDebts ? flow(map, 'pago_deudas_mensual') : v(map, 'tiene_deudas') === 'no' ? new money.D(0) : null;
  const saving = flow(map, 'ahorro_mensual');
  const savedNow = v(map, 'ahorro_acumulado') !== null ? money.dec(v(map, 'ahorro_acumulado')) : null;
  const housing = flow(map, 'gasto_vivienda');

  const bal = calc.availableBalance({ income, expenses, debtPayments: debtPay });
  const rate = calc.savingsRate(saving, income);
  const load = hasDebts ? calc.ratio(debtPay, income) : null;
  const outflow = expenses !== null && debtPay !== null ? expenses.plus(debtPay) : null;
  const reserve = calc.reserveMonths(savedNow, outflow);
  const housingRatio = calc.ratio(housing, income);
  const cobertura = v(map, 'cobertura');
  const protection = v(map, 'proteccion') || [];
  const dependents = v(map, 'dependientes') || 0;

  const strengths = [];
  const risks = [];
  const missing = [];
  const R = rules;

  // Datos insuficientes: «no lo sé» no se trata como cero.
  const unknownMsg = {
    ingreso_mensual: 'No indicaste cuánto recibes al mes: sin ese dato no podemos calcular tu saldo ni tu tasa de ahorro.',
    gasto_mensual: 'No indicaste cuánto gastas al mes: sin ese dato no podemos calcular tu saldo.',
    gasto_vivienda: 'No indicaste tu gasto en vivienda.',
    deuda_total: 'No sabes cuánto debes en total: es el primer dato que conviene reunir.',
    pago_deudas_mensual: 'No sabes cuánto pagas por tus deudas al mes.',
    ahorro_mensual: 'No indicaste cuánto ahorras al mes.',
    ahorro_acumulado: 'No indicaste cuánto tienes ahorrado: no podemos estimar cuántos meses te cubre.',
    cobertura: 'No sabes cuánto tiempo podrías cubrir tus gastos sin ingresos.',
    ingreso_neto: 'No sabes si tu ingreso es neto o bruto.',
  };
  for (const [code, msg] of Object.entries(unknownMsg)) if (map[code] && map[code].unknown) missing.push(msg);
  if (v(map, 'ingreso_neto') === 'bruto') missing.push('Tu ingreso es bruto: lo que realmente recibes será menor y tu saldo también.');

  // Fortalezas
  if (rate.value !== null && rate.value.gte(R.tasa_ahorro.saludable)) strengths.push(`Ahorras el ${pct(rate.value)} de tu ingreso, por encima del ${pct(R.tasa_ahorro.saludable)} que usamos como referencia.`);
  if (reserve !== null && reserve.gte(R.reserva_meses.recomendada)) strengths.push(`Tu ahorro disponible cubre unos ${reserve.floor().toString()} meses de gastos.`);
  else if (cobertura === '3_6' || cobertura === 'mas_6') strengths.push('Podrías cubrir varios meses de gastos si dejaras de recibir ingresos.');
  if (v(map, 'tiene_deudas') === 'no') strengths.push('No tienes deudas: todo lo que te sobra puede ir a tus metas.');
  if (hasDebts && load !== null && load.lt(R.carga_deuda.moderada)) strengths.push(`Tus cuotas de deuda son una parte manejable de tu ingreso (${pct(load)}).`);
  if (hasDebts && v(map, 'atrasos') === 'no') strengths.push('Pagas tus deudas a tiempo.');
  if (bal.value !== null && bal.value.gt(0) && v(map, 'fin_de_mes') === 'sobra') strengths.push(`Terminas el mes con dinero disponible: unos ${fmt(bal.value)}.`);
  if (v(map, 'registro_gastos') === 'detallado') strengths.push('Llevas un registro detallado de tus gastos.');
  if (v(map, 'presupuesto') === 'siempre') strengths.push('Decides tus gastos antes de que empiece el mes.');
  if (v(map, 'revision') === 'semanal') strengths.push('Revisas tus cuentas cada semana.');
  if (protection.includes('salud')) strengths.push('Cuentas con protección de salud.');

  // Riesgos
  if (v(map, 'fuente_ingreso') === 'sin_ingresos') risks.push({ level: 'alto', text: 'Ahora no tienes ingresos: la prioridad es cubrir lo esencial y proteger tu ahorro.' });
  if (bal.value !== null && bal.value.lt(0)) risks.push({ level: 'alto', text: `Gastas más de lo que recibes: te faltan unos ${fmt(bal.value.abs())} al mes.` });
  if (['credito', 'atraso'].includes(v(map, 'fin_de_mes'))) risks.push({ level: 'alto', text: v(map, 'fin_de_mes') === 'credito' ? 'Cubres el fin de mes con tarjeta o préstamos, lo que hace crecer tus deudas.' : 'Dejas pagos pendientes para llegar a fin de mes.' });
  if (load !== null && load.gte(R.carga_deuda.alta)) risks.push({ level: 'alto', text: `Tus deudas se llevan el ${pct(load)} de tu ingreso.` });
  else if (load !== null && load.gte(R.carga_deuda.moderada)) risks.push({ level: 'medio', text: `Tus deudas se llevan el ${pct(load)} de tu ingreso; conviene que no crezca.` });
  if (v(map, 'atrasos') === 'varias') risks.push({ level: 'alto', text: 'Te has atrasado varias veces en tus pagos: los atrasos suelen generar intereses y cargos extra.' });
  if ((reserve !== null && reserve.lt(R.reserva_meses.minima)) || cobertura === 'menos_1') risks.push({ level: 'alto', text: 'Tu ahorro no alcanza para cubrir un mes de gastos ante una emergencia.' });
  if (rate.value !== null && rate.value.lt(R.tasa_ahorro.baja) && !(bal.value !== null && bal.value.lt(0))) risks.push({ level: 'medio', text: `Ahorras menos del ${pct(R.tasa_ahorro.baja)} de tu ingreso.` });
  if (housingRatio !== null && housingRatio.gt(R.vivienda_alta)) risks.push({ level: 'medio', text: `La vivienda se lleva el ${pct(housingRatio)} de tu ingreso.` });
  if (['mucho', 'impredecible'].includes(v(map, 'estabilidad_ingreso')) && !(reserve !== null && reserve.gte(R.reserva_meses.recomendada))) risks.push({ level: 'medio', text: 'Tu ingreso cambia de un mes a otro y tu reserva es corta para compensarlo.' });
  if (dependents > 0 && (protection.includes('ninguno') || !protection.includes('vida'))) risks.push({ level: 'medio', text: `${dependents === 1 ? 'Una persona depende' : `${dependents} personas dependen`} de ti y no cuentas con seguro de vida.` });
  if (v(map, 'impulso') === 'semanal') risks.push({ level: 'bajo', text: 'Las compras que luego lamentas son frecuentes.' });
  if (v(map, 'registro_gastos') === 'no') risks.push({ level: 'bajo', text: 'No tienes claro en qué se va tu dinero.' });

  // Prioridades
  const priorities = [];
  const add = (code, title) => !priorities.some((p) => p.code === code) && priorities.push({ code, title });
  if ((bal.value !== null && bal.value.lt(0)) || ['credito', 'atraso'].includes(v(map, 'fin_de_mes'))) add('equilibrar', 'Equilibrar lo que entra y lo que sale');
  if (v(map, 'atrasos') === 'varias' || (load !== null && load.gte(R.carga_deuda.alta))) add('deudas', 'Ponerte al día y reducir el peso de tus deudas');
  if ((reserve !== null && reserve.lt(R.reserva_meses.minima)) || cobertura === 'menos_1') add('reserva', 'Crear una reserva de al menos un mes de gastos');
  if (v(map, 'registro_gastos') !== 'detallado' && v(map, 'presupuesto') !== 'siempre') add('claridad', 'Saber en qué se va tu dinero cada mes');
  const goalMap = { deudas: ['deudas', 'Ponerte al día y reducir el peso de tus deudas'], reserva: ['reserva', 'Construir tu fondo para emergencias'], meta: ['meta', 'Ahorrar para tu meta con una cifra y una fecha'], invertir: ['invertir', 'Preparar la base antes de invertir: reserva y deudas bajo control'], orden: ['claridad', 'Saber en qué se va tu dinero cada mes'] };
  const g = goalMap[v(map, 'objetivo')];
  if (g) add(g[0], g[1]);
  if (!priorities.length) add('mantener', 'Mantener tus hábitos y asignar un destino a lo que te sobra');

  const ACTIONS = {
    equilibrar: { title: 'Anota cada gasto durante siete días', detail: 'Por pequeño que sea. Al final, marca los que podrías evitar el próximo mes: ahí está tu primer margen.' },
    deudas: { title: 'Haz una lista de tus deudas', detail: 'Para cada una apunta el saldo, la cuota y la tasa de interés con su tipo. Es la base para decidir cuál pagar primero.' },
    reserva: { title: 'Separa tu reserva en otra cuenta', detail: 'Programa un aporte automático el día que recibes tu ingreso, aunque sea pequeño. Lo importante es empezar.' },
    claridad: { title: 'Agrupa los gastos del último mes', detail: 'Revisa los movimientos de tu cuenta y sepáralos en vivienda, comida, transporte, servicios y lo demás.' },
    meta: { title: 'Ponle cifra y fecha a tu meta', detail: 'Divide la cifra entre los meses que tienes: ese es el aporte mensual que necesitas.' },
    invertir: { title: 'Asegura tu base antes de invertir', detail: 'Confirma que tienes al menos tres meses de gastos ahorrados y ninguna deuda cara.' },
    mantener: { title: 'Dale un destino a lo que te sobra', detail: 'Decide hoy qué parte va a reserva, qué parte a tus metas y qué parte puedes gastar sin culpa.' },
  };
  const actions = priorities.slice(0, 2).map((p) => ({ code: p.code, ...ACTIONS[p.code] }));

  const levelOrder = { alto: 0, medio: 1, bajo: 2 };
  risks.sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);

  return {
    preliminar: true,
    currency: cur,
    indicators: {
      income: money.str(income),
      expenses: money.str(expenses),
      debtPayments: money.str(debtPay),
      balance: money.str(bal.value),
      savingsRate: rate.value === null ? null : rate.value.toFixed(4),
      savingsRateReason: rate.reason,
      reserveMonths: reserve === null ? null : reserve.toFixed(2),
    },
    strengths: strengths.slice(0, 4),
    risks: risks.slice(0, 4),
    priorities: priorities.slice(0, 3),
    actions,
    missing,
  };
}

function create(evaluation, map) {
  const rs = rulesRepo.current();
  const result = compute(map, rs.rules);
  db.run(
    'INSERT INTO free_results (evaluation_id, rule_set_id, calc_version, result_json, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(evaluation_id) DO NOTHING',
    evaluation.id,
    rs.id,
    calc.CALC_VERSION,
    JSON.stringify(result),
    db.now()
  );
  return db.one('SELECT * FROM free_results WHERE evaluation_id = ?', evaluation.id);
}

module.exports = { compute, create };
