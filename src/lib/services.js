'use strict';
// Servicios transversales: ajustes, auditoría, embudo, avisos y contenidos versionados.
const db = require('../db');

// ───────── Ajustes configurables desde el panel ─────────
const SETTING_DEFAULTS = {
  ai_coach_monthly_limit: 60, // mensajes al coach por cuenta y mes
  ai_plan_monthly_limit: 6, // generaciones de plan por cuenta y mes
  ai_global_monthly_budget_usd: 50, // límite global de gasto estimado en IA
  ai_simulate_failure: false, // solo entornos de desarrollo y pruebas
  last_daily_run: null,
  last_backup_at: null,
};

function getSetting(key) {
  const row = db.one('SELECT value_json FROM settings WHERE key = ?', key);
  if (!row) return SETTING_DEFAULTS[key] ?? null;
  return db.parse(row.value_json, SETTING_DEFAULTS[key] ?? null);
}

function setSetting(key, value, actorId = null) {
  db.run(
    `INSERT INTO settings (key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    key,
    JSON.stringify(value),
    actorId,
    db.now()
  );
}

// ───────── Auditoría ─────────
function audit(actorId, action, { targetType = null, targetId = null, reason = null, meta = null } = {}) {
  db.run(
    'INSERT INTO audit_log (actor_user_id, action, target_type, target_id, reason, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    actorId,
    action,
    targetType,
    targetId === null ? null : String(targetId),
    reason,
    db.json(meta),
    db.now()
  );
}

// ───────── Embudo (sin datos financieros) ─────────
const FUNNEL = [
  ['visita', 'Visitas'],
  ['test_iniciado', 'Inicio de test'],
  ['test_finalizado', 'Fin de test'],
  ['registro', 'Registro'],
  ['pago_iniciado', 'Inicio de pago'],
  ['pago_confirmado', 'Pago confirmado'],
  ['evaluacion_completada', 'Evaluación completada'],
  ['plan_generado', 'Plan generado'],
  ['primera_tarea_completada', 'Primera tarea completada'],
];

function track(name, { anonId = null, userId = null, dedupe = null } = {}) {
  if (!FUNNEL.some(([n]) => n === name)) throw new Error(`Evento de embudo desconocido: ${name}`);
  let utm = null;
  if (anonId) utm = db.one('SELECT utm_source, utm_medium, utm_campaign FROM anonymous_sessions WHERE id = ?', anonId);
  if (!utm && userId) {
    utm = db.one(
      'SELECT utm_source, utm_medium, utm_campaign FROM anonymous_sessions WHERE linked_user_id = ? AND utm_source IS NOT NULL ORDER BY created_at LIMIT 1',
      userId
    );
  }
  db.run(
    `INSERT INTO analytics_events (name, anon_id, user_id, utm_source, utm_medium, utm_campaign, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING`,
    name,
    anonId,
    userId,
    utm?.utm_source,
    utm?.utm_medium,
    utm?.utm_campaign,
    dedupe,
    db.now()
  );
}

// ───────── Avisos dentro de la plataforma ─────────
function notify(userId, { kind, title, body = null, link = null, dedupe = null }) {
  db.run(
    `INSERT INTO notifications (user_id, kind, title, body, link, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(dedupe_key) DO NOTHING`,
    userId,
    kind,
    title,
    body,
    link,
    dedupe,
    db.now()
  );
}

function unreadCount(userId) {
  return db.value('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL', userId) || 0;
}

// ───────── Contenidos versionados ─────────
function content(key) {
  return db.one("SELECT * FROM contents WHERE key = ? AND status = 'publicado' ORDER BY version DESC LIMIT 1", key);
}

module.exports = { getSetting, setSetting, audit, track, FUNNEL, notify, unreadCount, content, SETTING_DEFAULTS };
