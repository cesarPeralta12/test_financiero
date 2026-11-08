'use strict';
// Consentimiento antes de guardar información financiera. Se registra la versión
// del texto aceptado y la fecha.
const db = require('../db');
const { content } = require('../lib/services');

function current() {
  return content('consentimiento');
}

function has(owner) {
  const c = current();
  if (!c) return false;
  if (owner.userId) {
    if (db.value("SELECT 1 FROM consents WHERE user_id = ? AND kind = 'datos_financieros' AND content_version = ?", owner.userId, c.version)) return true;
  }
  if (owner.anonId) {
    return Boolean(db.value("SELECT 1 FROM consents WHERE anon_id = ? AND kind = 'datos_financieros' AND content_version = ?", owner.anonId, c.version));
  }
  return false;
}

function record(owner, kind = 'datos_financieros') {
  const key = kind === 'datos_financieros' ? 'consentimiento' : 'condiciones';
  const c = content(key);
  db.run(
    'INSERT INTO consents (user_id, anon_id, kind, content_key, content_version, accepted_at) VALUES (?, ?, ?, ?, ?, ?)',
    owner.userId || null,
    owner.userId ? null : owner.anonId || null,
    kind,
    key,
    c ? c.version : 0,
    db.now()
  );
}

module.exports = { current, has, record };
