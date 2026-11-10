'use strict';
// Motor del test gratuito: rutas, variantes, validación, invalidación, idempotencia,
// anotaciones A01–A20 y finalización. Sin HTTP: prueba el dominio directamente.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const engine = require('../src/domain/free/engine');
const catalog = require('../src/domain/free/catalog');

const SLOTS = catalog.SLOTS.map((s) => s.slot_id);
const ord = (s) => catalog.SLOT_BY_ID[s].ordinal;

function newSession(extra = {}) {
  return engine.createSession({ consent: true, ...extra }).session;
}
/** Guarda un slot usando la pregunta vigente. Devuelve la respuesta del servidor. */
function put(sid, slot, value, extra = {}) {
  const s = engine.loadSession(sid);
  const q = engine.questionAt(s, slot).question;
  // Atajo de prueba: un código suelto en una pregunta de importe o edad es una opción (CHOICE).
  if (['money_or_choice', 'age_or_choice'].includes(q.type) && typeof value === 'string') value = { kind: 'CHOICE', code: value };
  return engine.saveAnswer(sid, slot, { variant_id: q.variant_id, expected_revision: s.revision, value, ...extra });
}
/** Responde en orden los slots indicados; devuelve el mapa slot → respuesta del servidor. */
function fill(sid, answers, upTo = 25) {
  const out = {};
  for (const slot of SLOTS) {
    if (ord(slot) > upTo) break;
    out[slot] = put(sid, slot, answers[slot]);
  }
  return out;
}
const variantOf = (sid, slot) => engine.questionAt(engine.loadSession(sid), slot).question;
const active = (sid) => engine.activeAnswers(sid);
const rejects = (fn, status, code) =>
  assert.throws(fn, (e) => e instanceof engine.FreeError && e.status === status && (!code || e.code === code), `esperaba ${status} ${code || ''}`);

// Base neutra: ninguna anotación se activa. Cada prueba cambia solo lo necesario.
const NEUTRAL = {
  Q01: 'FIND_DIRECTION', Q02: 'SAVING', Q03: 'E', Q04: 'SOME_UNCERTAINTY', Q05: 'NONE', Q06: 'P20_29', Q07: 'LOW', Q08: 'M6_11',
  Q09: 'NO', Q10: 'NO', Q11: 'CURRENT', Q12: 'RECORDED', Q13: ['CASH'], Q14: 'D0', Q15: ['RESERVE'], Q16: 'A25_34',
  Q17: { kind: 'CHOICE', code: 'NOT_SET' }, Q18: { kind: 'CHOICE', code: 'NOT_SET' }, Q19: 'NEVER', Q20: 'KNOWLEDGE', Q21: 'PRESERVE',
  Q22: 'DK', Q23: 'DK', Q24: ['DK'], Q25: 'NOT_SET', // Q17/Q18/Q23/Q25 aceptan un código como atajo (ver put)
};
const DK_CHOICE = { kind: 'CHOICE', code: 'DK' };

test.before(() => h.start());
test.after(() => h.stop());

// ───────── Rutas y variantes ─────────
test('cada ruta resuelve su variante de Q04 y Q05; DK y PNA en Q03 usan la ruta U neutral', () => {
  const expected = { E: 'Q04_E', I: 'Q04_I', B: 'Q04_B', M: 'Q04_M', N: 'Q04_N', O: 'Q04_O', DK: 'Q04_U', PNA: 'Q04_U' };
  for (const [code, variant] of Object.entries(expected)) {
    const s = newSession();
    fill(s.id, { ...NEUTRAL, Q03: code }, 3);
    const q4 = variantOf(s.id, 'Q04');
    assert.equal(q4.variant_id, variant, `Q04 para ${code}`);
    assert.ok(q4.options.some((o) => o.code === 'DK') && q4.options.some((o) => o.code === 'PNA'), 'hereda DK y PNA');
    assert.equal(engine.loadSession(s.id).route, ['DK', 'PNA'].includes(code) ? 'U' : code);
    const route = ['DK', 'PNA'].includes(code) ? 'U' : code;
    put(s.id, 'Q04', code === 'N' ? 'LT1M' : 'STABLE');
    assert.equal(variantOf(s.id, 'Q05').variant_id, `Q05_${route}`);
  }
  // U no promete sueldo ni empresa.
  const s = newSession();
  fill(s.id, { ...NEUTRAL, Q03: 'PNA' }, 3);
  assert.doesNotMatch(variantOf(s.id, 'Q04').text, /sueldo|empleo|negocio/i);
});

test('N o Q04 = ZERO activan las variantes sin ingresos en Q06, Q07, Q08, Q23 y Q25', () => {
  const cases = [
    { Q03: 'N', Q04: 'LT1M' },
    { Q03: 'I', Q04: 'ZERO' },
    { Q03: 'B', Q04: 'ZERO' },
    { Q03: 'M', Q04: 'ZERO' },
    { Q03: 'O', Q04: 'ZERO' },
    { Q03: 'DK', Q04: 'ZERO' },
  ];
  for (const c of cases) {
    const s = newSession();
    fill(s.id, { ...NEUTRAL, Q03: c.Q03, Q04: c.Q04, Q05: c.Q03 === 'N' ? 'JOB' : 'NONE' }, 5);
    assert.equal(variantOf(s.id, 'Q06').variant_id, 'Q06_NO_INCOME', JSON.stringify(c));
    put(s.id, 'Q06', 'ZERO');
    assert.equal(variantOf(s.id, 'Q07').variant_id, 'Q07_START');
    put(s.id, 'Q07', 'LOW');
    assert.equal(variantOf(s.id, 'Q08').variant_id, 'Q08_NO_INCOME');
    put(s.id, 'Q08', 'ZERO');
    for (const slot of ['Q09', 'Q10', 'Q11', 'Q12', 'Q13', 'Q14', 'Q15', 'Q16', 'Q17', 'Q18', 'Q19', 'Q20', 'Q21', 'Q22']) {
      put(s.id, slot, slot === 'Q12' && ['B', 'M'].includes(c.Q03) ? 'SEPARATE_RECORDED' : NEUTRAL[slot]);
    }
    assert.equal(variantOf(s.id, 'Q23').variant_id, 'Q23_NO_INCOME');
    put(s.id, 'Q23', { kind: 'CHOICE', code: 'ZERO' });
    put(s.id, 'Q24', ['NONE']);
    assert.equal(variantOf(s.id, 'Q25').variant_id, 'Q25_START', 'no se aplica un porcentaje a una base cero');
  }
  // En una ruta con ingresos, las variantes son las generales.
  const s = newSession();
  fill(s.id, NEUTRAL, 5);
  assert.equal(variantOf(s.id, 'Q06').variant_id, 'Q06_REGULAR');
  assert.match(variantOf(s.id, 'Q06').help, /tu sueldo/);
});

test('redacción de ingresos por ruta en Q07, Q08 y ayuda de Q06', () => {
  const texts = {};
  for (const route of ['E', 'I', 'B', 'M', 'O']) {
    const s = newSession();
    fill(s.id, { ...NEUTRAL, Q03: route, Q04: 'STABLE', Q05: 'NONE' }, 5);
    const q6 = variantOf(s.id, 'Q06');
    put(s.id, 'Q06', 'P10_19');
    const q7 = variantOf(s.id, 'Q07');
    put(s.id, 'Q07', 'LOW');
    const q8 = variantOf(s.id, 'Q08');
    texts[route] = { q6: q6.help, q7: q7.text, q8: q8.text };
  }
  assert.match(texts.E.q7, /sueldo/);
  assert.match(texts.I.q7, /ingresos netos de tu trabajo/);
  assert.match(texts.B.q7, /dinero que recibes de tu negocio/);
  assert.match(texts.M.q7, /ingresos personales/);
  assert.match(texts.B.q6, /después de sus gastos/);
  assert.match(texts.B.q6, /excluyen la facturación/);
  assert.match(texts.E.q8, /Si tu sueldo se interrumpiera hoy/);
  assert.match(texts.I.q8, /ingresos de tu trabajo/);
});

test('Q09, Q10 y Q11 resuelven la variante correcta para cada combinación', () => {
  const run = (q9, q10, q11variant, q11Opts) => {
    const s = newSession();
    fill(s.id, NEUTRAL, 8);
    put(s.id, 'Q09', q9);
    if (q10 !== undefined) {
      const v10 = variantOf(s.id, 'Q10');
      assert.equal(v10.variant_id, { YES: 'Q10_TYPES', NO: 'Q10_NO_DEBT' }[q9] || 'Q10_UNCERTAIN');
      put(s.id, 'Q10', q10);
    }
    const q = variantOf(s.id, 'Q11');
    assert.equal(q.variant_id, q11variant, `Q09=${q9} Q10=${JSON.stringify(q10)}`);
    if (q11Opts) assert.ok(q11Opts.every((c) => q.options.some((o) => o.code === c)));
  };
  run('NO', 'NO', 'Q11_NO_DEBT', ['CURRENT', 'SHORTFALL']);
  run('DK', 'ALL', 'Q11_UNCERTAIN');
  run('PNA', 'DK', 'Q11_UNCERTAIN');
  run('YES', ['CARD'], 'Q11_CARD', ['FULL', 'ABOVE_MIN', 'MINIMUM', 'LATE', 'NOT_DUE']);
  run('YES', ['INFORMAL'], 'Q11_FAMILY');
  run('YES', ['CONSUMER'], 'Q11_LOAN');
  run('YES', ['HOME'], 'Q11_HOME');
  run('YES', ['BUSINESS_PERSONAL'], 'Q11_BUSINESS');
  run('YES', ['OTHER'], 'Q11_DEBT');
  run('YES', ['CARD', 'CONSUMER'], 'Q11_MULTI');
  run('YES', ['CARD', 'INFORMAL', 'HOME'], 'Q11_MULTI');
  run('YES', ['DK'], 'Q11_DEBT');
  run('YES', ['PNA'], 'Q11_DEBT');
});

test('Q12, Q15 y Q20 resuelven según ruta, dependientes y experiencia de inversión', () => {
  for (const [route, variant] of [['E', 'Q12_EXPENSE_TRACKING'], ['N', 'Q12_EXPENSE_TRACKING'], ['B', 'Q12_BM'], ['M', 'Q12_BM']]) {
    const s = newSession();
    fill(s.id, { ...NEUTRAL, Q03: route, Q04: route === 'N' ? 'LT1M' : 'STABLE', Q05: route === 'N' ? 'JOB' : 'NONE', Q06: route === 'N' ? 'ZERO' : 'P20_29', Q07: 'LOW', Q08: 'ZERO' }, 11);
    assert.equal(variantOf(s.id, 'Q12').variant_id, variant);
  }
  const q15 = (route, q14) => {
    const s = newSession();
    const ans = { ...NEUTRAL, Q03: route, Q04: route === 'N' ? 'LT1M' : 'STABLE', Q05: route === 'N' ? 'JOB' : 'NONE', Q06: route === 'N' ? 'ZERO' : 'P20_29', Q14: q14 };
    fill(s.id, ans, 14);
    return variantOf(s.id, 'Q15').variant_id;
  };
  assert.equal(q15('E', 'D0'), 'Q15_SELF');
  assert.equal(q15('E', 'D2'), 'Q15_FAMILY');
  assert.equal(q15('N', 'D0'), 'Q15_SELF_N');
  assert.equal(q15('N', 'D4PLUS'), 'Q15_FAMILY_N');
  assert.equal(q15('E', 'DK'), 'Q15_NEUTRAL');
  assert.equal(q15('N', 'PNA'), 'Q15_NEUTRAL');
  const q20 = (q19) => {
    const s = newSession();
    fill(s.id, { ...NEUTRAL, Q19: q19 }, 19);
    return variantOf(s.id, 'Q20').variant_id;
  };
  assert.equal(q20('LOSS'), 'Q20_LOSS_CAUSE');
  assert.equal(q20('NEVER'), 'Q20_BARRIER');
  assert.equal(q20('NO_LOSS'), 'Q20_PROCESS');
  assert.equal(q20('UNKNOWN_RESULT'), 'Q20_TRACKING');
  assert.equal(q20('DK'), 'Q20_TRACKING', 'DK no se convierte en antecedente de inversión');
  assert.equal(q20('PNA'), 'Q20_TRACKING');
});

test('Q25 usa porcentaje con ingresos y monto cuando no hay base de ingresos', () => {
  const q25 = (over) => {
    const s = newSession();
    fill(s.id, { ...NEUTRAL, ...over }, 24);
    return variantOf(s.id, 'Q25').variant_id;
  };
  assert.equal(q25({}), 'Q25_GROWTH');
  assert.equal(q25({ Q06: 'DK' }), 'Q25_GROWTH');
  assert.equal(q25({ Q06: 'NO_INCOME' }), 'Q25_START');
});

test('la especificación se cumple: 25 slots y cada slot resuelve exactamente una variante en todo el espacio de rutas', () => {
  assert.equal(catalog.SLOTS.length, 25);
  const routes = ['E', 'I', 'B', 'M', 'N', 'O', 'U'];
  const q4 = { E: ['STABLE'], I: ['STABLE', 'ZERO'], B: ['ZERO'], M: ['ZERO'], N: ['LT1M'], O: ['ZERO'], U: ['ZERO'] };
  for (const route of routes) {
    for (const code of q4[route]) {
      const s = newSession();
      const answers = { ...NEUTRAL, Q03: route === 'U' ? 'DK' : route, Q04: code, Q05: route === 'N' ? 'JOB' : 'NONE' };
      const noInc = route === 'N' || code === 'ZERO';
      answers.Q06 = noInc ? 'ZERO' : 'P20_29';
      answers.Q08 = 'ZERO';
      answers.Q12 = ['B', 'M'].includes(route) ? 'MIXED' : 'RECORDED';
      answers.Q22 = 'H1_3';
      for (const slot of SLOTS) {
        const q = variantOf(s.id, slot); // lanza si no resuelve exactamente una variante
        assert.ok(q.variant_id);
        put(s.id, slot, answers[slot]);
      }
      assert.equal(engine.getState(s.id).progress.completed_count, 25);
    }
  }
});

// ───────── Respuestas especiales y validación ─────────
test('DK y PNA son válidas en los 25 slots, no rellenan datos y el test se completa', () => {
  const s = newSession();
  SLOTS.forEach((slot, i) => {
    const q = variantOf(s.id, slot);
    const code = i % 2 ? 'PNA' : 'DK';
    const value = q.type === 'multi' ? [code] : q.type === 'single' ? code : { kind: 'CHOICE', code };
    put(s.id, slot, value);
    const a = active(s.id)[slot];
    assert.equal(a.status, code === 'DK' ? 'unknown' : 'declined');
    assert.equal(a.value, null, 'una respuesta especial no guarda valor ni cero');
  });
  assert.equal(engine.getState(s.id).progress.completed_count, 25);
  assert.equal(engine.loadSession(s.id).route, 'U');
  const done = engine.complete(s.id);
  assert.equal(done.generation_status, 'ready');
  const r = engine.getDiagnostic(s.id).result;
  // C08: todo desconocido.
  assert.equal(r.coverage.known_domains, 0);
  assert.equal(r.profile.title, 'Necesitamos conocer mejor tu situación');
  assert.equal(r.strengths.length, 0, 'sin fortalezas inventadas');
  assert.ok(r.dimensions.every((d) => d.state === 'unknown'));
  assert.equal(r.first_action.code, 'NEXT_FOCUS');
  assert.ok(r.facts.every((f) => f.value === null), 'los valores faltantes son null con motivo, nunca cero');
  assert.ok(r.facts.every((f) => ['unknown', 'declined'].includes(f.reason)));
});

test('validación de opciones: códigos ajenos, listas, duplicados y exclusividad', () => {
  const s = newSession();
  rejects(() => put(s.id, 'Q01', 'NO_EXISTE'), 422, 'INVALID_OPTION');
  rejects(() => put(s.id, 'Q01', ['INCREASE_INCOME']), 422, 'INVALID_OPTION');
  rejects(() => put(s.id, 'Q01', null), 422, 'INVALID_OPTION');
  fill(s.id, NEUTRAL, 9);
  put(s.id, 'Q09', 'YES');
  rejects(() => put(s.id, 'Q10', []), 422, 'INVALID_OPTION');
  rejects(() => put(s.id, 'Q10', ['CARD', 'CARD']), 422, 'INVALID_OPTION');
  rejects(() => put(s.id, 'Q10', ['CARD', 'DK']), 422, 'INVALID_OPTION');
  rejects(() => put(s.id, 'Q10', ['PNA', 'DK']), 422, 'INVALID_OPTION');
  rejects(() => put(s.id, 'Q10', 'CARD'), 422, 'INVALID_OPTION');
  rejects(() => put(s.id, 'Q10', ['ALL']), 422, 'INVALID_OPTION');
  put(s.id, 'Q10', ['CARD', 'CONSUMER', 'HOME', 'BUSINESS_PERSONAL', 'INFORMAL', 'OTHER']);
  // NONE es excluyente.
  fill(s.id, NEUTRAL, 12);
  rejects(() => put(s.id, 'Q13', ['CASH', 'NONE']), 422, 'INVALID_OPTION');
  put(s.id, 'Q13', ['CASH', 'HOME', 'PROPERTY', 'VEHICLE', 'BUSINESS', 'INVESTMENTS', 'OTHER']);
  put(s.id, 'Q13', ['NONE']);
  assert.deepEqual(active(s.id).Q13.value, ['NONE']);
  // El cliente no puede imponer un estado: se deriva del código.
  assert.equal(active(s.id).Q13.status, 'answered');
});

test('importes: decimales, límites, formato y moneda', () => {
  const s = newSession({ currency: 'USD' });
  fill(s.id, NEUTRAL, 17);
  const amount = (a, cur = 'USD', extra = {}) => put(s.id, 'Q18', { kind: 'AMOUNT', amount: a, currency: cur }, extra);
  for (const bad of ['0', '0.00', '-5', '1e3', '12.345', '1000000000.00', 'abc', '', ' ', '1,5']) rejects(() => amount(bad), 422, 'INVALID_AMOUNT');
  rejects(() => put(s.id, 'Q18', { kind: 'AMOUNT', amount: 3000, currency: 'USD' }), 422, 'INVALID_AMOUNT');
  rejects(() => amount('10', 'usd'), 422, 'INVALID_AMOUNT');
  rejects(() => amount('10', 'ZZZ'), 422, 'INVALID_AMOUNT');
  rejects(() => put(s.id, 'Q18', { kind: 'AMOUNT', amount: '10', currency: 'USD', code: 'ZERO' }), 422, 'INVALID_AMOUNT');
  rejects(() => put(s.id, 'Q18', { kind: 'CHOICE', code: 'ZERO' }), 422, 'INVALID_OPTION');
  rejects(() => put(s.id, 'Q18', { kind: 'CHOICE', code: 'NOT_SET', amount: '5' }), 422, 'INVALID_OPTION');
  amount('0.01');
  amount('999999999.99');
  amount('3000');
  assert.equal(active(s.id).Q18.value.amount, '3000.00', 'decimal exacto en texto, no float');
  // Moneda distinta de la de la sesión.
  rejects(() => amount('10', 'EUR'), 422, 'CURRENCY_MISMATCH');
  assert.equal(engine.loadSession(s.id).currency, 'USD');
});

test('cambiar la moneda borra los importes previos sin convertirlos', () => {
  const s = newSession();
  fill(s.id, { ...NEUTRAL, Q18: { kind: 'AMOUNT', amount: '500.00', currency: 'MXN' } }, 18);
  assert.equal(engine.loadSession(s.id).currency, 'MXN', 'Q18 fija la moneda de la sesión');
  for (const slot of ['Q19', 'Q20', 'Q21', 'Q22']) put(s.id, slot, NEUTRAL[slot] === 'DK' ? 'H1_3' : NEUTRAL[slot]);
  put(s.id, 'Q23', { kind: 'AMOUNT', amount: '20.00', currency: 'MXN' });
  put(s.id, 'Q24', ['SALES']);
  const r = put(s.id, 'Q23', { kind: 'AMOUNT', amount: '30.00', currency: 'EUR' }, { change_currency: true });
  assert.equal(engine.loadSession(s.id).currency, 'EUR');
  assert.ok(r.invalidated_slots.includes('Q18'), 'el importe de Q18 se borra y se vuelve a pedir');
  assert.equal(active(s.id).Q18, undefined);
  assert.equal(active(s.id).Q23.value.amount, '30.00');
  // Los demás slots que no son importes siguen activos hasta donde su contexto es válido.
  assert.ok(active(s.id).Q16);
});

test('Q17: edad contra el rango de Q16 y confirmación dentro del rango', () => {
  const s = newSession();
  fill(s.id, { ...NEUTRAL, Q16: 'A45_54' }, 16);
  rejects(() => put(s.id, 'Q17', { kind: 'AGE', value: 17 }), 422, 'INVALID_AGE');
  rejects(() => put(s.id, 'Q17', { kind: 'AGE', value: 101 }), 422, 'INVALID_AGE');
  rejects(() => put(s.id, 'Q17', { kind: 'AGE', value: 45.5 }), 422, 'INVALID_AGE');
  rejects(() => put(s.id, 'Q17', { kind: 'AGE', value: '50' }), 422, 'INVALID_AGE');
  rejects(() => put(s.id, 'Q17', { kind: 'AGE', value: 40 }), 422, 'AGE_BELOW_RANGE');
  rejects(() => put(s.id, 'Q17', { kind: 'AGE', value: 49 }), 422, 'CONFIRMATION_REQUIRED');
  rejects(() => put(s.id, 'Q17', { kind: 'AGE', value: 49, confirmed: false }), 422, 'CONFIRMATION_REQUIRED');
  put(s.id, 'Q17', { kind: 'AGE', value: 49, confirmed: true });
  assert.equal(active(s.id).Q17.value.confirmed, true);
  put(s.id, 'Q17', { kind: 'AGE', value: 60 }); // posterior al rango: no requiere confirmación
  rejects(() => put(s.id, 'Q17', { kind: 'CHOICE', code: 'NOPE' }), 422, 'INVALID_OPTION');
  put(s.id, 'Q17', { kind: 'CHOICE', code: 'ALREADY' });
  // A65PLUS: el límite inferior es 65.
  const t = newSession();
  fill(t.id, { ...NEUTRAL, Q16: 'A65PLUS' }, 16);
  rejects(() => put(t.id, 'Q17', { kind: 'AGE', value: 64 }), 422, 'AGE_BELOW_RANGE');
  rejects(() => put(t.id, 'Q17', { kind: 'AGE', value: 70 }), 422, 'CONFIRMATION_REQUIRED');
  // Con Q16 desconocido no se valida contra el rango.
  const u = newSession();
  fill(u.id, { ...NEUTRAL, Q16: 'DK' }, 16);
  put(u.id, 'Q17', { kind: 'AGE', value: 22 });
  // Si Q16 cambia después y deja a Q17 por debajo del rango, Q17 se invalida.
  put(s.id, 'Q17', { kind: 'AGE', value: 49, confirmed: true });
  const r = put(s.id, 'Q16', 'A55_64');
  assert.ok(r.invalidated_slots.includes('Q17'));
});

// ───────── Revisión, idempotencia y concurrencia ─────────
test('idempotencia y revisiones: misma clave y mismo contenido repite la respuesta; otro contenido es conflicto', () => {
  const s = newSession();
  const q = engine.questionAt(s, 'Q01').question;
  const body = { variant_id: q.variant_id, expected_revision: 0, value: 'PAY_DEBT', idempotency_key: 'k-1' };
  const first = engine.saveAnswer(s.id, 'Q01', body);
  assert.equal(first.revision, 1);
  const again = engine.saveAnswer(s.id, 'Q01', body);
  assert.equal(again.revision, 1, 'no consume otra revisión');
  assert.equal(again.idempotent_replay, true);
  assert.deepEqual({ ...again, idempotent_replay: undefined }, { ...first, idempotent_replay: undefined });
  rejects(() => engine.saveAnswer(s.id, 'Q01', { ...body, value: 'BUILD_WEALTH' }), 409, 'IDEMPOTENCY_CONFLICT');
  assert.equal(h.db.value("SELECT COUNT(*) FROM ft_answers WHERE session_id = ? AND slot_id = 'Q01'", s.id), 1);
  // Revisión vencida (otra pestaña): 409 sin sobrescribir.
  const stale = { variant_id: 'Q02_SITUATION', expected_revision: 0, value: 'SAVING', idempotency_key: 'k-2' };
  rejects(() => engine.saveAnswer(s.id, 'Q02', stale), 409, 'STALE_REVISION');
  try {
    engine.saveAnswer(s.id, 'Q02', stale);
  } catch (e) {
    assert.equal(e.extra.current.revision, 1, 'devuelve el estado vigente');
  }
  assert.equal(active(s.id).Q02, undefined);
  // Variante vencida.
  rejects(() => engine.saveAnswer(s.id, 'Q02', { variant_id: 'Q02_OTRA', expected_revision: 1, value: 'SAVING' }), 409, 'STALE_VARIANT');
  rejects(() => engine.saveAnswer(s.id, 'Q02', { variant_id: 'Q02_SITUATION', expected_revision: 1, value: 'SAVING', resolved_context_hash: 'deadbeef' }), 409, 'STALE_VARIANT');
  // Responder fuera de orden.
  rejects(() => engine.saveAnswer(s.id, 'Q05', { variant_id: 'Q05_E', expected_revision: 1, value: 'NONE' }), 409, 'STALE_VARIANT');
  rejects(() => engine.saveAnswer(s.id, 'Q99', { variant_id: 'x', expected_revision: 1, value: 'x' }), 404);
});

test('el progreso usa la primera pregunta pendiente, no completed_count + 1', () => {
  const s = newSession();
  fill(s.id, { ...NEUTRAL, Q09: 'YES', Q10: ['CARD'] }, 10);
  put(s.id, 'Q09', 'NO'); // edición: Q10 cambia de variante y vuelve a quedar pendiente
  const st = engine.getState(s.id);
  assert.equal(st.progress.next_ordinal, 10, 'Q10 volvió a quedar pendiente');
  assert.equal(st.progress.completed_count, 9);
  assert.equal(st.next_question.slot_id, 'Q10');
});

// ───────── Invalidación ─────────
test('cambiar Q03 archiva Q04–Q25 y conserva el historial inactivo', () => {
  const s = newSession();
  fill(s.id, NEUTRAL, 25);
  const r = put(s.id, 'Q03', 'I');
  assert.deepEqual(r.invalidated_slots, SLOTS.slice(3));
  assert.deepEqual(Object.keys(active(s.id)), ['Q01', 'Q02', 'Q03']);
  assert.equal(h.db.value('SELECT COUNT(*) FROM ft_answers WHERE session_id = ? AND active = 0', s.id), 23, 'las 22 archivadas y la respuesta anterior de Q03');
  assert.equal(engine.loadSession(s.id).route, 'I');
  assert.equal(r.next_question.slot_id, 'Q04');
  assert.equal(r.next_question.variant_id, 'Q04_I');
  // Mismo valor: no archiva nada.
  fill(s.id, { ...NEUTRAL, Q03: 'I', Q04: 'STABLE' }, 5);
  const same = put(s.id, 'Q03', 'I');
  assert.deepEqual(same.invalidated_slots, []);
});

test('dependencias: Q09→Q10/Q11, Q10→Q11, Q14→Q15, Q19→Q20, Q04→Q06/Q07/Q08/Q23/Q25, Q06→Q25', () => {
  const full = () => {
    const s = newSession();
    fill(s.id, { ...NEUTRAL, Q09: 'YES', Q10: ['CARD'], Q11: 'MINIMUM', Q14: 'D2', Q19: 'LOSS', Q20: 'FRAUD', Q22: 'H1_3', Q23: { kind: 'CHOICE', code: 'ZERO' }, Q24: ['SALES'] });
    return s;
  };
  let s = full();
  assert.deepEqual(put(s.id, 'Q09', 'NO').invalidated_slots, ['Q10', 'Q11']);
  s = full();
  assert.deepEqual(put(s.id, 'Q10', ['CARD', 'HOME']).invalidated_slots, ['Q11'], 'cambia a Q11_MULTI');
  s = full();
  assert.deepEqual(put(s.id, 'Q10', ['OTHER']).invalidated_slots, ['Q11'], 'No conserva una respuesta de tarjeta al desaparecer CARD');
  s = full();
  assert.deepEqual(put(s.id, 'Q10', ['CARD']).invalidated_slots, [], 'mismo contenido: no invalida');
  s = full();
  assert.deepEqual(put(s.id, 'Q14', 'D0').invalidated_slots, ['Q15']);
  s = full();
  assert.deepEqual(put(s.id, 'Q14', 'D3').invalidated_slots, [], 'D2→D3 conserva la misma variante familiar');
  s = full();
  assert.deepEqual(put(s.id, 'Q19', 'NEVER').invalidated_slots, ['Q20']);
  s = newSession();
  fill(s.id, { ...NEUTRAL, Q03: 'I', Q04: 'STABLE', Q09: 'YES', Q10: ['CARD'], Q11: 'MINIMUM', Q22: 'H1_3', Q23: { kind: 'AMOUNT', amount: '20.00', currency: 'USD' }, Q24: ['SALES'], Q25: 'P25_49' });
  assert.deepEqual(put(s.id, 'Q04', 'ZERO').invalidated_slots, ['Q06', 'Q07', 'Q08', 'Q23', 'Q25']);
  s = full();
  assert.deepEqual(put(s.id, 'Q06', 'NO_INCOME').invalidated_slots, ['Q25']);
});

// ───────── Anotaciones ─────────
const POINTS = ['Q06', 'Q11', 'Q15', 'Q21', 'Q24'];
/** Responde con la base neutra + cambios y devuelve la regla emitida en cada punto. */
function annotations(over = {}) {
  const s = newSession();
  const answers = { ...NEUTRAL, ...over };
  const out = fill(s.id, answers);
  return { session: s, byPoint: Object.fromEntries(POINTS.map((p) => [p, out[p].annotation ? out[p].annotation.rule_id : null])), raw: out };
}

test('la base neutra no emite anotaciones y devuelve annotation: null', () => {
  const { byPoint, raw } = annotations();
  assert.deepEqual(byPoint, { Q06: null, Q11: null, Q15: null, Q21: null, Q24: null });
  assert.ok(Object.values(raw).every((r) => r.annotation === null && r.annotation_budget_remaining === 3));
});

const POSITIVE = [
  ['A01', 'Q06', { Q02: 'SHORTFALL' }],
  ['A02', 'Q06', { Q03: 'N', Q04: 'LT1M', Q05: 'JOB', Q06: 'ZERO', Q08: 'M6_11' }],
  ['A03', 'Q06', { Q04: 'AT_RISK' }],
  ['A04', 'Q06', { Q03: 'B', Q04: 'STABLE', Q05: 'NO_SEPARATION', Q12: 'SEPARATE_RECORDED' }],
  ['A05', 'Q06', { Q06: 'ZERO' }],
  ['A06', 'Q11', { Q09: 'YES', Q10: ['DK'], Q11: 'ON_TIME' }],
  ['A07', 'Q11', { Q09: 'YES', Q10: ['CONSUMER'], Q11: 'UNABLE' }],
  ['A08', 'Q11', { Q09: 'YES', Q10: ['CARD'], Q11: 'MINIMUM' }],
  ['A09', 'Q11', { Q08: 'LT1M' }],
  ['A10', 'Q11', { Q07: 'CLEAR' }],
  ['A11', 'Q11', { Q09: 'YES', Q10: ['INFORMAL'], Q11: 'ON_TIME' }],
  ['A12', 'Q15', { Q14: 'D1', Q15: ['NONE'] }],
  ['A13', 'Q15', { Q14: 'D0', Q15: ['NONE'] }],
  ['A14', 'Q21', { Q19: 'LOSS', Q20: 'FRAUD' }],
  ['A15', 'Q21', { Q21: 'LEARN_FIRST' }],
  ['A16', 'Q21', { Q18: { kind: 'AMOUNT', amount: '2500.00', currency: 'USD' } }],
  ['A17', 'Q24', { Q22: 'H0' }],
  ['A18', 'Q24', { Q23: { kind: 'CHOICE', code: 'ZERO' } }],
  ['A19', 'Q24', { Q24: ['NONE'] }],
  ['A20', 'Q24', { Q22: 'H1_3', Q24: ['SALES'] }],
];
for (const [rule, point, over] of POSITIVE) {
  test(`anotación ${rule}: se emite en ${point} cuando su condición es cierta y no en la base neutra`, () => {
    const { byPoint } = annotations(over);
    assert.equal(byPoint[point], rule);
    assert.deepEqual(Object.entries(byPoint).filter(([p, r]) => r && p !== point), [], 'solo aparece en su punto de evaluación');
  });
}

test('anotaciones: condiciones negativas y comparación por variant_id', () => {
  // A06 requiere Q09 = YES: con Q09 DK/PNA no es candidata.
  assert.equal(annotations({ Q09: 'DK', Q10: 'ALL', Q11: 'NO' }).byPoint.Q11, null);
  assert.equal(annotations({ Q09: 'PNA', Q10: 'ALL', Q11: 'NO' }).byPoint.Q11, null);
  // Sin deudas no aparece un mensaje que afirme que las hay.
  assert.equal(annotations({ Q09: 'NO' }).byPoint.Q11, null);
  // A05 no se activa con DK/PNA ni con respuestas de la variante sin ingresos.
  assert.equal(annotations({ Q06: 'DK' }).byPoint.Q06, null);
  assert.equal(annotations({ Q06: 'PNA' }).byPoint.Q06, null);
  assert.equal(annotations({ Q06: 'NO_INCOME' }).byPoint.Q06, null);
  const noIncomeZero = annotations({ Q03: 'N', Q04: 'LT1M', Q05: 'JOB', Q06: 'ZERO', Q08: 'M6_11' });
  assert.equal(noIncomeZero.byPoint.Q06, 'A02', 'ZERO de Q06_NO_INCOME no es A05');
  // «NONE» de Q11_NO_DEBT y «ZERO» de otros slots no confunden a A07/A08/A09 (mismo código, otra variante).
  assert.equal(annotations({ Q09: 'YES', Q10: ['CARD'], Q11: 'LATE' }).byPoint.Q11, 'A07');
  assert.equal(annotations({ Q09: 'YES', Q10: ['CARD'], Q11: 'FULL' }).byPoint.Q11, null);
  assert.equal(annotations({ Q09: 'YES', Q10: ['HOME'], Q11: 'OCCASIONAL_DELAY' }).byPoint.Q11, 'A07');
  assert.equal(annotations({ Q09: 'YES', Q10: ['CARD', 'HOME'], Q11: 'OVERDUE' }).byPoint.Q11, 'A07');
  assert.equal(annotations({ Q09: 'YES', Q10: ['CARD', 'HOME'], Q11: 'ON_TIME' }).byPoint.Q11, null);
  // A09 con DK/PNA no es «reserva cero».
  assert.equal(annotations({ Q08: 'DK' }).byPoint.Q11, null);
  // A11 solo con INFORMAL exclusivamente.
  assert.equal(annotations({ Q09: 'YES', Q10: ['INFORMAL', 'HOME'], Q11: 'ON_TIME' }).byPoint.Q11, null);
  // A12 y A13 son excluyentes y no se activan con otros respaldos.
  assert.equal(annotations({ Q14: 'D2', Q15: ['NONE'] }).byPoint.Q15, 'A12');
  assert.equal(annotations({ Q14: 'D2', Q15: ['RESERVE'] }).byPoint.Q15, null);
  assert.equal(annotations({ Q14: 'DK', Q15: ['NONE'] }).byPoint.Q15, null);
  assert.equal(annotations({ Q15: ['DK'] }).byPoint.Q15, null);
  // A14 no depende de una causa concreta, y Q19 distinto de LOSS no presupone pérdida.
  assert.equal(annotations({ Q19: 'LOSS', Q20: 'MARKET' }).byPoint.Q21, 'A14');
  assert.equal(annotations({ Q19: 'NO_LOSS', Q20: 'ANALYSIS' }).byPoint.Q21, null);
  // A16: DK/PNA/NOT_SET no activan; A15 solo con LEARN_FIRST.
  assert.equal(annotations({ Q18: { kind: 'CHOICE', code: 'DK' } }).byPoint.Q21, null);
  assert.equal(annotations({ Q18: { kind: 'CHOICE', code: 'PNA' } }).byPoint.Q21, null);
  // A18: DK no equivale a presupuesto cero. A20 no confunde DK/PNA con una habilidad ni con tiempo.
  assert.equal(annotations({ Q23: DK_CHOICE }).byPoint.Q24, null);
  assert.equal(annotations({ Q22: 'H4_7', Q24: ['DK'] }).byPoint.Q24, null);
  assert.equal(annotations({ Q22: 'DK', Q24: ['SALES'] }).byPoint.Q24, null);
  assert.equal(annotations({ Q22: 'PNA', Q24: ['SALES'] }).byPoint.Q24, null);
  // Q04 = ZERO también activa A02 sin ser ruta N.
  assert.equal(annotations({ Q03: 'I', Q04: 'ZERO', Q06: 'ZERO', Q08: 'M6_11' }).byPoint.Q06, 'A02');
});

test('competencia: prioridad descendente y empates por rule_id; un mensaje por punto', () => {
  // Q02 = SHORTFALL en ruta N: A01 (100) gana a A02 (90).
  assert.equal(annotations({ Q02: 'SHORTFALL', Q03: 'N', Q04: 'LT1M', Q05: 'JOB', Q06: 'ZERO', Q08: 'M6_11' }).byPoint.Q06, 'A01');
  // Deuda sin identificar y reserva limitada: A06 (95) gana a A09 (85).
  assert.equal(annotations({ Q08: 'LT1M', Q09: 'YES', Q10: ['DK'], Q11: 'ON_TIME' }).byPoint.Q11, 'A06');
  // A07 (100) gana a A06/A09.
  assert.equal(annotations({ Q08: 'ZERO', Q09: 'YES', Q10: ['CONSUMER'], Q11: 'UNABLE' }).byPoint.Q11, 'A07');
  // Q22 = H0 y Q23 = ZERO: en Q24 gana A17.
  assert.equal(annotations({ Q22: 'H0', Q23: { kind: 'CHOICE', code: 'ZERO' } }).byPoint.Q24, 'A17');
  // A14 (65) gana a A15 (60) y a A16 (30).
  assert.equal(annotations({ Q19: 'LOSS', Q20: 'FRAUD', Q21: 'LEARN_FIRST', Q18: { kind: 'AMOUNT', amount: '10.00', currency: 'USD' } }).byPoint.Q21, 'A14');
});

test('máximo tres anotaciones por sesión, grupos sin repetir y A04 no reaparece tras emitirse en Q06', () => {
  // Fixture SIM_E_01: A05 en Q06, A08 en Q11, A14 en Q21; el presupuesto se agota y Q24 devuelve null.
  const s = newSession();
  const out = fill(s.id, h.FREE_ANSWERS);
  const ids = Object.fromEntries(POINTS.map((p) => [p, out[p].annotation ? out[p].annotation.rule_id : null]));
  assert.deepEqual(ids, { Q06: 'A05', Q11: 'A08', Q15: null, Q21: 'A14', Q24: null });
  assert.equal(out.Q24.annotation_budget_remaining, 0);
  assert.equal(engine.loadSession(s.id).issued_annotation_count, 3);
  const a = out.Q06.annotation;
  assert.equal(a.placement, 'below_next_question');
  assert.equal(a.after_slot, 'Q06');
  assert.equal(a.target_slot, 'Q07');
  assert.equal(a.answer_revision, 6);
  assert.match(a.event_id, /^ann_/);
  // A04 emitido en Q06 no vuelve a aparecer en Q15 con Q12 = MIXED.
  const b = annotations({ Q03: 'B', Q04: 'STABLE', Q05: 'NO_SEPARATION', Q12: 'MIXED' });
  assert.deepEqual([b.byPoint.Q06, b.byPoint.Q15], ['A04', null]);
  // A04 en Q15 si en Q06 aún no era cierto (Q12 no existe todavía).
  const c = annotations({ Q03: 'M', Q04: 'STABLE', Q12: 'MIXED' });
  assert.deepEqual([c.byPoint.Q06, c.byPoint.Q15], [null, 'A04']);
  // Grupo: A02 y A03 comparten «income»: tras A02 no sale A03 aunque sea cierta.
  const d = annotations({ Q03: 'I', Q04: 'ZERO', Q06: 'ZERO', Q08: 'M6_11' });
  assert.equal(d.byPoint.Q06, 'A02');
});

test('una regla no consulta respuestas posteriores al punto de evaluación', () => {
  // Con Q15 ya respondido (edición), A12 no puede salir al guardar Q06.
  const s = newSession();
  fill(s.id, { ...NEUTRAL, Q14: 'D1', Q15: ['NONE'] });
  const session = engine.loadSession(s.id);
  const ctx = engine.buildCtx(engine.activeAnswers(s.id), session, ord('Q06'));
  assert.equal(ctx.code('Q14'), null, 'Q14 está después de Q06 y no es visible');
  assert.equal(ctx.list('Q15'), null);
  assert.equal(ctx.code('Q06'), 'P20_29');
  // Una edición (sin avance) no crea anotaciones.
  const r = put(s.id, 'Q06', 'ZERO');
  assert.equal(r.annotation, null, 'una edición no crea anotaciones');
});

test('editar una respuesta retira anotaciones incompatibles y conserva el límite histórico', () => {
  const s = newSession();
  const out = fill(s.id, h.FREE_ANSWERS, 6);
  const ev = out.Q06.annotation;
  assert.equal(ev.rule_id, 'A05');
  const r = put(s.id, 'Q06', 'LT10');
  assert.deepEqual(r.invalidated_annotation_ids, [ev.event_id]);
  assert.equal(r.annotation, null);
  assert.equal(r.annotation_budget_remaining, 2, 'el mensaje retirado sigue contando');
  assert.ok(h.db.value('SELECT invalidated_at FROM ft_annotation_events WHERE event_id = ?', ev.event_id));
  // Volver a ZERO no reutiliza ese grupo ni lo vuelve a mostrar.
  const back = put(s.id, 'Q06', 'ZERO');
  assert.equal(back.annotation, null);
  assert.deepEqual(back.invalidated_annotation_ids, []);
});

test('reintento idempotente devuelve el mismo evento sin consumir otra emisión; reanudar devuelve null', () => {
  const s = newSession();
  fill(s.id, h.FREE_ANSWERS, 5);
  const q = engine.questionAt(engine.loadSession(s.id), 'Q06').question;
  const body = { variant_id: q.variant_id, expected_revision: 5, value: 'ZERO', idempotency_key: 'idem-ann' };
  const a = engine.saveAnswer(s.id, 'Q06', body);
  const b = engine.saveAnswer(s.id, 'Q06', body);
  assert.equal(a.annotation.event_id, b.annotation.event_id);
  assert.equal(engine.loadSession(s.id).issued_annotation_count, 1);
  assert.equal(engine.getState(s.id).annotation, null, 'GET de reanudación devuelve annotation: null');
  // El evento se muestra una sola vez.
  assert.ok(engine.takeAnnotationToShow(s.id, a.annotation.event_id));
  assert.equal(engine.takeAnnotationToShow(s.id, a.annotation.event_id), null);
});

// ───────── Finalización ─────────
test('finalizar exige 25 respuestas válidas; una sola vez por revisión; sin confirmaciones pendientes', () => {
  const s = newSession();
  fill(s.id, h.FREE_ANSWERS, 24);
  assert.throws(() => engine.complete(s.id), (e) => e.code === 'INCOMPLETE' && e.extra.pending[0].slot_id === 'Q25');
  put(s.id, 'Q25', 'GE100');
  const a = engine.complete(s.id);
  const b = engine.complete(s.id);
  assert.equal(a.diagnostic_id, b.diagnostic_id, 'no crea diagnósticos duplicados');
  assert.equal(h.db.value('SELECT COUNT(*) FROM ft_results WHERE session_id = ?', s.id), 1);
  // Editar tras finalizar: nueva revisión, resultado anterior retirado.
  put(s.id, 'Q02', 'SHORTFALL');
  assert.equal(engine.loadSession(s.id).status, 'en_curso');
  rejects(() => engine.getDiagnostic(s.id), 409, 'RESULT_STALE');
  const c = engine.complete(s.id);
  assert.notEqual(c.diagnostic_id, a.diagnostic_id);
  assert.equal(engine.getDiagnostic(s.id).result.answer_revision, engine.loadSession(s.id).revision);
  assert.equal(h.db.value('SELECT COUNT(*) FROM ft_results WHERE session_id = ?', s.id), 2, 'una respuesta anterior no sobrescribe un resultado posterior');
  // Un slot invalidado pendiente impide finalizar.
  put(s.id, 'Q09', 'NO');
  assert.throws(() => engine.complete(s.id), (e) => e.code === 'INCOMPLETE');
});

test('el progreso solo expone «n de 25»; el estado nunca incluye el catálogo ni condiciones', () => {
  const s = newSession();
  const st = engine.getState(s.id);
  assert.equal(st.progress.total, 25);
  assert.equal(st.revision, 0);
  assert.equal(st.next_question.slot_id, 'Q01');
  const dump = JSON.stringify(st);
  assert.doesNotMatch(dump, /when|condition|cond\b|function/);
  assert.equal(engine.loadSession(s.id).annotation_version, 'ANN_V1_ES');
});
