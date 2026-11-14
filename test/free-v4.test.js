'use strict';
// Test gratuito V4 (FREE_24_V4_ES) y resultado RESULT_FREE_V4_ES («Correcciones del
// test gratuito», 13-11-2026): 24 preguntas con botones, saltos de deudas e ingreso,
// «Otro» con frase corta, vacío/No lo sé ≠ cero, siete bloques y oferta única.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const config = require('../src/config');
const engine = require('../src/domain/free/engine');
const cat = require('../src/domain/free/catalog4');
const metrics4 = require('../src/domain/free/metrics4');
const result4 = require('../src/domain/free/result4');

const V4 = 'FREE_24_V4_ES';

// Perfil del ejemplo del documento (§7): Bs 5.100 de ingreso, 3.500 básicos, 500 otros, 800 de cuotas, 600 guardados.
const BASE = {
  Q01: { country: 'BO', currency: 'BOB' },
  Q02: { codes: ['A25_34'] },
  Q03: { codes: ['D1'] },
  Q04: { codes: ['EMPLOYEE'] },
  Q05: { code: 'INCOME', horizon: 'M6' },
  Q06: { amount: '5100' },
  Q07: { codes: ['MODERATE'] },
  Q08: { amount: '3500' },
  Q09: { amount: '500' },
  Q10: { status: 'DUE', monthly_due: { amount: '800' } },
  Q11: { codes: ['CARD', 'PERSONAL'], total: { amount: '12000' } },
  Q12: { codes: ['ON_TIME'] },
  Q13: { amount: '600' },
  Q14: { codes: ['NONE'] },
  Q15: { codes: ['EQUIPMENT', 'VEHICLE'] },
  Q16: { codes: ['H8_14'] },
  Q17: { codes: ['SELL', 'MANUAL'] },
  Q18: { codes: ['BUILD', 'COMMERCE'] },
  Q19: { codes: ['PAID_SIDE'] },
  Q20: { codes: ['PAST_CLIENTS', 'BUSINESSES'] },
  Q21: { codes: ['GROWTH'] },
  Q22: { codes: ['KEEP_JOB', 'FAMILY'] },
  Q23: { availability: 'MAYBE', amount: '300' },
  Q24: { codes: ['SELL_SERVICE'] },
};

function start() {
  return engine.createSession({ consent: true, versionId: V4 }).session;
}
function put(sid, slot, value) {
  const s = engine.loadSession(sid);
  const r = engine.questionAt(s, slot);
  if (!r.question) return null;
  return engine.saveAnswer(sid, slot, { variant_id: r.question.variant_id, expected_revision: s.revision, value });
}
function answerAll(answers) {
  const s = start();
  for (const q of cat.SLOTS) if (answers[q.slot_id] !== undefined) put(s.id, q.slot_id, answers[q.slot_id]);
  return s.id;
}
function finish(answers) {
  const id = answerAll(answers);
  engine.complete(id);
  return { id, diag: engine.getDiagnostic(id), answers: engine.activeAnswers(id) };
}
const next = (id) => engine.getState(id).next_question && engine.getState(id).next_question.slot_id;
const metric = (r, id) => r.metrics.find((m) => m.id === id);

test.before(() => h.start());
test.after(() => h.stop());

test('V4: 24 preguntas, botones y sin pregunta de interés', () => {
  assert.equal(cat.SLOTS.length, 24);
  const types = new Set(cat.SLOTS.flatMap((s) => s.variants.map((v) => v.type)));
  assert.ok(!types.has('rate') && !types.has('text') && !types.has('skill_examples'), 'sin tasa ni textos largos');
  assert.ok(!cat.SLOTS.some((s) => /inter[eé]s/i.test(s.variants[0].text)));
  // «Otro» abre como máximo 80 caracteres; Q24 no ofrece «No lo sé».
  assert.equal(cat.OTHER_MAX, 80);
  assert.deepEqual(cat.specialsFor(cat.SLOT_BY_ID.Q24.variants[0]).map((x) => x.code), ['PNA']);
  // Moneda sugerida por país.
  assert.equal(cat.OPTIONS.CURRENCY_BY_COUNTRY.BO, 'BOB');
});

test('V4: sesiones nuevas usan V4 por defecto', () => {
  const prev = config.freeCatalogVersion;
  config.freeCatalogVersion = 'FREE_24_V4_ES';
  try {
    assert.equal(config.freeCatalogVersion, V4);
    assert.equal(start().version_id, V4);
  } finally {
    config.freeCatalogVersion = prev;
  }
});

test('V4: saltos — ingreso 0 sin Q07; «No tengo deudas» en Q10 salta Q11 y Q12; en Q11 salta Q12', () => {
  const a = start();
  for (const q of ['Q01', 'Q02', 'Q03', 'Q04', 'Q05']) put(a.id, q, BASE[q]);
  put(a.id, 'Q06', { amount: '0' });
  assert.equal(next(a.id), 'Q08');

  const b = start();
  for (const q of ['Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q06', 'Q07', 'Q08', 'Q09']) put(b.id, q, BASE[q]);
  put(b.id, 'Q10', { status: 'NO' });
  assert.equal(next(b.id), 'Q13');

  const c = start();
  for (const q of ['Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q06', 'Q07', 'Q08', 'Q09']) put(c.id, q, BASE[q]);
  put(c.id, 'Q10', 'DK');
  assert.equal(next(c.id), 'Q11', 'si no sabe, no suponer que no debe nada');
  put(c.id, 'Q11', { codes: ['NONE'] });
  assert.equal(next(c.id), 'Q13');
  // Avance real: con saltos el total baja de 24.
  assert.ok(engine.progress(engine.activeAnswers(c.id), engine.loadSession(c.id)).total < 24);
});

test('V4: validaciones de botones, «Otro», exclusivas, máximo y contradicción de ingreso', () => {
  const s = start();
  for (const q of ['Q01', 'Q02', 'Q03']) put(s.id, q, BASE[q]);
  assert.throws(() => put(s.id, 'Q04', { codes: ['OTHER'] }), /frase corta/);
  assert.throws(() => put(s.id, 'Q04', { codes: ['OTHER'], other: 'x'.repeat(81) }), /80 caracteres/);
  put(s.id, 'Q04', { codes: ['EMPLOYEE'] });
  put(s.id, 'Q05', BASE.Q05);
  put(s.id, 'Q06', { amount: '5100' });
  assert.throws(() => put(s.id, 'Q07', { codes: ['NO_INCOME'] }), /¿Quieres corregirlo\?/);
  for (const q of ['Q07', 'Q08', 'Q09', 'Q10', 'Q11', 'Q12', 'Q13']) put(s.id, q, BASE[q]);
  assert.throws(() => put(s.id, 'Q14', { codes: ['NONE', 'INSURANCE'] }), /no se puede combinar/);
  for (const q of ['Q14', 'Q15', 'Q16']) put(s.id, q, BASE[q]);
  assert.throws(() => put(s.id, 'Q17', { codes: ['SELL', 'MANUAL', 'COOK'] }), /hasta dos/);
  assert.throws(() => cat.validate(cat.SLOT_BY_ID.Q24.variants[0], 'DK', engine.loadSession(s.id)), /Elige una opción/);
});

test('V4: métricas — vacío y No lo sé no son cero; sin pagos este mes = cuota 0; rangos como intervalo', () => {
  const full = finish(BASE);
  assert.equal(metric(full.diag.result, 'monthly_balance').value, '300.00');
  assert.equal(full.diag.result.balance_range, null);

  const noDue = finish({ ...BASE, Q10: { status: 'NO_DUE' } });
  assert.equal(metric(noDue.diag.result, 'monthly_balance').value, '1100.00');

  const dk = finish({ ...BASE, Q10: 'DK', Q11: 'DK', Q12: 'DK' });
  assert.equal(metric(dk.diag.result, 'monthly_balance').value, null, 'deuda desconocida ≠ 0');

  const range = finish({ ...BASE, Q08: { min: '3000', max: '4000' } });
  assert.equal(metric(range.diag.result, 'monthly_balance').value, null);
  assert.deepEqual(range.diag.result.balance_range, { min: '-200.00', max: '800.00' });

  const noDebt = finish({ ...BASE, Q10: { status: 'NO' }, Q11: undefined, Q12: undefined });
  assert.equal(metric(noDebt.diag.result, 'monthly_balance').value, '1100.00');
});

test('V4: Q23 «No tengo dinero» confirma cero y «Tal vez» no es dinero disponible', () => {
  const s = start();
  for (const q of cat.SLOTS.map((x) => x.slot_id).filter((x) => x !== 'Q23' && x !== 'Q24')) put(s.id, q, BASE[q]);
  put(s.id, 'Q23', { availability: 'NO', amount: '500' });
  assert.equal(engine.activeAnswers(s.id).Q23.value.money.amount, '0.00');
  const pkg = result4.buildPackage(engine.loadSession(s.id), engine.activeAnswers(s.id));
  assert.ok(pkg.bloqueos.some((b) => b.id === 'PAID_ACTION'));
  const maybe = result4.buildPackage(engine.loadSession(s.id), { ...engine.activeAnswers(s.id), Q23: { status: 'answered', variant_id: 'V4_Q23', value: { availability: 'MAYBE', money: null } } });
  assert.ok(maybe.bloqueos.some((b) => b.id === 'PAID_ACTION'));
});

test('V4: respaldo determinista — prioridad de hallazgos y menor de edad sin oferta', () => {
  const late = finish({ ...BASE, Q12: { codes: ['LATE'] } });
  assert.match(late.diag.result.conclusion.title, /pagos atrasados/);
  const neg = finish({ ...BASE, Q06: { amount: '3000' } });
  assert.match(neg.diag.result.conclusion.title, /superan lo que recibes/);
  const zero = finish({ ...BASE, Q06: { amount: '4800' } });
  assert.match(zero.diag.result.conclusion.title, /no queda libre al final del mes/);
  assert.equal(zero.diag.result.first_action.kind, 'RECORD');
  const ok = finish(BASE);
  assert.match(ok.diag.result.conclusion.title, /podría quedarte/);
  assert.match(ok.diag.result.opportunity.hypothesis, /Declaras saber/);
  const minor = finish({ ...BASE, Q02: { codes: ['LT18'] } });
  assert.equal(minor.diag.result.minor, true);
  assert.equal(minor.diag.result.opportunity, null);
});

test('V4: la salida de la IA se acepta o se rechaza (cifras, tasa, ventas de menores)', async () => {
  const { id } = finish(BASE);
  const s = engine.loadSession(id);
  const pkg = result4.buildPackage(s, engine.activeAnswers(id));
  const good = result4.template(pkg, engine.activeAnswers(id));
  assert.deepEqual(result4.validateOutput(good, pkg), { ok: true });
  const bad = JSON.parse(JSON.stringify(good));
  bad.conclusion.interpretation = 'Podrías ganar Bs 4.321 al mes.';
  assert.match(result4.validateOutput(bad, pkg).reason, /UNAUTHORIZED_NUMBER/);
  const rate = JSON.parse(JSON.stringify(good));
  rate.first_action.instruction = 'Averigua la tasa de interés de tu tarjeta.';
  assert.match(result4.validateOutput(rate, pkg).reason, /BANNED_TERM/);
});

test('V4: flujo por formularios y resultado en nueve módulos con una sola oferta', async () => {
  const prev = config.freeCatalogVersion;
  config.freeCatalogVersion = V4;
  try {
    const c = new h.Client();
    await h.consent(c);
    const first = await c.get('/test');
    assert.match(first.text, /¿En qué país vives\?/);
    assert.match(first.text, /data-currency-suggest/);
    assert.match(first.text, /Pregunta 1 de 24/);
    const form = {
      1: { country: 'BO', currency: 'BOB' },
      2: { codes: 'A25_34' },
      3: { codes: 'D1' },
      4: { codes: 'EMPLOYEE' },
      5: { code: 'INCOME', horizon: 'M6' },
      6: { amount: '5.100' },
      7: { codes: 'MODERATE' },
      8: { amount: '3.500' },
      9: { amount: '500' },
      10: { status: 'NO' },
      13: { amount: '600' },
      14: { codes: 'NONE' },
      15: { codes: ['EQUIPMENT', 'OTHER'], other: 'Motocicleta' },
      16: { codes: 'H3_7' },
      17: { codes: ['SELL'] },
      18: { codes: ['FOOD'] },
      19: { codes: ['UNPAID'] },
      20: { codes: ['FRIENDS'] },
      21: { codes: 'GROWTH' },
      22: { codes: ['KEEP_JOB'] },
      23: { availability: 'NO' },
      24: { codes: 'SELL_PRODUCT' },
    };
    for (const n of Object.keys(form).map(Number)) {
      const page = await c.get(`/test/pregunta/${n}`);
      assert.doesNotMatch(page.text, /textarea/, `pregunta ${n} sin cuadros de texto largos`);
      const variant = page.text.match(/name="variant_id" value="([^"]+)"/)[1];
      const rev = page.text.match(/name="expected_revision" value="(\d+)"/)[1];
      const ctx = page.text.match(/name="resolved_context_hash" value="([^"]+)"/)[1];
      const res = await c.post(`/test/pregunta/${n}`, { variant_id: variant, expected_revision: rev, resolved_context_hash: ctx, action: 'next', ...form[n] }, { follow: false });
      assert.equal(res.status, 303, `pregunta ${n}: ${res.text && res.text.slice(0, 300)}`);
    }
    const review = await c.get('/test/revision');
    assert.match(review.text, /No aplica: indicaste que no tienes deudas/);
    assert.match(review.text, /Ver mi resultado gratuito/);
    assert.match(review.text, /22 de 22 respondidas/);
    const fin = await c.post('/test/finalizar', {});
    assert.match(fin.text, /Tu primer mapa financiero/);
    assert.match(fin.text, /Saldo estimado al mes/);
    assert.match(fin.text, /Bs 1\.100/);
    assert.match(fin.text, /Tu primer paso, gratis/);
    assert.match(fin.text, /Quiero mi Plan Maestro/);
    assert.match(fin.text, /Ver qué incluye mi Plan Maestro/);
    assert.match(fin.text, /USD 69/);
    assert.doesNotMatch(fin.text, /XP|reward-card|tasa de inter/i);
    assert.match(fin.text, /Pregunta a dos amigos o familiares/);
    // Fase 4: analítica comercial sin datos financieros y solo con consentimiento.
    const db = require('../src/db');
    const count = (n) => db.value('SELECT COUNT(*) FROM analytics_events WHERE name = ?', n);
    const before = { r: count('resultado_visto'), d: count('detalle_plan'), c: count('clic_checkout') };
    await c.get('/resultado');
    await c.get('/resultado');
    assert.equal(count('resultado_visto'), before.r, 'la vista ya se contó al finalizar y no se duplica');
    const det = await c.get('/resultado?ver=incluye');
    assert.match(det.text, /id="incluye" open/);
    assert.equal(count('detalle_plan'), before.d + 1);
    const go = await c.get('/resultado/plan-maestro', { follow: false });
    assert.equal(go.status, 303);
    assert.equal(count('clic_checkout'), before.c + 1);
    const cols = db.all('PRAGMA table_info(analytics_events)').map((x) => x.name);
    assert.ok(!cols.some((x) => /amount|monto|answer|respuesta/.test(x)), 'el evento no guarda montos ni respuestas');
  } finally {
    config.freeCatalogVersion = prev;
  }
});
