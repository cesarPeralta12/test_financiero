'use strict';
// Exportación y eliminación de los datos de una cuenta a solicitud del titular.
const db = require('../db');
const { audit } = require('../lib/services');

function exportUser(userId) {
  const user = db.one('SELECT id, email, name, role, base_currency, email_verified_at, created_at, last_login_at FROM users WHERE id = ?', userId);
  if (!user) return null;
  const evaluations = db.all('SELECT id, kind, questionnaire_id, status, started_at, completed_at FROM evaluations WHERE user_id = ?', userId).map((e) => ({
    ...e,
    answers: db.all('SELECT code, value_json, is_unknown, is_skipped, updated_at FROM answers WHERE evaluation_id = ?', e.id).map((a) => ({
      code: a.code,
      value: db.parse(a.value_json),
      unknown: Boolean(a.is_unknown),
      skipped: Boolean(a.is_skipped),
      updated_at: a.updated_at,
    })),
    free_result: db.parse(db.value('SELECT result_json FROM free_results WHERE evaluation_id = ?', e.id)),
  }));
  const freeTests = db.all('SELECT id, version_id, status, currency, route, revision, completed_at, created_at FROM ft_sessions WHERE user_id = ?', userId).map((t) => ({
    ...t,
    answers: db.all('SELECT slot_id, variant_id, value_json, response_status, answer_revision, active, answered_at FROM ft_answers WHERE session_id = ? ORDER BY id', t.id).map((a) => ({ slot_id: a.slot_id, variant_id: a.variant_id, value: db.parse(a.value_json), status: a.response_status, revision: a.answer_revision, active: Boolean(a.active), answered_at: a.answered_at })),
    results: db.all('SELECT answer_revision, rules_version, status, narrative_source, result_json FROM ft_results WHERE session_id = ?', t.id).map((r) => ({ answer_revision: r.answer_revision, rules_version: r.rules_version, status: r.status, narrative_source: r.narrative_source, resultado: db.parse(r.result_json) })),
  }));
  const conversations = db.all('SELECT id, title, created_at FROM conversations WHERE user_id = ?', userId).map((c) => ({
    ...c,
    messages: db.all('SELECT role, kind, content, proposal_json, proposal_status, created_at FROM messages WHERE conversation_id = ? ORDER BY id', c.id),
  }));
  return {
    exportado: new Date().toISOString(),
    formato: 'dia-uno-exportacion-v1',
    cuenta: user,
    consentimientos: db.all('SELECT kind, content_key, content_version, accepted_at FROM consents WHERE user_id = ?', userId),
    evaluaciones: evaluations,
    tests_gratuitos: freeTests,
    diagnosticos: db.all('SELECT id, evaluation_id, calc_version, rule_set_id, result_json, created_at FROM diagnoses WHERE user_id = ?', userId).map((d) => ({ ...d, result_json: undefined, resultado: db.parse(d.result_json) })),
    planes: db.all('SELECT id, version_number, status, start_date, content_json, narrative_json, created_at, completed_at FROM plan_versions WHERE user_id = ?', userId).map((p) => ({
      ...p,
      content_json: undefined,
      narrative_json: undefined,
      contenido: db.parse(p.content_json),
      explicaciones: db.parse(p.narrative_json),
    })),
    tareas: db.all('SELECT id, title, reason, done_criteria, status, due_date, postponed_until, completed_at, source FROM tasks WHERE user_id = ?', userId),
    historial_tareas: db.all('SELECT task_id, from_status, to_status, note, created_at FROM task_events WHERE user_id = ?', userId),
    hitos: db.all('SELECT month, title, status, reached_at FROM milestones WHERE user_id = ?', userId),
    metas: db.all('SELECT id, name, kind, target_amount, initial_saved, target_months, status, created_at FROM goals WHERE user_id = ?', userId),
    deudas: db.all('SELECT id, name, kind, rate, rate_type, payment, fees, status FROM debts WHERE user_id = ?', userId).map((d) => ({ ...d, saldos: db.all('SELECT date, balance FROM debt_balances WHERE debt_id = ?', d.id) })),
    movimientos: db.all('SELECT date, kind, category, amount, currency, note, debt_id, goal_id, to_goal_id, created_at FROM movements WHERE user_id = ?', userId),
    presupuestos: db.all('SELECT month, kind, category, amount FROM budget_lines WHERE user_id = ?', userId),
    escenarios: db.all('SELECT name, base_source, inputs_json, results_json, created_at FROM scenarios WHERE user_id = ?', userId),
    conversaciones: conversations,
    avisos: db.all('SELECT kind, title, body, created_at, read_at FROM notifications WHERE user_id = ?', userId),
    compras: db.all('SELECT ref, product_name, amount_cents, currency, status, created_at, paid_at, refunded_at FROM orders WHERE user_id = ?', userId),
    accesos: db.all('SELECT code, source, granted_at, expires_at, revoked_at FROM entitlements WHERE user_id = ?', userId),
  };
}

/** Elimina la cuenta y sus datos. Las órdenes se conservan anonimizadas para fines contables. */
function deleteUser(userId, adminId, reason) {
  if (!reason || reason.trim().length < 5) throw new Error('Escribe el motivo de la eliminación.');
  const user = db.one('SELECT id, role FROM users WHERE id = ?', userId);
  if (!user) return false;
  if (user.role === 'admin') throw new Error('No se puede eliminar una cuenta de administración desde aquí.');
  db.tx(() => {
    db.run('DELETE FROM emails WHERE user_id = ?', userId);
    db.run('DELETE FROM anonymous_sessions WHERE linked_user_id = ?', userId);
    db.run('UPDATE analytics_events SET user_id = NULL, anon_id = NULL WHERE user_id = ?', userId);
    db.run("UPDATE privacy_requests SET user_email = 'eliminado', status = CASE WHEN status = 'pendiente' THEN 'completada' ELSE status END, resolved_at = COALESCE(resolved_at, ?), resolved_by = COALESCE(resolved_by, ?) WHERE user_id = ?", db.now(), adminId, userId);
    db.run('DELETE FROM users WHERE id = ?', userId);
    audit(adminId, 'privacidad.cuenta_eliminada', { targetType: 'usuario', targetId: userId, reason: reason.trim() });
  });
  return true;
}

module.exports = { exportUser, deleteUser };
