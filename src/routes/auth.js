'use strict';
// F04 Registro y continuidad: registro, acceso, recuperación y cierre de sesión.
const express = require('express');
const db = require('../db');
const { html, raw } = require('../lib/html');
const session = require('../lib/session');
const accounts = require('../domain/accounts');
const consent = require('../domain/consent');
const { track } = require('../lib/services');
const { verifyPassword, validateEmail, validatePassword, rateLimit } = require('../lib/security');
const c = require('../views/components');
const { safeNext, requireUser } = require('./guards');

const router = express.Router();

function ip(req) {
  return req.ip || req.socket.remoteAddress || 'local';
}

function limited(res, page) {
  return res.status(429).page({
    title: 'Demasiados intentos',
    body: html`<h1>Demasiados intentos</h1><p class="lead">Por seguridad, espera unos minutos antes de volver a intentarlo.</p>${page || ''}`,
  });
}

function registerPage(res, { form = {}, errors = {}, next = null } = {}) {
  return res.page({
    title: 'Crear cuenta',
    narrow: true,
    body: html`<h1>Crea tu cuenta</h1>
      <p class="muted">Guardaremos en ella tu test y tu resultado. Podrás retomarlos desde cualquier dispositivo.</p>
      ${c.errorSummary(errors, { email: 'Correo', password: 'Contraseña', acepto: 'Condiciones' })}
      <form method="post" action="/registro${next ? `?siguiente=${encodeURIComponent(next)}` : ''}" novalidate>
        ${c.csrfField(res.locals.ctx)}
        ${c.textField({ name: 'name', label: 'Nombre (opcional)', value: form.name, autocomplete: 'given-name', maxlength: 80, errors })}
        ${c.textField({ name: 'email', label: 'Correo', type: 'email', value: form.email, autocomplete: 'email', errors })}
        ${c.textField({ name: 'password', label: 'Contraseña', type: 'password', autocomplete: 'new-password', hint: 'Al menos 10 caracteres, con letras y números.', errors })}
        <div class="field">
          <label class="check" for="f-acepto">
            <input type="checkbox" id="f-acepto" name="acepto" value="1" ${form.acepto ? raw('checked') : ''} ${c.invalid(errors, 'acepto')} />
            <span>Acepto las <a href="/condiciones">condiciones de uso</a> y que se guarden mis datos financieros según la <a href="/privacidad">política de privacidad</a>.</span>
          </label>
          ${c.errorText(errors, 'acepto')}
        </div>
        <div class="actions"><button class="btn btn-primary btn-block" type="submit">Crear cuenta</button></div>
      </form>
      <p class="small muted center section">¿Ya tienes cuenta? <a href="/entrar${next ? `?siguiente=${encodeURIComponent(next)}` : ''}">Entra</a></p>`,
  });
}

router.get('/registro', (req, res) => {
  if (req.user) return res.redirect(303, '/inicio');
  registerPage(res, { next: safeNext(req.query.siguiente) });
});

router.post('/registro', (req, res) => {
  const next = safeNext(req.query.siguiente);
  const rl = rateLimit({ key: `registro:${ip(req)}`, limit: 10, windowMs: 3600_000 });
  if (!rl.allowed) return limited(res);
  const form = { name: req.body.name, email: String(req.body.email || '').trim(), acepto: req.body.acepto === '1' };
  const errors = {};
  const e1 = validateEmail(form.email);
  if (e1) errors.email = e1;
  const e2 = validatePassword(req.body.password);
  if (e2) errors.password = e2;
  if (!form.acepto) errors.acepto = 'Acepta las condiciones para crear tu cuenta.';
  if (!errors.email && accounts.findByEmail(form.email)) errors.email = 'Ya existe una cuenta con este correo. Entra o recupera tu contraseña.';
  if (Object.keys(errors).length) return registerPage(res.status(422), { form, errors, next });

  const anonId = req.session && req.session.anon_id;
  const user = db.tx(() => {
    const u = accounts.create({ email: form.email, password: req.body.password, name: form.name });
    consent.record({ userId: u.id }, 'condiciones');
    if (!consent.has({ userId: u.id, anonId })) consent.record({ userId: u.id }, 'datos_financieros');
    accounts.linkAnonymous(anonId, u.id);
    return u;
  });
  session.login(req, res, user.id);
  track('registro', { userId: user.id, anonId, dedupe: `registro:${user.id}` });
  accounts.sendVerification(user);
  const hasResult = db.value('SELECT 1 FROM ft_sessions WHERE user_id = ? AND completed_revision IS NOT NULL', user.id);
  res.redirect(303, `${next || (hasResult ? '/resultado' : '/inicio')}${(next || '').includes('?') ? '&' : '?'}aviso=cuenta_creada`);
});

function loginPage(res, { form = {}, error = null, next = null } = {}) {
  return res.page({
    title: 'Entrar',
    narrow: true,
    body: html`<h1>Entra a tu cuenta</h1>
      ${error ? html`<div class="error-summary" role="alert"><h2>No pudimos entrar</h2><ul><li>${error}</li></ul></div>` : ''}
      <form method="post" action="/entrar${next ? `?siguiente=${encodeURIComponent(next)}` : ''}" novalidate>
        ${c.csrfField(res.locals.ctx)}
        ${c.textField({ name: 'email', label: 'Correo', type: 'email', value: form.email, autocomplete: 'email' })}
        ${c.textField({ name: 'password', label: 'Contraseña', type: 'password', autocomplete: 'current-password' })}
        <div class="actions"><button class="btn btn-primary btn-block" type="submit">Entrar</button></div>
      </form>
      <p class="small center section"><a href="/recuperar">Olvidé mi contraseña</a></p>
      <p class="small muted center">¿Aún no tienes cuenta? <a href="/test">Empieza con el test gratuito</a> o <a href="/registro">crea una cuenta</a>.</p>`,
  });
}

router.get('/entrar', (req, res) => {
  if (req.user) return res.redirect(303, safeNext(req.query.siguiente) || '/inicio');
  res.active('entrar');
  loginPage(res, { next: safeNext(req.query.siguiente) });
});

router.post('/entrar', (req, res) => {
  const next = safeNext(req.query.siguiente);
  const email = String(req.body.email || '').trim().toLowerCase();
  const rl = rateLimit({ key: `entrar:${ip(req)}:${email}`, limit: 8, windowMs: 15 * 60_000 });
  const rlIp = rateLimit({ key: `entrar-ip:${ip(req)}`, limit: 40, windowMs: 15 * 60_000 });
  if (!rl.allowed || !rlIp.allowed) return limited(res);
  const user = email ? accounts.findByEmail(email) : null;
  const ok = verifyPassword(String(req.body.password || ''), user ? user.password_hash : null);
  if (!user || !ok) return loginPage(res.status(422), { form: { email }, error: 'El correo o la contraseña no son correctos.', next });
  const anonId = req.session && req.session.anon_id;
  session.login(req, res, user.id);
  accounts.linkAnonymous(anonId, user.id);
  res.redirect(303, next || `/inicio?aviso=bienvenida`);
});

router.post('/salir', (req, res) => {
  session.logout(req, res);
  res.redirect(303, '/?aviso=sesion_cerrada');
});

router.get('/recuperar', (req, res) => {
  res.page({
    title: 'Recuperar contraseña',
    narrow: true,
    body: html`<h1>Recupera tu contraseña</h1>
      <p class="muted">Escribe el correo de tu cuenta. Te enviaremos un enlace para crear una contraseña nueva.</p>
      <form method="post" action="/recuperar" novalidate>
        ${c.csrfField(res.locals.ctx)}
        ${c.textField({ name: 'email', label: 'Correo', type: 'email', autocomplete: 'email' })}
        <div class="actions"><button class="btn btn-primary btn-block" type="submit">Enviar enlace</button></div>
      </form>
      <p class="small center section"><a href="/entrar">Volver a entrar</a></p>`,
  });
});

router.post('/recuperar', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const rl = rateLimit({ key: `recuperar:${ip(req)}`, limit: 6, windowMs: 3600_000 });
  if (!rl.allowed) return limited(res);
  const user = email && !validateEmail(email) ? accounts.findByEmail(email) : null;
  if (user) accounts.sendRecovery(user);
  // Misma respuesta exista o no la cuenta.
  res.redirect(303, '/entrar?aviso=recuperacion_enviada');
});

function resetPage(res, token, { error = null } = {}) {
  return res.page({
    title: 'Nueva contraseña',
    narrow: true,
    body: html`<h1>Crea una contraseña nueva</h1>
      ${error ? html`<div class="error-summary" role="alert"><h2>Revisa la contraseña</h2><ul><li><a href="#f-password">${error}</a></li></ul></div>` : ''}
      <form method="post" action="/restablecer/${token}" novalidate>
        ${c.csrfField(res.locals.ctx)}
        ${c.textField({ name: 'password', label: 'Contraseña nueva', type: 'password', autocomplete: 'new-password', hint: 'Al menos 10 caracteres, con letras y números.', errors: error ? { password: error } : {} })}
        <div class="actions"><button class="btn btn-primary btn-block" type="submit">Guardar contraseña</button></div>
      </form>`,
  });
}

router.get('/restablecer/:token', (req, res) => {
  if (!accounts.consumeToken(req.params.token, 'recuperar', { peek: true })) return res.redirect(303, '/recuperar?aviso=enlace_invalido');
  resetPage(res, req.params.token);
});

router.post('/restablecer/:token', (req, res) => {
  const peek = accounts.consumeToken(req.params.token, 'recuperar', { peek: true });
  if (!peek) return res.redirect(303, '/recuperar?aviso=enlace_invalido');
  const err = validatePassword(req.body.password);
  if (err) return resetPage(res.status(422), req.params.token, { error: err });
  const row = accounts.consumeToken(req.params.token, 'recuperar');
  if (!row) return res.redirect(303, '/recuperar?aviso=enlace_invalido');
  accounts.setPassword(row.user_id, req.body.password);
  session.destroyUserSessions(row.user_id);
  if (req.user && req.user.id === row.user_id) session.logout(req, res);
  res.redirect(303, '/entrar?aviso=clave_cambiada');
});

router.get('/verificar/:token', (req, res) => {
  const row = accounts.consumeToken(req.params.token, 'verificar');
  if (!row) return res.redirect(303, `${req.user ? '/cuenta' : '/entrar'}?aviso=enlace_invalido`);
  db.run('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?', db.now(), db.now(), row.user_id);
  res.redirect(303, `${req.user ? '/inicio' : '/entrar'}?aviso=correo_verificado`);
});

router.post('/verificar/reenviar', requireUser, (req, res) => {
  const rl = rateLimit({ key: `verificar:${req.user.id}`, limit: 3, windowMs: 3600_000 });
  if (!rl.allowed) return limited(res);
  if (!req.user.email_verified_at) accounts.sendVerification(req.user);
  res.redirect(303, '/cuenta?aviso=verificacion_enviada');
});

module.exports = router;
