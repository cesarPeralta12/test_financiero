'use strict';
// La nota de un movimiento es lo que la persona gastó («café»), no la frase con la que lo dijo
// («registro un gasto de un café a 8.50»). El parser entiende la frase y devuelve solo el residuo
// útil, normalizado (sin tildes); aquí se recupera con las tildes y mayúsculas originales.
const parser = require('./parser');
const { normalizar } = require('./normalizar');

const quitarSignos = (t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/** Devuelve las palabras de `original` cuyo texto normalizado está en `notaNorm`, respetando el orden y las tildes. */
function conTildes(original, notaNorm) {
  if (!notaNorm) return null;
  const pool = normalizar(notaNorm).split(' ').filter(Boolean);
  const out = [];
  for (const tok of String(original || '').replace(/<[^>]*>/g, ' ').split(/\s+/)) {
    const limpio = quitarSignos(tok);
    if (!limpio) continue;
    const i = pool.indexOf(normalizar(limpio));
    if (i >= 0) {
      out.push(limpio);
      pool.splice(i, 1);
    }
  }
  return out.join(' ').trim() || notaNorm;
}

/**
 * Limpia la nota que viene de un texto o de un modelo: si es una frase de registro completa
 * («registra un gasto de 8.50 en café»), se queda con lo útil («café»); si ya es una nota corta, no la toca.
 */
function limpiar(raw, { hoy = new Date().toISOString().slice(0, 10), moneda = 'USD' } = {}) {
  const t = String(raw || '').trim();
  if (!t) return null;
  const r = parser.parsear(t, { hoy, moneda });
  const esRegistro = String(r.intencion || '').startsWith('registrar_') && r.entidades.importe;
  if (!esRegistro) return t.slice(0, 140);
  return r.entidades.nota ? conTildes(t, r.entidades.nota).slice(0, 140) : null;
}

module.exports = { conTildes, limpiar };
