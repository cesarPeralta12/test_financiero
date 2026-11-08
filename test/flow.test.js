'use strict';
// Criterio «Gratis y continuidad»: completar 25 preguntas sin pago, ver la orientación
// y conservar las respuestas al recargar, volver atrás y crear la cuenta.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

test('el test exige consentimiento antes de guardar datos financieros', async () => {
  const c = new h.Client();
  const r = await c.get('/test');
  assert.match(r.url, /\/consentimiento/);
  const bad = await c.post('/consentimiento', {});
  assert.equal(bad.status, 422);
  await h.consent(c);
  const ok = await c.get('/test');
  assert.match(ok.url, /\/test\/pregunta\/1$/);
  const row = h.db.one("SELECT * FROM consents WHERE kind = 'datos_financieros' ORDER BY id DESC LIMIT 1");
  assert.equal(row.content_version, 1);
  assert.ok(row.accepted_at);
});

test('valida el tipo de respuesta y no marca como respondida una pregunta incompleta', async () => {
  const c = new h.Client();
  await h.consent(c);
  await c.get('/test');
  await c.post('/test/pregunta/1', { action: 'next', value: 'MXN' });
  await c.post('/test/pregunta/2', { action: 'next', value: 'empleo' });
  const r = await c.post('/test/pregunta/3', { action: 'next', amount: 'abc', period: 'mensual' });
  assert.equal(r.status, 422);
  assert.match(r.text, /Escribe solo números/);
  const empty = await c.post('/test/pregunta/3', { action: 'next', amount: '', period: 'mensual' });
  assert.equal(empty.status, 422);
  const ev = h.db.one("SELECT id FROM evaluations WHERE kind = 'gratuito' ORDER BY id DESC LIMIT 1");
  assert.equal(h.db.value('SELECT COUNT(*) FROM answers WHERE evaluation_id = ? AND code = ?', ev.id, 'ingreso_mensual'), 0);
  // «No lo sé» solo donde está previsto: la pregunta 2 no lo admite.
  const notAllowed = await c.post('/test/pregunta/2', { action: 'next', unknown: '1' });
  assert.equal(notAllowed.status, 422);
  // En la 3 sí, y se guarda como desconocido (no como cero).
  await c.post('/test/pregunta/3', { action: 'next', unknown: '1', amount: '', period: 'mensual' });
  const a = h.db.one('SELECT * FROM answers WHERE evaluation_id = ? AND code = ?', ev.id, 'ingreso_mensual');
  assert.equal(a.is_unknown, 1);
  assert.equal(a.value_json, null);
});

test('recorrido gratuito completo, continuidad y vinculación a la cuenta', async () => {
  const c = new h.Client();
  await h.consent(c);
  // Responde las primeras 5 y «recarga» (nuevo GET): retoma donde iba.
  await c.get('/test');
  const codes = Object.keys(h.FREE_ANSWERS);
  for (let i = 0; i < 5; i++) await c.post(`/test/pregunta/${i + 1}`, { action: 'next', ...h.FREE_ANSWERS[codes[i]] });
  const resume = await c.get('/test');
  assert.match(resume.url, /\/test\/pregunta\/6$/);
  // Botón anterior conserva lo ya respondido.
  const back = await c.post('/test/pregunta/6', { action: 'prev' });
  assert.match(back.url, /\/test\/pregunta\/5$/);
  assert.match(back.text, /value="fijo"\s+checked/);
  // Termina el cuestionario.
  const end = await h.answerAll(c, '/test', h.FREE_ANSWERS);
  assert.match(end.url, /\/test\/revision$/);
  assert.match(end.text, /Revisa tus respuestas/);
  // Corrige una respuesta antes de finalizar.
  await c.post('/test/pregunta/15?volver=revision', { action: 'next', amount: '9000' });
  const fin = await c.post('/test/finalizar', {});
  assert.match(fin.url, /\/resultado$/);
  assert.match(fin.text, /Orientación preliminar/);
  assert.match(fin.text, /Fortalezas/);
  assert.match(fin.text, /Riesgos/);
  assert.match(fin.text, /Prioridades/);
  assert.match(fin.text, /Para empezar/);
  assert.match(fin.text, /Evaluación profunda/);
  assert.doesNotMatch(fin.text, /Plan de 90 días<\/h2>/, 'el resultado gratuito no muestra proyecciones del plan');
  // Sin pagar, el resultado sigue disponible.
  const again = await c.get('/resultado');
  assert.equal(again.status, 200);
  // Crea la cuenta: el test anónimo se vincula sin perder respuestas.
  const evBefore = h.db.one("SELECT * FROM evaluations WHERE kind = 'gratuito' AND status = 'finalizada' ORDER BY id DESC LIMIT 1");
  assert.equal(evBefore.user_id, null);
  const reg = await h.registerUser(c, 'continuidad@ejemplo.test');
  assert.match(reg.url, /\/resultado\?aviso=cuenta_creada/);
  const evAfter = h.db.one('SELECT * FROM evaluations WHERE id = ?', evBefore.id);
  const user = h.db.one("SELECT * FROM users WHERE email = 'continuidad@ejemplo.test'");
  assert.equal(evAfter.user_id, user.id);
  assert.equal(h.db.value('SELECT COUNT(*) FROM answers WHERE evaluation_id = ?', evBefore.id), 25);
  assert.equal(user.base_currency, 'MXN');
  // Otro dispositivo: entra con la cuenta y ve su resultado.
  const other = new h.Client();
  await h.login(other, 'continuidad@ejemplo.test', 'Clave-segura-123');
  const res2 = await other.get('/resultado');
  assert.equal(res2.status, 200);
  assert.match(res2.text, /Tu orientación/);
  // Se envió el correo de verificación.
  assert.ok(h.db.one("SELECT id FROM emails WHERE to_email = 'continuidad@ejemplo.test' AND purpose = 'verificacion'"));
});

test('las preguntas condicionales se omiten y no cuentan', async () => {
  const c = new h.Client();
  await h.consent(c);
  const answers = { ...h.FREE_ANSWERS, tiene_deudas: { value: 'no' } };
  const end = await h.answerAll(c, '/test', answers);
  assert.match(end.url, /\/revision$/);
  assert.match(end.text, /No aplica/);
  const fin = await c.post('/test/finalizar', {});
  assert.match(fin.text, /No tienes deudas/);
});

test('ninguna ruta pública permite ver resultados de otra persona', async () => {
  const a = new h.Client();
  await h.consent(a);
  await h.answerAll(a, '/test', h.FREE_ANSWERS);
  await a.post('/test/finalizar', {});
  const b = new h.Client();
  const r = await b.get('/resultado');
  assert.doesNotMatch(r.url, /\/resultado$/);
  // Tras cerrar sesión, el navegador compartido no conserva el resultado.
  await h.registerUser(a, 'compartido@ejemplo.test');
  await a.post('/salir', {});
  const after = await a.get('/resultado');
  assert.doesNotMatch(after.url, /\/resultado$/);
});

test('recuperación de contraseña de un solo uso', async () => {
  const c = new h.Client();
  await h.registerUser(c, 'recuperar@ejemplo.test');
  await c.post('/salir', {});
  await c.get('/recuperar');
  await c.post('/recuperar', { email: 'recuperar@ejemplo.test' });
  await h.queue.drain({ ignoreSchedule: true });
  const mail = h.db.one("SELECT * FROM emails WHERE to_email = 'recuperar@ejemplo.test' AND purpose = 'recuperacion'");
  assert.equal(mail.status, 'enviado');
  const link = mail.body_text.match(/\/restablecer\/[A-Za-z0-9_-]+/)[0];
  await c.get(link);
  const r = await c.post(link, { password: 'Nueva-clave-456' });
  assert.match(r.url, /\/entrar\?aviso=clave_cambiada/);
  const reuse = await c.get(link);
  assert.match(reuse.url, /enlace_invalido/);
  const ok = await h.login(c, 'recuperar@ejemplo.test', 'Nueva-clave-456');
  assert.match(ok.url, /\/inicio/);
  const bad = await h.login(new h.Client(), 'recuperar@ejemplo.test', 'Clave-segura-123');
  assert.equal(bad.status, 422);
});

test('las sesiones anónimas no vinculadas se eliminan a los 30 días', async () => {
  const c = new h.Client();
  await h.consent(c);
  await c.get('/test');
  await c.post('/test/pregunta/1', { action: 'next', value: 'MXN' });
  const anon = h.db.one('SELECT id FROM anonymous_sessions WHERE linked_user_id IS NULL ORDER BY created_at DESC LIMIT 1');
  h.db.run('UPDATE anonymous_sessions SET last_seen_at = ? WHERE id = ?', new Date(Date.now() - 31 * 86400000).toISOString(), anon.id);
  const { purgeAnonymous } = require('../src/jobs');
  assert.ok(purgeAnonymous() >= 1);
  assert.equal(h.db.value('SELECT COUNT(*) FROM evaluations WHERE anon_id = ?', anon.id), 0);
});
