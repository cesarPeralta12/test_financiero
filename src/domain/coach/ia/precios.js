'use strict';
// Precios por modelo y costo exacto de una llamada (docs/coach-v2/02 §1 y §8).
// costo_micros = lectura_caché × p_lectura + escritura_caché × p_escritura + entrada_sin_caché × p_entrada + salida × p_salida
// (precios en USD por millón de tokens: tokens × precio = micro-USD). Los de OpenAI no están verificados: no se usan.
const precios = require('../data/precios-modelos.json');

// Identificadores de la API → clave del archivo de precios.
const CLAVE = { 'claude-haiku-5-5': 'haiku-5.5', 'claude-sonnet-5-5': 'sonnet-5.5', 'claude-opus-5-5': 'opus-5.5' };

function de(modelo) {
  const k = CLAVE[modelo] || modelo;
  return precios.anthropic[k] && typeof precios.anthropic[k] === 'object' ? precios.anthropic[k] : null;
}

/**
 * Costo de una llamada en micro-USD. `entrada` son los tokens de entrada SIN caché (la API los informa aparte
 * de `cache_read_input_tokens` y `cache_creation_input_tokens`). Devuelve null si el modelo no tiene precio verificado.
 */
function costoMicros(modelo, { entrada = 0, salida = 0, cacheLectura = 0, cacheEscritura = 0, ttl = '1h' } = {}) {
  const p = de(modelo);
  if (!p) return null;
  const escritura = ttl === '5m' ? p.escritura_cache_5m : p.escritura_cache_1h;
  return Math.round(cacheLectura * p.lectura_cache + cacheEscritura * escritura + entrada * p.entrada + salida * p.salida);
}

/**
 * Costo con los precios de OpenAI configurados (USD por millón). OpenAI informa los tokens en caché dentro de los de
 * entrada y no cobra escritura de caché. Devuelve null si no hay precios configurados.
 */
function costoOpenAI(precios, { entrada = 0, salida = 0, cacheLectura = 0 }) {
  if (!precios) return null;
  return Math.round(entrada * precios.entrada + cacheLectura * precios.cacheada + salida * precios.salida);
}

/** Tasa de aciertos de caché: lo leído de caché frente a todo lo que entró. */
function tasaAciertos({ entrada = 0, cacheLectura = 0, cacheEscritura = 0 }) {
  const total = entrada + cacheLectura + cacheEscritura;
  return total > 0 ? cacheLectura / total : null;
}

const minimoCacheable = (modelo) => (de(modelo) || {}).minimo_cacheable_tokens || 512;

module.exports = { costoOpenAI, costoMicros, tasaAciertos, minimoCacheable, de, CLAVE };
