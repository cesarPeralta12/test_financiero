'use strict';
// Catálogo inmutable FREE_25_V2_ES: 25 slots (Q01–Q25) y sus variantes. Cada slot
// resuelve exactamente una variante según las respuestas activas previas. La
// elección es determinista: ningún modelo participa. Los textos y códigos siguen la
// especificación «Test gratuito de Día Uno» v1.1.
const crypto = require('node:crypto');

const VERSION_ID = 'FREE_25_V2_ES';
const ANNOTATION_VERSION = 'ANN_V1_ES';
const LOCALE = 'es';

/** «CODE = Etiqueta; CODE2 = Etiqueta» → [{code, label}] */
function opts(spec) {
  return spec
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf('=');
      return { code: s.slice(0, i).trim(), label: s.slice(i + 1).trim() };
    });
}

const SPECIAL = [
  { code: 'DK', label: 'No lo sé' },
  { code: 'PNA', label: 'Prefiero no responder' },
];
const SPECIAL_CODES = SPECIAL.map((s) => s.code);

// Redacción de ingresos por ruta (sección 2 de la especificación).
const INCOME_WORDING = {
  E: 'tu sueldo',
  I: 'lo que te queda después de los gastos de tu trabajo',
  B: 'el dinero que recibes personalmente de tu negocio después de sus gastos',
  M: 'la suma de tus ingresos personales',
  O: 'tus ingresos personales',
  U: 'tus ingresos personales',
  N: 'tus ingresos personales',
};

const noIncome = (c) => c.route === 'N' || c.code('Q04') === 'ZERO';
const isBM = (c) => c.route === 'B' || c.route === 'M';

// ───────── Q04 y Q05 por ruta ─────────
const Q04 = {
  E: ['¿Qué tan estable consideras tu empleo durante los próximos 12 meses?', 'STABLE = Muy estable; SOME_UNCERTAINTY = Con cierta incertidumbre; AT_RISK = En riesgo de terminar; TEMPORARY = Temporal o por terminar'],
  I: ['¿Qué tan constantes han sido tus ingresos personales por tu trabajo independiente en los últimos seis meses?', 'STABLE = Constantes; VARIABLE = Cambian bastante; SPORADIC = Esporádicos; ZERO = No me ha quedado dinero; NEW = Llevo menos de seis meses'],
  B: ['¿Qué tan constante ha sido el dinero que tu negocio te deja para tus gastos personales en los últimos seis meses?', 'STABLE = Constante; VARIABLE = Cambia bastante; SPORADIC = Solo algunos meses; ZERO = Todavía no me deja dinero; NEW = Llevo menos de seis meses'],
  M: ['¿Qué tan estable ha sido la suma de tus ingresos personales en los últimos seis meses?', 'STABLE = Constante; VARIABLE = Cambia bastante; SPORADIC = Solo algunos meses; ZERO = Ahora no recibo ingresos; NEW = Tengo menos de seis meses con estas fuentes'],
  N: ['¿Desde hace cuánto tiempo no recibes ingresos personales?', 'LT1M = Menos de un mes; M1_3 = De uno a tres meses; M4_6 = De cuatro a seis meses; GT6M = Más de seis meses; NEVER = Aún no he generado ingresos propios'],
  O: ['¿Qué tan estables son los ingresos que recibes de esas otras fuentes?', 'STABLE = Regulares y previsibles; VARIABLE = Cambian de un mes a otro; SPORADIC = Los recibo ocasionalmente; AT_RISK = Podrían interrumpirse pronto; ZERO = Actualmente no los estoy recibiendo'],
  U: ['¿Qué tan constantes han sido tus ingresos personales en los últimos seis meses?', 'STABLE = Constantes; VARIABLE = Cambian bastante; SPORADIC = Esporádicos; ZERO = Ahora no recibo ingresos; NEW = No tengo seis meses de referencia'],
};

const Q05 = {
  E: ['¿Cuál es el principal obstáculo para ganar más en tu trabajo?', 'SALARY_LIMIT = Mi puesto tiene poco margen salarial; SKILLS = Me faltan habilidades o certificaciones; OPPORTUNITIES = No encuentro mejores oportunidades; TIME = Tengo poco tiempo; NEGOTIATION = Me cuesta negociar mi sueldo; NONE = No veo un obstáculo claro'],
  I: ['¿Qué te impide ganar más trabajando por cuenta propia?', 'CLIENTS = Me faltan clientes; PRICING = Cobro poco; COSTS = Mis costos son altos; CAPACITY = No me alcanza el tiempo o la capacidad; COLLECTION = Me pagan tarde; NONE = No veo un obstáculo claro'],
  B: ['¿Qué impide que tu negocio te deje más dinero personalmente?', 'SALES = Ventas insuficientes; MARGIN = Poco margen después de costos; CASHFLOW = Falta de liquidez o cobros tardíos; BUSINESS_DEBT = Pagos de deuda del negocio; OWNER_DEPENDENCE = Todo depende de mi trabajo; NO_SEPARATION = No distingo bien el dinero del negocio del personal; NONE = No veo un obstáculo claro'],
  M: ['¿Cuál es el principal obstáculo para aumentar la suma de tus ingresos personales?', 'DEMAND = Falta de oportunidades o clientes; LOW_RETURN = Poco ingreso por el trabajo realizado; TIME = Falta de tiempo; COSTS = Costos o pagos que absorben lo ganado; INSTABILITY = Fuentes inestables; NONE = No veo un obstáculo claro'],
  N: ['¿Cuál es tu principal dificultad para empezar a generar ingresos?', 'JOB = No encuentro empleo; CLIENTS = No encuentro clientes; SKILLS = Necesito desarrollar habilidades; RESOURCES = Me faltan recursos para empezar; AVAILABILITY = Tengo limitaciones de tiempo o disponibilidad; DIRECTION = No sé por dónde empezar'],
  O: ['¿Qué limita principalmente los ingresos que recibes de esas fuentes?', 'FIXED = El monto es fijo; VARIABLE = Los pagos son variables o se atrasan; DEPENDENCE = Dependo de otra persona o entidad; YIELD = Lo que recibo es insuficiente; NONE = No veo un obstáculo claro'],
  U: ['¿Cuál es tu principal dificultad para aumentar tus ingresos personales?', 'OPPORTUNITIES = Pocas oportunidades; SKILLS = Me faltan habilidades; TIME = Tengo poco tiempo; RESOURCES = Me faltan recursos; DIRECTION = No sé por dónde empezar; NONE = No veo un obstáculo claro'],
};

const Q11_PAYMENT_OPTIONS = 'ON_TIME = Al día; OCCASIONAL_DELAY = Con retrasos ocasionales; OVERDUE = Con pagos vencidos; UNABLE = Actualmente no puedo pagarlos; NOT_DUE = Aún no tengo pagos exigibles';

const DEBT_VARIANTS = ['Q11_CARD', 'Q11_FAMILY', 'Q11_LOAN', 'Q11_HOME', 'Q11_BUSINESS', 'Q11_MULTI', 'Q11_DEBT'];

/** Variante de Q11 según Q09 y Q10 (secciones 7 y 12). */
function q11Variant(c) {
  const q09 = c.code('Q09');
  if (q09 === 'NO') return 'Q11_NO_DEBT';
  if (q09 !== 'YES') return 'Q11_UNCERTAIN';
  const types = c.list('Q10');
  if (!types) return 'Q11_DEBT'; // Q10 DK o PNA
  if (types.length >= 2) return 'Q11_MULTI';
  return { CARD: 'Q11_CARD', INFORMAL: 'Q11_FAMILY', CONSUMER: 'Q11_LOAN', HOME: 'Q11_HOME', BUSINESS_PERSONAL: 'Q11_BUSINESS', OTHER: 'Q11_DEBT' }[types[0]];
}

const q11Text = {
  Q11_CARD: '¿Cómo sueles pagar tus tarjetas de crédito?',
  Q11_FAMILY: '¿Cómo estás cumpliendo los pagos del dinero que debes a familiares u otras personas?',
  Q11_LOAN: '¿Cómo estás cumpliendo las cuotas de tu préstamo personal?',
  Q11_HOME: '¿Cómo estás cumpliendo las cuotas de tu crédito de vivienda?',
  Q11_BUSINESS: '¿Cómo estás cumpliendo los pagos de la deuda del negocio que debes asumir personalmente?',
  Q11_MULTI: '¿Cómo estás cumpliendo los pagos del conjunto de tus deudas?',
  Q11_DEBT: '¿Cómo estás cumpliendo los pagos de tus deudas?',
};

const v = (o) => o; // cada variante es un objeto plano

// ───────── Slots y variantes ─────────
// Cada variante: { id, when(ctx), text|render(ctx) → {text, help}, type, options|choices, ... }
const SLOTS = [];
function slot(ordinal, semantic_key, variants) {
  SLOTS.push({ slot_id: `Q${String(ordinal).padStart(2, '0')}`, ordinal, semantic_key, variants });
}

slot(1, 'Q01_GOAL', [
  v({
    id: 'Q01_GOAL', when: () => true, type: 'single',
    text: '¿Cuál es tu principal objetivo financiero?',
    options: opts('INCREASE_INCOME = Aumentar mis ingresos; CONTROL_EXPENSES = Ordenar mis gastos; PAY_DEBT = Reducir mis deudas; BUILD_RESERVE = Crear un ahorro para emergencias; BUILD_WEALTH = Construir patrimonio; FINANCIAL_FREEDOM = Dejar de depender de mi trabajo; FIND_DIRECTION = Necesito orientación'),
  }),
]);

slot(2, 'Q02_SITUATION', [
  v({
    id: 'Q02_SITUATION', when: () => true, type: 'single',
    text: '¿Cómo describirías tu situación económica actual?',
    options: opts('SHORTFALL = No alcanzo a cubrir mis gastos básicos; JUST_ENOUGH = Apenas cubro mis gastos; SURPLUS_NO_SAVING = Me sobra algo pero no ahorro con regularidad; SAVING = Ahorro con regularidad; SAVING_INVESTING = Ahorro e invierto con regularidad'),
  }),
]);

slot(3, 'Q03_INCOME_SOURCE', [
  v({
    id: 'Q03_INCOME_SOURCE', when: () => true, type: 'single',
    text: '¿De dónde provienen principalmente tus ingresos personales?',
    help: 'Si tienes varias fuentes relevantes, elige esa opción. «Recibo ingresos de otras fuentes» incluye pensión, alquileres, inversiones y apoyo económico.',
    options: opts('E = Trabajo como empleado; I = Trabajo por cuenta propia; B = Tengo un negocio o empresa; M = Tengo varias fuentes de ingresos; N = Actualmente no tengo ingresos; O = Recibo ingresos de otras fuentes'),
  }),
]);

slot(4, 'Q04_STABILITY', Object.keys(Q04).map((r) =>
  v({ id: `Q04_${r}`, when: (c) => c.route === r, type: 'single', text: Q04[r][0], options: opts(Q04[r][1]) })
));

slot(5, 'Q05_MAIN_BARRIER', Object.keys(Q05).map((r) =>
  v({ id: `Q05_${r}`, when: (c) => c.route === r, type: 'single', text: Q05[r][0], options: opts(Q05[r][1]) })
));

slot(6, 'Q06_SAVING_RATE', [
  v({
    id: 'Q06_REGULAR', when: (c) => !noIncome(c), type: 'single',
    render: (c) => ({
      text: '¿Qué porcentaje de tus ingresos personales logras ahorrar en un mes habitual?',
      help: `Considera ${INCOME_WORDING[c.route] || INCOME_WORDING.U}.${isBM(c) ? ' Los ingresos del empresario excluyen la facturación y el dinero que permanece en la empresa.' : ''}`,
    }),
    options: opts('ZERO = No ahorro; LT10 = Más de 0 y menos de 10%; P10_19 = De 10 a menos de 20%; P20_29 = De 20 a menos de 30%; GE30 = 30% o más; NO_INCOME = Actualmente no recibo ingresos personales'),
  }),
  v({
    id: 'Q06_NO_INCOME', when: noIncome, type: 'single',
    text: 'En este momento, ¿puedes guardar dinero sin usar tus ahorros anteriores ni endeudarte?',
    options: opts('SUPPORT_SURPLUS = Sí, de apoyos u otros recursos que recibo; ZERO = No puedo guardar dinero; USING_RESERVES = Estoy consumiendo mis ahorros'),
  }),
]);

const Q07_TEXT = {
  E: '¿Qué posibilidades ves de aumentar tu sueldo o tus ingresos adicionales en los próximos 12 meses?',
  I: '¿Qué posibilidades ves de aumentar los ingresos netos de tu trabajo en los próximos 12 meses?',
  B: '¿Qué posibilidades ves de aumentar el dinero que recibes de tu negocio en los próximos 12 meses?',
};
slot(7, 'Q07_INCOME_POTENTIAL', [
  v({
    id: 'Q07_INCOME_POTENTIAL', when: (c) => !noIncome(c), type: 'single',
    render: (c) => ({ text: Q07_TEXT[c.route] || '¿Qué posibilidades ves de aumentar tus ingresos personales en los próximos 12 meses?' }),
    options: opts('CLEAR = Ya tengo una oportunidad concreta; POSSIBLE = Veo posibilidades, pero no un plan; LOW = Lo veo difícil con mi situación actual; NONE = No veo posibilidades por ahora'),
  }),
  v({
    id: 'Q07_START', when: noIncome, type: 'single',
    text: '¿Qué posibilidades ves de empezar a recibir ingresos personales en los próximos 12 meses?',
    options: opts('CLEAR = Ya tengo una oportunidad concreta; POSSIBLE = Veo posibilidades, pero no un plan; LOW = Lo veo difícil con mi situación actual; NONE = No veo posibilidades por ahora'),
  }),
]);

const Q08_SUBJECT = { E: 'tu sueldo', I: 'los ingresos de tu trabajo', B: 'el dinero que recibes de tu negocio' };
slot(8, 'Q08_RESERVE', [
  v({
    id: 'Q08_RESERVE', when: (c) => !noIncome(c), type: 'single',
    render: (c) => ({
      text: `Si ${Q08_SUBJECT[c.route] || 'tus ingresos personales'} se interrumpiera${Q08_SUBJECT[c.route] ? '' : 'n'} hoy, ¿cuánto tiempo podrías cubrir tus gastos básicos con dinero disponible?`,
      help: 'Considera solo dinero accesible, sin préstamos ni venta de bienes. No incluyas la caja del negocio comprometida para operar.',
    }),
    options: opts('ZERO = No tengo reserva; LT1M = Menos de un mes; M1_2 = De uno a menos de tres meses; M3_5 = De tres a menos de seis meses; M6_11 = De seis a menos de doce meses; GE12M = Doce meses o más'),
  }),
  v({
    id: 'Q08_NO_INCOME', when: noIncome, type: 'single',
    text: 'Sin contar ingresos nuevos, ¿cuánto tiempo podrías cubrir tus gastos básicos con el dinero que tienes disponible?',
    help: 'Considera solo dinero accesible, sin préstamos ni venta de bienes.',
    options: opts('ZERO = No tengo reserva; LT1M = Menos de un mes; M1_2 = De uno a menos de tres meses; M3_5 = De tres a menos de seis meses; M6_11 = De seis a menos de doce meses; GE12M = Doce meses o más'),
  }),
]);

slot(9, 'Q09_DEBT_STATUS', [
  v({
    id: 'Q09_DEBT_STATUS', when: () => true, type: 'single',
    render: (c) => ({
      text: '¿Actualmente tienes deudas personales pendientes de pago?',
      help: `Incluye préstamos, tarjetas, compras a cuotas y dinero debido a otras personas.${isBM(c) ? ' Incluye la deuda del negocio solo si debes responder con tu dinero personal; no incluyas obligaciones exclusivas de la empresa.' : ''}`,
    }),
    options: opts('YES = Sí; NO = No'),
  }),
]);

slot(10, 'Q10_DEBT_DETAIL', [
  v({
    id: 'Q10_TYPES', when: (c) => c.code('Q09') === 'YES', type: 'multi', min_selected: 1, max_selected: 6,
    text: '¿Qué tipos de deudas personales tienes?',
    options: opts('CARD = Tarjetas de crédito; CONSUMER = Préstamo personal o de consumo; HOME = Crédito de vivienda; BUSINESS_PERSONAL = Deuda de negocio que debo pagar personalmente; INFORMAL = Dinero debido a familiares u otras personas; OTHER = Otra deuda'),
  }),
  v({
    id: 'Q10_NO_DEBT', when: (c) => c.code('Q09') === 'NO', type: 'single',
    text: '¿Prevés necesitar un préstamo para cubrir tus gastos básicos durante los próximos tres meses?',
    options: opts('YES = Sí; MAYBE = Es posible; NO = No'),
  }),
  v({
    id: 'Q10_UNCERTAIN', when: (c) => c.code('Q09') === null, type: 'single',
    text: '¿Tienes identificados los pagos u obligaciones que podrían estar pendientes?',
    options: opts('ALL = Sí, todos; SOME = Solo algunos; NONE = No los tengo identificados'),
  }),
]);

slot(11, 'Q11_PAYMENT_BEHAVIOR', [
  ...DEBT_VARIANTS.map((id) =>
    v({
      id, when: (c) => c.code('Q09') === 'YES' && q11Variant(c) === id, type: 'single', text: q11Text[id],
      options: id === 'Q11_CARD'
        ? opts('FULL = Pago todo el saldo del mes; ABOVE_MIN = Pago más del mínimo, sin cancelar todo; MINIMUM = Pago solo el mínimo; LATE = Tengo pagos atrasados; NOT_DUE = Todavía no venció el primer pago')
        : opts(Q11_PAYMENT_OPTIONS),
    })
  ),
  v({
    id: 'Q11_NO_DEBT', when: (c) => c.code('Q09') === 'NO', type: 'single',
    text: '¿Cómo estás cubriendo tus gastos básicos actualmente?',
    options: opts('CURRENT = Con mis ingresos actuales; SUPPORT = Con apoyo de otras personas; RESERVES = Con ahorros; MIX = Con una combinación de esas fuentes; SHORTFALL = No logro cubrirlos'),
  }),
  v({
    id: 'Q11_UNCERTAIN', when: (c) => c.code('Q09') === null, type: 'single',
    text: '¿Tienes algún pago básico que no puedas cubrir a su vencimiento?',
    options: opts('YES = Sí; NO = No'),
  }),
]);

slot(12, 'Q12_EXPENSE_TRACKING', [
  v({
    id: 'Q12_EXPENSE_TRACKING', when: (c) => !isBM(c), type: 'single',
    render: (c) => ({
      text: c.route === 'N' ? '¿Cómo controlas tus gastos personales y el dinero disponible para cubrirlos?' : '¿Cómo controlas actualmente tus gastos personales?',
    }),
    options: opts('RECORDED = Los registro y reviso con regularidad; PARTIAL = Registro solo una parte; MENTAL = Los llevo de memoria; NONE = No llevo un control'),
  }),
  v({
    id: 'Q12_BM', when: isBM, type: 'single',
    text: '¿Cómo controlas tus gastos personales frente a los del negocio o tus otras actividades?',
    options: opts('SEPARATE_RECORDED = Los separo, registro y reviso; SEPARATE_PARTIAL = Los separo, pero registro poco; MIXED = Mezclo dinero personal con otras actividades; NONE = No llevo un control'),
  }),
]);

slot(13, 'Q13_ASSETS', [
  v({
    id: 'Q13_ASSETS', when: () => true, type: 'multi', min_selected: 1, max_selected: 7, exclusive: ['NONE'],
    text: '¿Qué bienes, ahorros o inversiones tienes actualmente a tu nombre?',
    help: 'Tener un bien no significa poder usarlo de inmediato para pagar gastos; no pedimos su valoración.',
    options: opts('CASH = Ahorros o dinero disponible; HOME = Vivienda; PROPERTY = Otro inmueble o terreno; VEHICLE = Vehículo; BUSINESS = Participación en un negocio; INVESTMENTS = Inversiones financieras; OTHER = Otros bienes; NONE = Ninguno'),
  }),
]);

slot(14, 'Q14_DEPENDENTS', [
  v({
    id: 'Q14_DEPENDENTS', when: () => true, type: 'single',
    text: '¿Cuántas personas dependen económicamente de tus ingresos o de los recursos que administras?',
    help: 'No te cuentes a ti. Si no recibes ingresos, piensa en los recursos que administras.',
    options: opts('D0 = Ninguna; D1 = Una; D2 = Dos; D3 = Tres; D4PLUS = Cuatro o más'),
  }),
]);

const PROTECTION_OPTIONS = 'RESERVE = Ahorros disponibles; INSURANCE = Seguro con cobertura de ingresos o incapacidad; SUPPORT = Apoyo de familiares u otras personas; OTHER_INCOME = Otra fuente de ingresos; OTHER = Otro respaldo; NONE = Ninguno';
const hasDependents = (c) => ['D1', 'D2', 'D3', 'D4PLUS'].includes(c.code('Q14'));
const prot = (id, cond, text) =>
  v({ id, when: cond, type: 'multi', min_selected: 1, max_selected: 5, exclusive: ['NONE'], text, options: opts(PROTECTION_OPTIONS), help: 'Declarar un seguro no garantiza una cobertura específica.' });
slot(15, 'Q15_PROTECTION', [
  prot('Q15_FAMILY', (c) => hasDependents(c) && c.route !== 'N', 'Si no pudieras generar ingresos durante varios meses, ¿con qué respaldo contarían tú y las personas que dependen de ti?'),
  prot('Q15_FAMILY_N', (c) => hasDependents(c) && c.route === 'N', 'Si el apoyo o los recursos que hoy cubren sus gastos se interrumpieran, ¿con qué respaldo contarían tú y las personas a tu cargo?'),
  prot('Q15_SELF', (c) => c.code('Q14') === 'D0' && c.route !== 'N', 'Si no pudieras generar ingresos durante varios meses, ¿con qué respaldo contarías?'),
  prot('Q15_SELF_N', (c) => c.code('Q14') === 'D0' && c.route === 'N', 'Si los recursos que hoy cubren tus gastos se interrumpieran, ¿con qué respaldo contarías?'),
  prot('Q15_NEUTRAL', (c) => c.code('Q14') === null, 'Ante una interrupción de los recursos que cubren tus gastos, ¿con qué respaldo contarías?'),
]);

slot(16, 'Q16_AGE_RANGE', [
  v({
    id: 'Q16_AGE_RANGE', when: () => true, type: 'single',
    text: '¿En qué rango de edad te encuentras?',
    options: opts('A18_24 = 18 a 24 años; A25_34 = 25 a 34 años; A35_44 = 35 a 44 años; A45_54 = 45 a 54 años; A55_64 = 55 a 64 años; A65PLUS = 65 años o más'),
  }),
]);

const AGE_RANGES = { A18_24: [18, 24], A25_34: [25, 34], A35_44: [35, 44], A45_54: [45, 54], A55_64: [55, 64], A65PLUS: [65, Infinity] };

slot(17, 'Q17_FREEDOM_AGE', [
  v({
    id: 'Q17_FREEDOM_AGE', when: () => true, type: 'age_or_choice',
    text: '¿A qué edad te gustaría poder cubrir tus gastos sin depender de tu trabajo?',
    help: 'Puede ser con recursos propios u otras fuentes. Si ya no dependes de trabajar, puedes indicarlo.',
    choices: opts('ALREADY = Ya puedo hacerlo; NOT_SET = Aún no tengo una edad en mente'),
  }),
]);

slot(18, 'Q18_TARGET_MONTHLY_INCOME', [
  v({
    id: 'Q18_TARGET_MONTHLY_INCOME', when: () => true, type: 'money_or_choice',
    text: '¿Cuánto dinero necesitarías al mes para cubrir tus gastos y vivir como deseas sin depender de tu trabajo?',
    help: 'Indica un monto personal mensual aproximado a precios de hoy; no son las ventas de una empresa.',
    choices: opts('NOT_SET = Todavía no tengo un monto en mente'),
  }),
]);

slot(19, 'Q19_INVESTMENT_HISTORY', [
  v({
    id: 'Q19_INVESTMENT_HISTORY', when: () => true, type: 'single',
    text: '¿Has invertido dinero para intentar generar ganancias y cuál fue tu experiencia?',
    help: 'Puede ser en un negocio, bienes u otras inversiones.',
    options: opts('NEVER = Nunca he invertido; NO_LOSS = He invertido y no he tenido pérdidas; LOSS = He invertido y he tenido pérdidas; UNKNOWN_RESULT = He invertido, pero no conozco el resultado'),
  }),
]);

slot(20, 'Q20_LEARNING_OR_LOSS', [
  v({
    id: 'Q20_LOSS_CAUSE', when: (c) => c.code('Q19') === 'LOSS', type: 'single',
    text: '¿Cuál fue la principal causa de esa pérdida?',
    options: opts('FRAUD = Fraude o engaño; LACK_INFO = No entendí bien la inversión; MARKET = Bajó su valor o cambiaron las condiciones; BUSINESS = El negocio no funcionó como esperaba; LIQUIDITY = Tuve que retirar o vender antes de tiempo; OTHER = Otra causa'),
  }),
  v({
    id: 'Q20_BARRIER', when: (c) => c.code('Q19') === 'NEVER', type: 'single',
    text: '¿Cuál es la principal razón por la que todavía no has invertido?',
    options: opts('NO_MONEY = No tengo dinero disponible; KNOWLEDGE = No sé cómo empezar; FEAR = Me preocupa perderlo; PRIORITIES = Tengo otras prioridades; NO_INTEREST = No me interesa por ahora'),
  }),
  v({
    id: 'Q20_PROCESS', when: (c) => c.code('Q19') === 'NO_LOSS', type: 'single',
    text: '¿Cómo decides dónde invertir?',
    options: opts('ANALYSIS = Comparo opciones y reviso riesgos; ADVICE = Me apoyo en asesoramiento; RECOMMENDATION = Sigo recomendaciones de conocidos; INTUITION = Me guío principalmente por intuición u oportunidad'),
  }),
  v({
    id: 'Q20_TRACKING', when: (c) => c.code('Q19') === 'UNKNOWN_RESULT' || c.code('Q19') === null, type: 'single',
    text: '¿Qué tan fácil te resulta identificar cuánto aportaste y cuánto recuperaste de tus inversiones?',
    options: opts('CLEAR = Tengo esa información clara; PARTIAL = Tengo una parte; NONE = No tengo registros claros; NOT_APPLICABLE = No corresponde a mi situación'),
  }),
]);

slot(21, 'Q21_RISK_PREFERENCE', [
  v({
    id: 'Q21_RISK_PREFERENCE', when: () => true, type: 'single',
    text: 'Si tuvieras dinero disponible después de cubrir gastos, deudas prioritarias y emergencias, ¿qué preferirías?',
    options: opts('PRESERVE = Priorizar conservar el dinero aunque gane poco; BALANCED = Aceptar variaciones moderadas buscando crecer; HIGH_VARIATION = Aceptar variaciones fuertes y posibles pérdidas buscando mayor ganancia; LEARN_FIRST = Entender mejor las opciones antes de decidir; NO_INTEREST = No invertir por ahora'),
  }),
]);

slot(22, 'Q22_WEEKLY_TIME', [
  v({
    id: 'Q22_WEEKLY_TIME', when: () => true, type: 'single',
    text: '¿Cuánto tiempo podrías dedicar cada semana a mejorar tu situación financiera?',
    help: 'Incluye organizar cuentas, aprender y trabajar en una fuente de ingresos.',
    options: opts('H0 = No tengo tiempo disponible por ahora; HLT1 = Menos de una hora; H1_3 = De una a menos de cuatro horas; H4_7 = De cuatro a menos de ocho horas; H8_14 = De ocho a menos de quince horas; H15PLUS = Quince horas o más'),
  }),
]);

slot(23, 'Q23_SAFE_ACTION_BUDGET', [
  v({
    id: 'Q23_SAFE_ACTION_BUDGET', when: (c) => !noIncome(c), type: 'money_or_choice',
    render: (c) => ({
      text: 'Durante el próximo mes, ¿cuánto dinero podrías destinar a una acción para mejorar tus ingresos sin comprometer gastos básicos ni usar tu reserva de emergencia?',
      help: c.route === 'B' ? 'Considera dinero personal disponible; no la caja que necesita tu negocio para operar.' : undefined,
    }),
    choices: opts('ZERO = No tengo dinero disponible para esto'),
  }),
  v({
    id: 'Q23_NO_INCOME', when: noIncome, type: 'money_or_choice',
    text: 'Con tus recursos actuales, ¿podrías destinar algo a una acción para empezar a generar ingresos sin comprometer tus gastos básicos ni endeudarte?',
    choices: opts('ZERO = No tengo dinero disponible para esto'),
  }),
]);

slot(24, 'Q24_SKILLS', [
  v({
    id: 'Q24_SKILLS', when: () => true, type: 'multi', min_selected: 1, max_selected: 10, exclusive: ['NONE'],
    text: '¿Qué habilidades o recursos podrías aprovechar para aumentar o empezar a generar ingresos?',
    help: 'Elegir una categoría no implica que tengas títulos, experiencia ni que sea monetizable.',
    options: opts('SALES = Ventas y atención al cliente; ADMIN = Administración y organización; DIGITAL = Tecnología y tareas digitales; TEACHING = Enseñanza o asesoría; MAKING = Elaboración de productos o cocina; TECHNICAL = Servicios técnicos u oficios; CREATIVE = Diseño, comunicación o creación; LOGISTICS = Transporte o logística; ASSETS_NETWORK = Bienes, herramientas o contactos disponibles; OTHER = Otra habilidad o recurso; NONE = Aún no identifico ninguno'),
  }),
]);

const growthOn = (c) => c.route !== 'N' && c.code('Q04') !== 'ZERO' && !['NO_INCOME', 'USING_RESERVES', 'SUPPORT_SURPLUS'].includes(c.code('Q06'));
slot(25, 'Q25_INCOME_GOAL', [
  v({
    id: 'Q25_GROWTH', when: growthOn, type: 'single',
    text: '¿Cuánto te gustaría aumentar tus ingresos personales mensuales durante los próximos 12 meses?',
    options: opts('MAINTAIN = Mantenerlos por ahora; LT25 = Más de 0 y menos de 25%; P25_49 = De 25 a menos de 50%; P50_99 = De 50 a menos de 100%; GE100 = Duplicarlos o más; NOT_SET = Aún no tengo una meta'),
  }),
  v({
    id: 'Q25_START', when: (c) => !growthOn(c), type: 'money_or_choice',
    text: '¿Qué ingreso personal mensual te gustaría alcanzar durante los próximos 12 meses?',
    help: 'Es una aspiración: no se calcula como porcentaje sobre un ingreso actual.',
    choices: opts('NOT_SET = Aún no tengo una meta'),
  }),
]);

// Variantes con un único tipo de entrada válido en cada slot.
const SLOT_BY_ID = Object.fromEntries(SLOTS.map((s) => [s.slot_id, s]));
const VARIANT_BY_ID = {};
for (const s of SLOTS) for (const va of s.variants) {
  if (VARIANT_BY_ID[va.id]) throw new Error(`Variante duplicada: ${va.id}`);
  va.slot_id = s.slot_id;
  VARIANT_BY_ID[va.id] = va;
}
if (SLOTS.length !== 25) throw new Error('El catálogo debe tener exactamente 25 slots.');

/** Resultado de una variante para un contexto: texto, ayuda y opciones listas para el cliente. */
function renderVariant(variant, ctx) {
  const r = variant.render ? variant.render(ctx) : { text: variant.text, help: variant.help };
  const base = variant.type === 'money_or_choice' || variant.type === 'age_or_choice' ? variant.choices || [] : variant.options || [];
  return { text: r.text, help: r.help || variant.help || null, options: [...base, ...SPECIAL] };
}

function labelFor(variantId, code) {
  const va = VARIANT_BY_ID[variantId];
  if (!va) return code;
  const hit = [...(va.options || []), ...(va.choices || []), ...SPECIAL].find((o) => o.code === code);
  return hit ? hit.label : code;
}

function catalogueHash() {
  const dump = JSON.stringify(SLOTS, (k, val) => (typeof val === 'function' ? val.toString() : val));
  return crypto.createHash('sha256').update(dump).digest('hex');
}

module.exports = {
  VERSION_ID,
  ANNOTATION_VERSION,
  LOCALE,
  SLOTS,
  SLOT_BY_ID,
  VARIANT_BY_ID,
  SPECIAL,
  SPECIAL_CODES,
  AGE_RANGES,
  INCOME_WORDING,
  DEBT_VARIANTS,
  renderVariant,
  labelFor,
  catalogueHash,
};
