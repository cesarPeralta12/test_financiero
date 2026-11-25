'use strict';
// Evaluación profunda inteligente: no vuelve a preguntar lo que ya se sabe (evaluación anterior, Mi dinero, cuenta),
// muestra su origen, deja decidir y nunca guarda nada sin confirmación.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const tracker = require('../src/domain/tracker');
const qs = require('../src/domain/questionnaire');
const conocido = require('../src/domain/deepConocido');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

let seq = 0;
async function cuenta() {
  const c = new h.Client();
  const email = `conocido${++seq}@ejemplo.test`;
  await h.consent(c);
  await h.registerUser(c, email, { name: 'Ana' });
  const u = h.db.one('SELECT * FROM users WHERE email = ?', email);
  await h.payViaWebhook(c, 'paquete');
  return { c, u };
}
const mes = (n) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - n, 10)).toISOString().slice(0, 10);
function mov(userId, date, kind, category, amount, note = null) {
  const v = tracker.validateMovement(userId, { kind, category, amount, date, note });
  assert.ok(v.ok, JSON.stringify(v.errors));
  tracker.createMovement(userId, v.value);
}
const nueva = (u) => {
  const ev = qs.findEvaluation('profundo', { userId: u.id }, 'en_curso') || qs.startEvaluation('profundo', { userId: u.id });
  return { ev, qn: qs.load(ev.questionnaire_id) };
};

test('sin nada previo no hay pantalla de «lo que ya sabemos»: empieza en la primera pregunta', async () => {
  const { c } = await cuenta();
  const r = await c.get('/evaluacion');
  assert.match(r.url, /\/evaluacion\/pregunta\/1$/);
  assert.equal(h.db.value("SELECT known_reviewed_at IS NOT NULL FROM evaluations WHERE kind = 'profundo' ORDER BY id DESC LIMIT 1"), 1, 'queda marcado: no se vuelve a evaluar');
});

test('con una evaluación anterior, ingresos, gastos, deudas y metas llegan resueltos y con su origen', async () => {
  const { c, u } = await cuenta();
  await h.answerAll(c, '/evaluacion', h.DEEP_ANSWERS);
  const rev = await c.get('/evaluacion/revision');
  await c.post('/evaluacion/finalizar', { ack: [...rev.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]) });
  assert.equal(h.db.value('SELECT COUNT(*) FROM diagnoses WHERE user_id = ?', u.id), 1);

  await c.post('/evaluacion/nueva', {});
  const r = await c.get('/evaluacion');
  assert.match(r.url, /\/evaluacion\/conocido$/);
  assert.match(r.text, /Esto ya lo sabemos de ti/);
  assert.match(r.text, /Tu evaluación anterior/);
  assert.match(r.text, /name="ok" value="ingreso_principal"/);
  assert.match(r.text, /name="ok" value="deudas"/);
  assert.match(r.text, /name="ok" value="metas"/);
  assert.doesNotMatch(r.text, /name="ok" value="prioridad"|name="ok" value="atraso_actual"|name="ok" value="ajuste_gasto"/, 'lo situacional se sigue preguntando');
  assert.match(r.text, /checked/);

  // Aceptar todo: se saltan esas preguntas y solo quedan las situacionales
  const aceptados = [...r.text.matchAll(/name="ok" value="([^"]+)"/g)].map((m) => m[1]);
  const usar = await c.post('/evaluacion/conocido', { action: 'usar', ok: aceptados });
  assert.match(usar.url, /\/evaluacion\/pregunta\/\d+$/);
  const ev = h.db.one("SELECT * FROM evaluations WHERE user_id = ? AND kind = 'profundo' AND status = 'en_curso'", u.id);
  assert.ok(ev.known_reviewed_at);
  const marcadas = h.db.value('SELECT COUNT(*) FROM answers WHERE evaluation_id = ? AND from_previous = 2', ev.id);
  assert.equal(marcadas, aceptados.length);
  const quedan = [];
  let guard = 0;
  let pag = usar;
  while (/\/pregunta\/(\d+)$/.test(pag.url) && guard++ < 30) {
    const code = (pag.text.match(/data-code="([^"]+)"/) || [])[1];
    quedan.push(code);
    pag = await c.post(pag.url.replace(/^https?:\/\/[^/]+/, ''), { action: 'next', ...h.DEEP_ANSWERS[code] });
  }
  assert.ok(quedan.length > 0 && quedan.length < 10, `quedaron ${quedan.length} preguntas: ${quedan.join(', ')}`);
  assert.ok(quedan.every((code) => conocido.NO_PRELLENAR.has(code) || !aceptados.includes(code)), 'no se repite nada de lo confirmado');
  // La revisión muestra todo, y lo confirmado se puede cambiar
  assert.match(pag.url, /\/evaluacion\/revision$/);
  assert.match(pag.text, /Cambiar/);
  assert.doesNotMatch(pag.text, /Falta responder/);
  const fin = await c.post('/evaluacion/finalizar', { ack: [...pag.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]) });
  assert.match(fin.url, /\/diagnostico\/\d+$/);
});

test('el servidor decide los valores: lo que llegue en el formulario no se guarda', async () => {
  const { c, u } = await cuenta();
  await h.answerAll(c, '/evaluacion', h.DEEP_ANSWERS);
  const rev = await c.get('/evaluacion/revision');
  await c.post('/evaluacion/finalizar', { ack: [...rev.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]) });
  await c.post('/evaluacion/nueva', {});
  await c.get('/evaluacion');
  await c.post('/evaluacion/conocido', { action: 'usar', ok: ['ingreso_principal'], value: '999999', 'ingreso_principal': '999999', amount: '999999' });
  const ev = h.db.one("SELECT * FROM evaluations WHERE user_id = ? AND kind = 'profundo' AND status = 'en_curso'", u.id);
  const guardado = JSON.parse(h.db.value("SELECT value_json FROM answers WHERE evaluation_id = ? AND code = 'ingreso_principal'", ev.id));
  assert.equal(guardado.amount, h.DEEP_ANSWERS.ingreso_principal.amount.replace(/[^\d.]/g, '') && guardado.amount);
  assert.notEqual(guardado.amount, '999999.00');
  assert.notEqual(guardado.amount, '999999');
  // un código inventado se ignora
  await c.post('/evaluacion/nueva', {});
  assert.equal(h.db.value("SELECT COUNT(*) FROM answers WHERE code = 'no_existe'"), 0);
});

test('«Prefiero responder todo desde cero» no guarda nada y no vuelve a mostrar la pantalla', async () => {
  const { c, u } = await cuenta();
  await h.answerAll(c, '/evaluacion', h.DEEP_ANSWERS);
  const rev = await c.get('/evaluacion/revision');
  await c.post('/evaluacion/finalizar', { ack: [...rev.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]) });
  await c.post('/evaluacion/nueva', {});
  assert.match((await c.get('/evaluacion')).url, /conocido$/);
  const r = await c.post('/evaluacion/conocido', { action: 'ninguno' });
  assert.match(r.url, /\/evaluacion\/pregunta\/1$/);
  const ev = h.db.one("SELECT * FROM evaluations WHERE user_id = ? AND kind = 'profundo' AND status = 'en_curso'", u.id);
  assert.equal(h.db.value('SELECT COUNT(*) FROM answers WHERE evaluation_id = ?', ev.id), 0);
  assert.match((await c.get('/evaluacion/conocido')).url, /\/evaluacion/);
  assert.doesNotMatch((await c.get('/evaluacion')).url, /conocido/);
});

test('Mi dinero: con ≥ 2 meses de datos se sugieren promedios; con menos no se sugiere nada', async () => {
  const { u } = await cuenta();
  // un solo mes: nada
  mov(u.id, mes(1), 'ingreso', 'sueldo', '3000.00', 'sueldo');
  mov(u.id, mes(1), 'gasto', 'vivienda', '900.00', 'renta');
  let { ev, qn } = nueva(u);
  assert.equal(conocido.candidatos(u.id, ev, qn).some((x) => x.source === 'movimientos'), false);
  // segundo y tercer mes
  mov(u.id, mes(2), 'ingreso', 'sueldo', '3200.00', 'sueldo');
  mov(u.id, mes(2), 'gasto', 'vivienda', '900.00', 'renta');
  mov(u.id, mes(2), 'gasto', 'alimentacion', '400.00', 'super');
  mov(u.id, mes(1), 'gasto', 'alimentacion', '500.00', 'super');
  mov(u.id, mes(1), 'ingreso', 'extra', '100.00', 'freelance');
  mov(u.id, mes(2), 'ingreso', 'extra', '300.00', 'freelance');
  ({ ev, qn } = nueva(u));
  const lista = conocido.candidatos(u.id, ev, qn);
  const get = (code) => lista.find((x) => x.code === code);
  assert.deepEqual(get('ingreso_principal').value, { amount: '3100.00', period: 'mensual' });
  assert.deepEqual(get('ingresos_adicionales').value, { amount: '200.00', period: 'mensual' });
  assert.deepEqual(get('gasto_total').value, { amount: '1350.00', period: 'mensual' });
  assert.equal(get('gastos_desglose').value.vivienda, '900.00');
  assert.equal(get('gastos_desglose').value.alimentacion, '450.00');
  assert.equal(get('gastos_desglose').value.transporte, '0.00');
  assert.equal(get('ingreso_principal').source, 'movimientos');
  assert.equal(get('ingreso_principal').fresh, true);
  assert.match(get('ingreso_principal').detail, /2 meses/);
});

test('deudas y metas registradas en la cuenta se ofrecen con su forma exacta', async () => {
  const { u } = await cuenta();
  const d = tracker.validateDebt(u.id, { name: 'Tarjeta banco', kind: 'tarjeta', balance: '5000', payment: '300', rate: '45', rate_type: 'efectiva_anual', date: new Date().toISOString().slice(0, 10) });
  assert.ok(d.ok, JSON.stringify(d.errors));
  tracker.createDebt(u.id, d.value);
  const g = tracker.validateGoal(u.id, { name: 'Viaje', kind: 'meta', target: '2000', saved: '500', months: '10' });
  assert.ok(g.ok, JSON.stringify(g.errors));
  tracker.createGoal(u.id, g.value);
  const { ev, qn } = nueva(u);
  const lista = conocido.candidatos(u.id, ev, qn);
  const deudas = lista.find((x) => x.code === 'deudas');
  assert.equal(deudas.value[0].name, 'Tarjeta banco');
  assert.equal(deudas.value[0].balance, '5000.00');
  assert.equal(deudas.value[0].payment, '300.00');
  assert.equal(deudas.value[0].kind, 'tarjeta');
  assert.deepEqual(lista.find((x) => x.code === 'pago_deudas_total').value, { amount: '300.00', period: 'mensual' });
  const metas = lista.find((x) => x.code === 'metas');
  assert.equal(metas.value[0].name, 'Viaje');
  assert.equal(metas.value[0].target, '2000.00');
  // lo que se ofrece pasa la validación real del cuestionario
  for (const x of lista) {
    const q = qn.questions.find((k) => k.code === x.code);
    assert.ok(qs.display(q, { value: x.value }, 'USD'), x.code);
  }
});

test('un dato viejo (más de 90 días) llega sin marcar; el más reciente gana entre fuentes', async () => {
  const { c, u } = await cuenta();
  await h.answerAll(c, '/evaluacion', h.DEEP_ANSWERS);
  const rev = await c.get('/evaluacion/revision');
  await c.post('/evaluacion/finalizar', { ack: [...rev.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]) });
  h.db.run("UPDATE evaluations SET completed_at = ? WHERE user_id = ? AND kind = 'profundo'", new Date(Date.now() - 200 * 86400000).toISOString(), u.id);
  await c.post('/evaluacion/nueva', {});
  const page = await c.get('/evaluacion');
  assert.match(page.text, /puede haber cambiado/);
  assert.doesNotMatch(page.text, /name="ok" value="ingreso_principal" checked/);
  // pero si Mi dinero tiene datos de los últimos meses, esos son más actuales y llegan marcados
  mov(u.id, mes(1), 'ingreso', 'sueldo', '41000.00', 'sueldo');
  mov(u.id, mes(2), 'ingreso', 'sueldo', '41000.00', 'sueldo');
  const { ev, qn } = nueva(u);
  const ing = conocido.candidatos(u.id, ev, qn).find((x) => x.code === 'ingreso_principal');
  assert.equal(ing.source, 'movimientos');
  assert.equal(ing.fresh, true);
});

test('en cada pregunta que no se prellena, «Usar esta respuesta» ofrece lo más actual con su origen', async () => {
  const { c, u } = await cuenta();
  await h.answerAll(c, '/evaluacion', h.DEEP_ANSWERS);
  const rev = await c.get('/evaluacion/revision');
  await c.post('/evaluacion/finalizar', { ack: [...rev.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]) });
  await c.post('/evaluacion/nueva', {});
  await c.post('/evaluacion/conocido', { action: 'ninguno' });
  const ev = h.db.one("SELECT * FROM evaluations WHERE user_id = ? AND kind = 'profundo' AND status = 'en_curso'", u.id);
  const pos = h.db.one("SELECT position FROM questions WHERE code = 'prioridad' AND questionnaire_id = ?", ev.questionnaire_id).position;
  const q = await c.get(`/evaluacion/pregunta/${pos}`);
  assert.match(q.text, /Usar esta respuesta/);
});

test('otra cuenta nunca ve ni usa lo conocido de ésta, y sin sesión no abre', async () => {
  const A = await cuenta();
  await h.answerAll(A.c, '/evaluacion', h.DEEP_ANSWERS);
  const rev = await A.c.get('/evaluacion/revision');
  await A.c.post('/evaluacion/finalizar', { ack: [...rev.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]) });
  const B = await cuenta();
  const r = await B.c.get('/evaluacion');
  assert.match(r.url, /\/pregunta\/1$/, 'B no tiene nada previo');
  const anon = new h.Client();
  assert.doesNotMatch((await anon.get('/evaluacion/conocido')).text, /Esto ya lo sabemos/);
});

// ───────── Del test gratuito a la evaluación en chat ─────────
async function conTest({ deuda, varia }) {
  const engine = require('../src/domain/free/engine');
  const cat = require('../src/domain/free/catalog4');
  const { c, u } = await cuenta();
  const A = { Q01: { country: 'BO', currency: 'BOB' }, Q02: { codes: ['A25_34'] }, Q03: { codes: ['D1'] }, Q04: { codes: ['EMPLOYEE'] }, Q05: { code: 'INCOME', horizon: 'M6' }, Q06: { amount: '2500' }, Q07: { codes: [varia] }, Q08: { amount: '900' }, Q09: { amount: '150' }, Q10: deuda, Q11: { codes: ['CARD'] }, Q12: { codes: ['ON_TIME'] }, Q13: { amount: '2000' }, Q14: { codes: ['NONE'] }, Q15: { codes: ['EQUIPMENT'] }, Q16: { codes: ['H3_7'] }, Q17: { codes: ['SELL'] }, Q18: { codes: ['COMMERCE'] }, Q19: { codes: ['UNPAID'] }, Q20: { codes: ['FRIENDS'] }, Q21: { codes: ['GROWTH'] }, Q22: { codes: ['KEEP_JOB'] }, Q23: { availability: 'NO' }, Q24: { codes: ['SELL_SERVICE'] } };
  const s = engine.createSession({ userId: u.id, consent: true, versionId: 'FREE_24_V4_ES' }).session;
  for (const q of cat.SLOTS) {
    const cur = engine.loadSession(s.id);
    const r = engine.questionAt(cur, q.slot_id);
    if (r.question) engine.saveAnswer(s.id, q.slot_id, { variant_id: r.question.variant_id, expected_revision: cur.revision, value: A[q.slot_id] });
  }
  engine.complete(s.id);
  return { c, u };
}
/** Preguntas que hace el chat hasta `max`, respondiendo algo razonable. */
async function preguntas(c, max = 14) {
  const out = [];
  let texto = ((await c.get('/evaluacion?empezar=1')).text.match(/chat-msg--bot chat-q">([^<]+)</) || [])[1];
  for (let i = 0; i < max && texto; i++) {
    out.push(texto);
    const di = /neta/.test(texto) ? 'sí' : /total, sin contar/.test(texto) ? '1050' : /en qué gastas/i.test(texto) ? 'comida' : /cuánto (gastas|pagas)|fuente principal|apartas para/i.test(texto) ? '900' : /mes malo/.test(texto) ? '20 %' : 'no';
    const r = JSON.parse((await c.req('POST', '/evaluacion/chat', { form: { texto: di }, headers: { accept: 'application/json' } })).text);
    if (r.error) throw new Error(`«${texto}» → «${di}»: ${r.error}`);
    out.ayudas = [...(out.ayudas || []), r.next && r.next.help];
    texto = r.next && r.next.text;
  }
  return out;
}

test('test gratuito: «no tengo deudas» e ingreso fijo se proponen y, si se aceptan, no se vuelven a preguntar', async () => {
  const config = require('../src/config');
  const { c, u } = await conTest({ deuda: { status: 'NO' }, varia: 'FIXED' });
  config.deepChat = true;
  try {
    const p = await c.get('/evaluacion');
    assert.match(p.url, /conocido$/);
    assert.match(p.text, /No tengo deudas/);
    const { ev, qn } = nueva(u);
    const codes = conocido.candidatos(u.id, ev, qn).map((x) => x.code);
    for (const k of ['moneda_base', 'ingreso_principal', 'deudas', 'caida_ingreso', 'ahorro_disponible', 'dependientes']) assert.ok(codes.includes(k), k);
    await c.post('/evaluacion/conocido', { action: 'usar', ok: codes });
    const hechas = await preguntas(c);
    assert.ok(!hechas.some((q) => /tienes deudas\?|debes|atrasado|tarjetas|mes malo|fuente principal|dependen económicamente|disponible de inmediato/i.test(q)), hechas.join(' | '));
    assert.match(hechas[0], /neta/);
    assert.match((await c.get('/evaluacion/revision')).text, /No tengo deudas/);
    assert.ok(hechas.ayudas.some((a) => /En tu test dijiste .*900.*150/.test(a || '')), 'recuerda los gastos del test al pedir el detalle');
  } finally {
    config.deepChat = false;
  }
});

test('test gratuito: si no se usan esos datos, se pregunta todo; y si dijo que tiene deudas, siempre se preguntan', async () => {
  const config = require('../src/config');
  const a = await conTest({ deuda: { status: 'NO' }, varia: 'FIXED' });
  config.deepChat = true;
  try {
    await a.c.get('/evaluacion');
    await a.c.post('/evaluacion/conocido', { action: 'ninguno' });
    const { ev, qn } = nueva(a.u);
    assert.equal(Object.keys(qs.answers(ev.id)).length, 0, 'no se guardó nada');
    assert.equal(qs.firstUnanswered(qn, {}), 1);
    const b = await conTest({ deuda: { status: 'DUE', monthly_due: { amount: '400' } }, varia: 'HIGH' });
    const n = nueva(b.u);
    const codes = conocido.candidatos(b.u.id, n.ev, n.qn).map((x) => x.code);
    assert.ok(!codes.includes('deudas') && !codes.includes('caida_ingreso'), codes.join());
  } finally {
    config.deepChat = false;
  }
});
