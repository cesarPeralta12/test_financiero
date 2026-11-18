'use strict';
// CV2-601: seguridad y privacidad del Coach v2 — IDOR, CSRF, XSS, límites, privacidad de la IA, exportación y
// eliminación de datos, y el despliegue gradual por bandera.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const entitlements = require('../src/domain/entitlements');
const privacy = require('../src/domain/privacy');
const rollout = require('../src/domain/coach/rollout');
const recurrentes = require('../src/domain/coach/recurrentes');
const plantillas = require('../src/domain/coach/plantillas');
const router = require('../src/domain/coach/ia/router');
const { setSetting } = require('../src/lib/services');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => {
  h.resetRateLimits();
  setSetting('coach_v2_enabled', true);
  setSetting('coach_v2_rollout_pct', 100);
  setSetting('coach_v2_equipo', []);
  setSetting('coach_v2_ia_automatica', false);
});
test.afterEach(() => {
  setSetting('coach_v2_enabled', false);
  setSetting('coach_v2_rollout_pct', 100);
  setSetting('coach_v2_equipo', []);
});

const HOY = new Date().toISOString().slice(0, 10);
let seq = 0;
async function user({ paid = true } = {}) {
  const c = new h.Client();
  const email = `seg${++seq}@ejemplo.test`;
  await h.registerUser(c, email);
  const u = h.db.one('SELECT * FROM users WHERE email = ?', email);
  if (paid) entitlements.grantManual({ userId: u.id, code: 'acompanamiento', days: 30, adminId: null, reason: 'seguridad' });
  await c.get('/');
  return { c, u };
}
async function api(c, method, url, json) {
  const r = await c.req(method, `/api/v1${url}`, method === 'GET' ? {} : { json: json || {} });
  let body = null;
  try {
    body = JSON.parse(r.text);
  } catch {
    /* no JSON */
  }
  return { status: r.status, body, text: r.text };
}
const gasto = (extra = {}) => ({ tipo: 'gasto', categoria: 'alimentacion', importe: '25.00', fecha: HOY, ...extra });

test('IDOR: una cuenta no lee, edita, borra ni restaura movimientos de otra', async () => {
  const A = await user();
  const B = await user();
  const m = (await api(A.c, 'POST', '/movimientos', gasto({ nota: 'privado-de-A' }))).body.movimiento;
  assert.equal((await api(B.c, 'PUT', `/movimientos/${m.id}`, gasto({ importe: '1.00' }))).status, 404);
  assert.equal((await api(B.c, 'DELETE', `/movimientos/${m.id}`)).status, 404);
  assert.equal((await api(B.c, 'POST', `/movimientos/${m.id}/restaurar`)).status, 404);
  const lista = await api(B.c, 'GET', '/movimientos');
  assert.doesNotMatch(lista.text, /privado-de-A/);
  assert.doesNotMatch((await api(B.c, 'GET', '/coach/conversacion')).text, /privado-de-A/);
  assert.equal(h.db.value('SELECT amount FROM movements WHERE id = ?', m.id), '25.00');
});

test('IDOR: botones del Coach, recurrentes y atajos de otra cuenta no hacen nada', async () => {
  const A = await user();
  const B = await user();
  const msg = (await api(A.c, 'POST', '/coach/mensajes', { texto: 'gasté 40 en el super' })).body;
  assert.equal((await api(B.c, 'POST', '/coach/mensajes', { accion: 'confirmar', mensaje_id: msg.id })).body.error.codigo, 'SIN_PROPUESTA');
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', B.u.id), 0);
  const r = recurrentes.crear(A.u.id, { tipo: 'gasto', categoria: 'servicios', monto: '9.00', nota: 'Nube', dia: 3 }, HOY);
  const t = plantillas.crear(A.u.id, { etiqueta: 'Pan', tipo: 'gasto', categoria: 'alimentacion', monto: '2' });
  assert.equal((await B.c.post(`/mi-dinero/atajos/recurrentes/${r.id}/eliminar`, {})).status, 404);
  assert.equal((await B.c.post(`/mi-dinero/atajos/plantillas/${t.id}/usar`, {})).status, 404);
  assert.equal((await B.c.post(`/mi-dinero/atajos/plantillas/${t.id}/eliminar`, {})).status, 404);
  assert.equal(recurrentes.listar(A.u.id).length, 1);
  assert.equal(plantillas.listar(A.u.id).length, 1);
  assert.doesNotMatch((await B.c.get('/mi-dinero/atajos')).text, /Nube|Pan/);
  // El botón de IA sobre un mensaje ajeno tampoco responde ni gasta cupo
  assert.equal(h.db.value("SELECT COUNT(*) FROM ai_runs WHERE user_id = ? AND purpose LIKE 'coach_%'", B.u.id), 0);
});

test('CSRF: las escrituras del Coach y de Mi dinero sin token se rechazan', async () => {
  const { c, u } = await user();
  const token = c.csrf;
  assert.ok(token);
  c.csrf = null; // como una página de otro sitio: no conoce el token
  for (const [ruta, form] of [
    ['/coach/enviar', { texto: 'gasté 5 en pan' }],
    ['/mi-dinero/nuevo', { kindcat: 'gasto:otros', amount: '5', date: HOY }],
    ['/mi-dinero/atajos/plantillas', { label: 'x', kindcat: 'gasto:otros', amount: '1' }],
    ['/mi-dinero/atajos/recurrentes', { note: 'x', kindcat: 'gasto:otros', amount: '1', day: '3' }],
    ['/mi-dinero/atajos/recordatorios', { activos: '1' }],
  ]) {
    const r = await c.req('POST', ruta, { form: { _csrf: 'falso', ...form }, follow: false });
    assert.ok([400, 403].includes(r.status), `${ruta} respondió ${r.status}`);
  }
  c.csrf = null; // las páginas de error vuelven a traer el token válido: se borra antes de probar la API
  const api403 = await c.req('POST', '/api/v1/movimientos', { json: gasto(), headers: { 'x-csrf-token': 'falso' } });
  assert.ok([400, 403].includes(api403.status), `API sin token válido: ${api403.status}`);
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', u.id), 0);
  c.csrf = token;
});

test('XSS: notas y frases con HTML se muestran como texto en todas las pantallas', async () => {
  const { c } = await user();
  const mal = '<img src=x onerror=alert(1)>';
  const m = await api(c, 'POST', '/movimientos', gasto({ nota: mal }));
  assert.equal(m.status, 201);
  await api(c, 'POST', '/coach/mensajes', { texto: `${mal} gasté 10 en pan` });
  await c.post('/coach/enviar', { texto: `<script>alert(2)</script> ${mal}` });
  for (const ruta of ['/mi-dinero', '/mi-dinero/movimientos', '/coach', '/mi-dinero/atajos', '/mi-dinero/nuevo']) {
    const r = await c.get(ruta);
    assert.doesNotMatch(r.text, /<img src=x onerror/i, ruta);
    assert.doesNotMatch(r.text, /<script>alert/i, ruta);
  }
});

test('límites: más de 20 mensajes por minuto se frenan en la API y en la pantalla', async () => {
  const { c } = await user();
  let ultimo = 0;
  for (let i = 0; i < 22; i++) ultimo = (await api(c, 'POST', '/coach/mensajes', { texto: 'resumen del mes' })).status;
  assert.equal(ultimo, 429);
  h.resetRateLimits();
  let web = 0;
  for (let i = 0; i < 22; i++) web = (await c.req('POST', '/coach/enviar', { form: { texto: 'resumen del mes' }, headers: { 'x-fragment': '1' } })).status;
  assert.equal(web, 429);
});

test('acceso: sin acompañamiento ni bandera de registro, el Coach y la API de movimientos no abren', async () => {
  const { c } = await user({ paid: false });
  setSetting('coach_v2_registro_rapido', false);
  assert.ok([402, 403].includes((await api(c, 'POST', '/coach/mensajes', { texto: 'hola' })).status));
  assert.ok([402, 403].includes((await api(c, 'GET', '/movimientos')).status));
  assert.equal(h.db.value('SELECT COUNT(*) FROM messages WHERE role = ?', 'usuario') >= 0, true);
});

test('privacidad de la IA: lo que viaja no lleva correo ni teléfono y los paneles no muestran contenido', async () => {
  const { u } = await user();
  setSetting('coach_v2_ia_automatica', true);
  await router.ejecutar({ userId: u.id, tarea: 'clasificar', texto: 'mi correo es ana@correo.com y mi cel +591 70012345, cuánto gasté', hoy: HOY });
  await router.ejecutar({ userId: u.id, tarea: 'consejo', texto: 'ayúdame', hechos: { saldo: 'USD 10,00', email: 'ana@correo.com', nombre: 'Ana', nota: 'secreto' }, hoy: HOY });
  const entradas = h.db.all("SELECT input_json FROM ai_runs WHERE user_id = ? AND purpose LIKE 'coach_%'", u.id).map((r) => r.input_json).join('\n');
  assert.doesNotMatch(entradas, /ana@correo|70012345|secreto|"Ana"/);
  const admin = new h.Client();
  await h.login(admin, 'admin@diauno.test', 'Prueba-Admin-2026');
  for (const ruta of ['/admin/ia', '/admin/coach']) {
    const r = await admin.get(ruta);
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.text, /ana@correo|70012345|secreto|cuánto gasté/);
  }
  // Un usuario común no entra al panel ni cambia el despliegue
  const { c } = await user();
  assert.ok([302, 303, 403, 404].includes((await c.req('GET', '/admin/coach', { follow: false })).status));
  const intento = await c.req('POST', '/admin/coach/despliegue', { form: { pct: '100', enabled: '1' }, follow: false });
  assert.ok([302, 303, 403, 404].includes(intento.status));
});

test('exportación y eliminación: incluyen y borran todo lo nuevo del Coach', async () => {
  const { c, u } = await user();
  await api(c, 'POST', '/movimientos', gasto({ nota: 'cafe', subcategoria: 'cafe' }));
  await api(c, 'POST', '/coach/mensajes', { texto: 'xyzzy blorp' });
  recurrentes.crear(u.id, { tipo: 'gasto', categoria: 'servicios', monto: '9.00', nota: 'Nube', dia: 3 }, HOY);
  recurrentes.descartar(u.id, 'spotify');
  plantillas.crear(u.id, { etiqueta: 'Pan', tipo: 'gasto', categoria: 'alimentacion', monto: '2' });
  require('../src/domain/coach/pistas').learn(u.id, 'cafe', 'gasto', 'alimentacion', 'cafe');
  require('../src/domain/coach/recordatorios').apagar(u.id, false);
  h.db.run("INSERT INTO coach_reminders (user_id, kind, created_at) VALUES (?, 'registro', ?)", u.id, new Date().toISOString());
  h.db.run("INSERT INTO coach_response_cache (cache_key, user_id, task, response_json, created_at, expires_at) VALUES ('k-seg', ?, 'consejo', '{}', ?, ?)", u.id, new Date().toISOString(), new Date(Date.now() + 1e6).toISOString());

  const x = privacy.exportUser(u.id);
  assert.equal(x.recurrentes.length, 1);
  assert.equal(x.atajos.length, 1);
  assert.equal(x.pistas_de_categoria.length, 1);
  assert.equal(x.preferencias_del_coach.recordatorios, false);
  assert.equal(x.movimientos[0].subcategory, 'cafe');
  assert.ok(x.conversaciones[0].messages.some((m) => m.intent));

  const tablas = ['movements', 'messages', 'recurring_movements', 'recurring_dismissed', 'quick_templates', 'category_hints', 'coach_reminders', 'coach_response_cache', 'insight_dismissals', 'idempotency_keys', 'ai_runs'];
  assert.ok(privacy.deleteUser(u.id, h.db.value("SELECT id FROM users WHERE role = 'admin' LIMIT 1"), 'prueba de eliminación'));
  for (const t of tablas) assert.equal(h.db.value(`SELECT COUNT(*) FROM ${t} WHERE user_id = ?`, u.id), 0, t);
  // La mejora continua nunca guardó quién escribió la frase
  assert.equal(h.db.all('PRAGMA table_info(parser_feedback)').some((col) => /user/.test(col.name)), false);
});

test('despliegue gradual: equipo, porcentaje estable, bandera general y reversa inmediata', async () => {
  const ids = Array.from({ length: 400 }, (_, i) => i + 1);
  setSetting('coach_v2_enabled', true);
  setSetting('coach_v2_rollout_pct', 0);
  assert.equal(ids.filter((id) => rollout.activoPara(id)).length, 0);
  setSetting('coach_v2_equipo', [7, 9]);
  assert.deepEqual(ids.filter((id) => rollout.activoPara(id)), [7, 9], 'el equipo siempre lo ve');
  setSetting('coach_v2_equipo', []);
  setSetting('coach_v2_rollout_pct', 10);
  const diez = ids.filter((id) => rollout.activoPara(id));
  assert.ok(diez.length > 15 && diez.length < 70, `10 % de 400 dio ${diez.length}`);
  setSetting('coach_v2_rollout_pct', 50);
  const cincuenta = ids.filter((id) => rollout.activoPara(id));
  assert.ok(cincuenta.length > 150 && cincuenta.length < 250, `50 % de 400 dio ${cincuenta.length}`);
  assert.ok(diez.every((id) => cincuenta.includes(id)), 'quien ya lo veía lo sigue viendo al subir el porcentaje');
  assert.deepEqual(ids.filter((id) => rollout.activoPara(id)), cincuenta, 'estable entre llamadas');
  setSetting('coach_v2_rollout_pct', 100);
  assert.equal(ids.filter((id) => rollout.activoPara(id)).length, 400);
  setSetting('coach_v2_enabled', false);
  assert.equal(ids.filter((id) => rollout.activoPara(id)).length, 0, 'bandera apagada = Coach anterior para todos');

  // En las rutas: una cuenta fuera del porcentaje recibe el Coach anterior (no el v2)
  const { c, u } = await user();
  setSetting('coach_v2_enabled', true);
  setSetting('coach_v2_rollout_pct', 0);
  assert.equal((await c.req('POST', '/coach/enviar', { form: { texto: 'hola' }, follow: false })).status, 404);
  setSetting('coach_v2_equipo', [u.id]);
  const dentro = await c.req('POST', '/coach/enviar', { form: { texto: 'hola' }, headers: { 'x-fragment': '1' } });
  assert.equal(dentro.status, 200);
});
