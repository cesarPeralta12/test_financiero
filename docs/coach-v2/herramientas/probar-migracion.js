'use strict';
// Aplica las migraciones 001 a 004 del proyecto y la propuesta 005 en una base en memoria.
// Uso: node --experimental-sqlite docs/coach-v2/herramientas/probar-migracion.js
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const raiz = path.join(__dirname, '..', '..', '..');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
const archivos = fs.readdirSync(path.join(raiz, 'src', 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
for (const f of archivos) db.exec(fs.readFileSync(path.join(raiz, 'src', 'db', 'migrations', f), 'utf8'));
// Datos previos para comprobar que la reconstrucción de ai_runs no pierde filas.
db.exec("INSERT INTO users (email, password_hash, role, created_at, updated_at) VALUES ('a@x.test', 'x', 'usuario', 'n', 'n')");
db.exec("INSERT INTO ai_runs (user_id, purpose, provider, model, prompt_version, input_json, status, input_tokens, output_tokens, cost_micros, created_at) VALUES (1, 'coach', 'anthropic', 'claude-opus-5-5', 'coach-v1', '{}', 'ok', 100, 50, 1400, 'n')");
db.exec(fs.readFileSync(path.join(__dirname, '005_coach_v2.sql'), 'utf8'));
const n = db.prepare('SELECT COUNT(*) AS n FROM ai_runs').get().n;
db.exec("INSERT INTO ai_runs (user_id, purpose, task, provider, model, prompt_version, input_json, status, cache_read_tokens, created_at) VALUES (1, 'coach_clasificar', 'clasificar', 'anthropic', 'haiku-5.5', 'clf-v1', '{}', 'ok', 900, 'n')");
let rechazo = false;
try {
  db.exec("INSERT INTO ai_runs (user_id, purpose, provider, model, prompt_version, input_json, status, created_at) VALUES (1, 'otro', 'a', 'm', 'v', '{}', 'ok', 'n')");
} catch {
  rechazo = true;
}
const cols = db.prepare('PRAGMA table_info(movements)').all().map((c) => c.name);
console.log(`Migraciones previas: ${archivos.length}. Filas de ai_runs conservadas: ${n}. CHECK de purpose sigue rechazando valores ajenos: ${rechazo}.`);
console.log(`Columnas nuevas en movements: ${['subcategory', 'note_norm', 'deleted_at'].filter((c) => cols.includes(c)).join(', ')}`);
console.log('Tablas nuevas:', db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('recurring_movements','quick_templates','category_hints','coach_response_cache')").all().map((r) => r.name).join(', '));
