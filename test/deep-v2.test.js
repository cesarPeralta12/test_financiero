'use strict';
// Evaluación profunda v2: respuestas con botones. Misma forma de datos que la v1, así que
// el diagnóstico y el plan funcionan igual; menos campos para escribir.
process.env.DEEP_QUESTIONNAIRE_VERSION = '2';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const qs = require('../src/domain/questionnaire');
const deep = require('../src/domain/deep');

const V2 = {
  moneda_base: { value: 'MXN' },
  ingreso_principal: { amount: '30000', period: 'mensual' },
  ingreso_es_neto: { value: 'neto' },
  ingresos_adicionales: { has: 'no' },
  caida_ingreso: { value: '10' },
  gastos_desglose: { pick: ['vivienda', 'alimentacion', 'transporte', 'ocio'], f: { vivienda: '8000', alimentacion: '5000', transporte: '2000', ocio: '1500' } },
  gastos_anuales: { has: 'si', amount: '6000' },
  deudas: { kinds: ['tarjeta', 'personal'], k: { tarjeta: { balance: '40000', payment: '2500', rate: '48', rate_period: 'anual' }, personal: { balance: '20000', payment: '2000', rate_unknown: '1' } } },
  atraso_actual: { value: 'no' },
  pago_tarjeta: { value: 'mas_minimo' },
  ahorro_mensual: { has: 'si', amount: '1500', period: 'mensual' },
  ahorro_disponible: { amount: '8000' },
  ahorro_no_disponible: { has: 'no' },
  dependientes: { value: '1' },
  cobertura_salud: { value: 'si' },
  respaldo_ingreso: { value: 'parcial' },
  gastos_previstos: { value: ['ninguno'] },
  gasto_reducible: { has: 'no' },
  ingreso_extra_posible: { has: 'si', amount: '2000', period: 'mensual' },
  bienes_vendibles: { has: 'no' },
  metas: { kinds: ['emergencias', 'otra'], gk: { emergencias: { target: '30000', months: '12' }, otra: { name: 'Viaje familiar', target: '15000', months: '0' } } },
  prioridad: { value: 'deuda' },
  ajuste_gasto: { value: 'poco' },
};

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

async function buyer(email) {
  const c = new h.Client();
  await h.consent(c);
  await h.registerUser(c, email);
  await h.payViaWebhook(c, 'paquete');
  return c;
}

test('v2 publicada: sin gasto total ni pago total de deudas, y sin cuadros de texto largos', async () => {
  const qn = qs.published('profundo');
  assert.equal(qn.version, 2);
  const codes = qn.questions.map((q) => q.code);
  assert.ok(!codes.includes('gasto_total'));
  assert.ok(!codes.includes('pago_deudas_total'));
  const c = await buyer('v2-paginas@ejemplo.test');
  for (let n = 1; n <= qn.questions.length; n += 1) {
    const p = await c.get(`/evaluacion/pregunta/${n}`);
    assert.doesNotMatch(p.text, /<textarea/, `pregunta ${n}`);
    assert.doesNotMatch(p.text, /Tipo de tasa/, `pregunta ${n}`);
  }
});

test('v2: recorrido completo con botones y cifras iguales a la v1', async () => {
  const c = await buyer('v2-recorrido@ejemplo.test');
  await h.answerAll(c, '/evaluacion', V2);
  const ev = h.db.one("SELECT * FROM evaluations WHERE kind = 'profundo' ORDER BY id DESC LIMIT 1");
  const map = qs.answers(ev.id);
  // Gastos: lo no marcado es 0; el total lo suma el sistema.
  assert.deepEqual(map.gastos_desglose.value, { vivienda: '8000.00', alimentacion: '5000.00', transporte: '2000.00', servicios: '0.00', salud: '0.00', educacion: '0.00', ocio: '1500.00', otros: '0.00' });
  // Deudas: nombre = tipo; interés opcional («No sé» → desconocido).
  assert.deepEqual(map.deudas.value.map((d) => [d.kind, d.balance, d.payment, d.rate, d.rate_type]), [
    ['tarjeta', '40000.00', '2500.00', '48', 'nominal_anual'],
    ['personal', '20000.00', '2000.00', null, 'desconocido'],
  ]);
  assert.equal(map.ingresos_adicionales.value.amount, '0.00');
  assert.equal(map.bienes_vendibles.value, '0.00');
  assert.deepEqual(map.metas.value.map((g) => [g.name, g.target, g.months]), [
    ['Fondo para emergencias', '30000.00', 12],
    ['Viaje familiar', '15000.00', null],
  ]);
  const f = deep.figures(map);
  assert.equal(f.expenses.toFixed(2), '17000.00'); // 16.500 + 6.000 / 12
  assert.equal(f.debtPayments.toFixed(2), '4500.00');
  assert.equal(f.debtPaymentsDeclared, null);
  // Sin contradicciones de «total declarado» que bloqueen.
  const rev = await c.get('/evaluacion/revision');
  assert.doesNotMatch(rev.text, /declaraste un total/);
  const acks = [...rev.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]);
  const fin = await c.post('/evaluacion/finalizar', { ack: acks });
  assert.ok([200, 303].includes(fin.status));
  assert.equal(h.db.one('SELECT status FROM evaluations WHERE id = ?', ev.id).status, 'finalizada');
});

test('v2: «No tengo deudas» salta las preguntas de atrasos y tarjeta; sin tarjeta no se pregunta cómo la pagas', async () => {
  const c = await buyer('v2-sindeudas@ejemplo.test');
  const answers = { ...V2, deudas: { kinds: ['ninguna'] } };
  delete answers.atraso_actual;
  delete answers.pago_tarjeta;
  await h.answerAll(c, '/evaluacion', answers);
  const c2 = await buyer('v2-sintarjeta@ejemplo.test');
  const a2 = { ...V2, deudas: { kinds: ['personal'], k: { personal: { balance: '1000', payment: '100', rate_unknown: '1' } } } };
  delete a2.pago_tarjeta;
  await h.answerAll(c2, '/evaluacion', a2);
});

test('v2: errores claros cuando falta un monto de lo marcado', async () => {
  const c = await buyer('v2-errores@ejemplo.test');
  const qn = qs.published('profundo');
  const pos = (code) => qn.questions.find((q) => q.code === code).position;
  await c.get('/evaluacion');
  const g = await c.post(`/evaluacion/pregunta/${pos('gastos_desglose')}`, { action: 'next', pick: ['vivienda'], f: {} });
  assert.equal(g.status, 422);
  assert.match(g.text, /Escribe cuánto gastas en vivienda/);
  const d = await c.post(`/evaluacion/pregunta/${pos('deudas')}`, { action: 'next', kinds: ['tarjeta'], k: { tarjeta: { payment: '100' } } });
  assert.equal(d.status, 422);
  assert.match(d.text, /cuánto debes en total/);
  const n = await c.post(`/evaluacion/pregunta/${pos('deudas')}`, { action: 'next', kinds: ['ninguna', 'tarjeta'] });
  assert.equal(n.status, 422);
});

test('v2: el ingreso, el dinero guardado y las personas a cargo del test gratuito se sugieren', async () => {
  const engine = require('../src/domain/free/engine');
  const cat = require('../src/domain/free/catalog4');
  const c = await buyer('v2-sugerencias@ejemplo.test');
  const user = h.db.one('SELECT id FROM users WHERE email = ?', 'v2-sugerencias@ejemplo.test');
  const s = engine.createSession({ userId: user.id, consent: true, versionId: 'FREE_24_V4_ES' }).session;
  const put = (slot, value) => {
    const cur = engine.loadSession(s.id);
    const r = engine.questionAt(cur, slot);
    if (r.question) engine.saveAnswer(s.id, slot, { variant_id: r.question.variant_id, expected_revision: cur.revision, value });
  };
  const A = { Q01: { country: 'MX', currency: 'MXN' }, Q02: { codes: ['A25_34'] }, Q03: { codes: ['D2'] }, Q04: { codes: ['EMPLOYEE'] }, Q05: { code: 'INCOME', horizon: 'M6' }, Q06: { amount: '30000' }, Q07: { codes: ['FIXED'] }, Q08: { amount: '15000' }, Q09: { amount: '2000' }, Q10: { status: 'NO' }, Q13: { amount: '8000' }, Q14: { codes: ['NONE'] }, Q15: { codes: ['NONE'] }, Q16: { codes: ['H0'] }, Q17: { codes: ['SELL'] }, Q18: { codes: ['COMMERCE'] }, Q19: { codes: ['NOT_YET'] }, Q20: { codes: ['FRIENDS'] }, Q21: { codes: ['GROWTH'] }, Q22: { codes: ['NONE'] }, Q23: { availability: 'NO' }, Q24: { codes: ['HELP'] } };
  for (const q of cat.SLOTS) if (A[q.slot_id]) put(q.slot_id, A[q.slot_id]);
  engine.complete(s.id);
  await c.get('/evaluacion');
  await c.post('/evaluacion/pregunta/1', { action: 'next', value: 'MXN' });
  const qn = qs.published('profundo');
  const pos = (code) => qn.questions.find((q) => q.code === code).position;
  const inc = await c.get(`/evaluacion/pregunta/${pos('ingreso_principal')}`);
  assert.match(inc.text, /Antes respondiste: <strong>\$30,000\.00|Antes respondiste: <strong>[^<]*30[.,]000/);
  const dep = await c.get(`/evaluacion/pregunta/${pos('dependientes')}`);
  assert.match(dep.text, /Antes respondiste: <strong>2<\/strong>/);
  const used = await c.post(`/evaluacion/pregunta/${pos('ahorro_disponible')}`, { action: 'use_previous' });
  assert.match(used.text, /value="8000/);
});
