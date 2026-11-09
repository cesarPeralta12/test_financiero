'use strict';
const path = require('node:path');
const express = require('express');
const config = require('./config');
const session = require('./lib/session');
const log = require('./lib/log');
const { layout } = require('./views/layout');
const { html } = require('./lib/html');
const { unreadCount } = require('./lib/services');
const { wantsJson } = require('./routes/guards');

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  if (config.forceHttps && config.secureCookies) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

function httpsRedirect(req, res, next) {
  // El chequeo de salud y los webhooks firmados no se redirigen (llegan por la red interna).
  if (req.path === '/salud' || req.path.startsWith('/webhooks/')) return next();
  if (config.forceHttps && !req.secure && req.get('x-forwarded-proto') !== 'https') {
    return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
  }
  next();
}

function context(req, res, next) {
  const isPage = req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/webhooks/');
  if (isPage) session.ensure(req, res);
  res.locals.ctx = {
    user: req.user,
    csrf: req.session ? req.session.csrf : null,
    flash: typeof req.query.aviso === 'string' ? req.query.aviso : null,
    unread: req.user ? unreadCount(req.user.id) : 0,
    game: req.user && isPage ? require('./domain/game').profile(req.user.id) : null,
    active: null,
    path: req.path,
  };
  res.page = (page) => {
    res.set('Cache-Control', 'no-store');
    return res.send(layout(res.locals.ctx, page).toString());
  };
  res.active = (key) => {
    res.locals.ctx.active = key;
    return res;
  };
  next();
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(httpsRedirect);
  app.use(express.static(path.join(config.root, 'public'), { index: false, maxAge: config.isProd ? '7d' : 0 }));
  app.get('/salud', (req, res) => res.json({ estado: 'ok', entorno: config.env }));

  // Los webhooks necesitan el cuerpo sin procesar para validar la firma.
  app.use('/webhooks', express.raw({ type: '*/*', limit: '64kb' }), require('./routes/webhooks'));

  app.use(express.urlencoded({ extended: true, limit: '200kb', parameterLimit: 2000 }));
  app.use(express.json({ limit: '64kb' }));
  app.use(session.middleware);
  app.use(context);
  app.use(session.csrf);

  app.use(require('./routes/public'));
  app.use(require('./routes/auth'));
  app.use(require('./routes/test'));
  app.use(require('./routes/account'));
  app.use(require('./routes/checkout'));
  app.use(require('./routes/deep'));
  app.use(require('./routes/plan'));
  app.use(require('./routes/coach'));
  app.use(require('./routes/calculator'));
  app.use(require('./routes/dashboard'));
  app.use('/admin', require('./routes/admin'));
  app.use('/api/v1', require('./routes/api'));
  if (config.payments.sandboxEnabled) app.use(require('./routes/sandbox'));

  app.use((req, res, next) => {
    const err = new Error('no encontrado');
    err.status = 404;
    next(err);
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) log.error('Error no controlado', { path: req.path, method: req.method, error: err.message, stack: config.isProd ? undefined : String(err.stack).split('\n').slice(0, 4).join(' | ') });
    if (res.headersSent) return;
    const message =
      err.publicMessage ||
      (status === 404 ? 'No encontramos esta página.' : status === 413 ? 'El envío es demasiado grande.' : status === 429 ? 'Hiciste demasiados intentos. Espera un momento y vuelve a intentarlo.' : 'Algo falló de nuestro lado. Tus datos guardados no se perdieron; inténtalo de nuevo en unos minutos.');
    if (wantsJson(req)) return res.status(status).json({ error: status === 404 ? 'no_encontrado' : 'error', mensaje: message });
    if (!res.locals.ctx) res.locals.ctx = { user: req.user || null, csrf: req.session ? req.session.csrf : null };
    if (!res.page) res.page = (page) => res.send(layout(res.locals.ctx, page).toString());
    res.status(status).page({
      title: status === 404 ? 'Página no encontrada' : 'Error',
      body: html`<div class="center section">
        <h1>${status === 404 ? 'Página no encontrada' : status === 403 ? 'Acción no permitida' : 'No pudimos completar la acción'}</h1>
        <p class="lead">${message}</p>
        <div class="actions actions--center"><a class="btn btn-secondary" href="${req.user ? '/inicio' : '/'}">Volver al inicio</a></div>
      </div>`,
    });
  });
  return app;
}

module.exports = { createApp };
