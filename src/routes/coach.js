'use strict';
// F09 Coach (requiere el acceso de acompañamiento).
const express = require('express');
const coach = require('../domain/coach');
const tracker = require('../domain/tracker');
const { requireEntitlement } = require('./guards');
const { wrap } = require('./util');
const { rateLimit } = require('../lib/security');
const db = require('../db');
const { CoachError } = require('../domain/coach/respuesta');
const { responderConIA } = require('../domain/coach/respuestaIA');
const { sugerencias } = require('../domain/coach/sugerencias');
const v2view = require('../views/coachV2');

const router = express.Router();
const guard = requireEntitlement('acompanamiento');

// ───────── Conversación ─────────
function pagina(req, res) {
  const conv = coach.conversation(req.user.id);
  const filas = db.all('SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY id DESC LIMIT 40) ORDER BY id', conv.id, req.user.id).map((f) => ({ ...f, payload: db.parse(f.payload_json, {}) || {} }));
  const vacia = !filas.some((f) => f.origin);
  res.active('coach').page({
    title: 'Coach',
    body: v2view.pagina(res.locals.ctx, { filas, cur: tracker.baseCurrency(req.user.id), vacia, sugerencias: sugerencias(req.user.id), nombre: req.user.name, tarea: (require('../domain/tasks').next(req.user.id) || {}).title }),
  });
}

/** Un mensaje o un botón: con `X-Fragment: 1` devuelve la tarjeta para agregarla sin recargar; sin JavaScript, redirige. */
router.post('/coach/enviar', guard, wrap(async (req, res) => {
  const fragmento = req.get('x-fragment') === '1';
  const b = req.body || {};
  const cur = tracker.baseCurrency(req.user.id);
  const mostrar = String(b.texto || b.etiqueta || '').slice(0, 80);
  const enviar = (extra) => res.type('html').send(v2view.fragmento(res.locals.ctx, { texto: mostrar, sugerencias: sugerencias(req.user.id), cur, ...extra }).toString());
  const rl = rateLimit({ key: `coachv2web:${req.user.id}`, limit: 20, windowMs: 60_000 });
  if (!rl.allowed) return fragmento ? res.status(429).type('html').send(v2view.fragmento(res.locals.ctx, { error: 'Vas muy rápido. Espera un momento y vuelve a intentarlo.', sugerencias: sugerencias(req.user.id), cur }).toString()) : res.redirect(303, '/coach?aviso=coach_error#cv-fin');
  try {
    const out = await responderConIA(req.user.id, { texto: b.texto, accion: b.accion, mensaje_id: b.mensaje_id, campo: b.campo, valor: b.valor, intencion: b.intencion });
    if (!fragmento) return res.redirect(303, '/coach#cv-fin');
    return enviar({ respuesta: out });
  } catch (e) {
    if (!(e instanceof CoachError)) throw e;
    if (!fragmento) return res.redirect(303, '/coach?aviso=coach_error#cv-fin');
    return res.status(e.status === 409 ? 200 : e.status).type('html').send(v2view.fragmento(res.locals.ctx, { texto: mostrar, error: e.message, sugerencias: sugerencias(req.user.id), cur }).toString());
  }
}));

router.get('/coach', guard, pagina);

module.exports = router;
