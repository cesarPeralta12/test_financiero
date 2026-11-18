'use strict';
// Coach v2 · S2: pantalla «Mi dinero» (hub, lista con orden y filtros, registro sin JavaScript,
// línea inteligente) y acceso por bandera (decisión D1).
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const entitlements = require('../src/domain/entitlements');
const tracker = require('../src/domain/tracker');
const { setSetting } = require('../src/lib/services');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());
test.afterEach(() => setSetting('coach_v2_registro_rapido', false));

const TODAY = new Date().toISOString().slice(0, 10);
let seq = 0;

async function user({ paid = true } = {}) {
  const c = new h.Client();
  const email = `dinero${++seq}@ejemplo.test`;
  await h.registerUser(c, email);
  const u = h.db.one('SELECT * FROM users WHERE email = ?', email);
  if (paid) entitlements.grantManual({ userId: u.id, code: 'acompanamiento', days: 30, adminId: null, reason: 'prueba de Mi dinero' });
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
  return { status: r.status, body };
}

const add = (c, extra = {}) => api(c, 'POST', '/movimientos', { tipo: 'gasto', categoria: 'alimentacion', importe: '10.00', fecha: TODAY, ...extra });

test('D1: sin acompañamiento no se entra; con la bandera abierta cualquier cuenta usa Mi dinero y la API', async () => {
  const { c } = await user({ paid: false });
  assert.equal((await c.get('/mi-dinero', { follow: false })).status, 403);
  assert.equal((await api(c, 'GET', '/movimientos')).status, 403);
  assert.equal((await api(c, 'GET', '/resumen')).status, 403);
  assert.doesNotMatch((await c.get('/inicio')).text, /href="\/mi-dinero"/, 'el menú no ofrece lo que no puede usar');
  setSetting('coach_v2_registro_rapido', true);
  const page = await c.get('/mi-dinero');
  assert.equal(page.status, 200);
  assert.match(page.text, /Empieza por tu primer movimiento/);
  assert.match((await c.get('/inicio')).text, /href="\/mi-dinero"/);
  assert.equal((await api(c, 'GET', '/resumen')).status, 200);
  assert.equal((await add(c)).status, 201);
  // La bandera abre el registro y el resumen, no el resto del acompañamiento.
  assert.equal((await c.get('/calculadora/deudas', { follow: false })).status, 403);
  assert.equal((await c.get('/coach', { follow: false })).status, 403);
  // Sin sesión: se pide entrar.
  const anon = new h.Client();
  assert.equal((await anon.get('/mi-dinero', { follow: false })).status, 303);
});

test('hub: totales, ranking por categoría y lista agrupada por día; la nota se escapa', async () => {
  const { c } = await user();
  await add(c, { importe: '120.10', nota: '<b>x</b> súper' });
  await add(c, { categoria: 'transporte', importe: '29.90', nota: 'bus' });
  await api(c, 'POST', '/movimientos', { tipo: 'ingreso', categoria: 'sueldo', importe: '1000.00', fecha: TODAY });
  const r = await c.get('/mi-dinero');
  assert.equal(r.status, 200);
  assert.match(r.text, /data-count="1000\.00"/, 'ingresos');
  assert.match(r.text, /data-count="150\.00"/, 'gastos');
  assert.match(r.text, /data-count="850\.00"/, 'saldo');
  assert.match(r.text, /Gastos por categoría/);
  assert.ok(r.text.indexOf('Alimentación') < r.text.indexOf('Transporte'), 'ranking de mayor a menor');
  assert.match(r.text, /<h3 class="md-day-title">Hoy<\/h3>/);
  assert.match(r.text, /id="md-sheet-tpl"/, 'incluye la hoja de registro para JavaScript');
  assert.match(r.text, /data-config="[^"]*&quot;cur&quot;:&quot;USD&quot;/);
  assert.doesNotMatch(r.text, /<b>x<\/b>/, 'el HTML del usuario no se interpreta');
  assert.match(r.text, /&lt;b&gt;x&lt;\/b&gt;/);
  // Mes sin datos: se puede navegar y no falla.
  assert.equal((await c.get('/mi-dinero?mes=2020-01')).status, 200);
  assert.equal((await c.get('/mi-dinero?mes=basura')).status, 200);
});

test('lista: orden, filtros, búsqueda, chips activos y paginación en el servidor', async () => {
  const { c } = await user();
  await add(c, { importe: '9.00', nota: 'pan' });
  await add(c, { importe: '100.00', nota: 'mercado grande' });
  await add(c, { categoria: 'transporte', importe: '25.00', nota: 'taxi' });
  const text = async (qs) => (await c.get(`/mi-dinero/movimientos${qs}`)).text;
  const order = (html) => [...html.matchAll(/class="md-amt[^"]*">[^<]*?(\d+,\d\d|\d+\.\d\d)/g)].map((m) => m[1]);
  assert.deepEqual(order(await text('?orden=importe_desc')), ['100.00', '25.00', '9.00']);
  assert.deepEqual(order(await text('?orden=importe_asc')), ['9.00', '25.00', '100.00']);
  assert.deepEqual(order(await text('?categoria=transporte')), ['25.00']);
  assert.deepEqual(order(await text('?q=MERCADO')), ['100.00']);
  const filtered = await text('?tipo=gasto&categoria=transporte');
  assert.match(filtered, /class="md-chip-x"/, 'chips de filtros activos con «Quitar»');
  assert.match(filtered, /Limpiar todo/);
  assert.match(filtered, /1 movimiento con estos filtros/);
  assert.match(await text('?q=nadaquecoincida'), /No hay movimientos con estos filtros/);
  assert.match(await text('?orden=date;DROP%20TABLE'), /3 movimientos/, 'orden desconocido: valor por defecto, sin error');
  // Paginación estable.
  for (let i = 0; i < 4; i++) await add(c, { importe: `${50 + i}.00`, nota: `n${i}` });
  const p1 = await text('?limite=3&orden=importe_desc');
  assert.match(p1, /Página 1 de 3/);
  assert.match(p1, /Siguiente ›/);
  assert.doesNotMatch(p1, /‹ Anterior/);
  assert.match(await text('?limite=3&orden=importe_desc&pagina=3'), /‹ Anterior/);
});

test('registrar sin JavaScript: formulario, errores, confirmación de duplicado y aviso', async () => {
  const { c, u } = await user();
  const form = await c.get('/mi-dinero/nuevo');
  assert.equal(form.status, 200);
  assert.match(form.text, /name="kindcat"/);
  const bad = await c.post('/mi-dinero/nuevo', { kindcat: 'gasto:alimentacion', amount: '0', date: TODAY });
  assert.equal(bad.status, 422);
  assert.match(bad.text, /Revisa este dato/);
  const ok = await c.post('/mi-dinero/nuevo', { kindcat: 'gasto:alimentacion', amount: '12,50', date: TODAY, note: 'café' });
  assert.match(ok.url, /\/mi-dinero\?mes=\d{4}-\d{2}&aviso=guardado/);
  assert.match(ok.text, /Guardado\./);
  const dup = await c.post('/mi-dinero/nuevo', { kindcat: 'gasto:alimentacion', amount: '12,50', date: TODAY, note: 'café' });
  assert.equal(dup.status, 422);
  assert.match(dup.text, /Acabas de registrar algo igual/);
  await c.post('/mi-dinero/nuevo', { kindcat: 'gasto:alimentacion', amount: '12,50', date: TODAY, note: 'café', confirmar: '1' });
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', u.id), 2);
  const future = await c.post('/mi-dinero/nuevo', { kindcat: 'gasto:alimentacion', amount: '1', date: '2099-01-01' });
  assert.equal(future.status, 422);
});

test('editar, eliminar, restaurar y repetir el último sin JavaScript', async () => {
  const { c, u } = await user();
  const m = (await add(c, { importe: '30.00', nota: 'taxi' })).body.movimiento;
  const edit = await c.get(`/mi-dinero/movimientos/${m.id}`);
  assert.equal(edit.status, 200);
  assert.match(edit.text, /value="30\.00"|value="30"/);
  const upd = await c.post(`/mi-dinero/movimientos/${m.id}`, { kindcat: 'gasto:transporte', amount: '35.00', date: TODAY, note: 'taxi' });
  assert.match(upd.text, /Guardado\./);
  assert.equal(h.db.one('SELECT category, amount FROM movements WHERE id = ?', m.id).category, 'transporte');
  const rep = await c.post('/mi-dinero/repetir', {});
  assert.match(rep.text, /Repetimos tu último movimiento/);
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ? AND deleted_at IS NULL', u.id), 2);
  const del = await c.post(`/mi-dinero/movimientos/${m.id}/eliminar`, {});
  assert.match(del.text, /Eliminado\./);
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ? AND deleted_at IS NULL', u.id), 1);
  const back = await c.post(`/mi-dinero/movimientos/${m.id}/restaurar`, {});
  assert.match(back.text, /lo recuperamos/);
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ? AND deleted_at IS NULL', u.id), 2);
  // Pasado el plazo no se restaura.
  await c.post(`/mi-dinero/movimientos/${m.id}/eliminar`, {});
  h.db.run('UPDATE movements SET deleted_at = ? WHERE id = ?', new Date(Date.now() - 20_000).toISOString(), m.id);
  assert.match((await c.post(`/mi-dinero/movimientos/${m.id}/restaurar`, {})).text, /Ya pasó el tiempo/);
  // Sin movimientos que repetir.
  const empty = await user();
  assert.match((await empty.c.post('/mi-dinero/repetir', {})).text, /Aún no tienes movimientos que repetir/);
});

test('otra cuenta no ve ni toca movimientos ajenos desde las pantallas', async () => {
  const A = await user();
  const B = await user();
  const m = (await add(B.c, { nota: 'secreto-de-b' })).body.movimiento;
  assert.equal((await A.c.get(`/mi-dinero/movimientos/${m.id}`, { follow: false })).status, 404);
  assert.equal((await A.c.post(`/mi-dinero/movimientos/${m.id}`, { kindcat: 'gasto:otros', amount: '1', date: TODAY }, { follow: false })).status, 404);
  assert.equal((await A.c.post(`/mi-dinero/movimientos/${m.id}/eliminar`, {}, { follow: false })).status, 404);
  assert.doesNotMatch((await A.c.get('/mi-dinero')).text, /secreto-de-b/);
  assert.doesNotMatch((await A.c.get('/mi-dinero/movimientos')).text, /secreto-de-b/);
  assert.equal(h.db.one('SELECT deleted_at FROM movements WHERE id = ?', m.id).deleted_at, null);
});

test('línea inteligente: el servidor entiende el texto con reglas y respeta lo que la persona corrigió', async () => {
  const { c, u } = await user();
  const prev = async (texto) => (await api(c, 'POST', '/movimientos/vista-previa', { texto })).body;
  const a = await prev('250 súper');
  assert.equal(a.registro, true);
  assert.equal(a.completo, true);
  assert.deepEqual([a.vista.tipo, a.vista.importe, a.vista.categoria, a.vista.subcategoria, a.vista.fecha], ['gasto', '250.00', 'alimentacion', 'super', TODAY]);
  assert.match(a.vista.importe_formato, /250/);
  assert.equal(a.movimiento.origen, 'texto');
  const b = await prev('cobré 800');
  assert.equal(b.vista.tipo, 'ingreso');
  assert.equal(b.completo, false);
  assert.deepEqual(b.falta, ['categoria']);
  assert.equal((await prev('hola')).registro, false);
  assert.equal((await prev('')).registro, false);
  // El movimiento propuesto se guarda tal cual por la API normal.
  assert.equal((await api(c, 'POST', '/movimientos', a.movimiento)).status, 201);
  // Aprendizaje: si la persona corrige «gasolina» a otra categoría, la próxima vez se respeta.
  const g = (await add(c, { importe: '40.00', nota: 'gasolina' })).body.movimiento;
  await api(c, 'PUT', `/movimientos/${g.id}`, { categoria: 'otros' });
  const learned = await prev('gasté 30 en gasolina');
  assert.equal(learned.vista.categoria, 'otros');
  assert.ok(h.db.value('SELECT COUNT(*) FROM category_hints WHERE user_id = ?', u.id) >= 1);
});

test('el contrato de la vista previa no llama a ningún modelo de IA', async () => {
  const before = h.db.value('SELECT COUNT(*) FROM ai_runs');
  const { c } = await user();
  await api(c, 'POST', '/movimientos/vista-previa', { texto: 'luz 80' });
  assert.equal(h.db.value('SELECT COUNT(*) FROM ai_runs'), before);
  assert.ok(tracker.UNDO_SECONDS > 0);
});

test('observaciones y análisis: el acompañamiento las ve en el hub; la cuenta gratuita no; descartar sin JavaScript', async () => {
  const month = tracker.currentMonth();
  const paid = await user();
  const mov = (u, kind, category, amount, extra = {}) => tracker.createMovement(u.id, { kind, category, subcategory: null, date: `${month}-01`, amount: String(amount), currency: 'USD', note: extra.note || null, noteNorm: extra.note || null, debtId: null, goalId: null, toGoalId: null });
  mov(paid.u, 'ingreso', 'sueldo', '1000.00');
  for (const n of [300, 200, 100, 50, 25]) mov(paid.u, 'gasto', 'alimentacion', n);
  const hub = await paid.c.get('/mi-dinero');
  assert.match(hub.text, /<h2 id="md-obs-h">Observaciones<\/h2>/);
  assert.match(hub.text, /md-badge md-badge--/, 'cada observación dice su severidad con texto, no solo con color');
  assert.match(hub.text, /Descartar/);
  const analisis = await paid.c.get('/mi-dinero/analisis');
  assert.equal(analisis.status, 200);
  assert.match(analisis.text, /<figure class="gr gr--barras_categorias">/);
  assert.match(analisis.text, /<summary>Ver datos<\/summary>/);
  assert.match(analisis.text, /role="img"/);
  assert.doesNotMatch(analisis.text, /NaN|undefined/);
  // Descartar una observación la saca del hub.
  const id = hub.text.match(/name="id" value="([^"]+)"/)[1];
  const des = await paid.c.post('/mi-dinero/observaciones/descartar', { id });
  assert.match(des.text, /no te lo volveremos a mostrar/);
  assert.ok(!(await paid.c.get('/mi-dinero')).text.includes(`value="${id}"`));
  // Una cuenta gratuita ve el resumen, no el análisis.
  setSetting('coach_v2_registro_rapido', true);
  const free = await user({ paid: false });
  mov(free.u, 'ingreso', 'sueldo', '1000.00');
  for (const n of [300, 200, 100, 50, 25]) mov(free.u, 'gasto', 'alimentacion', n);
  const fh = await free.c.get('/mi-dinero');
  assert.equal(fh.status, 200);
  assert.doesNotMatch(fh.text, /md-obs-h/);
  assert.equal((await free.c.get('/mi-dinero/analisis', { follow: false })).status, 403);
});

test('lista: de 20 en 20 (lo más reciente primero) con «Siguiente» y filtro por rango de fechas', async () => {
  const { c } = await user();
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  for (let i = 0; i < 25; i++) await add(c, { importe: `${10 + i}.00`, nota: `m${i}`, fecha: TODAY });
  const text = async (qs) => (await c.get(`/mi-dinero/movimientos${qs}`)).text;
  const filas = (html) => (html.match(/class="md-amt/g) || []).length;
  const p1 = await text('');
  assert.equal(filas(p1), 20, 'la primera página muestra 20');
  assert.match(p1, /Mostrando 1–20 de 25 movimientos/);
  assert.match(p1, /Página 1 de 2/);
  assert.match(p1, /Siguiente ›/);
  const p2 = await text('?pagina=2');
  assert.equal(filas(p2), 5, 'la segunda trae el resto');
  assert.match(p2, /Mostrando 21–25 de 25 movimientos/);
  assert.match(p2, /‹ Anterior/);
  assert.doesNotMatch(p2, /Siguiente ›/);
  // Rango de fechas: puede cruzar meses y se ve como filtro activo; la paginación lo conserva.
  const viejo = await add(c, { importe: '31.00', nota: 'viejo', fecha: day(45) });
  assert.equal(viejo.status, 201, JSON.stringify(viejo.body));
  const rango = await text(`?desde=${day(60)}&hasta=${day(30)}`);
  assert.equal(filas(rango), 1);
  assert.match(rango, /viejo/);
  assert.match(rango, /Rango de fechas/);
  assert.match(rango, /class="md-chip-x"/);
  assert.match(rango, /name="desde"/);
  const solo = await text(`?desde=${TODAY}`);
  assert.match(solo, /Mostrando 1–20 de 25/, 'desde hoy no incluye el movimiento viejo');
  assert.match(solo, new RegExp(`pagina=2[^"]*desde=${TODAY}|desde=${TODAY}[^"]*pagina=2`), 'el enlace «Siguiente» conserva el rango');
  assert.equal(filas(await text('?desde=basura&hasta=2020-99-99')), 20, 'fechas inválidas se ignoran sin error');
});

test('menú: dentro de Mi dinero se marca la opción de la pantalla actual, no siempre «Resumen»', async () => {
  const { c } = await user();
  const actual = (html) => [...html.matchAll(/<a href="([^"]+)"\s+aria-current="page">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(actual((await c.get('/mi-dinero')).text), ['/mi-dinero']);
  assert.deepEqual(actual((await c.get('/mi-dinero/movimientos')).text), ['/mi-dinero/movimientos']);
  assert.deepEqual(actual((await c.get('/mi-dinero/atajos')).text), ['/mi-dinero/atajos']);
  assert.deepEqual(actual((await c.get('/mi-dinero/analisis')).text), ['/mi-dinero/analisis']);
});
