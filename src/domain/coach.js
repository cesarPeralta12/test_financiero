'use strict';
// Conversación guardada del Coach (mensajes por cuenta). Lo que responde vive en src/domain/coach/.
const db = require('../db');

function conversation(userId) {
  let c = db.one('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1', userId);
  if (!c) {
    const r = db.run("INSERT INTO conversations (user_id, title, created_at, updated_at) VALUES (?, 'Conversación con el coach', ?, ?)", userId, db.now(), db.now());
    c = db.one('SELECT * FROM conversations WHERE id = ?', r.lastId);
    addMessage(c, userId, {
      role: 'coach',
      content: 'Hola. Soy el coach de Día Uno, un asistente de inteligencia artificial. Conozco tu diagnóstico, tu plan y tu avance. Puedo explicarte tus cifras, simular escenarios y proponerte la siguiente acción. No guardo ningún cambio sin que lo confirmes.',
    });
  }
  return c;
}

function messages(conversationId, userId) {
  return db.all('SELECT * FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY id', conversationId, userId);
}

function addMessage(conv, userId, { role, content, kind = 'normal', data = null, proposal = null, aiRunId = null }) {
  const r = db.run(
    'INSERT INTO messages (conversation_id, user_id, role, kind, content, data_json, proposal_json, proposal_status, ai_run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    conv.id,
    userId,
    role,
    kind,
    content,
    db.json(data),
    db.json(proposal),
    proposal ? 'pendiente' : null,
    aiRunId,
    db.now()
  );
  db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', db.now(), conv.id);
  return r.lastId;
}

/** Resumen calculado por el servidor que recibe la IA en cada turno. */

module.exports = { conversation, messages };
