'use strict';
// «Especificación del resultado gratuito» V2 (13-11-2026): casos de aceptación §9.
// Títulos compatibles con el saldo, «No lo sé» ≠ cero, textos incoherentes fuera del
// resultado, sin trabajo extra sin tiempo, sin números de pregunta y oferta USD 69.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const config = require('../src/config');
const engine = require('../src/domain/free/engine');
const cat = require('../src/domain/free/catalog4');
const result4 = require('../src/domain/free/result4');
const view = require('../src/views/freeTest4');

const V4 = 'FREE_24_V4_ES';
// Caso del documento (§6): PEN 3.000 de ingreso, 2.000 básicos, 1.000 otros, sin deudas, sin reserva, de 3 a 7 horas.
const CASE = {
  Q01: { country: 'PE', currency: 'PEN' },
  Q02: { codes: ['A25_34'] },
  Q03: { codes: ['D0'] },
  Q04: { codes: ['EMPLOYEE'] },
  Q05: { code: 'INCOME', horizon: 'M6' },
  Q06: { amount: '3000' },
  Q07: { codes: ['SIMILAR'] },
  Q08: { amount: '2000' },
  Q09: { amount: '1000' },
  Q10: { status: 'NO' },
  Q13: { amount: '0' },
  Q14: { codes: ['NONE'] },
  Q15: { codes: ['EQUIPMENT'] },
  Q16: { codes: ['H3_7'] },
  Q17: { codes: ['SELL'] },
  Q18: { codes: ['COMMERCE'] },
  Q19: { codes: ['UNPAID'] },
  Q20: { codes: ['FRIENDS'] },
  Q21: { codes: ['GROWTH'] },
  Q22: { codes: ['KEEP_JOB'] },
  Q23: { availability: 'NO' },
  Q24: { codes: ['SELL_SERVICE'] },
};

function put(sid, slot, value) {
  const s = engine.loadSession(sid);
  const r = engine.questionAt(s, slot);
  if (!r.question) return null;
  return engine.saveAnswer(sid, slot, { variant_id: r.question.variant_id, expected_revision: s.revision, value });
}
function finish(answers) {
  const s = engine.createSession({ consent: true, versionId: V4 }).session;
  for (const q of cat.SLOTS) if (answers[q.slot_id] !== undefined) put(s.id, q.slot_id, answers[q.slot_id]);
  engine.complete(s.id);
  const diag = engine.getDiagnostic(s.id);
  return { id: s.id, r: diag.result, answers: engine.activeAnswers(s.id) };
}
const all = (r) => JSON.stringify(r);
const page = (x, user = null) => String(view.resultPage({}, { result: x.r, answers: x.answers, user, products: [{ code: 'paquete', price_cents: 6900, currency: 'USD' }], owned: {}, completedAt: new Date().toISOString() }));

test.before(() => h.start());
test.after(() => h.stop());

test('Spec 1: saldo 0 → «no queda libre», nunca «tienes margen», reserva 0 confirmada', () => {
  const x = finish(CASE);
  assert.equal(x.r.metrics.find((m) => m.id === 'monthly_balance').value, '0.00');
  assert.match(x.r.conclusion.title, /no queda libre al final del mes/);
  assert.doesNotMatch(all(x.r), /tienes margen|te sobra|reserva pequeña/i);
  assert.match(x.r.screen.strength, /No declaras deudas/);
  assert.match(x.r.screen.brake, /otros gastos suman PEN 1\.000/);
  assert.equal(x.r.screen.improvement.title, 'Recuperar margen cada mes');
  const html = page(x);
  assert.match(html, /Tu primer mapa financiero/);
  assert.match(html, /0 meses/);
  assert.match(html, /Cuotas de deuda del mes<\/th><td class="num">No aplica/);
});

test('Spec 2: saldo negativo → estabilizar, sin inversión ni crédito nuevo', () => {
  const x = finish({ ...CASE, Q06: { amount: '2500' } });
  assert.equal(x.r.metrics.find((m) => m.id === 'monthly_balance').value, '-500.00');
  assert.match(x.r.conclusion.title, /superan lo que recibes/);
  assert.equal(x.r.first_action.kind, 'RECORD');
  assert.doesNotMatch(all(x.r), /invierte|invertir en/i);
  assert.match(page(x), /Te falta al mes/);
});

test('Spec 3: saldo positivo → «podría quedarte», estimación y no ahorro', () => {
  const x = finish({ ...CASE, Q06: { amount: '4000' }, Q09: { amount: '900' } });
  assert.equal(x.r.metrics.find((m) => m.id === 'monthly_balance').value, '1100.00');
  assert.match(x.r.conclusion.title, /podría quedarte PEN 1\.100/);
  assert.match(x.r.conclusion.interpretation, /no un ahorro comprobado/);
});

test('Spec 4 y 5: sin deudas (en Q10 o en Q11 después de marcar deuda) → cuotas 0 y nada de deuda', () => {
  const a = finish(CASE);
  assert.equal(a.r.screen.figures.dues, null);
  assert.doesNotMatch(all(a.r.first_action), /deuda|refinanc/i);
  const b = finish({ ...CASE, Q10: { status: 'DUE', monthly_due: { amount: '300' } }, Q11: { codes: ['NONE'] } });
  assert.equal(b.r.metrics.find((m) => m.id === 'monthly_balance').value, '0.00');
  assert.equal(b.r.screen.figures.dues, null);
});

test('Spec 6: «No lo sé» en la reserva → nunca 0 ni meses calculados', () => {
  const x = finish({ ...CASE, Q13: { special: 'DK' } });
  assert.equal(x.r.metrics.find((m) => m.id === 'committed_reserve_months').value, null);
  assert.equal(x.r.screen.figures.reserve_months, null);
  const html = page(x);
  assert.doesNotMatch(html, /0 meses/);
  assert.match(html, /No hay datos suficientes/);
});

test('Contrato: cada bloque trae confianza, fuente y datos faltantes', () => {
  const ok = finish(CASE);
  const h0 = ok.r.screen.trace.find((x) => x.block === 'hallazgo');
  assert.equal(h0.confidence, 'media');
  assert.deepEqual(h0.missing, []);
  assert.ok(h0.sources.includes('income_monthly'));
  const dk = finish({ ...CASE, Q13: { special: 'DK' } });
  const res = dk.r.screen.trace.find((x) => x.block === 'meses_de_reserva');
  assert.equal(res.confidence, 'baja');
  assert.deepEqual(res.missing, ['emergency_funds']);
  assert.match(page(dk), /Datos que faltaron/);
});

test('Spec 7: con rangos se muestra el intervalo, sin elegir un extremo', () => {
  const x = finish({ ...CASE, Q08: { min: '1800', max: '2200' } });
  assert.equal(x.r.metrics.find((m) => m.id === 'monthly_balance').value, null);
  assert.deepEqual(x.r.balance_range, { min: '-200.00', max: '200.00' });
  assert.match(page(x), /−PEN 200 a PEN 200/);
  assert.match(x.r.screen.headline.title, /Según tus rangos/);
  const pos = finish({ ...CASE, Q06: { amount: '4000' }, Q08: { min: '1800', max: '2200' } });
  assert.match(pos.r.screen.headline.title, /entre PEN 800 y PEN 1\.200/);
});

test('Spec 8: textos incoherentes en «Otro» se rechazan y no llegan al resultado', () => {
  for (const t of ['sdfd', 'nD', 'egfew', 'asdasd']) assert.ok(cat.isGibberish(t), t);
  for (const t of ['hacer pasteles', 'reparar celulares', 'marketing digital', 'clases de inglés']) assert.ok(!cat.isGibberish(t), t);
  const s = engine.createSession({ consent: true, versionId: V4 }).session;
  for (const q of ['Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q06', 'Q07', 'Q08', 'Q09', 'Q10', 'Q13', 'Q14', 'Q15', 'Q16']) put(s.id, q, CASE[q]);
  assert.throws(() => put(s.id, 'Q17', { codes: ['OTHER'], other: 'egfew' }), /se entiendan/);
  const x = finish({ ...CASE, Q17: { codes: ['UNSURE'] }, Q18: { codes: ['NONE'] } });
  assert.equal(x.r.opportunity, null);
});

test('Spec 9: sin tiempo y conservar empleo → sin trabajo adicional', () => {
  const x = finish({ ...CASE, Q06: { amount: '4000' }, Q16: { codes: ['H0'] } });
  assert.equal(x.r.opportunity, null);
  assert.notEqual(x.r.screen.improvement.title, 'Identificar algo que sabes hacer y que alguien necesite');
});

test('Spec 10: sin números de pregunta en los textos ni listas vacías', () => {
  const x = finish({ ...CASE, Q10: { status: 'DUE', monthly_due: { amount: '300' } }, Q11: { codes: ['NONE'] } });
  const html = page(x);
  assert.doesNotMatch(html, /Pregunta \d+|P25|\bQ\d{2}\b/);
  assert.doesNotMatch(html, /<ul[^>]*>\s*<\/ul>/);
  const pkg = result4.buildPackage(engine.loadSession(x.id), x.answers);
  const bad = JSON.parse(JSON.stringify(result4.template(pkg, x.answers)));
  bad.conclusion.interpretation = 'Como dijiste en la pregunta 10, no tienes deudas.';
  assert.equal(result4.validateOutput(bad, pkg).reason, 'QUESTION_NUMBER');
  const margin = JSON.parse(JSON.stringify(result4.template(pkg, x.answers)));
  margin.conclusion.title = 'Tienes margen para crecer';
  assert.match(result4.validateOutput(margin, pkg).reason, /^BALANCE_WORDING/);
  const neg = JSON.parse(JSON.stringify(result4.template(pkg, x.answers)));
  neg.conclusion.interpretation = 'Hoy no tienes margen al final del mes.';
  assert.deepEqual(result4.validateOutput(neg, pkg), { ok: true });
});

test('Spec 11 y 12: cálculo visible, módulos en orden y oferta USD 69 con pago de prueba', () => {
  const x = finish(CASE);
  const html = page(x);
  assert.match(html, /Ver cómo lo calculamos/);
  assert.match(html, /ingreso − gastos básicos − otros gastos − cuotas/);
  assert.match(html, /USD 69/);
  assert.match(html, /Quiero mi Plan Maestro/);
  if (config.payments.gateway === 'sandbox') assert.match(html, /el pago es simulado/);
  const order = ['Tu primer mapa financiero', 'h-hallazgo', 'Lo que esto significa', 'Tu oportunidad de mejora', 'Tu primer paso, gratis', 'Ya sabes por dónde empezar', 'Construye tu Plan Maestro', 'id="como-calculamos"'].map((t) => html.indexOf(t));
  assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  const minor = finish({ ...CASE, Q02: { codes: ['LT18'] } });
  assert.doesNotMatch(page(minor), /Quiero mi Plan Maestro|USD 69/);
});

test('Primer paso: con saldo 0 la IA no puede proponer ventas; se usa el del servidor', () => {
  const x = finish(CASE);
  const pkg = result4.buildPackage(engine.loadSession(x.id), x.answers);
  const ai = JSON.parse(JSON.stringify(result4.template(pkg, x.answers)));
  ai.first_action = { ...ai.first_action, kind: 'CONTACT', instruction: 'Redacta una propuesta de ventas en tres líneas.' };
  const fixed = result4.fixFirstStep(pkg, x.answers, ai);
  assert.match(fixed.first_action.instruction, /anota cada gasto/);
  const pos = finish({ ...CASE, Q06: { amount: '4000' } });
  const pkg2 = result4.buildPackage(engine.loadSession(pos.id), pos.answers);
  const ai2 = JSON.parse(JSON.stringify(result4.template(pkg2, pos.answers)));
  ai2.first_action = { ...ai2.first_action, instruction: 'Redacta una propuesta de ventas en tres líneas.' };
  assert.match(result4.fixFirstStep(pkg2, pos.answers, ai2).first_action.instruction, /propuesta de ventas/);
});
