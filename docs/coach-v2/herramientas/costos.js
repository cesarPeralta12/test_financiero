'use strict';
// Calculadora de costos del Coach (actual vs. propuesto). Sin dependencias.
// Uso: node docs/coach-v2/herramientas/costos.js
// Los precios salen de ../json/precios-modelos.json; los tamaños de prompt son los
// MEDIDOS en el repositorio (ver 01-diagnostico-y-medicion.md) o supuestos marcados.
const P = require('../json/precios-modelos.json').anthropic;

const usd = (n) => (n >= 100 ? `$${n.toFixed(0)}` : n >= 1 ? `$${n.toFixed(2)}` : n >= 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(5)}`);
const M = 1e6;

/** Costo de una llamada. Los tokens en caché se leen al precio de lectura. */
function llamada(modelo, { estatico = 0, dinamico = 0, salida = 0, aciertoCache = 0, lote = false, sinCache = false }) {
  const p = P[modelo];
  if (sinCache) {
    const c0 = ((estatico + dinamico) * p.entrada + salida * p.salida) / M;
    return lote ? c0 * P.batch_descuento : c0;
  }
  const leido = estatico * aciertoCache; // se lee de caché
  const escrito = estatico * (1 - aciertoCache); // se escribe (5 min) la primera vez
  let c = (leido * p.lectura_cache + escrito * p.escritura_cache_5m + dinamico * p.entrada + salida * p.salida) / M;
  if (lote) c *= P.batch_descuento;
  return c;
}

// ───── Perfil ACTUAL (medido + supuestos) ─────
// system + herramientas ≈ 1.200; contexto ≈ 800; historial promedio ≈ 650 (supuesto: 10 msgs de ~65 tokens)
const ACTUAL = { estatico: 1200, contexto: 800, historial: 650, usuario: 40 };
const entrada1 = ACTUAL.estatico + ACTUAL.contexto + ACTUAL.historial + ACTUAL.usuario; // una vuelta
const actual = {
  sinHerramienta: llamada('opus-5.5', { dinamico: entrada1, salida: 700 }),
  conHerramienta: llamada('opus-5.5', { dinamico: entrada1 * 2 + 500, salida: 800 }), // 2 vueltas + resultado de herramienta
};
actual.mezcla = actual.sinHerramienta * 0.6 + actual.conHerramienta * 0.4; // supuesto: 40 % usa herramienta

// ───── Perfiles PROPUESTOS ─────
const PERFIL = {
  clasificar: { modelo: 'haiku-5.5', estatico: 900, dinamico: 60, salida: 40 },
  extraer: { modelo: 'haiku-5.5', estatico: 800, dinamico: 50, salida: 60 },
  redactar: { modelo: 'haiku-5.5', estatico: 700, dinamico: 300, salida: 150 },
  consejo: { modelo: 'sonnet-5.5', estatico: 1400, dinamico: 660, salida: 350 },
};
const REPARTO_IA = { clasificar: 0.35, extraer: 0.25, redactar: 0.25, consejo: 0.15 }; // de las llamadas que SÍ van a IA

function propuesto(aciertoCache) {
  let total = 0;
  const filas = {};
  for (const [k, w] of Object.entries(REPARTO_IA)) {
    const c = llamada(PERFIL[k].modelo, { ...PERFIL[k], aciertoCache });
    filas[k] = c;
    total += c * w;
  }
  return { porLlamada: total, filas };
}

const usos = [60, 150, 300]; // interacciones por usuario y mes (60 = tope actual; 300 = 10 al día)
const sinIA = [0.9, 0.95, 0.98];

console.log('## Costo por interacción\n');
console.log(`Actual, sin herramienta (Opus 5.5, ${entrada1} tok entrada, 700 salida): ${usd(actual.sinHerramienta)}`);
console.log(`Actual, con herramienta (2 vueltas): ${usd(actual.conHerramienta)}`);
console.log(`Actual, mezcla 60/40: ${usd(actual.mezcla)}\n`);
for (const hit of [0, 0.7, 0.95]) {
  const p = propuesto(hit);
  console.log(`Propuesto, llamada a IA con ${Math.round(hit * 100)} % de aciertos de caché: ${usd(p.porLlamada)} (clasificar ${usd(p.filas.clasificar)}, extraer ${usd(p.filas.extraer)}, redactar ${usd(p.filas.redactar)}, consejo ${usd(p.filas.consejo)})`);
}

console.log('\n## Costo mensual por usuario activo (caché 70 %)\n');
console.log('| Interacciones al mes | Actual | Propuesto 90 % sin IA | 95 % sin IA | 98 % sin IA | Ahorro (95 %) |');
console.log('|---|---|---|---|---|---|');
const p70 = propuesto(0.7).porLlamada;
for (const n of usos) {
  const a = n * actual.mezcla;
  const cols = sinIA.map((s) => n * (1 - s) * p70);
  console.log(`| ${n} | ${usd(a)} | ${usd(cols[0])} | ${usd(cols[1])} | ${usd(cols[2])} | ${((1 - cols[1] / a) * 100).toFixed(1)} % |`);
}

console.log('\n## 1.000 usuarios activos al mes (caché 70 %)\n');
console.log('| Interacciones por usuario | Actual | Propuesto (95 % sin IA) |');
console.log('|---|---|---|');
for (const n of usos) console.log(`| ${n} | ${usd(1000 * n * actual.mezcla)} | ${usd(1000 * n * 0.05 * p70)} |`);

console.log('\n## Sensibilidad: si TODO fuera a IA con el esquema propuesto (peor caso), 150 interacciones por usuario');
console.log(`Costo por usuario al mes: ${usd(150 * p70)} (sin reglas, pero con Haiku/Sonnet y caché)`);
console.log('\n## Solo cambiar de modelo (sin reglas): el mismo prompt actual en Sonnet 5.5 y en Haiku 5.5');
for (const m of ['sonnet-5.5', 'haiku-5.5']) {
  const a = llamada(m, { dinamico: entrada1, salida: 700 }) * 0.6 + llamada(m, { dinamico: entrada1 * 2 + 500, salida: 800 }) * 0.4;
  console.log(`${m}: ${usd(a)} por interacción; ${usd(150 * a)} por usuario con 150 interacciones al mes`);
}

console.log('\n## Sensibilidad al porcentaje resuelto sin IA (150 interacciones por usuario y mes, caché 70 %)\n');
console.log('| % sin IA | Costo por usuario y mes | Costo por 1.000 usuarios |');
console.log('|---|---|---|');
for (const s of [0.5, 0.8, 0.9, 0.95, 0.98, 1]) {
  const c = 150 * (1 - s) * p70;
  console.log(`| ${Math.round(s * 100)} % | ${usd(c)} | ${usd(c * 1000)} |`);
}

console.log('\n## Sensibilidad a la proporción de consejos abiertos (Sonnet) entre las llamadas a IA (150 interacciones, 95 % sin IA, caché 70 %)\n');
console.log('| % de consejos abiertos entre las llamadas a IA | Costo por usuario y mes |');
console.log('|---|---|');
for (const w of [0.05, 0.15, 0.3, 0.5, 1]) {
  const resto = (1 - w) / (1 - REPARTO_IA.consejo);
  let por = 0;
  for (const [k, peso] of Object.entries(REPARTO_IA)) {
    const c = llamada(PERFIL[k].modelo, { ...PERFIL[k], aciertoCache: 0.7 });
    por += c * (k === 'consejo' ? w : peso * resto);
  }
  console.log(`| ${Math.round(w * 100)} % | ${usd(150 * 0.05 * por)} |`);
}

console.log('\n## Costo de una llamada de IA por tarea con y sin caché\n');
console.log('| Tarea | Modelo | Fijo (tok) | Variable (tok) | Salida (tok) | Sin usar caché | Caché sin aciertos (siempre escribe) | Caché con 95 % de aciertos |');
console.log('|---|---|---|---|---|---|---|---|');
for (const [k, p] of Object.entries(PERFIL)) {
  console.log(`| ${k} | ${p.modelo} | ${p.estatico} | ${p.dinamico} | ${p.salida} | ${usd(llamada(p.modelo, { ...p, sinCache: true }))} | ${usd(llamada(p.modelo, { ...p, aciertoCache: 0 }))} | ${usd(llamada(p.modelo, { ...p, aciertoCache: 0.95 }))} |`);
}
