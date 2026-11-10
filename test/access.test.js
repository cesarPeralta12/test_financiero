'use strict';
// Criterios «Acceso restringido» y «Privacidad»: una cuenta sin permiso no abre
// evaluación profunda, plan ni coach (ni por URL ni por API); A no accede a B.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const entitlements = require('../src/domain/entitlements');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

async function fullUser(email) {
  const c = new h.Client();
  await h.consent(c);
  await h.answerFree(c);
  await c.post('/test/finalizar', {});
  await h.registerUser(c, email);
  await h.payViaWebhook(c, 'paquete');
  await h.answerAll(c, '/evaluacion', h.DEEP_ANSWERS);
  const rev = await c.get('/evaluacion/revision');
  const acks = [...rev.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]);
  await c.post('/evaluacion/finalizar', { ack: acks });
  await c.post('/plan/generar', { start_date: new Date().toISOString().slice(0, 10) });
  await h.queue.drain({ ignoreSchedule: true });
  await c.get('/coach');
  await c.post('/coach/mensajes', { mensaje: 'gasté 250 en el super' });
  await c.get('/calculadora/movimientos');
  await c.post('/calculadora/movimientos', { date: new Date().toISOString().slice(0, 10), kindcat: 'gasto:alimentacion', amount: '300' });
  await c.post('/calculadora/simulador/guardar', { name: 'Mi escenario', ahorro_extra: '500', cambio_gasto: '0', pago_extra_deuda: '0', ingreso_extra: '0' });
  const user = h.db.one('SELECT * FROM users WHERE email = ?', email);
  return { c, user };
}

test('una cuenta sin permiso no abre evaluación, plan ni coach por URL ni por API', async () => {
  const c = new h.Client();
  await h.registerUser(c, 'sinpermiso@ejemplo.test');
  for (const path of ['/evaluacion', '/evaluacion/pregunta/1', '/evaluacion/revision', '/plan', '/coach', '/calculadora/movimientos', '/calculadora/simulador']) {
    const r = await c.get(path, { follow: false });
    assert.equal(r.status, 403, `${path} debería responder 403`);
  }
  for (const [method, path] of [['GET', '/api/v1/evaluacion-profunda'], ['GET', '/api/v1/planes'], ['GET', '/api/v1/coach/mensajes'], ['POST', '/api/v1/coach/mensajes'], ['POST', '/api/v1/simulador'], ['GET', '/api/v1/movimientos']]) {
    const r = await c.req(method, path, method === 'POST' ? { json: { mensaje: 'hola' } } : {});
    assert.equal(r.status, 403, `${method} ${path} debería responder 403`);
    assert.equal(JSON.parse(r.text).error, 'sin_permiso');
  }
  const posts = await c.post('/coach/mensajes', { mensaje: 'hola' }, { follow: false });
  assert.equal(posts.status, 403);
  const gen = await c.post('/plan/generar', { start_date: '2026-11-07' }, { follow: false });
  assert.equal(gen.status, 403);
  // Sin sesión la API exige autenticación.
  const anon = new h.Client();
  const r = await anon.get('/api/v1/planes');
  assert.equal(r.status, 401);
});

test('un permiso vencido o revocado deja de dar acceso', async () => {
  const c = new h.Client();
  await h.registerUser(c, 'vencido@ejemplo.test');
  const u = h.db.one("SELECT id FROM users WHERE email = 'vencido@ejemplo.test'");
  const admin = h.db.one("SELECT id FROM users WHERE role = 'admin'");
  const eid = entitlements.grantManual({ userId: u.id, code: 'acompanamiento', days: 30, adminId: admin.id, reason: 'Prueba de soporte' });
  assert.equal((await c.get('/coach')).status, 200);
  h.db.run('UPDATE entitlements SET expires_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), eid);
  assert.equal((await c.get('/coach', { follow: false })).status, 403);
  assert.throws(() => entitlements.grantManual({ userId: u.id, code: 'acompanamiento', days: 30, adminId: admin.id, reason: '' }), /motivo/);
  const audit = h.db.one("SELECT * FROM audit_log WHERE action = 'permiso.activacion_manual' AND target_id = ?", String(u.id));
  assert.equal(audit.actor_user_id, admin.id);
  assert.equal(audit.reason, 'Prueba de soporte');
});

test('la persona A no accede a respuestas, planes, archivos ni conversaciones de B', async () => {
  const A = await fullUser('a@ejemplo.test');
  const B = await fullUser('b@ejemplo.test');
  const bDiag = h.db.one('SELECT id FROM diagnoses WHERE user_id = ?', B.user.id);
  const bPlan = h.db.one('SELECT id FROM plan_versions WHERE user_id = ?', B.user.id);
  const bMov = h.db.one('SELECT id FROM movements WHERE user_id = ?', B.user.id);
  const bTask = h.db.one('SELECT id FROM tasks WHERE user_id = ?', B.user.id);
  const bMsg = h.db.one("SELECT id FROM messages WHERE user_id = ? AND proposal_status = 'pendiente'", B.user.id);
  const bMilestone = h.db.one('SELECT id FROM milestones WHERE user_id = ?', B.user.id);

  const gets = [`/diagnostico/${bDiag.id}`, `/plan/version/${bPlan.id}`, `/plan/version/${bPlan.id}/pdf`, `/calculadora/movimientos/${bMov.id}/editar`, `/api/v1/diagnosticos/${bDiag.id}`, `/api/v1/planes/${bPlan.id}`];
  for (const p of gets) {
    const r = await A.c.get(p, { follow: false });
    assert.equal(r.status, 404, `GET ${p} debería ser 404 para A`);
  }
  const posts = [
    `/calculadora/movimientos/${bMov.id}/eliminar`,
    `/tareas/${bTask.id}/completar`,
    `/coach/propuesta/${bMsg.id}/confirmar`,
    `/hitos/${bMilestone.id}/alcanzado`,
    `/plan/${bPlan.id}/dia-uno`,
  ];
  for (const p of posts) {
    const r = await A.c.post(p, { start_date: '2026-11-10' }, { follow: false });
    assert.equal(r.status, 404, `POST ${p} debería ser 404 para A`);
  }
  assert.ok(h.db.one('SELECT id FROM movements WHERE id = ?', bMov.id), 'el movimiento de B sigue existiendo');
  assert.equal(h.db.one('SELECT proposal_status FROM messages WHERE id = ?', bMsg.id).proposal_status, 'pendiente');
  // Las listas de A no incluyen nada de B.
  const coachA = await A.c.get('/api/v1/coach/mensajes');
  assert.ok(JSON.parse(coachA.text).every((m) => !String(m.contenido).includes('b@ejemplo')));
  const mov = JSON.parse((await A.c.get('/api/v1/movimientos')).text);
  assert.ok(mov.movimientos.every((m) => m.user_id === A.user.id));
  const esc = JSON.parse((await A.c.get('/api/v1/escenarios')).text);
  assert.equal(esc.length, 1);
  // Una persona usuaria no entra al panel.
  const adm = await A.c.get('/admin', { follow: false });
  assert.equal(adm.status, 404);
});

test('exportación y eliminación de datos de una cuenta por administración', async () => {
  const X = await fullUser('borrar@ejemplo.test');
  const admin = new h.Client();
  await h.login(admin, 'admin@diauno.test', 'Prueba-Admin-2026');
  await X.c.get('/cuenta');
  await X.c.post('/cuenta/privacidad', { kind: 'eliminar' });
  const base = await h.start();
  const exp = await fetch(`${base}/admin/usuarios/${X.user.id}/exportar`, { headers: { cookie: admin.cookieHeader() } });
  assert.equal(exp.status, 200);
  const data = await exp.json();
  assert.equal(data.cuenta.email, 'borrar@ejemplo.test');
  assert.ok(data.evaluaciones.length >= 1);
  assert.equal(data.tests_gratuitos.length, 1);
  assert.equal(data.tests_gratuitos[0].answers.filter((a) => a.active).length, 25);
  assert.equal(data.tests_gratuitos[0].results[0].resultado.profile.title, 'Ingreso estable y reserva limitada');
  assert.ok(data.conversaciones[0].messages.length >= 2);
  assert.ok(!JSON.stringify(data).includes('password_hash'));
  await admin.get(`/admin/usuarios/${X.user.id}`);
  const wrong = await admin.post(`/admin/usuarios/${X.user.id}/eliminar`, { reason: 'Solicitud del titular', confirm_email: 'otra@x.test' });
  assert.equal(wrong.status, 422);
  await admin.post(`/admin/usuarios/${X.user.id}/eliminar`, { reason: 'Solicitud del titular', confirm_email: 'borrar@ejemplo.test' });
  assert.equal(h.db.one('SELECT id FROM users WHERE id = ?', X.user.id), null);
  for (const t of ['ft_sessions', 'evaluations', 'diagnoses', 'plan_versions', 'tasks', 'movements', 'messages', 'conversations', 'entitlements', 'goals', 'debts']) {
    assert.equal(h.db.value(`SELECT COUNT(*) FROM ${t} WHERE user_id = ?`, X.user.id), 0, `${t} debería quedar vacío`);
  }
  const order = h.db.one("SELECT * FROM orders WHERE product_code = 'paquete' AND user_id IS NULL");
  assert.ok(order, 'la orden se conserva anonimizada');
  assert.ok(h.db.one("SELECT id FROM audit_log WHERE action = 'privacidad.cuenta_eliminada' AND target_id = ?", String(X.user.id)));
  assert.equal(h.db.one('SELECT user_email FROM privacy_requests WHERE user_id IS NULL ORDER BY id DESC LIMIT 1').user_email, 'eliminado');
  // La sesión del usuario eliminado ya no funciona.
  const r = await X.c.get('/inicio', { follow: false });
  assert.equal(r.status, 303);
});
