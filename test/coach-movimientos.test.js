'use strict';
// Coach v2 · S1: API de movimientos, resumen, borrado suave y migraciones 005/006.
// Casos R1–R12 de docs/coach-v2/10-pruebas-y-calidad.md (registro) y órdenes O1–O7 de 08 (§3).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const h = require('./helpers');
const entitlements = require('../src/domain/entitlements');
const tracker = require('../src/domain/tracker');
const jobs = require('../src/jobs');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

const TODAY = new Date().toISOString().slice(0, 10);
let seq = 0;

async function user(email = `coach${++seq}@ejemplo.test`) {
  const c = new h.Client();
  await h.registerUser(c, email);
  const u = h.db.one('SELECT * FROM users WHERE email = ?', email);
  entitlements.grantManual({ userId: u.id, code: 'acompanamiento', days: 30, adminId: null, reason: 'prueba de la API' });
  await c.get('/');
  return { c, u };
}

async function api(c, method, url, json) {
  // Las escrituras llevan el token CSRF en la cabecera, incluso sin cuerpo (como hace el navegador).
  const r = await c.req(method, `/api/v1${url}`, method === 'GET' ? {} : { json: json || {} });
  let body = null;
  try {
    body = JSON.parse(r.text);
  } catch {
    /* no JSON */
  }
  return { status: r.status, body, headers: r.headers };
}

const gasto = (extra = {}) => ({ tipo: 'gasto', categoria: 'alimentacion', importe: '250.00', fecha: TODAY, ...extra });

test('R1: registrar un gasto devuelve el movimiento, el resumen y el plazo para deshacer', async () => {
  const { c } = await user();
  const r = await api(c, 'POST', '/movimientos', gasto({ subcategoria: 'super', nota: 'Súper', origen: 'texto' }));
  assert.equal(r.status, 201);
  assert.equal(r.body.movimiento.importe, '250.00');
  assert.equal(r.body.movimiento.subcategoria, 'super');
  assert.equal(r.body.movimiento.origen, 'texto');
  assert.equal(r.body.resumen.gasto, '250.00');
  assert.equal(r.body.resumen.saldo, '-250.00');
  assert.ok(Date.parse(r.body.deshacer_hasta) > Date.now());
  const row = h.db.one('SELECT note_norm, amount_cents FROM movements WHERE id = ?', r.body.movimiento.id);
  assert.equal(row.note_norm, 'super', 'la nota se guarda normalizada (sin tildes ni mayúsculas)');
  assert.equal(row.amount_cents, 25000);
});

test('R2/R12: la misma clave de idempotencia no duplica; con otro contenido es un conflicto', async () => {
  const { c, u } = await user();
  const key = 'web-3f9c1b2a-7e01';
  const a = await api(c, 'POST', '/movimientos', { ...gasto(), idempotency_key: key });
  const b = await api(c, 'POST', '/movimientos', { ...gasto(), idempotency_key: key });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.headers.get('idempotent-replayed'), 'true');
  assert.equal(b.body.movimiento.id, a.body.movimiento.id);
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', u.id), 1);
  const c2 = await api(c, 'POST', '/movimientos', { ...gasto({ importe: '99.00' }), idempotency_key: key });
  assert.equal(c2.status, 409);
  assert.equal(c2.body.error.codigo, 'IDEMPOTENCIA_CONFLICTO');
  const bad = await api(c, 'POST', '/movimientos', { ...gasto(), idempotency_key: 'x' });
  assert.equal(bad.status, 422);
});

test('R3/R4/R5: importes, fechas y moneda inválidos no se guardan y dan un código estable', async () => {
  const { c, u } = await user();
  for (const importe of ['0', '-5', '12.34567', 'abc', '']) {
    const r = await api(c, 'POST', '/movimientos', gasto({ importe }));
    assert.equal(r.status, 422, `importe ${JSON.stringify(importe)}`);
    assert.equal(r.body.error.codigo, 'IMPORTE_INVALIDO');
    assert.equal(r.body.error.campo, 'importe');
  }
  for (const fecha of ['2026-02-31', 'ayer', '2099-01-01']) {
    const r = await api(c, 'POST', '/movimientos', gasto({ fecha }));
    assert.equal(r.status, 422, `fecha ${fecha}`);
    assert.equal(r.body.error.codigo, 'FECHA_INVALIDA');
  }
  assert.equal((await api(c, 'POST', '/movimientos', gasto({ moneda: 'EUR' }))).body.error.codigo, 'MONEDA_DISTINTA');
  assert.equal((await api(c, 'POST', '/movimientos', gasto({ categoria: 'inventada' }))).body.error.codigo, 'CATEGORIA_INVALIDA');
  assert.equal((await api(c, 'POST', '/movimientos', gasto({ subcategoria: 'taxi_app' }))).body.error.codigo, 'CATEGORIA_INVALIDA');
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', u.id), 0);
});

test('R6: un gasto ≥ 5 veces la mediana pide confirmación', async () => {
  const { c } = await user();
  for (const n of [10, 11, 12, 13, 14, 15]) assert.equal((await api(c, 'POST', '/movimientos', gasto({ importe: `${n}.00` }))).status, 201);
  const big = await api(c, 'POST', '/movimientos', gasto({ importe: '200.00' }));
  assert.equal(big.status, 422);
  assert.equal(big.body.error.codigo, 'IMPORTE_ALTO_REQUIERE_CONFIRMAR');
  const ok = await api(c, 'POST', '/movimientos', gasto({ importe: '200.00', confirmar_importe_alto: true }));
  assert.equal(ok.status, 201);
});

test('R7: mismo importe, categoría y nota en pocos minutos pide confirmar el duplicado', async () => {
  const { c, u } = await user();
  const first = await api(c, 'POST', '/movimientos', gasto({ importe: '5.00', nota: 'café' }));
  const dup = await api(c, 'POST', '/movimientos', gasto({ importe: '5.00', nota: 'Café' }));
  assert.equal(dup.status, 422);
  assert.equal(dup.body.error.codigo, 'DUPLICADO_POSIBLE');
  assert.equal(dup.body.error.duplicado_id, first.body.movimiento.id);
  assert.equal((await api(c, 'POST', '/movimientos', gasto({ importe: '5.00', nota: 'café', confirmar_duplicado: true }))).status, 201);
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', u.id), 2);
});

test('R8: editar la categoría recalcula los totales y enseña la pista de esa nota', async () => {
  const { c, u } = await user();
  const m = await api(c, 'POST', '/movimientos', gasto({ importe: '30.00', nota: 'Gasolina' }));
  const id = m.body.movimiento.id;
  const e = await api(c, 'PUT', `/movimientos/${id}`, { categoria: 'transporte', subcategoria: 'combustible' });
  assert.equal(e.status, 200);
  assert.equal(e.body.movimiento.categoria, 'transporte');
  assert.equal(e.body.movimiento.importe, '30.00', 'lo que no se envía no cambia');
  const s = (await api(c, 'GET', '/resumen')).body;
  assert.deepEqual(s.por_categoria.map((x) => x.categoria), ['transporte']);
  const hint = h.db.one('SELECT * FROM category_hints WHERE user_id = ?', u.id);
  assert.equal(hint.term, 'gasolina');
  assert.equal(hint.category, 'transporte');
  assert.equal(hint.subcategory, 'combustible');
  // Cambiar el tipo sin una categoría de ese tipo no se adivina.
  const bad = await api(c, 'PUT', `/movimientos/${id}`, { tipo: 'ingreso' });
  assert.equal(bad.status, 422);
});

test('R9: eliminar y deshacer dentro del plazo; pasado el plazo falla; el borrado definitivo llega a los 7 días', async () => {
  const { c, u } = await user();
  const m = await api(c, 'POST', '/movimientos', gasto({ importe: '40.00' }));
  const id = m.body.movimiento.id;
  const del = await api(c, 'DELETE', `/movimientos/${id}`);
  assert.equal(del.status, 200);
  assert.ok(del.body.deshacer_hasta);
  assert.equal((await api(c, 'GET', '/resumen')).body.gasto, '0.00', 'lo borrado no suma');
  assert.equal((await api(c, 'GET', '/movimientos')).body.total, 0);
  const back = await api(c, 'POST', `/movimientos/${id}/restaurar`);
  assert.equal(back.status, 200);
  assert.equal(back.body.resumen.gasto, '40.00');
  await api(c, 'DELETE', `/movimientos/${id}`);
  h.db.run('UPDATE movements SET deleted_at = ? WHERE id = ?', new Date(Date.now() - 10_000).toISOString(), id);
  const late = await api(c, 'POST', `/movimientos/${id}/restaurar`);
  assert.equal(late.status, 409);
  assert.equal(late.body.error.codigo, 'PLAZO_VENCIDO');
  assert.equal((await api(c, 'DELETE', `/movimientos/${id}`)).status, 404, 'ya borrado');
  // Purga diaria: a los 7 días se elimina de verdad; claves de idempotencia de más de 24 h también.
  h.db.run('UPDATE movements SET deleted_at = ? WHERE id = ?', new Date(Date.now() - 8 * 86400000).toISOString(), id);
  h.db.run("INSERT INTO idempotency_keys (user_id, key, request_hash, status, response_json, created_at) VALUES (?, 'vieja-clave-1', 'h', 201, '{}', ?)", u.id, new Date(Date.now() - 2 * 86400000).toISOString());
  const purged = jobs.purgeCoach();
  assert.equal(purged.movements, 1);
  assert.equal(purged.keys, 1);
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE id = ?', id), 0);
});

test('R10/R11: una cuenta no toca movimientos de otra y el texto del usuario es solo dato', async () => {
  const A = await user();
  const B = await user();
  const m = await api(B.c, 'POST', '/movimientos', gasto({ nota: '<script>alert(1)</script>' }));
  const id = m.body.movimiento.id;
  for (const [method, url, body] of [['PUT', `/movimientos/${id}`, { importe: '1.00' }], ['DELETE', `/movimientos/${id}`], ['POST', `/movimientos/${id}/restaurar`]]) {
    const r = await api(A.c, method, url, body);
    assert.equal(r.status, 404, `${method} ${url}`);
    assert.equal(r.body.error.codigo, 'NO_ENCONTRADO');
  }
  assert.equal((await api(A.c, 'GET', '/movimientos')).body.total, 0);
  assert.equal(h.db.one('SELECT amount FROM movements WHERE id = ?', id).amount, '250.00', 'el movimiento de B no cambió');
  // La nota se devuelve tal cual como JSON (no se interpreta) y se escapa al pintar en HTML.
  assert.equal(m.body.movimiento.nota, '<script>alert(1)</script>');
  assert.match(m.headers.get('content-type'), /application\/json/);
  const page = await B.c.get('/calculadora/movimientos');
  assert.doesNotMatch(page.text, /<script>alert\(1\)<\/script>/);
});

test('orden, filtros y búsqueda: lista blanca, importes en orden numérico y desempates estables', async () => {
  const { c } = await user();
  const add = (importe, extra = {}) => api(c, 'POST', '/movimientos', gasto({ importe, ...extra }));
  await add('9.00', { nota: 'pan' });
  await add('100.00', { nota: 'mercado', fecha: TODAY });
  await add('25.00', { categoria: 'transporte', subcategoria: 'taxi_app', nota: 'taxi al centro' });
  await api(c, 'POST', '/movimientos', { tipo: 'ingreso', categoria: 'sueldo', importe: '500.00', fecha: TODAY });
  const importes = async (qs) => (await api(c, 'GET', `/movimientos?${qs}`)).body.items.map((x) => x.importe);
  assert.deepEqual(await importes('orden=importe_desc'), ['500.00', '100.00', '25.00', '9.00'], 'numérico, no por texto');
  assert.deepEqual(await importes('orden=importe_asc'), ['9.00', '25.00', '100.00', '500.00']);
  assert.deepEqual(await importes('orden=importe_desc&tipo=gasto'), ['100.00', '25.00', '9.00']);
  assert.deepEqual(await importes('orden=importe_desc&categoria=transporte'), ['25.00']);
  assert.deepEqual(await importes('orden=importe_desc&sub=taxi_app'), ['25.00']);
  assert.deepEqual(await importes('orden=importe_desc&q=Mercado'), ['100.00'], 'la búsqueda se normaliza');
  assert.deepEqual(await importes('orden=importe_desc&min=20&max=120'), ['100.00', '25.00']);
  assert.deepEqual(await importes('orden=importe_desc&tipo=gasto&tipo=ingreso&limite=2'), ['500.00', '100.00']);
  const p2 = (await api(c, 'GET', '/movimientos?orden=importe_desc&limite=2&pagina=2')).body;
  assert.deepEqual(p2.items.map((x) => x.importe), ['25.00', '9.00']);
  assert.equal(p2.total, 4);
  // Orden desconocido o con intento de inyección: se usa el orden por defecto, sin error y sin tocar el SQL.
  for (const orden of ['inventado', 'date; DROP TABLE movements; --', 'importe_desc,(SELECT 1)']) {
    const r = await api(c, 'GET', `/movimientos?orden=${encodeURIComponent(orden)}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.orden, 'fecha_desc');
  }
  assert.equal((await api(c, 'GET', '/movimientos?limite=100000')).body.limite, 100, 'el límite máximo es 100');
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements'), h.db.value('SELECT COUNT(*) FROM movements WHERE deleted_at IS NULL') + h.db.value('SELECT COUNT(*) FROM movements WHERE deleted_at IS NOT NULL'));
});

test('resumen: ranking por categoría, porcentajes exactos y comparación con el mes anterior a la misma altura', async () => {
  const { c } = await user();
  const month = tracker.currentMonth();
  const prev = `${tracker.prevMonth(month)}-01`;
  const day = (m) => `${m}-01`;
  // Mes anterior (todo el mes): alimentación 100 el día 1 y 900 el día 28 (esta última queda fuera de «la misma altura»).
  await api(c, 'POST', '/movimientos', gasto({ importe: '100.00', fecha: prev }));
  await api(c, 'POST', '/movimientos', gasto({ importe: '900.00', fecha: `${tracker.prevMonth(month)}-28`, nota: 'otro' }));
  await api(c, 'POST', '/movimientos', gasto({ categoria: 'ocio', importe: '50.00', fecha: prev }));
  // Mes actual.
  await api(c, 'POST', '/movimientos', gasto({ importe: '120.10', fecha: day(month) }));
  await api(c, 'POST', '/movimientos', gasto({ categoria: 'ocio', importe: '29.90', fecha: day(month), nota: 'cine' }));
  await api(c, 'POST', '/movimientos', { tipo: 'ingreso', categoria: 'sueldo', importe: '1000.00', fecha: day(month) });
  const s = (await api(c, 'GET', `/resumen?mes=${month}`)).body;
  assert.equal(s.mes, month);
  assert.equal(s.gasto, '150.00');
  assert.equal(s.ingreso, '1000.00');
  assert.equal(s.saldo, '850.00');
  assert.equal(s.n_movimientos, 3);
  assert.equal(s.dias_con_registro, 1);
  assert.deepEqual(s.por_categoria.filter((x) => x.tipo === 'gasto').map((x) => [x.categoria, x.monto, x.pct_del_total]), [['alimentacion', '120.10', 80.1], ['ocio', '29.90', 19.9]]);
  const food = s.por_categoria.find((x) => x.categoria === 'alimentacion');
  assert.equal(food.delta_monto, '20.10', '120,10 frente a 100 del mes anterior hasta la misma altura');
  assert.equal(food.delta_pct, 20.1);
  assert.equal(s.mes_anterior.a_la_misma_altura, true);
  if (s.dias_transcurridos < 28) assert.equal(s.mes_anterior.gasto, '150.00', 'el día 28 del mes anterior aún no cuenta');
  assert.equal(s.previsto, null);
  // Sumas exactas con decimales (I14): 0,1 + 0,2 no da 0,30000000000000004.
  await api(c, 'POST', '/movimientos', gasto({ categoria: 'otros', importe: '0.10', fecha: day(month), nota: 'a' }));
  await api(c, 'POST', '/movimientos', gasto({ categoria: 'otros', importe: '0.20', fecha: day(month), nota: 'b' }));
  const s2 = (await api(c, 'GET', `/resumen?mes=${month}`)).body;
  assert.equal(s2.por_categoria.find((x) => x.categoria === 'otros').monto, '0.30');
});

test('lo borrado no cuenta en los totales ni en la exportación de datos', async () => {
  const { c, u } = await user();
  const m = await api(c, 'POST', '/movimientos', gasto({ importe: '77.00' }));
  await api(c, 'DELETE', `/movimientos/${m.body.movimiento.id}`);
  const privacy = require('../src/domain/privacy');
  const exported = privacy.exportUser(u.id);
  assert.ok(Array.isArray(exported.movimientos), 'la exportación incluye movimientos');
  const dump = JSON.stringify(exported);
  assert.doesNotMatch(dump, /"77\.00"/);
  assert.equal(tracker.monthSummary(u.id, tracker.currentMonth()).count, 0);
});

test('migraciones 005 y 006: sobre datos existentes conservan filas, generan centavos y mantienen el CHECK de ai_runs', () => {
  const dir = path.join(__dirname, '..', 'src', 'db', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const before = files.filter((f) => f < '005');
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const f of before) db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  db.exec("INSERT INTO users (email, password_hash, role, created_at, updated_at) VALUES ('m@x.test', 'x', 'usuario', 'n', 'n')");
  db.exec("INSERT INTO movements (user_id, date, kind, category, amount, currency, created_at, updated_at) VALUES (1, '2026-11-01', 'gasto', 'ocio', '1234.56', 'USD', 'n', 'n'), (1, '2026-11-02', 'gasto', 'ocio', '0.10', 'USD', 'n', 'n')");
  db.exec("INSERT INTO ai_runs (user_id, purpose, provider, model, prompt_version, input_json, status, input_tokens, output_tokens, cost_micros, created_at) VALUES (1, 'coach', 'anthropic', 'claude-opus-5-5', 'coach-v1', '{}', 'ok', 100, 50, 1400, 'n')");
  for (const f of files.filter((x) => x >= '005')) db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_runs').get().n, 1, 'ai_runs conserva sus filas');
  assert.deepEqual(db.prepare('SELECT amount, amount_cents, deleted_at, note_norm FROM movements ORDER BY id').all().map((r) => ({ ...r })), [
    { amount: '1234.56', amount_cents: 123456, deleted_at: null, note_norm: null },
    { amount: '0.10', amount_cents: 10, deleted_at: null, note_norm: null },
  ]);
  assert.throws(() => db.exec("INSERT INTO ai_runs (user_id, purpose, provider, model, prompt_version, input_json, status, created_at) VALUES (1, 'otro', 'a', 'm', 'v', '{}', 'ok', 'n')"));
  db.exec("INSERT INTO ai_runs (user_id, purpose, task, provider, model, prompt_version, input_json, status, cache_read_tokens, created_at) VALUES (1, 'coach_clasificar', 'clasificar', 'anthropic', 'haiku-5.5', 'clf-v1', '{}', 'ok', 900, 'n')");
  for (const t of ['recurring_movements', 'quick_templates', 'category_hints', 'coach_response_cache', 'idempotency_keys']) {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t), `existe ${t}`);
  }
});
