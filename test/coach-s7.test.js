'use strict';
// Coach v2 · S7: adaptador de OpenAI para la IA del Coach, recurrentes, atajos, XP con tope diario, recordatorios,
// resumen semanal y ciclo de mejora continua del parser.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const config = require('../src/config');
const entitlements = require('../src/domain/entitlements');
const tracker = require('../src/domain/tracker');
const game = require('../src/domain/game');
const { setSetting } = require('../src/lib/services');
const router = require('../src/domain/coach/ia/router');
const adaptadores = require('../src/domain/coach/ia/adaptadores');
const recurrentes = require('../src/domain/coach/recurrentes');
const plantillas = require('../src/domain/coach/plantillas');
const mejora = require('../src/domain/coach/mejora');
const recordatorios = require('../src/domain/coach/recordatorios');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => {
  h.resetRateLimits();
  adaptadores.reiniciarLocal();
  setSetting('coach_v2_ia_automatica', false);
  setSetting('coach_v2_resumen_semanal', false);
});

let seq = 0;
async function user() {
  const c = new h.Client();
  const email = `coachs7${++seq}@ejemplo.test`;
  await h.registerUser(c, email);
  const u = h.db.one('SELECT * FROM users WHERE email = ?', email);
  entitlements.grantManual({ userId: u.id, code: 'acompanamiento', days: 30, adminId: null, reason: 'prueba S7' });
  await c.get('/');
  return { c, u };
}
async function api(c, json) {
  const r = await c.req('POST', '/api/v1/coach/mensajes', { json });
  return JSON.parse(r.text);
}
const say = (c, texto) => api(c, { texto });
const press = (c, accion, extra = {}) => api(c, { accion, ...extra });
const mov = (userId, date, kind, category, amount, note, source = 'usuario') => {
  const v = tracker.validateMovement(userId, { kind, category, amount, date, note });
  assert.ok(v.ok, JSON.stringify(v.errors));
  return tracker.createMovement(userId, v.value, source);
};
const hoy = new Date().toISOString().slice(0, 10);
const mesesAtras = (n) => {
  const d = new Date(Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)) - 1 - n, 1));
  return d.toISOString().slice(0, 10); // día 1 de ese mes
};

// ───────── OpenAI como proveedor de la IA del Coach ─────────
test('OpenAI: la tarea sale por Chat Completions estricto, con modelo y tope de tokens, y se registra el costo con los precios configurados', async () => {
  const { u } = await user();
  const guardado = { p: config.ai.coachProvider, k: config.ai.openai.apiKey, pr: config.ai.openaiPrices, f: global.fetch };
  setSetting('coach_v2_ia_automatica', true);
  let pedido = null;
  config.ai.coachProvider = 'openai';
  config.ai.openai.apiKey = 'sk-prueba';
  config.ai.openaiPrices = { entrada: 0.2, cacheada: 0.02, salida: 1 };
  global.fetch = async (url, init) => {
    pedido = { url, body: JSON.parse(init.body), auth: init.headers.authorization };
    return { ok: true, status: 200, json: async () => ({ model: 'gpt-6-luna', choices: [{ message: { content: JSON.stringify({ intencion: 'resumen_mes', confianza: 0.9, categoria_consultada: null }) } }], usage: { prompt_tokens: 1300, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 1200 } } }) };
  };
  try {
    assert.equal(router.proveedorActual(), 'openai');
    assert.equal(router.disponible(), true);
    const r = await router.ejecutar({ userId: u.id, tarea: 'clasificar', texto: 'cómo voy este mes', hoy });
    assert.equal(r.ok, true);
    assert.match(pedido.url, /\/chat\/completions$/);
    assert.equal(pedido.auth, 'Bearer sk-prueba');
    assert.equal(pedido.body.model, 'gpt-6-luna');
    assert.equal(pedido.body.max_completion_tokens, 60);
    assert.equal(pedido.body.response_format.type, 'json_schema');
    assert.equal(pedido.body.response_format.json_schema.strict, true);
    assert.equal(pedido.body.messages[0].role, 'system');
    assert.match(pedido.body.messages[1].content, /^<mensaje>cómo voy este mes<\/mensaje>$/);
    const fila = h.db.one("SELECT * FROM ai_runs WHERE user_id = ? AND task = 'clasificar' ORDER BY id DESC", u.id);
    assert.equal(fila.provider, 'openai');
    assert.equal(fila.model, 'gpt-6-luna');
    assert.equal(fila.cache_read_tokens, 1200);
    assert.equal(fila.input_tokens, 100);
    assert.equal(fila.cost_micros, Math.round(100 * 0.2 + 1200 * 0.02 + 20 * 1));
    // Sin precios configurados: se sobreestima (nunca se subestima el gasto)
    config.ai.openaiPrices = null;
    await router.ejecutar({ userId: u.id, tarea: 'clasificar', texto: 'otra frase distinta', hoy });
    const sin = h.db.one("SELECT cost_micros FROM ai_runs WHERE user_id = ? AND task = 'clasificar' ORDER BY id DESC", u.id);
    assert.ok(sin.cost_micros > fila.cost_micros);
    // Un error del proveedor no rompe nada
    global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { code: 'rate_limit_exceeded' } }) });
    const caida = await router.ejecutar({ userId: u.id, tarea: 'clasificar', texto: 'una más', hoy });
    assert.deepEqual([caida.ok, caida.motivo], [false, 'IA_NO_DISPONIBLE']);
  } finally {
    config.ai.coachProvider = guardado.p;
    config.ai.openai.apiKey = guardado.k;
    config.ai.openaiPrices = guardado.pr;
    global.fetch = guardado.f;
  }
});

// ───────── Recurrentes (CV2-501) ─────────
test('recurrentes: se detectan con ≥ 3 meses, se proponen, se crean con confirmación y se sugieren sin anotarse solos', async () => {
  const { c, u } = await user();
  for (const n of [2, 1, 0]) mov(u.id, mesesAtras(n), 'gasto', 'servicios', '12.00', 'Netflix');
  mov(u.id, mesesAtras(1), 'gasto', 'alimentacion', '30.00', 'pan'); // una sola vez: no es recurrente
  const det = recurrentes.detectar(u.id, hoy);
  assert.equal(det.length, 1);
  assert.deepEqual([det[0].nota, det[0].monto, det[0].veces], ['Netflix', '12.00', 3]);

  const prop = await press(c, 'consulta', { intencion: 'recurrente_propuesto' });
  assert.equal(prop.intencion, 'recurrente_propuesto');
  assert.equal(prop.propuesta.tipo, 'crear_recurrente');
  assert.equal(recurrentes.listar(u.id).length, 0, 'proponer no crea nada');
  assert.ok(prop.botones.find((b) => b.accion === 'crear_recurrente'));
  const cuenta = h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', u.id);
  const ok = await press(c, 'crear_recurrente', { mensaje_id: prop.id });
  assert.equal(ok.intencion, 'recurrente_creado');
  assert.equal(recurrentes.listar(u.id).length, 1);
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', u.id), cuenta, 'crear el recurrente no anota nada');
  assert.equal(recurrentes.detectar(u.id, hoy).length, 0, 'ya es recurrente');
  // «Confirmar» genérico no sirve para esa propuesta
  const dos = await press(c, 'consulta', { intencion: 'recurrente_propuesto' });
  assert.equal(dos.intencion, 'sin_recurrentes');

  // Sugerencia del mes: uno nuevo sin anotar este mes, con su día ya cumplido
  assert.equal(recurrentes.crear(u.id, { tipo: 'gasto', categoria: 'vivienda', monto: '300.00', nota: 'Renta oficina', dia: 1 }, hoy).ok, true);
  const toca = await press(c, 'consulta', { intencion: 'recurrente_sugerido_mes' });
  assert.equal(toca.intencion, 'recurrente_sugerido_mes');
  assert.equal(h.db.value("SELECT COUNT(*) FROM movements WHERE user_id = ? AND note = 'Renta oficina'", u.id), 0, 'sugerir no anota');
  const conf = await press(c, 'confirmar', { mensaje_id: toca.id });
  assert.ok(conf.movimiento_id);
  assert.equal(h.db.value('SELECT source FROM movements WHERE id = ?', conf.movimiento_id), 'recurrente');
  assert.equal(recurrentes.sugeridosDelMes(u.id, hoy).length, 0, 'ya no se vuelve a sugerir este mes');
});

test('recurrentes: «No, solo esta vez» no se vuelve a proponer; pausar, eliminar y aislamiento entre cuentas', async () => {
  const A = await user();
  const B = await user();
  for (const n of [2, 1, 0]) mov(A.u.id, mesesAtras(n), 'gasto', 'ocio', '8.00', 'Spotify');
  const prop = await press(A.c, 'consulta', { intencion: 'recurrente_propuesto' });
  const no = await press(A.c, 'descartar_recurrente', { mensaje_id: prop.id });
  assert.equal(no.intencion, 'cancelado');
  assert.equal(recurrentes.detectar(A.u.id, hoy).length, 0);
  assert.equal((await press(A.c, 'consulta', { intencion: 'recurrente_propuesto' })).intencion, 'sin_recurrentes');
  // Otra cuenta no puede usar la propuesta de ésta
  assert.equal((await press(B.c, 'crear_recurrente', { mensaje_id: prop.id })).error.codigo, 'SIN_PROPUESTA');
  const id = recurrentes.crear(A.u.id, { tipo: 'ingreso', categoria: 'sueldo', monto: '900.00', nota: 'Sueldo', dia: 28 }, hoy).id;
  assert.equal(recurrentes.pausar(B.u.id, id, false), false);
  assert.equal(recurrentes.eliminar(B.u.id, id), false);
  assert.equal(recurrentes.pausar(A.u.id, id, false), true);
  assert.equal(recurrentes.sugeridosDelMes(A.u.id, '2026-11-30').length, 0, 'en pausa no se sugiere');
  assert.equal(recurrentes.crear(A.u.id, { tipo: 'gasto', categoria: 'otros', monto: '0', nota: 'x', dia: 3 }, hoy).ok, false);
  assert.equal(recurrentes.crear(A.u.id, { tipo: 'gasto', categoria: 'otros', monto: '5', nota: 'x', dia: 40 }, hoy).ok, false);
  assert.equal(recurrentes.crear(A.u.id, { tipo: 'gasto', categoria: 'otros', monto: '5', nota: '', dia: 4 }, hoy).ok, false);
  assert.equal(recurrentes.eliminar(A.u.id, id), true);
});

test('recurrentes: el día 31 se ajusta al último día del mes y una sugerencia espera a que llegue su día', () => {
  return user().then(({ u }) => {
    recurrentes.crear(u.id, { tipo: 'gasto', categoria: 'servicios', monto: '20.00', nota: 'Seguro', dia: 31 }, '2026-02-01');
    assert.equal(recurrentes.sugeridosDelMes(u.id, '2026-02-27').length, 0);
    assert.equal(recurrentes.sugeridosDelMes(u.id, '2026-02-28').length, 1, 'febrero termina el 28');
    assert.equal(recurrentes.sugeridosDelMes(u.id, '2026-04-29').length, 0, 'abril: el 30 todavía no llegó');
  });
});

// ───────── Atajos (CV2-502) ─────────
test('atajos: se proponen con ≥ 3 usos, se guardan con confirmación, se usan en un toque y son de cada cuenta', async () => {
  const A = await user();
  const B = await user();
  for (const d of [1, 2, 3]) mov(A.u.id, new Date(Date.now() - d * 86400000).toISOString().slice(0, 10), 'gasto', 'alimentacion', '8.50', 'café');
  assert.equal(plantillas.candidatas(A.u.id, hoy).length, 1);
  const prop = await press(A.c, 'consulta', { intencion: 'plantilla_sugerida' });
  assert.equal(prop.intencion, 'plantilla_sugerida');
  assert.equal(plantillas.listar(A.u.id).length, 0);
  assert.equal((await press(A.c, 'crear_plantilla', { mensaje_id: prop.id })).intencion, 'plantilla_creada');
  const [t] = plantillas.listar(A.u.id);
  assert.equal(t.label, 'café');
  assert.equal(plantillas.candidatas(A.u.id, hoy).length, 0, 'ya es atajo');
  const antes = h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', A.u.id);
  const uso = plantillas.usar(A.u.id, t.id, hoy);
  assert.equal(uso.ok, true);
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', A.u.id), antes + 1);
  assert.equal(h.db.value('SELECT source FROM movements WHERE id = ?', uso.id), 'plantilla');
  assert.equal(plantillas.listar(A.u.id)[0].uses, 1);
  assert.equal(plantillas.usar(B.u.id, t.id, hoy).ok, false, 'otra cuenta no usa el atajo');
  assert.equal(plantillas.eliminar(B.u.id, t.id), false);
  // límites
  for (let i = 0; i < plantillas.MAX; i++) plantillas.crear(A.u.id, { etiqueta: `a${i}`, tipo: 'gasto', categoria: 'otros', monto: '1' });
  assert.equal(plantillas.crear(A.u.id, { etiqueta: 'demasiados', tipo: 'gasto', categoria: 'otros', monto: '1' }).ok, false);
});

test('atajos: la pantalla funciona sin JavaScript (crear, usar y eliminar) y pide sesión', async () => {
  const anon = new h.Client();
  assert.doesNotMatch((await anon.get('/mi-dinero/atajos')).text, /Recurrentes y atajos/);
  const { c, u } = await user();
  const pagina = await c.get('/mi-dinero/atajos');
  assert.equal(pagina.status, 200);
  assert.match(pagina.text, /Recurrentes y atajos/);
  const r = await c.post('/mi-dinero/atajos/plantillas', { label: 'Pasaje', kindcat: 'gasto:transporte', amount: '2,50' });
  assert.equal(r.status, 200);
  const t = plantillas.listar(u.id)[0];
  assert.equal(t.label, 'Pasaje');
  await c.post(`/mi-dinero/atajos/plantillas/${t.id}/usar`, {});
  assert.equal(h.db.value("SELECT COUNT(*) FROM movements WHERE user_id = ? AND source = 'plantilla'", u.id), 1);
  const rec = await c.post('/mi-dinero/atajos/recurrentes', { note: 'Internet', kindcat: 'gasto:servicios', amount: '30', day: '5' });
  assert.equal(rec.status, 200);
  assert.equal(recurrentes.listar(u.id)[0].note, 'Internet');
  const mala = await c.post('/mi-dinero/atajos/recurrentes', { note: 'Malo', kindcat: 'gasto:servicios', amount: '30', day: '99' });
  assert.equal(mala.status, 422);
  await c.post(`/mi-dinero/atajos/recurrentes/${recurrentes.listar(u.id)[0].id}/eliminar`, {});
  assert.equal(recurrentes.listar(u.id).length, 0);
  await c.post(`/mi-dinero/atajos/plantillas/${t.id}/eliminar`, {});
  assert.equal(plantillas.listar(u.id).length, 0);
  assert.equal((await c.post('/mi-dinero/atajos/recurrentes/99999/eliminar', {})).status, 404);
});

// ───────── XP del registro (CV2-503) ─────────
test('XP del registro: tope de 5 movimientos por día y el importe no pesa', async () => {
  const A = await user();
  const B = await user();
  const antesA = game.profile(A.u.id).xp;
  const antesB = game.profile(B.u.id).xp;
  for (let i = 0; i < 9; i++) mov(A.u.id, hoy, 'gasto', 'otros', '1.00', `mini ${i}`);
  for (let i = 0; i < 5; i++) mov(B.u.id, hoy, 'gasto', 'otros', '99999.00', `enorme ${i}`);
  const ganA = game.profile(A.u.id).xp - antesA;
  const ganB = game.profile(B.u.id).xp - antesB;
  assert.equal(ganA, 25, '9 movimientos en un día valen como 5');
  assert.equal(ganB, 25, 'el importe no cambia el XP');
  mov(A.u.id, mesesAtras(1), 'gasto', 'otros', '1.00', 'otro día');
  assert.equal(game.profile(A.u.id).xp - antesA, 30, 'otro día vuelve a sumar');
});

// ───────── Recordatorios y resumen semanal (CV2-504 y 506) ─────────
test('recordatorios: amables, como mucho 2 por semana, nunca seguidos y apagables', async () => {
  const { u } = await user();
  const dia = (n) => new Date(Date.parse('2026-11-18T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);
  assert.equal(recordatorios.recordarRegistro(u.id, '2026-11-18'), false, 'sin movimientos no hay nada que recordar');
  mov(u.id, dia(5), 'gasto', 'otros', '4.00', 'algo');
  assert.equal(recordatorios.recordarRegistro(u.id, '2026-11-18'), true);
  assert.equal(h.db.value("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND kind = 'coach'", u.id), 1);
  assert.equal(recordatorios.recordarRegistro(u.id, '2026-11-19'), false, 'no dos días seguidos');
  assert.equal(recordatorios.recordarRegistro(u.id, '2026-11-18'), false, 'ni dos el mismo día');
  // máximo semanal
  h.db.run('DELETE FROM coach_reminders WHERE user_id = ?', u.id);
  const ahora = new Date().toISOString();
  h.db.run('INSERT INTO coach_reminders (user_id, kind, created_at) VALUES (?, ?, ?), (?, ?, ?)', u.id, 'registro', new Date(Date.now() - 6 * 86400000).toISOString(), u.id, 'registro', new Date(Date.now() - 4 * 86400000).toISOString());
  assert.equal(recordatorios.permitido(u.id, ahora.slice(0, 10)), false);
  h.db.run('DELETE FROM coach_reminders WHERE user_id = ?', u.id);
  recordatorios.apagar(u.id, false);
  assert.equal(recordatorios.recordarRegistro(u.id, '2026-11-26'), false, 'apagados no se envían');
  recordatorios.apagar(u.id, true);
  assert.equal(recordatorios.activos(u.id), true);
});

test('resumen semanal: solo el lunes, con la bandera abierta, con cifras del servidor y una sola vez por semana', async () => {
  const { u } = await user();
  mov(u.id, '2026-11-10', 'gasto', 'alimentacion', '40.00', 'super');
  mov(u.id, '2026-11-12', 'gasto', 'transporte', '10.00', 'bus');
  mov(u.id, '2026-11-12', 'ingreso', 'sueldo', '500.00', 'pago');
  const r = recordatorios.resumenSemana(u.id, '2026-11-16');
  assert.match(r.cuerpo, /2 gastos/);
  assert.match(r.cuerpo, /50,00|50\.00/);
  assert.match(r.cuerpo, /Alimentación/);
  assert.equal(recordatorios.enviarResumen(u.id, '2026-11-17'), false, 'martes no');
  assert.equal(recordatorios.enviarResumen(u.id, '2026-11-16'), true);
  recordatorios.enviarResumen(u.id, '2026-11-16');
  assert.equal(h.db.value("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND dedupe_key LIKE 'resumen_semanal:%'", u.id), 1);
  // el trabajo diario respeta la bandera
  const n0 = h.db.value("SELECT COUNT(*) FROM notifications WHERE dedupe_key LIKE 'resumen_semanal:%'");
  recordatorios.diario('2026-11-23');
  assert.equal(h.db.value("SELECT COUNT(*) FROM notifications WHERE dedupe_key LIKE 'resumen_semanal:%'"), n0, 'bandera apagada: nada');
});

// ───────── Mejora continua (CV2-505) ─────────
test('mejora continua: la frase no entendida se guarda anonimizada y agrupada; se revisa desde el panel', async () => {
  const { c, u } = await user();
  const r = await say(c, 'xyzzy blorp a@b.com');
  assert.equal(r.intencion, 'no_entendi');
  await say(c, 'xyzzy blorp otra@b.com');
  const lote = mejora.loteSemanal();
  const f = lote.find((x) => x.phrase.startsWith('xyzzy blorp'));
  assert.ok(f, JSON.stringify(lote));
  assert.equal(f.phrase, 'xyzzy blorp');
  assert.equal(f.hits, 2, 'las dos variantes se agrupan');
  assert.doesNotMatch(f.phrase, /@/);
  assert.equal(JSON.stringify(Object.keys(f)).includes('user'), false, 'sin cuenta');
  assert.equal(mejora.anonimizar('12345'), null);
  assert.doesNotMatch(mejora.anonimizar("pagué 45,50 a juan@x.com al +591 7001234"), /[@0-9]/);
  assert.equal(mejora.anonimizar('a'), null);
  // los botones y las frases entendidas no entran
  await say(c, 'resumen del mes');
  assert.equal(mejora.listar({ estado: 'nuevo', limite: 200 }).some((x) => /resumen/.test(x.phrase)), false);
  // revisión
  const admin = new h.Client();
  await h.login(admin, 'admin@diauno.test', 'Prueba-Admin-2026');
  const panel = await admin.get('/admin/coach');
  assert.match(panel.text, /Mejora continua del parser/);
  assert.match(panel.text, /xyzzy blorp/);
  await admin.post(`/admin/coach/frases/${f.id}`, { estado: 'incorporado' });
  assert.equal(h.db.value('SELECT status FROM parser_feedback WHERE id = ?', f.id), 'incorporado');
  assert.equal(mejora.loteSemanal().some((x) => x.id === f.id), false);
  assert.equal(u.id > 0, true);
});
