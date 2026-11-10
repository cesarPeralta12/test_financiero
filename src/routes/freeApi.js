'use strict';
// API JSON del test gratuito de 25 preguntas (FREE_25_V2_ES).
//   POST /api/free-tests                      crea la sesión (devuelve access_token)
//   GET  /api/free-tests/:id                  estado, progreso y pregunta pendiente
//   GET  /api/free-tests/:id/questions/:slot  pregunta vigente de un slot (para editar)
//   PUT  /api/free-tests/:id/answers/:slot    guarda una respuesta
//   POST /api/free-tests/:id/complete         finaliza una vez por revisión
//   GET  /api/free-tests/:id/diagnostic       pending | ready | failed
//   POST /api/free-tests/:id/diagnostic/retry reintenta si falló
//   POST /api/free-tests/:id/link             vincula el test a la cuenta (sesión iniciada)
// Autorización: cabecera «Authorization: Bearer <access_token>» (acceso anónimo no
// predecible) o el propietario por cuenta/sesión del navegador (con X-CSRF-Token).
const express = require('express');
const engine = require('../domain/free/engine');
const catalog = require('../domain/free/catalog');
const consent = require('../domain/consent');
const { FreeError } = require('../domain/free/values');
const { rateLimit } = require('../lib/security');
const log = require('../lib/log');
const { owner } = require('./util');

const router = express.Router();

function bearer(req) {
  const m = (req.get('authorization') || '').match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

/** Sesión del test si la petición está autorizada; si no, 404 (no revela existencia). */
function authorized(req) {
  const session = engine.loadSession(req.params.id);
  const o = owner(req);
  if (!engine.authorize(session, { bearer: bearer(req), userId: o.userId, anonId: o.anonId })) throw new FreeError(404, 'NOT_FOUND', 'No encontramos este test.');
  return session;
}

const wrap = (fn) => (req, res, next) => {
  try {
    Promise.resolve(fn(req, res, next)).catch(next);
  } catch (e) {
    next(e);
  }
};

router.post('/', wrap(async (req, res) => {
  const body = req.body || {};
  const o = owner(req);
  const hasOwner = Boolean(o.userId || o.anonId);
  let consented = hasOwner && consent.has(o);
  if (!consented && body.consent === true) {
    if (hasOwner) consent.record(o);
    consented = true;
  }
  if (!consented) throw new FreeError(403, 'CONSENT_REQUIRED', 'Antes de guardar información financiera necesitamos tu consentimiento (envía consent: true tras mostrar el texto).');
  const currency = body.currency || (req.user && req.user.base_currency) || null;
  const { session, accessToken } = engine.createSession({
    userId: o.userId,
    anonId: o.anonId,
    currency,
    locale: body.locale || catalog.LOCALE,
    versionId: body.version_id || catalog.VERSION_ID,
    consent: consented,
  });
  res.status(201).json({ ...engine.stateOf(session), access_token: accessToken });
}));

router.get('/:id', wrap((req, res) => {
  res.json(engine.stateOf(authorized(req)));
}));

router.get('/:id/questions/:slot', wrap((req, res) => {
  const session = authorized(req);
  const r = engine.questionAt(session, String(req.params.slot).toUpperCase());
  if (r.redirect) throw new FreeError(409, 'STALE_VARIANT', `Primero responde ${r.redirect}.`, { next_slot: r.redirect });
  res.json({ revision: session.revision, question: r.question, answer: r.answer ? { variant_id: r.answer.variant_id, status: r.answer.status, value: r.answer.value } : null });
}));

router.put('/:id/answers/:slot', wrap((req, res) => {
  const session = authorized(req);
  const limit = rateLimit({ key: `ftanswer:${session.id}`, limit: 240, windowMs: 60_000 });
  if (!limit.allowed) throw new FreeError(429, 'RATE_LIMITED', 'Demasiados envíos seguidos. Espera un momento.');
  const out = engine.saveAnswer(session.id, String(req.params.slot).toUpperCase(), req.body);
  res.json(out);
}));

router.post('/:id/complete', wrap((req, res) => {
  const session = authorized(req);
  res.json(engine.complete(session.id));
}));

router.get('/:id/diagnostic', wrap((req, res) => {
  const session = authorized(req);
  res.json(engine.getDiagnostic(session.id));
}));

router.post('/:id/diagnostic/retry', wrap((req, res) => {
  const session = authorized(req);
  res.json(engine.retryDiagnostic(session.id));
}));

router.post('/:id/link', wrap((req, res) => {
  const session = authorized(req);
  if (!req.user) throw new FreeError(401, 'AUTH_REQUIRED', 'Inicia sesión para guardar este test en tu cuenta.');
  res.json(engine.linkToUser(session.id, req.user.id));
}));

// Errores propios del test: formato { error: { code, message, ...extra } }.
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err instanceof FreeError) {
    if (err.status >= 500) log.error('Error de catálogo del test gratuito', { code: err.code, path: req.path });
    return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } });
  }
  return next(err);
});

module.exports = router;
