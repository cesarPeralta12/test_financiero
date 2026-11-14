'use strict';
// Criterio «Pago»: éxito, fallo, cancelación, firma inválida y evento duplicado.
// Solo la operación válida activa el acceso, y una sola vez.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const entitlements = require('../src/domain/entitlements');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

async function buyer(email) {
  const c = new h.Client();
  await h.registerUser(c, email);
  const user = h.db.one('SELECT * FROM users WHERE email = ?', email);
  return { c, user };
}

async function checkout(c, code) {
  await c.get(`/comprar/${code}`);
  const r = await c.post(`/comprar/${code}`, {}, { follow: false });
  assert.equal(r.status, 303);
  const id = r.location.split('/').pop();
  const ck = h.db.one('SELECT * FROM sandbox_checkouts WHERE id = ?', id);
  return { id, order: h.db.one('SELECT * FROM orders WHERE ref = ?', ck.order_ref) };
}

function lastDelivery() {
  return h.db.one('SELECT * FROM sandbox_deliveries ORDER BY id DESC LIMIT 1');
}

test('antes de pagar se muestran producto, importe, moneda, duración y condiciones', async () => {
  const { c } = await buyer('ver@ejemplo.test');
  const r = await c.get('/comprar/paquete');
  assert.equal(r.status, 200);
  for (const s of ['Paquete completo', '69.00', 'USD', '12 meses', '3 meses', 'Condiciones', 'Pago único']) assert.ok(r.text.includes(s), `falta «${s}»`);
});

test('pago aprobado: la confirmación firmada del servidor activa el acceso una sola vez', async () => {
  const { c, user } = await buyer('ok@ejemplo.test');
  const { id, order } = await checkout(c, 'evaluacion');
  assert.equal(order.status, 'pendiente');
  h.sandbox.resolveCheckout(id, 'aprobar');
  // El retorno del navegador no demuestra el pago.
  const ret = await c.get(`/pago/retorno?orden=${order.ref}`);
  assert.match(ret.text, /Confirmando tu pago/);
  assert.equal(entitlements.has(user.id, 'evaluacion_profunda'), false);
  // Llega el webhook firmado.
  const d = lastDelivery();
  const res = await h.deliver(d.payload);
  assert.equal(res.status, 200);
  assert.equal(res.body.estado, 'procesado');
  assert.equal(h.db.one('SELECT status FROM orders WHERE id = ?', order.id).status, 'pagada');
  assert.equal(entitlements.has(user.id, 'evaluacion_profunda'), true);
  // La pasarela de pruebas se cuenta como compra de prueba, nunca como compra real.
  assert.equal(h.db.value("SELECT COUNT(*) FROM analytics_events WHERE name = 'compra_prueba' AND user_id = ?", user.id), 1);
  assert.equal(h.db.value("SELECT COUNT(*) FROM analytics_events WHERE name = 'compra_real' AND user_id = ?", user.id), 0);
  // Evento duplicado: no crea otra compra ni duplica permisos.
  const dup = await h.deliver(d.payload);
  assert.equal(dup.status, 200);
  assert.equal(dup.body.estado, 'duplicado');
  assert.equal(h.db.value('SELECT COUNT(*) FROM entitlements WHERE user_id = ?', user.id), 1);
  assert.equal(h.db.value("SELECT COUNT(*) FROM orders WHERE user_id = ? AND status = 'pagada'", user.id), 1);
  const ok = await c.get(`/pago/retorno?orden=${order.ref}`);
  assert.match(ok.text, /Pago confirmado/);
  // No se guardan datos de tarjeta.
  const cols = h.db.all("SELECT name FROM pragma_table_info('orders')").map((r) => r.name).join(',');
  assert.doesNotMatch(cols, /card|tarjeta|pan|cvv/i);
});

test('un segundo evento aprobado distinto para la misma orden no duplica permisos', async () => {
  const { c, user } = await buyer('dos-eventos@ejemplo.test');
  const { id } = await checkout(c, 'paquete');
  h.sandbox.resolveCheckout(id, 'aprobar');
  const d = JSON.parse(lastDelivery().payload);
  await h.deliver(JSON.stringify(d));
  const again = { ...d, id: d.id + '_bis' };
  const r = await h.deliver(JSON.stringify(again));
  assert.equal(r.body.estado, 'ignorado');
  assert.equal(h.db.value('SELECT COUNT(*) FROM entitlements WHERE user_id = ?', user.id), 3);
});

test('pago rechazado: la orden queda fallida y no se activa nada', async () => {
  const { c, user } = await buyer('falla@ejemplo.test');
  const { id, order } = await checkout(c, 'evaluacion');
  h.sandbox.resolveCheckout(id, 'rechazar');
  const res = await h.deliver(lastDelivery().payload);
  assert.equal(res.body.estado, 'procesado');
  const o = h.db.one('SELECT * FROM orders WHERE id = ?', order.id);
  assert.equal(o.status, 'fallida');
  assert.equal(o.failure_reason, 'fondos_insuficientes');
  assert.equal(entitlements.has(user.id, 'evaluacion_profunda'), false);
  const ret = await c.get(`/pago/retorno?orden=${order.ref}`);
  assert.match(ret.text, /no se completó/);
});

test('pago cancelado: la orden queda cancelada y no se activa nada', async () => {
  const { c, user } = await buyer('cancela@ejemplo.test');
  const { id, order } = await checkout(c, 'plan_maestro');
  h.sandbox.resolveCheckout(id, 'cancelar');
  await h.deliver(lastDelivery().payload);
  assert.equal(h.db.one('SELECT status FROM orders WHERE id = ?', order.id).status, 'cancelada');
  assert.equal(entitlements.has(user.id, 'plan_maestro'), false);
});

test('firma inválida, caducada o ausente: se rechaza y no cambia nada', async () => {
  const { c, user } = await buyer('firma@ejemplo.test');
  const { id, order } = await checkout(c, 'evaluacion');
  h.sandbox.resolveCheckout(id, 'aprobar');
  const payload = lastDelivery().payload;
  const forged = await h.deliver(payload, { signature: h.sandbox.sign(payload, undefined, 'otro_secreto') });
  assert.equal(forged.status, 400);
  assert.equal(forged.body.motivo, 'firma_invalida');
  const stale = await h.deliver(payload, { signature: h.sandbox.sign(payload, Math.floor(Date.now() / 1000) - 3600) });
  assert.equal(stale.status, 400);
  assert.equal(stale.body.motivo, 'firma_caducada');
  const res = await fetch(`${(await h.start())}/webhooks/pagos/sandbox`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });
  assert.equal(res.status, 400);
  const tampered = payload.replace(/"amount_cents":\d+/, '"amount_cents":1');
  const t = await h.deliver(tampered, { signature: h.sandbox.sign(payload) });
  assert.equal(t.status, 400);
  assert.equal(h.db.one('SELECT status FROM orders WHERE id = ?', order.id).status, 'pendiente');
  assert.equal(entitlements.has(user.id, 'evaluacion_profunda'), false);
  assert.ok(h.db.value("SELECT COUNT(*) FROM payment_events WHERE status = 'rechazado' AND reason = 'firma_invalida'") >= 1);
});

test('importe o moneda que no coinciden con la orden: se rechaza', async () => {
  const { c, user } = await buyer('importe@ejemplo.test');
  const { id, order } = await checkout(c, 'evaluacion');
  h.sandbox.resolveCheckout(id, 'aprobar');
  const ev = JSON.parse(lastDelivery().payload);
  const wrongAmount = JSON.stringify({ ...ev, id: ev.id + '_a', data: { ...ev.data, amount_cents: 100 } });
  const r1 = await h.deliver(wrongAmount);
  assert.equal(r1.body.estado, 'rechazado');
  assert.equal(r1.body.motivo, 'importe_no_coincide');
  const wrongCur = JSON.stringify({ ...ev, id: ev.id + '_c', data: { ...ev.data, currency: 'MXN' } });
  const r2 = await h.deliver(wrongCur);
  assert.equal(r2.body.motivo, 'moneda_no_coincide');
  const unknownOrder = JSON.stringify({ ...ev, id: ev.id + '_o', data: { ...ev.data, order_ref: 'ord_no_existe' } });
  const r3 = await h.deliver(unknownOrder);
  assert.equal(r3.body.motivo, 'orden_inexistente');
  assert.equal(h.db.one('SELECT status FROM orders WHERE id = ?', order.id).status, 'pendiente');
  assert.equal(entitlements.has(user.id, 'evaluacion_profunda'), false);
});

test('recargar el pago no crea otra orden', async () => {
  const { c, user } = await buyer('recarga@ejemplo.test');
  await checkout(c, 'evaluacion');
  await checkout(c, 'evaluacion');
  assert.equal(h.db.value('SELECT COUNT(*) FROM orders WHERE user_id = ?', user.id), 1);
});

test('reembolso: se registra y se revoca el acceso de esa compra', async () => {
  const { c, user } = await buyer('reembolso@ejemplo.test');
  const { id, order } = await checkout(c, 'acompanamiento');
  h.sandbox.resolveCheckout(id, 'aprobar');
  await h.deliver(lastDelivery().payload);
  assert.equal(entitlements.has(user.id, 'acompanamiento'), true);
  h.sandbox.refund(order.ref);
  const r = await h.deliver(lastDelivery().payload);
  assert.equal(r.body.estado, 'procesado');
  assert.equal(h.db.one('SELECT status FROM orders WHERE id = ?', order.id).status, 'reembolsada');
  assert.equal(entitlements.has(user.id, 'acompanamiento'), false);
});

test('la pasarela de pruebas entrega el webhook por HTTP mediante la cola', async () => {
  const config = require('../src/config');
  const base = await h.start();
  const prevUrl = config.payments.sandboxWebhookUrl;
  const prevAuto = config.payments.sandboxAutoDeliver;
  config.payments.sandboxWebhookUrl = `${base}/webhooks/pagos/sandbox`;
  config.payments.sandboxAutoDeliver = true;
  try {
    const { c, user } = await buyer('cola@ejemplo.test');
    const { id } = await checkout(c, 'evaluacion');
    h.sandbox.resolveCheckout(id, 'aprobar');
    await h.queue.drain({ ignoreSchedule: true });
    assert.equal(lastDelivery().status, 'entregado');
    assert.equal(entitlements.has(user.id, 'evaluacion_profunda'), true);
  } finally {
    config.payments.sandboxWebhookUrl = prevUrl;
    config.payments.sandboxAutoDeliver = prevAuto;
  }
});
