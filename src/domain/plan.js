'use strict';
// F08 Plan Maestro. Las cifras del plan se calculan aquí a partir del diagnóstico
// (determinista y reproducible). La IA solo redacta las explicaciones de cada bloque.
const db = require('../db');
const calc = require('./calc');
const money = require('../lib/money');
const rulesRepo = require('./rules');
const queue = require('../lib/queue');
const ai = require('./ai/provider');
const prompts = require('./ai/prompts');
const entitlements = require('./entitlements');
const { track, notify } = require('../lib/services');

const { D } = money;
const ZERO = new D(0);
const dec = (v) => money.dec(v);
const s = (d) => (d === null || d === undefined ? null : money.str(d));

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeWeights(w) {
  const total = w.reserva + w.deuda + w.metas;
  if (total <= 0) return { reserva: 0, deuda: 0, metas: 0 };
  return { reserva: w.reserva / total, deuda: w.deuda / total, metas: w.metas / total };
}

/** Distribuye `amount` según pesos, con ajuste de centavos en la última partida. */
function split(amount, weights) {
  const keys = Object.keys(weights).filter((k) => weights[k] > 0);
  const out = { reserva: ZERO, deuda: ZERO, metas: ZERO };
  let used = ZERO;
  keys.forEach((k, i) => {
    const v = i === keys.length - 1 ? amount.minus(used) : calc.r2(amount.times(weights[k]));
    out[k] = v;
    used = used.plus(v);
  });
  return out;
}

/** Construye el contenido numérico del plan. */
function buildContent(diag, rules, startDate) {
  const R = rules;
  const cur = diag.currency;
  const fmt = (v) => money.format(v, cur);
  const balance = dec(diag.balance);
  const flexible = dec(diag.flexible);
  const reducible = dec(diag.reducible);
  const adjPct = R.ajuste_gasto[diag.adjustment] ?? 0;
  let adjustment = ZERO;
  if (adjPct > 0) {
    if (flexible !== null) adjustment = calc.r2(flexible.times(adjPct));
    else if (reducible !== null) adjustment = calc.r2(D.min(reducible, dec(diag.expenses.total || 0).times(adjPct)));
    if (reducible !== null && reducible.lt(adjustment)) adjustment = reducible;
  }
  const deficit = balance !== null && balance.plus(adjustment).lt(0) ? balance.plus(adjustment).abs() : ZERO;
  const available = balance === null ? ZERO : D.max(balance.plus(adjustment), ZERO);

  const debts = diag.debts.filter((d) => dec(d.balance).gt(0));
  const knownDebts = debts.filter((d) => d.monthlyRate !== null);
  const expensive = knownDebts.some((d) => Number(d.effectiveAnnual) > R.tasa_cara_efectiva_anual);
  const noAmortize = debts.some((d) => d.flags.includes('no_amortiza'));
  const reserveMonths = diag.reserve.months === null ? null : Number(diag.reserve.months);
  const reserveGap = dec(diag.reserve.gap);
  const hasGoals = diag.goals.length > 0;

  let profile = 'equilibrio';
  if (reserveMonths !== null && reserveMonths < R.reserva_meses.minima) profile = 'sin_reserva';
  else if (expensive || noAmortize) profile = 'deuda_cara';
  let w = { ...R.asignacion[profile] };
  const pref = { deuda: 'deuda', reserva: 'reserva', metas: 'metas' }[diag.preference];
  if (pref) {
    for (const k of ['reserva', 'deuda', 'metas']) w[k] = k === pref ? w[k] + 0.1 : Math.max(w[k] - 0.05, 0);
  }
  if (!knownDebts.length) {
    w.reserva += reserveGap && reserveGap.gt(0) ? w.deuda : 0;
    w.metas += reserveGap && reserveGap.gt(0) ? 0 : w.deuda;
    w.deuda = 0;
  }
  if (!hasGoals) {
    if (reserveGap && reserveGap.gt(0)) w.reserva += w.metas;
    else if (knownDebts.length) w.deuda += w.metas;
    w.metas = hasGoals ? w.metas : 0;
  }
  if (reserveGap !== null && reserveGap.isZero()) {
    if (knownDebts.length) w.deuda += w.reserva;
    else if (hasGoals) w.metas += w.reserva;
    w.reserva = 0;
  }
  w = normalizeWeights(w);
  const alloc = available.gt(0) ? split(available, w) : { reserva: ZERO, deuda: ZERO, metas: ZERO };
  const free = available.minus(alloc.reserva).minus(alloc.deuda).minus(alloc.metas);

  // Estrategia de deuda: avalancha (mayor tasa primero).
  const debtInput = debts.map((d) => ({ name: d.name, balance: d.balance, payment: d.payment, rate: d.rate, rateType: d.rateType, fees: d.fees }));
  const base = debts.length ? calc.projectDebts(debtInput) : null;
  const withPlan = debts.length ? calc.projectDebts(debtInput, { extra: alloc.deuda }) : null;
  const order = [...knownDebts].sort((a, b) => Number(b.monthlyRate) - Number(a.monthlyRate)).map((d) => d.name);
  const interestSaved = base && withPlan ? base.totalInterest.minus(withPlan.totalInterest) : null;

  // Reserva y metas
  const reserveTarget = dec(diag.reserve.target);
  const reserveSaved = dec(diag.reserve.available) ?? ZERO;
  const reserveProg = reserveTarget && reserveTarget.gt(0) ? calc.goalProgress({ target: reserveTarget, saved: reserveSaved, monthly: alloc.reserva }) : null;
  const pendingTotal = money.sum(diag.goals.map((g) => g.pending));
  const goals = diag.goals.map((g) => {
    const share = pendingTotal.gt(0) ? calc.r2(alloc.metas.times(dec(g.pending)).div(pendingTotal)) : ZERO;
    const gp = calc.goalProgress({ target: g.target, saved: g.saved, monthly: share, desiredMonths: g.desiredMonths });
    return {
      name: g.name,
      target: g.target,
      saved: g.saved,
      pending: g.pending,
      monthly: s(share),
      months: gp.months,
      reachable: gp.reachable,
      reason: gp.reason,
      desiredMonths: g.desiredMonths,
      needed: gp.needed ? s(gp.needed) : null,
      onTrack: gp.onTrack ?? null,
    };
  });

  // Escenarios a 12 meses (simulaciones; no alteran datos reales).
  const currentSaving = dec(diag.saving) ?? ZERO;
  function scenario(name, monthlyReserve, debtExtra, note, kind) {
    const proj = debts.length ? calc.projectDebts(debtInput, { extra: debtExtra }) : null;
    return {
      name,
      kind,
      note,
      reserveIn12: s(reserveSaved.plus(D.max(monthlyReserve, ZERO).times(12))),
      debtMonths: proj ? proj.months : null,
      debtInterest: proj ? s(proj.totalInterest) : null,
      debtUnresolved: proj ? proj.unresolved : [],
    };
  }
  const scenarios = [scenario('Sin cambios', currentSaving, ZERO, 'Mantienes tu ahorro actual y pagas solo las cuotas.', 'dato')];
  scenarios.push(scenario('Con el plan', alloc.reserva, alloc.deuda, `Aplicas la distribución propuesta${adjustment.gt(0) ? `, con un ajuste de gasto de ${fmt(adjustment)} al mes` : ''}.`, 'calculo'));
  const extraIncome = dec(diag.extraIncome);
  if (extraIncome && extraIncome.gt(0)) {
    const a2 = split(available.plus(extraIncome), w);
    scenarios.push(scenario('Con ingreso extra', a2.reserva, a2.deuda, `Supone ${fmt(extraIncome)} de ingreso extra al mes. Es una estimación, no un ingreso garantizado.`, 'supuesto'));
  }

  // Plan de 90 días: acciones ordenadas con día relativo.
  const actions = [];
  const act = (day, title, reason, criteria, indicator) => actions.push({ day, title, reason, criteria, indicator });
  act(1, 'Arma tu presupuesto del mes', `El plan reparte ${fmt(available)} al mes: ${fmt(alloc.reserva)} a reserva, ${fmt(alloc.deuda)} a deudas y ${fmt(alloc.metas)} a metas.`, 'Tienes el presupuesto de este mes registrado en la calculadora con esas partidas.', 'Presupuesto del mes registrado');
  if (deficit.gt(0) || (balance !== null && balance.lt(0))) {
    act(2, `Recorta al menos ${fmt(balance.abs())} de tus gastos`, `Hoy sale más dinero del que entra: faltan ${fmt(balance.abs())} al mes.`, 'Cancelaste o redujiste gastos por esa cifra y lo reflejaste en tu presupuesto.', 'Saldo mensual mayor o igual a cero');
  } else if (adjustment.gt(0)) {
    act(5, `Libera ${fmt(adjustment)} de tus gastos flexibles`, 'Es el ajuste que dijiste estar dispuesto a hacer; acelera todo el plan.', 'Identificaste qué gastos reduces y lo aplicaste en el presupuesto.', 'Gasto flexible del mes');
  }
  if (diag.risks.some((r) => r.code === 'atraso')) act(3, 'Ponte al día con el pago atrasado', 'Los atrasos generan intereses moratorios y cargos que frenan tu plan.', 'Pagaste el atraso o acordaste un plan de pago por escrito.', 'Pagos atrasados: ninguno');
  for (const d of debts.filter((x) => x.flags.includes('no_amortiza'))) {
    act(4, `Haz que la cuota de «${d.name}» reduzca la deuda`, `La cuota actual no cubre los intereses: faltan al menos ${fmt(d.shortfall)} al mes.`, 'Subiste la cuota por encima del interés del mes o negociaste una tasa menor.', `Saldo de «${d.name}» bajando mes a mes`);
  }
  if (alloc.reserva.gt(0)) {
    act(3, 'Abre una cuenta separada para tu reserva', 'Tener la reserva aparte evita gastarla sin darte cuenta.', 'Tienes una cuenta o subcuenta solo para emergencias.', 'Cuenta de reserva abierta');
    act(7, `Programa un aporte automático de ${fmt(alloc.reserva)}`, 'Automatizar el aporte el día que cobras hace que ocurra sin depender de la fuerza de voluntad.', 'El aporte está programado para el día en que recibes tu ingreso.', 'Aporte mensual a la reserva');
  }
  for (const d of debts.filter((x) => x.flags.includes('tasa_desconocida'))) {
    act(6, `Averigua la tasa de «${d.name}»`, 'Sin la tasa y su tipo no podemos calcular cuánto te cuesta esa deuda ni cuándo termina.', 'Conoces la tasa y si es nominal o efectiva, y la registraste.', 'Simulación de deuda completa');
  }
  if (alloc.deuda.gt(0) && order.length) {
    act(10, `Paga ${fmt(alloc.deuda)} extra a «${order[0]}»`, `Es tu deuda con la tasa más alta: cada pago extra ahí ahorra más intereses${interestSaved && interestSaved.gt(0) ? ` (unos ${fmt(interestSaved)} en total con el plan)` : ''}.`, 'Hiciste el pago extra además de la cuota y lo registraste.', `Saldo de «${order[0]}»`);
  }
  if (diag.risks.some((r) => r.code === 'minimo')) act(12, 'Deja de pagar solo el mínimo de la tarjeta', 'El pago mínimo casi no reduce la deuda y multiplica los intereses.', 'Este mes pagaste más que el mínimo.', 'Pago de tarjeta sobre el mínimo');
  act(14, 'Registra cada movimiento durante dos semanas', 'Comparar lo previsto con lo real muestra dónde se va el dinero.', 'Tienes 14 días seguidos de movimientos registrados.', 'Días con registro');
  goals.filter((g) => dec(g.monthly).gt(0)).slice(0, 2).forEach((g, i) => {
    act(21 + i * 3, `Aparta ${fmt(g.monthly)} al mes para «${g.name}»`, g.reachable ? `A ese ritmo la alcanzas en ${g.months} meses.` : 'Es el aporte que permite el plan por ahora.', 'El aporte está separado o programado.', `Avance de «${g.name}»`);
  });
  act(30, 'Primera revisión mensual', 'A los 30 días ya hay datos reales para ajustar.', 'Comparaste presupuesto y movimientos del mes y anotaste dos ajustes.', 'Diferencia entre previsto y real');
  if (flexible !== null && flexible.gt(0)) act(40, 'Revisa suscripciones y servicios', 'Los cargos recurrentes pequeños suman más de lo que parece.', 'Cancelaste o renegociaste al menos uno.', 'Gasto en suscripciones');
  if (diag.risks.some((r) => ['salud', 'respaldo'].includes(r.code))) act(45, 'Revisa la protección de tu hogar', 'Hay personas que dependen de ti y un imprevisto de salud o de ingreso las afectaría.', 'Comparaste al menos dos opciones de seguro o cobertura.', 'Opciones comparadas');
  if (extraIncome && extraIncome.gt(0)) act(50, 'Da el primer paso hacia tu ingreso extra', 'Es una estimación: probarla convierte el supuesto en dato.', 'Generaste o agendaste tu primer ingreso extra.', 'Ingreso extra del mes (supuesto)');
  act(60, 'Segunda revisión mensual', 'Confirma que los aportes se están cumpliendo.', 'Revisaste tu tablero y ajustaste lo que no se cumplió.', 'Aportes cumplidos');
  act(90, 'Cierra tu primer ciclo de 90 días', 'Es el momento de medir el avance y actualizar el plan con tus cifras reales.', 'Comparaste tu situación con el diagnóstico inicial y, si cambió, pediste una actualización del plan.', 'Avance frente al diagnóstico');
  actions.sort((a, b) => a.day - b.day);

  // Hoja de ruta de 12 meses
  const roadmap = [];
  const mile = (month, title, condition) => roadmap.push({ month, title, condition });
  mile(1, 'Presupuesto en marcha y aportes programados', 'Si registras tus movimientos y cumples el presupuesto del mes.');
  const monthly = alloc.reserva;
  if (reserveTarget && monthly.gt(0)) {
    const outflowMonth = reserveTarget.div(R.reserva_meses.recomendada);
    const m1 = outflowMonth.times(R.reserva_meses.minima).minus(reserveSaved);
    if (m1.gt(0)) {
      const n = m1.div(monthly).ceil().toNumber();
      if (n <= 12) mile(n, `Reserva de ${R.reserva_meses.minima} ${R.reserva_meses.minima === 1 ? 'mes' : 'meses'} de egresos`, `Si mantienes el aporte de ${fmt(monthly)} al mes.`);
    }
    if (reserveProg && reserveProg.months && reserveProg.months <= 12) mile(reserveProg.months, `Reserva completa de ${R.reserva_meses.recomendada} meses (${fmt(reserveTarget)})`, `Si mantienes el aporte de ${fmt(monthly)} al mes.`);
  }
  if (withPlan) {
    for (const d of withPlan.perDebt) if (d.paidOffMonth && d.paidOffMonth <= 12) mile(d.paidOffMonth, `Terminas de pagar «${d.name}»`, 'Si mantienes la cuota y el pago extra del plan. Su cuota pasa a la siguiente deuda.');
  }
  for (const g of goals) if (g.months && g.months > 0 && g.months <= 12) mile(g.months, `Alcanzas la meta «${g.name}»`, `Si apartas ${fmt(g.monthly)} al mes.`);
  for (const m of [3, 6, 9]) mile(m, 'Revisión trimestral del plan', 'Compara tus cifras con el plan y pide una actualización si cambiaron.');
  mile(12, 'Balance del año y nuevo plan', 'Actualiza tu evaluación y genera una nueva versión del plan.');
  roadmap.sort((a, b) => a.month - b.month);

  const review = [
    `Si tu ingreso cambia más de ${Math.round(R.plan.variacion_ingreso_revision * 100)} %.`,
    'Si terminas de pagar una deuda o contratas una nueva.',
    'Si no cumples el aporte dos meses seguidos.',
    `Cada ${R.plan.revision_meses} meses, aunque todo vaya bien.`,
  ];

  return {
    currency: cur,
    startDate,
    diagnostico: {
      situacion: [
        { label: 'Ingresos al mes', value: diag.income.total, src: 'calculo' },
        { label: 'Gastos al mes', value: diag.expenses.total, src: 'calculo' },
        { label: 'Pagos de deuda al mes', value: diag.debtPayments, src: 'calculo' },
        { label: 'Saldo disponible', value: diag.balance, src: 'calculo' },
        { label: 'Deuda total', value: diag.debtTotal, src: 'calculo' },
        { label: 'Ahorro disponible', value: diag.reserve.available, src: 'dato' },
      ],
      prioridades: diag.priorities,
      faltantes: diag.missing,
    },
    presupuesto: {
      profile,
      weights: w,
      adjustment: s(adjustment),
      adjustmentPct: adjPct,
      deficit: s(deficit),
      available: s(available),
      alloc: { reserva: s(alloc.reserva), deuda: s(alloc.deuda), metas: s(alloc.metas), libre: s(free) },
      lines: [
        { label: 'Gastos esenciales', value: diag.expenses.essential ?? diag.expenses.total, src: 'dato' },
        { label: 'Gastos flexibles', value: flexible !== null ? s(flexible.minus(adjustment)) : null, src: adjustment.gt(0) ? 'supuesto' : 'dato' },
        { label: 'Cuotas de deuda', value: diag.debtPayments, src: 'dato' },
        { label: 'Pago extra a deudas', value: s(alloc.deuda), src: 'calculo' },
        { label: 'Reserva para emergencias', value: s(alloc.reserva), src: 'calculo' },
        { label: 'Metas', value: s(alloc.metas), src: 'calculo' },
      ],
      strategy: {
        method: 'avalancha',
        order,
        incomplete: base ? base.incomplete : [],
        alerts: debts.filter((d) => d.flags.includes('no_amortiza')).map((d) => d.name),
        baseMonths: base ? base.months : null,
        planMonths: withPlan ? withPlan.months : null,
        baseInterest: base ? s(base.totalInterest) : null,
        planInterest: withPlan ? s(withPlan.totalInterest) : null,
        interestSaved: interestSaved ? s(interestSaved) : null,
        perDebt: withPlan ? withPlan.perDebt.map((p) => ({ name: p.name, paidOffMonth: p.paidOffMonth, known: p.known })) : [],
        timeline: withPlan ? withPlan.timeline.filter((t, i) => i < 24 || t.month % 6 === 0).map((t) => ({ month: t.month, total: s(t.total) })) : [],
      },
    },
    metas: {
      reserve: reserveTarget
        ? { target: s(reserveTarget), saved: s(reserveSaved), monthly: s(alloc.reserva), months: reserveProg ? reserveProg.months : null, reachable: reserveProg ? reserveProg.reachable : null }
        : null,
      goals,
      scenarios,
    },
    plan90: actions,
    hoja12: roadmap,
    review,
  };
}

// ───────── Redacción (IA) ─────────

function textFor(content) {
  // Versión compacta para la IA: cada cifra con su texto ya formateado.
  const cur = content.currency;
  const t = (v) => (v === null || v === undefined ? null : { valor: v, texto: money.format(v, cur) });
  return {
    moneda: cur,
    dia_uno: content.startDate,
    situacion: content.diagnostico.situacion.map((x) => ({ concepto: x.label, ...t(x.value), origen: x.src })),
    prioridades: content.diagnostico.prioridades.map((p) => p.title),
    datos_faltantes: content.diagnostico.faltantes,
    presupuesto: {
      disponible_para_el_plan: t(content.presupuesto.available),
      ajuste_de_gasto_supuesto: t(content.presupuesto.adjustment),
      deficit: t(content.presupuesto.deficit),
      reparto: Object.fromEntries(Object.entries(content.presupuesto.alloc).map(([k, v]) => [k, t(v)])),
      estrategia_deuda: { ...content.presupuesto.strategy, timeline: undefined, baseInterest: t(content.presupuesto.strategy.baseInterest), planInterest: t(content.presupuesto.strategy.planInterest), interestSaved: t(content.presupuesto.strategy.interestSaved) },
    },
    reserva: content.metas.reserve && { objetivo: t(content.metas.reserve.target), ahorrado: t(content.metas.reserve.saved), aporte: t(content.metas.reserve.monthly), meses: content.metas.reserve.months },
    metas: content.metas.goals.map((g) => ({ nombre: g.name, objetivo: t(g.target), aporte: t(g.monthly), meses: g.months, alcanzable: g.reachable })),
    escenarios: content.metas.scenarios.map((x) => ({ nombre: x.name, nota: x.note, reserva_en_12_meses: t(x.reserveIn12), meses_para_salir_de_deudas: x.debtMonths, origen: x.kind })),
    plan_90_dias: content.plan90.map((a) => ({ dia: a.day, accion: a.title })),
    hoja_de_ruta: content.hoja12.map((m) => ({ mes: m.month, hito: m.title })),
    revisar_si: content.review,
  };
}

function localNarrative(content) {
  const cur = content.currency;
  const f = (v) => (v === null || v === undefined ? '—' : money.format(v, cur));
  const p = content.presupuesto;
  const firstPrio = content.diagnostico.prioridades[0];
  const bal = content.diagnostico.situacion.find((x) => x.label === 'Saldo disponible');
  const st = p.strategy;
  return {
    diagnostico: `Hoy tu saldo disponible es de ${f(bal && bal.value)} al mes. Tu primera prioridad es ${firstPrio ? firstPrio.title.toLowerCase() : 'mantener el orden'}. ${content.diagnostico.faltantes.length ? 'Faltan algunos datos; reunirlos hará el plan más preciso.' : 'Con los datos que diste, el plan está completo.'}`,
    presupuesto: `El plan reparte ${f(p.available)} al mes: ${f(p.alloc.reserva)} a tu reserva, ${f(p.alloc.deuda)} a pagos extra de deuda y ${f(p.alloc.metas)} a tus metas.${Number(p.adjustment) > 0 ? ` Incluye un ajuste de gasto de ${f(p.adjustment)}, que es un supuesto basado en lo que dijiste estar dispuesto a recortar.` : ''}${st.order.length ? ` Para las deudas usamos el método avalancha: primero «${st.order[0]}», la de mayor tasa.` : ''}`,
    metas: `${content.metas.reserve ? `Tu reserva de referencia es de ${f(content.metas.reserve.target)}${content.metas.reserve.months ? ` y, con el aporte del plan, la completarías en unos ${content.metas.reserve.months} meses` : ''}. ` : ''}Los escenarios comparan seguir igual con aplicar el plan; el de ingreso extra, si aparece, es solo una estimación.`,
    plan90: `Los primeros días son para ordenar: presupuesto, cuenta de reserva y aportes automáticos. Después, cada acción tiene un criterio claro para marcarla como hecha. Ve una a la vez.`,
    hoja12: `La hoja de ruta marca los hitos que puedes esperar si mantienes los aportes. Revisa el plan cada tres meses o antes si tu ingreso o tus deudas cambian.`,
  };
}

async function narrative(userId, content) {
  const input = textFor(content);
  const res = await ai.call({
    userId,
    purpose: 'plan',
    promptVersion: prompts.PLAN_PROMPT_VERSION,
    system: prompts.PLAN_SYSTEM,
    messages: [{ role: 'user', content: `Datos del plan (JSON):\n${JSON.stringify(input)}` }],
    outputSchema: prompts.PLAN_SCHEMA,
    effort: 'medium',
    maxTokens: 16000,
    input,
    localFn: async () => ({ content: [{ type: 'text', text: JSON.stringify(localNarrative(content)) }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } }),
  });
  let parsed;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    throw new Error('La respuesta de la IA no tiene el formato esperado.');
  }
  for (const k of prompts.PLAN_SCHEMA.required) if (typeof parsed[k] !== 'string') throw new Error('La respuesta de la IA está incompleta.');
  return { narrative: parsed, runId: res.runId };
}

// ───────── Ciclo de vida ─────────

function current(userId) {
  return db.one("SELECT * FROM plan_versions WHERE user_id = ? AND is_current = 1 AND status = 'completo'", userId);
}
function pending(userId) {
  return db.one("SELECT * FROM plan_versions WHERE user_id = ? AND status IN ('en_cola', 'generando', 'fallido') ORDER BY id DESC LIMIT 1", userId);
}

/** Solicita una generación. No cobra: solo exige el permiso vigente. */
function request(userId, { startDate, reason = null }) {
  if (!entitlements.has(userId, 'plan_maestro')) throw Object.assign(new Error('Sin permiso de Plan Maestro.'), { status: 403 });
  const diag = db.one('SELECT * FROM diagnoses WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', userId);
  if (!diag) throw Object.assign(new Error('Primero completa la evaluación profunda.'), { status: 409 });
  const inFlight = db.one("SELECT * FROM plan_versions WHERE user_id = ? AND status IN ('en_cola', 'generando')", userId);
  if (inFlight) return inFlight;
  return db.tx(() => {
    db.run("DELETE FROM plan_versions WHERE user_id = ? AND status = 'fallido'", userId);
    const n = (db.value('SELECT MAX(version_number) FROM plan_versions WHERE user_id = ?', userId) || 0) + 1;
    const r = db.run(
      "INSERT INTO plan_versions (user_id, diagnosis_id, version_number, status, start_date, request_reason, created_at) VALUES (?, ?, ?, 'en_cola', ?, ?, ?)",
      userId,
      diag.id,
      n,
      startDate,
      reason,
      db.now()
    );
    queue.enqueue('generar_plan', { planId: r.lastId }, { maxAttempts: 3 });
    return db.one('SELECT * FROM plan_versions WHERE id = ?', r.lastId);
  });
}

function retry(userId, planId) {
  const p = db.one("SELECT * FROM plan_versions WHERE id = ? AND user_id = ? AND status = 'fallido'", planId, userId);
  if (!p) return null;
  db.run("UPDATE plan_versions SET status = 'en_cola', error_message = NULL WHERE id = ?", p.id);
  queue.enqueue('generar_plan', { planId: p.id }, { maxAttempts: 3 });
  return p;
}

async function generate({ planId }) {
  const p = db.one('SELECT * FROM plan_versions WHERE id = ?', planId);
  if (!p || p.status === 'completo') return;
  db.run("UPDATE plan_versions SET status = 'generando' WHERE id = ?", planId);
  const diag = db.one('SELECT * FROM diagnoses WHERE id = ?', p.diagnosis_id);
  const rules = rulesRepo.byId(diag.rule_set_id) || rulesRepo.current();
  const content = buildContent(JSON.parse(diag.result_json), rules.rules, p.start_date);
  let result;
  try {
    result = await narrative(p.user_id, content);
  } catch (e) {
    db.run("UPDATE plan_versions SET status = 'en_cola', error_message = ? WHERE id = ?", e.message.slice(0, 300), planId);
    if (e.code === 'limite_cuenta' || e.code === 'limite_global') e.permanent = true;
    throw e;
  }
  db.tx(() => {
    db.run(
      "UPDATE plan_versions SET status = 'completo', content_json = ?, narrative_json = ?, ai_run_id = ?, error_message = NULL, completed_at = ? WHERE id = ?",
      JSON.stringify(content),
      JSON.stringify(result.narrative),
      result.runId,
      db.now(),
      planId
    );
    activate(p.user_id, planId, content, JSON.parse(diag.result_json));
  });
  track('plan_generado', { userId: p.user_id, dedupe: `plan_generado:${planId}` });
  notify(p.user_id, { kind: 'plan', title: `Tu Plan Maestro (versión ${p.version_number}) está listo`, body: 'Tu Día Uno ya tiene acciones.', link: '/plan', dedupe: `plan_listo:${planId}` });
}

async function onFailed({ planId }, job, err) {
  const p = db.one('SELECT * FROM plan_versions WHERE id = ?', planId);
  if (!p || p.status === 'completo') return;
  const friendly =
    err && err.code === 'limite_cuenta'
      ? 'Alcanzaste el límite mensual de generaciones de plan.'
      : err && err.code === 'limite_global'
        ? 'El servicio de IA alcanzó su límite de uso de este mes.'
        : 'El servicio de IA no respondió.';
  db.run("UPDATE plan_versions SET status = 'fallido', error_message = ? WHERE id = ?", friendly, planId);
  notify(p.user_id, { kind: 'plan', title: 'No pudimos generar tu plan', body: `${friendly} Puedes reintentarlo sin costo.`, link: '/plan', dedupe: `plan_fallido:${planId}:${job.id}` });
}

/** Marca la versión como vigente y crea tareas, hitos, metas y deudas de seguimiento. */
function activate(userId, planId, content, diag) {
  db.run('UPDATE plan_versions SET is_current = 0 WHERE user_id = ? AND id <> ?', userId, planId);
  db.run('UPDATE plan_versions SET is_current = 1 WHERE id = ?', planId);
  db.run("UPDATE tasks SET archived = 1, updated_at = ? WHERE user_id = ? AND source = 'plan' AND status <> 'completada' AND archived = 0", db.now(), userId);
  content.plan90.forEach((a, i) => {
    const r = db.run(
      `INSERT INTO tasks (user_id, plan_version_id, position, title, reason, done_criteria, indicator, day_offset, due_date, status, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', 'plan', ?, ?)`,
      userId,
      planId,
      i + 1,
      a.title,
      a.reason,
      a.criteria,
      a.indicator,
      a.day,
      addDays(content.startDate, a.day - 1),
      db.now(),
      db.now()
    );
    db.run("INSERT INTO task_events (task_id, user_id, from_status, to_status, note, created_at) VALUES (?, ?, NULL, 'pendiente', 'Creada por el Plan Maestro', ?)", r.lastId, userId, db.now());
  });
  for (const m of content.hoja12) {
    db.run("INSERT INTO milestones (user_id, plan_version_id, month, title, condition, status, created_at) VALUES (?, ?, ?, ?, ?, 'pendiente', ?)", userId, planId, m.month, m.title, m.condition, db.now());
  }
  if (content.metas.reserve && !db.one("SELECT id FROM goals WHERE user_id = ? AND kind = 'reserva' AND status = 'activa'", userId)) {
    db.run(
      "INSERT INTO goals (user_id, name, kind, target_amount, initial_saved, target_months, status, source, created_at, updated_at) VALUES (?, 'Reserva para emergencias', 'reserva', ?, ?, ?, 'activa', 'plan', ?, ?)",
      userId,
      content.metas.reserve.target,
      content.metas.reserve.saved,
      content.metas.reserve.months,
      db.now(),
      db.now()
    );
  }
  for (const g of content.metas.goals) {
    if (db.one('SELECT id FROM goals WHERE user_id = ? AND name = ?', userId, g.name)) continue;
    db.run(
      "INSERT INTO goals (user_id, name, kind, target_amount, initial_saved, target_months, status, source, created_at, updated_at) VALUES (?, ?, 'meta', ?, ?, ?, 'activa', 'plan', ?, ?)",
      userId,
      g.name,
      g.target,
      g.saved,
      g.desiredMonths,
      db.now(),
      db.now()
    );
  }
  if (!db.value('SELECT 1 FROM debts WHERE user_id = ? LIMIT 1', userId)) {
    for (const d of diag.debts) {
      const r = db.run(
        "INSERT INTO debts (user_id, name, kind, rate, rate_type, payment, fees, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'activa', ?, ?)",
        userId,
        d.name,
        d.kind,
        d.rate,
        d.rateType,
        d.payment,
        d.fees,
        db.now(),
        db.now()
      );
      db.run("INSERT INTO debt_balances (debt_id, user_id, date, balance, note, created_at) VALUES (?, ?, ?, ?, 'Saldo de la evaluación profunda', ?)", r.lastId, userId, today(), d.balance, db.now());
    }
  }
}

/** Cambia la fecha de inicio (Día Uno) mientras no haya tareas completadas. */
function changeStart(userId, planId, startDate) {
  const p = db.one("SELECT * FROM plan_versions WHERE id = ? AND user_id = ? AND is_current = 1 AND status = 'completo'", planId, userId);
  if (!p) return false;
  if (db.value("SELECT 1 FROM tasks WHERE plan_version_id = ? AND status = 'completada'", planId)) return false;
  db.tx(() => {
    db.run('UPDATE plan_versions SET start_date = ? WHERE id = ?', startDate, planId);
    for (const t of db.all('SELECT id, day_offset FROM tasks WHERE plan_version_id = ?', planId)) {
      db.run('UPDATE tasks SET due_date = ?, updated_at = ? WHERE id = ?', addDays(startDate, (t.day_offset || 1) - 1), db.now(), t.id);
    }
  });
  return true;
}

/** ¿Hay datos más nuevos que los del plan vigente? (para ofrecer recalcular). */
function dataChangedSince(userId, plan) {
  if (!plan) return false;
  const newerDiag = db.value('SELECT 1 FROM diagnoses WHERE user_id = ? AND id > ?', userId, plan.diagnosis_id);
  return Boolean(newerDiag);
}

function dayNumber(startDate) {
  const start = Date.parse(startDate + 'T00:00:00Z');
  const t = Date.parse(today() + 'T00:00:00Z');
  return Math.floor((t - start) / 86400000) + 1;
}

queue.register('generar_plan', generate);
queue.register('generar_plan:fallido', onFailed);

module.exports = { buildContent, localNarrative, request, retry, generate, current, pending, changeStart, dataChangedSince, dayNumber, addDays, today, textFor };
