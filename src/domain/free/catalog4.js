'use strict';
// Catálogo FREE_24_V4_ES («Correcciones del test gratuito», 13-11-2026). 24 preguntas
// que se responden con botones: solo «Otro» abre una frase corta (80 caracteres) y los
// montos usan campos numéricos. Ya no se pregunta el interés de la deuda (queda para el
// diagnóstico completo). «No lo sé» y «Prefiero no responder» nunca equivalen a cero.
// Saltos: ingreso 0 → sin Q07; «No tengo deudas» en Q10 → sin Q11 ni Q12; «No tengo
// deudas» en Q11 → sin Q12. Las sesiones V3 conservan su propio catálogo.
const D = require('decimal.js');
const { FreeError, validCurrency } = require('./values');
const c3 = require('./catalog3');

const VERSION_ID = 'FREE_24_V4_ES';
const RESULT_RULES_VERSION = 'RESULT_FREE_V4_ES';
const ANNOTATION_VERSION = 'NONE';
const LOCALE = 'es';
const ROUTE_SLOT = 'Q04';
const CURRENCY_SLOT = 'Q01';
const OTHER_MAX = 80;

const SPECIAL = c3.SPECIAL;
const SPECIAL_CODES = c3.SPECIAL_CODES;
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

const { COUNTRIES, CURRENCIES } = c3.OPTIONS;
/** Moneda sugerida por país (se puede cambiar). */
const CURRENCY_BY_COUNTRY = { BO: 'BOB', PE: 'PEN', MX: 'MXN', CO: 'COP', AR: 'ARS', CL: 'CLP', EC: 'USD', PY: 'PYG', UY: 'UYU', VE: 'USD', GT: 'GTQ', DO: 'DOP', US: 'USD', ES: 'EUR' };

const AGE_BANDS = o('LT18 = Menos de 18; A18_24 = 18 a 24; A25_34 = 25 a 34; A35_44 = 35 a 44; A45_54 = 45 a 54; A55_64 = 55 a 64; GE65 = 65 o más');
const DEPENDENTS = o('D0 = Ninguna; D1 = Una; D2 = Dos; D3 = Tres; D4PLUS = Cuatro o más');
const ROUTES = o('EMPLOYEE = Soy empleado; INDEPENDENT = Trabajo por mi cuenta; BUSINESS = Tengo un negocio; MULTIPLE = Hago varias de estas actividades; NONE = No trabajo actualmente; OTHER = Otra situación');
const GOALS = o('INCOME = Ganar más; STABILITY = Tener ingresos más estables; DEBT = Pagar mis deudas; RESERVE = Tener dinero para emergencias; BUSINESS = Mejorar mi negocio; ASSET = Comprar una vivienda u otro bien; INDEPENDENCE = Depender menos de mi trabajo; OTHER = Otro objetivo; HELP = Ayúdenme a elegir');
const HORIZONS = o('M3 = 3 meses; M6 = 6 meses; Y1 = 1 año; LATER = Más adelante; UNKNOWN = Aún no lo sé');
const VARIABILITY = o('SIMILAR = Sí, casi lo mismo; MODERATE = Cambia un poco; HIGH = Cambia mucho; DECREASING = Cada vez recibo menos; NO_INCOME = Ahora no recibo dinero');
const DEBT_STATUS = o('NO = No tengo deudas; DUE = Sí, y debo pagar este mes; NO_DUE = Sí, pero este mes no tengo pagos');
const DEBT_TYPES = o('CARD = Tarjeta; PERSONAL = Préstamo personal; HOME = Vivienda; VEHICLE = Vehículo; FAMILY = Familiares o amigos; BUSINESS = Deuda del negocio; OTHER = Otra deuda; NONE = No tengo deudas');
const PAYMENT = o('ON_TIME = Estoy al día; MINIMUM = Solo pago el mínimo de la tarjeta; LATE = Tengo pagos atrasados; UNABLE = No puedo pagar lo que vence ahora; NOT_DUE_YET = Aún no vence mi primer pago');
const BACKUP = o('HOUSEHOLD_INCOME = Otro ingreso en mi hogar; INSURANCE = Un seguro que podría cubrirlo; SUPPORT = Apoyo económico confirmado; NONE = Ninguna');
const RESOURCES = o('EQUIPMENT = Herramientas o equipos; VEHICLE = Vehículo; SPACE = Espacio o local; INVENTORY = Mercadería; BUSINESS = Negocio funcionando; PRODUCT = Producto propio; COMPUTER = Computadora o programas; PHONE_INTERNET = Teléfono e internet; OTHER = Otro recurso; NONE = No tengo recursos disponibles');
const HOURS = o('H0 = Por ahora, nada; H_LT3 = Menos de 3 horas; H3_7 = De 3 a 7 horas; H8_14 = De 8 a 14 horas; H15 = 15 horas o más');
const SKILLS = o('SELL = Vender o atender clientes; ORGANIZE = Organizar tareas, cuentas o documentos; DIGITAL = Usar computadoras y herramientas digitales; MANUAL = Reparar, instalar o hacer trabajos manuales; COOK = Cocinar o elaborar productos; TEACH = Enseñar, explicar o asesorar; CREATE = Diseñar, escribir o crear contenido; DRIVE = Conducir, transportar o hacer entregas; OTHER = Otra habilidad; UNSURE = Todavía no lo tengo claro');
const EXPERIENCE = o('COMMERCE = Comercio y ventas; OFFICE = Atención al cliente y oficina; TECH = Tecnología; BUILD = Construcción y reparaciones; FOOD = Comida; TRANSPORT = Transporte y entregas; TEACHING = Enseñanza; DESIGN = Diseño y comunicación; CARE = Salud y cuidados; FARM = Producción y campo; OTHER = Otra actividad; NONE = Todavía no tengo experiencia');
const SKILL_USE = o('PAID_JOB = Sí, me pagan por eso en mi trabajo o negocio; PAID_SIDE = Sí, me han pagado por hacerlo aparte; UNPAID = Lo he hecho, pero sin cobrar; NOT_YET = Todavía no; UNKNOWN = No lo sé');
const AUDIENCE = o('PAST_CLIENTS = Clientes que ya tuve; BUSINESS_CLIENTS = Clientes de mi negocio; FRIENDS = Amigos o familiares; BUSINESSES = Negocios que conozco; WORK = Contactos de trabajo; FOLLOWERS = Personas que me siguen en redes; OTHER = Otro grupo; NOBODY = No tengo a quién ofrecerle; UNSURE = No lo tengo claro');
const BOTTLENECK = {
  OWN: o('CLIENTS = Me faltan clientes; PRICES = Cobro poco; COSTS = Mis costos son altos; COLLECTION = Me pagan tarde; TIME = No me alcanza el tiempo; OFFER = No sé qué me conviene vender; OTHER = Otro problema; UNSURE = No lo tengo claro'),
  EMPLOYEE: o('GROWTH = No veo cómo crecer en mi puesto; RAISE = No sé cómo pedir un aumento; TRAINING = Me falta capacitación; BETTER_OFFER = No encuentro una mejor oferta; TIME = No tengo tiempo; OTHER = Otro problema; UNSURE = No lo tengo claro'),
  NONE: o('NO_JOB = No encuentro empleo; OFFER = No sé qué podría ofrecer; EXPERIENCE = Me falta experiencia; SCHEDULE = Tengo horarios limitados; OTHER = Otro problema; UNSURE = No lo tengo claro'),
};
const FOCUS = o('EMPLOYEE = Mi empleo; OWN = Mi trabajo por cuenta propia o mi negocio');
const CONSTRAINTS = o('KEEP_JOB = Conservar mi empleo; FAMILY = Cuidar a mi familia; HEALTH = Mi salud; SCHEDULE = Mis horarios; TRAVEL = Evitar viajes o traslados; MONEY = No poner en riesgo mi dinero; OTHER = Otra condición; NONE = No tengo una condición especial');
const BUDGET = o('YES = Sí, lo tengo disponible; MAYBE = Tal vez, después de pagar mis gastos; NO = No tengo dinero para esto');
const PATHS = o('IMPROVE_JOB = Mejorar en mi empleo; CHANGE_JOB = Buscar otro empleo; SELL_SERVICE = Vender un servicio; SELL_PRODUCT = Vender un producto; IMPROVE_BUSINESS = Mejorar mi negocio; HELP = Ayúdenme a elegir; OTHER = Otro camino');

// Introducciones de bloque (se muestran sobre la primera pregunta de cada tramo).
const INTROS = {
  Q06: 'Ahora veamos cómo se mueve tu dinero cada mes. Si no sabes una cifra exacta, puedes aproximarla.',
  Q15: 'También queremos descubrir con qué cuentas para avanzar: tiempo, experiencia, habilidades y contactos.',
  Q21: 'Nos falta entender qué te frena y qué camino te gustaría intentar.',
};

// ───────── Slots ─────────
const SLOTS = [];
function slot(n, field, variants) {
  const slot_id = `Q${String(n).padStart(2, '0')}`;
  for (const v of variants) {
    v.slot_id = slot_id;
    v.when = v.when || (() => true);
    if (INTROS[slot_id]) v.intro = INTROS[slot_id];
  }
  SLOTS.push({ slot_id, ordinal: n, semantic_key: field, field, variants });
}
const one = (id, type, text, help, extra = {}) => [{ id, type, text, help, ...extra }];
/** Pregunta de botones: `multi` permite varias; `exclusive` se marcan solas; `other` abre una frase. */
const choice = (id, text, help, options, extra = {}) => one(id, 'choice', text, help, { options, multi: false, exclusive: [], other: 'OTHER', ...extra });

slot(1, 'locale', one('V4_Q01', 'locale', '¿En qué país vives?', 'Debajo elige tu moneda. Te sugerimos la de tu país y puedes cambiarla. Si cambias la moneda, tendrás que revisar los montos.', { countries: COUNTRIES, currencies: CURRENCIES, suggest: CURRENCY_BY_COUNTRY }));
slot(2, 'age_band', choice('V4_Q02', '¿Cuántos años tienes?', 'Marca una opción. No necesitamos tu fecha de nacimiento.', AGE_BANDS, { other: null }));
slot(3, 'dependents', choice('V4_Q03', '¿Cuántas personas dependen de tu dinero?', 'Por ejemplo, hijos u otras personas cuyos gastos pagas.', DEPENDENTS, { other: null }));
slot(4, 'activity', choice('V4_Q04', '¿Cómo trabajas actualmente?', 'Marca una opción. No trabajar no significa que no recibas dinero.', ROUTES, { other_label: '¿Cuál es tu situación?' }));
slot(5, 'goal', one('V4_Q05', 'goal', '¿Qué te gustaría mejorar primero?', 'Al terminar veremos qué primer paso puede acercarte a esa meta.', { options: GOALS, horizons: HORIZONS, other_label: '¿Qué otro objetivo?' }));
slot(6, 'net_income_month', one('V4_Q06', 'money', '¿Cuánto dinero recibes en un mes normal?', 'Si tienes negocio, cuenta lo que queda para ti después de pagar sus gastos. No pongas el total de ventas.', { period: 'MONTH' }));
slot(7, 'income_variability', choice('V4_Q07', '¿Recibes más o menos lo mismo cada mes?', 'Marca una opción.', VARIABILITY, { other: null }));
slot(8, 'essential_expense_month', one('V4_Q08', 'money', '¿Cuánto gastas al mes en lo necesario para vivir?', 'Incluye vivienda, comida, servicios, transporte y salud. No incluyas pagos de deudas.', { period: 'MONTH' }));
slot(9, 'other_expense_month', one('V4_Q09', 'money', 'Además de lo anterior, ¿cuánto gastas al mes en otras cosas?', 'Por ejemplo, salidas, compras y suscripciones. No repitas los gastos anteriores ni incluyas deudas.', { period: 'MONTH' }));
slot(10, 'debt_due_month', one('V4_Q10', 'debt_status', '¿Tienes deudas?', 'Marca una opción. Si debes pagar este mes, te pediremos cuánto.', { options: DEBT_STATUS }));
slot(11, 'debt_inventory', choice('V4_Q11', '¿Qué deudas tienes?', 'Puedes marcar varias. El total es opcional: si no lo sabes, puedes continuar.', DEBT_TYPES, { multi: true, exclusive: ['NONE'], other_label: '¿Cuál?', with_total: true }));
slot(12, 'payment_status', choice('V4_Q12', '¿Cómo vas con tus pagos?', 'Marca una opción.', PAYMENT, { other: null }));
slot(13, 'emergency_cash', one('V4_Q13', 'money', '¿Cuánto dinero tienes guardado para una emergencia?', 'No cuentes dinero para pagos próximos ni dinero del negocio. Cero es válido si es tu caso.', { period: 'STOCK' }));
slot(14, 'backup', choice('V4_Q14', 'Si dejaras de recibir dinero, ¿qué ayuda tendrías?', 'Puedes marcar varias.', BACKUP, { multi: true, exclusive: ['NONE'], other: null }));
slot(15, 'productive_resources', choice('V4_Q15', '¿Qué tienes que podrías usar para ganar dinero?', 'Puedes marcar varias.', RESOURCES, { multi: true, exclusive: ['NONE'], other_label: '¿Qué otro recurso?' }));
slot(16, 'available_hours_week', choice('V4_Q16', '¿Cuánto tiempo podrías dedicar por semana a mejorar tus ingresos?', 'Marca una opción.', HOURS, { other: null }));
slot(17, 'skills', choice('V4_Q17', '¿Qué se te da mejor?', 'Puedes marcar hasta dos opciones.', SKILLS, { multi: true, max: 2, exclusive: ['UNSURE'], other_label: '¿Qué otra habilidad?' }));
slot(18, 'experience', choice('V4_Q18', '¿En qué actividades tienes experiencia?', 'Puedes marcar hasta tres opciones.', EXPERIENCE, { multi: true, max: 3, exclusive: ['NONE'], other_label: '¿Qué otra actividad?' }));
slot(19, 'skill_use', choice('V4_Q19', '¿Has usado esas habilidades en trabajos reales?', 'Puedes marcar las que correspondan.', SKILL_USE, { multi: true, exclusive: ['NOT_YET', 'UNKNOWN'], other: null, no_dk: true }));
slot(20, 'market_access', choice('V4_Q20', '¿A quién podrías ofrecerle un producto o servicio?', 'Puedes marcar varias. No necesitamos nombres ni teléfonos.', AUDIENCE, { multi: true, exclusive: ['NOBODY', 'UNSURE'], other_label: '¿Qué otro grupo?' }));
slot(21, 'income_bottleneck', [
  { id: 'V4_Q21_OWN', type: 'choice', when: (c) => ['INDEPENDENT', 'BUSINESS'].includes(c.route), text: '¿Qué te dificulta ganar más?', help: 'Marca el problema principal.', options: BOTTLENECK.OWN, multi: false, exclusive: [], other: 'OTHER', other_label: '¿Qué otro problema?' },
  { id: 'V4_Q21_EMPLOYEE', type: 'choice', when: (c) => c.route === 'EMPLOYEE', text: '¿Qué te dificulta ganar más en tu trabajo?', help: 'Marca el problema principal.', options: BOTTLENECK.EMPLOYEE, multi: false, exclusive: [], other: 'OTHER', other_label: '¿Qué otro problema?' },
  { id: 'V4_Q21_NONE', type: 'choice', when: (c) => c.route === 'NONE', text: '¿Qué te dificulta empezar a ganar dinero?', help: 'Marca el problema principal.', options: BOTTLENECK.NONE, multi: false, exclusive: [], other: 'OTHER', other_label: '¿Qué otro problema?' },
  // Varias actividades u otra situación: primero elige qué actividad quiere mejorar.
  { id: 'V4_Q21_MULTIPLE', type: 'choice', when: (c) => !['INDEPENDENT', 'BUSINESS', 'EMPLOYEE', 'NONE'].includes(c.route), text: '¿Qué te dificulta ganar más?', help: 'Primero elige qué actividad quieres mejorar y luego el problema principal.', focus: FOCUS, focus_options: { EMPLOYEE: BOTTLENECK.EMPLOYEE, OWN: BOTTLENECK.OWN }, options: [...BOTTLENECK.EMPLOYEE, ...BOTTLENECK.OWN].filter((x, i, all) => all.findIndex((y) => y.code === x.code) === i), multi: false, exclusive: [], other: 'OTHER', other_label: '¿Qué otro problema?' },
]);
slot(22, 'constraints', choice('V4_Q22', '¿Qué necesitas cuidar al buscar ganar más?', 'Puedes marcar varias.', CONSTRAINTS, { multi: true, exclusive: ['NONE'], other_label: '¿Qué otra condición?' }));
slot(23, 'safe_test_budget', one('V4_Q23', 'budget', '¿Tienes dinero que puedas usar para probar una idea?', 'No uses dinero para comida, pagos o emergencias.', { options: BUDGET }));
slot(24, 'preferred_path', choice('V4_Q24', '¿Por dónde te gustaría empezar?', 'Marca una opción.', PATHS, { other_label: '¿Qué otro camino?', no_dk: true }));

if (SLOTS.length !== 24) throw new Error('FREE_24_V4_ES debe tener 24 slots.');
const SLOT_BY_ID = Object.fromEntries(SLOTS.map((s) => [s.slot_id, s]));
const VARIANT_BY_ID = {};
for (const s of SLOTS) for (const v of s.variants) VARIANT_BY_ID[v.id] = v;

// ───────── Contexto y saltos ─────────
function routeOf(get) {
  const a = get('Q04');
  return a && a.status === 'answered' && a.value ? a.value.codes[0] : null;
}
const val = (a) => (a && a.status === 'answered' ? a.value : null);
const debtStatus = (ctx) => (val(ctx.get('Q10')) ? val(ctx.get('Q10')).status : null);
const noDebtIn11 = (ctx) => Boolean(val(ctx.get('Q11')) && val(ctx.get('Q11')).codes.includes('NONE'));
function zeroIncome(a) {
  const v = val(a);
  return Boolean(v && v.amount !== null && v.amount !== undefined && !v.min && Number(v.amount) === 0);
}
/** Sin deudas confirmadas en Q10 o en Q11 (en ambos casos deuda y cuotas valen 0). */
function noDebtConfirmed(ctx) {
  return debtStatus(ctx) === 'NO' || noDebtIn11(ctx);
}
function applicable(slotId, ctx) {
  if (slotId === 'Q07') return !zeroIncome(ctx.get('Q06'));
  if (slotId === 'Q11') return debtStatus(ctx) !== 'NO';
  if (slotId === 'Q12') return !noDebtConfirmed(ctx);
  return true;
}
const SKIP_REASON = {
  Q07: 'No aplica: indicaste que hoy no recibes dinero',
  Q11: 'No aplica: indicaste que no tienes deudas',
  Q12: 'No aplica: indicaste que no tienes deudas',
};

function specialsFor(variant) {
  return variant.no_dk ? SPECIAL.filter((s) => s.code !== 'DK') : SPECIAL;
}
function renderVariant(variant) {
  return { text: variant.text, help: variant.help || null, options: [...(variant.options || []), ...specialsFor(variant)] };
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
const oneOf = (list, code, msg) => {
  if (!list.some((x) => x.code === code)) fail(msg);
  return code;
};
function otherText(raw, label = '¿Cuál?') {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) fail(`Escribe una frase corta en «${label}».`);
  if (s.length > OTHER_MAX) fail(`Usa como máximo ${OTHER_MAX} caracteres.`);
  return s;
}
const hasAmount = (m) => m && ((m.amount !== undefined && m.amount !== null && m.amount !== '') || (m.min !== undefined && m.min !== null && m.min !== '') || (m.max !== undefined && m.max !== null && m.max !== ''));

/** Devuelve { status, value } o lanza FreeError(422). `ctx` permite revisar contradicciones. */
function validate(variant, raw, session, ctx) {
  const special = typeof raw === 'string' ? raw : raw && typeof raw === 'object' && typeof raw.special === 'string' ? raw.special : null;
  if (special && STATUS_OF[special]) {
    if (special === 'DK' && variant.no_dk) fail('Elige una opción para continuar.');
    return { status: STATUS_OF[special], value: null };
  }
  const r = raw && typeof raw === 'object' ? raw : {};
  switch (variant.type) {
    case 'locale': {
      oneOf(COUNTRIES, r.country, 'Elige tu país.');
      if (!validCurrency(r.currency) || !CURRENCIES.some((c) => c.code === r.currency)) fail('Elige tu moneda.', 'INVALID_CURRENCY');
      return { status: 'answered', value: { country: r.country, currency: r.currency } };
    }
    case 'choice': {
      let codes = Array.isArray(r.codes) ? [...new Set(r.codes.filter(Boolean))] : r.code ? [r.code] : [];
      if (!codes.length) fail(variant.multi ? 'Marca al menos una opción.' : 'Elige una opción para continuar.');
      let opts = variant.options;
      let focus = null;
      if (variant.focus) {
        focus = oneOf(variant.focus, r.focus, 'Elige qué actividad quieres mejorar.');
        opts = variant.focus_options[focus];
      }
      for (const c of codes) oneOf(opts, c, 'Opción no válida.');
      if (!variant.multi && codes.length > 1) fail('Elige solo una opción.');
      const excl = codes.filter((c) => (variant.exclusive || []).includes(c));
      if (excl.length && codes.length > 1) fail(`«${labelIn(opts, excl[0])}» no se puede combinar con otras opciones.`);
      if (variant.max && codes.length > variant.max) fail(`Puedes marcar hasta ${variant.max === 2 ? 'dos' : variant.max === 3 ? 'tres' : variant.max} opciones.`);
      const other = variant.other && codes.includes(variant.other) ? otherText(r.other, variant.other_label) : null;
      const value = { codes, other };
      if (focus) value.focus = focus;
      if (variant.with_total) {
        // Total opcional de deudas; con «No tengo deudas» no se guarda ningún monto.
        value.total = !codes.includes('NONE') && hasAmount(r.total) ? c3.moneyValueFor(r.total, session, 'STOCK') : null;
      }
      if (variant.slot_id === 'Q07' && codes[0] === 'NO_INCOME' && ctx) {
        const inc = val(ctx.get('Q06'));
        if (inc && ((inc.amount && new D(inc.amount).gt(0)) || (inc.max && new D(inc.max).gt(0)))) fail('Antes pusiste un ingreso y ahora marcaste que no recibes dinero. ¿Quieres corregirlo?', 'CONTRADICTION');
      }
      return { status: 'answered', value };
    }
    case 'goal': {
      const code = oneOf(variant.options, r.code, 'Elige qué te gustaría mejorar primero.');
      const horizon = r.horizon ? oneOf(variant.horizons, r.horizon, 'Elige un plazo.') : 'UNKNOWN';
      return { status: 'answered', value: { code, other: code === 'OTHER' ? otherText(r.other, variant.other_label) : null, horizon } };
    }
    case 'money':
      return { status: 'answered', value: c3.moneyValueFor(r, session, variant.period) };
    case 'debt_status': {
      const status = oneOf(variant.options, r.status, 'Elige una opción para continuar.');
      if (status !== 'DUE') return { status: 'answered', value: { status, monthly_due: null, arrears_extra: null } };
      if (!hasAmount(r.monthly_due)) fail('Escribe cuánto debes pagar este mes.', 'INVALID_AMOUNT');
      const due = c3.moneyValueFor(r.monthly_due, session, 'MONTH');
      const extra = hasAmount(r.arrears_extra) ? c3.moneyValueFor(r.arrears_extra, session, 'STOCK') : null;
      return { status: 'answered', value: { status, monthly_due: due, arrears_extra: extra } };
    }
    case 'budget': {
      const availability = oneOf(variant.options, r.availability, 'Elige una opción para continuar.');
      // «No tengo dinero» confirma cero; «Sí» o «Tal vez» piden cuánto (opcional).
      const amount = availability === 'NO' ? { amount: '0.00', min: null, max: null, currency: session.currency, period: 'STOCK', precision: 'exact' } : hasAmount(r) ? c3.moneyValueFor(r, session, 'STOCK') : null;
      return { status: 'answered', value: { availability, money: amount } };
    }
    default:
      return fail('Tipo de pregunta no disponible.');
  }
}

/** Una respuesta sigue siendo válida si sus montos están en la moneda vigente. */
const revalidates = c3.revalidates;

// ───────── Formularios web ─────────
const arr = (v) => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : typeof v === 'object' ? Object.values(v) : [v]);
const money = (body, p = '') => ({ amount: c3.clean(body[`${p}amount`]), min: c3.clean(body[`${p}min`]), max: c3.clean(body[`${p}max`]) });

function fromForm(variant, body) {
  const form = { ...body, codes: arr(body.codes) };
  if (typeof body.special === 'string' && STATUS_OF[body.special]) return { value: body.special, form };
  switch (variant.type) {
    case 'locale':
      return { value: { country: body.country, currency: body.currency }, form };
    case 'choice':
      return { value: { codes: form.codes, other: body.other, focus: body.focus, total: variant.with_total ? money(body, 'total_') : undefined }, form };
    case 'goal':
      return { value: { code: body.code, other: body.other, horizon: body.horizon }, form };
    case 'money':
      return { value: money(body), form };
    case 'debt_status':
      return { value: { status: body.status, monthly_due: money(body), arrears_extra: money(body, 'extra_') }, form };
    case 'budget':
      return { value: { availability: body.availability, ...money(body) }, form };
    default:
      return { value: undefined, form };
  }
}

function toForm(variant, a) {
  if (!a) return {};
  if (a.status !== 'answered') return { special: a.status === 'unknown' ? 'DK' : 'PNA' };
  const v = a.value;
  const m = (x, p = '') => (x ? { [`${p}amount`]: x.amount || '', [`${p}min`]: x.min || '', [`${p}max`]: x.max || '' } : {});
  switch (variant.type) {
    case 'locale':
      return { ...v };
    case 'choice':
      return { codes: v.codes, other: v.other || '', focus: v.focus || '', ...m(v.total, 'total_') };
    case 'goal':
      return { code: v.code, other: v.other || '', horizon: v.horizon };
    case 'money':
      return m(v);
    case 'debt_status':
      return { status: v.status, ...m(v.monthly_due), ...m(v.arrears_extra, 'extra_') };
    case 'budget':
      return { availability: v.availability, ...(v.availability === 'NO' ? {} : m(v.money)) };
    default:
      return { ...v };
  }
}

// ───────── Lectura humana ─────────
const { fmtMoney, fmtNum } = c3;
function codesText(variant, v) {
  const opts = variant.focus && v.focus ? variant.focus_options[v.focus] : variant.options;
  return v.codes.map((c) => (c === variant.other && v.other ? `${labelIn(opts, c)}: ${v.other}` : labelIn(opts, c))).join(', ');
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
    case 'choice':
      return [x.focus ? `Quiero mejorar: ${labelIn(v.focus, x.focus).toLowerCase()}` : null, codesText(v, x), x.total ? `Total: ${fmtMoney(x.total)}` : null].filter(Boolean).join(' · ');
    case 'goal':
      return `${x.code === 'OTHER' && x.other ? `Otro objetivo: ${x.other}` : labelIn(GOALS, x.code)} · Plazo: ${labelIn(HORIZONS, x.horizon).toLowerCase()}`;
    case 'money':
      return `${fmtMoney(x)}${x.period === 'MONTH' ? ' al mes' : ''}${x.precision === 'range' ? '' : ' aprox.'}`;
    case 'debt_status':
      return x.status !== 'DUE' ? labelIn(DEBT_STATUS, x.status) : `Sí: ${fmtMoney(x.monthly_due)} este mes${x.arrears_extra ? ` + ${fmtMoney(x.arrears_extra)} de atrasos` : ''}`;
    case 'budget':
      return x.availability === 'NO' ? labelIn(BUDGET, 'NO') : `${labelIn(BUDGET, x.availability)}${x.money ? ` · ${fmtMoney(x.money)}` : ' · monto sin indicar'}`;
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
  SKIP_REASON,
  OTHER_MAX,
  OPTIONS: { COUNTRIES, CURRENCIES, ROUTES, GOALS, HORIZONS, DEBT_STATUS, DEBT_TYPES, PAYMENT, HOURS, SKILLS, EXPERIENCE, SKILL_USE, AUDIENCE, CONSTRAINTS, BUDGET, PATHS, CURRENCY_BY_COUNTRY },
  routeOf,
  applicable,
  noDebtConfirmed,
  renderVariant,
  specialsFor,
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
