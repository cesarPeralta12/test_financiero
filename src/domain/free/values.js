'use strict';
// Validación y normalización de respuestas por tipo de entrada. El cliente envía un
// único `value`; el servidor deriva response_status (answered | unknown | declined).
const { D } = require('../../lib/money');
const { SPECIAL_CODES, AGE_RANGES } = require('./catalog');

class FreeError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const STATUS_OF = { DK: 'unknown', PNA: 'declined' };
const AMOUNT_RE = /^\d{1,9}(\.\d{1,2})?$/;
const MIN_AMOUNT = new D('0.01');
const MAX_AMOUNT = new D('999999999.99');

let CURRENCIES = null;
function validCurrency(code) {
  if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) return false;
  if (!CURRENCIES) {
    try {
      CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
    } catch {
      CURRENCIES = new Set(['USD', 'EUR', 'MXN', 'COP', 'PEN', 'CLP', 'ARS', 'GTQ', 'DOP', 'BOB', 'BRL', 'UYU', 'PYG', 'VES', 'CRC', 'PAB', 'HNL', 'NIO']);
    }
  }
  return CURRENCIES.has(code);
}

const invalidOption = (msg = 'Elige una de las opciones de esta pregunta.') => new FreeError(422, 'INVALID_OPTION', msg);

function special(code) {
  return { status: STATUS_OF[code], value: null };
}

function validateSingle(variant, raw) {
  if (typeof raw !== 'string') throw invalidOption('Envía un único código de opción.');
  if (STATUS_OF[raw]) return special(raw);
  if (!variant.options.some((o) => o.code === raw)) throw invalidOption();
  return { status: 'answered', value: raw };
}

function validateMulti(variant, raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw invalidOption('Elige al menos una opción.');
  if (raw.some((c) => typeof c !== 'string')) throw invalidOption();
  if (new Set(raw).size !== raw.length) throw invalidOption('No repitas opciones.');
  const exclusive = [...(variant.exclusive || []), ...SPECIAL_CODES];
  const known = new Set([...variant.options.map((o) => o.code), ...SPECIAL_CODES]);
  if (raw.some((c) => !known.has(c))) throw invalidOption();
  if (raw.length > 1 && raw.some((c) => exclusive.includes(c))) {
    throw invalidOption('«Ninguno», «No lo sé» y «Prefiero no responder» no se combinan con otras opciones.');
  }
  if (raw.length === 1 && STATUS_OF[raw[0]]) return special(raw[0]);
  const max = variant.max_selected || raw.length;
  const min = variant.min_selected || 1;
  if (raw.length > max || raw.length < min) throw invalidOption(`Elige entre ${min} y ${max} opciones.`);
  return { status: 'answered', value: [...raw] };
}

function validateAmount(raw) {
  const bad = (msg) => new FreeError(422, 'INVALID_AMOUNT', msg);
  if (typeof raw !== 'string' || !AMOUNT_RE.test(raw.trim())) {
    throw bad('Escribe el importe como texto decimal positivo, con hasta dos decimales (por ejemplo "3000.00").');
  }
  const d = new D(raw.trim());
  if (d.lt(MIN_AMOUNT) || d.gt(MAX_AMOUNT)) throw bad('El importe debe estar entre 0.01 y 999999999.99.');
  return d.toFixed(2);
}

/** money_or_choice: { kind: AMOUNT, amount, currency } | { kind: CHOICE, code }. */
function validateMoneyOrChoice(variant, raw, session) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FreeError(422, 'INVALID_OPTION', 'Envía un objeto con kind AMOUNT o CHOICE.');
  if (raw.kind === 'CHOICE') {
    if (Object.keys(raw).some((k) => !['kind', 'code'].includes(k))) throw invalidOption('Una opción no lleva importe.');
    if (typeof raw.code !== 'string') throw invalidOption();
    if (STATUS_OF[raw.code]) return special(raw.code);
    if (!variant.choices.some((o) => o.code === raw.code)) throw invalidOption();
    return { status: 'answered', value: { kind: 'CHOICE', code: raw.code } };
  }
  if (raw.kind === 'AMOUNT') {
    if (Object.keys(raw).some((k) => !['kind', 'amount', 'currency'].includes(k))) throw new FreeError(422, 'INVALID_AMOUNT', 'Un importe no lleva opción.');
    if (!validCurrency(raw.currency)) throw new FreeError(422, 'INVALID_AMOUNT', 'La moneda debe ser un código ISO 4217 válido, por ejemplo USD.');
    const amount = validateAmount(raw.amount);
    return { status: 'answered', value: { kind: 'AMOUNT', amount, currency: raw.currency } };
  }
  throw new FreeError(422, 'INVALID_OPTION', 'kind debe ser AMOUNT o CHOICE.');
}

/** age_or_choice: { kind: AGE, value, confirmed? } | { kind: CHOICE, code }. */
function validateAgeOrChoice(variant, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FreeError(422, 'INVALID_OPTION', 'Envía un objeto con kind AGE o CHOICE.');
  if (raw.kind === 'CHOICE') {
    if (Object.keys(raw).some((k) => !['kind', 'code'].includes(k))) throw invalidOption('Una opción no lleva edad.');
    if (typeof raw.code !== 'string') throw invalidOption();
    if (STATUS_OF[raw.code]) return special(raw.code);
    if (!variant.choices.some((o) => o.code === raw.code)) throw invalidOption();
    return { status: 'answered', value: { kind: 'CHOICE', code: raw.code } };
  }
  if (raw.kind === 'AGE') {
    if (Object.keys(raw).some((k) => !['kind', 'value', 'confirmed'].includes(k))) throw new FreeError(422, 'INVALID_AGE', 'Una edad no lleva opción.');
    if (!Number.isInteger(raw.value) || raw.value < 18 || raw.value > 100) throw new FreeError(422, 'INVALID_AGE', 'La edad debe ser un entero entre 18 y 100.');
    const value = { kind: 'AGE', value: raw.value };
    if (raw.confirmed === true) value.confirmed = true;
    return { status: 'answered', value };
  }
  throw new FreeError(422, 'INVALID_OPTION', 'kind debe ser AGE o CHOICE.');
}

/** Valida contra el rango de edad (Q16) solo si es conocido. Devuelve { ok, error }. */
function checkAgeAgainstRange(value, rangeCode) {
  const range = AGE_RANGES[rangeCode];
  if (!range || !value || value.kind !== 'AGE') return { ok: true };
  const [lo, hi] = range;
  if (value.value < lo) return { ok: false, code: 'AGE_BELOW_RANGE', message: 'Esa edad es menor que tu rango de edad actual.' };
  if (value.value <= hi && value.confirmed !== true) {
    return { ok: false, code: 'CONFIRMATION_REQUIRED', message: 'Esa edad podría haber pasado o estar próxima. ¿La mantienes como meta?' };
  }
  return { ok: true };
}

function validate(variant, raw, session) {
  switch (variant.type) {
    case 'single':
      return validateSingle(variant, raw);
    case 'multi':
      return validateMulti(variant, raw);
    case 'money_or_choice':
      return validateMoneyOrChoice(variant, raw, session);
    case 'age_or_choice':
      return validateAgeOrChoice(variant, raw);
    default:
      throw new Error(`Tipo de entrada no soportado: ${variant.type}`);
  }
}

module.exports = { FreeError, validate, validCurrency, checkAgeAgainstRange, STATUS_OF };
