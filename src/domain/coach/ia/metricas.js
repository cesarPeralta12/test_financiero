'use strict';
// Métricas y alarmas del Coach (docs/coach-v2/03 §6): qué parte se resuelve sin IA, cuánto cuesta cada tarea
// y si algo se sale de lo esperado. Solo agregados: nunca el texto de las personas.
const db = require('../../../db');
const { getSetting } = require('../../../lib/services');

const iso = (ms) => new Date(Date.now() - ms).toISOString();
const H = 3600000;
const COACH = "purpose LIKE 'coach\\_%' ESCAPE '\\'";

function porTarea(desde) {
  return db.all(
    `SELECT task AS tarea, COUNT(*) AS llamadas, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errores,
            SUM(CASE WHEN error_code LIKE 'salida_descartada%' THEN 1 ELSE 0 END) AS descartadas,
            SUM(input_tokens) AS entrada, SUM(output_tokens) AS salida, SUM(cache_read_tokens) AS cache_lectura, SUM(cache_write_tokens) AS cache_escritura,
            SUM(cost_micros) AS costo, ROUND(AVG(latency_ms)) AS latencia
       FROM ai_runs WHERE ${COACH} AND created_at >= ? GROUP BY task ORDER BY task`,
    desde
  );
}

/** Aciertos de caché de prompt: tokens leídos del prefijo cacheado / tokens totales de entrada. */
function tasaCache(desde) {
  const r = db.one(`SELECT SUM(cache_read_tokens) AS l, SUM(cache_write_tokens) AS e, SUM(input_tokens) AS i FROM ai_runs WHERE ${COACH} AND created_at >= ?`, desde);
  const total = (r.l || 0) + (r.e || 0) + (r.i || 0);
  return { tasa: total ? (r.l || 0) / total : null, tokens: total };
}

function origenes(desde) {
  const filas = db.all("SELECT origin AS origen, COUNT(*) AS n FROM messages WHERE role = 'coach' AND created_at >= ? AND origin IS NOT NULL GROUP BY origin", desde);
  const total = filas.reduce((a, f) => a + f.n, 0);
  const n = (o) => (filas.find((f) => f.origen === o) || {}).n || 0;
  const noEntendi = db.value("SELECT COUNT(*) FROM messages WHERE role = 'coach' AND intent = 'no_entendi' AND created_at >= ?", desde);
  return { total, sinIA: total ? (total - n('ia') - n('cache')) / total : null, noEntendi, tasaNoEntendi: total ? noEntendi / total : null, porOrigen: filas };
}

function alarmas() {
  const out = [];
  const d24 = iso(24 * H);
  const llamadas24 = db.value(`SELECT COUNT(*) FROM ai_runs WHERE ${COACH} AND created_at >= ?`, d24);
  const o = origenes(d24);
  if (llamadas24 && o.total) {
    const costo = db.value(`SELECT COALESCE(SUM(cost_micros), 0) FROM ai_runs WHERE ${COACH} AND created_at >= ?`, d24);
    const porInteraccion = costo / o.total / 1e6;
    if (porInteraccion > 0.002) out.push({ clave: 'costo', texto: `Costo por interacción de ${porInteraccion.toFixed(4)} USD en 24 h (umbral 0,002 USD).` });
  }
  if (o.total >= 20 && o.sinIA !== null && o.sinIA < 0.9) out.push({ clave: 'sin_ia', texto: `Solo ${Math.round(o.sinIA * 100)} % de las respuestas se resolvió sin IA en 24 h (esperado ≥ 90 %).` });
  const c1 = tasaCache(iso(H));
  if (c1.tokens >= 5000 && c1.tasa !== null && c1.tasa < 0.7) out.push({ clave: 'cache', texto: `Aciertos de caché de prompt de ${Math.round(c1.tasa * 100)} % en la última hora (esperado ≥ 70 %).` });
  const f15 = db.one(`SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS e FROM ai_runs WHERE ${COACH} AND created_at >= ?`, iso(15 * 60000));
  if (f15.n >= 10 && f15.e / f15.n > 0.05) out.push({ clave: 'fallos', texto: `${Math.round((f15.e / f15.n) * 100)} % de fallos del proveedor en los últimos 15 minutos (umbral 5 %).` });
  return out;
}

function ajustes() {
  const claves = ['coach_v2_ia_directa', 'coach_v2_ia_automatica', 'coach_v2_resumen_semanal', 'coach_v2_registro_rapido', 'ai_coach_daily_auto_limit', 'ai_coach_budget_guard', 'ai_coach_monthly_limit'];
  return Object.fromEntries(claves.map((k) => [k, getSetting(k)]));
}

function proveedor() {
  const config = require('../../../config');
  const p = require('./router').proveedorActual();
  if (p === 'openai') return { nombre: 'OpenAI', modelos: config.ai.coachOpenaiModels, preciosConfigurados: Boolean(config.ai.openaiPrices) };
  if (p === 'anthropic') return { nombre: 'Anthropic', modelos: config.ai.coachModels, preciosConfigurados: true };
  return { nombre: 'local de desarrollo (simulador)', modelos: {}, preciosConfigurados: true };
}

function resumen(dias = 7) {
  const desde = iso(dias * 24 * H);
  return { dias, proveedor: proveedor(), tareas: porTarea(desde), cache: tasaCache(desde), origenes: origenes(desde), alarmas: alarmas(), ajustes: ajustes() };
}

module.exports = { resumen, alarmas, porTarea, tasaCache, origenes };
