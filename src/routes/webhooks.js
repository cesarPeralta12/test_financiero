'use strict';
// Confirmaciones del servidor de pagos. Sin sesión ni CSRF: la autenticidad se
// comprueba con la firma del evento.
const express = require('express');
const payments = require('../domain/payments');
const { rateLimit } = require('../lib/security');

const router = express.Router();

router.post('/pagos/:gateway', (req, res) => {
  const rl = rateLimit({ key: `webhook:${req.ip}`, limit: 600, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ estado: 'limite' });
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v]));
  const result = payments.handleWebhook(req.params.gateway, req.body, headers);
  res.status(result.http).json({ estado: result.status, motivo: result.reason || undefined });
});

module.exports = router;
