'use strict';
// Tareas del plan (F11): completar, posponer y reabrir, con historial de cambios.
const db = require('../db');
const { track, notify } = require('../lib/services');

function list(userId, { includeArchived = false } = {}) {
  return db.all(
    `SELECT * FROM tasks WHERE user_id = ? ${includeArchived ? '' : 'AND archived = 0'}
     ORDER BY CASE status WHEN 'pendiente' THEN 0 WHEN 'pospuesta' THEN 1 ELSE 2 END, COALESCE(postponed_until, due_date), position, id`,
    userId
  );
}

function get(userId, id) {
  return db.one('SELECT * FROM tasks WHERE id = ? AND user_id = ?', id, userId);
}

/** La siguiente acción: la tarea pendiente más próxima (o pospuesta ya vencida). */
function next(userId) {
  const today = new Date().toISOString().slice(0, 10);
  return db.one(
    `SELECT * FROM tasks WHERE user_id = ? AND archived = 0 AND (status = 'pendiente' OR (status = 'pospuesta' AND postponed_until <= ?))
     ORDER BY COALESCE(postponed_until, due_date), position, id LIMIT 1`,
    userId,
    today
  );
}

function event(task, to, note = null) {
  db.run('INSERT INTO task_events (task_id, user_id, from_status, to_status, note, created_at) VALUES (?, ?, ?, ?, ?, ?)', task.id, task.user_id, task.status, to, note, db.now());
}

function complete(userId, id, note = null) {
  const t = get(userId, id);
  if (!t || t.status === 'completada') return false;
  db.tx(() => {
    db.run("UPDATE tasks SET status = 'completada', completed_at = ?, postponed_until = NULL, updated_at = ? WHERE id = ?", db.now(), db.now(), id);
    event(t, 'completada', note);
  });
  track('primera_tarea_completada', { userId, dedupe: `primera_tarea:${userId}` });
  return true;
}

function postpone(userId, id, until) {
  const t = get(userId, id);
  if (!t || t.status === 'completada') return false;
  db.tx(() => {
    db.run("UPDATE tasks SET status = 'pospuesta', postponed_until = ?, updated_at = ? WHERE id = ?", until, db.now(), id);
    event(t, 'pospuesta', `Hasta ${until}`);
  });
  return true;
}

function reopen(userId, id) {
  const t = get(userId, id);
  if (!t || t.status === 'pendiente') return false;
  db.tx(() => {
    db.run("UPDATE tasks SET status = 'pendiente', completed_at = NULL, postponed_until = NULL, updated_at = ? WHERE id = ?", db.now(), id);
    event(t, 'pendiente', 'Reabierta');
  });
  return true;
}

function create(userId, { title, reason, criteria, source = 'usuario', dueDate = null }) {
  const plan = db.one("SELECT id FROM plan_versions WHERE user_id = ? AND is_current = 1", userId);
  const pos = (db.value('SELECT MAX(position) FROM tasks WHERE user_id = ?', userId) || 0) + 1;
  const r = db.run(
    `INSERT INTO tasks (user_id, plan_version_id, position, title, reason, done_criteria, due_date, status, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)`,
    userId,
    plan ? plan.id : null,
    pos,
    String(title).slice(0, 120),
    reason ? String(reason).slice(0, 400) : null,
    criteria ? String(criteria).slice(0, 400) : null,
    dueDate || new Date().toISOString().slice(0, 10),
    source,
    db.now(),
    db.now()
  );
  db.run("INSERT INTO task_events (task_id, user_id, from_status, to_status, note, created_at) VALUES (?, ?, NULL, 'pendiente', ?, ?)", r.lastId, userId, source === 'coach' ? 'Propuesta por el coach y confirmada' : 'Creada por la persona', db.now());
  return r.lastId;
}

/** Avisos diarios dentro de la plataforma sobre tareas y metas. */
function dailyNotices() {
  const today = new Date().toISOString().slice(0, 10);
  const due = db.all(
    "SELECT * FROM tasks WHERE archived = 0 AND ((status = 'pendiente' AND due_date <= ?) OR (status = 'pospuesta' AND postponed_until <= ?))",
    today,
    today
  );
  for (const t of due) {
    notify(t.user_id, { kind: 'tarea', title: t.due_date < today ? `Tarea pendiente: ${t.title}` : `Hoy toca: ${t.title}`, body: t.done_criteria, link: '/tablero', dedupe: `tarea:${t.id}:${today}` });
  }
  const tracker = require('./tracker');
  const users = db.all("SELECT DISTINCT user_id FROM goals WHERE status = 'activa'");
  for (const { user_id } of users) {
    for (const g of tracker.goals(user_id)) {
      if (g.status === 'activa' && g.progress.valid && g.progress.pending.isZero()) {
        db.run("UPDATE goals SET status = 'alcanzada', updated_at = ? WHERE id = ?", db.now(), g.id);
        notify(user_id, { kind: 'meta', title: `Alcanzaste tu meta: ${g.name}`, link: '/tablero', dedupe: `meta:${g.id}` });
      }
    }
  }
  return due.length;
}

module.exports = { list, get, next, complete, postpone, reopen, create, dailyNotices };
