'use strict';
// Pasarela de pruebas: simula a un proveedor externo con checkout alojado y
// eventos firmados (HMAC-SHA256). Sustituible por la pasarela definitiva
// implementando la misma interfaz: createCheckout, verify, parse.
const db = require('../../db');
const config = require('../../config');
const queue = require('../../lib/queue');
const log = require('../../lib/log');
const { hmac, safeEqual, publicRef } = require('../../lib/security');

const NAME = 'sandbox';
const HEADER = 'dia-firma';

function webhookUrl() {
  return config.payments.sandboxWebhookUrl || `${config.appUrl}/webhooks/pagos/${NAME}`;
}

/** Crea la sesión de pago del lado del «proveedor» y devuelve la URL de checkout. */
function createCheckout(order) {
  const id = publicRef('cs');
  db.run(
    `INSERT INTO sandbox_checkouts (id, order_ref, product_name, amount_cents, currency, status, return_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'abierta', ?, ?, ?)`,
    id,
    order.ref,
    order.product_name,
    order.amount_cents,
    order.currency,
    `${config.appUrl}/pago/retorno?orden=${encodeURIComponent(order.ref)}`,
    db.now(),
    db.now()
  );
  return { sessionId: id, url: `/pasarela-pruebas/${id}` };
}

function sign(body, timestamp = Math.floor(Date.now() / 1000), secret = config.payments.webhookSecret) {
  return `t=${timestamp},v1=${hmac(secret, `${timestamp}.${body}`)}`;
}

/** Valida la firma y la antigüedad del evento. */
function verify(rawBody, headers) {
  const header = headers[HEADER];
  if (!header || typeof header !== 'string') return { ok: false, reason: 'firma_ausente' };
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=').map((x) => x.trim())));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return { ok: false, reason: 'firma_mal_formada' };
  if (Math.abs(Date.now() / 1000 - t) > config.payments.webhookToleranceSec) return { ok: false, reason: 'firma_caducada' };
  const expected = hmac(config.payments.webhookSecret, `${t}.${rawBody}`);
  if (!safeEqual(expected, parts.v1)) return { ok: false, reason: 'firma_invalida' };
  return { ok: true };
}

const TYPE_MAP = {
  'pago.aprobado': 'succeeded',
  'pago.rechazado': 'failed',
  'pago.cancelado': 'canceled',
  'reembolso.completado': 'refunded',
};

/** Convierte el evento del proveedor al formato interno. */
function parse(rawBody) {
  let e;
  try {
    e = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!e || typeof e.id !== 'string' || !TYPE_MAP[e.type] || !e.data || typeof e.data.order_ref !== 'string') return null;
  if (!Number.isInteger(e.data.amount_cents) || typeof e.data.currency !== 'string') return null;
  return {
    id: e.id,
    type: TYPE_MAP[e.type],
    rawType: e.type,
    orderRef: e.data.order_ref,
    amountCents: e.data.amount_cents,
    currency: e.data.currency,
    paymentId: e.data.payment_id || null,
    reason: e.data.reason || null,
  };
}

// ───── Lado del «proveedor» (solo pruebas) ─────

function buildEvent(checkout, type, extra = {}) {
  return {
    id: publicRef('evt'),
    type,
    created: new Date().toISOString(),
    data: {
      order_ref: checkout.order_ref,
      checkout_id: checkout.id,
      payment_id: checkout.payment_id,
      amount_cents: checkout.amount_cents,
      currency: checkout.currency,
      ...extra,
    },
  };
}

function emit(event) {
  const payload = JSON.stringify(event);
  const r = db.run(
    "INSERT INTO sandbox_deliveries (event_id, payload, status, created_at, updated_at) VALUES (?, ?, 'pendiente', ?, ?)",
    event.id,
    payload,
    db.now(),
    db.now()
  );
  if (config.payments.sandboxAutoDeliver) queue.enqueue('sandbox_entregar', { deliveryId: r.lastId }, { maxAttempts: 6 });
  return r.lastId;
}

/** Acción del comprador en el checkout simulado. */
function resolveCheckout(checkoutId, action) {
  const ck = db.one('SELECT * FROM sandbox_checkouts WHERE id = ?', checkoutId);
  if (!ck) return null;
  if (ck.status !== 'abierta') return ck;
  const status = { aprobar: 'aprobada', rechazar: 'rechazada', cancelar: 'cancelada' }[action];
  if (!status) return ck;
  const paymentId = action === 'aprobar' ? publicRef('pay') : null;
  db.run('UPDATE sandbox_checkouts SET status = ?, payment_id = ?, updated_at = ? WHERE id = ?', status, paymentId, db.now(), checkoutId);
  const updated = db.one('SELECT * FROM sandbox_checkouts WHERE id = ?', checkoutId);
  const type = { aprobar: 'pago.aprobado', rechazar: 'pago.rechazado', cancelar: 'pago.cancelado' }[action];
  emit(buildEvent(updated, type, action === 'rechazar' ? { reason: 'fondos_insuficientes' } : {}));
  return updated;
}

function refund(orderRef) {
  const ck = db.one("SELECT * FROM sandbox_checkouts WHERE order_ref = ? AND status = 'aprobada' ORDER BY created_at DESC LIMIT 1", orderRef);
  if (!ck) return null;
  db.run("UPDATE sandbox_checkouts SET status = 'reembolsada', updated_at = ? WHERE id = ?", db.now(), ck.id);
  return emit(buildEvent(ck, 'reembolso.completado'));
}

/** Reenvía un evento ya entregado (simula la repetición de un webhook). */
function redeliver(deliveryId) {
  const d = db.one('SELECT * FROM sandbox_deliveries WHERE id = ?', deliveryId);
  if (!d) return null;
  const r = db.run("INSERT INTO sandbox_deliveries (event_id, payload, status, created_at, updated_at) VALUES (?, ?, 'pendiente', ?, ?)", d.event_id, d.payload, db.now(), db.now());
  queue.enqueue('sandbox_entregar', { deliveryId: r.lastId }, { maxAttempts: 3 });
  return r.lastId;
}

queue.register('sandbox_entregar', async ({ deliveryId }) => {
  const d = db.one('SELECT * FROM sandbox_deliveries WHERE id = ?', deliveryId);
  if (!d || d.status === 'entregado') return;
  db.run('UPDATE sandbox_deliveries SET attempts = attempts + 1, updated_at = ? WHERE id = ?', db.now(), deliveryId);
  let resp;
  try {
    resp = await fetch(webhookUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', [HEADER]: sign(d.payload) },
      body: d.payload,
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    db.run("UPDATE sandbox_deliveries SET status = 'fallido', last_response = ?, updated_at = ? WHERE id = ?", 'sin_conexion', db.now(), deliveryId);
    throw new Error('No se pudo entregar el webhook de pruebas');
  }
  const ok = resp.status >= 200 && resp.status < 300;
  db.run('UPDATE sandbox_deliveries SET status = ?, last_response = ?, updated_at = ? WHERE id = ?', ok ? 'entregado' : 'fallido', `HTTP ${resp.status}`, db.now(), deliveryId);
  if (!ok) {
    log.warn('Webhook de pruebas rechazado', { status: resp.status });
    throw new Error(`Webhook respondió ${resp.status}`);
  }
});

module.exports = { NAME, HEADER, createCheckout, verify, parse, sign, resolveCheckout, refund, redeliver, buildEvent, webhookUrl };
