'use strict';
// Catálogo FREE_25_V3_ES (documento 07 del paquete V3, 11-11-2026). 25 preguntas con
// montos aproximados, evidencia de habilidades y restricciones. Cada slot tiene una
// variante, salvo Q22, que adapta sus opciones a la actividad (Q04). Q12 y Q13 no se
// muestran cuando Q10 y Q11 confirman que no hay deudas. Todas admiten «No lo sé» y
// «Prefiero no responder»: nunca equivalen a cero. Sin IA en la elección de preguntas.
const D = require('decimal.js');
const { FreeError, validCurrency } = require('./values');

const VERSION_ID = 'FREE_25_V3_ES';
const RESULT_RULES_VERSION = 'RESULT_FREE_V3_ES';
const ANNOTATION_VERSION = 'NONE';
const LOCALE = 'es';
const ROUTE_SLOT = 'Q04';
const CURRENCY_SLOT = 'Q01';

const SPECIAL = [
  { code: 'DK', label: 'No lo sé' },
  { code: 'PNA', label: 'Prefiero no responder' },
];
const SPECIAL_CODES = SPECIAL.map((s) => s.code);
const STATUS_OF = { DK: 'unknown', PNA: 'declined' };

const o = (spec) =>
  spec
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const i = x.indexOf('=');
      return { code: x.slice(0, i).trim(), label: x.slice(i + 1).trim() };
    });

const COUNTRIES = o('BO = Bolivia; PE = Perú; MX = México; CO = Colombia; AR = Argentina; CL = Chile; EC = Ecuador; PY = Paraguay; UY = Uruguay; VE = Venezuela; GT = Guatemala; DO = República Dominicana; US = Estados Unidos; ES = España; OTHER = Otro país');
const CURRENCIES = o('BOB = Bolivianos (Bs); USD = Dólares (USD); PEN = Soles (PEN); MXN = Pesos mexicanos (MXN); COP = Pesos colombianos (COP); ARS = Pesos argentinos (ARS); CLP = Pesos chilenos (CLP); PYG = Guaraníes (PYG); UYU = Pesos uruguayos (UYU); GTQ = Quetzales (GTQ); DOP = Pesos dominicanos (DOP); EUR = Euros (EUR)');
const ROUTES = o('EMPLOYEE = Trabajo como empleado; INDEPENDENT = Trabajo por cuenta propia; BUSINESS = Tengo un negocio; MULTIPLE = Tengo varias actividades; NONE = Hoy no tengo ingresos; OTHER = Otra situación');
const GOAL_PRIORITIES = o('INCOME = Ganar más cada mes; STABILITY = Tener ingresos más estables; DEBT = Ponerme al día o salir de deudas; RESERVE = Formar una reserva; BUSINESS = Hacer crecer mi negocio; ASSETS = Construir patrimonio; INDEPENDENCE = Depender menos de mi trabajo; OTHER = Otro cambio; UNSURE = Aún no lo tengo claro');
const TARGET_KINDS = o('ADDITIONAL_INCOME = Ganar esa cantidad adicional al mes; TOTAL_INCOME = Llegar a ese ingreso total al mes; SAVINGS = Juntar esa cantidad; NET_WORTH = Alcanzar ese patrimonio; OTHER = Otro');
const BOTTLENECK = {
  EMPLOYEE: o('SALARY_LIMIT = Mi sueldo tiene poco margen para subir; SKILL_GAP = Me faltan conocimientos o certificaciones; ACCESS = No encuentro mejores oportunidades; OTHER = Otro obstáculo'),
  BUSINESS: o('CLIENTS = Me faltan clientes; PRICES = Cobro poco; COSTS = Mis costos son altos; COLLECTION = Me pagan tarde; CAPACITY = No me alcanza el tiempo o la capacidad; OTHER = Otro obstáculo'),
  NONE: o('JOB_ACCESS = No consigo empleo; OFFER = No sé qué ofrecer; SKILLS = Necesito desarrollar habilidades; CARE = Tengo responsabilidades de cuidado; OTHER = Otro obstáculo'),
};
BOTTLENECK.INDEPENDENT = BOTTLENECK.BUSINESS;
BOTTLENECK.MULTIPLE = o('SALARY_LIMIT = Mi ingreso principal tiene poco margen; CLIENTS = Me faltan clientes; PRICES = Cobro poco; COSTS = Mis costos son altos; CAPACITY = No me alcanza el tiempo; OTHER = Otro obstáculo');
BOTTLENECK.OTHER = BOTTLENECK.MULTIPLE;

const AGE_BANDS = o('LT18 = Menos de 18 años; A18_24 = De 18 a 24 años; A25_34 = De 25 a 34 años; A35_44 = De 35 a 44 años; A45_54 = De 45 a 54 años; A55_64 = De 55 a 64 años; GE65 = 65 años o más');
const DEPENDENTS = o('D0 = Ninguna; D1 = Una; D2 = Dos; D3 = Tres; D4PLUS = Cuatro o más');
const VARIABILITY = o('SIMILAR = Es parecido cada mes; MODERATE = Varía moderadamente; HIGH = Varía mucho; DECREASING = Está disminuyendo; NO_INCOME = Actualmente es cero');
const PRESENCE = o('YES = Sí tengo deudas; NO = No tengo deudas; UNSURE = No estoy seguro');
const DEBT_TYPES = o('CARD = Tarjeta de crédito; LOAN = Préstamo; HOME = Crédito de vivienda; FAMILY = Familiares u otras personas; BUSINESS = Deuda del negocio que pago yo; OTHER = Otra');
const PAYMENT = o('ON_TIME = Al día; MINIMUM = Pago solo los mínimos; OCCASIONAL_DELAY = Con atrasos ocasionales; OVERDUE_UNABLE = Con pagos vencidos que no puedo cubrir');
const RATE_TYPES = o('NOMINAL = Nominal; EFFECTIVE = Efectiva; UNKNOWN = No sé de qué tipo');
const RATE_PERIODS = o('MONTH = Mensual; YEAR = Anual; OTHER = Otro período');
// Opciones que se muestran (las demás siguen siendo válidas para respuestas ya guardadas):
// «No estoy seguro» duplicaba «No lo sé», y «Otro período» y nominal/efectiva confundían.
const PRESENCE_DUE = o('YES = Sí, tengo pagos este mes; NO = No tengo deudas');
const PRESENCE_TOTAL = o('YES = Sí, tengo deudas; NO = No tengo deudas');
const RATE_PERIODS_SHOWN = RATE_PERIODS.filter((x) => x.code !== 'OTHER');
const BACKUP = o('HOUSEHOLD_INCOME = Otro ingreso en mi hogar; INSURANCE = Un seguro; SUPPORT = Apoyo confirmado de familiares u otras personas; NONE = Ninguno');
const RESOURCES = o('EQUIPMENT = Equipo o herramientas; VEHICLE = Vehículo; SPACE = Un espacio o local; INVENTORY = Inventario o mercadería; BUSINESS = Un negocio en marcha; PRODUCT = Un producto propio; SOFTWARE = Software o cuentas digitales; PHONE_INTERNET = Teléfono e internet; OTHER = Otro recurso');
const FREQUENCY = o('ONCE = Una vez; REPEATED = Varias veces; UNKNOWN = No lo recuerdo');
const CONSTRAINTS = o('KEEP_JOB = Conservar mi empleo; CARE = Cuidar a familiares; HEALTH = Mi salud; SCHEDULE = Mis horarios; MOBILITY = Movilidad o distancia; MONEY = No arriesgar dinero; OTHER = Otra condición');
const AVAILABLE_NOW = o('YES = Lo tengo disponible ahora; LATER = Solo después de cubrir mis pagos del mes; UNKNOWN = No estoy seguro');
const PATHS = o('IMPROVE_JOB = Mejorar en mi empleo actual; CHANGE_JOB = Cambiar de empleo; SELL_SERVICE = Vender un servicio; SELL_PRODUCT = Vender un producto; IMPROVE_BUSINESS = Mejorar mi negocio; HELP_CHOOSE = Que me ayuden a elegir');

// ───────── Slots ─────────
const SLOTS = [];
function slot(n, field, variants) {
  const slot_id = `Q${String(n).padStart(2, '0')}`;
  for (const v of variants) {
    v.slot_id = slot_id;
    v.when = v.when || (() => true);
  }
  SLOTS.push({ slot_id, ordinal: n, semantic_key: field, field, variants });
}
const one = (id, type, text, help, extra = {}) => [{ id, type, text, help, ...extra }];

slot(1, 'locale', one('V3_Q01', 'locale', '¿En qué país vives y en qué moneda manejas normalmente tu dinero?', 'País y moneda. Todos tus montos se pedirán en esa moneda y no se convierten.', { countries: COUNTRIES, currencies: CURRENCIES }));
slot(2, 'age_band', one('V3_Q02', 'enum', '¿En qué rango de edad estás?', 'Rangos; no hace falta tu fecha de nacimiento.', { options: AGE_BANDS }));
slot(3, 'dependents', one('V3_Q03', 'enum', '¿Cuántas personas dependen económicamente de ti?', 'Ninguna, una, dos, tres, cuatro o más.', { options: DEPENDENTS }));
slot(4, 'activity', one('V3_Q04', 'activity', '¿A qué te dedicas actualmente?', 'Elige tu situación y cuéntanos tu puesto o actividad en una frase.', { options: ROUTES }));
slot(5, 'goal', one('V3_Q05', 'goal', '¿Qué cambio económico te gustaría conseguir y en qué plazo?', 'Elige una prioridad y, si puedes, concrétala: cuánto y en cuántos meses. No es obligatorio poner un monto.', { options: GOAL_PRIORITIES, target_kinds: TARGET_KINDS }));
slot(6, 'net_income_month', one('V3_Q06', 'money', '¿Cuánto dinero recibes personalmente en un mes normal, después de los costos de tu actividad?', 'Monto o rango. Si tienes un negocio, cuenta el dinero que te queda a ti, no lo que vende el negocio. Si hoy no recibes ingresos, escribe 0.', { period: 'MONTH', breakdown: true }));
slot(7, 'income_variability', one('V3_Q07', 'enum', '¿Cómo cambia ese ingreso de un mes a otro?', 'Es parecido, varía moderadamente, varía mucho, está disminuyendo o actualmente es cero.', { options: VARIABILITY }));
slot(8, 'essential_expense_month', one('V3_Q08', 'money', '¿Cuánto necesitas al mes para vivienda, alimentación, servicios, transporte, salud y otras necesidades básicas?', 'Total aproximado, sin incluir pagos de deudas.', { period: 'MONTH' }));
slot(9, 'other_expense_month', one('V3_Q09', 'money', 'Además de lo básico, ¿cuánto gastas al mes en compras, salidas, suscripciones y otros gastos?', 'Total aproximado, sin deudas y sin repetir lo de la pregunta anterior.', { period: 'MONTH' }));
slot(10, 'debt_due_month', one('V3_Q10', 'debt_payment', '¿Tienes que pagar alguna deuda este mes?', 'Cuotas de préstamos, tarjetas o compras a plazos que te toca pagar este mes. Si además tienes pagos atrasados, anótalos aparte.', { presence: PRESENCE_DUE, amount_label: '¿Cuánto pagas en total este mes?' }));
slot(11, 'debt_inventory', one('V3_Q11', 'debt_inventory', '¿Cuánto debes en total y qué tipos de deuda tienes?', 'Saldo aproximado de todas tus deudas y de qué tipo son. El saldo no es la cuota.', { presence: PRESENCE_TOTAL, types: DEBT_TYPES }));
slot(12, 'payment_status', one('V3_Q12', 'enum_detail', '¿Cómo estás cumpliendo esos pagos?', 'Si hay una consecuencia urgente (un embargo, un corte, una demanda), puedes contarla.', { options: PAYMENT, detail_label: 'Consecuencia urgente (opcional)', detail_max: 300 }));
slot(13, 'debt_cost', one('V3_Q13', 'rate', '¿Qué interés pagas por tu deuda más importante?', 'Lo encuentras en tu contrato o estado de cuenta. Si no lo sabes, elige «No lo sé»: no hace falta adivinarlo.', { rate_types: RATE_TYPES, periods: RATE_PERIODS_SHOWN }));
slot(14, 'emergency_cash', one('V3_Q14', 'money', '¿Cuánto dinero tienes disponible para una emergencia?', 'Ahorro que puedes usar de inmediato. No cuentes dinero ya comprometido ni la caja de tu negocio.', { period: 'STOCK' }));
slot(15, 'backup', one('V3_Q15', 'multi_enum', 'Si tus ingresos se interrumpieran, ¿qué otro respaldo real tendrías?', 'Elige todos los que apliquen. Más adelante revisaremos si serían suficientes.', { options: BACKUP, exclusive: ['NONE'], detail_label: 'Detalle (opcional)', detail_max: 300 }));
slot(16, 'productive_resources', one('V3_Q16', 'resources', '¿Qué bienes, herramientas o recursos podrías aprovechar para generar ingresos?', 'Marca solo lo que realmente puedes usar. No hace falta valorarlo.', { options: RESOURCES, max_selected: 5, detail_label: 'Cuéntanos brevemente qué es (opcional)', detail_max: 300 }));
slot(17, 'available_hours_week', one('V3_Q17', 'hours', '¿Cuántas horas reales podrías dedicar cada semana a mejorar tus ingresos?', 'Respetando tu trabajo y tus obligaciones. Cero es una respuesta válida.'));
slot(18, 'skill_evidence', one('V3_Q18', 'skill_examples', '¿Qué sabes hacer bien? Cuéntanos una tarea que hayas resuelto y qué resultado obtuviste.', 'Hasta dos habilidades y un ejemplo breve. Es la respuesta que más nos ayuda a personalizar tu diagnóstico.'));
slot(19, 'sector_experience', one('V3_Q19', 'text', '¿Qué tipo de clientes, empresas o sectores conoces por experiencia?', 'Sector y tu relación con él: trabajaste ahí, vendiste, atendiste clientes o gestionaste un negocio.', { max: 500, placeholder: 'Ej.: restaurantes pequeños, atendí clientes durante tres años' }));
slot(20, 'paid_experience', one('V3_Q20', 'paid_experience', '¿Alguien ya te ha pagado por alguna de esas habilidades fuera de tu actividad principal?', 'Qué hiciste y si fue una vez o varias. También puedes responder que nunca.'));
slot(21, 'market_access', one('V3_Q21', 'text', '¿A qué personas o negocios podrías acercarte para comprobar una oportunidad?', 'Describe el tipo de contacto o acceso. No escribas nombres ni teléfonos.', { max: 500, placeholder: 'Ej.: antiguos clientes y dos conocidos con restaurante' }));
slot(22, 'income_bottleneck', Object.entries(BOTTLENECK).map(([route, options]) => ({
  id: `V3_Q22_${route}`,
  type: 'enum_detail',
  when: (c) => (c.route || 'OTHER') === route,
  text: route === 'NONE' ? '¿Qué te impide hoy empezar a generar ingresos?' : '¿Qué impide hoy que aumentes tu ingreso principal?',
  help: 'Elige el obstáculo principal y, si quieres, explícalo.',
  options,
  detail_label: 'Cuéntanos más (opcional)',
  detail_max: 500,
})));
slot(23, 'constraints', one('V3_Q23', 'multi_text', '¿Qué condición debe respetar cualquier propuesta que te hagamos?', 'Hasta tres. Si quieres, explica la más importante; no hace falta dar detalles médicos.', { options: CONSTRAINTS, max_selected: 3, detail_label: 'La más importante, en tus palabras (opcional)', detail_max: 500 }));
slot(24, 'safe_test_budget', one('V3_Q24', 'money', '¿Cuánto podrías destinar a probar una oportunidad sin afectar necesidades básicas ni obligaciones?', 'Monto disponible o 0. No cuentes tu ahorro de emergencia.', { period: 'STOCK', available_now: AVAILABLE_NOW }));
slot(25, 'preferred_path', one('V3_Q25', 'enum', '¿Qué camino estarías dispuesto a explorar primero?', 'Es una preferencia: no te compromete a nada.', { options: PATHS }));

if (SLOTS.length !== 25) throw new Error('FREE_25_V3_ES debe tener 25 slots.');
const SLOT_BY_ID = Object.fromEntries(SLOTS.map((s) => [s.slot_id, s]));
const VARIANT_BY_ID = {};
for (const s of SLOTS) for (const v of s.variants) VARIANT_BY_ID[v.id] = v;

// ───────── Contexto ─────────
function routeOf(get) {
  const a = get('Q04');
  return a && a.status === 'answered' && a.value ? a.value.route : null;
}

const presence = (a) => (a && a.status === 'answered' && a.value ? a.value.presence : null);
/** Q12 y Q13 no aplican solo cuando Q10 y Q11 confirman, de forma coherente, que no hay deudas. */
function noDebtConfirmed(ctx) {
  return presence(ctx.get('Q10')) === 'NO' && presence(ctx.get('Q11')) === 'NO';
}
function applicable(slotId, ctx) {
  if (slotId === 'Q12' || slotId === 'Q13') return !noDebtConfirmed(ctx);
  return true;
}

function renderVariant(variant) {
  return { text: variant.text, help: variant.help || null, options: [...(variant.options || []), ...SPECIAL] };
}
function labelIn(list, code) {
  const hit = (list || []).find((x) => x.code === code);
  return hit ? hit.label : code;
}
function labelFor(variantId, code) {
  const v = VARIANT_BY_ID[variantId];
  return v ? labelIn([...(v.options || []), ...SPECIAL], code) : code;
}

// ───────── Validación ─────────
const fail = (msg, code = 'INVALID_VALUE') => {
  throw new FreeError(422, code, msg);
};
const AMOUNT_RE = /^\d{1,12}(\.\d{1,2})?$/;
const MAX = new D('999999999999.99');
function amount(raw, label = 'el monto') {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw);
  if (!AMOUNT_RE.test(s)) fail(`Escribe ${label} solo con números, por ejemplo 1250 o 1250.50.`, 'INVALID_AMOUNT');
  const d = new D(s);
  if (d.gt(MAX)) fail(`${label[0].toUpperCase()}${label.slice(1)} es demasiado alto.`, 'INVALID_AMOUNT');
  return d.toFixed(2);
}
function text(raw, max, label, { required = false } = {}) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (required && !s) fail(`Escribe ${label}.`);
  if (s.length > max) fail(`${label[0].toUpperCase()}${label.slice(1)} admite hasta ${max} caracteres.`);
  return s || null;
}
const oneOf = (list, code, msg) => {
  if (!list.some((x) => x.code === code)) fail(msg);
  return code;
};

/** Valor monetario: monto puntual o rango, siempre en la moneda de la sesión. */
function moneyValue(raw, session, period, { allowZero = true } = {}) {
  if (!raw || typeof raw !== 'object') fail('Escribe un monto o un rango.', 'INVALID_AMOUNT');
  const currency = session.currency;
  if (!currency) fail('Primero indica tu moneda en la pregunta 1.', 'CURRENCY_MISSING');
  const a = amount(raw.amount);
  const min = amount(raw.min, 'el mínimo');
  const max = amount(raw.max, 'el máximo');
  if (a !== null && (min !== null || max !== null)) fail('Escribe un monto o un rango, no ambos.', 'INVALID_AMOUNT');
  if (a === null && (min === null || max === null)) fail(min !== null || max !== null ? 'Para un rango escribe el mínimo y el máximo.' : 'Escribe un monto o un rango.', 'INVALID_AMOUNT');
  if (min !== null && new D(min).gt(max)) fail('El mínimo no puede ser mayor que el máximo.', 'INVALID_AMOUNT');
  if (!allowZero && a !== null && new D(a).isZero()) fail('Escribe un monto mayor que cero.', 'INVALID_AMOUNT');
  return a !== null
    ? { amount: a, min: null, max: null, currency, period, precision: raw.precision === 'exact' ? 'exact' : 'approximate' }
    : { amount: null, min, max, currency, period, precision: 'range' };
}

/** Devuelve { status, value } o lanza FreeError(422). */
function validate(variant, raw, session) {
  const special = typeof raw === 'string' ? raw : raw && typeof raw === 'object' && typeof raw.special === 'string' ? raw.special : null;
  if (special && STATUS_OF[special]) return { status: STATUS_OF[special], value: null };
  const r = raw && typeof raw === 'object' ? raw : {};
  switch (variant.type) {
    case 'locale': {
      oneOf(COUNTRIES, r.country, 'Elige tu país.');
      if (!validCurrency(r.currency) || !CURRENCIES.some((c) => c.code === r.currency)) fail('Elige tu moneda.', 'INVALID_CURRENCY');
      return { status: 'answered', value: { country: r.country, currency: r.currency } };
    }
    case 'enum':
      return { status: 'answered', value: oneOf(variant.options, typeof raw === 'string' ? raw : r.code, 'Elige una opción para continuar.') };
    case 'enum_detail':
      return { status: 'answered', value: { code: oneOf(variant.options, r.code, 'Elige una opción para continuar.'), detail: text(r.detail, variant.detail_max, 'el detalle') } };
    case 'activity':
      return { status: 'answered', value: { route: oneOf(ROUTES, r.route, 'Elige a qué te dedicas.'), occupation: text(r.occupation, 180, 'tu puesto o actividad') } };
    case 'goal': {
      const priority = oneOf(GOAL_PRIORITIES, r.priority, 'Elige qué cambio quieres conseguir.');
      const amt = amount(r.amount);
      const kind = amt !== null ? oneOf(TARGET_KINDS, r.target_kind, 'Indica si el monto es adicional, total, ahorro o patrimonio.') : null;
      let months = null;
      if (r.horizon_months !== undefined && r.horizon_months !== null && r.horizon_months !== '') {
        if (!/^\d{1,3}$/.test(String(r.horizon_months)) || Number(r.horizon_months) < 1 || Number(r.horizon_months) > 600) fail('Escribe el plazo en meses, por ejemplo 6.');
        months = Number(r.horizon_months);
      }
      if (amt !== null && !session.currency) fail('Primero indica tu moneda en la pregunta 1.', 'CURRENCY_MISSING');
      return { status: 'answered', value: { priority, description: text(r.description, 500, 'la descripción'), target_kind: kind, amount: amt, currency: amt !== null ? session.currency : null, horizon_months: months } };
    }
    case 'money': {
      const v = moneyValue(r, session, variant.period);
      if (variant.breakdown) v.breakdown = text(r.breakdown, 300, 'el desglose');
      if (variant.available_now) v.available_now = r.available_now ? oneOf(AVAILABLE_NOW, r.available_now, 'Indica si ese dinero está disponible.') : 'UNKNOWN';
      return { status: 'answered', value: v };
    }
    case 'debt_payment': {
      const p = oneOf(PRESENCE, r.presence, 'Indica si tienes deudas.');
      if (p !== 'YES') return { status: 'answered', value: { presence: p, monthly_due: null, arrears_extra: null } };
      const due = moneyValue(r.monthly_due || {}, session, 'MONTH');
      const extra = r.arrears_extra && (r.arrears_extra.amount || r.arrears_extra.min) ? moneyValue(r.arrears_extra, session, 'STOCK') : null;
      return { status: 'answered', value: { presence: p, monthly_due: due, arrears_extra: extra } };
    }
    case 'debt_inventory': {
      const p = oneOf(PRESENCE, r.presence, 'Indica si tienes deudas.');
      if (p !== 'YES') return { status: 'answered', value: { presence: p, total_balance: null, types: [] } };
      const types = Array.isArray(r.types) ? [...new Set(r.types)] : [];
      for (const t of types) oneOf(DEBT_TYPES, t, 'Tipo de deuda no válido.');
      const bal = r.total_balance && (r.total_balance.amount || r.total_balance.min) ? moneyValue(r.total_balance, session, 'STOCK') : null;
      if (!types.length && !bal) fail('Indica el saldo aproximado o al menos el tipo de deuda.');
      return { status: 'answered', value: { presence: p, total_balance: bal, types } };
    }
    case 'rate': {
      if (!/^\d{1,3}([.,]\d{1,4})?$/.test(String(r.value || ''))) fail('Escribe la tasa como número, por ejemplo 2.5. Si no la sabes, elige «No lo sé».');
      const value = new D(String(r.value).replace(',', '.'));
      if (value.gt(1000)) fail('Esa tasa parece demasiado alta: revísala.');
      return { status: 'answered', value: { value: value.toString(), rate_type: oneOf(RATE_TYPES, r.rate_type || 'UNKNOWN', 'Tipo de tasa no válido.'), period: oneOf(RATE_PERIODS, r.period, 'Indica si la tasa es mensual o anual.') } };
    }
    case 'multi_enum':
    case 'multi_text':
    case 'resources': {
      const codes = Array.isArray(r.codes) ? [...new Set(r.codes)] : [];
      if (!codes.length) fail('Elige al menos una opción.');
      for (const c of codes) oneOf(variant.options, c, 'Opción no válida.');
      if (variant.exclusive && codes.some((c) => variant.exclusive.includes(c)) && codes.length > 1) fail('«Ninguno» no se puede combinar con otras opciones.');
      if (variant.max_selected && codes.length > variant.max_selected) fail(`Elige como máximo ${variant.max_selected}.`);
      return { status: 'answered', value: { codes, detail: text(r.detail, variant.detail_max, 'el detalle') } };
    }
    case 'hours': {
      if (!/^\d{1,3}$/.test(String(r.hours ?? ''))) fail('Escribe las horas con números enteros. Cero es válido.');
      const h = Number(r.hours);
      if (h > 112) fail('Revisa las horas: una semana tiene 168 horas y necesitas descansar.');
      return { status: 'answered', value: { hours: h } };
    }
    case 'skill_examples': {
      const skills = text(r.skills, 200, 'tus habilidades', { required: true });
      if (skills.split(/[,;\n]| y /).filter((x) => x.trim()).length > 2) fail('Escribe como máximo dos habilidades.');
      const task = text(r.task, 500, 'la tarea');
      const result = text(r.result, 500, 'el resultado');
      if (skills.length + (task || '').length + (result || '').length > 1000) fail('Resume tu respuesta en 1000 caracteres como máximo.');
      return { status: 'answered', value: { skills, task, result } };
    }
    case 'text':
      return { status: 'answered', value: { text: text(r.text, variant.max, 'tu respuesta', { required: true }) } };
    case 'paid_experience': {
      const paid = oneOf(o('YES = Sí; NO = No'), r.paid_before, 'Indica si alguien ya te pagó.');
      if (paid === 'NO') return { status: 'answered', value: { paid_before: 'NO', activity: null, frequency: null } };
      return { status: 'answered', value: { paid_before: 'YES', activity: text(r.activity, 300, 'qué hiciste', { required: true }), frequency: oneOf(FREQUENCY, r.frequency || 'UNKNOWN', 'Frecuencia no válida.') } };
    }
    default:
      return fail('Tipo de pregunta no disponible.');
  }
}

/** Una respuesta sigue siendo válida si sus montos están en la moneda vigente. */
function revalidates(answer, variant, ctx, session) {
  if (answer.status !== 'answered' || !answer.value) return true;
  const currencies = [];
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (typeof v.currency === 'string') currencies.push(v.currency);
    for (const x of Object.values(v)) walk(x);
  };
  if (variant.slot_id !== CURRENCY_SLOT) walk(answer.value);
  return currencies.every((c) => c === session.currency);
}

// ───────── Formularios web ─────────
const arr = (v) => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : typeof v === 'object' ? Object.values(v) : [v]);
const money = (body, p = '') => ({ amount: clean(body[`${p}amount`]), min: clean(body[`${p}min`]), max: clean(body[`${p}max`]) });
/** Acepta 1.250,50 / 1,250.50 / 1250 y devuelve 1250.50 (o el texto original si no es número). */
function clean(v) {
  const s = String(v ?? '').trim().replace(/\s|Bs\.?|\$/gi, '');
  if (!s) return '';
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let dec = null;
  if (lastDot >= 0 && lastComma >= 0) dec = lastDot > lastComma ? '.' : ',';
  else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const after = s.length - s.lastIndexOf(sep) - 1;
    dec = s.split(sep).length - 1 === 1 && after !== 3 ? sep : null;
  }
  const out = dec ? s.split(dec).map((p, i, all) => (i === all.length - 1 ? p : p.replace(/[.,]/g, ''))).join('.') : s.replace(/[.,]/g, '');
  return out;
}

/** Convierte el formulario en el `value` de la API. Devuelve { value, form }. */
function fromForm(variant, body) {
  const form = { ...body };
  if (typeof body.special === 'string' && STATUS_OF[body.special]) return { value: body.special, form };
  switch (variant.type) {
    case 'locale':
      return { value: { country: body.country, currency: body.currency }, form };
    case 'enum':
      return { value: body.code, form };
    case 'enum_detail':
      return { value: { code: body.code, detail: body.detail }, form };
    case 'activity':
      return { value: { route: body.route, occupation: body.occupation }, form };
    case 'goal':
      return { value: { priority: body.priority, description: body.description, amount: clean(body.amount), target_kind: body.target_kind, horizon_months: body.horizon_months }, form };
    case 'money':
      return { value: { ...money(body), breakdown: body.breakdown, available_now: body.available_now }, form };
    case 'debt_payment':
      return { value: { presence: body.presence, monthly_due: money(body), arrears_extra: money(body, 'extra_') }, form };
    case 'debt_inventory':
      return { value: { presence: body.presence, total_balance: money(body), types: arr(body.types) }, form: { ...form, types: arr(body.types) } };
    case 'rate':
      return { value: { value: body.rate, rate_type: body.rate_type, period: body.period }, form };
    case 'multi_enum':
    case 'multi_text':
    case 'resources':
      return { value: { codes: arr(body.codes), detail: body.detail }, form: { ...form, codes: arr(body.codes) } };
    case 'hours':
      return { value: { hours: String(body.hours ?? '').trim() }, form };
    case 'skill_examples':
      return { value: { skills: body.skills, task: body.task, result: body.result }, form };
    case 'text':
      return { value: { text: body.text }, form };
    case 'paid_experience':
      return { value: { paid_before: body.paid_before, activity: body.activity, frequency: body.frequency }, form };
    default:
      return { value: undefined, form };
  }
}

/** Respuesta guardada → campos del formulario (para volver a editar). */
function toForm(variant, a) {
  if (!a) return {};
  if (a.status !== 'answered') return { special: a.status === 'unknown' ? 'DK' : 'PNA' };
  const v = a.value;
  const m = (x, p = '') => (x ? { [`${p}amount`]: x.amount || '', [`${p}min`]: x.min || '', [`${p}max`]: x.max || '' } : {});
  switch (variant.type) {
    case 'enum':
      return { code: v };
    case 'enum_detail':
      return { code: v.code, detail: v.detail || '' };
    case 'money':
      return { ...m(v), breakdown: v.breakdown || '', available_now: v.available_now || '' };
    case 'debt_payment':
      return { presence: v.presence, ...m(v.monthly_due), ...m(v.arrears_extra, 'extra_') };
    case 'debt_inventory':
      return { presence: v.presence, ...m(v.total_balance), types: v.types };
    case 'rate':
      return { rate: v.value, rate_type: v.rate_type, period: v.period };
    case 'hours':
      return { hours: String(v.hours) };
    case 'text':
      return { text: v.text };
    default:
      return { ...v };
  }
}

// ───────── Lectura humana ─────────
/** 5100 → «5.100»; 5100.5 → «5.100,50». */
function fmtNum(v) {
  const d = new D(v).abs();
  const [i, dec] = d.toFixed(2).split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${dec !== '00' ? `,${dec}` : ''}`;
}

function fmtMoney(x) {
  if (!x) return '—';
  const cur = x.currency === 'BOB' ? 'Bs' : x.currency;
  const n = (s) => fmtNum(s);
  return x.amount !== null ? `${cur} ${n(x.amount)}` : `${cur} ${n(x.min)} a ${n(x.max)}`;
}

function answerText(variantId, a) {
  if (!a) return 'Sin responder';
  if (a.status === 'unknown') return 'No lo sé';
  if (a.status === 'declined') return 'Prefiero no responder';
  const v = VARIANT_BY_ID[variantId];
  const x = a.value;
  switch (v.type) {
    case 'locale':
      return `${labelIn(COUNTRIES, x.country)} · ${labelIn(CURRENCIES, x.currency)}`;
    case 'enum':
      return labelIn(v.options, x);
    case 'enum_detail':
      return `${labelIn(v.options, x.code)}${x.detail ? `: ${x.detail}` : ''}`;
    case 'activity':
      return `${labelIn(ROUTES, x.route)}${x.occupation ? `: ${x.occupation}` : ''}`;
    case 'goal':
      return [labelIn(GOAL_PRIORITIES, x.priority), x.amount ? `${fmtMoney({ amount: x.amount, currency: x.currency })} (${labelIn(TARGET_KINDS, x.target_kind).toLowerCase()})` : null, x.horizon_months ? `en ${x.horizon_months} meses` : null, x.description].filter(Boolean).join(' · ');
    case 'money':
      return `${fmtMoney(x)}${x.period === 'MONTH' ? ' al mes' : ''}${x.precision === 'range' ? '' : ' aprox.'}`;
    case 'debt_payment':
      return x.presence !== 'YES' ? labelIn(PRESENCE, x.presence) : `${fmtMoney(x.monthly_due)} este mes${x.arrears_extra ? ` + ${fmtMoney(x.arrears_extra)} de atrasos` : ''}`;
    case 'debt_inventory':
      return x.presence !== 'YES' ? labelIn(PRESENCE, x.presence) : [x.total_balance ? `Saldo ${fmtMoney(x.total_balance)}` : null, x.types.map((t) => labelIn(DEBT_TYPES, t)).join(', ')].filter(Boolean).join(' · ');
    case 'rate':
      return `${x.value} % ${labelIn(RATE_PERIODS, x.period).toLowerCase()}`;
    case 'multi_enum':
    case 'multi_text':
    case 'resources':
      return `${x.codes.map((c) => labelIn(v.options, c)).join(', ')}${x.detail ? ` · ${x.detail}` : ''}`;
    case 'hours':
      return `${x.hours} horas por semana`;
    case 'skill_examples':
      return [x.skills, x.task, x.result].filter(Boolean).join(' · ');
    case 'text':
      return x.text;
    case 'paid_experience':
      return x.paid_before === 'NO' ? 'Nunca' : `Sí: ${x.activity} (${labelIn(FREQUENCY, x.frequency).toLowerCase()})`;
    default:
      return '—';
  }
}

module.exports = {
  VERSION_ID,
  RESULT_RULES_VERSION,
  ANNOTATION_VERSION,
  LOCALE,
  ROUTE_SLOT,
  CURRENCY_SLOT,
  SPECIAL,
  SPECIAL_CODES,
  SLOTS,
  SLOT_BY_ID,
  VARIANT_BY_ID,
  OPTIONS: { COUNTRIES, CURRENCIES, ROUTES, GOAL_PRIORITIES, TARGET_KINDS, PRESENCE, DEBT_TYPES, RATE_TYPES, RATE_PERIODS, FREQUENCY, AVAILABLE_NOW },
  routeOf,
  applicable,
  noDebtConfirmed,
  renderVariant,
  labelFor,
  labelIn,
  validate,
  revalidates,
  fromForm,
  toForm,
  answerText,
  fmtMoney,
  fmtNum,
};
