'use strict';
// Plan Maestro completo: de la evaluación en chat (v3) a los 14 puntos, la pantalla, el PDF y el patrimonio.
process.env.DEEP_QUESTIONNAIRE_VERSION = '3';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const config = require('../src/config');
const qs = require('../src/domain/questionnaire');
const deep = require('../src/domain/deep');
const planDomain = require('../src/domain/plan');
const rulesRepo = require('../src/domain/rules');
const tracker = require('../src/domain/tracker');
const deepChat = require('../src/domain/deepChat');
const conocido = require('../src/domain/deepConocido');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

const IDS = Array.from({ length: 14 }, (_, i) => `PM${String(i + 1).padStart(2, '0')}`);
const A = (value) => ({ value, unknown: false, skipped: false });
const BASE = {
  moneda_base: A('BOB'), ingreso_principal: A({ amount: '4000.00', period: 'mensual' }), ingreso_es_neto: A('neto'), ingresos_adicionales: A({ amount: '0.00', period: 'mensual' }), caida_ingreso: A('0'),
  gastos_desglose: A({ vivienda: '1000.00', alimentacion: '900.00', transporte: '200.00', servicios: '200.00', salud: '0.00', educacion: '0.00', ocio: '300.00', otros: '0.00' }), gastos_anuales: A('0.00'),
  deudas: A([{ name: 'Tarjeta de crédito', kind: 'tarjeta', balance: '5000.00', payment: '400.00', rate: null, rate_type: 'desconocido', fees: null }]), atraso_actual: A('no'), pago_tarjeta: A('mas_minimo'),
  ahorro_mensual: A({ amount: '200.00', period: 'mensual' }), ahorro_disponible: A('2000.00'), ahorro_no_disponible: A('0.00'), dependientes: A(1), cobertura_salud: A('si'), respaldo_ingreso: A('parcial'), gastos_previstos: A(['ninguno']),
  gasto_reducible: A({ amount: '100.00', period: 'mensual' }), ingreso_extra_posible: A({ amount: '0.00', period: 'mensual' }), bienes_vendibles: A('0.00'), metas: A([]), prioridad: A('deuda'), ajuste_gasto: A('poco'),
  actividad: A('EMPLOYEE'), negocio_situacion: A('NO'), activos: A({ inmuebles: '0.00', terrenos: '0.00', vehiculos: '8000.00', inversiones: '0.00', negocio: '0.00', equipos: '0.00', otros: '0.00' }), horas_semana: A('H8_14'), habilidades: A(['SELL', 'DIGITAL']), a_quien_ofrecer: A(['FRIENDS']),
  habitos: A(['ANOTA', 'IMPULSO']), perfil_riesgo: A('B'), reaccion_perdida: A('CALMA'), objetivo_ingreso: A('7000.00'), objetivo_patrimonio: A('100000.00'), objetivo_plazo: A('3'), motivacion: A('FAMILIA'),
};
const build = (over = {}, drop = []) => {
  const map = { ...BASE, ...over };
  for (const k of drop) delete map[k];
  const rules = rulesRepo.current().rules;
  const diag = deep.diagnose(map, rules);
  return { diag, content: planDomain.buildContent(diag, rules, '2026-11-25') };
};
const sec = (m, id) => m.sections.find((x) => x.id === id);

function sano(m) {
  assert.deepEqual(m.sections.map((x) => x.id), IDS);
  const todo = JSON.stringify(m);
  assert.doesNotMatch(todo, /NaN|undefined|Infinity|\[object|"null"|: null,/);
  assert.doesNotMatch(todo, /garantizad|rentabilidad asegurada|sin riesgo|bitcoin|cripto|renuncia a/i);
  for (const x of m.sections) {
    assert.ok(x.title && x.intro && x.blocks.length, x.id);
    for (const b of x.blocks) if (b.type === 'table') for (const r of b.rows) assert.equal(r.length, b.head.length, `${x.id}: columnas`);
  }
  const acc = sec(m, 'PM02').blocks[0].items.length;
  assert.ok(acc >= 3 && acc <= 7, `acciones: ${acc}`);
  assert.equal(sec(m, 'PM14').blocks[0].items.length, 5);
}

test('los 14 puntos salen completos y sanos para personas muy distintas', () => {
  const casos = [
    build(),
    build({ gastos_desglose: A({ vivienda: '3000.00', alimentacion: '2500.00', transporte: '0.00', servicios: '0.00', salud: '0.00', educacion: '0.00', ocio: '0.00', otros: '0.00' }), atraso_actual: A('mas_30'), habitos: A(['PIDE', 'MINIMO', 'PRESTA']), reaccion_perdida: A('DOBLE') }),
    build({ deudas: A([]), ahorro_disponible: A('90000.00'), actividad: A('BUSINESS'), negocio_situacion: A('DEPENDE'), perfil_riesgo: A('A') }),
    build({ actividad: A('NONE'), horas_semana: A('H0'), habilidades: A(['UNSURE']), a_quien_ofrecer: A(['NOBODY']), habitos: A(['NINGUNO']) }),
    build({ activos: { value: null, unknown: true }, objetivo_ingreso: { value: null, unknown: true }, objetivo_patrimonio: { value: null, unknown: true } }),
    build({}, ['actividad', 'negocio_situacion', 'activos', 'horas_semana', 'habilidades', 'a_quien_ofrecer', 'habitos', 'perfil_riesgo', 'reaccion_perdida', 'objetivo_ingreso', 'objetivo_patrimonio', 'objetivo_plazo', 'motivacion']),
    build({ deudas: A([{ name: 'Préstamo', kind: 'personal', balance: '3000.00', payment: '300.00', rate: '24', rate_type: 'nominal_anual', fees: null }]) }),
  ];
  for (const skill of ['SELL', 'ORGANIZE', 'DIGITAL', 'MANUAL', 'COOK', 'TEACH', 'CREATE', 'DRIVE', 'OTHER']) casos.push(build({ habilidades: A([skill]) }));
  for (const c of casos) sano(c.content.maestro);
});

test('patrimonio, escalones y tabla de objetivos usan las cifras de la persona', () => {
  const { content } = build();
  const m = content.maestro;
  assert.equal(m.netWorth, '5000.00', '8.000 de moto + 2.000 ahorrados − 5.000 de deuda');
  const t13 = sec(m, 'PM13').blocks[0];
  assert.equal(t13.rows.length, 4);
  const num = (s) => Number(String(s).replace(/[^\d,]/g, '').replace(',', '.'));
  assert.equal(num(t13.rows[2][1]), 5000, 'a un año: un tercio del camino de 4.000 a 7.000');
  assert.equal(num(t13.rows[3][1]), 7000, 'a tres años: la meta');
  const t6 = sec(m, 'PM06').blocks[0];
  assert.ok(t6.rows.some((r) => r[0] === 'Tu objetivo' && num(r[1]) === 100000));
  assert.match(sec(m, 'PM10').blocks.at(-1).text, /No supone rendimientos/);
  assert.match(sec(m, 'PM10').blocks[0].rows[1][3], /Falta la tasa/, 'sin tasa no inventa cuánto baja la deuda');
});

test('con saldo negativo o atraso no propone poner dinero y la primera decisión es ordenar', () => {
  const { content } = build({ gastos_desglose: A({ vivienda: '3000.00', alimentacion: '2500.00', transporte: '0.00', servicios: '0.00', salud: '0.00', educacion: '0.00', ocio: '0.00', otros: '0.00' }), atraso_actual: A('mas_30') });
  const m = content.maestro;
  assert.match(sec(m, 'PM14').blocks[0].items[0].title, /al día/);
  assert.match(JSON.stringify(sec(m, 'PM12')), /Nada por ahora: prueba sin gastar/);
  assert.match(JSON.stringify(sec(m, 'PM08')), /Ninguna por ahora/);
});

test('mismos datos, mismo plan; y la mejor idea cambia con la habilidad', () => {
  assert.deepEqual(build().content.maestro, build().content.maestro);
  const cook = build({ habilidades: A(['COOK']), actividad: A('OTHER') }).content.maestro;
  assert.ok(JSON.stringify(sec(cook, 'PM04')).includes('Comida'));
});

test('chat: bienes con «ninguno», «casa y moto» y «no lo sé»', () => {
  const { DEEP_V3 } = require('../src/db/content-deep-v3');
  const q = { ...DEEP_V3.questions.find((x) => x.code === 'activos') };
  const none = deepChat.nextStep(q, {}, 'BOB').apply('ninguno');
  assert.equal(deepChat.nextStep(q, none.body, 'BOB'), null);
  const r0 = qs.parseSubmission(q, deepChat.toSubmission(q, none.body), 'BOB');
  assert.ok(r0.ok && Object.values(r0.value).every((v) => Number(v) === 0));
  let b = deepChat.nextStep(q, {}, 'BOB').apply('casa y moto').body;
  assert.deepEqual([...b.pick].sort(), ['inmuebles', 'vehiculos']);
  for (let i = 0; i < 2; i++) {
    const s = deepChat.nextStep(q, b, 'BOB');
    assert.match(s.text, /Cuánto vale aproximadamente/);
    b = s.apply('10000').body;
  }
  assert.ok(qs.parseSubmission(q, deepChat.toSubmission(q, b), 'BOB').ok);
  assert.equal(deepChat.nextStep(q, {}, 'BOB').apply('no lo sé').unknown, true);
});

const DI = [
  [/moneda/i, 'bolivianos'], [/fuente principal/i, '4000 al mes'], [/neta/i, 'sí'], [/otros ingresos/i, 'no'], [/mes malo/i, 'no baja'], [/en qué gastas/i, 'comida y alquiler'], [/gastas al mes en/i, '900'], [/veces al año/i, 'no'], [/¿Tienes deudas/i, 'no tengo'],
  [/Apartas/i, 'sí, 200 al mes'], [/disponible de inmediato/i, '2000'], [/no puedes retirar/i, 'no'], [/dependen económicamente/i, 'ninguna'], [/seguro o servicio/i, 'no'], [/ingreso se detuviera/i, 'no'], [/gasto importante/i, 'ninguno'], [/dejar de gastar/i, 'no'], [/ingreso extra/i, 'no'], [/podrías vender/i, 'no'],
  [/metas quieres/i, 'aún no tengo'], [/más importante/i, 'construir mi fondo'], [/ajustar tus gastos/i, 'un poco'],
  [/Cómo trabajas/i, 'soy empleado'], [/Tienes un negocio/i, 'no tengo negocio'], [/podrías invertir/i, '500'], [/bienes tienes/i, 'moto'], [/Cuánto vale/i, '8000'], [/tiempo a la semana/i, 'de 8 a 14 horas'], [/se te da mejor/i, 'vender'], [/ofrecerle/i, 'amigos'], [/hábitos/i, 'anoto mis gastos'], [/frase te describe/i, 'acepto altibajos moderados'], [/perdiste dinero/i, 'mantuve la calma'], [/gustaría ganar/i, '7000'], [/Cuánto patrimonio/i, '100 mil'], [/cuánto tiempo te gustaría/i, '3 años'], [/Para qué quieres/i, 'mi familia'],
];

test('de punta a punta: evaluación en chat → diagnóstico → plan con 14 puntos → pantalla y PDF', async () => {
  const c = new h.Client();
  await h.consent(c);
  await h.registerUser(c, 'maestro@ejemplo.test');
  await h.payViaWebhook(c, 'paquete');
  config.deepChat = true;
  try {
    let page = await c.get('/evaluacion');
    if (/conocido/.test(page.url)) await c.post('/evaluacion/conocido', { action: 'ninguno' });
    page = await c.get('/evaluacion?empezar=1');
    let t = page.text.match(/chat-msg--bot chat-q">([^<]+)</)[1];
    let r;
    const hechas = [];
    for (let i = 0; i < 70 && t; i++) {
      hechas.push(t);
      const d = DI.find(([re]) => re.test(t));
      assert.ok(d, `sin respuesta para «${t}»`);
      h.resetRateLimits();
      r = JSON.parse((await c.req('POST', '/evaluacion/chat', { form: { texto: d[1] }, headers: { accept: 'application/json' } })).text);
      assert.ok(!r.error, `«${t}» → «${d[1]}»: ${r.error}`);
      if (r.done) break;
      t = r.next.text;
    }
    assert.ok(r.done, hechas.at(-1));
    assert.ok(hechas.some((x) => /patrimonio/.test(x)));
  } finally {
    config.deepChat = false;
  }
  const rev = await c.get('/evaluacion/revision');
  assert.match(rev.text, /Para qué quieres lograrlo/);
  // El resumen se muestra y hay que confirmarlo.
  assert.match(rev.text, /Mi contexto financiero actual/);
  assert.match(rev.text, /Patrimonio neto/);
  assert.doesNotMatch(rev.text, /Ventas al mes/, 'sin negocio no se muestran sus datos');
  assert.match((await c.post('/evaluacion/finalizar', {})).text, /Confirma que el resumen representa tu situación actual/);
  await c.post('/evaluacion/finalizar', { ack: [...rev.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]) });
  await c.post('/plan/generar', { start_date: '2026-11-25' });
  await h.queue.drain({ ignoreSchedule: true });
  const page = await c.get('/plan');
  for (const id of IDS) assert.match(page.text, new RegExp(`id="${id.toLowerCase()}"`), id);
  assert.match(page.text, /Las cinco decisiones más importantes ahora/);
  assert.match(page.text, /Patrimonio neto/);
  const u = h.db.one("SELECT id FROM users WHERE email = 'maestro@ejemplo.test'");
  const plan = planDomain.current(u.id);
  const pdf = await fetch(`${page.url.replace('/plan', '')}/plan/version/${plan.id}/pdf`, { headers: { cookie: c.cookieHeader() } });
  assert.equal(pdf.status, 200);
  assert.ok((await pdf.arrayBuffer()).byteLength > 12000);
  // El patrimonio llega a la calculadora y se puede corregir.
  assert.equal(tracker.netWorth(u.id).owned.toFixed(2), '8000.00');
  assert.match((await c.get('/calculadora/patrimonio')).text, /Auto o moto/);
  const a = tracker.assets(u.id)[0];
  await c.post(`/calculadora/patrimonio/${a.id}`, { value: '9000' });
  assert.equal(tracker.netWorth(u.id).owned.toFixed(2), '9000.00');
  assert.equal((await c.post('/calculadora/patrimonio', { name: '', kind: 'otros', value: '-3' })).status, 422);
  await c.post('/calculadora/patrimonio', { name: 'Terreno', kind: 'terrenos', value: '20000' });
  assert.equal(tracker.netWorth(u.id).owned.toFixed(2), '29000.00');
  // Otra persona no puede tocarlo.
  const o = new h.Client();
  await h.consent(o);
  await h.registerUser(o, 'maestro2@ejemplo.test');
  await h.payViaWebhook(o, 'paquete');
  assert.equal((await o.post(`/calculadora/patrimonio/${a.id}/eliminar`, {}, { follow: false })).status, 404);
  assert.equal(tracker.assets(u.id).length, 2);
  const exp = require('../src/domain/privacy').exportUser(u.id);
  assert.equal(exp.bienes.length, 2);
});

test('lo que ya dijo en el test gratuito (actividad, horas, habilidades, contactos) se propone', async () => {
  const engine = require('../src/domain/free/engine');
  const cat = require('../src/domain/free/catalog4');
  const c = new h.Client();
  await h.consent(c);
  await h.registerUser(c, 'maestro3@ejemplo.test');
  const u = h.db.one("SELECT id FROM users WHERE email = 'maestro3@ejemplo.test'");
  const R = { Q01: { country: 'BO', currency: 'BOB' }, Q02: { codes: ['A25_34'] }, Q03: { codes: ['D1'] }, Q04: { codes: ['EMPLOYEE'] }, Q05: { code: 'INCOME', horizon: 'M6' }, Q06: { amount: '2500' }, Q07: { codes: ['FIXED'] }, Q08: { amount: '900' }, Q09: { amount: '150' }, Q10: { status: 'NO' }, Q13: { amount: '2000' }, Q14: { codes: ['NONE'] }, Q15: { codes: ['EQUIPMENT'] }, Q16: { codes: ['H15_25'] }, Q17: { codes: ['COOK', 'SELL'] }, Q18: { codes: ['FOOD'] }, Q19: { codes: ['UNPAID'] }, Q20: { codes: ['FRIENDS'] }, Q21: { codes: ['GROWTH'] }, Q22: { codes: ['KEEP_JOB'] }, Q23: { availability: 'NO' }, Q24: { codes: ['SELL_SERVICE'] } };
  const s = engine.createSession({ userId: u.id, consent: true, versionId: 'FREE_24_V4_ES' }).session;
  for (const q of cat.SLOTS) {
    const cur = engine.loadSession(s.id);
    const r = engine.questionAt(cur, q.slot_id);
    if (r.question) engine.saveAnswer(s.id, q.slot_id, { variant_id: r.question.variant_id, expected_revision: cur.revision, value: R[q.slot_id] });
  }
  engine.complete(s.id);
  const ev = qs.startEvaluation('profundo', { userId: u.id });
  const qn = qs.load(ev.questionnaire_id);
  const by = Object.fromEntries(conocido.candidatos(u.id, ev, qn).map((x) => [x.code, x]));
  assert.deepEqual(by.habilidades.value, ['COOK', 'SELL']);
  const yo = require('../src/domain/contexto').build(u.id, qn, BASE, 'BOB').groups[0].rows;
  assert.match(JSON.stringify(yo), /Bolivia/);
  assert.match(JSON.stringify(yo), /25/);
  for (const k of ['actividad', 'horas_semana', 'a_quien_ofrecer']) assert.ok(by[k] && by[k].text, k);
  for (const q of qn.questions) if (by[q.code] && ['single', 'multi'].includes(q.type)) for (const v of [].concat(by[q.code].value)) assert.ok(q.options.some((o) => o.value === v), `${q.code}: ${v}`);
});

test('un plan anterior sin los 14 puntos se sigue viendo y explica cómo actualizarlo', () => {
  const { maestroView } = require('../src/views/maestro');
  assert.match(String(maestroView(undefined)), /Esta versión del plan es anterior/);
});

const preguntaV3 = (code) => ({ options: [], config: {}, ...require('../src/db/content-deep-v3').DEEP_V3.questions.find((x) => x.code === code) });
const conversar = (q, textos) => {
  let body = {};
  for (const t of textos) {
    const s = deepChat.nextStep(q, body, 'BOB');
    assert.ok(s, `sobra «${t}»`);
    const r = s.apply(t);
    assert.ok(!r.error, `«${s.text}» → «${t}»: ${r.error}`);
    body = r.body;
  }
  assert.equal(deepChat.nextStep(q, body, 'BOB'), null);
  const p = qs.parseSubmission(q, deepChat.toSubmission(q, body), 'BOB');
  assert.ok(p.ok, JSON.stringify(p.errors));
  return p.value;
};

test('deudas en el chat: interés y plazo, con «no lo sé», sin interés y periodo aclarado', () => {
  const q = preguntaV3('deudas');
  const deuda = (...t) => conversar(q, ['sí', 'tarjeta', '5000', '400', ...t])[0];
  const ver = (d) => [d.rate === null ? null : Number(d.rate), d.rate_type, d.term ?? null];
  assert.deepEqual(ver(deuda('24 % al año', '18 meses')), [24, 'nominal_anual', 18]);
  assert.deepEqual(ver(deuda('2,5% mensual', 'un año y medio')), [2.5, 'mensual', 18]);
  assert.deepEqual(ver(deuda('36', 'al año', '2 años')), [36, 'nominal_anual', 24]);
  assert.deepEqual(ver(deuda('36', 'no lo sé', 'no sé')), [null, 'desconocido', null]);
  assert.deepEqual(ver(deuda('no lo sé', '12')), [null, 'desconocido', 12]);
  assert.deepEqual(ver(deuda('no me cobran interés', 'no tiene fecha')), [0, 'nominal_anual', null]);
  const paso = deepChat.nextStep(q, { hasDebt: 'si', kinds: ['tarjeta'], k: { tarjeta: { balance: '1', payment: '1' } } }, 'BOB');
  for (const malo of ['bastante', '900 %', '2 % por semana']) assert.ok(paso.apply(malo).error, malo);
  // La tasa y el plazo llegan al plan.
  const { content } = build({ deudas: A([deuda('24 % al año', '18 meses')]) });
  const t = sec(content.maestro, 'PM01').blocks.find((b) => b.title === 'Tus deudas');
  assert.deepEqual(t.rows[0].slice(3), ['24 % al año', '18 meses']);
});

test('negocio: solo se pregunta a quien lo tiene y el plan usa su margen y su problema', () => {
  const q = preguntaV3('negocio_ventas');
  assert.equal(qs.isApplicable(q, { negocio_situacion: A('NO') }), false);
  assert.equal(qs.isApplicable(q, { negocio_situacion: A('DEPENDE') }), true);
  assert.equal(conversar(preguntaV3('negocio_clientes'), ['15 clientes']), 'C10_30');
  assert.equal(conversar(preguntaV3('negocio_clientes'), ['200']), 'C31');
  assert.equal(conversar(preguntaV3('negocio_problema'), ['me pagan tarde']), 'COBROS');
  const N = { actividad: A('BUSINESS'), negocio_situacion: A('DEPENDE'), negocio_ventas: A('10000.00'), negocio_ganancia: A('2500.00'), negocio_clientes: A('C10_30'), negocio_recurrencia: A('ALGUNOS'), negocio_equipo: A('SOLO'), negocio_problema: A('MARGEN') };
  const m = build(N).content.maestro;
  sano(m);
  const b = sec(m, 'PM01').blocks.find((x) => x.title === 'Tu negocio');
  assert.equal(b.items.find((x) => /cada 100/.test(x.k)).v, '25');
  assert.match(JSON.stringify(sec(m, 'PM09')), /subir de precio/);
  assert.match(JSON.stringify(sec(m, 'PM05')), /pocos clientes vuelven/);
  const raro = build({ ...N, negocio_ganancia: A('20000.00') }).content.maestro;
  sano(raro);
  assert.match(JSON.stringify(sec(raro, 'PM01')), /ganancia mayor que tus ventas/);
  sano(build({ ...N, negocio_ventas: { value: null, unknown: true }, negocio_ganancia: A('0.00') }).content.maestro);
});

test('capital: limita lo que se propone arriesgar y no se toca con atraso o saldo negativo', () => {
  const con = JSON.stringify(build({ capital_invertir: A('3000.00') }).content.maestro);
  assert.match(con, /décima parte/);
  assert.match(JSON.stringify(build({ capital_invertir: A('0.00') }).content.maestro.sections), /prueba sin gastar/);
  const mal = build({ capital_invertir: A('3000.00'), atraso_actual: A('mas_30') }).content.maestro;
  sano(mal);
  assert.match(JSON.stringify(sec(mal, 'PM12')), /No se toca hasta/);
  assert.doesNotMatch(JSON.stringify(mal), /décima parte/);
});

test('chat: propone lo que se dijo antes y solo lo guarda si la persona confirma', async () => {
  const c = new h.Client();
  await h.consent(c);
  await h.registerUser(c, 'maestro4@ejemplo.test');
  await h.payViaWebhook(c, 'paquete');
  const u = h.db.one("SELECT id FROM users WHERE email = 'maestro4@ejemplo.test'");
  const guarda = (ev, qn, map) => {
    for (const q of qn.questions) if (map[q.code]) qs.saveAnswer(ev, q, { ok: true, unknown: Boolean(map[q.code].unknown), value: map[q.code].value });
  };
  const ev1 = qs.startEvaluation('profundo', { userId: u.id });
  const qn = qs.load(ev1.questionnaire_id);
  guarda(ev1, qn, { ...BASE, capital_invertir: A('500.00') });
  h.db.run("UPDATE evaluations SET status = 'finalizada', completed_at = ? WHERE id = ?", h.db.now(), ev1.id);
  const ev2 = qs.startEvaluation('profundo', { userId: u.id });
  const sin = { ...BASE, capital_invertir: A('500.00') };
  delete sin.prioridad;
  delete sin.ajuste_gasto;
  guarda(ev2, qn, sin);
  config.deepChat = true;
  try {
    const page = await c.get('/evaluacion?empezar=1');
    assert.match(page.text, /Antes dijiste/);
    assert.match(page.text, /Sí, sigue igual/);
    assert.equal(qs.answers(ev2.id).prioridad, undefined, 'nada se guarda solo');
    const env = async (texto) => JSON.parse((await c.req('POST', '/evaluacion/chat', { form: { texto }, headers: { accept: 'application/json' } })).text);
    const r = await env('Sí, sigue igual');
    assert.equal(qs.answers(ev2.id).prioridad.value, 'deuda');
    assert.match(r.next.help, /Antes dijiste/);
    await env('nada');
    const a = qs.answers(ev2.id).ajuste_gasto;
    assert.ok(a && a.value !== 'poco', 'si cambió, vale la respuesta nueva');
  } finally {
    config.deepChat = false;
  }
});
