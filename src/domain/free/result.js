'use strict';
// Resultado del test gratuito RESULT_FREE_V1_ES. Todo es determinista: estados del
// mapa, perfil, prioridades, hallazgos, fortalezas, primera acción y hoja de ruta se
// calculan aquí con reglas; la IA solo puede reescribir explicaciones ya validadas
// (ver narrative.js). Sin cifras de ingreso o gasto exactos: el test no las captura.
const db = require('../../db');
const { D } = require('../../lib/money');
const config = require('../../config');
const catalog = require('./catalog');
const metrics = require('./metrics');
const narrative = require('./narrative');

const RULES_VERSION = 'RESULT_FREE_V1_ES';
const TITLE = 'Tu diagnóstico financiero preliminar';
const SCOPE_TEXT = 'Una primera lectura de tus respuestas para entender tu situación, reconocer prioridades y elegir un primer paso. El análisis detallado requiere información adicional.';

const STATE_LABEL = { strength: 'Fortaleza', attention: 'Requiere atención', critical: 'Atención prioritaria', potential: 'Potencial por explorar', unknown: 'Sin verificar' };
const DEPENDENTS = ['D1', 'D2', 'D3', 'D4PLUS'];
const DEPENDENT_COUNT = { D1: 'una persona depende', D2: 'dos personas dependen', D3: 'tres personas dependen', D4PLUS: 'cuatro o más personas dependen' };

const inList = (v, list) => v !== null && list.includes(v);

/** Lector de respuestas activas con referencias de evidencia. */
function reader(answers) {
  const get = (s) => answers[s] || null;
  const r = {
    get,
    route: (() => {
      const a = get('Q03');
      if (!a) return null;
      return a.status === 'answered' && typeof a.value === 'string' ? a.value : 'U';
    })(),
    code: (s) => (get(s) && get(s).status === 'answered' && typeof get(s).value === 'string' ? get(s).value : null),
    list: (s) => (get(s) && get(s).status === 'answered' && Array.isArray(get(s).value) ? get(s).value : null),
    status: (s) => (get(s) ? get(s).status : 'unanswered'),
    value: (s) => (get(s) ? get(s).value : null),
    variant: (s) => (get(s) ? get(s).variant_id : null),
    known: (s) => Boolean(get(s) && get(s).status === 'answered'),
    ref: (s) => (get(s) ? { slot_id: s, variant_id: get(s).variant_id, answer_revision: get(s).answer_revision } : null),
    refs: (...slots) => slots.map((s) => r.ref(s)).filter(Boolean),
    label: (s) => (r.code(s) ? catalog.labelFor(r.variant(s), r.code(s)) : null),
  };
  r.noIncome = r.route === 'N' || r.code('Q04') === 'ZERO';
  r.hasDependents = inList(r.code('Q14'), DEPENDENTS);
  return r;
}

const otherDebtVariants = catalog.DEBT_VARIANTS.filter((v) => v !== 'Q11_CARD');
const isPaymentTrouble = (r) => (r.variant('Q11') === 'Q11_CARD' && r.code('Q11') === 'LATE') || (otherDebtVariants.includes(r.variant('Q11')) && inList(r.code('Q11'), ['OVERDUE', 'UNABLE']));
const isPaymentWatch = (r) =>
  (r.code('Q09') === 'YES' && (r.status('Q10') !== 'answered' || r.status('Q11') !== 'answered')) ||
  (r.variant('Q11') === 'Q11_CARD' && inList(r.code('Q11'), ['MINIMUM', 'ABOVE_MIN'])) ||
  (otherDebtVariants.includes(r.variant('Q11')) && r.code('Q11') === 'OCCASIONAL_DELAY');

// ───────── Mapa financiero (7 dimensiones) ─────────
function dimensions(r) {
  const dim = (code, label, state, explanation, ...slots) => ({ code, label, state, state_label: STATE_LABEL[state], explanation, evidence_refs: r.refs(...slots) });
  const out = [];

  // Estabilidad de ingresos
  {
    const q4 = r.code('Q04');
    let s;
    if (r.route === 'N') s = ['critical', 'Actualmente no recibes ingresos personales.'];
    else if (q4 === 'ZERO') s = ['critical', r.route === 'B' ? 'Tu negocio todavía no te deja dinero para tus gastos personales.' : 'Declaras que ahora no recibes ingresos personales.'];
    else if ((r.route === 'E' && inList(q4, ['AT_RISK', 'TEMPORARY'])) || (r.route === 'O' && inList(q4, ['AT_RISK', 'VARIABLE', 'SPORADIC'])) || (['I', 'B', 'M', 'U'].includes(r.route) && inList(q4, ['VARIABLE', 'SPORADIC']))) {
      s = ['attention', r.route === 'E' ? 'Percibes riesgo o temporalidad en tu empleo.' : 'Declaras que tus ingresos cambian, son ocasionales o podrían interrumpirse.'];
    } else if (q4 === 'STABLE') s = ['strength', 'Percibes tus ingresos como estables; es una percepción declarada, no una garantía.'];
    else s = ['unknown', q4 === 'NEW' ? 'Aún no hay seis meses de referencia para valorar la estabilidad.' : 'Falta información para valorar la estabilidad de tus ingresos.'];
    out.push(dim('income_stability', 'Estabilidad de ingresos', s[0], s[1], 'Q03', 'Q04'));
  }
  // Capacidad de ahorro
  {
    const q6 = r.code('Q06');
    const v6 = r.variant('Q06');
    let s;
    if (q6 === 'ZERO' || q6 === 'NO_INCOME' || q6 === 'USING_RESERVES') {
      s = ['critical', q6 === 'USING_RESERVES' ? 'Declaras que estás consumiendo ahorros anteriores.' : q6 === 'NO_INCOME' ? 'No recibes ingresos personales de los cuales ahorrar.' : v6 === 'Q06_NO_INCOME' ? 'Declaras que hoy no puedes guardar dinero.' : 'Declaras que hoy no ahorras.'];
    } else if (q6 === 'LT10') s = ['attention', 'Declaras ahorrar una parte pequeña de tus ingresos, menos del 10 %.'];
    else if (inList(q6, ['P10_19', 'P20_29', 'GE30'])) s = ['strength', 'Declaras ahorrar con regularidad al menos el 10 % de tus ingresos.'];
    else if (q6 === 'SUPPORT_SURPLUS') s = ['potential', 'Declaras poder guardar dinero con apoyos u otros recursos; no calculamos una tasa de ahorro.'];
    else s = ['unknown', 'Sin verificar: no tenemos un dato de ahorro para valorarlo.'];
    out.push(dim('saving_capacity', 'Capacidad de ahorro', s[0], s[1], 'Q06'));
  }
  // Reserva de emergencia
  {
    const q8 = r.code('Q08');
    let s;
    if (inList(q8, ['ZERO', 'LT1M'])) s = ['critical', q8 === 'ZERO' ? 'Declaras no tener una reserva disponible.' : 'Declaras una reserva menor a un mes de gastos básicos.'];
    else if (q8 === 'M1_2') s = ['attention', 'Declaras una reserva de uno a menos de tres meses de gastos básicos.'];
    else if (inList(q8, ['M3_5', 'M6_11', 'GE12M'])) s = ['strength', 'Declaras una reserva de tres meses o más de gastos básicos (criterio cualitativo de producto, no una cifra universal).'];
    else s = ['unknown', 'Sin verificar: no tenemos un dato de reserva para valorarlo.'];
    out.push(dim('emergency_reserve', 'Reserva de emergencia', s[0], s[1], 'Q08'));
  }
  // Control de gastos
  {
    const q12 = r.code('Q12');
    let s;
    if (inList(q12, ['MIXED', 'NONE'])) s = ['critical', q12 === 'MIXED' ? 'Declaras mezclar dinero personal con el de otras actividades.' : 'Declaras no llevar un control de tus gastos.'];
    else if (inList(q12, ['PARTIAL', 'MENTAL', 'SEPARATE_PARTIAL'])) s = ['attention', 'Declaras un control parcial o de memoria de tus gastos.'];
    else if (inList(q12, ['RECORDED', 'SEPARATE_RECORDED'])) s = ['strength', q12 === 'SEPARATE_RECORDED' ? 'Declaras separar, registrar y revisar tus gastos personales.' : 'Declaras registrar y revisar tus gastos con regularidad.'];
    else s = ['unknown', 'Sin verificar: no tenemos un dato sobre cómo controlas tus gastos.'];
    out.push(dim('expense_control', 'Control de gastos', s[0], s[1], 'Q12'));
  }
  // Gestión de deudas
  {
    let s;
    const q9 = r.code('Q09');
    const q11 = r.code('Q11');
    if (isPaymentTrouble(r)) s = ['critical', 'Declaras pagos de deuda vencidos o que hoy no puedes cubrir.'];
    else if (isPaymentWatch(r)) {
      s = ['attention', q9 === 'YES' && (r.status('Q10') !== 'answered' || r.status('Q11') !== 'answered') ? 'Declaras deudas, pero falta identificar su tipo o cómo las pagas.' : r.variant('Q11') === 'Q11_CARD' ? 'Declaras pagar tus tarjetas solo por encima del mínimo o sin cancelar el saldo.' : 'Declaras retrasos ocasionales en tus pagos de deuda.'];
    } else if (q9 === 'NO') s = ['strength', 'No declaras deudas personales; eso no equivale a tener dinero sobrante.'];
    else if (q9 === 'YES' && r.status('Q10') === 'answered' && inList(q11, ['FULL', 'ON_TIME'])) s = ['strength', 'Declaras deudas conocidas y pagos al día.'];
    else s = ['unknown', 'Sin verificar: falta información para valorar tus deudas.'];
    out.push(dim('debt_management', 'Gestión de deudas', s[0], s[1], 'Q09', 'Q10', 'Q11'));
  }
  // Protección
  {
    const q14 = r.code('Q14');
    const label = DEPENDENTS.includes(q14) ? 'Protección familiar' : q14 === 'D0' ? 'Protección personal' : 'Protección';
    const q15 = r.list('Q15');
    let s;
    if (q15 && q15.length === 1 && q15[0] === 'NONE') s = ['critical', 'No identificas un respaldo ante una interrupción de tus recursos.'];
    else if (q15 && q15.length) s = ['attention', 'Declaras algún respaldo; falta aclarar su cobertura y si es suficiente.'];
    else s = ['unknown', 'Sin verificar: no tenemos un dato sobre tus respaldos.'];
    out.push(dim('protection', label, s[0], s[1], 'Q14', 'Q15'));
  }
  // Capacidad para generar ingresos
  {
    const q22 = r.code('Q22');
    const q24 = r.list('Q24');
    let s;
    if (!r.known('Q22') || !r.known('Q24')) s = ['unknown', 'Sin verificar: falta información de tiempo o habilidades.'];
    else if (q22 === 'H0' || (q24 && q24.length === 1 && q24[0] === 'NONE')) s = ['attention', q22 === 'H0' ? 'Declaras no tener tiempo disponible por ahora.' : 'Aún no identificas habilidades o recursos aprovechables.'];
    else if (q22 && q24) s = ['potential', 'Declaras tiempo y habilidades o recursos para explorar ingresos; no es un ingreso asegurado.'];
    else s = ['unknown', 'Sin verificar: falta información de tiempo o habilidades.'];
    out.push(dim('income_generation', 'Capacidad para generar ingresos', s[0], s[1], 'Q22', 'Q23', 'Q24'));
  }
  return out;
}

// ───────── Cobertura ─────────
const COVERAGE_SLOTS = ['Q02', 'Q03', 'Q04', 'Q06', 'Q08', 'Q09', 'Q12', 'Q15'];
function coverage(r) {
  const known = COVERAGE_SLOTS.filter((s) => r.known(s));
  const n = known.length;
  const label = n >= 7 ? 'Información suficiente para una primera lectura' : n >= 4 ? 'Lectura parcial' : 'Información limitada';
  return { known_domains: n, total_domains: COVERAGE_SLOTS.length, label, unknown_slots: COVERAGE_SLOTS.filter((s) => !r.known(s)) };
}

// ───────── Prioridades y hallazgos ─────────
const PRIORITY_DEF = {
  P01: { priority: 100, group: 'essentials', title: 'Entender y reducir el desequilibrio entre recursos y gastos básicos' },
  P02: { priority: 98, group: 'payments', title: 'Revisar los pagos que no estás pudiendo cubrir' },
  P03: { priority: 95, group: 'income', title: 'Identificar una vía realista para empezar a recibir ingresos' },
  P04: { priority: 90, group: 'debt_detail', title: 'Aclarar tus deudas y cómo las estás pagando' },
  P05: { priority: 85, group: 'separation', title: 'Separar el dinero personal del dinero de tus actividades' },
  P06: { priority: 80, group: 'reserve', title: 'Evaluar cómo construir o ampliar una reserva' },
  P07: { priority: 78, group: 'protection', title: 'Identificar respaldos para ti y las personas a tu cargo' },
  P08: { priority: 70, group: 'tracking', title: 'Mejorar la visibilidad de tus gastos' },
  P09: { priority: 65, group: 'income_growth', title: 'Explorar una oportunidad de ingreso ajustada a tus recursos' },
  P10: { priority: 40, group: 'information', title: 'Aclarar el dato pendiente más relevante' },
  H_GOAL: { priority: 30, group: 'goals', title: 'Tu objetivo pendiente de contraste' },
};

function candidates(r, balanceNegative) {
  const out = [];
  const add = (code, why, ...slots) => out.push({ candidate_id: code, ...PRIORITY_DEF[code], why, evidence_refs: r.refs(...slots) });
  if (r.code('Q02') === 'SHORTFALL' || r.code('Q11') === 'SHORTFALL' && r.variant('Q11') === 'Q11_NO_DEBT' || balanceNegative) add('P01', 'Declaras dificultad para cubrir tus gastos básicos.', 'Q02', 'Q11');
  if (isPaymentTrouble(r)) add('P02', 'Declaras pagos de deuda vencidos o que no puedes cubrir.', 'Q11');
  if (r.noIncome) add('P03', r.route === 'N' ? 'Actualmente no recibes ingresos personales.' : 'Declaras que ahora no recibes dinero personal de tus ingresos.', 'Q03', 'Q04');
  if (isPaymentWatch(r)) add('P04', 'Hay datos de deuda sin aclarar o pagos que conviene revisar.', 'Q09', 'Q10', 'Q11');
  if ((['B', 'M'].includes(r.route) && r.code('Q12') === 'MIXED') || (r.route === 'B' && r.code('Q05') === 'NO_SEPARATION')) add('P05', 'Declaras no distinguir bien el dinero personal del de tus actividades.', 'Q05', 'Q12');
  if (inList(r.code('Q08'), ['ZERO', 'LT1M', 'M1_2'])) add('P06', 'Tu reserva declarada es limitada.', 'Q08', 'Q14');
  const q15 = r.list('Q15');
  if (q15 && q15.length === 1 && q15[0] === 'NONE' && r.hasDependents) add('P07', 'Otras personas dependen de tus recursos y no identificas un respaldo.', 'Q14', 'Q15');
  if (inList(r.code('Q12'), ['NONE', 'PARTIAL', 'MENTAL', 'SEPARATE_PARTIAL'])) add('P08', 'Tu control de gastos declarado es parcial o inexistente.', 'Q12');
  const q25 = r.value('Q25');
  if (r.code('Q01') === 'INCREASE_INCOME' || (r.variant('Q25') === 'Q25_GROWTH' && inList(r.code('Q25'), ['LT25', 'P25_49', 'P50_99', 'GE100'])) || (r.variant('Q25') === 'Q25_START' && q25 && q25.kind === 'AMOUNT')) add('P09', 'Tu objetivo apunta a aumentar o empezar a recibir ingresos.', 'Q01', 'Q22', 'Q23', 'Q24', 'Q25');
  return out;
}

function pickDistinct(list, max) {
  const groups = new Set();
  const out = [];
  for (const c of [...list].sort((a, b) => b.priority - a.priority || a.candidate_id.localeCompare(b.candidate_id))) {
    if (groups.has(c.group)) continue;
    groups.add(c.group);
    out.push(c);
    if (out.length === max) break;
  }
  return out;
}

// ───────── Hallazgos: texto contextual ─────────
function findingText(c, r, metricsOut) {
  const dependents = r.hasDependents ? DEPENDENT_COUNT[r.code('Q14')] : null;
  switch (c.candidate_id) {
    case 'P01': {
      const bal = metricsOut.find((m) => m.code === 'balance' && new D(m.value).lt(0));
      return `Declaras dificultad para cubrir tus gastos básicos. ${bal ? `Con los datos aportados, el saldo mensual calculado es ${bal.value} ${bal.currency}.` : 'No calculamos el importe del desequilibrio: falta conocer tus ingresos y gastos reales.'}`;
    }
    case 'P02':
      return 'Declaras pagos de deuda vencidos o que hoy no puedes cubrir. No conocemos saldos ni tasas, por eso no estimamos su costo.';
    case 'P03':
      return r.route === 'B' ? 'Tu negocio todavía no te entrega dinero personal; conviene encontrar una vía realista para empezar a recibirlo, sin dar por hecho que no tienes ocupación.' : 'Ahora no recibes ingresos personales. Conviene identificar una vía realista para empezar a recibirlos.';
    case 'P04':
      if (r.code('Q09') === 'YES' && (r.status('Q10') !== 'answered' || r.status('Q11') !== 'answered')) return 'Declaras tener deudas, pero no identificaste su tipo o cómo las pagas. Conocerlas es el primer paso para organizarlas; no asumimos más de lo que respondiste.';
      if (r.variant('Q11') === 'Q11_CARD') return 'Pagas tus tarjetas solo por encima del mínimo o el mínimo. Falta conocer su saldo, tasa y condiciones para entender cómo te afecta.';
      return 'Declaras retrasos ocasionales en el pago de tus deudas. Falta conocer sus condiciones para decidir cómo ordenarlas.';
    case 'P05':
      return 'No distingues bien el dinero personal del de tus actividades. Esto dificulta ver cuánto te queda realmente para tus gastos.';
    case 'P06':
      return dependents ? `Tu reserva declarada es limitada y ${dependents} de tus recursos. Eso te expone a una interrupción de ingresos; no conocemos los gastos de esas personas, por lo que no los estimamos.` : 'Tu reserva declarada es limitada: ante una interrupción de ingresos tendrías poco margen. No fijamos un aporte ni un monto.';
    case 'P07':
      return 'No identificas un respaldo y otras personas dependen de tus recursos. Conviene aclarar con qué apoyo contarían en una interrupción.';
    case 'P08':
      return 'Tu control de gastos es parcial o inexistente, lo que limita ver en qué se usa tu dinero.';
    case 'P09': {
      const bits = [];
      if (inList(r.code('Q22'), ['HLT1', 'H1_3', 'H4_7', 'H8_14', 'H15PLUS'])) bits.push(`${(r.label('Q22') || '').toLowerCase()} a la semana`);
      else if (r.code('Q22') === 'H0') bits.push('poco tiempo disponible');
      const skills = r.list('Q24');
      if (skills && !skills.includes('NONE')) bits.push('habilidades o recursos identificados');
      const budget = r.value('Q23');
      if (budget && budget.kind === 'CHOICE' && budget.code === 'ZERO') bits.push('sin presupuesto adicional declarado');
      else if (budget && budget.kind === 'AMOUNT') bits.push('un presupuesto declarado para actuar');
      return bits.length ? `Declaras querer aumentar tus ingresos y cuentas con ${bits.join(', ')}. Eso acota las vías posibles; no asegura resultados.` : 'Declaras querer aumentar tus ingresos, pero faltan datos de tiempo, habilidades o presupuesto para acotar las vías.';
    }
    case 'P10':
      return 'Falta un dato clave para profundizar; aclararlo permitirá una lectura más precisa.';
    case 'H_GOAL':
      return 'Tu meta declarada es una aspiración. Falta contrastarla con tus ingresos, gastos y recursos actuales, por eso no afirmamos que sea viable ni calculamos plazos.';
    default:
      return c.why;
  }
}

const FINDING_TITLE = {
  P01: 'Gastos básicos bajo presión',
  P02: 'Pagos de deuda por revisar',
  P03: 'Sin ingresos personales por ahora',
  P04: 'Deudas y pagos por aclarar',
  P05: 'Dinero personal y de actividades mezclado',
  P06: 'Reserva limitada',
  P07: 'Respaldo por identificar',
  P08: 'Gastos con poca visibilidad',
  P09: 'Oportunidad de ingresos acotada por tus recursos',
  P10: 'Dato pendiente',
  H_GOAL: 'Meta pendiente de contraste',
};

// ───────── Fortalezas ─────────
function strengths(r) {
  const list = [];
  const q12 = r.code('Q12');
  const skills = r.list('Q24');
  const add = (code, title, ...slots) => list.push({ code, title, evidence_refs: r.refs(...slots) });
  if (inList(q12, ['RECORDED', 'SEPARATE_RECORDED'])) add('records_expenses', 'Ya registras tus gastos', 'Q12');
  if (r.code('Q09') === 'NO') add('no_declared_debt', 'No declaras deudas personales', 'Q09');
  if (r.variant('Q06') === 'Q06_REGULAR' && inList(r.code('Q06'), ['P10_19', 'P20_29', 'GE30'])) add('regular_saving', 'Declaras ahorro habitual', 'Q06');
  if (r.code('Q04') === 'STABLE') add('stable_income', 'Percibes estabilidad en tus ingresos', 'Q04');
  if (inList(r.code('Q22'), ['HLT1', 'H1_3', 'H4_7', 'H8_14', 'H15PLUS']) && skills && !skills.includes('NONE')) add('resources', 'Identificas recursos para explorar ingresos', 'Q22', 'Q24');
  return list.slice(0, 3);
}

// ───────── Perfil ─────────
function profileTitle(r, dims, cands, cov) {
  const has = (c) => cands.some((x) => x.candidate_id === c);
  const dim = (code) => dims.find((d) => d.code === code).state;
  if (cov.known_domains <= 3) return { code: 'NEEDS_INFO', title: 'Necesitamos conocer mejor tu situación' };
  if (has('P01')) return { code: 'RESOURCES_EXPENSES', title: 'Recursos y gastos por equilibrar' };
  if (has('P02')) return { code: 'DEBT_PRESSURE', title: 'Pagos de deuda bajo presión' };
  if (has('P03')) return { code: 'INCOME_NEED', title: 'Necesidad de ingresos personales' };
  if (dim('income_stability') === 'strength' && dim('emergency_reserve') === 'critical') return { code: 'STABLE_LIMITED_RESERVE', title: 'Ingreso estable y reserva limitada' };
  if (has('P05')) return { code: 'SEPARATE_MONEY', title: 'Dinero personal y del negocio por separar' };
  if (has('P09')) return { code: 'INCOME_POTENTIAL', title: 'Potencial para mejorar tus ingresos' };
  return { code: 'STARTING_POINT', title: 'Tu punto de partida financiero' };
}

const wordCount = (t) => t.trim().split(/\s+/).filter(Boolean).length;

function profileSummary(r, dims, cands, cov) {
  const dim = (code) => dims.find((d) => d.code === code);
  const refs = [];
  const sentences = [];
  const add = (text, ...slots) => {
    sentences.push(text);
    refs.push(...r.refs(...slots));
  };
  if (cov.known_domains <= 3) {
    add('Con las respuestas actuales todavía no tenemos información suficiente para describir tu situación con seguridad.', 'Q03');
    add('Varios temas quedaron sin verificar, y preferimos decirlo antes que suponerlo.', 'Q02');
    add('Esta lectura es preliminar y se completa cuando aclares los datos que faltan, sin que debas repetir el test.', 'Q01');
    return { text: sentences.join(' '), evidence_refs: refs, pending: true };
  }
  const inc = dim('income_stability');
  if (r.route === 'N') add('Actualmente no recibes ingresos personales.', 'Q03', 'Q04');
  else if (inc.state === 'strength') add(r.route === 'E' ? 'Percibes estabilidad en tu empleo.' : 'Percibes estabilidad en tus ingresos.', 'Q04');
  else if (inc.state === 'attention' || inc.state === 'critical') add('Declaras incertidumbre en tus ingresos.', 'Q04');
  const sav = dim('saving_capacity');
  if (sav.state === 'critical') add('Hoy no estás ahorrando.', 'Q06');
  else if (sav.state === 'strength') add('Declaras ahorrar con regularidad.', 'Q06');
  const res = dim('emergency_reserve');
  if (res.state === 'critical') add(r.code('Q08') === 'ZERO' ? 'Declaras no tener reserva disponible.' : 'Declaras una reserva inferior a un mes de gastos básicos.', 'Q08');
  else if (res.state === 'strength') add('Declaras una reserva de varios meses de gastos básicos.', 'Q08');
  const debt = dim('debt_management');
  if (debt.state === 'critical' || debt.state === 'attention') add(r.variant('Q11') === 'Q11_CARD' && r.code('Q11') === 'MINIMUM' ? 'Tus pagos mínimos de tarjeta merecen atención.' : 'Tus deudas y su forma de pago merecen atención.', 'Q09', 'Q11');
  else if (debt.state === 'strength' && r.code('Q09') === 'NO') add('No declaras deudas personales.', 'Q09');
  if (r.hasDependents) add(`${DEPENDENT_COUNT[r.code('Q14')][0].toUpperCase()}${DEPENDENT_COUNT[r.code('Q14')].slice(1)} de tus ingresos o recursos, algo que conviene tener presente.`, 'Q14');
  const gen = dim('income_generation');
  if (gen.state === 'potential') {
    const budget = r.value('Q23');
    add(`Identificas habilidades y ${(r.label('Q22') || 'algo de tiempo').toLowerCase()} por semana para explorar ingresos${budget && budget.kind === 'CHOICE' && budget.code === 'ZERO' ? ', sin presupuesto adicional declarado' : ''}.`, 'Q22', 'Q23', 'Q24');
  } else if (gen.state === 'attention') add('Tu tiempo o tus recursos para generar ingresos hoy son limitados.', 'Q22', 'Q24');
  const closing = 'Es una lectura preliminar basada solo en lo que declaraste, sin cifras exactas.';
  const fillers = [
    'No pedimos tus ingresos ni tus gastos exactos, por eso esta lectura describe tu situación solo de forma cualitativa.',
    'Cada punto se apoya en una respuesta tuya y lo que no respondiste aparece como sin verificar.',
    'Los datos que faltan se aclaran con la evaluación profunda y no se deducen de tus respuestas.',
  ];
  let text = sentences.join(' ');
  for (const f of fillers) if (wordCount(`${text} ${closing}`) < 50) text = `${text} ${f}`;
  text = `${text} ${closing}`;
  // Reduce a un máximo de 90 palabras quitando frases del final (antes del cierre).
  while (wordCount(text) > 90 && sentences.length > 2) {
    sentences.pop();
    text = `${sentences.join(' ')} ${closing}`;
  }
  const uniqueRefs = [...new Map(refs.map((x) => [`${x.slot_id}`, x])).values()];
  return { text, evidence_refs: uniqueRefs, pending: false };
}

// ───────── Atención ─────────
function attention(r, dims, cands) {
  const has = (c) => cands.some((x) => x.candidate_id === c);
  const st = (code) => dims.find((d) => d.code === code).state;
  const reasons = [];
  let level = 'Por definir';
  const high = has('P01') || has('P02') || has('P03') || (st('emergency_reserve') === 'critical' && (st('saving_capacity') === 'critical' || r.hasDependents || st('protection') === 'critical'));
  if (high) {
    level = 'Alta';
    if (has('P01')) reasons.push('Declaras dificultad para cubrir tus gastos básicos.');
    if (has('P02')) reasons.push('Declaras pagos de deuda que no estás pudiendo cubrir.');
    if (has('P03')) reasons.push('Ahora no recibes ingresos personales.');
    if (st('emergency_reserve') === 'critical') reasons.push('Tu reserva declarada es crítica.');
    if (st('saving_capacity') === 'critical') reasons.push('Hoy no estás ahorrando.');
    if (r.hasDependents) reasons.push('Otras personas dependen de tus recursos.');
  } else if (['P04', 'P05', 'P06', 'P07', 'P08', 'P09'].some(has)) {
    level = 'Media';
    for (const c of cands.filter((x) => ['P04', 'P05', 'P06', 'P07', 'P08', 'P09'].includes(x.candidate_id)).slice(0, 3)) reasons.push(c.why);
  } else reasons.push('Con lo declarado no hay señales urgentes, pero varios datos están sin verificar.');
  return { level, reasons: reasons.slice(0, 4) };
}

// ───────── Objetivo ─────────
function goalSection(r) {
  const q25 = r.value('Q25');
  const q17 = r.value('Q17');
  const q18 = r.value('Q18');
  const out = { priority: r.code('Q01') ? { code: r.code('Q01'), label: r.label('Q01'), evidence_refs: r.refs('Q01') } : null, income_goal: null, independence: null, pending: [] };
  if (r.variant('Q25') === 'Q25_GROWTH' && inList(r.code('Q25'), ['MAINTAIN', 'LT25', 'P25_49', 'P50_99', 'GE100'])) out.income_goal = { kind: 'GROWTH', code: r.code('Q25'), label: r.label('Q25'), note: 'Aspiración declarada; no es una probabilidad ni un importe calculado.', evidence_refs: r.refs('Q25') };
  else if (r.variant('Q25') === 'Q25_START' && q25 && q25.kind === 'AMOUNT') out.income_goal = { kind: 'AMOUNT', amount: q25.amount, currency: q25.currency, note: 'Ingreso mensual al que aspiras; no es un ingreso actual.', evidence_refs: r.refs('Q25') };
  const hasAge = q17 && q17.kind === 'AGE';
  const already = q17 && q17.kind === 'CHOICE' && q17.code === 'ALREADY';
  const hasAmount = q18 && q18.kind === 'AMOUNT';
  if (hasAge || already || hasAmount) {
    out.independence = {
      age: hasAge ? { kind: 'AGE', value: q17.value } : already ? { kind: 'CHOICE', code: 'ALREADY' } : null,
      monthly_amount: hasAmount ? { amount: q18.amount, currency: q18.currency } : null,
      note: 'Referencia declarada para tu independencia. No calculamos capital necesario, años restantes ni viabilidad con la información disponible.',
      evidence_refs: r.refs('Q16', 'Q17', 'Q18'),
    };
  }
  if (!out.income_goal) out.pending.push('Tu meta de ingreso aún no está definida.');
  if (!out.independence) out.pending.push('Tu referencia de independencia aún no está definida.');
  out.pending.push('Para contrastar tus metas hacen falta ingresos, gastos y recursos actuales.');
  return out;
}

// ───────── Oportunidades ─────────
const ROUTE_OPPORTUNITY = {
  E: 'Relaciónalo con una mejor remuneración, nuevas habilidades o una actividad adicional; no implica dejar tu empleo.',
  I: 'Revisa cómo se relacionan clientes, cobros, precios, costos o capacidad con ese obstáculo, mirando lo que te queda después de los gastos.',
  B: 'Relaciónalo con ventas, margen, liquidez, dependencia tuya o separación del dinero; no uses la facturación como ingreso personal.',
  M: 'Trabaja sobre ese obstáculo para la suma de tus ingresos; no asumimos cuáles son tus fuentes ni sus proporciones.',
  N: 'Explora empleo, clientes, habilidades o recursos según ese obstáculo.',
  O: 'No suponemos empleo ni empresa: considera la estabilidad, la dependencia o el monto fijo que declaraste, sin productos de inversión.',
  U: 'Usamos tus ingresos personales como referencia y no asignamos una ocupación; falta conocer más de tu situación.',
};

function opportunities(r) {
  const out = [];
  const q5 = r.code('Q05');
  const budget = r.value('Q23');
  const zeroBudget = budget && budget.kind === 'CHOICE' && budget.code === 'ZERO';
  if (q5 && q5 !== 'NONE') {
    out.push({ code: 'OPP_BARRIER', title: 'Trabajar tu obstáculo principal', description: `Obstáculo declarado: ${r.label('Q05')}. ${ROUTE_OPPORTUNITY[r.route] || ''}${r.route === 'N' && zeroBudget ? ' Cualquier primera acción debería poder hacerse sin desembolso.' : ''}`.trim(), evidence_refs: r.refs('Q03', 'Q05', 'Q23') });
  }
  const skills = r.list('Q24');
  const time = r.code('Q22');
  if (skills && !skills.includes('NONE') && time && time !== 'H0') {
    const names = skills.slice(0, 3).map((s) => (catalog.labelFor('Q24_SKILLS', s) || s).toLowerCase());
    out.push({ code: 'OPP_RESOURCES', title: 'Aprovechar tus habilidades y tu tiempo', description: `Podrías orientar ${names.join(', ')} y ${(r.label('Q22') || '').toLowerCase()} por semana a una vía concreta${zeroBudget ? ', comprobando primero la demanda sin gasto' : ''}. Es una hipótesis por comprobar, no un resultado esperado.`, evidence_refs: r.refs('Q22', 'Q23', 'Q24') });
  }
  if (!out.length) {
    const missing = [];
    if (!r.known('Q05') || q5 === 'NONE') missing.push('un obstáculo claro para aumentar tus ingresos');
    if (!r.known('Q24') || (skills && skills.includes('NONE'))) missing.push('habilidades o recursos identificados');
    if (!r.known('Q22') || time === 'H0') missing.push('tiempo disponible');
    out.push({ code: 'OPP_MISSING', title: 'Oportunidad por definir', description: `Para señalar una vía falta conocer ${missing.join(', ') || 'más detalles de tu situación'}.`, evidence_refs: r.refs('Q05', 'Q22', 'Q24') });
  }
  return out.slice(0, 2);
}

// ───────── Primera acción ─────────
function firstAction(r, cands, selected) {
  const has = (c) => cands.some((x) => x.candidate_id === c);
  const recorded = inList(r.code('Q12'), ['RECORDED', 'SEPARATE_RECORDED']);
  const types = r.list('Q10');
  const act = (code, title, instruction, completion_criterion, ...slots) => ({ code, title, instruction, completion_criterion, evidence_refs: r.refs(...slots) });
  if (r.route === 'N' && r.code('Q06') === 'SUPPORT_SURPLUS') {
    return act('CLARIFY_DATA', 'Aclara el dato que falta', 'Declaraste que no recibes ingresos personales, pero que puedes guardar dinero con apoyos. Revisa tu respuesta sobre la fuente de ingresos (pregunta 3) y corrígela si tu situación cambió. Al corregirla se te pedirán de nuevo las preguntas que dependen de ella.', 'Se completa cuando tus respuestas sobre ingresos y ahorro son coherentes entre sí.', 'Q03', 'Q06');
  }
  if (r.code('Q22') === 'H0') return act('FIND_TIME', 'Identifica un espacio breve para tu primer paso', 'Elige un momento concreto de la semana, aunque sea corto, o deja anotado que todavía no existe ese espacio.', 'Se completa al registrar esa decisión; no prometemos tiempo extra.', 'Q22');
  if (has('P02') || has('P04')) {
    const parts = ['Anota cada deuda que tengas: acreedor, saldo si lo conoces, pago exigible y vencimiento. Marca como pendiente lo que no sepas.'];
    if (types && types.length === 1 && types[0] === 'INFORMAL') parts.push('Si el dinero se lo debes a familiares u otras personas, anota a quién y cómo estás cumpliendo; no necesitas un extracto bancario.');
    else if (types && types.includes('CARD')) parts.push('Para la tarjeta, usa tu estado de cuenta más reciente si lo tienes a mano.');
    return act('DEBT_LIST', 'Prepara un listado de tus deudas', parts.join(' '), 'Se completa al tener un primer listado, aunque queden datos pendientes.', 'Q09', 'Q10', 'Q11');
  }
  if (has('P01') && recorded) return act('REVIEW_RECORD', 'Revisa tu registro más reciente', 'Identifica un gasto que puedas ajustar, o confirma que no lo hay y que hace falta revisar tus ingresos. No se trata de recortar nada de entrada.', 'Se completa al señalar ese hallazgo.', 'Q02', 'Q12');
  if (has('P01')) return act('LIST_UPCOMING', 'Identifica tus gastos básicos próximos', 'Lista los principales pagos que tienes por delante y los recursos que conoces para cubrirlos.', 'Se completa con ese primer panorama; no hace falta registrar siete días antes de actuar.', 'Q02', 'Q11');
  if (has('P05')) return act('SEPARATE_MONEY', 'Distingue dinero personal y del negocio', 'Separa en una lista tres movimientos recientes, o los que existan, e indica a qué ámbito corresponde cada uno.', 'Se completa con la clasificación.', 'Q05', 'Q12');
  if (has('P03') || has('P09')) {
    const budget = r.value('Q23');
    const skills = r.list('Q24');
    const zero = budget && budget.kind === 'CHOICE' && budget.code === 'ZERO';
    const base = skills && !skills.includes('NONE') ? 'Elige una de tus habilidades o recursos declarados y una forma de comprobar si hay demanda' : 'Lista una actividad que sabes realizar y una forma de comprobar si hay demanda';
    return act('PICK_OPPORTUNITY', 'Elige una oportunidad para explorar', `${base}${zero ? ' sin gastar dinero' : ''}.`, 'Se completa con una hipótesis a comprobar, no con una venta prometida.', 'Q22', 'Q23', 'Q24');
  }
  if (has('P08')) return act('SEE_EXPENSE', 'Haz visible un gasto que hoy no controlas', 'Identifica una categoría o un movimiento para revisar.', 'Se completa al dejarlo registrado.', 'Q12');
  if (has('P06') || has('P07')) return act('SUPPORT_MAP', 'Identifica tu respaldo disponible', 'Lista el dinero accesible o los apoyos reales con que cuentas; si no hay ninguno, déjalo indicado. No muevas dinero sin tener claro tu margen.', 'Se completa al reconocer esa situación.', 'Q08', 'Q15');
  return act('NEXT_FOCUS', 'Define tu próximo foco', r.code('Q01') ? `Confirma si tu objetivo «${r.label('Q01')}» sigue siendo tu foco o elige otro.` : 'Aclara cuál es tu objetivo principal.', 'Se completa al elegir una prioridad personal.', 'Q01');
}

// ───────── Hoja de ruta ─────────
function roadmap(r, cands, action) {
  const has = (c) => cands.some((x) => x.candidate_id === c);
  const rec = inList(r.code('Q12'), ['RECORDED', 'SEPARATE_RECORDED']);
  const refs = action.evidence_refs;
  let theme;
  if (has('P02') || has('P04')) theme = 'debt';
  else if (has('P03') || has('P09')) theme = 'income';
  else if (has('P05')) theme = 'business';
  else if (has('P06')) theme = 'reserve';
  else theme = 'general';
  const T = {
    debt: [
      ['Comprender y ordenar', `Toma tu prioridad principal y completa el primer paso. Ordena lo que sabes de tus deudas${rec ? ' usando el registro que ya llevas' : ''}.`],
      ['Aclarar datos', 'Aclara condiciones, respaldos y el margen real que tienes, sin elegir todavía una estrategia de pago.'],
      ['Consolidar el orden', 'Consolida el orden de pagos y gastos con lo que confirmaste, y revisa opciones por comparar.'],
      ['Revisar y decidir', 'Revisa lo observado y elige qué profundizar con la evaluación detallada.'],
    ],
    income: [
      ['Comprender y ordenar', 'Toma tu prioridad principal y completa el primer paso. Identifica tu obstáculo y los recursos con los que cuentas.'],
      ['Aclarar datos', 'Aclara tus restricciones de tiempo y presupuesto y define una hipótesis de oportunidad viable.'],
      ['Comprobar demanda', `Comprueba una oportunidad${r.value('Q23') && r.value('Q23').kind === 'CHOICE' && r.value('Q23').code === 'ZERO' ? ' sin presupuesto adicional' : ''}, sin prometer ventas ni resultados.`],
      ['Revisar y decidir', 'Revisa lo aprendido y elige qué profundizar.'],
    ],
    business: [
      ['Comprender y ordenar', 'Toma tu prioridad principal y completa el primer paso: distinguir dinero personal y del negocio.'],
      ['Aclarar datos', 'Aclara qué dinero te corresponde personalmente y qué debe quedar para operar.'],
      ['Consolidar la visibilidad', 'Consolida el registro separado del dinero personal frente al de tus actividades.'],
      ['Revisar y decidir', 'Revisa lo observado y elige qué profundizar.'],
    ],
    reserve: [
      ['Comprender y ordenar', 'Toma tu prioridad principal y completa el primer paso. Comprueba qué dinero está realmente disponible.'],
      ['Aclarar datos', 'Aclara tus respaldos y el margen real antes de decidir cualquier aporte.'],
      ['Explorar un ajuste', 'Explora un ajuste viable según las restricciones que confirmaste.'],
      ['Revisar y decidir', 'Revisa lo observado y elige qué profundizar.'],
    ],
    general: [
      ['Comprender y ordenar', 'Toma tu prioridad principal y completa el primer paso.'],
      ['Aclarar datos', 'Aclara los datos pendientes y explora un ajuste viable según tus restricciones.'],
      ['Comprobar o consolidar', 'Comprueba una oportunidad o consolida el orden de tus pagos y gastos, según tu objetivo.'],
      ['Revisar y decidir', 'Revisa lo observado y elige qué profundizar.'],
    ],
  }[theme];
  const ranges = [[1, 15], [16, 30], [31, 60], [61, 90]];
  return T.map(([focus, description], i) => ({ day_from: ranges[i][0], day_to: ranges[i][1], focus, description, evidence_refs: refs }));
}

// ───────── Datos que faltan ─────────
function missingData(r, cands, cov) {
  const has = (c) => cands.some((x) => x.candidate_id === c);
  const out = [];
  const add = (code, reason, related, rank) => out.push({ code, reason, related_priority: related, rank });
  if (has('P01')) add('income_expenses', 'Ingresos netos actuales, gastos personales por categoría y periodicidad. Sirven para calcular un balance; no se infieren desde metas.', 'P01', 100);
  if (has('P02') || has('P04') || r.code('Q09') === 'YES') add('debt_details', 'Saldos, cuotas, tasas, vencimientos y condiciones relevantes. Sirven para comparar alternativas de pago.', has('P02') ? 'P02' : 'P04', has('P02') ? 98 : 90);
  if (['I', 'B', 'M'].includes(r.route)) add('business_money', 'Dinero que recibes personalmente, costos de la actividad y separación con la caja operativa. Sirven para distinguir ventas, utilidad e ingreso personal.', 'P05', 85);
  if (has('P06') || has('P07') || r.status('Q08') !== 'answered' || r.status('Q15') !== 'answered') add('reserve_protection', 'Ahorro líquido accesible, gastos básicos y alcance de tus respaldos. Sirven para evaluar cuánto tiempo podrías cubrir tus necesidades.', has('P06') ? 'P06' : 'P07', 80);
  if (r.value('Q17') || r.value('Q18')) add('independence_goal', 'Edad actual exacta, monto objetivo, recursos y obligaciones. Sirven para explorar la viabilidad con supuestos visibles.', 'H_GOAL', 30);
  if (has('P03') || has('P09')) add('income_opportunity', 'Detalle de habilidades, experiencia, disponibilidad y demanda por comprobar. El test identifica potencial; no valida una oferta comercial.', has('P03') ? 'P03' : 'P09', 65);
  for (const s of cov.unknown_slots) {
    if (r.status(s) === 'unknown' || r.status(s) === 'declined') add(`unanswered_${s}`, `Respondiste «${r.status(s) === 'unknown' ? 'No lo sé' : 'Prefiero no responder'}» en la pregunta ${Number(s.slice(1))}; sin ese dato la lectura queda sin verificar.`, null, 20);
  }
  return out.sort((a, b) => b.rank - a.rank).slice(0, 5).map(({ rank, ...x }) => x);
}

// ───────── Hechos ─────────
function facts(r) {
  const fact = (code, label, slot) => {
    const a = r.get(slot);
    const known = a && a.status === 'answered' && typeof a.value === 'string';
    return {
      code,
      label,
      value: known ? { code: a.value, label: catalog.labelFor(a.variant_id, a.value) } : null,
      reason: known ? null : a && a.status === 'declined' ? 'declined' : a && a.status === 'unknown' ? 'unknown' : 'not_applicable',
      origin: 'declared',
      evidence_refs: r.refs(slot),
    };
  };
  return [
    fact('saving_range', 'Ahorro declarado', 'Q06'),
    fact('reserve_range', 'Reserva disponible', 'Q08'),
    fact('declared_debt', 'Deuda personal declarada', 'Q09'),
    fact('income_stability', r.route === 'N' ? 'Tiempo sin ingresos' : 'Estabilidad de ingresos', 'Q04'),
  ];
}

// ───────── Siguiente paso comercial ─────────
function nextStep(r, cands, missing) {
  const has = (c) => cands.some((x) => x.candidate_id === c);
  let reason = 'La evaluación profunda revisa tus cifras reales para convertir esta primera lectura en un análisis más detallado.';
  if (has('P02') || has('P04')) reason = 'Ya identificaste que necesitas ordenar tus pagos. La evaluación profunda revisa saldos, cuotas y tasas para entender mejor las opciones.';
  else if (has('P03') || has('P09') || has('P01')) reason = 'La evaluación profunda permite contrastar tu objetivo con tus ingresos, gastos y recursos actuales.';
  return { reason, product_id: 'evaluacion', benefits: ['Revisa saldos, cuotas, tasas y obligaciones', 'Contrasta tu objetivo con tus ingresos, gastos y recursos actuales', 'Prepara la base del Plan Maestro con datos reales'], missing_focus: missing[0] ? missing[0].code : null };
}

// ───────── Construcción ─────────
function build(session, answers, { monetary = null } = {}) {
  const r = reader(answers);
  const cov = coverage(r);
  const dims = dimensions(r);
  const m = monetary ? metrics.compute(monetary) : { metrics: [], invalid_metrics: [] };
  const balanceNegative = m.metrics.some((x) => x.code === 'balance' && Number(x.value) < 0);
  const cands = candidates(r, balanceNegative);
  const missing = missingData(r, cands, cov);
  const extraForPriorities = [...cands];
  if (cands.length < 3 && missing.length) extraForPriorities.push({ candidate_id: 'P10', ...PRIORITY_DEF.P10, why: missing[0].reason, evidence_refs: [] });
  const prios = pickDistinct(extraForPriorities, 3);
  const goalCand = r.variant('Q25') === 'Q25_GROWTH' && inList(r.code('Q25'), ['LT25', 'P25_49', 'P50_99', 'GE100'])
    || (r.variant('Q25') === 'Q25_START' && r.value('Q25') && r.value('Q25').kind === 'AMOUNT')
    || (r.value('Q17') && r.value('Q17').kind === 'AGE')
    || (r.value('Q18') && r.value('Q18').kind === 'AMOUNT');
  const findingPool = [...extraForPriorities];
  if (goalCand) findingPool.push({ candidate_id: 'H_GOAL', ...PRIORITY_DEF.H_GOAL, why: 'Meta declarada.', evidence_refs: r.refs('Q17', 'Q18', 'Q25') });
  const finds = pickDistinct(findingPool, 4);
  const prof = profileTitle(r, dims, cands, cov);
  const summary = profileSummary(r, dims, cands, cov);
  const action = firstAction(r, cands, prios);
  const att = attention(r, dims, cands);
  const retention = config.anonymousRetentionDays;

  return {
    result_id: null,
    session_id: session.id,
    answer_revision: session.revision,
    questionnaire_version: session.version_id,
    result_rules_version: RULES_VERSION,
    narrative_version: 'NARR_V1_ES',
    locale: session.locale,
    generated_at: db.now(),
    title: TITLE,
    scope_text: SCOPE_TEXT,
    status: 'ready',
    narrative_source: 'template',
    data_quality: cov.known_domains >= 7 ? 'sufficient' : cov.known_domains >= 4 ? 'partial' : 'limited',
    invalid_metrics: m.invalid_metrics,
    coverage: cov,
    preliminary: true,
    profile: { code: prof.code, title: prof.title, summary: summary.text, pending: summary.pending, evidence_refs: summary.evidence_refs },
    attention: att,
    facts: facts(r),
    metrics: m.metrics,
    dimensions: dims,
    strengths: strengths(r),
    findings: finds.map((c) => ({ candidate_id: c.candidate_id, title: FINDING_TITLE[c.candidate_id], explanation: findingText(c, r, m.metrics), state: c.candidate_id === 'H_GOAL' ? 'potential' : 'attention', group: c.group, evidence_refs: c.evidence_refs })),
    goal: goalSection(r),
    opportunities: opportunities(r),
    priorities: prios.map((c, i) => ({ order: i + 1, candidate_id: c.candidate_id, code: c.candidate_id, title: c.title, reason: findingText(c, r, m.metrics), evidence_refs: c.evidence_refs })),
    roadmap: roadmap(r, cands, action),
    first_action: action,
    missing_data: missing,
    save_result: { enabled: true, policy_text: `Si no creas una cuenta, tus respuestas se conservan ${retention} días desde tu última actividad.`, actions: ['create_account', 'login'] },
    next_step: nextStep(r, cands, missing),
  };
}

/** Genera y guarda el resultado de la revisión completada (único por sesión + revisión + versión). */
function generate(session, answers, options = {}) {
  const existing = db.one('SELECT * FROM ft_results WHERE session_id = ? AND answer_revision = ? AND rules_version = ?', session.id, session.revision, RULES_VERSION);
  if (existing) return existing;
  const now = db.now();
  let result;
  try {
    result = build(session, answers, options);
  } catch (err) {
    db.run(
      "INSERT INTO ft_results (session_id, answer_revision, rules_version, status, narrative_source, result_json, created_at, updated_at) VALUES (?, ?, ?, 'failed', 'template', ?, ?, ?)",
      session.id,
      session.revision,
      RULES_VERSION,
      JSON.stringify({ error: 'GENERATION_FAILED' }),
      now,
      now
    );
    return db.one('SELECT * FROM ft_results WHERE session_id = ? AND answer_revision = ? AND rules_version = ?', session.id, session.revision, RULES_VERSION);
  }
  const wantsAi = narrative.enabled();
  result.status = wantsAi ? 'pending' : 'ready';
  const r = db.run(
    'INSERT INTO ft_results (session_id, answer_revision, rules_version, status, narrative_source, result_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    session.id,
    session.revision,
    RULES_VERSION,
    result.status,
    'template',
    JSON.stringify(result),
    now,
    now
  );
  result.result_id = r.lastId;
  db.run('UPDATE ft_results SET result_json = ? WHERE id = ?', JSON.stringify(result), r.lastId);
  if (wantsAi) narrative.enqueue(r.lastId);
  return db.one('SELECT * FROM ft_results WHERE id = ?', r.lastId);
}

module.exports = { RULES_VERSION, TITLE, SCOPE_TEXT, STATE_LABEL, build, generate, reader, wordCount };
