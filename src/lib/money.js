'use strict';
// Importes con precisión decimal (decimal.js). Método de redondeo documentado en
// docs/CALCULOS.md: los cálculos internos usan 28 dígitos significativos; la
// presentación y los importes por periodo se redondean a 2 decimales con
// ROUND_HALF_UP (redondeo comercial: 0,005 → 0,01).
const DecimalBase = require('decimal.js');

const D = DecimalBase.clone({ precision: 28, rounding: DecimalBase.ROUND_HALF_UP });

const CURRENCIES = {
  MXN: { label: 'Peso mexicano (MXN)', locale: 'es-MX', decimals: 2, decimalSep: '.' },
  COP: { label: 'Peso colombiano (COP)', locale: 'es-CO', decimals: 2, decimalSep: ',' },
  USD: { label: 'Dólar estadounidense (USD)', locale: 'es-US', decimals: 2, decimalSep: '.' },
  EUR: { label: 'Euro (EUR)', locale: 'es-ES', decimals: 2, decimalSep: ',' },
  PEN: { label: 'Sol peruano (PEN)', locale: 'es-PE', decimals: 2, decimalSep: '.' },
  CLP: { label: 'Peso chileno (CLP)', locale: 'es-CL', decimals: 0, decimalSep: ',' },
  ARS: { label: 'Peso argentino (ARS)', locale: 'es-AR', decimals: 2, decimalSep: ',' },
  GTQ: { label: 'Quetzal (GTQ)', locale: 'es-GT', decimals: 2, decimalSep: '.' },
  DOP: { label: 'Peso dominicano (DOP)', locale: 'es-DO', decimals: 2, decimalSep: '.' },
};

const MAX_AMOUNT = new D('1e13');

function dec(v) {
  if (v instanceof D) return v;
  if (v === null || v === undefined || v === '') return null;
  try {
    return new D(v);
  } catch {
    return null;
  }
}

function round2(v) {
  return dec(v).toDecimalPlaces(2, D.ROUND_HALF_UP);
}

function str(v) {
  const d = dec(v);
  return d === null ? null : d.toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
}

function currencyInfo(code) {
  return CURRENCIES[code] || CURRENCIES.USD;
}

/**
 * Interpreta un importe escrito por una persona: "1.250,50", "1,250.50", "1250", "$ 3 400".
 * Devuelve { ok, value (string decimal), error }.
 */
function parseAmount(input, currency, { allowNegative = false } = {}) {
  if (input === null || input === undefined) return { ok: false, empty: true };
  let s = String(input).trim();
  if (!s) return { ok: false, empty: true };
  s = s.replace(/[\s $€]|MXN|COP|USD|EUR|PEN|CLP|ARS|GTQ|DOP|S\/|Q/gi, '');
  let negative = false;
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^[0-9.,]+$/.test(s)) return { ok: false, error: 'Escribe solo números, por ejemplo 1250 o 1.250,50.' };
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decimalSep = null;
  if (lastDot >= 0 && lastComma >= 0) {
    decimalSep = lastDot > lastComma ? '.' : ',';
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const count = s.split(sep).length - 1;
    const after = s.length - s.lastIndexOf(sep) - 1;
    const intPart = s.slice(0, s.indexOf(sep));
    // Los importes admiten como máximo 2 decimales: un único separador seguido de
    // exactamente 3 cifras es separador de miles ("1.250" y "1,250" valen 1250).
    if (count > 1) decimalSep = null;
    else if (after === 3 && intPart !== '0' && intPart !== '') decimalSep = null;
    else decimalSep = sep;
  }
  let normalized;
  if (decimalSep) {
    const thousands = decimalSep === '.' ? ',' : '.';
    const [intPart, ...rest] = s.split(decimalSep);
    if (rest.length > 1) return { ok: false, error: 'El número tiene más de un separador decimal.' };
    normalized = intPart.split(thousands).join('') + '.' + (rest[0] || '0');
  } else {
    normalized = s.replace(/[.,]/g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(normalized)) return { ok: false, error: 'No pudimos leer el importe. Escríbelo como 1250 o 1.250,50.' };
  const frac = normalized.split('.')[1];
  if (frac && frac.length > 2) return { ok: false, error: 'Usa como máximo dos decimales.' };
  let d = new D(normalized);
  if (negative) {
    if (!allowNegative) return { ok: false, error: 'El importe no puede ser negativo.' };
    d = d.neg();
  }
  if (d.abs().gt(MAX_AMOUNT)) return { ok: false, error: 'El importe es demasiado grande. Revisa la cifra.' };
  return { ok: true, value: d.toFixed(2) };
}

function format(v, currency, { decimals, sign = false } = {}) {
  const d = dec(v);
  if (d === null) return '—';
  const info = currencyInfo(currency);
  const places = decimals ?? info.decimals;
  const n = Number(d.toDecimalPlaces(places, D.ROUND_HALF_UP).toFixed(places));
  const f = new Intl.NumberFormat(info.locale, {
    style: 'currency',
    currency: CURRENCIES[currency] ? currency : 'USD',
    minimumFractionDigits: places,
    maximumFractionDigits: places,
    currencyDisplay: 'narrowSymbol',
  }).format(Math.abs(n));
  const prefix = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  return prefix + f;
}

function formatNumber(v, currency, places = 2) {
  const d = dec(v);
  if (d === null) return '';
  const info = currencyInfo(currency);
  return new Intl.NumberFormat(info.locale, { minimumFractionDigits: 0, maximumFractionDigits: places, useGrouping: true }).format(
    Number(d.toFixed(places))
  );
}

function formatPercent(v, places = 1) {
  const d = dec(v);
  if (d === null) return '—';
  return new Intl.NumberFormat('es', { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: places }).format(Number(d.toFixed(6)));
}

function formatCents(cents, currency) {
  return format(new D(cents).div(100), currency, { decimals: 2 });
}

function sum(values) {
  return values.reduce((acc, v) => acc.plus(dec(v) || 0), new D(0));
}

module.exports = { D, dec, round2, str, parseAmount, format, formatNumber, formatPercent, formatCents, sum, CURRENCIES, currencyInfo };
