'use strict';
// Acceso a datos. SQLite integrado en Node (node:sqlite). El esquema usa SQL estándar
// y está aislado en migraciones para poder portarlo a MySQL si se valida ese stack.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

let db = null;

function open(file = config.databasePath) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
  }
  db.exec('PRAGMA synchronous = NORMAL;');
  return db;
}

function get() {
  return db || open();
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

const stmtCache = new Map();
function prep(sql) {
  const d = get();
  let s = stmtCache.get(sql);
  if (!s || s.__db !== d) {
    s = d.prepare(sql);
    s.__db = d;
    stmtCache.set(sql, s);
  }
  return s;
}

function normalize(params) {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

function one(sql, ...params) {
  const row = prep(sql).get(...normalize(params));
  return row ? { ...row } : null;
}
function all(sql, ...params) {
  return prep(sql).all(...normalize(params)).map((r) => ({ ...r }));
}
function run(sql, ...params) {
  const r = prep(sql).run(...normalize(params));
  return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
}
function value(sql, ...params) {
  const row = prep(sql).get(...normalize(params));
  if (!row) return null;
  const k = Object.keys(row)[0];
  return row[k];
}

let depth = 0;
function tx(fn) {
  const d = get();
  if (depth > 0) {
    // Transacción anidada mediante SAVEPOINT.
    const name = `sp${depth}`;
    d.exec(`SAVEPOINT ${name}`);
    depth++;
    try {
      const out = fn();
      depth--;
      d.exec(`RELEASE ${name}`);
      return out;
    } catch (e) {
      depth--;
      d.exec(`ROLLBACK TO ${name}`);
      d.exec(`RELEASE ${name}`);
      throw e;
    }
  }
  d.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const out = fn();
    depth--;
    d.exec('COMMIT');
    return out;
  } catch (e) {
    depth--;
    d.exec('ROLLBACK');
    throw e;
  }
}

function now() {
  return new Date().toISOString();
}

function json(v) {
  return v === undefined || v === null ? null : JSON.stringify(v);
}
function parse(v, d = null) {
  if (v === null || v === undefined || v === '') return d;
  try {
    return JSON.parse(v);
  } catch {
    return d;
  }
}

module.exports = { open, get, close, one, all, run, value, tx, now, json, parse };
