'use strict';
// F12 Panel administrativo: versiones de cuestionarios y reglas que no modifican
// evaluaciones terminadas, embudo, productos y que todas las pantallas rendericen.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

let admin;
let userClient;

test('preparación', async () => {
  admin = new h.Client();
  await h.login(admin, 'admin@diauno.test', 'Prueba-Admin-2026');
  userClient = new h.Client();
  await h.consent(userClient);
  await userClient.get('/?utm_source=instagram&utm_campaign=lanzamiento');
  await h.answerAll(userClient, '/test', h.FREE_ANSWERS);
  await userClient.post('/test/finalizar', {});
  await h.registerUser(userClient, 'panel@ejemplo.test');
  await h.payViaWebhook(userClient, 'paquete');
  await h.answerAll(userClient, '/evaluacion', h.DEEP_ANSWERS);
  const rev = await userClient.get('/evaluacion/revision');
  await userClient.post('/evaluacion/finalizar', { ack: [...rev.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]) });
  await userClient.post('/plan/generar', { start_date: new Date().toISOString().slice(0, 10) });
  await h.queue.drain({ ignoreSchedule: true });
});

test('todas las pantallas del panel renderizan y muestran el embudo', async () => {
  const pages = ['/admin', '/admin/?periodo=7', '/admin/usuarios', '/admin/usuarios?q=panel', '/admin/ordenes', '/admin/ordenes?estado=pagada', '/admin/fallos', '/admin/ia', '/admin/cuestionarios', '/admin/reglas', '/admin/textos', '/admin/textos/consentimiento', '/admin/productos', '/admin/ajustes', '/admin/privacidad', '/admin/respaldos', '/admin/auditoria', '/admin/correos'];
  for (const p of pages) {
    const r = await admin.get(p);
    assert.equal(r.status, 200, `${p} respondió ${r.status}`);
  }
  const home = await admin.get('/admin');
  for (const s of ['Visitas', 'Inicio de test', 'Fin de test', 'Registro', 'Inicio de pago', 'Pago confirmado', 'Evaluación completada', 'Plan generado', 'Primera tarea completada']) assert.ok(home.text.includes(s), `falta la etapa ${s}`);
  assert.match(home.text, /instagram/);
  const u = h.db.one("SELECT id FROM users WHERE email = 'panel@ejemplo.test'");
  const detail = await admin.get(`/admin/usuarios/${u.id}`);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Terminado/);
  assert.doesNotMatch(detail.text, /30000|30,000|Fondo de estudios/, 'el panel no muestra respuestas financieras');
  const o = h.db.one('SELECT id FROM orders LIMIT 1');
  assert.equal((await admin.get(`/admin/ordenes/${o.id}`)).status, 200);
  const qn = h.db.one('SELECT id FROM questionnaires LIMIT 1');
  assert.equal((await admin.get(`/admin/cuestionarios/${qn.id}`)).status, 200);
});

test('una versión nueva del cuestionario no modifica evaluaciones terminadas', async () => {
  const finished = h.db.one("SELECT * FROM evaluations WHERE kind = 'gratuito' AND status = 'finalizada' LIMIT 1");
  const oldQ = h.db.one('SELECT * FROM questions WHERE questionnaire_id = ? AND position = 1', finished.questionnaire_id);
  await admin.get('/admin/cuestionarios');
  await admin.post('/admin/cuestionarios/gratuito/borrador', {});
  const draft = h.db.one("SELECT * FROM questionnaires WHERE kind = 'gratuito' AND status = 'borrador'");
  assert.equal(draft.version, 3);
  const q = h.db.one('SELECT * FROM questions WHERE questionnaire_id = ? AND position = 1', draft.id);
  await admin.post(`/admin/cuestionarios/${draft.id}/preguntas/${q.id}`, { prompt: '¿Con qué moneda trabajas?', help: 'Texto nuevo', required: '1' });
  // No se pueden cambiar los valores de las opciones (los usa el motor).
  const q2 = h.db.one("SELECT * FROM questions WHERE questionnaire_id = ? AND code = 'fuente_ingreso'", draft.id);
  const bad = await admin.post(`/admin/cuestionarios/${draft.id}/preguntas/${q2.id}`, { prompt: q2.prompt, options: 'otro|Otro', required: '1' });
  assert.equal(bad.status, 422);
  await admin.post(`/admin/cuestionarios/${draft.id}/publicar`, {});
  assert.equal(h.db.one('SELECT status FROM questionnaires WHERE id = ?', draft.id).status, 'publicado');
  assert.equal(h.db.one('SELECT status FROM questionnaires WHERE id = ?', finished.questionnaire_id).status, 'retirado');
  // La evaluación terminada sigue con su versión y su texto original.
  assert.equal(h.db.one('SELECT questionnaire_id FROM evaluations WHERE id = ?', finished.id).questionnaire_id, finished.questionnaire_id);
  assert.equal(h.db.one('SELECT prompt FROM questions WHERE id = ?', oldQ.id).prompt, oldQ.prompt);
  // Un test nuevo usa la versión publicada.
  const c = new h.Client();
  await h.consent(c);
  const r = await c.get('/test');
  assert.match(r.text, /¿Con qué moneda trabajas\?/);
  assert.ok(h.db.one('SELECT id FROM audit_log WHERE action = ?', 'cuestionario.publicado'));
});

test('reglas: se validan, se versionan y los diagnósticos guardan su versión', async () => {
  await admin.post('/admin/reglas/borrador', {});
  const draft = h.db.one("SELECT * FROM rule_sets WHERE status = 'borrador'");
  const rules = JSON.parse(draft.rules_json);
  rules.asignacion.equilibrio.metas = 0.9; // ya no suma 1
  const bad = await admin.post(`/admin/reglas/${draft.id}`, { rules: JSON.stringify(rules), notes: 'x' });
  assert.equal(bad.status, 422);
  assert.match(bad.text, /debe sumar 1/);
  rules.asignacion.equilibrio.metas = 0.4;
  rules.reserva_meses.recomendada = 4;
  await admin.post(`/admin/reglas/${draft.id}`, { rules: JSON.stringify(rules), notes: 'Reserva de 4 meses' });
  await admin.post(`/admin/reglas/${draft.id}/publicar`, {});
  const prevDiag = h.db.one('SELECT * FROM diagnoses ORDER BY id LIMIT 1');
  assert.notEqual(prevDiag.rule_set_id, draft.id, 'el diagnóstico anterior conserva su versión de reglas');
  assert.equal(require('../src/domain/rules').current().rules.reserva_meses.recomendada, 4);
});

test('productos: cambiar precio y duración se refleja antes de pagar y queda auditado', async () => {
  const p = h.db.one("SELECT * FROM products WHERE code = 'evaluacion'");
  await admin.get('/admin/productos');
  await admin.post(`/admin/productos/${p.id}`, { name: p.name, summary: p.summary, price: '24.50', currency: 'USD', days_evaluacion_profunda: '180', gateway_ref: 'prod_123', conditions: p.conditions, active: '1' });
  const updated = h.db.one('SELECT * FROM products WHERE id = ?', p.id);
  assert.equal(updated.price_cents, 2450);
  assert.equal(JSON.parse(updated.grants_json)[0].days, 180);
  const c = new h.Client();
  await h.registerUser(c, 'precio@ejemplo.test');
  const r = await c.get('/comprar/evaluacion');
  assert.match(r.text, /24\.50/);
  assert.match(r.text, /6 meses/);
  assert.ok(h.db.one("SELECT id FROM audit_log WHERE action = 'producto.actualizado'"));
});

test('textos: publicar un consentimiento nuevo pide consentir otra vez', async () => {
  await admin.get('/admin/textos/consentimiento');
  await admin.post('/admin/textos/consentimiento', { title: 'Antes de empezar', body: 'Texto actualizado del consentimiento.' });
  await admin.post('/admin/textos/consentimiento/publicar', {});
  const c = new h.Client();
  await h.consent(c);
  const row = h.db.one("SELECT content_version FROM consents ORDER BY id DESC LIMIT 1");
  assert.equal(row.content_version, 2);
  const old = new h.Client();
  // Una sesión que consintió la versión 1 debe volver a consentir.
  const prev = h.db.one('SELECT anon_id FROM consents WHERE content_version = 1 AND anon_id IS NOT NULL LIMIT 1');
  if (prev) assert.equal(require('../src/domain/consent').has({ anonId: prev.anon_id }), false);
  void old;
});

test('respaldo manual desde el panel con verificación', async () => {
  const config = require('../src/config');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const prev = config.backupDir;
  config.backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dia-uno-panel-'));
  try {
    await admin.get('/admin/respaldos');
    const r = await admin.post('/admin/respaldos', {});
    assert.match(r.url, /verificacion=ok/);
    assert.match(r.text, /restauración comprobada/);
  } finally {
    fs.rmSync(config.backupDir, { recursive: true, force: true });
    config.backupDir = prev;
  }
});
