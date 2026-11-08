'use strict';
// Sesiones de navegador. Cada navegador recibe una sesión anónima (30 días) que
// guarda el avance del test; al registrarse o entrar se vincula a la cuenta.
const db = require('../db');
const config = require('../config');
const { token, sha256, uuid, safeEqual } = require('./security');

const COOKIE = config.secureCookies ? '__Host-du_sid' : 'du_sid';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function setCookie(res, value, maxAgeSec) {
  const parts = [`${COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (config.secureCookies) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function expiry() {
  return new Date(Date.now() + config.sessionDays * 86400 * 1000).toISOString();
}

function clean(v, max = 120) {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

function createAnon(req) {
  const id = uuid();
  const q = req.query || {};
  let refHost = null;
  try {
    const ref = req.get('referer');
    if (ref) {
      const u = new URL(ref);
      if (!config.appUrl.includes(u.host)) refHost = u.host.slice(0, 120);
    }
  } catch {
    /* sin referencia */
  }
  db.run(
    `INSERT INTO anonymous_sessions (id, created_at, last_seen_at, utm_source, utm_medium, utm_campaign, utm_term, utm_content, referrer_host, landing_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    db.now(),
    db.now(),
    clean(q.utm_source),
    clean(q.utm_medium),
    clean(q.utm_campaign),
    clean(q.utm_term),
    clean(q.utm_content),
    refHost,
    clean(req.path, 200)
  );
  return id;
}

function createSession(req, res, { userId = null, anonId = null } = {}) {
  const raw = token(32);
  const id = sha256(raw);
  const anon = anonId || createAnon(req);
  db.run(
    'INSERT INTO sessions (id, user_id, anon_id, csrf, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    userId,
    anon,
    token(24),
    db.now(),
    db.now(),
    expiry()
  );
  setCookie(res, raw, config.sessionDays * 86400);
  return db.one('SELECT * FROM sessions WHERE id = ?', id);
}

function loadUser(req) {
  req.user = null;
  if (req.session && req.session.user_id) {
    req.user = db.one('SELECT id, email, name, role, base_currency, email_verified_at, created_at FROM users WHERE id = ?', req.session.user_id);
  }
}

/** Carga la sesión existente (si la hay). */
function middleware(req, res, next) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  req.session = null;
  if (raw) {
    const s = db.one('SELECT * FROM sessions WHERE id = ?', sha256(raw));
    if (s && s.expires_at > db.now()) {
      req.session = s;
      const stale = Date.now() - Date.parse(s.last_seen_at) > 5 * 60 * 1000;
      if (stale) {
        db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', db.now(), expiry(), s.id);
        if (s.anon_id) db.run('UPDATE anonymous_sessions SET last_seen_at = ? WHERE id = ?', db.now(), s.anon_id);
        setCookie(res, raw, config.sessionDays * 86400);
      }
    } else if (s) {
      db.run('DELETE FROM sessions WHERE id = ?', s.id);
    }
  }
  // Conserva el origen (UTM) si llega en una sesión que aún no lo tenía.
  if (req.session && req.session.anon_id && req.query && UTM_KEYS.some((k) => req.query[k])) {
    const a = db.one('SELECT utm_source FROM anonymous_sessions WHERE id = ?', req.session.anon_id);
    if (a && !a.utm_source) {
      db.run(
        'UPDATE anonymous_sessions SET utm_source = ?, utm_medium = ?, utm_campaign = ?, utm_term = ?, utm_content = ? WHERE id = ?',
        clean(req.query.utm_source),
        clean(req.query.utm_medium),
        clean(req.query.utm_campaign),
        clean(req.query.utm_term),
        clean(req.query.utm_content),
        req.session.anon_id
      );
    }
  }
  loadUser(req);
  next();
}

/** Garantiza que exista sesión (para formularios y para guardar el avance). */
function ensure(req, res) {
  if (!req.session) {
    req.session = createSession(req, res);
    loadUser(req);
  }
  return req.session;
}

/** Inicio de sesión: rota el token (evita fijación) y vincula la sesión anónima. */
function login(req, res, userId) {
  const old = req.session;
  const anonId = old ? old.anon_id : null;
  if (old) db.run('DELETE FROM sessions WHERE id = ?', old.id);
  req.session = createSession(req, res, { userId, anonId });
  db.run('UPDATE users SET last_login_at = ? WHERE id = ?', db.now(), userId);
  loadUser(req);
  return req.session;
}

function logout(req, res) {
  if (req.session) db.run('DELETE FROM sessions WHERE id = ?', req.session.id);
  req.session = null;
  req.user = null;
  setCookie(res, '', 0);
}

function destroyUserSessions(userId, exceptId = null) {
  db.run('DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?', userId, exceptId);
}

/** Protección CSRF con token sincronizado por sesión. */
function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/webhooks/')) return next();
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (!req.session || !sent || !safeEqual(sent, req.session.csrf)) {
    const err = new Error('csrf');
    err.status = 403;
    err.publicMessage = 'El formulario caducó o no es válido. Recarga la página e inténtalo de nuevo.';
    return next(err);
  }
  next();
}

module.exports = { middleware, ensure, login, logout, csrf, destroyUserSessions, parseCookies, COOKIE };
