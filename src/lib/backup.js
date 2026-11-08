'use strict';
// Respaldos de la base de datos: copia consistente (VACUUM INTO), verificación
// mediante restauración en un archivo temporal y rotación.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const db = require('../db');
const config = require('../config');

const KEY_TABLES = ['users', 'evaluations', 'answers', 'orders', 'entitlements', 'diagnoses', 'plan_versions', 'tasks', 'movements', 'messages'];

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
}

function counts(handle) {
  const out = {};
  for (const t of KEY_TABLES) out[t] = Number(handle.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n);
  return out;
}

function create(dir = config.backupDir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `dia-uno-${config.env}-${stamp()}.db`);
  db.get().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

/** Restaura el respaldo en un archivo temporal y comprueba integridad y conteos. */
function verify(file, { compareLive = true } = {}) {
  const tmp = path.join(os.tmpdir(), `dia-uno-verificacion-${Date.now()}.db`);
  fs.copyFileSync(file, tmp);
  const h = new DatabaseSync(tmp, { readOnly: true });
  try {
    const integrity = h.prepare('PRAGMA integrity_check').get();
    const ok = Object.values(integrity)[0] === 'ok';
    const restored = counts(h);
    const live = compareLive ? counts(db.get()) : null;
    const migrations = h.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;
    return { ok: ok && Number(migrations) > 0, integrity: Object.values(integrity)[0], restored, live, file: path.basename(file), size: fs.statSync(file).size };
  } finally {
    h.close();
    fs.rmSync(tmp, { force: true });
  }
}

function prune(dir = config.backupDir, keep = config.backupKeep) {
  if (!fs.existsSync(dir)) return 0;
  const files = list(dir);
  const old = files.slice(keep);
  for (const f of old) fs.rmSync(path.join(dir, f.name), { force: true });
  return old.length;
}

function list(dir = config.backupDir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((name) => ({ name, size: fs.statSync(path.join(dir, name)).size, mtime: fs.statSync(path.join(dir, name)).mtime.toISOString() }))
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

/** Restaura un respaldo sobre la base indicada (con el servidor detenido). */
function restore(file, target = config.databasePath) {
  const check = verify(file, { compareLive: false });
  if (!check.ok) throw new Error(`El respaldo no pasó la verificación: ${check.integrity}`);
  if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.antes-de-restaurar-${stamp()}`);
  for (const ext of ['-wal', '-shm']) fs.rmSync(`${target}${ext}`, { force: true });
  fs.copyFileSync(file, target);
  return check;
}

module.exports = { create, verify, prune, list, restore, counts, KEY_TABLES };
