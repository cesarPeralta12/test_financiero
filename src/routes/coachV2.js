'use strict';
// POST /api/v1/coach/mensajes (Coach v2, sin IA) y GET /api/v1/coach/conversacion.
// Activo con la bandera `coach_v2_enabled`; con la bandera apagada responde el Coach anterior.
const db = require('../db');
const { sha256, rateLimit } = require('../lib/security');
const { CoachError } = require('../domain/coach/respuesta');
const { responderConIA } = require('../domain/coach/respuestaIA');
const coach = require('../domain/coach');
const { getSetting } = require('../lib/services');
const { wrap } = require('./util');

const KEY = /^[A-Za-z0-9._:-]{8,64}$/;
const fail = (res, status, codigo, mensaje) => res.status(status).json({ error: { codigo, mensaje } });

const enabled = (user) => require('../domain/coach/rollout').activoPara(user && user.id);

/** Middleware: si la bandera está abierta atiende aquí; si no, deja pasar al Coach anterior. */
const post = wrap(async (req, res, next) => {
  if (!enabled(req.user)) return next();
  const rl = rateLimit({ key: `coachv2:${req.user.id}`, limit: 20, windowMs: 60_000 });
  if (!rl.allowed) return fail(res, 429, 'LIMITE_POR_MINUTO', 'Vas muy rápido. Espera un momento.');
  const body = req.body || {};
  const sol = { texto: body.texto ?? body.mensaje, accion: body.accion, mensaje_id: body.mensaje_id, campo: body.campo, valor: body.valor, intencion: body.intencion };
  const key = req.get('idempotency-key') || body.idempotency_key || null;
  if (key && !KEY.test(String(key))) return fail(res, 422, 'DATOS_INVALIDOS', 'La clave de idempotencia no es válida.');
  const hash = sha256(JSON.stringify(sol, Object.keys(sol).sort()));
  if (key) {
    const prev = db.one('SELECT request_hash, status, response_json FROM idempotency_keys WHERE user_id = ? AND key = ?', req.user.id, `coach:${key}`);
    if (prev) {
      if (prev.request_hash !== hash) return fail(res, 409, 'IDEMPOTENCIA_CONFLICTO', 'Esa clave ya se usó con otro contenido.');
      return res.status(prev.status).set('Idempotent-Replayed', 'true').json(JSON.parse(prev.response_json));
    }
  }
  try {
    const out = await responderConIA(req.user.id, sol);
    if (key) db.run('INSERT INTO idempotency_keys (user_id, key, request_hash, status, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)', req.user.id, `coach:${key}`, hash, 200, JSON.stringify(out), db.now());
    return res.json(out);
  } catch (e) {
    if (e instanceof CoachError) return fail(res, e.status, e.codigo, e.message);
    throw e;
  }
});

/** Conversación paginada por id descendente: `?desde=<id>&limite=30`. */
function conversacion(req, res) {
  const conv = coach.conversation(req.user.id);
  const limite = Math.min(100, Math.max(1, Number.parseInt(req.query.limite, 10) || 30));
  const desde = Number.parseInt(req.query.desde, 10) || Number.MAX_SAFE_INTEGER;
  const rows = db.all('SELECT * FROM messages WHERE conversation_id = ? AND user_id = ? AND id < ? ORDER BY id DESC LIMIT ?', conv.id, req.user.id, desde, limite + 1);
  const page = rows.slice(0, limite);
  res.json({
    mensajes: page.map((m) => {
      const p = db.parse(m.payload_json, {}) || {};
      return { id: m.id, rol: m.role, texto: m.content, origen: m.origin, intencion: m.intent, variante_id: m.variant_id, tarjetas: p.tarjetas || [], propuesta: p.pendiente ? { estado: p.pendiente.estado } : null, fecha: m.created_at };
    }),
    siguiente: rows.length > limite ? page[page.length - 1].id : null,
  });
}

module.exports = { post, conversacion, enabled };
