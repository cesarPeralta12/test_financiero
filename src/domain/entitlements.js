'use strict';
// Permisos de acceso separados: evaluación profunda, Plan Maestro y acompañamiento
// (coach + calculadora). Un paquete comercial concede varios permisos a la vez.
const db = require('../db');
const { audit } = require('../lib/services');

const CODES = ['evaluacion_profunda', 'plan_maestro', 'acompanamiento'];

function activeWhere() {
  return 'revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)';
}

function has(userId, code) {
  if (!userId) return false;
  return Boolean(db.value(`SELECT 1 FROM entitlements WHERE user_id = ? AND code = ? AND ${activeWhere()} LIMIT 1`, userId, code, db.now()));
}

function active(userId) {
  const out = {};
  for (const code of CODES) out[code] = false;
  if (!userId) return out;
  for (const r of db.all(`SELECT DISTINCT code FROM entitlements WHERE user_id = ? AND ${activeWhere()}`, userId, db.now())) out[r.code] = true;
  return out;
}

function list(userId) {
  return db.all('SELECT * FROM entitlements WHERE user_id = ? ORDER BY granted_at DESC', userId);
}

function expiryFrom(days, from = new Date()) {
  return days ? new Date(from.getTime() + days * 86400 * 1000).toISOString() : null;
}

/** Concede los permisos de una orden pagada. Idempotente por (orden, permiso). */
function grantFromOrder(order) {
  const grants = JSON.parse(order.grants_json);
  for (const g of grants) {
    db.run(
      `INSERT INTO entitlements (user_id, code, source, order_id, granted_at, expires_at)
       VALUES (?, ?, 'compra', ?, ?, ?) ON CONFLICT(order_id, code) WHERE order_id IS NOT NULL DO NOTHING`,
      order.user_id,
      g.code,
      order.id,
      db.now(),
      expiryFrom(g.days)
    );
  }
}

function revokeForOrder(orderId, reason) {
  return db.run("UPDATE entitlements SET revoked_at = ?, revoke_reason = ? WHERE order_id = ? AND revoked_at IS NULL", db.now(), reason, orderId).changes;
}

/** Activación manual desde el panel: exige motivo y queda auditada con administrador y fecha. */
function grantManual({ userId, code, days, adminId, reason }) {
  if (!CODES.includes(code)) throw new Error('Permiso desconocido.');
  if (!reason || reason.trim().length < 5) throw new Error('Escribe el motivo de la activación (mínimo 5 caracteres).');
  const r = db.run(
    `INSERT INTO entitlements (user_id, code, source, granted_at, expires_at, granted_by, reason) VALUES (?, ?, 'manual', ?, ?, ?, ?)`,
    userId,
    code,
    db.now(),
    expiryFrom(days),
    adminId,
    reason.trim()
  );
  audit(adminId, 'permiso.activacion_manual', { targetType: 'usuario', targetId: userId, reason: reason.trim(), meta: { code, days: days || null, entitlementId: r.lastId } });
  return r.lastId;
}

function revokeManual({ entitlementId, userId, adminId, reason }) {
  if (!reason || reason.trim().length < 5) throw new Error('Escribe el motivo de la revocación (mínimo 5 caracteres).');
  const n = db.run('UPDATE entitlements SET revoked_at = ?, revoke_reason = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL', db.now(), reason.trim(), entitlementId, userId).changes;
  if (n) audit(adminId, 'permiso.revocacion_manual', { targetType: 'usuario', targetId: userId, reason: reason.trim(), meta: { entitlementId } });
  return n;
}

module.exports = { CODES, has, active, list, grantFromOrder, revokeForOrder, grantManual, revokeManual };
