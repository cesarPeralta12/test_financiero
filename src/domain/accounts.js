'use strict';
// Cuentas: registro, vinculación de la sesión anónima, verificación y recuperación.
const db = require('../db');
const config = require('../config');
const mailer = require('../lib/mailer');
const { hashPassword, token, sha256 } = require('../lib/security');

function findByEmail(email) {
  return db.one('SELECT * FROM users WHERE email = ?', String(email).trim().toLowerCase());
}

function create({ email, password, name }) {
  const r = db.run(
    "INSERT INTO users (email, password_hash, name, role, created_at, updated_at) VALUES (?, ?, ?, 'usuario', ?, ?)",
    String(email).trim().toLowerCase(),
    hashPassword(password),
    name ? String(name).trim().slice(0, 80) : null,
    db.now(),
    db.now()
  );
  return db.one('SELECT * FROM users WHERE id = ?', r.lastId);
}

/** Vincula a la cuenta las evaluaciones y consentimientos de la sesión anónima, sin perder respuestas. */
function linkAnonymous(anonId, userId) {
  if (!anonId) return 0;
  return db.tx(() => {
    const n = db.run('UPDATE evaluations SET user_id = ?, anon_id = NULL WHERE anon_id = ? AND user_id IS NULL', userId, anonId).changes;
    db.run('UPDATE consents SET user_id = ?, anon_id = NULL WHERE anon_id = ? AND user_id IS NULL', userId, anonId);
    db.run('UPDATE anonymous_sessions SET linked_user_id = ?, linked_at = COALESCE(linked_at, ?) WHERE id = ?', userId, db.now(), anonId);
    db.run('UPDATE analytics_events SET user_id = ? WHERE anon_id = ? AND user_id IS NULL', userId, anonId);
    const cur = db.one("SELECT base_currency FROM evaluations WHERE user_id = ? AND base_currency IS NOT NULL ORDER BY updated_at DESC LIMIT 1", userId);
    if (cur) db.run('UPDATE users SET base_currency = COALESCE(base_currency, ?) WHERE id = ?', cur.base_currency, userId);
    return n;
  });
}

function issueToken(userId, purpose, hours) {
  const raw = token(32);
  db.run('UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL', db.now(), userId, purpose);
  db.run(
    'INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    userId,
    purpose,
    sha256(raw),
    new Date(Date.now() + hours * 3600 * 1000).toISOString(),
    db.now()
  );
  return raw;
}

function consumeToken(raw, purpose, { peek = false } = {}) {
  const row = db.one('SELECT * FROM auth_tokens WHERE token_hash = ? AND purpose = ?', sha256(String(raw || '')), purpose);
  if (!row || row.used_at || row.expires_at < db.now()) return null;
  if (!peek) db.run('UPDATE auth_tokens SET used_at = ? WHERE id = ?', db.now(), row.id);
  return row;
}

function sendVerification(user) {
  const raw = issueToken(user.id, 'verificar', 24 * 7);
  mailer.send({
    userId: user.id,
    to: user.email,
    subject: 'Confirma tu correo en Día Uno',
    purpose: 'verificacion',
    text: `Hola${user.name ? ' ' + user.name : ''}:

Confirma tu correo para proteger tu cuenta de Día Uno:
${config.appUrl}/verificar/${raw}

El enlace vence en 7 días. Si no creaste esta cuenta, ignora este mensaje.`,
  });
}

function sendRecovery(user) {
  const raw = issueToken(user.id, 'recuperar', 1);
  mailer.send({
    userId: user.id,
    to: user.email,
    subject: 'Crea una contraseña nueva para Día Uno',
    purpose: 'recuperacion',
    text: `Hola:

Recibimos una solicitud para cambiar la contraseña de tu cuenta de Día Uno. Crea una nueva aquí:
${config.appUrl}/restablecer/${raw}

El enlace vence en 1 hora y solo funciona una vez. Si no lo pediste, ignora este mensaje: tu contraseña no cambia.`,
  });
}

function setPassword(userId, password) {
  db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(password), db.now(), userId);
}

module.exports = { findByEmail, create, linkAnonymous, sendVerification, sendRecovery, consumeToken, setPassword };
