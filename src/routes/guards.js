'use strict';
const entitlements = require('../domain/entitlements');
const { html } = require('../lib/html');
const db = require('../db');
const c = require('../views/components');

function wantsJson(req) {
  return req.path.startsWith('/api/') || req.originalUrl.startsWith('/api/') || (req.get('accept') || '').includes('application/json');
}

function safeNext(v) {
  const s = String(v || '');
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') ? s : null;
}

function requireUser(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) return res.status(401).json({ error: 'no_autenticado', mensaje: 'Inicia sesión para continuar.' });
  return res.redirect(303, `/entrar?siguiente=${encodeURIComponent(req.originalUrl)}`);
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  if (!req.user && !wantsJson(req)) return res.redirect(303, `/entrar?siguiente=${encodeURIComponent(req.originalUrl)}`);
  const err = new Error('no encontrado');
  err.status = 404;
  return next(err);
}

const OFFER_FOR = {
  evaluacion_profunda: ['evaluacion', 'La evaluación profunda es de pago', 'Revisa con detalle tus ingresos, gastos, deudas, tasas y metas, y recibe un diagnóstico detallado.'],
  plan_maestro: ['plan_maestro', 'El Plan Maestro es de pago', 'Tu plan de 90 días y la hoja de ruta de 12 meses, calculados con tus cifras.'],
  acompanamiento: ['acompanamiento', 'El acompañamiento es de pago', 'Coach de IA, calculadora, simulador y tablero para ejecutar tu plan.'],
};

function requireEntitlement(code) {
  return (req, res, next) => {
    if (!req.user) return requireUser(req, res, next);
    if (entitlements.has(req.user.id, code)) return next();
    if (wantsJson(req)) return res.status(403).json({ error: 'sin_permiso', permiso: code, mensaje: 'Tu cuenta no tiene acceso a esta función.' });
    const [productCode, title, text] = OFFER_FOR[code];
    const products = db.all("SELECT * FROM products WHERE active = 1 AND (code = ? OR code = 'paquete') ORDER BY sort", productCode);
    return res.status(403).page({
      title,
      body: html`<h1>${title}</h1>
        <p class="lead">${text}</p>
        <div class="section">${products.map((p) => c.offerCard(res.locals.ctx, p, { featured: p.code === productCode }))}</div>
        <p class="small muted">¿Ya pagaste? La confirmación puede tardar unos segundos. <a href="/cuenta">Revisa tus compras</a>.</p>`,
    });
  };
}

module.exports = { requireUser, requireAdmin, requireEntitlement, wantsJson, safeNext };
