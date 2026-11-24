'use strict';
/**
 * Test gratuito V4 en forma de chat: interpreta lo que la persona escribe libremente
 * («Bolivia», «gano unos 2.500», «no tengo deudas», «vendo ropa») y lo convierte en los
 * mismos campos que enviarían los botones. Luego se valida igual que siempre: el texto
 * nunca se guarda como cifra sin pasar por la validación del catálogo.
 *
 * No usa IA: reglas fijas y predecibles. Si no entiende, devuelve { error } con una
 * sugerencia y la persona puede volver a escribir o tocar una opción.
 */
const cat = require('./catalog4');

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9.,\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STOP = new Set(['de', 'la', 'el', 'los', 'las', 'en', 'y', 'o', 'a', 'mi', 'mis', 'un', 'una', 'que', 'con', 'por', 'para', 'del', 'al', 'lo', 'me', 'se', 'es', 'muy', 'mas', 'este', 'esta', 'tengo', 'soy', 'estoy']);
const words = (s) => norm(s).split(' ').filter((w) => w && !STOP.has(w));
// Raíz simple para comparar «vendo» con «vender», «clientes» con «cliente».
const stem = (w) => (w.length > 5 ? w.slice(0, 5) : w.length > 3 ? w.slice(0, w.length - 1) : w);

const DK = /\b(no se|no lo se|ni idea|no estoy segur[oa]|no sabria)\b/;
const PNA = /\b(prefiero no|no quiero (decir|responder|contestar)|paso)\b/;
const NO = /^(no\b|nop\b|nada\b|ninguno|ninguna|nadie|cero\b|0\b|jamas|nunca)/;
const YES = /^(si\b|claro|por supuesto|obvio|sip\b|tengo\b|afirmativo)/;

/** Primera cifra del texto: «2.500», «2,500.50», «2500 bs», «2 mil», «1.5k». */
function amount(text) {
  const t = norm(text);
  if (/^(nada|cero|ninguno|ninguna|no tengo|no gano|no gasto|no recibo)\b/.test(t)) return '0';
  const m = t.match(/(\d[\d.,]*)\s*(mil\b|k\b)?/);
  if (!m) {
    if (/\bmil\b/.test(t)) return '1000';
    return null;
  }
  let raw = m[1].replace(/[.,]$/, '');
  // Separadores: «2.500» y «2,500» son miles; «2.5» o «1500,50» son decimales.
  const parts = raw.split(/[.,]/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (last.length === 3 && !(m[2] && parts.length === 2)) raw = parts.join('');
    else raw = `${parts.slice(0, -1).join('')}.${last}`;
  }
  let n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (m[2]) n *= 1000;
  return String(Math.round(n * 100) / 100);
}

/** Opciones mencionadas en el texto, de mayor a menor coincidencia. */
function matchOptions(options, text) {
  const t = norm(text);
  const tw = words(text).map(stem);
  const out = [];
  for (const o of options) {
    const l = norm(o.label);
    if (!l) continue;
    let score = 0;
    if (t === l || t.includes(l)) score = 10;
    else {
      const lw = words(o.label).map(stem);
      const hit = lw.filter((w) => tw.includes(w)).length;
      if (hit) score = (hit / lw.length) * 5 + hit;
    }
    if (score >= 1.5) out.push({ code: o.code, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

// Atajos numéricos de algunas preguntas.
function ageBand(n) {
  if (n < 18) return 'LT18';
  if (n <= 24) return 'A18_24';
  if (n <= 34) return 'A25_34';
  if (n <= 44) return 'A35_44';
  if (n <= 54) return 'A45_54';
  if (n <= 64) return 'A55_64';
  return 'GE65';
}
const dependents = (n) => (n <= 0 ? 'D0' : n === 1 ? 'D1' : n === 2 ? 'D2' : n === 3 ? 'D3' : 'D4PLUS');
const hours = (n) => (n <= 0 ? 'H0' : n < 3 ? 'H_LT3' : n <= 7 ? 'H3_7' : n <= 14 ? 'H8_14' : n <= 25 ? 'H15_25' : n <= 40 ? 'H26_40' : 'H41');
const NUM_WORDS = { una: 1, uno: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
function smallNumber(text) {
  const t = norm(text);
  const m = t.match(/\d+/);
  if (m) return Number(m[0]);
  for (const [w, n] of Object.entries(NUM_WORDS)) if (new RegExp(`\\b${w}\\b`).test(t)) return n;
  return null;
}

const SYN = {
  Q04: [
    [/\b(no trabajo|desemplead|sin trabajo|estudio|estudiante|jubilad)/, 'NONE'],
    [/\b(varias|de todo un poco|empleo y negocio|trabajo y (vendo|negocio))/, 'MULTIPLE'],
    [/\b(mi (propio )?negocio|tengo (una |un )?(tienda|negocio|emprendimiento|empresa))/, 'BUSINESS'],
    [/\b(independiente|freelance|por mi cuenta|cuenta propia|vendo|hago trabajos|taxista|chofer)/, 'INDEPENDENT'],
    [/\b(emplead|trabajo en|asalariad|en una empresa|dependiente|planilla|sueldo)/, 'EMPLOYEE'],
  ],
};

const failMsg = (variant) => {
  if (variant.type === 'money') return 'No encontré un monto. Escribe solo la cifra, por ejemplo «2500».';
  if (variant.type === 'locale') return 'No reconocí el país. Escribe su nombre, por ejemplo «Bolivia», o elige una opción.';
  return 'No te entendí del todo. Escríbelo con otras palabras o toca una de las opciones.';
};

/**
 * Convierte el texto libre en campos de formulario para `catalog4.fromForm`.
 * Devuelve { fields } o { error }.
 */
function interpret(variant, text, session) {
  const raw = String(text || '').trim().slice(0, 200);
  const t = norm(raw);
  if (!t) return { error: 'Escribe tu respuesta o toca una opción.' };
  if (PNA.test(t)) return { fields: { special: 'PNA' } };
  if (DK.test(t) && !variant.no_dk) return { fields: { special: 'DK' } };
  const err = () => ({ error: failMsg(variant) });

  switch (variant.type) {
    case 'locale': {
      const c = matchOptions(cat.OPTIONS.COUNTRIES.filter((x) => x.code !== 'OTHER'), raw)[0];
      if (!c) return err();
      // Moneda: la que mencione («en dólares») o la sugerida para su país.
      const cur = matchOptions(cat.OPTIONS.CURRENCIES, raw)[0];
      const named = /\bdolar/.test(t) ? 'USD' : /\beuro/.test(t) ? 'EUR' : cur && cur.score >= 3 ? cur.code : null;
      return { fields: { country: c.code, currency: named || cat.OPTIONS.CURRENCY_BY_COUNTRY[c.code] || 'USD' } };
    }
    case 'money': {
      const a = amount(raw);
      return a === null ? err() : { fields: { amount: a } };
    }
    case 'goal': {
      const g = matchOptions(variant.options.filter((x) => x.code !== 'OTHER'), raw)[0];
      const h = /\b3 mes|\btres mes/.test(t) ? 'M3' : /\b6 mes|\bseis mes|medio ano/.test(t) ? 'M6' : /\b(1|un) ano\b/.test(t) ? 'Y1' : /mas adelante|largo plazo|despues/.test(t) ? 'LATER' : null;
      if (g) return { fields: { code: g.code, horizon: h || 'UNKNOWN' } };
      if (variant.other && !cat.isGibberish(raw)) return { fields: { code: 'OTHER', other: raw.slice(0, cat.OTHER_MAX), horizon: h || 'UNKNOWN' } };
      return err();
    }
    case 'debt_status': {
      const a = amount(raw);
      if (NO.test(t) && !(a && Number(a) > 0)) return { fields: { status: 'NO' } };
      if (/este mes no|no (tengo )?(que )?pag|no me toca/.test(t)) return { fields: { status: 'NO_DUE' } };
      if (a && Number(a) > 0) return { fields: { status: 'DUE', amount: a } };
      if (YES.test(t)) return { error: '¿Cuánto debes pagar este mes? Escribe la cifra, por ejemplo «sí, 400». Si este mes no pagas nada, escribe «este mes no».' };
      return err();
    }
    case 'budget': {
      const a = amount(raw);
      if (NO.test(t) && !(a && Number(a) > 0)) return { fields: { availability: 'NO' } };
      if (/tal vez|quiza|puede ser|depende|despues de pagar/.test(t)) return { fields: { availability: 'MAYBE', ...(a ? { amount: a } : {}) } };
      if (YES.test(t) || (a && Number(a) > 0)) return { fields: { availability: 'YES', ...(a ? { amount: a } : {}) } };
      return err();
    }
    case 'choice': {
      const sid = variant.slot_id;
      const n = smallNumber(raw);
      if (sid === 'Q02' && n !== null && n > 5) return { fields: { codes: [ageBand(n)] } };
      if (sid === 'Q03') {
        if (NO.test(t)) return { fields: { codes: ['D0'] } };
        if (n !== null) return { fields: { codes: [dependents(n)] } };
      }
      if (sid === 'Q16') {
        if (NO.test(t)) return { fields: { codes: ['H0'] } };
        if (n !== null) return { fields: { codes: [hours(n)] } };
      }
      // Sinónimos frecuentes que no aparecen en el texto de las opciones.
      const syn = (SYN[sid] || []).find(([re]) => re.test(t));
      if (syn && variant.options.some((x) => x.code === syn[1])) return { fields: { codes: [syn[1]] } };
      let opts = variant.options;
      let focus;
      if (variant.focus) {
        // Varias actividades: se deduce cuál quiere mejorar por la opción mencionada.
        const all = Object.entries(variant.focus_options).flatMap(([k, list]) => list.map((x) => ({ ...x, focus: k })));
        const best = matchOptions(all.filter((x) => !['OTHER', 'UNSURE'].includes(x.code)), raw)[0];
        focus = best ? all.find((x) => x.code === best.code).focus : /negocio|cuenta propia|clientes|vend/.test(t) ? 'OWN' : 'EMPLOYEE';
        opts = variant.focus_options[focus];
      }
      const excl = variant.exclusive || [];
      // «No», «ninguno», «nada»: la opción excluyente que niega (No tengo…, Ninguna, Todavía no…).
      if (NO.test(t) && t.split(' ').length <= 4) {
        const neg = opts.find((x) => excl.includes(x.code) && /^(no |ningun|todavia no|nadie)/.test(norm(x.label))) || opts.find((x) => /^(ningun|no |nadie)/.test(norm(x.label)));
        if (neg) return { fields: { codes: [neg.code], ...(focus ? { focus } : {}) } };
      }
      let found = matchOptions(opts.filter((x) => x.code !== variant.other), raw);
      if (found.length) {
        if (!variant.multi) found = [found[0]];
        else {
          const top = found[0].score;
          found = found.filter((x) => x.score >= Math.min(3, top));
          // Una opción excluyente («Todavía no», «Ninguna») gana si es la más clara; si no, se quitan.
          if (excl.includes(found[0].code)) found = [found[0]];
          else found = found.filter((x) => !excl.includes(x.code));
          if (variant.max) found = found.slice(0, variant.max);
        }
        return { fields: { codes: found.map((x) => x.code), ...(focus ? { focus } : {}) } };
      }
      // Respuesta libre que no coincide con ninguna opción: se guarda como «Otro» con sus palabras.
      if (variant.other && !cat.isGibberish(raw) && raw.length >= 3) return { fields: { codes: [variant.other], other: raw.slice(0, cat.OTHER_MAX), ...(focus ? { focus } : {}) } };
      return err();
    }
    default:
      return err();
  }
}

/** Ejemplo para la caja de texto según la pregunta. */
function placeholder(variant) {
  switch (variant.type) {
    case 'locale':
      return 'Escribe tu país, por ejemplo «Bolivia»';
    case 'money':
      return 'Escribe el monto, por ejemplo «2500»';
    case 'debt_status':
      return 'Por ejemplo «no tengo» o «sí, pago 400 al mes»';
    case 'budget':
      return 'Por ejemplo «no», «tal vez» o «sí, 200»';
    default:
      return variant.multi ? 'Escribe tu respuesta; puedes nombrar varias' : 'Escribe tu respuesta con tus palabras';
  }
}

module.exports = { interpret, placeholder, amount, matchOptions };
