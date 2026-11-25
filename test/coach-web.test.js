'use strict';
// Coach v2 · S5: conversación de tarjetas en /coach (servidor), botones y sugerencias como formularios
// que funcionan sin JavaScript, fragmentos para agregar sin recargar y propuestas de tarea con confirmación.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const entitlements = require('../src/domain/entitlements');
const tracker = require('../src/domain/tracker');
const tasks = require('../src/domain/tasks');
const { setSetting } = require('../src/lib/services');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => {
  h.resetRateLimits();
});

let seq = 0;
async function user() {
  const c = new h.Client();
  const email = `coachweb${++seq}@ejemplo.test`;
  await h.registerUser(c, email);
  const u = h.db.one('SELECT * FROM users WHERE email = ?', email);
  entitlements.grantManual({ userId: u.id, code: 'acompanamiento', days: 30, adminId: null, reason: 'prueba del Coach web' });
  await c.get('/');
  return { c, u };
}
const FRAG = { 'x-fragment': '1' };
const enviar = (c, form) => c.req('POST', '/coach/enviar', { form: { ...form }, headers: FRAG, follow: false });
const month = tracker.currentMonth();
const mov = (u, kind, category, amount, extra = {}) => tracker.createMovement(u.id, { kind, category, subcategory: extra.sub || null, date: `${month}-01`, amount: String(amount), currency: 'USD', note: extra.note || null, noteNorm: extra.note || null, debtId: null, goalId: null, toGoalId: null });
const formDe = (html, intent) => [...html.matchAll(/<form class="cv-act"[^>]*>(.*?)<\/form>/gs)].map((m) => m[1]).find((f) => new RegExp(`value="${intent}"`).test(f));

test('hay un solo Coach: sin interruptor ni rutas del anterior', async () => {
  const { c } = await user();
  assert.match((await c.get('/coach')).text, /data-cv/);
  assert.equal((await c.post('/coach/mensajes', { mensaje: 'hola' }, { follow: false })).status, 404);
  const admin = new h.Client();
  await h.login(admin, 'admin@diauno.test', 'Prueba-Admin-2026');
  const p = await admin.get('/admin/coach');
  assert.doesNotMatch(p.text, /Coach v2 abierto|name="pct"|name="equipo"/);
  assert.match(p.text, /name="ia_directa" value="1" checked/);
});

test('página de tarjetas: bienvenida, sugerencias según el contexto y campo accesible', async () => {
  const { c, u } = await user();
  const page = await c.get('/coach');
  assert.equal(page.status, 200);
  assert.match(page.text, /data-cv/);
  assert.match(page.text, /Hola, Prueba\. Soy tu Coach/);
  assert.match(page.text, /role="log"[^>]*aria-live="polite"/, 'la conversación se anuncia a los lectores de pantalla');
  assert.match(page.text, /<label class="visually-hidden" for="cv-msg">Mensaje para el Coach<\/label>/);
  assert.match(page.text, /Anotar mi primer gasto/, 'cuenta nueva: sugiere registrar');
  assert.doesNotMatch(page.text, /Resumen del mes/);
  // Con datos suficientes: sugerencias de consulta; sin registro hace días: registrar primero.
  mov(u, 'ingreso', 'sueldo', 1000);
  for (const n of [100, 80, 60, 40, 20]) mov(u, 'gasto', 'alimentacion', n);
  const con = await c.get('/coach');
  assert.match(con.text, /Resumen del mes/);
  assert.match(con.text, /En qué gasto más/);
  assert.match(con.text, /Qué puedo recortar/);
});

test('un mensaje devuelve un fragmento con tu texto, la tarjeta (origen, texto, tabla) y sugerencias nuevas', async () => {
  const { c, u } = await user();
  mov(u, 'ingreso', 'sueldo', 1000);
  for (const [n, cat] of [[300, 'alimentacion'], [200, 'transporte'], [100, 'ocio'], [50, 'servicios'], [25, 'otros']]) mov(u, 'gasto', cat, n);
  await c.get('/coach');
  const r = await enviar(c, { texto: 'en qué gasto más' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.text, /cv-msg--usuario[^>]*>.*en qué gasto más/s);
  assert.match(r.text, /cv-msg--coach/);
  assert.match(r.text, /Con tus cifras/, 'el origen se dice con texto, no solo con un icono');
  assert.match(r.text, /Tu mayor gasto en .* es Alimentación/);
  assert.match(r.text, /<div class="cv-card"><h4>Gastos por categoría<\/h4><table>/);
  assert.match(r.text, /<figure class="gr gr--barras_categorias">/);
  assert.match(r.text, /data-chips/, 'las sugerencias se renuevan');
  assert.doesNotMatch(r.text, /NaN|undefined/);
  // La tarjeta queda guardada: al recargar /coach vuelve a verse, con sus botones solo en la última.
  const page = await c.get('/coach');
  assert.match(page.text, /en qué gasto más/);
  assert.equal([...page.text.matchAll(/class="cv-actions"/g)].length, 1, 'solo la última respuesta tiene acciones');
  // Un texto escrito por la persona se escapa.
  const xss = await enviar(c, { texto: '<script>alert(1)</script> 250 super' });
  assert.doesNotMatch(xss.text, /<script>alert/);
  assert.match(xss.text, /&lt;script&gt;/);
});

test('sin JavaScript los botones son formularios: registrar, corregir la categoría y confirmar', async () => {
  const { c, u } = await user();
  await c.get('/coach');
  const prev = await enviar(c, { texto: 'cobré 800' });
  assert.match(prev.text, /Falta|categoría|¿En qué categoría|aclar/i);
  assert.match(prev.text, /<details class="cv-fix"><summary>Cambiar categoría<\/summary>/);
  const id = prev.text.match(/name="mensaje_id" value="(\d+)"/)[1];
  // Elegir «Sueldo» = enviar el formulario de esa ficha.
  const fix = await enviar(c, { accion: 'corregir', campo: 'categoria', valor: 'sueldo', mensaje_id: id, etiqueta: 'Sueldo' });
  assert.match(fix.text, /Entendí|ingreso|Sueldo/i);
  assert.match(fix.text, /Confirmar/);
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', u.id), 0, 'nada se guarda sin confirmar');
  const id2 = fix.text.match(/name="mensaje_id" value="(\d+)"/)[1];
  const ok = await enviar(c, { accion: 'confirmar', mensaje_id: id2, etiqueta: 'Confirmar' });
  assert.match(ok.text, /cv-msg--usuario[^>]*>.*Confirmar/s, 'lo que se pulsó aparece como mensaje');
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', u.id), 1);
  assert.equal(h.db.one('SELECT kind, amount, source FROM movements WHERE user_id = ?', u.id).source, 'coach');
  // Confirmar otra vez no duplica y se explica sin romper la página.
  const otra = await enviar(c, { accion: 'confirmar', mensaje_id: id2 });
  assert.match(otra.text, /cv-msg--error/);
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', u.id), 1);
  // Sin fragmento (sin JavaScript) se redirige a la conversación.
  const plano = await c.req('POST', '/coach/enviar', { form: { texto: 'hola' }, follow: false });
  assert.equal(plano.status, 303);
  assert.match(plano.location, /\/coach#cv-fin/);
  const vuelta = await c.get('/coach');
  assert.match(vuelta.text, /Hola/);
});

test('propuestas de tarea: crear desde una observación y completar con confirmación, sin guardar antes', async () => {
  const { c, u } = await user();
  mov(u, 'ingreso', 'sueldo', 2000);
  mov(u, 'gasto', 'vivienda', 800);
  mov(u, 'gasto', 'salud', 300);
  for (const [n, nota] of [[120, 'cine'], [80, 'fiesta'], [60, 'bar']]) mov(u, 'gasto', 'ocio', n, { sub: 'salidas', note: nota });
  await c.get('/coach');
  const rec = await enviar(c, { texto: 'qué puedo recortar' });
  assert.match(rec.text, /Crear tarea/);
  const recId = rec.text.match(/name="mensaje_id" value="(\d+)"/)[1];
  const prop = await enviar(c, { accion: 'proponer_tarea', mensaje_id: recId, etiqueta: 'Crear tarea' });
  assert.match(prop.text, /Te propongo esta tarea|Propuesta de tarea|¿Creo la tarea/);
  assert.match(prop.text, /Probar recortar salidas un 20 %/i);
  assert.equal(h.db.value("SELECT COUNT(*) FROM tasks WHERE user_id = ? AND source = 'coach'", u.id), 0, 'no se crea sin confirmar');
  const propId = prop.text.match(/name="mensaje_id" value="(\d+)"/)[1];
  const hecho = await enviar(c, { accion: 'confirmar', mensaje_id: propId });
  assert.match(hecho.text, /tarea|tablero/i);
  const tarea = h.db.one("SELECT * FROM tasks WHERE user_id = ? AND source = 'coach'", u.id);
  assert.match(tarea.title, /Probar recortar salidas/i);
  // Cancelar no deja nada.
  const rec2 = await enviar(c, { texto: 'qué puedo recortar' });
  const p2 = await enviar(c, { accion: 'proponer_tarea', mensaje_id: rec2.text.match(/name="mensaje_id" value="(\d+)"/)[1] });
  await enviar(c, { accion: 'cancelar', mensaje_id: p2.text.match(/name="mensaje_id" value="(\d+)"/)[1] });
  assert.equal(h.db.value("SELECT COUNT(*) FROM tasks WHERE user_id = ? AND source = 'coach'", u.id), 1);
  // Completar la siguiente tarea pendiente: se propone y recién al confirmar cambia.
  const sig = await enviar(c, { texto: 'ya terminé mi tarea' });
  assert.match(sig.text, new RegExp(tarea.title.slice(0, 20), 'i'));
  assert.equal(h.db.one('SELECT status FROM tasks WHERE id = ?', tarea.id).status, 'pendiente');
  await enviar(c, { accion: 'confirmar', mensaje_id: sig.text.match(/name="mensaje_id" value="(\d+)"/)[1] });
  assert.equal(h.db.one('SELECT status FROM tasks WHERE id = ?', tarea.id).status, 'completada');
  // Sin tareas pendientes no inventa nada.
  const nada = await enviar(c, { texto: 'ya terminé mi tarea' });
  assert.match(nada.text, /no tienes tareas|sin tareas|crear/i);
  // Un botón de «crear tarea» que no corresponde a ninguna observación se rechaza.
  const ayuda = await enviar(c, { texto: 'ayuda' });
  const malo = await enviar(c, { accion: 'proponer_tarea', mensaje_id: ayuda.text.match(/data-id="(\d+)"/)[1] });
  assert.match(malo.text, /cv-msg--error/);
});

test('seguridad: CSRF obligatorio, permiso de acompañamiento y límite por minuto', async () => {
  const { c } = await user();
  await c.get('/coach');
  // Sin el token correcto el envío se rechaza.
  const malo = await c.req('POST', '/coach/enviar', { form: { texto: 'hola', _csrf: 'token-falso' }, headers: FRAG, follow: false });
  assert.equal(malo.status, 403);
  const libre = new h.Client();
  await h.registerUser(libre, `libreweb${++seq}@ejemplo.test`);
  assert.equal((await libre.req('POST', '/coach/enviar', { form: { texto: 'hola' }, headers: FRAG, follow: false })).status, 403);
  let ultimo;
  for (let i = 0; i < 22; i++) ultimo = await enviar(c, { texto: 'hola' });
  assert.equal(ultimo.status, 429);
  assert.match(ultimo.text, /Vas muy rápido/);
});
