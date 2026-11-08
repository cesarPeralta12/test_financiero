'use strict';
// Utilidades compartidas por las rutas.

/** Propietario de los datos de esta petición: cuenta o sesión anónima. */
function owner(req) {
  return { userId: req.user ? req.user.id : null, anonId: req.session ? req.session.anon_id : null };
}

/** Ejecuta un manejador asíncrono y envía los errores al manejador central. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function intParam(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 && String(n) === String(v) ? n : null;
}

function notFound() {
  const err = new Error('no encontrado');
  err.status = 404;
  return err;
}

module.exports = { owner, wrap, intParam, notFound };
