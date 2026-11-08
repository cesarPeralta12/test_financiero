'use strict';
const express = require('express');
const db = require('../db');
const { html } = require('../lib/html');
const money = require('../lib/money');
const payments = require('../domain/payments');
const entitlements = require('../domain/entitlements');
const c = require('../views/components');
const { notFound } = require('./util');
const { rateLimit } = require('../lib/security');

const router = express.Router();

function needAccount(req, res, next) {
  if (req.user) return next();
  res.redirect(303, `/registro?siguiente=${encodeURIComponent(req.originalUrl)}`);
}

router.get('/comprar/:code', needAccount, (req, res, next) => {
  const p = payments.product(req.params.code);
  if (!p) return next(notFound());
  const grants = JSON.parse(p.grants_json);
  const owned = entitlements.active(req.user.id);
  const allOwned = grants.every((g) => owned[g.code]);
  const someOwned = grants.filter((g) => owned[g.code]);
  res.page({
    title: `Comprar ${p.name}`,
    body: html`<p class="q-section">Antes de pagar</p>
      <h1>${p.name}</h1>
      <p class="lead">${p.summary}</p>
      ${allOwned ? html`<div class="note note--ok"><strong>Ya tienes acceso a todo lo que incluye.</strong> No necesitas volver a pagar.</div>` : ''}
      ${!allOwned && someOwned.length
        ? html`<div class="note note--warn"><strong>Ya tienes parte de este producto:</strong> ${someOwned.map((g) => c.GRANT_LABELS[g.code]).join(', ')}. El precio no cambia.</div>`
        : ''}
      <ul class="figures">
        <li><span class="k">Producto</span><span class="v">${p.name}</span></li>
        <li><span class="k">Importe</span><span class="v num">${money.formatCents(p.price_cents, p.currency)}</span></li>
        <li><span class="k">Moneda</span><span class="v">${p.currency}</span></li>
        ${grants.map((g) => html`<li><span class="k">Acceso a ${c.GRANT_LABELS[g.code]}</span><span class="v">${c.durationText(g.days)} desde la confirmación</span></li>`)}
      </ul>
      <section class="section" aria-labelledby="h-incluye">
        <h2 id="h-incluye">Qué recibirás</h2>
        <ul class="ticklist">${JSON.parse(p.includes_json).map((i) => html`<li>${i}</li>`)}</ul>
      </section>
      <section class="section" aria-labelledby="h-cond">
        <h2 id="h-cond">Condiciones</h2>
        <p class="muted">${p.conditions}</p>
        <p class="small muted">El cobro lo procesa la pasarela de pago: Día Uno no recibe ni guarda los datos de tu tarjeta. El acceso se activa cuando la pasarela nos confirma el pago. Consulta las <a href="/condiciones">condiciones de uso</a>.</p>
      </section>
      ${allOwned
        ? html`<div class="actions"><a class="btn btn-primary" href="/inicio">Ir a mi cuenta</a></div>`
        : html`<form method="post" action="/comprar/${p.code}">
            ${c.csrfField(res.locals.ctx)}
            <div class="actions">
              <button class="btn btn-primary" type="submit">Pagar ${money.formatCents(p.price_cents, p.currency)} ${p.currency}</button>
              <a class="btn btn-quiet" href="${req.get('referer') && req.get('referer').startsWith(require('../config').appUrl) ? new URL(req.get('referer')).pathname : '/inicio'}">Volver</a>
            </div>
          </form>`}`,
  });
});

router.post('/comprar/:code', needAccount, (req, res, next) => {
  const p = payments.product(req.params.code);
  if (!p) return next(notFound());
  const rl = rateLimit({ key: `checkout:${req.user.id}`, limit: 20, windowMs: 3600_000 });
  if (!rl.allowed) {
    const e = new Error('limite');
    e.status = 429;
    return next(e);
  }
  const { url } = payments.startCheckout(req.user, p);
  res.redirect(303, url);
});

// Retorno desde la pasarela: solo informa; nunca activa permisos.
router.get('/pago/retorno', needAccount, (req, res, next) => {
  const order = db.one('SELECT * FROM orders WHERE ref = ? AND user_id = ?', String(req.query.orden || ''), req.user.id);
  if (!order) return next(notFound());
  const next_ = (() => {
    const g = JSON.parse(order.grants_json).map((x) => x.code);
    if (g.includes('evaluacion_profunda')) return ['/evaluacion', 'Empezar mi evaluación profunda'];
    if (g.includes('plan_maestro')) return ['/plan', 'Ir a mi Plan Maestro'];
    return ['/coach', 'Abrir el coach'];
  })();
  const views = {
    pendiente: html`<h1>Confirmando tu pago</h1>
      <p class="lead"><span class="spinner" aria-hidden="true"></span> Esperamos la confirmación de la pasarela. Esta página se actualiza sola.</p>
      <p class="small muted">Si cerraste el pago sin terminarlo, no se hizo ningún cargo. Puedes volver a <a href="/comprar/${order.product_code}">intentarlo</a>.</p>`,
    pagada: html`<h1>Pago confirmado</h1>
      <p class="lead">Ya tienes acceso a ${order.product_name}.</p>
      <div class="actions"><a class="btn btn-primary" href="${next_[0]}">${next_[1]}</a></div>`,
    fallida: html`<h1>El pago no se completó</h1>
      <p class="lead">La pasarela rechazó el pago. No se hizo ningún cargo.</p>
      <div class="actions"><a class="btn btn-primary" href="/comprar/${order.product_code}">Intentar de nuevo</a></div>`,
    cancelada: html`<h1>Cancelaste el pago</h1>
      <p class="lead">No se hizo ningún cargo.</p>
      <div class="actions"><a class="btn btn-secondary" href="/comprar/${order.product_code}">Volver a la compra</a></div>`,
    reembolsada: html`<h1>Compra reembolsada</h1><p class="lead">Esta compra se reembolsó y su acceso se retiró.</p>`,
  };
  res.page({
    title: 'Estado del pago',
    refresh: order.status === 'pendiente' ? 3 : null,
    body: html`<div class="center section">${views[order.status]}</div>
      <p class="small faint center">Referencia ${order.ref}</p>`,
  });
});

module.exports = router;
