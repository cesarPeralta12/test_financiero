'use strict';
// Registro operativo. Nunca escribe claves, tokens, contraseñas ni respuestas
// financieras: se registran solo códigos, identificadores y mensajes técnicos.
const config = require('../config');

const SECRET_KEYS = /pass|token|secret|key|authorization|cookie|signature|answer|respuesta|importe|amount|saldo|ingreso|gasto|mensaje|content|body|input/i;

function redact(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_KEYS.test(k)) out[k] = '[omitido]';
    else if (v && typeof v === 'object') out[k] = '[objeto]';
    else out[k] = v;
  }
  return out;
}

function scrub(message) {
  return String(message)
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[clave omitida]')
    .replace(/(whsec|tok)_[A-Za-z0-9_-]+/g, '[secreto omitido]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [omitido]');
}

function write(level, message, meta) {
  if (config.isTest && level !== 'error') return;
  const line = { t: new Date().toISOString(), level, msg: scrub(message), ...redact(meta) };
  const out = level === 'error' ? console.error : console.log;
  out(JSON.stringify(line));
}

module.exports = {
  info: (m, meta) => write('info', m, meta),
  warn: (m, meta) => write('warn', m, meta),
  error: (m, meta) => write('error', m, meta),
  scrub,
};
