'use strict';
// Coach v2 · S6: IA barata con control de costo. Se prueba con el adaptador local (sin red): precios exactos,
// prefijos fijos, validación de la salida, límites, caché de respuestas, y el pipeline (clasificación automática
// apagada por defecto, botones «Preguntarle a la IA» y «Explícamelo mejor»).
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const entitlements = require('../src/domain/entitlements');
const { setSetting } = require('../src/lib/services');
const precios = require('../src/domain/coach/ia/precios');
const { PREFIJOS } = require('../src/domain/coach/ia/prefijos');
const validar = require('../src/domain/coach/ia/validar');
const router = require('../src/domain/coach/ia/router');
const limites = require('../src/domain/coach/ia/limites');
const adaptadores = require('../src/domain/coach/ia/adaptadores');
const metricas = require('../src/domain/coach/ia/metricas');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => {
  h.resetRateLimits();
  adaptadores.reiniciarLocal();
  setSetting('coach_v2_enabled', true);
  setSetting('coach_v2_ia_automatica', false);
  setSetting('ai_coach_daily_auto_limit', 30);
  setSetting('ai_coach_monthly_limit', 20);
});
test.afterEach(() => {
  setSetting('coach_v2_enabled', false);
  setSetting('coach_v2_ia_directa', true);
});

let seq = 0;
async function user() {
  const c = new h.Client();
  const email = `coachia${++seq}@ejemplo.test`;
  await h.registerUser(c, email);
  const u = h.db.one('SELECT * FROM users WHERE email = ?', email);
  entitlements.grantManual({ userId: u.id, code: 'acompanamiento', days: 30, adminId: null, reason: 'prueba de IA' });
  await c.get('/');
  return { c, u };
}
async function api(c, url, json) {
  const r = await c.req('POST', `/api/v1${url}`, { json });
  return { status: r.status, body: JSON.parse(r.text) };
}
const say = async (c, texto) => (await api(c, '/coach/mensajes', { texto })).body;
const press = async (c, accion, extra = {}) => (await api(c, '/coach/mensajes', { accion, ...extra })).body;
const btn = (r, id) => (r.botones || []).find((b) => b.id === id);
const runs = (uid, tarea) => h.db.all('SELECT * FROM ai_runs WHERE user_id = ? AND task = ? ORDER BY id', uid, tarea);

// ───────── Precios ─────────
test('precios: fórmula exacta con caché (Haiku: lectura 0,01 · entrada 0,10 · salida 0,50 USD por millón)', () => {
  // 1.227 tokens leídos de caché + 20 de entrada + 15 de salida
  assert.equal(precios.costoMicros('claude-haiku-5-5', { entrada: 20, salida: 15, cacheLectura: 1227 }), Math.round(1227 * 0.01 + 20 * 0.1 + 15 * 0.5));
  // escritura de caché a 1 h cuesta 0,20; a 5 min, 0,125
  assert.equal(precios.costoMicros('claude-haiku-5-5', { cacheEscritura: 1000, ttl: '1h' }), 200);
  assert.equal(precios.costoMicros('claude-haiku-5-5', { cacheEscritura: 1000, ttl: '5m' }), 125);
  assert.equal(precios.costoMicros('modelo-que-no-existe', { entrada: 100 }), null);
  assert.equal(precios.tasaAciertos({ entrada: 100, cacheLectura: 900 }), 0.9);
  assert.equal(precios.tasaAciertos({}), null);
});

// ───────── Prefijos ─────────
test('prefijos: cada tarea tiene un prefijo fijo cacheable (≥ 600 tokens) y sin datos de personas', () => {
  for (const [tarea, p] of Object.entries(PREFIJOS)) {
    assert.ok(p.tokens >= 600, `${tarea}: ${p.tokens} tokens`);
    assert.match(p.version, /\S/);
    assert.doesNotMatch(p.texto, /@|\d{4}-\d{2}-\d{2}|usuario_id|user_id/i, `${tarea}: el prefijo no debe llevar datos variables`);
  }
});

// ───────── Validación de la salida ─────────
test('validar: clasificar y extraer exigen forma, valores permitidos y confianza', () => {
  assert.equal(validar.clasificar({ intencion: 'resumen_mes', confianza: 0.9, categoria_consultada: null }).ok, true);
  assert.equal(validar.clasificar({ intencion: 'inventada', confianza: 0.9, categoria_consultada: null }).ok, false);
  assert.equal(validar.clasificar({ intencion: 'resumen_mes', confianza: 2, categoria_consultada: null }).ok, false);
  assert.equal(validar.clasificar({ intencion: 'resumen_mes', confianza: 0.9, categoria_consultada: null, extra: 1 }).ok, false);
  assert.equal(validar.clasificar('texto').ok, false);
  const ent = { tipo: 'gasto', importe: '8.50', categoria: 'alimentacion', subcategoria: 'cafe', fecha: '2026-11-18', nota: 'café', recurrente: false };
  assert.equal(validar.extraer({ entidades: ent, confianza: 0.9 }).ok, true);
  assert.equal(validar.extraer({ entidades: { ...ent, importe: '-5' }, confianza: 0.9 }).ok, false);
  assert.equal(validar.extraer({ entidades: { ...ent, tipo: 'regalo' }, confianza: 0.9 }).ok, false);
});

test('validar: el texto redactado no puede traer cifras ajenas, términos prohibidos, enlaces ni HTML', () => {
  const hechos = { saldo: 'USD 150,00', dias_restantes: 12 };
  assert.equal(validar.texto({ texto: 'Te quedan USD 150,00 y faltan 12 días.' }, hechos).ok, true);
  assert.equal(validar.texto({ texto: 'Te quedan 150 y faltan 12 días.' }, hechos).ok, true, 'redondeo natural permitido');
  assert.equal(validar.texto({ texto: 'Te quedan USD 999,00.' }, hechos).motivo, 'cifra_no_autorizada');
  assert.equal(validar.texto({ texto: 'Mira https://ejemplo.com' }, hechos).ok, false);
  assert.equal(validar.texto({ texto: '<b>hola</b>' }, hechos).ok, false);
  assert.equal(validar.texto({ texto: '' }, hechos).ok, false);
  assert.equal(validar.texto({ texto: 'x', otro: 1 }, hechos).ok, false);
  assert.equal(validar.texto({ texto: 'palabra '.repeat(400) }, hechos).ok, false);
});

test('validar (A9): al modelo no viajan correos, teléfonos ni claves personales', () => {
  assert.equal(validar.limpiarTexto('escríbeme a ana@correo.com o al +591 70012345 <b>ya</b>'), 'escríbeme a [dato] o al [dato] b ya /b');
  assert.equal(validar.limpiarTexto('x'.repeat(900)).length, 500);
  const seguros = validar.hechosSeguros({ saldo: 'USD 10', email: 'a@b.co', nombre: 'Ana', nota: 'privada', 'clave mala': 1 });
  assert.deepEqual(Object.keys(seguros), ['saldo']);
  const v = router.armarVariable('clasificar', { texto: 'gasté 5 mi correo es ana@correo.com' });
  assert.doesNotMatch(v, /ana@correo/);
  assert.match(v, /^<mensaje>.*<\/mensaje>$/);
});

// ───────── Router, caché y límites ─────────
test('router: registra tarea, tokens de caché y costo exacto; la segunda llamada lee el prefijo de caché', async () => {
  const { u } = await user();
  setSetting('coach_v2_ia_automatica', true);
  const a = await router.ejecutar({ userId: u.id, tarea: 'clasificar', texto: 'cuánto llevo este mes', hoy: '2026-11-18' });
  assert.equal(a.ok, true);
  const b = await router.ejecutar({ userId: u.id, tarea: 'clasificar', texto: 'cómo voy con mis gastos', hoy: '2026-11-18' });
  const filas = runs(u.id, 'clasificar');
  assert.equal(filas.length, 2);
  assert.equal(filas[0].cache_write_tokens, PREFIJOS.clasificar.tokens, 'la primera escribe el prefijo');
  assert.equal(filas[0].cache_read_tokens, 0);
  assert.equal(filas[1].cache_read_tokens, PREFIJOS.clasificar.tokens, 'la segunda lo lee');
  assert.equal(filas[1].cache_write_tokens, 0);
  assert.equal(filas[1].purpose, 'coach_clasificar');
  assert.ok(b.runId);
});

test('router: las tareas automáticas están apagadas por defecto y las explícitas se cachean 24 h', async () => {
  const { u } = await user();
  const apagada = await router.ejecutar({ userId: u.id, tarea: 'clasificar', texto: 'hola', hoy: '2026-11-18' });
  assert.deepEqual([apagada.ok, apagada.motivo], [false, 'AUTOMATICA_APAGADA']);
  const hechos = { tema: 'x', saldo: 'USD 10,00' };
  const r1 = await router.ejecutar({ userId: u.id, tarea: 'redactar', hechos, tema: 'saldo', tono: 'cercano', hoy: '2026-11-18' });
  const r2 = await router.ejecutar({ userId: u.id, tarea: 'redactar', hechos, tema: 'saldo', tono: 'cercano', hoy: '2026-11-18' });
  assert.equal(r1.origen, 'ia');
  assert.equal(r2.origen, 'cache');
  assert.equal(runs(u.id, 'redactar').length, 1, 'la respuesta en caché no cuesta ni cuenta como llamada');
  assert.equal(limites.usadasMes(u.id), 1);
});

test('router: una salida inválida se descarta pero la llamada queda registrada; un fallo del proveedor no rompe nada', async () => {
  const { u } = await user();
  const mala = async () => ({ texto: JSON.stringify({ texto: 'Tienes USD 999.999,00 en el banco.' }), uso: { entrada: 10, salida: 10, cacheLectura: 0, cacheEscritura: 0 }, modelo: 'local' });
  const r = await router.ejecutar({ userId: u.id, tarea: 'consejo', texto: '¿qué hago?', hechos: { saldo: 'USD 10,00' }, hoy: '2026-11-18', proveedor: mala });
  assert.deepEqual([r.ok, r.motivo], [false, 'SALIDA_INVALIDA']);
  const fila = runs(u.id, 'consejo')[0];
  assert.match(fila.error_code, /salida_descartada:cifra_no_autorizada/);
  assert.equal(fila.output_text, null, 'lo descartado no se guarda como respuesta');
  const caida = async () => {
    throw new Error('503');
  };
  const f = await router.ejecutar({ userId: u.id, tarea: 'consejo', texto: 'otra', hechos: {}, hoy: '2026-11-18', proveedor: caida });
  assert.deepEqual([f.ok, f.motivo], [false, 'IA_NO_DISPONIBLE']);
  assert.equal(runs(u.id, 'consejo').filter((x) => x.status === 'error').length, 1);
});

test('límites: mensual por cuenta (solo llamadas reales explícitas) y diario de automáticas', async () => {
  const { u } = await user();
  setSetting('ai_coach_monthly_limit', 2);
  for (let i = 0; i < 2; i++) assert.equal((await router.ejecutar({ userId: u.id, tarea: 'consejo', texto: `pregunta ${i}`, hechos: {}, hoy: '2026-11-18' })).ok, true);
  const tope = await router.ejecutar({ userId: u.id, tarea: 'consejo', texto: 'pregunta 3', hechos: {}, hoy: '2026-11-18' });
  assert.deepEqual([tope.ok, tope.motivo], [false, 'LIMITE_MENSUAL']);
  // lo que ya está en caché sigue respondiendo aunque el cupo se haya agotado
  const repetida = await router.ejecutar({ userId: u.id, tarea: 'consejo', texto: 'pregunta 0', hechos: {}, hoy: '2026-11-18' });
  assert.equal(repetida.origen, 'cache');

  const v = await user();
  setSetting('coach_v2_ia_automatica', true);
  setSetting('ai_coach_daily_auto_limit', 1);
  assert.equal((await router.ejecutar({ userId: v.u.id, tarea: 'clasificar', texto: 'uno', hoy: '2026-11-18' })).ok, true);
  assert.equal((await router.ejecutar({ userId: v.u.id, tarea: 'clasificar', texto: 'dos', hoy: '2026-11-18' })).motivo, 'LIMITE_DIARIO');
});

// ───────── Pipeline ─────────
test('pipeline: sin el interruptor automático, un texto que el parser no entiende sigue siendo «no entendí» y no llama a la IA', async () => {
  const { c, u } = await user();
  const r = await say(c, 'asdfgh');
  assert.equal(r.intencion, 'no_entendi');
  assert.equal(r.uso_ia, null);
  assert.equal(h.db.value("SELECT COUNT(*) FROM ai_runs WHERE user_id = ? AND purpose LIKE 'coach_%'", u.id), 0);
});

test('pipeline: con el interruptor, la IA clasifica lo dudoso y el cálculo sigue siendo de las reglas', async () => {
  const { c, u } = await user();
  setSetting('coach_v2_ia_automatica', true);
  const original = adaptadores.local;
  adaptadores.local = async ({ tarea }) => ({
    texto: JSON.stringify(tarea === 'clasificar' ? { intencion: 'ayuda_menu', confianza: 0.92, categoria_consultada: null } : { entidades: {}, confianza: 0.1 }),
    uso: { entrada: 25, salida: 12, cacheLectura: 1227, cacheEscritura: 0 },
    modelo: 'local',
  });
  try {
    const r = await say(c, 'asdfgh');
    assert.equal(r.intencion, 'ayuda_menu');
    assert.equal(r.uso_ia.origen, 'ia');
    assert.equal(r.origen, 'ia');
    assert.equal(runs(u.id, 'clasificar').length, 1);
    // confianza baja → se descarta y se responde con reglas
    adaptadores.local = async () => ({ texto: JSON.stringify({ intencion: 'resumen_mes', confianza: 0.3, categoria_consultada: null }), uso: { entrada: 5, salida: 5, cacheLectura: 0, cacheEscritura: 0 }, modelo: 'local' });
    const baja = await say(c, 'qwerty');
    assert.equal(baja.intencion, 'no_entendi');
  } finally {
    adaptadores.local = original;
  }
});

test('pipeline: «Preguntarle a la IA» y «Explícamelo mejor» (con límite y sin IA)', async () => {
  const { c, u } = await user();
  setSetting('coach_v2_ia_directa', false);
  const abierta = await say(c, '¿me conviene mudarme de ciudad por trabajo?');
  assert.equal(abierta.intencion, 'ia_ofrecer');
  assert.ok(btn(abierta, 'preguntar_ia'));
  const consejo = await press(c, 'pedir_ia', { mensaje_id: abierta.id });
  assert.equal(consejo.intencion, 'ia_respuesta_prefijo');
  assert.equal(consejo.uso_ia.tarea, 'consejo');
  assert.ok(consejo.mensaje.texto.length > 60);
  assert.equal(runs(u.id, 'consejo').length, 1);
  // La IA nunca sustituye al cálculo: lo mismo, repetido, sale de la caché y no gasta cupo.
  const otra = await press(c, 'pedir_ia', { mensaje_id: abierta.id });
  assert.equal(otra.uso_ia.origen, 'cache');
  assert.equal(limites.usadasMes(u.id), 1);

  const gasto = await say(c, '250 super');
  await press(c, 'confirmar', { mensaje_id: gasto.id });
  const resumen = await say(c, 'resumen del mes');
  assert.equal(resumen.intencion, 'resumen_mes');
  const exp = btn(resumen, 'explicar_mejor');
  assert.ok(exp, 'el resumen ofrece «Explícamelo mejor»');
  const red = await press(c, 'pedir_redaccion', { mensaje_id: resumen.id });
  assert.equal(red.uso_ia.tarea, 'redactar');

  // Límite: se explica y la conversación sigue
  setSetting('ai_coach_monthly_limit', 1);
  const nueva = await say(c, '¿conviene que cambie de trabajo para ganar más?');
  const lim = await press(c, 'pedir_ia', { mensaje_id: nueva.id });
  assert.equal(lim.intencion, 'ia_limite_alcanzado');
  assert.equal((await say(c, 'resumen del mes')).intencion, 'resumen_mes');
});

test('pipeline: un botón de IA sobre un mensaje ajeno no hace nada', async () => {
  const A = await user();
  const B = await user();
  const abierta = await say(A.c, '¿me conviene mudarme de ciudad por trabajo?');
  const r = await press(B.c, 'pedir_ia', { mensaje_id: abierta.id });
  assert.equal(r.intencion, 'ia_no_disponible');
  assert.equal(runs(B.u.id, 'consejo').length, 0);
});

// ───────── Métricas ─────────
test('métricas: porcentaje sin IA, tareas, caché y alarmas', async () => {
  const { c } = await user();
  await say(c, 'resumen del mes');
  const m = metricas.resumen(1);
  assert.ok(m.origenes.total >= 1);
  assert.ok(m.origenes.sinIA <= 1);
  assert.ok(Array.isArray(m.tareas));
  assert.ok(Array.isArray(m.alarmas));
  assert.equal(typeof m.ajustes.coach_v2_ia_automatica, 'boolean');
});

test('admin: la pestaña Coach solo la ve el administrador', async () => {
  const anon = new h.Client();
  const r = await anon.get('/admin/coach');
  assert.doesNotMatch(r.text, /Resueltas sin IA/);
  const admin = new h.Client();
  await h.login(admin, 'admin@diauno.test', 'Prueba-Admin-2026');
  const ok = await admin.get('/admin/coach');
  assert.equal(ok.status, 200);
  assert.match(ok.text, /Resueltas sin IA/);
  assert.match(ok.text, /Por tarea/);
});
