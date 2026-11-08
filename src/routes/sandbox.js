'use strict';
// Checkout de la pasarela de pruebas (solo fuera de producción). Simula la página
// alojada por el proveedor: aquí el proveedor real pediría la tarjeta.
const express = require('express');
const db = require('../db');
const { html } = require('../lib/html');
const money = require('../lib/money');
const sandbox = require('../domain/gateways/sandbox');
const c = require('../views/components');
const { notFound } = require('./util');

const router = express.Router();

router.get('/pasarela-pruebas/:id', (req, res, next) => {
  const ck = db.one('SELECT * FROM sandbox_checkouts WHERE id = ?', req.params.id);
  if (!ck) return next(notFound());
  if (ck.status !== 'abierta') return res.redirect(303, ck.return_url.replace(/^https?:\/\/[^/]+/, ''));
  res.page({
    title: 'Pasarela de pruebas',
    minimal: true,
    narrow: true,
    body: html`<div class="sandbox">
      <p class="q-section">Pasarela de pruebas</p>
      <h1>Simulación del proveedor de pagos</h1>
      <p class="muted">En producción, esta página la muestra la pasarela elegida y es donde se escriben los datos de la tarjeta. Aquí solo eliges el resultado.</p>
      <ul class="figures">
        <li><span class="k">Concepto</span><span class="v">${ck.product_name}</span></li>
        <li><span class="k">Importe</span><span class="v num">${money.formatCents(ck.amount_cents, ck.currency)} ${ck.currency}</span></li>
      </ul>
      <div class="stack section">
        ${['aprobar', 'rechazar', 'cancelar'].map(
          (a) => html`<form method="post" action="/pasarela-pruebas/${ck.id}/${a}">
            ${c.csrfField(res.locals.ctx)}
            <button class="btn ${a === 'aprobar' ? 'btn-primary' : a === 'rechazar' ? 'btn-danger' : 'btn-secondary'} btn-block" type="submit">${{ aprobar: 'Aprobar pago', rechazar: 'Simular rechazo', cancelar: 'Cancelar y volver' }[a]}</button>
          </form>`
        )}
      </div>
    </div>`,
  });
});

router.post('/pasarela-pruebas/:id/:action', (req, res, next) => {
  const ck = sandbox.resolveCheckout(req.params.id, req.params.action);
  if (!ck) return next(notFound());
  res.redirect(303, ck.return_url.replace(/^https?:\/\/[^/]+/, ''));
});

module.exports = router;
