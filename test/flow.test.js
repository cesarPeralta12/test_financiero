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
  assert.match(ok.text, /Pregunta 1 de 25/);
  const row = h.db.one("SELECT * FROM consents WHERE kind = 'datos_financieros' ORDER BY id DESC LIMIT 1");
  assert.equal(row.content_version, 1);
  assert.ok(row.accepted_at);
});

async function formOf(c, n) {
  const r = await c.get(`/test/pregunta/${n}`);
  const f = (name) => (r.text.match(new RegExp(`name="${name}" value="([^"]*)"`)) || [])[1];
  return { r, base: { action: 'next', variant_id: f('variant_id'), expected_revision: f('expected_revision'), resolved_context_hash: f('resolved_context_hash') } };
}

test('valida la respuesta y no marca como respondida una pregunta incompleta', async () => {
  const c = new h.Client();
  await h.consent(c);
  await c.get('/test');
  let { base } = await formOf(c, 1);
  const empty = await c.post('/test/pregunta/1', { ...base });
  assert.equal(empty.status, 422);
  const alien = await c.post('/test/pregunta/1', { ...base, value: 'NO_EXISTE' });
  assert.equal(alien.status, 422);
  const s = h.db.one('SELECT * FROM ft_sessions ORDER BY rowid DESC LIMIT 1');
  assert.equal(h.db.value('SELECT COUNT(*) FROM ft_answers WHERE session_id = ?', s.id), 0);
  // «No lo sé» está disponible en todas las preguntas y se guarda como desconocido, no como cero.
  const ok = await c.post('/test/pregunta/1', { ...base, value: 'DK' });
  assert.match(ok.url, /\/test\/pregunta\/2$/);
  const a = h.db.one("SELECT * FROM ft_answers WHERE session_id = ? AND slot_id = 'Q01'", s.id);
  assert.equal(a.response_status, 'unknown');
  assert.equal(a.value_json, null);
  // El formulario caducado (otra pestaña avanzó) no sobrescribe nada.
  ({ base } = await formOf(c, 2));
  await c.post('/test/pregunta/2', { ...base, value: 'SAVING' });
  const stale = await c.post('/test/pregunta/2', { ...base, value: 'SHORTFALL' });
  assert.match(stale.url, /\/test\/pregunta\/3$/);
  assert.equal(h.db.value("SELECT value_json FROM ft_answers WHERE session_id = ? AND slot_id = 'Q02' AND active = 1", s.id), '"SAVING"');
});

test('recorrido gratuito completo, continuidad y vinculación a la cuenta', async () => {
  const c = new h.Client();
  await h.consent(c);
  // Responde las primeras 5 y «recarga» (nuevo GET): retoma donde iba.
  await h.answerFree(c, h.FREE_ANSWERS, { stopAfter: 5 });
  const resume = await c.get('/test');
  assert.match(resume.url, /\/test\/pregunta\/6$/);
  // Botón anterior conserva lo ya respondido.
  const back = await c.post('/test/pregunta/6', { action: 'prev' });
  assert.match(back.url, /\/test\/pregunta\/5$/);
  assert.match(back.text, /value="SALARY_LIMIT"\s+checked/);
  // Termina el cuestionario.
  const end = await h.answerFree(c);
  assert.match(end.url, /\/test\/revision$/);
  assert.match(end.text, /Revisa tus respuestas/);
  const fin = await c.post('/test/finalizar', {});
  assert.match(fin.url, /\/resultado$/);
  for (const t of ['Tu diagnóstico financiero preliminar', 'Tu perfil financiero', 'Prioridad y alcance', 'Tu punto de partida', 'Tu mapa financiero', 'Tus fortalezas', 'Hallazgos principales', 'Tu objetivo', 'Oportunidad para mejorar', 'Tus prioridades', 'Tu hoja de ruta de 90 días', 'Tu primer paso', 'Qué falta y cómo seguir', 'Evaluación profunda', 'Guarda tu resultado']) {
    assert.ok(fin.text.includes(t), `falta la sección «${t}»`);
  }
  assert.match(fin.text, /Ingreso estable y reserva limitada/);
  assert.match(fin.text, /Prepara un listado de tus deudas/);
  assert.doesNotMatch(fin.text, /Mundo 1 completado/);
  // Sin pagar, el resultado sigue disponible.
  assert.equal((await c.get('/resultado')).status, 200);
  // Crea la cuenta: el test anónimo se vincula sin perder respuestas.
  const before = h.db.one('SELECT * FROM ft_sessions WHERE completed_revision IS NOT NULL ORDER BY rowid DESC LIMIT 1');
  assert.equal(before.user_id, null);
  const reg = await h.registerUser(c, 'continuidad@ejemplo.test');
  assert.match(reg.url, /\/resultado\?aviso=cuenta_creada/);
  const after = h.db.one('SELECT * FROM ft_sessions WHERE id = ?', before.id);
  const user = h.db.one("SELECT * FROM users WHERE email = 'continuidad@ejemplo.test'");
  assert.equal(after.user_id, user.id);
  assert.equal(h.db.value('SELECT COUNT(*) FROM ft_answers WHERE session_id = ? AND active = 1', before.id), 25);
  assert.equal(user.base_currency, 'USD');
  // Otro dispositivo: entra con la cuenta y ve su resultado.
  const other = new h.Client();
  await h.login(other, 'continuidad@ejemplo.test', 'Clave-segura-123');
  const res2 = await other.get('/resultado');
  assert.equal(res2.status, 200);
  assert.match(res2.text, /Tu diagnóstico financiero preliminar/);
  // Se envió el correo de verificación.
  assert.ok(h.db.one("SELECT id FROM emails WHERE to_email = 'continuidad@ejemplo.test' AND purpose = 'verificacion'"));
});

test('cambiar una respuesta retira el resultado anterior y pide volver a finalizar', async () => {
  const c = new h.Client();
  await h.consent(c);
  await h.answerFree(c);
  await c.post('/test/finalizar', {});
  // Cambia Q09 de SÍ a NO: Q10 y Q11 cambian de variante y se piden de nuevo.
  const { base } = await formOf(c, 9);
  const r = await c.post('/test/pregunta/9', { ...base, value: 'NO' });
  assert.match(r.url, /\/test\/pregunta\/10$/);
  assert.match(r.text, /Prevés necesitar un préstamo/);
  const stale = await c.get('/resultado');
  assert.match(stale.text, /Retiramos el resultado anterior/);
  const answers = { ...h.FREE_ANSWERS, Q09: 'NO', Q10: 'NO', Q11: 'CURRENT' };
  await h.answerFree(c, answers);
  const fin = await c.post('/test/finalizar', {});
  assert.match(fin.url, /\/resultado$/);
  assert.match(fin.text, /No declaras deudas personales/);
  assert.doesNotMatch(fin.text, /Prepara un listado de tus deudas/);
});

test('ninguna ruta pública permite ver resultados de otra persona', async () => {
  const a = new h.Client();
  await h.consent(a);
  await h.answerFree(a);
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
