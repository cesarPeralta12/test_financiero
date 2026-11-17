'use strict';
// «Mis diagnósticos»: lista los resultados anteriores e indica si fueron del test gratuito o de un plan de pago.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const engine = require('../src/domain/free/engine');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

function freeSessionFor(userId, completedAt) {
  const s = engine.createSession({ userId, consent: true, versionId: 'FREE_24_V4_ES' }).session;
  h.db.run("UPDATE ft_sessions SET status = 'completada', completed_revision = revision, completed_at = ? WHERE id = ?", completedAt, s.id);
  return s.id;
}

test('historial: exige sesión', async () => {
  const c = new h.Client();
  const r = await c.get('/historial');
  assert.match(r.text, /Entra a tu cuenta/);
  assert.doesNotMatch(r.text, /<h1>Mis diagnósticos/);
});

test('historial: sin diagnósticos invita al test gratuito', async () => {
  const c = new h.Client();
  await h.consent(c);
  await h.registerUser(c, 'hist-vacio@ejemplo.test');
  const r = await c.get('/historial');
  assert.equal(r.status, 200);
  assert.match(r.text, /Todavía no tienes diagnósticos/);
});

test('historial: muestra tests gratuitos y evaluaciones de pago con su etiqueta, del más reciente al más antiguo', async () => {
  const c = new h.Client();
  await h.consent(c);
  await h.registerUser(c, 'hist-lleno@ejemplo.test');
  const user = h.db.one('SELECT id FROM users WHERE email = ?', 'hist-lleno@ejemplo.test');
  const oldId = freeSessionFor(user.id, '2026-01-10T10:00:00.000Z');
  freeSessionFor(user.id, '2026-02-10T10:00:00.000Z');
  await h.payViaWebhook(c, 'paquete');
  await h.answerAll(c, '/evaluacion', h.DEEP_ANSWERS);
  const ev = h.db.one("SELECT id FROM evaluations WHERE kind = 'profundo' ORDER BY id DESC LIMIT 1");
  const rev = await c.get('/evaluacion/revision');
  const acks = [...rev.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]);
  await c.post('/evaluacion/finalizar', { ack: acks });
  assert.ok(h.db.one('SELECT id FROM diagnoses WHERE evaluation_id = ?', ev.id), 'se creó el diagnóstico profundo');

  const r = await c.get('/historial');
  assert.equal(r.status, 200);
  assert.equal((r.text.match(/>Gratuito</g) || []).length, 2);
  assert.match(r.text, />Plan de pago</);
  assert.match(r.text, /Evaluación profunda/);
  // El de pago es el más reciente; el gratuito más antiguo va al final.
  assert.ok(r.text.indexOf('Evaluación profunda') < r.text.indexOf(`/resultado/anterior/${encodeURIComponent(oldId)}`));
  assert.match(await c.get('/inicio').then((x) => x.text), /href="\/historial"/);
});

test('historial: un resultado anterior solo lo ve su dueño', async () => {
  const a = new h.Client();
  await h.consent(a);
  await h.registerUser(a, 'hist-duenio@ejemplo.test');
  const ua = h.db.one('SELECT id FROM users WHERE email = ?', 'hist-duenio@ejemplo.test');
  const sid = freeSessionFor(ua.id, '2026-01-01T10:00:00.000Z');
  freeSessionFor(ua.id, '2026-03-01T10:00:00.000Z');
  const b = new h.Client();
  await h.consent(b);
  await h.registerUser(b, 'hist-otro@ejemplo.test');
  const other = await b.get(`/resultado/anterior/${encodeURIComponent(sid)}`);
  assert.equal(other.status, 404);
  const own = await a.get(`/resultado/anterior/${encodeURIComponent(sid)}`);
  assert.equal(own.status, 200);
});
