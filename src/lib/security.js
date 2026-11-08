'use strict';
const crypto = require('node:crypto');

// Contraseñas: scrypt con sal aleatoria. Formato: scrypt$N$r$p$sal$hash (base64url).
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password).normalize('NFKC'), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

// Hash ficticio para igualar tiempos cuando el correo no existe.
const DUMMY_HASH = hashPassword('contraseña-ficticia-para-tiempos');

function verifyPassword(password, stored) {
  const parts = String(stored || DUMMY_HASH).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = crypto.scryptSync(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function token(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(v) {
  return crypto.createHash('sha256').update(String(v)).digest('hex');
}

function hmac(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function uuid() {
  return crypto.randomUUID();
}

function publicRef(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
}

function validatePassword(pw) {
  const s = String(pw || '');
  if (s.length < 10) return 'Usa al menos 10 caracteres.';
  if (s.length > 200) return 'Usa como máximo 200 caracteres.';
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(s) || !/\d/.test(s)) return 'Combina letras y números.';
  return null;
}

function validateEmail(email) {
  const s = String(email || '').trim();
  if (!s) return 'Escribe tu correo.';
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return 'Escribe un correo válido, por ejemplo nombre@dominio.com.';
  return null;
}

// Límite de frecuencia en memoria (por proceso) para proteger contra abuso.
const buckets = new Map();
function rateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  if (buckets.size > 50000) {
    for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
  }
  return { allowed: b.count <= limit, retryAfterSec: Math.ceil((b.reset - now) / 1000) };
}
function resetRateLimits() {
  buckets.clear();
}

module.exports = {
  hashPassword,
  verifyPassword,
  token,
  sha256,
  hmac,
  safeEqual,
  uuid,
  publicRef,
  validatePassword,
  validateEmail,
  rateLimit,
  resetRateLimits,
};
