'use strict';
// Caché de respuestas de IA (docs/coach-v2/03 §6): la misma pregunta normalizada con los mismos hechos devuelve
// la respuesta guardada durante 24 h, sin llamar al modelo y sin consumir el límite mensual. Cualquier movimiento
// nuevo cambia los hechos y por tanto la clave. Solo para consejo y redactar; la clave incluye la cuenta.
const crypto = require('node:crypto');
const db = require('../../../db');
const { normalizar } = require('../normalizar');

const HORAS = 24;

const ordenar = (v) => (Array.isArray(v) ? v.map(ordenar) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])])) : v);

function clave(userId, tarea, texto, hechos, versionPrefijo) {
  return crypto.createHash('sha256').update(JSON.stringify([userId, tarea, normalizar(texto || ''), ordenar(hechos || {}), versionPrefijo])).digest('hex');
}

function leer(key) {
  const r = db.one('SELECT response_json FROM coach_response_cache WHERE cache_key = ? AND expires_at > ?', key, db.now());
  return r ? JSON.parse(r.response_json) : null;
}

function guardar(userId, tarea, key, datos) {
  const ahora = db.now();
  const vence = new Date(Date.now() + HORAS * 3600000).toISOString();
  db.run(
    `INSERT INTO coach_response_cache (cache_key, user_id, task, response_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (cache_key) DO UPDATE SET response_json = excluded.response_json, created_at = excluded.created_at, expires_at = excluded.expires_at`,
    key, userId, tarea, JSON.stringify(datos), ahora, vence
  );
}

/** Elimina lo vencido (trabajo diario). */
function purgar() {
  return db.run('DELETE FROM coach_response_cache WHERE expires_at <= ?', db.now()).changes;
}

module.exports = { clave, leer, guardar, purgar, HORAS };
