'use strict';
// Resultado gratuito V2 de crecimiento patrimonial (RESULT_FREE_V2_ES, Fase 2).
// Documentos 02 §4.1, 04 §5.1, 05 (RFP_V1_ES) y 06 §4. Todo es determinista:
//   1) las reglas RFP leen el paquete de hechos y activan señales de protección y de
//      crecimiento (enfoque dual RFP-109: una alerta no borra la búsqueda de ingresos);
//   2) un catálogo de ACCIONES AUTORIZADAS decide qué pasos son elegibles o están
//      bloqueados (sin deuda nueva, sin gasto si Q23 = 0, sin horas que no existen);
//   3) se arman seis bloques compactos para el usuario.
// No hay cifras: el test no mide ingresos, gastos ni patrimonio. Q18, Q23 y Q25 son
// metas o presupuesto de exploración, nunca ingreso real.
const catalog = require('./catalog');
const knowledge = require('../knowledge');

const VERSION = 'RESULT_FREE_V2_ES';
const { STATUSES: S } = knowledge.evidence;

const CATEGORY_LABEL = { proteccion: 'Protección', creacion: 'Creación de valor', organizacion: 'Organización', construccion: 'Construcción' };
const SKILL_CODES = ['SALES', 'ADMIN', 'DIGITAL', 'TEACHING', 'MAKING', 'TECHNICAL', 'CREATIVE', 'LOGISTICS', 'ASSETS_NETWORK', 'OTHER'];
const TIME_LABEL = { HLT1: 'menos de una hora a la semana', H1_3: 'entre una y tres horas a la semana', H4_7: 'entre cuatro y siete horas a la semana', H8_14: 'entre ocho y catorce horas a la semana', H15PLUS: 'quince horas o más a la semana' };
const ROUTE_TEXT = {
  E: 'Trabajas como empleado',
  I: 'Trabajas por cuenta propia',
  B: 'Tienes un negocio',
  M: 'Combinas varias fuentes de ingresos',
  N: 'Hoy no recibes ingresos personales',
  O: 'Tus ingresos vienen de otras fuentes, como pensión, alquileres o apoyos',
  U: 'No sabemos todavía de dónde vienen tus ingresos',
};
const SITUATION_TEXT = {
  SHORTFALL: 'declaras que hoy no alcanzas a cubrir tus gastos básicos',
  JUST_ENOUGH: 'declaras que apenas cubres tus gastos',
  SURPLUS_NO_SAVING: 'declaras que te sobra algo, aunque no ahorras con regularidad',
  SAVING: 'declaras que ahorras con regularidad',
  SAVING_INVESTING: 'declaras que ahorras e inviertes con regularidad',
};

// ───────── Lectura del paquete de hechos ─────────
function view(pkg) {
  const byId = Object.fromEntries(pkg.facts.map((f) => [f.id, f]));
  const usable = (id) => byId[id] && (byId[id].status === S.DECLARADO || byId[id].status === S.CONFIRMADO);
  const code = (id) => (usable(id) && typeof byId[id].value === 'string' ? byId[id].value : null);
  const list = (id) => (usable(id) && Array.isArray(byId[id].value) ? byId[id].value : null);
  const obj = (id) => (usable(id) && byId[id].value && typeof byId[id].value === 'object' && !Array.isArray(byId[id].value) ? byId[id].value : null);
  const variant = (id) => (byId[id] ? byId[id].variant_id : null);
  const status = (id) => (byId[id] ? byId[id].status : S.NO_APLICA);
  const ref = (...ids) => ids.map((id) => byId[id] && byId[id].evidence_ref).filter(Boolean);
  const label = (id) => (byId[id] ? byId[id].label : null);
  const route = byId.Q03 && byId.Q03.status === S.DECLARADO ? byId.Q03.value : 'U';
  const skills = (list('Q24') || []).filter((c) => SKILL_CODES.includes(c));
  const time = code('Q22');
  const q23 = obj('Q23');
  return {
    pkg, byId, code, list, obj, variant, status, ref, label, route, skills, time,
    hasTime: Boolean(time) && time !== 'H0',
    lowTime: time === 'H0' || time === 'HLT1',
    noBudget: Boolean(q23 && q23.kind === 'CHOICE' && q23.code === 'ZERO'),
    businessNoDraw: route === 'B' && code('Q04') === 'ZERO',
  };
}

// ───────── Reglas RFP: señales ─────────
// Cada señal: { rule_id, kind: 'proteccion'|'crecimiento'|'restriccion', severity, title, why, evidence_refs }
function signals(v) {
  const out = [];
  const add = (rule_id, kind, severity, title, why, refs) => out.push({ rule_id, kind, severity, title, why, evidence_refs: refs });
  const q11 = v.code('Q11');
  const q11v = v.variant('Q11');

  // RFP-101 — viabilidad: gastos esenciales no cubiertos.
  if (v.code('Q02') === 'SHORTFALL' || (q11v === 'Q11_NO_DEBT' && q11 === 'SHORTFALL') || (v.variant('Q06') === 'Q06_NO_INCOME' && v.code('Q06') === 'USING_RESERVES')) {
    add('RFP-101', 'proteccion', 3, 'Tus gastos esenciales están bajo presión', 'Según declaras, hoy cubrir lo básico es difícil. Protegerlo es lo primero, sin dejar de buscar cómo generar más.', v.ref('Q02', 'Q06', 'Q11'));
  }
  // RFP-103 — pagos vencidos o imposibles.
  if ((q11v === 'Q11_CARD' && q11 === 'LATE') || (q11v && q11v !== 'Q11_NO_DEBT' && q11v !== 'Q11_UNCERTAIN' && ['OVERDUE', 'UNABLE'].includes(q11))) {
    add('RFP-103', 'proteccion', 3, 'Tienes pagos atrasados', 'Los atrasos suelen sumar intereses y cargos. Conviene ordenarlos antes de asumir cualquier compromiso nuevo.', v.ref('Q09', 'Q10', 'Q11'));
  }
  // RFP-102 — sin ingreso personal (pero un negocio sin retiro NO es desempleo).
  if (v.businessNoDraw) {
    add('RFP-107', 'proteccion', 2, 'Tu negocio todavía no te deja dinero para ti', 'Que el negocio no te pague a ti no significa que no tenga ventas. Primero hay que separar la caja del negocio de tu economía personal.', v.ref('Q03', 'Q04'));
  } else if (v.route === 'N' || v.code('Q04') === 'ZERO') {
    add('RFP-102', 'proteccion', 2, 'Hoy no recibes ingresos personales', 'Sin un ingreso propio, cada decisión depende de tus apoyos o reservas. Buscar una fuente realista es parte del plan.', v.ref('Q03', 'Q04'));
  }
  // RFP-107 — dinero del negocio mezclado con el personal.
  if (!v.businessNoDraw && (v.code('Q12') === 'MIXED' || v.code('Q05') === 'NO_SEPARATION')) {
    add('RFP-107', 'proteccion', 2, 'Mezclas el dinero del negocio con el personal', 'Sin separarlos no se puede saber cuánto gana realmente tu actividad ni cuánto puedes retirar.', v.ref('Q05', 'Q12'));
  }
  // RFP-104 — sin reserva.
  if (['ZERO', 'LT1M'].includes(v.code('Q08'))) {
    add('RFP-104', 'proteccion', 1, 'Tienes poca o ninguna reserva', 'Un imprevisto podría obligarte a endeudarte. La reserva se construye de forma gradual, según lo que de verdad puedas apartar.', v.ref('Q08'));
  }
  // RFP-105 — dependientes con respaldo insuficiente o desconocido.
  const q15 = v.list('Q15');
  const dependents = ['D1', 'D2', 'D3', 'D4PLUS'].includes(v.code('Q14'));
  if (dependents && (!q15 || q15.includes('NONE'))) {
    add('RFP-105', 'proteccion', 1, 'Otras personas dependen de ti y tu respaldo no está claro', 'Si tus ingresos se interrumpen, también les afecta a ellas. Vale la pena revisar con qué contarían.', v.ref('Q14', 'Q15'));
  }
  // RFP-106 — ingreso variable, concentrado o amenazado.
  if (['VARIABLE', 'SPORADIC', 'AT_RISK', 'TEMPORARY'].includes(v.code('Q04'))) {
    add('RFP-106', 'proteccion', 1, 'Tu ingreso es variable o podría interrumpirse', 'Con un ingreso que cambia, conviene planear con el mes bajo y no con el mes bueno.', v.ref('Q04'));
  }
  // RFP-108 — antecedente de fraude: bloquea recomendaciones transaccionales.
  if (v.code('Q20') === 'FRAUD') {
    add('RFP-108', 'restriccion', 2, 'Sufriste un fraude o engaño al invertir', 'Antes de cualquier inversión conviene verificar quién la ofrece y si está autorizado.', v.ref('Q19', 'Q20'));
  }
  // RFP-207 — sin presupuesto para actuar: solo pasos sin costo.
  if (v.noBudget) add('RFP-207', 'restriccion', 0, 'Sin dinero disponible para probar ideas', 'Todos los pasos sugeridos deben poder hacerse sin gastar.', v.ref('Q23'));
  // Tiempo muy limitado.
  if (v.lowTime) add('RFP-T01', 'restriccion', 0, 'Casi no tienes tiempo libre', 'Los pasos sugeridos deben caber en muy poco tiempo.', v.ref('Q22'));

  // ── Crecimiento (RFP-201 … 206, 211) ──
  const barrier = v.code('Q05');
  const growth = {
    E: { rule: 'RFP-201', NEGOTIATION: 'income_main', SALARY_LIMIT: 'income_main', SKILLS: 'skills', OPPORTUNITIES: 'income_main', TIME: 'margin' },
    I: { rule: 'RFP-202', CLIENTS: 'income_new_clients', PRICING: 'margin', COSTS: 'margin', CAPACITY: 'scalability', COLLECTION: 'margin' },
    B: { rule: 'RFP-203', SALES: 'income_new_clients', MARGIN: 'margin', CASHFLOW: 'margin', BUSINESS_DEBT: 'margin', OWNER_DEPENDENCE: 'scalability', NO_SEPARATION: 'margin' },
    M: { rule: 'RFP-204', DEMAND: 'income_new_clients', LOW_RETURN: 'margin', TIME: 'margin', COSTS: 'margin', INSTABILITY: 'recurrence' },
    N: { rule: 'RFP-205', JOB: 'income_entry', CLIENTS: 'income_entry', SKILLS: 'skills', RESOURCES: 'income_entry', AVAILABILITY: 'income_entry', DIRECTION: 'income_entry' },
  }[v.route];
  if (growth && growth[barrier]) add(growth.rule, 'crecimiento', 0, 'Palanca de ingresos según tu situación', null, v.ref('Q03', 'Q05'));
  if (v.skills.length && v.hasTime) add('RFP-206', 'crecimiento', 0, 'Habilidades declaradas y algo de tiempo', null, v.ref('Q22', 'Q24'));
  if (v.code('Q07') === 'CLEAR') add('RFP-201', 'crecimiento', 0, 'Ya ves una oportunidad concreta', null, v.ref('Q07'));
  return out.sort((a, b) => b.severity - a.severity);
}

// ───────── Catálogo de acciones autorizadas ─────────
// Ninguna requiere dinero ni deuda. `hours` es el esfuerzo de referencia.
const ACTIONS = [
  { id: 'ACT_PROT_PAYMENTS', category: 'proteccion', hours: 1, title: 'Haz la lista de tus pagos atrasados', instruction: 'Anota cada pago atrasado: a quién le debes, cuánto atraso tiene y desde cuándo. Con esa lista, llama o escribe al acreedor más urgente para preguntar qué opciones de pago ofrece.', done_when: 'Tienes la lista completa y hablaste con al menos un acreedor.', when: (v, sig) => has(sig, 'RFP-103') },
  { id: 'ACT_PROT_ESSENTIALS', category: 'proteccion', hours: 1, title: 'Identifica tus gastos esenciales de la semana', instruction: 'Escribe lo que no puedes dejar de pagar esta semana (comida, vivienda, transporte, salud) y qué parte ya tienes cubierta. Así sabrás exactamente cuánto falta.', done_when: 'Tienes la lista de esenciales y sabes cuáles están cubiertos.', when: (v, sig) => has(sig, 'RFP-101') },
  { id: 'ACT_ORG_SEPARATE', category: 'organizacion', hours: 1, title: 'Separa el dinero del negocio del tuyo', instruction: 'Durante una semana, anota por separado lo que entra y sale del negocio y lo que tomas para ti. No cambies nada todavía: solo registra.', done_when: 'Tienes una semana de registro con las dos columnas separadas.', when: (v, sig) => has(sig, 'RFP-107') },
  { id: 'ACT_PROT_FAMILY', category: 'proteccion', hours: 1, title: 'Revisa con qué contaría tu familia', instruction: 'Escribe qué pasaría con quienes dependen de ti si tus ingresos se detuvieran un mes: con qué ahorro, apoyo o seguro contarían de verdad.', done_when: 'Tienes por escrito con qué respaldo cuentan hoy.', when: (v, sig) => has(sig, 'RFP-105') },
  { id: 'ACT_EMP_RAISE', category: 'creacion', hours: 2, title: 'Prepara tu caso para ganar más en tu trabajo', instruction: 'Anota tres logros concretos de tu trabajo en el último año y averigua cuánto se paga por un puesto como el tuyo. Con eso, prepara una conversación con quien decide tu sueldo.', done_when: 'Tienes tus tres logros escritos y una referencia de lo que se paga por tu puesto.', when: (v) => v.route === 'E' && ['NEGOTIATION', 'SALARY_LIMIT', 'OPPORTUNITIES'].includes(v.code('Q05')) },
  { id: 'ACT_IND_PRICE', category: 'creacion', hours: 2, title: 'Revisa cuánto ganas realmente por trabajo', instruction: 'Toma tus últimos tres trabajos y anota lo que cobraste, lo que gastaste para hacerlo y las horas que te tomó. Así verás cuál te deja más por hora.', done_when: 'Tienes la tabla de tus tres últimos trabajos con cobro, costo y horas.', when: (v) => ['I', 'M'].includes(v.route) && ['PRICING', 'COSTS', 'COLLECTION', 'LOW_RETURN'].includes(v.code('Q05')) },
  { id: 'ACT_FIND_CLIENTS', category: 'creacion', hours: 2, title: 'Habla con cinco posibles clientes', instruction: 'Haz una lista de cinco personas o negocios que podrían necesitar lo que ofreces y pregúntales qué problema tienen hoy. No vendas todavía: escucha.', done_when: 'Conversaste con cinco personas y anotaste lo que te dijeron.', when: (v) => (['I', 'M', 'B'].includes(v.route) && ['CLIENTS', 'DEMAND', 'SALES'].includes(v.code('Q05'))) || (v.route === 'N' && v.code('Q05') === 'CLIENTS') },
  { id: 'ACT_BIZ_MARGIN', category: 'creacion', hours: 2, title: 'Calcula qué te deja cada producto o servicio', instruction: 'Elige tus tres productos o servicios principales y anota, para cada uno, el precio de venta y lo que te cuesta producirlo o entregarlo.', done_when: 'Conoces cuánto te deja cada uno de tus tres productos principales.', when: (v) => v.route === 'B' && ['MARGIN', 'CASHFLOW', 'BUSINESS_DEBT', 'OWNER_DEPENDENCE'].includes(v.code('Q05')) },
  { id: 'ACT_JOB_TARGET', category: 'creacion', hours: 2, title: 'Define tres empleos a los que sí puedes postular', instruction: 'Escribe tres puestos concretos que podrías hacer con lo que ya sabes y busca dónde se publican. Postula al menos a uno.', done_when: 'Tienes tres puestos identificados y una postulación enviada.', when: (v) => v.route === 'N' && ['JOB', 'DIRECTION', 'AVAILABILITY'].includes(v.code('Q05')) },
  { id: 'ACT_VALIDATE_OFFER', category: 'creacion', hours: 2, title: 'Prueba si alguien necesita lo que sabes hacer', instruction: 'Elige una de tus habilidades y piensa en un problema concreto que resuelve. Pregunta a tres personas de tu entorno si tienen ese problema y si pagarían por resolverlo. No inviertas dinero.', done_when: 'Hablaste con tres personas y sabes si el problema existe para ellas.', when: (v) => v.skills.length > 0 && v.hasTime },
  { id: 'ACT_ORG_DEBTS', category: 'organizacion', hours: 1, title: 'Reúne los datos de tus deudas', instruction: 'Para cada deuda anota el saldo, la cuota y la tasa de interés. Si no sabes alguno, pídelo a la entidad o a la persona a quien le debes.', done_when: 'Cada deuda tiene saldo, cuota y tasa anotados.', when: (v) => v.code('Q09') === 'YES' || v.status('Q09') === S.DESCONOCIDO },
  { id: 'ACT_ORG_TRACK', category: 'organizacion', hours: 1, title: 'Registra tus gastos durante siete días', instruction: 'Anota cada gasto, por pequeño que sea, durante una semana. Al final, márcalos como esenciales o no esenciales.', done_when: 'Tienes siete días de gastos anotados y clasificados.', when: (v) => ['NONE', 'MENTAL', 'PARTIAL', 'SEPARATE_PARTIAL'].includes(v.code('Q12')) || v.status('Q12') === S.DESCONOCIDO },
  { id: 'ACT_BUILD_RESERVE', category: 'construccion', hours: 1, title: 'Empieza tu reserva con un monto que puedas sostener', instruction: 'Elige un monto pequeño que puedas apartar cada semana sin dejar de cubrir lo básico, y sepáralo apenas recibas dinero.', done_when: 'Apartaste ese monto durante cuatro semanas seguidas.', when: (v, sig) => has(sig, 'RFP-104') && !has(sig, 'RFP-101') && !has(sig, 'RFP-102') && !has(sig, 'RFP-103') },
  { id: 'ACT_DEFINE_SKILL', category: 'organizacion', hours: 1, title: 'Describe una habilidad con un ejemplo real', instruction: 'Escribe una cosa que sabes hacer bien y un ejemplo concreto de cuándo la usaste y qué resultado tuvo. Es la base para buscar cómo generar ingresos con ella.', done_when: 'Tienes por escrito una habilidad y un ejemplo real de su resultado.', when: () => true },
];
const ACTION_BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
const has = (sig, id) => sig.some((s) => s.rule_id === id);

// Bloqueos: lo que el sistema nunca propondrá en este caso.
function blocked(v, sig) {
  const out = [];
  const add = (id, reason, rule) => out.push({ id, reason, rule_id: rule });
  if (has(sig, 'RFP-101') || has(sig, 'RFP-103')) add('NEW_CREDIT', 'No se propone pedir un crédito nuevo para cubrir esenciales o atrasos.', has(sig, 'RFP-103') ? 'RFP-103' : 'RFP-101');
  if (has(sig, 'RFP-101') || has(sig, 'RFP-103') || has(sig, 'RFP-108')) add('SPECULATIVE_INVESTMENT', 'No se propone invertir en algo arriesgado en esta situación.', has(sig, 'RFP-108') ? 'RFP-108' : 'RFP-101');
  if (v.noBudget) add('PAID_ACTION', 'No se propone ningún paso que cueste dinero.', 'RFP-207');
  if (v.lowTime) add('TIME_HEAVY', 'No se propone ningún paso de más de una hora a la semana.', 'RFP-T01');
  return out;
}

function eligibleActions(v, sig) {
  return ACTIONS.filter((a) => a.when(v, sig)).filter((a) => !(v.lowTime && a.hours > 1));
}

// Precedencia dura: protección urgente → organización necesaria → creación → construcción.
const PRECEDENCE = ['ACT_PROT_PAYMENTS', 'ACT_PROT_ESSENTIALS', 'ACT_ORG_SEPARATE', 'ACT_PROT_FAMILY', 'ACT_EMP_RAISE', 'ACT_IND_PRICE', 'ACT_BIZ_MARGIN', 'ACT_FIND_CLIENTS', 'ACT_JOB_TARGET', 'ACT_VALIDATE_OFFER', 'ACT_BUILD_RESERVE', 'ACT_ORG_DEBTS', 'ACT_ORG_TRACK', 'ACT_DEFINE_SKILL'];

function chooseFirst(eligible, sig) {
  const ids = eligible.map((a) => a.id);
  const pick = PRECEDENCE.find((id) => ids.includes(id)) || 'ACT_DEFINE_SKILL';
  return ACTION_BY_ID[pick];
}

// ───────── Palanca de crecimiento (siempre como hipótesis) ─────────
const LEVER = {
  income_main: { lever: 'ingresos', text: 'Aumentar el ingreso de tu trabajo principal', mech: 'Mostrar con logros concretos el valor que aportas y compararlo con lo que se paga por tu puesto.' },
  income_new_clients: { lever: 'ingresos', text: 'Conseguir más clientes para lo que ya haces', mech: 'Entender qué problema tienen tus posibles clientes antes de invertir en venderles.' },
  income_entry: { lever: 'ingresos', text: 'Abrir una primera fuente de ingresos', mech: 'Buscar el camino más corto entre lo que ya sabes hacer y alguien que lo necesite.' },
  margin: { lever: 'margen', text: 'Ganar más con lo que ya vendes o trabajas', mech: 'Conocer qué te deja cada trabajo o producto para cobrar mejor o reducir lo que no rinde.' },
  scalability: { lever: 'escalabilidad', text: 'Que tus ingresos no dependan solo de tus horas', mech: 'Ordenar y repetir lo que ya funciona para atender a más personas con el mismo esfuerzo.' },
  recurrence: { lever: 'recurrencia', text: 'Tener ingresos más repetibles', mech: 'Identificar qué clientes o fuentes podrían pagarte de forma periódica.' },
  skills: { lever: 'capacidad_futura', text: 'Convertir una habilidad en ingresos', mech: 'Precisar qué sabes hacer y probar si alguien lo necesita, sin gastar.' },
};
const GROWTH_KEY = {
  E: { NEGOTIATION: 'income_main', SALARY_LIMIT: 'income_main', OPPORTUNITIES: 'income_main', SKILLS: 'skills', TIME: 'margin' },
  I: { CLIENTS: 'income_new_clients', PRICING: 'margin', COSTS: 'margin', CAPACITY: 'scalability', COLLECTION: 'margin' },
  B: { SALES: 'income_new_clients', MARGIN: 'margin', CASHFLOW: 'margin', BUSINESS_DEBT: 'margin', OWNER_DEPENDENCE: 'scalability', NO_SEPARATION: 'margin' },
  M: { DEMAND: 'income_new_clients', LOW_RETURN: 'margin', TIME: 'margin', COSTS: 'margin', INSTABILITY: 'recurrence' },
  N: { JOB: 'income_entry', CLIENTS: 'income_entry', SKILLS: 'skills', RESOURCES: 'income_entry', AVAILABILITY: 'income_entry', DIRECTION: 'income_entry' },
};

function growthLever(v) {
  let key = (GROWTH_KEY[v.route] || {})[v.code('Q05')] || null;
  if (!key && v.skills.length && v.hasTime) key = 'skills';
  if (!key && v.code('Q07') && ['CLEAR', 'POSSIBLE'].includes(v.code('Q07'))) key = v.route === 'N' ? 'income_entry' : 'income_main';
  if (!key) {
    return { lever: null, status: S.DESCONOCIDO, confidence: 'insuficiente', title: 'Aún no podemos señalar una vía de crecimiento', hypothesis: null, question: '¿Qué sabes hacer que otras personas te hayan pedido o pagado antes?', evidence_refs: v.ref('Q05', 'Q22', 'Q24') };
  }
  const L = LEVER[key];
  const skillNames = v.skills.slice(0, 2).map((c) => catalog.labelFor(v.variant('Q24'), c).toLowerCase());
  const basis = skillNames.length ? ` Mencionaste ${skillNames.join(' y ')}; es una categoría declarada, todavía no una competencia comprobada.` : '';
  const timeText = v.time && TIME_LABEL[v.time] ? ` Cuentas con ${TIME_LABEL[v.time]}.` : '';
  return {
    lever: L.lever,
    key,
    status: S.HIPOTESIS,
    confidence: 'parcial', // una hipótesis nunca llega a «suficiente» solo con el test
    title: L.text,
    hypothesis: `${L.mech}${basis}${timeText} Es una hipótesis por comprobar: no sabemos aún si hay demanda ni cuánto podría generar.`,
    question: key === 'skills' || key === 'income_entry' ? '¿Qué tareas concretas has hecho con esa habilidad y para quién?' : '¿Cuánto recibes hoy, en neto, por tu trabajo o actividad principal?',
    evidence_refs: v.ref('Q03', 'Q05', 'Q07', 'Q22', 'Q24'),
  };
}

// ───────── Bloques ─────────
function startingPoint(v) {
  const parts = [];
  if (v.businessNoDraw) parts.push('Tienes un negocio que todavía no te deja dinero para tus gastos personales; eso no significa que no tenga ventas.');
  else parts.push(`${ROUTE_TEXT[v.route] || ROUTE_TEXT.U}.`);
  const sit = SITUATION_TEXT[v.code('Q02')];
  if (sit) parts.push(`Además, ${sit}.`);
  else if (v.status('Q02') === S.CONTRADICTORIO) parts.push('Algunas de tus respuestas sobre tu situación no coinciden entre sí; las revisamos abajo.');
  const goal = v.label('Q01');
  if (goal && v.status('Q01') === S.DECLARADO) parts.push(`Tu objetivo principal es: ${goal.toLowerCase()}.`);
  parts.push('Como el test no pregunta montos exactos, esta lectura no calcula ingresos, gastos, saldo ni patrimonio.');
  return { text: parts.join(' '), evidence_refs: v.ref('Q01', 'Q02', 'Q03', 'Q04') };
}

function resources(v) {
  const out = [];
  const add = (code, text, refs) => out.push({ code, text, status: S.DECLARADO, evidence_refs: refs });
  if (v.skills.length) {
    const names = v.skills.map((c) => catalog.labelFor(v.variant('Q24'), c).toLowerCase());
    add('SKILLS', `Habilidades que declaras: ${names.join(', ')}. Están por validar con ejemplos concretos.`, v.ref('Q24'));
  }
  if (v.hasTime && TIME_LABEL[v.time]) add('TIME', `Dispones de ${TIME_LABEL[v.time]} para avanzar.`, v.ref('Q22'));
  const assets = (v.list('Q13') || []).filter((c) => c !== 'NONE');
  if (assets.length) add('ASSETS', `Cuentas con: ${assets.map((c) => catalog.labelFor(v.variant('Q13'), c).toLowerCase()).join(', ')}.`, v.ref('Q13'));
  if (['M3_5', 'M6_11', 'GE12M'].includes(v.code('Q08'))) add('RESERVE', 'Tienes una reserva que te da margen ante imprevistos.', v.ref('Q08'));
  if (v.code('Q11') === 'ON_TIME' || v.code('Q11') === 'FULL') add('PAYMENTS', 'Mantienes tus pagos al día.', v.ref('Q11'));
  if (['RECORDED', 'SEPARATE_RECORDED'].includes(v.code('Q12'))) add('TRACKING', 'Registras y revisas tus gastos, lo que facilita medir cualquier mejora.', v.ref('Q12'));
  if (v.code('Q07') === 'CLEAR') add('OPPORTUNITY', 'Ya ves una oportunidad concreta para aumentar tus ingresos.', v.ref('Q07'));
  return out.slice(0, 4);
}

function missing(v, pkg) {
  const out = [];
  for (const c of pkg.contradictions) out.push({ code: c.id, question: c.question, reason: c.explanation });
  const ask = { Q02: '¿Cómo describirías tu mes habitual: te alcanza, apenas o te falta?', Q06: '¿Qué parte de tus ingresos logras guardar en un mes habitual?', Q08: '¿Para cuánto tiempo te alcanzaría lo que tienes guardado si dejaras de recibir ingresos?', Q09: '¿Tienes alguna deuda, aunque sea con familiares?', Q24: '¿Qué sabes hacer que otras personas te hayan pedido o pagado antes?', Q22: '¿Cuántas horas a la semana podrías dedicar a mejorar tus ingresos?' };
  for (const u of pkg.unknowns) if (ask[u.id]) out.push({ code: u.id, question: ask[u.id], reason: 'Respondiste «No lo sé» o preferiste no responder; no lo tomamos como cero.' });
  out.push({ code: 'ingreso_personal_neto_mes', question: pkg.missing_required_inputs[0].question, reason: 'Sin este dato no podemos calcular tu capacidad real de ahorro ni de inversión.' });
  return out.slice(0, 3);
}

/**
 * Construye el bloque V2. Devuelve { block, eligible, blocked, candidates } para que el
 * paquete de hechos registre la decisión del motor.
 */
function build(pkg) {
  const v = view(pkg);
  const sig = signals(v);
  const eligible = eligibleActions(v, sig);
  const blk = blocked(v, sig);
  const a = chooseFirst(eligible, sig);
  const lever = growthLever(v);
  const brakes = sig.filter((s) => s.kind === 'proteccion').slice(0, 2).map((s) => ({ rule_id: s.rule_id, title: s.title, why: s.why, evidence_refs: s.evidence_refs }));
  const protection = sig.some((s) => s.kind === 'proteccion' && s.severity >= 2);
  const firstWhy = a.category === 'proteccion' || a.category === 'organizacion'
    ? (brakes[0] ? `${brakes[0].title}. Ordenar esto primero evita que el problema crezca mientras exploras cómo generar más.` : 'Es la base para medir cualquier mejora posterior.')
    : 'Es una prueba pequeña y sin costo para comprobar si tu vía de crecimiento tiene sentido antes de invertir tiempo o dinero.';

  const block = {
    version: VERSION,
    rules_version: knowledge.VERSIONS.rules,
    knowledge_version: knowledge.VERSIONS.knowledge,
    starting_point: startingPoint(v),
    brakes,
    resources: resources(v),
    opportunity: lever,
    first_action: {
      action_id: a.id,
      category: a.category,
      category_label: CATEGORY_LABEL[a.category],
      title: a.title,
      instruction: a.instruction,
      why: firstWhy,
      effort: a.hours <= 1 ? 'Una hora o menos' : 'Unas dos horas',
      capital: 'Sin costo',
      done_when: a.done_when,
    },
    dual_focus: protection && lever.status === S.HIPOTESIS,
    missing: missing(v, pkg),
    blocked: blk.map((b) => b.reason),
    scope_note: 'Es una orientación inicial a partir de tus respuestas al test. Para calcular cifras y diseñar tu plan patrimonial necesitamos tus montos reales.',
    next_step: 'La evaluación profunda añade tus cifras reales, tu experiencia y tus recursos para comprobar oportunidades y armar un plan por etapas.',
  };
  return {
    block,
    signals: sig.map((s) => ({ rule_id: s.rule_id, kind: s.kind, severity: s.severity })),
    eligible: eligible.map((x) => x.id),
    blocked: blk,
    candidates: lever.status === S.HIPOTESIS ? [{ candidate_id: `OPP_${lever.key.toUpperCase()}`, lever: lever.lever, status: S.HIPOTESIS, evidence_refs: lever.evidence_refs, scores: null }] : [],
  };
}

module.exports = { VERSION, ACTIONS, ACTION_BY_ID, PRECEDENCE, build, view, signals };
