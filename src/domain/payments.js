'use strict';
// F05 Accesos de pago. Una sola pasarela (adaptador). Los permisos se activan solo
// con una confirmación válida del servidor de pagos; el retorno del navegador no
// demuestra el pago. Cada evento se procesa una única vez. No se guardan datos de tarjeta.
const db = require('../db');
const config = require('../config');
const entitlements = require('./entitlements');
const { track, notify, audit } = require('../lib/services');
const { publicRef } = require('../lib/security');
const log = require('../lib/log');

const GATEWAYS = { sandbox: require('./gateways/sandbox') };

function gateway(name = config.payments.gateway) {
  const g = GATEWAYS[name];
  if (!g) throw new Error(`Pasarela no configurada: ${name}`);
  return g;
}

function product(code) {
  return db.one('SELECT * FROM products WHERE code = ? AND active = 1', code);
}

/** Crea (o reutiliza) una orden pendiente y su sesión de checkout. */
function startCheckout(user, prod) {
  const recent = db.one(
    "SELECT * FROM orders WHERE user_id = ? AND product_id = ? AND status = 'pendiente' AND amount_cents = ? AND currency = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1",
    user.id,
    prod.id,
    prod.price_cents,
    prod.currency,
    new Date(Date.now() - 30 * 60 * 1000).toISOString()
  );
  const g = gateway();
  if (recent && recent.gateway_session_id) {
    const ck = db.one("SELECT * FROM sandbox_checkouts WHERE id = ? AND status = 'abierta'", recent.gateway_session_id);
    if (ck) return { order: recent, url: `/pasarela-pruebas/${ck.id}` };
  }
  const ref = publicRef('ord');
  const r = db.run(
    `INSERT INTO orders (ref, user_id, product_id, product_code, product_name, grants_json, amount_cents, currency, access_days, status, gateway, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)`,
    ref,
    user.id,
    prod.id,
    prod.code,
    prod.name,
    prod.grants_json,
    prod.price_cents,
    prod.currency,
    prod.access_days,
    g.NAME,
    db.now(),
    db.now()
  );
  const order = db.one('SELECT * FROM orders WHERE id = ?', r.lastId);
  const ck = g.createCheckout(order);
  db.run('UPDATE orders SET gateway_session_id = ?, updated_at = ? WHERE id = ?', ck.sessionId, db.now(), order.id);
  track('pago_iniciado', { userId: user.id, dedupe: `pago_iniciado:${order.id}` });
  return { order: { ...order, gateway_session_id: ck.sessionId }, url: ck.url };
}

function recordEvent(gatewayName, ev, status, reason) {
  db.run(
    'INSERT INTO payment_events (gateway, event_id, type, order_ref, amount_cents, currency, status, reason, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    gatewayName,
    ev ? ev.id : null,
    ev ? ev.rawType : null,
    ev ? ev.orderRef : null,
    ev ? ev.amountCents : null,
    ev ? ev.currency : null,
    status,
    reason,
    db.now()
  );
}

/**
 * Procesa un webhook. Devuelve { http, status, reason }.
 * 400 → firma o formato inválido (el proveedor no debe considerarlo entregado).
 * 200 → recibido (procesado, duplicado, ignorado o rechazado por datos que no coinciden).
 */
function handleWebhook(gatewayName, rawBody, headers) {
  const g = GATEWAYS[gatewayName];
  if (!g) return { http: 404, status: 'rechazado', reason: 'pasarela_desconocida' };
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const sig = g.verify(body, headers);
  if (!sig.ok) {
    recordEvent(gatewayName, null, 'rechazado', sig.reason);
    log.warn('Webhook de pago rechazado', { reason: sig.reason });
    return { http: 400, status: 'rechazado', reason: sig.reason };
  }
  const ev = g.parse(body);
  if (!ev) {
    recordEvent(gatewayName, null, 'rechazado', 'formato_invalido');
    return { http: 400, status: 'rechazado', reason: 'formato_invalido' };
  }
  try {
    return db.tx(() => processEvent(gatewayName, ev));
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) {
      recordEvent(gatewayName, ev, 'duplicado', 'evento_repetido');
      return { http: 200, status: 'duplicado', reason: 'evento_repetido' };
    }
    throw e;
  }
}

function processEvent(gatewayName, ev) {
  const seen = db.one("SELECT id FROM payment_events WHERE gateway = ? AND event_id = ? AND status IN ('procesado', 'ignorado')", gatewayName, ev.id);
  if (seen) {
    recordEvent(gatewayName, ev, 'duplicado', 'evento_repetido');
    return { http: 200, status: 'duplicado', reason: 'evento_repetido' };
  }
  const order = db.one('SELECT * FROM orders WHERE ref = ? AND gateway = ?', ev.orderRef, gatewayName);
  if (!order) {
    recordEvent(gatewayName, ev, 'rechazado', 'orden_inexistente');
    return { http: 200, status: 'rechazado', reason: 'orden_inexistente' };
  }
  if (ev.amountCents !== order.amount_cents) {
    recordEvent(gatewayName, ev, 'rechazado', 'importe_no_coincide');
    return { http: 200, status: 'rechazado', reason: 'importe_no_coincide' };
  }
  if (ev.currency !== order.currency) {
    recordEvent(gatewayName, ev, 'rechazado', 'moneda_no_coincide');
    return { http: 200, status: 'rechazado', reason: 'moneda_no_coincide' };
  }

  let outcome = 'ignorado';
  let reason = `sin_cambio_desde_${order.status}`;

  if (ev.type === 'succeeded' && ['pendiente', 'fallida', 'cancelada'].includes(order.status)) {
    db.run('UPDATE orders SET status = ?, updated_at = ?, paid_at = ?, gateway_payment_id = ?, failure_reason = NULL WHERE id = ?', 'pagada', db.now(), db.now(), ev.paymentId, order.id);
    if (order.user_id) {
      entitlements.grantFromOrder({ ...order, status: 'pagada' });
      track('pago_confirmado', { userId: order.user_id, dedupe: `pago_confirmado:${order.id}` });
      notify(order.user_id, { kind: 'pago', title: `Pago confirmado: ${order.product_name}`, body: 'Ya tienes acceso.', link: '/inicio', dedupe: `pago:${order.id}` });
    }
    outcome = 'procesado';
    reason = null;
  } else if (ev.type === 'failed' && order.status === 'pendiente') {
    db.run('UPDATE orders SET status = ?, updated_at = ?, failure_reason = ? WHERE id = ?', 'fallida', db.now(), ev.reason || 'rechazado_por_pasarela', order.id);
    outcome = 'procesado';
    reason = null;
  } else if (ev.type === 'canceled' && order.status === 'pendiente') {
    db.run('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', 'cancelada', db.now(), order.id);
    outcome = 'procesado';
    reason = null;
  } else if (ev.type === 'refunded' && order.status === 'pagada') {
    db.run('UPDATE orders SET status = ?, updated_at = ?, refunded_at = ? WHERE id = ?', 'reembolsada', db.now(), db.now(), order.id);
    const n = entitlements.revokeForOrder(order.id, 'reembolso');
    audit(null, 'orden.reembolso', { targetType: 'orden', targetId: order.ref, meta: { permisosRevocados: n } });
    if (order.user_id) notify(order.user_id, { kind: 'pago', title: `Reembolso registrado: ${order.product_name}`, body: 'El acceso de esta compra se retiró.', link: '/cuenta', dedupe: `reembolso:${order.id}` });
    outcome = 'procesado';
    reason = null;
  }
  recordEvent(gatewayName, ev, outcome, reason);
  return { http: 200, status: outcome, reason };
}

module.exports = { gateway, product, startCheckout, handleWebhook, GATEWAYS };
