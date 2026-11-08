'use strict';
// Criterios «Coach», «Simulación» y «Operación»: retomar contexto propio, proponer una
// tarea y no guardar cambios sin confirmación; comparar escenarios sin alterar cifras
// reales ni contar dos veces un pago; límite de IA, error del proveedor y respaldo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const h = require('./helpers');
const { setSetting } = require('../src/lib/services');
const tracker = require('../src/domain/tracker');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

let c;
let user;
const today = new Date().toISOString().slice(0, 10);

test('preparación: cuenta con paquete, diagnóstico y plan', async () => {
  c = new h.Client();
  await h.consent(c);
  await h.answerAll(c, '/test', h.FREE_ANSWERS);
  await c.post('/test/finalizar', {});
  await h.registerUser(c, 'coach@ejemplo.test');
  await h.payViaWebhook(c, 'paquete');
  await h.answerAll(c, '/evaluacion', h.DEEP_ANSWERS);
  const rev = await c.get('/evaluacion/revision');
  await c.post('/evaluacion/finalizar', { ack: [...rev.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]) });
  await c.post('/plan/generar', { start_date: today });
  await h.queue.drain({ ignoreSchedule: true });
  user = h.db.one("SELECT * FROM users WHERE email = 'coach@ejemplo.test'");
  assert.ok(h.db.one("SELECT id FROM plan_versions WHERE user_id = ? AND status = 'completo'", user.id));
});

test('el coach se identifica como IA, conoce el contexto propio y retoma la conversación', async () => {
  const page = await c.get('/coach');
  assert.match(page.text, /asistente de inteligencia artificial/);
  await c.post('/coach/mensajes', { mensaje: '¿Eres una persona?' });
  await c.post('/coach/mensajes', { mensaje: '¿Cuál es mi siguiente paso?' });
  const again = await c.get('/coach');
  assert.match(again.text, /no una persona/);
  assert.match(again.text, /Tu siguiente paso: Arma tu presupuesto del mes/);
  // Otro dispositivo: la conversación se retoma.
  const other = new h.Client();
  await h.login(other, 'coach@ejemplo.test', 'Clave-segura-123');
  const resumed = await other.get('/coach');
  assert.match(resumed.text, /¿Eres una persona\?/);
  const ctx = require('../src/domain/coach').context(user.id);
  assert.equal(ctx.plan.version, 1);
  assert.ok(ctx.tareas_pendientes.length > 0);
  assert.equal(ctx.diagnostico.saldo_disponible.replace(/\D/g, ''), '500000');
});

test('una consulta hipotética no cambia datos; un registro solo se guarda al confirmar', async () => {
  const movBefore = h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', user.id);
  await c.post('/coach/mensajes', { mensaje: '¿Qué pasa si pago 1000 más a mi tarjeta?' });
  const hyp = h.db.one("SELECT * FROM messages WHERE user_id = ? AND role = 'coach' ORDER BY id DESC LIMIT 1", user.id);
  assert.equal(hyp.kind, 'hipotetico');
  assert.match(hyp.content, /no cambia tus datos/);
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', user.id), movBefore);

  await c.post('/coach/mensajes', { mensaje: 'Gasté 350 en el super' });
  const prop = h.db.one("SELECT * FROM messages WHERE user_id = ? AND role = 'coach' ORDER BY id DESC LIMIT 1", user.id);
  assert.equal(prop.kind, 'propuesta');
  assert.equal(prop.proposal_status, 'pendiente');
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', user.id), movBefore, 'sin confirmación no se guarda');
  const shown = await c.get('/coach');
  assert.match(shown.text, /Confirmar/);
  await c.post(`/coach/propuesta/${prop.id}/confirmar`, {});
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', user.id), movBefore + 1);
  const m = h.db.one("SELECT * FROM movements WHERE user_id = ? ORDER BY id DESC LIMIT 1", user.id);
  assert.equal(m.kind, 'gasto');
  assert.equal(m.category, 'alimentacion');
  assert.equal(m.amount, '350.00');
  // Confirmar dos veces no duplica.
  await c.post(`/coach/propuesta/${prop.id}/confirmar`, {}, { follow: false });
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', user.id), movBefore + 1);

  // Propuesta de completar tarea, descartada: la tarea no cambia.
  await c.post('/coach/mensajes', { mensaje: 'Ya terminé' });
  const p2 = h.db.one("SELECT * FROM messages WHERE user_id = ? AND role = 'coach' ORDER BY id DESC LIMIT 1", user.id);
  const taskId = JSON.parse(p2.proposal_json).taskId;
  await c.post(`/coach/propuesta/${p2.id}/descartar`, {});
  assert.equal(h.db.one('SELECT status FROM tasks WHERE id = ?', taskId).status, 'pendiente');
});

test('el coach propone una tarea cuando no hay pendientes', () => {
  const coach = require('../src/domain/coach');
  h.db.run("UPDATE tasks SET status = 'completada' WHERE user_id = ?", user.id);
  const ctx = coach.context(user.id);
  const out = coach.localReply(user.id, 'hola', ctx);
  assert.equal(out.proposal.type, 'crear_tarea');
  assert.ok(out.proposal.criteria.length > 0);
  h.db.run("UPDATE tasks SET status = 'pendiente' WHERE user_id = ?", user.id);
});

test('calculadora: registrar, editar y eliminar sin duplicar; previsto y real por separado', async () => {
  await c.get('/calculadora/movimientos');
  const month = today.slice(0, 7);
  const before = tracker.monthSummary(user.id, month);
  await c.post('/calculadora/movimientos', { date: today, kindcat: 'ingreso:sueldo', amount: '30000' });
  await c.post('/calculadora/movimientos', { date: today, kindcat: 'gasto:vivienda', amount: '8000' });
  const id = h.db.one("SELECT id FROM movements WHERE user_id = ? AND category = 'vivienda' ORDER BY id DESC LIMIT 1", user.id).id;
  await c.post(`/calculadora/movimientos/${id}`, { date: today, kindcat: 'gasto:vivienda', amount: '8500' });
  let s = tracker.monthSummary(user.id, month);
  assert.equal(s.gasto.minus(before.gasto).toFixed(2), '8500.00', 'editar no duplica');
  await c.post(`/calculadora/movimientos/${id}/eliminar`, {});
  s = tracker.monthSummary(user.id, month);
  assert.equal(s.gasto.minus(before.gasto).toFixed(2), '0.00');
  // Transferencias entre ahorros propios no son ingreso.
  const goals = tracker.goals(user.id);
  assert.ok(goals.length >= 2);
  await c.post('/calculadora/movimientos', { date: today, kindcat: 'transferencia:entre_ahorros', amount: '1000', goal_id: goals[0].id, to_goal_id: goals[1].id });
  const s2 = tracker.monthSummary(user.id, month);
  assert.equal(s2.ingreso.toFixed(2), s.ingreso.toFixed(2));
  const g2 = tracker.goals(user.id);
  assert.equal(new (require('../src/lib/money').D)(g2[1].saved).minus(goals[1].saved).toFixed(2), '1000.00');
  // Presupuesto previsto: se muestra aparte y no se suma a los movimientos.
  await c.get('/calculadora/presupuesto');
  await c.post(`/calculadora/presupuesto?mes=${month}`, { b: { ingreso: { total: '30000' }, gasto: { vivienda: '8000', alimentacion: '5000' }, pago_deuda: { cuota: '4500' }, ahorro: { total: '2000' } } });
  const planned = tracker.budgetSummary(user.id, month);
  assert.equal(planned.gasto.toFixed(2), '13000.00');
  const s3 = tracker.monthSummary(user.id, month);
  assert.equal(s3.ingreso.toFixed(2), s2.ingreso.toFixed(2), 'el presupuesto no se suma a lo real');
  const page = await c.get('/calculadora/movimientos');
  assert.match(page.text, /nunca se suman/);
  // Moneda distinta: se rechaza (sin conversiones automáticas).
  const v = tracker.validateMovement(user.id, { kind: 'gasto', category: 'otros', date: today, amount: '10', currency: 'USD' });
  assert.equal(v.ok, false);
  assert.match(v.errors.currency, /No hacemos conversiones/);
});

test('simulación: compara sin alterar datos reales ni contar dos veces un pago', async () => {
  const snapshot = () => JSON.stringify({
    mov: h.db.all('SELECT * FROM movements WHERE user_id = ? ORDER BY id', user.id),
    goals: h.db.all('SELECT * FROM goals WHERE user_id = ? ORDER BY id', user.id),
    debts: h.db.all('SELECT * FROM debt_balances WHERE user_id = ? ORDER BY id', user.id),
    plan: h.db.all('SELECT id, is_current, content_json FROM plan_versions WHERE user_id = ?', user.id),
    budget: h.db.all('SELECT * FROM budget_lines WHERE user_id = ?', user.id),
  });
  const before = snapshot();
  const r = await c.post('/calculadora/simulador', { ahorro_extra: '0', cambio_gasto: '0', pago_extra_deuda: '1000', ingreso_extra: '0' });
  assert.equal(r.status, 200);
  assert.match(r.text, /tus datos reales no cambiaron/);
  assert.equal(snapshot(), before, 'la simulación no altera datos reales ni el plan');
  const sim = tracker.simulate(user.id, { pago_extra_deuda: '1000' });
  const D = require('../src/lib/money').D;
  assert.equal(new D(sim.base.free).minus(sim.scenario.free).toFixed(2), '1000.00', 'el pago extra se resta una sola vez del saldo');
  assert.equal(new D(sim.scenario.debtPayments).minus(sim.base.debtPayments).toFixed(2), '1000.00');
  assert.ok(sim.scenario.debtMonths < sim.base.debtMonths);
  // Guardar solo cuando se pide.
  assert.equal(h.db.value('SELECT COUNT(*) FROM scenarios WHERE user_id = ?', user.id), 0);
  await c.post('/calculadora/simulador/guardar', { name: 'Pago extra', ahorro_extra: '0', cambio_gasto: '0', pago_extra_deuda: '1000', ingreso_extra: '0' });
  assert.equal(h.db.value('SELECT COUNT(*) FROM scenarios WHERE user_id = ?', user.id), 1);
  const meta = h.db.one('SELECT * FROM goals WHERE user_id = ? AND kind = ? LIMIT 1', user.id, 'meta');
  const g = tracker.goals(user.id).find((x) => x.id === meta.id);
  assert.ok(g.progress.valid);
});

test('límite de IA por cuenta: el coach lo explica y conserva la conversación', async () => {
  const n = h.db.value('SELECT COUNT(*) FROM messages WHERE user_id = ?', user.id);
  h.db.run('UPDATE users SET ai_monthly_limit = 0 WHERE id = ?', user.id);
  await c.post('/coach/mensajes', { mensaje: 'Hola de nuevo' });
  const last = h.db.one('SELECT * FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 1', user.id);
  assert.equal(last.role, 'sistema');
  assert.match(last.content, /límite mensual/);
  assert.equal(h.db.value('SELECT COUNT(*) FROM messages WHERE user_id = ?', user.id), n + 2, 'se guarda el mensaje y el aviso');
  assert.ok(h.db.one("SELECT id FROM ai_runs WHERE user_id = ? AND status = 'limite'", user.id));
  h.db.run('UPDATE users SET ai_monthly_limit = NULL WHERE id = ?', user.id);
  // Límite global de gasto
  setSetting('ai_global_monthly_budget_usd', 0);
  await c.post('/coach/mensajes', { mensaje: 'Hola' });
  assert.match(h.db.one('SELECT content FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 1', user.id).content, /límite de uso de este mes/);
  setSetting('ai_global_monthly_budget_usd', 50);
});

test('error del proveedor de IA: se explica y la conversación se conserva', async () => {
  setSetting('ai_simulate_failure', true);
  await c.post('/coach/mensajes', { mensaje: '¿Cómo voy?' });
  const msgs = h.db.all('SELECT * FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 2', user.id);
  assert.equal(msgs[0].role, 'sistema');
  assert.match(msgs[0].content, /no está disponible/);
  assert.equal(msgs[1].content, '¿Cómo voy?');
  setSetting('ai_simulate_failure', false);
  await c.post('/coach/mensajes', { mensaje: '¿Cómo voy?' });
  assert.equal(h.db.one('SELECT role FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 1', user.id).role, 'coach');
});

test('respaldo y restauración comprobada', () => {
  const backup = require('../src/lib/backup');
  const { DatabaseSync } = require('node:sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dia-uno-respaldo-'));
  const file = backup.create(dir);
  const v = backup.verify(file);
  assert.equal(v.ok, true);
  assert.equal(v.integrity, 'ok');
  assert.deepEqual(v.restored, v.live);
  const target = path.join(dir, 'restaurada.db');
  backup.restore(file, target);
  const restored = new DatabaseSync(target, { readOnly: true });
  assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM users').get().n, h.db.value('SELECT COUNT(*) FROM users'));
  restored.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('los registros operativos no exponen claves ni datos financieros', () => {
  const log = require('../src/lib/log');
  assert.equal(log.scrub('falló con sk-ant-api03-abc_DEF'), 'falló con [clave omitida]');
  assert.equal(log.scrub('secreto whsec_123abc'), 'secreto [secreto omitido]');
  const events = h.db.all('SELECT * FROM analytics_events');
  for (const e of events) assert.deepEqual(Object.keys(e).sort(), ['anon_id', 'created_at', 'dedupe_key', 'id', 'name', 'user_id', 'utm_campaign', 'utm_medium', 'utm_source']);
  const jobErrors = h.db.all('SELECT last_error FROM jobs WHERE last_error IS NOT NULL').map((j) => j.last_error).join(' ');
  assert.doesNotMatch(jobErrors, /\d{4,}\.\d{2}/);
});
