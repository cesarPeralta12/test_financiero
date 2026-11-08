'use strict';
// F06 Evaluación profunda (validación y consistencia) y F07 Diagnóstico detallado.
// Las cifras se calculan aquí, con reglas versionadas; ninguna puntuación crediticia.
const db = require('../db');
const calc = require('./calc');
const money = require('../lib/money');
const rulesRepo = require('./rules');
const qs = require('./questionnaire');

const { D } = money;
const ZERO = new D(0);

function val(map, code) {
  const a = map[code];
  if (!a || a.unknown || a.skipped) return null;
  return a.value;
}
function isUnknown(map, code) {
  return Boolean(map[code] && map[code].unknown);
}
function flow(map, code) {
  const v = val(map, code);
  return v ? calc.toMonthly(v.amount, v.period) : null;
}
function amt(map, code) {
  const v = val(map, code);
  return v === null ? null : money.dec(v);
}

/** Cifras normalizadas a un mes a partir de las respuestas. */
function figures(map) {
  const currency = val(map, 'moneda_base') || 'USD';
  const incomeMain = flow(map, 'ingreso_principal');
  const incomeExtra = flow(map, 'ingresos_adicionales');
  const income = incomeMain === null ? null : incomeMain.plus(incomeExtra || ZERO);
  const breakdown = val(map, 'gastos_desglose');
  const breakdownSum = breakdown ? money.sum(Object.values(breakdown)) : null;
  const declaredExpenses = flow(map, 'gasto_total');
  const annual = amt(map, 'gastos_anuales');
  const annualMonthly = annual === null ? null : annual.div(12);
  const baseExpenses = breakdownSum !== null ? breakdownSum : declaredExpenses;
  const expenses = baseExpenses === null ? null : baseExpenses.plus(annualMonthly || ZERO);
  const debts = (val(map, 'deudas') || []).map((d) => ({ ...d }));
  const debtPaymentsSum = money.sum(debts.map((d) => d.payment));
  const debtPaymentsDeclared = debts.length ? flow(map, 'pago_deudas_total') : ZERO;
  const debtPayments = debts.length ? debtPaymentsSum : ZERO;
  const saving = flow(map, 'ahorro_mensual');
  const savingsAvailable = amt(map, 'ahorro_disponible');
  const savingsLocked = amt(map, 'ahorro_no_disponible');
  const reducible = flow(map, 'gasto_reducible');
  const extraIncome = flow(map, 'ingreso_extra_posible');
  const sellable = amt(map, 'bienes_vendibles');
  const goals = val(map, 'metas') || [];
  const essentialKeys = ['vivienda', 'alimentacion', 'transporte', 'servicios', 'salud', 'educacion'];
  const essential = breakdown ? money.sum(essentialKeys.map((k) => breakdown[k])) : null;
  const flexible = breakdown ? money.sum(['ocio', 'otros'].map((k) => breakdown[k])) : null;
  const bal = calc.availableBalance({ income, expenses, debtPayments });
  return {
    currency,
    incomeMain,
    incomeExtra,
    income,
    netIncome: val(map, 'ingreso_es_neto') !== 'bruto',
    breakdown,
    breakdownSum,
    declaredExpenses,
    annual,
    annualMonthly,
    expenses,
    essential,
    flexible,
    debts,
    debtPaymentsSum,
    debtPaymentsDeclared,
    debtPayments,
    saving,
    savingsAvailable,
    savingsLocked,
    reducible,
    extraIncome,
    sellable,
    goals,
    balance: bal.value,
    balanceMissing: bal.missing,
    dependents: val(map, 'dependientes') || 0,
  };
}

/**
 * Contradicciones y avisos antes del diagnóstico.
 * nivel 'bloqueo' → hay que corregir; nivel 'aviso' → hay que confirmar.
 */
function checks(map, rules, qn) {
  const f = figures(map);
  const cur = f.currency;
  const fmt = (d) => money.format(d, cur);
  const tol = (ref) => D.max(ref.abs().times(rules.consistencia.tolerancia_relativa), new D(rules.consistencia.tolerancia_minima));
  const pos = (code) => qn.questions.find((q) => q.code === code)?.position;
  const out = [];

  if (f.breakdownSum !== null && f.declaredExpenses !== null) {
    const diff = f.breakdownSum.minus(f.declaredExpenses).abs();
    if (diff.gt(tol(f.declaredExpenses))) {
      out.push({
        code: 'gastos_desglose',
        level: 'bloqueo',
        text: `Tus gastos desglosados suman ${fmt(f.breakdownSum)} al mes, pero declaraste un total de ${fmt(f.declaredExpenses)}. Corrige el total o el desglose para que coincidan.`,
        links: [
          [pos('gasto_total'), 'Cambiar el total'],
          [pos('gastos_desglose'), 'Cambiar el desglose'],
        ],
      });
    }
  }
  if (f.debts.length && f.debtPaymentsDeclared !== null) {
    const diff = f.debtPaymentsSum.minus(f.debtPaymentsDeclared).abs();
    if (diff.gt(tol(f.debtPaymentsDeclared))) {
      out.push({
        code: 'cuotas_deuda',
        level: 'bloqueo',
        text: `Las cuotas de tus deudas suman ${fmt(f.debtPaymentsSum)} al mes, pero indicaste que pagas ${fmt(f.debtPaymentsDeclared)} en total.`,
        links: [
          [pos('deudas'), 'Revisar las deudas'],
          [pos('pago_deudas_total'), 'Cambiar el total'],
        ],
      });
    }
  }
  if (!f.netIncome) {
    out.push({
      code: 'ingreso_bruto',
      level: 'aviso',
      text: 'Indicaste un ingreso bruto. Usaremos esa cifra como si fuera lo que recibes, por lo que tu saldo podría verse mayor de lo real. Lo ideal es escribir lo que llega a tu cuenta.',
      links: [[pos('ingreso_principal'), 'Cambiar el ingreso']],
    });
  }
  if (f.saving !== null && f.balance !== null && f.saving.gt(D.max(f.balance, ZERO).plus(tol(f.saving)))) {
    out.push({
      code: 'ahorro_mayor_saldo',
      level: 'aviso',
      text: `Declaras ahorrar ${fmt(f.saving)} al mes, pero con tus cifras te quedan ${fmt(f.balance)}. Puede faltar un ingreso o sobrar un gasto.`,
      links: [
        [pos('ahorro_mensual'), 'Cambiar el ahorro'],
        [pos('ingresos_adicionales'), 'Revisar ingresos'],
      ],
    });
  }
  const goalSaved = money.sum(f.goals.map((g) => g.saved));
  const totalSavings = (f.savingsAvailable || ZERO).plus(f.savingsLocked || ZERO);
  if (f.goals.length && f.savingsAvailable !== null && goalSaved.gt(totalSavings.plus(tol(goalSaved)))) {
    out.push({
      code: 'metas_mayor_ahorro',
      level: 'aviso',
      text: `Lo ahorrado para tus metas (${fmt(goalSaved)}) supera tus ahorros declarados (${fmt(totalSavings)}).`,
      links: [
        [pos('metas'), 'Revisar las metas'],
        [pos('ahorro_disponible'), 'Revisar el ahorro'],
      ],
    });
  }
  f.debts.forEach((d, i) => {
    if (money.dec(d.balance).gt(0) && money.dec(d.payment).isZero()) {
      out.push({ code: `deuda_sin_cuota_${i}`, level: 'aviso', text: `La deuda «${d.name}» no tiene cuota mensual: no podremos proyectar cuándo termina.`, links: [[pos('deudas'), 'Revisar las deudas']] });
    }
  });
  if (f.breakdown && money.dec(f.breakdown.vivienda).gt(0) && f.debts.some((d) => d.kind === 'hipoteca')) {
    out.push({
      code: 'vivienda_hipoteca',
      level: 'aviso',
      text: 'Registraste una hipoteca y también un gasto de vivienda. Confirma que el gasto de vivienda no incluye la cuota de la hipoteca, para no contarla dos veces.',
      links: [[pos('gastos_desglose'), 'Revisar el desglose']],
    });
  }
  return out;
}

const KIND_LABEL = Object.fromEntries((require('../db/content-v1').DEEP.questions.find((q) => q.code === 'deudas').config.kinds || []).map((k) => [k.value, k.label]));

function diagnose(map, rules) {
  const f = figures(map);
  const cur = f.currency;
  const fmt = (d) => money.format(d, cur);
  const pct = (d) => money.formatPercent(d, 0);
  const s = (d) => (d === null || d === undefined ? null : money.str(d));
  const R = rules;
  const assumptions = [];
  const missing = [];

  assumptions.push('Los importes semanales se convierten a un mes multiplicando por 52 y dividiendo entre 12; los quincenales, por 2; los anuales, entre 12.');
  if (f.annualMonthly !== null && f.annualMonthly.gt(0)) assumptions.push(`Tus gastos anuales (${fmt(f.annual)}) se reparten en 12 meses: ${fmt(f.annualMonthly)} al mes.`);
  if (f.breakdownSum !== null) assumptions.push('Usamos la suma de tu desglose de gastos como gasto mensual.');
  if (!f.netIncome) assumptions.push('Tu ingreso se declaró bruto y se usa como si fuera neto.');

  // Deudas
  const debts = f.debts.map((d) => {
    const i = calc.monthlyRate(d.rate, d.rate_type);
    const proj = calc.projectDebt({ balance: d.balance, payment: d.payment, ratePercent: d.rate, rateType: d.rate_type, fees: d.fees });
    const flags = [];
    if (i === null) flags.push('tasa_desconocida');
    if (proj.status === 'pago_no_cubre_interes') flags.push('no_amortiza');
    if (d.fees === null) flags.push('sin_comisiones');
    return {
      name: d.name,
      kind: d.kind,
      kindLabel: KIND_LABEL[d.kind] || d.kind,
      balance: s(d.balance),
      payment: s(d.payment),
      rate: d.rate,
      rateType: d.rate_type,
      fees: d.fees === null ? null : s(d.fees),
      monthlyRate: i === null ? null : i.toFixed(8),
      effectiveAnnual: i === null ? null : calc.effectiveAnnual(i).toFixed(6),
      firstInterest: i === null ? null : s(calc.r2(money.dec(d.balance).times(i))),
      status: proj.status,
      months: proj.months ?? null,
      totalInterest: proj.totalInterest ? s(proj.totalInterest) : null,
      shortfall: proj.shortfall ? s(proj.shortfall) : null,
      flags,
    };
  });
  for (const d of debts) {
    if (d.flags.includes('tasa_desconocida')) missing.push(`No conocemos el tipo de tasa o la tasa de «${d.name}»: su simulación queda incompleta. Búscala en tu contrato o estado de cuenta.`);
  }
  const debtTotal = money.sum(f.debts.map((d) => d.balance));
  const debtLoad = calc.ratio(f.debtPayments, f.income);
  const rate = calc.savingsRate(f.saving, f.income);
  const outflow = f.expenses !== null ? f.expenses.plus(f.debtPayments) : null;
  const essentialOutflow = f.essential !== null ? f.essential.plus(f.annualMonthly || ZERO).plus(f.debtPayments) : outflow;
  const reserveMonths = calc.reserveMonths(f.savingsAvailable, outflow);
  const reserveTarget = essentialOutflow ? essentialOutflow.times(R.reserva_meses.recomendada) : null;
  const reserveGap = reserveTarget !== null && f.savingsAvailable !== null ? D.max(reserveTarget.minus(f.savingsAvailable), ZERO) : null;
  const capacity = f.balance !== null ? D.max(f.balance, ZERO) : null;

  const goals = f.goals.map((g) => {
    const gp = calc.goalProgress({ target: g.target, saved: g.saved, monthly: null, desiredMonths: g.months });
    return {
      name: g.name,
      target: s(g.target),
      saved: s(g.saved),
      desiredMonths: g.months,
      progress: gp.progress ? gp.progress.toFixed(4) : null,
      pending: gp.pending ? s(gp.pending) : null,
      needed: gp.needed ? s(gp.needed) : null,
    };
  });

  // Riesgos
  const risks = [];
  if (f.balance !== null && f.balance.lt(0)) risks.push({ level: 'alto', code: 'saldo_negativo', text: `Tus egresos superan tus ingresos en ${fmt(f.balance.abs())} al mes.` });
  for (const d of debts) {
    if (d.flags.includes('no_amortiza')) risks.push({ level: 'alto', code: 'no_amortiza', text: `La cuota de «${d.name}» no cubre los intereses y cargos del mes: la deuda no baja. Faltan al menos ${fmt(d.shortfall)} al mes para empezar a reducirla.` });
  }
  if (val(map, 'atraso_actual') === 'mas_30') risks.push({ level: 'alto', code: 'atraso', text: 'Tienes un pago atrasado de más de 30 días: suele generar intereses moratorios y cargos.' });
  else if (val(map, 'atraso_actual') === 'menos_30') risks.push({ level: 'medio', code: 'atraso', text: 'Tienes un pago atrasado reciente: ponerte al día evita cargos.' });
  if (debtLoad !== null && debtLoad.gte(R.carga_deuda.alta)) risks.push({ level: 'alto', code: 'carga_deuda', text: `Tus cuotas de deuda se llevan el ${pct(debtLoad)} de tu ingreso.` });
  else if (debtLoad !== null && debtLoad.gte(R.carga_deuda.moderada)) risks.push({ level: 'medio', code: 'carga_deuda', text: `Tus cuotas de deuda se llevan el ${pct(debtLoad)} de tu ingreso.` });
  if (reserveMonths !== null && reserveMonths.lt(R.reserva_meses.minima)) risks.push({ level: 'alto', code: 'reserva', text: `Tu ahorro disponible cubre menos de un mes de egresos (${money.formatNumber(reserveMonths, cur, 1)} meses).` });
  else if (reserveMonths !== null && reserveMonths.lt(R.reserva_meses.recomendada)) risks.push({ level: 'medio', code: 'reserva', text: `Tu ahorro disponible cubre ${money.formatNumber(reserveMonths, cur, 1)} meses de egresos; la referencia es ${R.reserva_meses.recomendada}.` });
  const drop = val(map, 'caida_ingreso');
  if (drop !== null && new D(drop).gte(20) && !(reserveMonths !== null && reserveMonths.gte(R.reserva_meses.recomendada))) risks.push({ level: 'medio', code: 'variabilidad', text: `En un mes malo tu ingreso baja un ${String(drop).replace('.', ',')} % y tu reserva es corta para compensarlo.` });
  if (val(map, 'pago_tarjeta') === 'minimo') risks.push({ level: 'medio', code: 'minimo', text: 'Pagar solo el mínimo de la tarjeta alarga la deuda y multiplica los intereses.' });
  if (f.dependents > 0 && val(map, 'cobertura_salud') !== 'si') risks.push({ level: 'medio', code: 'salud', text: 'Hay personas que dependen de ti sin cobertura de salud completa.' });
  if (f.dependents > 0 && val(map, 'respaldo_ingreso') === 'no') risks.push({ level: 'medio', code: 'respaldo', text: 'Si tu ingreso se detiene, nadie más podría cubrir los gastos esenciales del hogar.' });
  const upcoming = (val(map, 'gastos_previstos') || []).filter((x) => x !== 'ninguno');
  if (upcoming.length && !(reserveMonths !== null && reserveMonths.gte(R.reserva_meses.recomendada))) risks.push({ level: 'medio', code: 'gastos_previstos', text: 'Esperas gastos importantes este año y tu reserva aún no alcanza para absorberlos.' });
  const rank = { alto: 0, medio: 1, bajo: 2 };
  risks.sort((a, b) => rank[a.level] - rank[b.level]);

  // Oportunidades
  const opportunities = [];
  const known = debts.filter((d) => d.effectiveAnnual !== null && money.dec(d.balance).gt(0)).sort((a, b) => Number(b.effectiveAnnual) - Number(a.effectiveAnnual));
  if (known.length > 1) opportunities.push({ src: 'calculo', text: `Dirigir cualquier pago extra a «${known[0].name}», la deuda con la tasa más alta (${pct(known[0].effectiveAnnual)} efectiva anual), reduce el total de intereses.` });
  else if (known.length === 1 && new D(known[0].effectiveAnnual).gt(R.tasa_cara_efectiva_anual)) opportunities.push({ src: 'calculo', text: `«${known[0].name}» tiene una tasa alta (${pct(known[0].effectiveAnnual)} efectiva anual): cada pago extra ahí rinde más que casi cualquier ahorro.` });
  if (f.reducible !== null && f.reducible.gt(0)) opportunities.push({ src: 'supuesto', text: `Según tu estimación, podrías liberar hasta ${fmt(f.reducible)} al mes recortando gastos no esenciales.` });
  if (f.extraIncome !== null && f.extraIncome.gt(0)) opportunities.push({ src: 'supuesto', text: `Un ingreso extra de ${fmt(f.extraIncome)} al mes es posible según tu estimación. Lo tratamos como escenario, no como ingreso seguro.` });
  if (f.sellable !== null && f.sellable.gt(0)) opportunities.push({ src: 'supuesto', text: `Tienes bienes por unos ${fmt(f.sellable)} que podrías vender${known.length ? ' para reducir deudas caras' : ' para reforzar tu reserva'}.` });
  if (rate.value !== null && rate.value.gte(R.tasa_ahorro.saludable)) opportunities.push({ src: 'calculo', text: `Tu tasa de ahorro (${pct(rate.value)}) es sólida: asignarle un destino a cada parte acelera tus metas.` });

  // Prioridades (deterministas)
  const prio = [];
  const add = (code, title) => !prio.some((p) => p.code === code) && prio.push({ code, title });
  if (f.balance !== null && f.balance.lt(0)) add('equilibrar', 'Cerrar la brecha entre ingresos y egresos');
  if (val(map, 'atraso_actual') && val(map, 'atraso_actual') !== 'no') add('atrasos', 'Ponerte al día con los pagos atrasados');
  if (debts.some((d) => d.flags.includes('no_amortiza'))) add('deuda_no_amortiza', 'Lograr que tus cuotas reduzcan la deuda');
  if (reserveMonths !== null && reserveMonths.lt(R.reserva_meses.minima)) add('reserva_minima', 'Reunir una reserva de al menos un mes');
  const pref = val(map, 'prioridad');
  const prefMap = { deuda: ['deuda_cara', 'Pagar primero las deudas más caras'], reserva: ['reserva', `Completar una reserva de ${R.reserva_meses.recomendada} meses`], metas: ['metas', 'Avanzar en tus metas'] };
  if (prefMap[pref]) add(...prefMap[pref]);
  if (known.some((d) => new D(d.effectiveAnnual).gt(R.tasa_cara_efectiva_anual))) add('deuda_cara', 'Pagar primero las deudas más caras');
  if (reserveMonths !== null && reserveMonths.lt(R.reserva_meses.recomendada)) add('reserva', `Completar una reserva de ${R.reserva_meses.recomendada} meses`);
  if (goals.length) add('metas', 'Avanzar en tus metas');
  if (!prio.length) add('optimizar', 'Dar un destino a cada parte de lo que te sobra');

  // Datos faltantes
  const unknownCodes = {
    caida_ingreso: 'No sabes cuánto baja tu ingreso en un mes malo.',
    gastos_desglose: 'No conoces el desglose de tus gastos: usamos tu total declarado.',
    gastos_anuales: 'No conoces tus gastos anuales: no están incluidos.',
    ahorro_no_disponible: 'No conoces tus ahorros no disponibles.',
    gasto_reducible: 'No estimaste cuánto podrías reducir tus gastos.',
    ingreso_extra_posible: 'No estimaste un posible ingreso extra.',
    bienes_vendibles: 'No estimaste el valor de bienes que podrías vender.',
  };
  for (const [code, msg] of Object.entries(unknownCodes)) if (isUnknown(map, code)) missing.push(msg);
  if (debts.some((d) => d.flags.includes('sin_comisiones'))) assumptions.push('Las comisiones y seguros de deudas solo se incluyen cuando los indicaste.');

  return {
    currency: cur,
    income: {
      total: s(f.income),
      net: f.netIncome,
      items: [
        { label: 'Ingreso principal', value: s(f.incomeMain), src: 'dato' },
        { label: 'Otros ingresos regulares', value: s(f.incomeExtra), src: 'dato' },
      ],
    },
    expenses: {
      total: s(f.expenses),
      declared: s(f.declaredExpenses),
      essential: s(f.essential),
      flexible: s(f.flexible),
      annualMonthly: s(f.annualMonthly),
      items: f.breakdown
        ? Object.entries(f.breakdown).map(([k, v]) => ({ key: k, value: s(v), src: 'dato' }))
        : [{ key: 'total_declarado', value: s(f.declaredExpenses), src: 'dato' }],
    },
    debtPayments: s(f.debtPayments),
    balance: s(f.balance),
    balanceMissing: f.balanceMissing,
    saving: s(f.saving),
    savingsRate: rate.value === null ? null : rate.value.toFixed(4),
    savingsRateReason: rate.reason,
    capacity: s(capacity),
    reserve: {
      available: s(f.savingsAvailable),
      locked: s(f.savingsLocked),
      months: reserveMonths === null ? null : reserveMonths.toFixed(2),
      targetMonths: R.reserva_meses.recomendada,
      target: s(reserveTarget),
      gap: s(reserveGap),
    },
    debts,
    debtTotal: s(debtTotal),
    debtLoad: debtLoad === null ? null : debtLoad.toFixed(4),
    goals,
    reducible: s(f.reducible),
    extraIncome: s(f.extraIncome),
    sellable: s(f.sellable),
    flexible: s(f.flexible),
    risks,
    opportunities,
    priorities: prio,
    missing,
    assumptions,
    preference: pref,
    adjustment: val(map, 'ajuste_gasto') || 'nada',
    dependents: f.dependents,
  };
}

/** Guarda el diagnóstico con la fotografía de las respuestas y las versiones usadas. */
function createDiagnosis(evaluation, userId) {
  const map = qs.answers(evaluation.id);
  const rs = rulesRepo.current();
  const result = diagnose(map, rs.rules);
  const snapshot = Object.fromEntries(Object.entries(map).map(([k, a]) => [k, { value: a.value, unknown: a.unknown, skipped: a.skipped }]));
  const r = db.run(
    'INSERT INTO diagnoses (user_id, evaluation_id, rule_set_id, calc_version, questionnaire_id, snapshot_json, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    userId,
    evaluation.id,
    rs.id,
    calc.CALC_VERSION,
    evaluation.questionnaire_id,
    JSON.stringify(snapshot),
    JSON.stringify(result),
    db.now()
  );
  return db.one('SELECT * FROM diagnoses WHERE id = ?', r.lastId);
}

function latestDiagnosis(userId) {
  return db.one('SELECT * FROM diagnoses WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', userId);
}

module.exports = { figures, checks, diagnose, createDiagnosis, latestDiagnosis, val };
