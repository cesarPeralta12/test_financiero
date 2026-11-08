'use strict';
// Criterios «Evaluación» y «Plan»: 25 respuestas, contradicciones, diagnóstico con
// versión y datos usados; generar y descargar el plan, reintentar un fallo sin
// duplicar cobro y conservar versiones.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { setSetting } = require('../src/lib/services');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

let c;
let user;

test('compra del paquete y evaluación profunda con contradicción', async () => {
  c = new h.Client();
  await h.consent(c);
  await h.answerAll(c, '/test', h.FREE_ANSWERS);
  await c.post('/test/finalizar', {});
  await h.registerUser(c, 'viaje@ejemplo.test', { name: 'Ana' });
  user = h.db.one("SELECT * FROM users WHERE email = 'viaje@ejemplo.test'");
  await h.payViaWebhook(c, 'paquete');

  // Respuestas con contradicción: el desglose no coincide con el total declarado.
  const bad = { ...h.DEEP_ANSWERS, gasto_total: { amount: '12000', period: 'mensual' } };
  const first = await c.get('/evaluacion');
  assert.match(first.url, /\/evaluacion\/pregunta\/1$/);
  // Se ofrece reutilizar la respuesta del test gratuito, pero solo con confirmación.
  assert.match(first.text, /Usar esta respuesta/);
  const used = await c.post('/evaluacion/pregunta/1', { action: 'use_previous' });
  assert.match(used.text, /Revisa la respuesta anterior/);
  const ev = h.db.one("SELECT * FROM evaluations WHERE user_id = ? AND kind = 'profundo'", user.id);
  assert.equal(h.db.value('SELECT COUNT(*) FROM answers WHERE evaluation_id = ?', ev.id), 0, 'no se guarda sin confirmar');

  const review = await h.answerAll(c, '/evaluacion', bad);
  assert.match(review.url, /\/evaluacion\/revision$/);
  assert.match(review.text, /Contradicciones por corregir/);
  assert.match(review.text, /desglosados suman/);
  assert.equal(h.db.value('SELECT COUNT(*) FROM answers WHERE evaluation_id = ?', ev.id), 25);
  const blocked = await c.post('/evaluacion/finalizar', {});
  assert.equal(blocked.status, 422);
  assert.equal(h.db.value('SELECT COUNT(*) FROM diagnoses WHERE user_id = ?', user.id), 0);

  // Corrige el total y confirma los avisos.
  const pos = h.db.one("SELECT position FROM questions WHERE code = 'gasto_total' AND questionnaire_id = ?", ev.questionnaire_id).position;
  await c.post(`/evaluacion/pregunta/${pos}?volver=revision`, { action: 'next', amount: '20000', period: 'mensual' });
  const rev2 = await c.get('/evaluacion/revision');
  assert.doesNotMatch(rev2.text, /Contradicciones por corregir/);
  const acks = [...rev2.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]);
  const fin = await c.post('/evaluacion/finalizar', { ack: acks });
  assert.match(fin.url, /\/diagnostico\/\d+$/);
  assert.match(fin.text, /Tu diagnóstico/);
  for (const s of ['Saldo disponible', 'Deudas', 'Capacidad de ahorro', 'Riesgos', 'Oportunidades', 'Tu dato', 'Cálculo', 'Supuesto']) assert.ok(fin.text.includes(s), `falta «${s}»`);
  // Incluido en el paquete: se ofrece abrir el plan sin volver a cobrar.
  assert.match(fin.text, /incluido en lo que adquiriste/);
  const d = h.db.one('SELECT * FROM diagnoses WHERE user_id = ?', user.id);
  assert.equal(d.calc_version, '1.0.0');
  assert.ok(d.rule_set_id);
  const snap = JSON.parse(d.snapshot_json);
  assert.equal(snap.gasto_total.value.amount, '20000.00');
  const r = JSON.parse(d.result_json);
  assert.equal(r.balance, '5000.00'); // 30000 − (20000 + 6000/12) − 4500
  assert.equal(r.debts[0].monthlyRate, '0.04000000');
  assert.ok(!('score' in r) && !JSON.stringify(r).includes('puntuación'));
});

test('el cero y el dato desconocido no son equivalentes', () => {
  const deep = require('../src/domain/deep');
  const rules = require('../src/domain/rules').current().rules;
  const base = { moneda_base: { value: 'USD' }, ingreso_principal: { value: { amount: '1000.00', period: 'mensual' } }, gasto_total: { value: { amount: '800.00', period: 'mensual' } }, deudas: { value: [] }, ahorro_mensual: { value: { amount: '0.00', period: 'mensual' } } };
  const zero = deep.diagnose({ ...base, ingresos_adicionales: { value: { amount: '0.00', period: 'mensual' } }, gastos_anuales: { value: '0.00' } }, rules);
  const unk = deep.diagnose({ ...base, ingresos_adicionales: { value: { amount: '0.00', period: 'mensual' } }, gastos_anuales: { value: null, unknown: true } }, rules);
  assert.equal(zero.balance, '200.00');
  assert.ok(!zero.missing.some((m) => /anuales/.test(m)));
  assert.ok(unk.missing.some((m) => /anuales/.test(m)));
});

test('generar el plan, descargarlo en PDF y fijar el Día Uno', async () => {
  const start = new Date().toISOString().slice(0, 10);
  const page = await c.get('/plan');
  assert.match(page.text, /Elige tu Día Uno/);
  const r = await c.post('/plan/generar', { start_date: start });
  assert.match(r.text, /Estamos preparando/);
  await h.queue.drain({ ignoreSchedule: true });
  const p = h.db.one('SELECT * FROM plan_versions WHERE user_id = ?', user.id);
  assert.equal(p.status, 'completo');
  assert.equal(p.start_date, start);
  const view = await c.get('/plan');
  for (const s of ['Diagnóstico', 'Presupuesto y deuda', 'Metas y escenarios', 'Plan de 90 días', 'Hoja de ruta de 12 meses', 'Día 1']) assert.ok(view.text.includes(s), `falta «${s}»`);
  const content = JSON.parse(p.content_json);
  assert.ok(content.plan90.length >= 6);
  assert.ok(content.hoja12.length >= 4);
  assert.equal(content.presupuesto.strategy.order[0], 'Tarjeta');
  // Las cifras del plan no las calcula la IA: se guarda la ejecución con modelo, versión e insumos.
  const run = h.db.one('SELECT * FROM ai_runs WHERE id = ?', p.ai_run_id);
  assert.equal(run.prompt_version, 'plan-v1');
  assert.ok(JSON.parse(run.input_json).presupuesto);
  // Tareas creadas con fechas relativas al Día Uno.
  assert.ok(h.db.value("SELECT COUNT(*) FROM tasks WHERE user_id = ? AND source = 'plan'", user.id) >= 6);
  // PDF
  const base = await h.start();
  const pdf = await fetch(`${base}/plan/version/${p.id}/pdf`, { headers: { cookie: c.cookieHeader() } });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const buf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buf.length > 3000);
});

test('un fallo de IA no cobra: se reintenta y se conservan las versiones', async () => {
  const ordersBefore = h.db.value('SELECT COUNT(*) FROM orders WHERE user_id = ?', user.id);
  // Nueva evaluación con datos distintos → nueva versión del plan.
  await c.post('/evaluacion/nueva', {});
  const answers = { ...h.DEEP_ANSWERS, ingreso_principal: { amount: '32000', period: 'mensual' } };
  await h.answerAll(c, '/evaluacion', answers);
  const rev = await c.get('/evaluacion/revision');
  const acks = [...rev.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]);
  await c.post('/evaluacion/finalizar', { ack: acks });
  const plan = await c.get('/plan');
  assert.match(plan.text, /Tus datos cambiaron desde esta versión/);

  setSetting('ai_simulate_failure', true);
  await c.post('/plan/actualizar', {});
  await h.queue.drain({ ignoreSchedule: true });
  const failed = h.db.one("SELECT * FROM plan_versions WHERE user_id = ? AND version_number = 2", user.id);
  assert.equal(failed.status, 'fallido');
  const v1 = h.db.one("SELECT * FROM plan_versions WHERE user_id = ? AND version_number = 1", user.id);
  assert.equal(v1.is_current, 1, 'se conserva la última versión completa');
  const page = await c.get('/plan');
  assert.match(page.text, /Reintentar sin costo/);
  assert.match(page.text, /No se hizo ningún cobro/);

  setSetting('ai_simulate_failure', false);
  await c.post(`/plan/${failed.id}/reintentar`, {});
  await h.queue.drain({ ignoreSchedule: true });
  const v2 = h.db.one('SELECT * FROM plan_versions WHERE id = ?', failed.id);
  assert.equal(v2.status, 'completo');
  assert.equal(v2.is_current, 1);
  assert.equal(h.db.one('SELECT is_current FROM plan_versions WHERE id = ?', v1.id).is_current, 0);
  // La versión anterior sigue disponible.
  const old = await c.get(`/plan/version/${v1.id}`);
  assert.equal(old.status, 200);
  assert.match(old.text, /versión 1/);
  assert.equal(h.db.value('SELECT COUNT(*) FROM orders WHERE user_id = ?', user.id), ordersBefore, 'sin cobros adicionales');
});

test('tablero: completar, posponer y reabrir tareas, con historial', async () => {
  const t = h.db.one("SELECT * FROM tasks WHERE user_id = ? AND archived = 0 AND status = 'pendiente' ORDER BY position LIMIT 1", user.id);
  await c.get('/tablero');
  await c.post(`/tareas/${t.id}/completar`, {});
  assert.equal(h.db.one('SELECT status FROM tasks WHERE id = ?', t.id).status, 'completada');
  await c.post(`/tareas/${t.id}/reabrir`, {});
  assert.equal(h.db.one('SELECT status FROM tasks WHERE id = ?', t.id).status, 'pendiente');
  const later = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  await c.post(`/tareas/${t.id}/posponer`, { hasta: later });
  const tt = h.db.one('SELECT * FROM tasks WHERE id = ?', t.id);
  assert.equal(tt.status, 'pospuesta');
  assert.equal(tt.postponed_until, later);
  assert.equal(h.db.value('SELECT COUNT(*) FROM task_events WHERE task_id = ? AND from_status IS NOT NULL', t.id), 3);
  const board = await c.get('/tablero');
  assert.match(board.text, /Tareas pendientes/);
  assert.match(board.text, /Cambios recientes/);
  const home = await c.get('/inicio');
  assert.match(home.text, /Tu siguiente paso/);
  assert.match(home.text, /Día 1/);
  assert.ok(h.db.one("SELECT id FROM analytics_events WHERE name = 'primera_tarea_completada' AND user_id = ?", user.id));
});
