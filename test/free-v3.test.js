'use strict';
// Test gratuito V3 (FREE_25_V3_ES) y diagnóstico RESULT_FREE_V3_ES (paquete del
// ingeniero, 11-11-2026): catálogo, ramificaciones, métricas con los 8 fixtures,
// validación de la salida de la IA, respaldo determinista, oferta y vista.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const config = require('../src/config');
const engine = require('../src/domain/free/engine');
const cat = require('../src/domain/free/catalog3');
const metrics3 = require('../src/domain/free/metrics3');
const result3 = require('../src/domain/free/result3');
const jsonschema = require('../src/lib/jsonschema');
const FIXTURES = require('../src/domain/knowledge/v3/fixtures_v3.json');
const CATALOG_JSON = require('../src/domain/knowledge/v3/catalog_free_25_v3_es.json');
const EXAMPLE = require('../src/domain/knowledge/v3/example_free_result_v3.json');

const V3 = 'FREE_25_V3_ES';

// Respuestas de la simulación ficticia del ingeniero (técnico de refrigeración, Bolivia).
const TECH = {
  Q01: { country: 'BO', currency: 'BOB' },
  Q02: 'A25_34',
  Q03: 'D1',
  Q04: { route: 'EMPLOYEE', occupation: 'Técnico de refrigeración y aire acondicionado' },
  Q05: { priority: 'INCOME', description: 'Aumentar mis ingresos y luego ahorrar para una vivienda', amount: '1500', target_kind: 'ADDITIONAL_INCOME', horizon_months: '6' },
  Q06: { amount: '5100', breakdown: 'Sueldo y reparaciones particulares' },
  Q07: 'MODERATE',
  Q08: { amount: '3500' },
  Q09: { amount: '500' },
  Q10: { presence: 'YES', monthly_due: { amount: '800' } },
  Q11: { presence: 'YES', total_balance: { amount: '12000' }, types: ['LOAN'] },
  Q12: { code: 'ON_TIME' },
  Q13: 'DK',
  Q14: { amount: '600' },
  Q15: { codes: ['NONE'] },
  Q16: { codes: ['VEHICLE', 'EQUIPMENT', 'PHONE_INTERNET'], detail: 'Motocicleta propia y herramientas' },
  Q17: { hours: '8' },
  Q18: { skills: 'Diagnosticar fallas y reparar equipos', task: 'Resolví reparaciones sin cambiar piezas que parecían dañadas', result: 'Los clientes ahorraron y me volvieron a llamar' },
  Q19: { text: 'Viviendas, pequeños restaurantes y tiendas con refrigeradores' },
  Q20: { paid_before: 'YES', activity: 'Reparación y limpieza de aires acondicionados', frequency: 'REPEATED' },
  Q21: { text: 'Antiguos clientes particulares y dos conocidos con restaurantes' },
  Q22: { code: 'OTHER', detail: 'Dependo de recomendaciones, no hago seguimiento y no sé cuánto gano por trabajo' },
  Q23: { codes: ['KEEP_JOB', 'CARE'], detail: 'Conservar mi empleo y no trabajar todos los domingos' },
  Q24: { amount: '300', available_now: 'LATER' },
  Q25: 'SELL_SERVICE',
};

function start() {
  return engine.createSession({ consent: true, versionId: V3 }).session;
}
function put(sid, slot, value) {
  const s = engine.loadSession(sid);
  const r = engine.questionAt(s, slot);
  if (!r.question) return null; // pregunta que no aplica
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
  return { id, diag: engine.getDiagnostic(id), answers: engine.activeAnswers(id), session: engine.loadSession(id) };
}
const metric = (r, id) => r.metrics.find((m) => m.id === id);

test.before(() => h.start());
test.after(() => h.stop());

// ───────── Catálogo ─────────

test('catálogo V3: 25 IDs únicos con los textos y campos del catálogo del ingeniero', () => {
  assert.equal(cat.SLOTS.length, 25);
  assert.equal(CATALOG_JSON.questions.length, 25);
  for (const q of CATALOG_JSON.questions) {
    const s = cat.SLOT_BY_ID[q.id];
    assert.ok(s, `falta ${q.id}`);
    assert.equal(s.field, q.field, `campo de ${q.id}`);
    assert.equal(s.variants[0].text, q.prompt, `texto de ${q.id}`);
  }
  for (const s of cat.SLOTS) for (const v of s.variants) assert.ok(cat.renderVariant(v).options.some((o) => o.code === 'DK') && cat.renderVariant(v).options.some((o) => o.code === 'PNA'), `${v.id} sin No lo sé / Prefiero no responder`);
});

test('las sesiones nuevas usan V3 según la configuración; las V2 siguen con su catálogo', () => {
  const v2 = engine.createSession({ consent: true }).session;
  const v3 = start();
  assert.equal(v2.version_id, 'FREE_25_V2_ES');
  assert.equal(v3.version_id, V3);
  assert.equal(engine.getState(v3.id).next_question.text, '¿En qué país vives y en qué moneda manejas normalmente tu dinero?');
  assert.notEqual(engine.getState(v2.id).next_question.slot_id, undefined);
  assert.ok(['FREE_25_V2_ES', V3].includes(config.freeCatalogVersion));
});

test('la moneda viene de Q01 (incluye bolivianos) y los montos se piden en esa moneda', () => {
  const s = start();
  assert.throws(() => put(s.id, 'Q01', { country: 'BO', currency: 'XXX' }), /moneda/i);
  put(s.id, 'Q01', { country: 'BO', currency: 'BOB' });
  assert.equal(engine.loadSession(s.id).currency, 'BOB');
  for (const q of ['Q02', 'Q03', 'Q04', 'Q05']) put(s.id, q, TECH[q]);
  put(s.id, 'Q06', { amount: '5100' });
  assert.equal(engine.activeAnswers(s.id).Q06.value.currency, 'BOB');
  // Cambiar de moneda invalida los montos: se piden de nuevo, sin convertir.
  put(s.id, 'Q01', { country: 'BO', currency: 'USD' });
  assert.equal(engine.activeAnswers(s.id).Q06, undefined);
  assert.equal(engine.activeAnswers(s.id).Q05, undefined, 'el objetivo en Bs también se vuelve a pedir');
  assert.ok(engine.activeAnswers(s.id).Q04, 'lo que no tiene montos se conserva');
});

test('validaciones: rango, cero explícito, horas, habilidades y textos', () => {
  const s = start();
  put(s.id, 'Q01', TECH.Q01);
  for (const q of ['Q02', 'Q03', 'Q04', 'Q05']) put(s.id, q, TECH[q]);
  assert.throws(() => put(s.id, 'Q06', {}), /monto o un rango/);
  assert.throws(() => put(s.id, 'Q06', { min: '5000', max: '4000' }), /mínimo no puede ser mayor/);
  put(s.id, 'Q06', { min: '4500', max: '5500' });
  assert.equal(engine.activeAnswers(s.id).Q06.value.precision, 'range');
  put(s.id, 'Q06', { amount: '0' });
  assert.equal(engine.activeAnswers(s.id).Q06.value.amount, '0.00', 'cero declarado es válido');
  for (const q of ['Q07', 'Q08', 'Q09', 'Q10', 'Q11', 'Q12', 'Q13', 'Q14', 'Q15', 'Q16']) put(s.id, q, TECH[q]);
  assert.throws(() => put(s.id, 'Q17', { hours: '-2' }), /números enteros/);
  assert.throws(() => put(s.id, 'Q17', { hours: '200' }), /Revisa las horas/);
  put(s.id, 'Q17', { hours: '0' });
  assert.throws(() => put(s.id, 'Q18', { skills: 'ventas, cocina, diseño' }), /dos habilidades/);
  put(s.id, 'Q18', 'PNA');
  assert.equal(engine.activeAnswers(s.id).Q18.status, 'declined');
  assert.equal(engine.activeAnswers(s.id).Q18.value, null);
});

test('sin deudas confirmadas en Q10 y Q11, Q12 y Q13 no se preguntan; con dudas sí', () => {
  const noDebt = { ...TECH, Q10: { presence: 'NO' }, Q11: { presence: 'NO' } };
  delete noDebt.Q12;
  delete noDebt.Q13;
  const { id, answers, diag } = finish(noDebt);
  assert.equal(answers.Q12, undefined);
  assert.equal(answers.Q13, undefined);
  assert.equal(diag.status, 'ready');
  const s = engine.loadSession(id);
  assert.ok(!engine.applicableOrder(answers, s).includes('Q12'));
  assert.equal(metric(diag.result, 'monthly_balance').value, '1100.00', 'cuota cero solo por ausencia explícita y coherente');
  // Si una de las dos queda en duda, Q12/Q13 sí aplican y la cuota no es cero.
  const unsure = start();
  for (const q of ['Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q06', 'Q07', 'Q08', 'Q09']) put(unsure.id, q, TECH[q]);
  put(unsure.id, 'Q10', { presence: 'NO' });
  put(unsure.id, 'Q11', { presence: 'UNSURE' });
  assert.equal(engine.getState(unsure.id).next_question.slot_id, 'Q12');
});

test('cambiar la actividad (Q04) adapta Q22 y retira solo esa respuesta', () => {
  const id = answerAll(TECH);
  put(id, 'Q04', { route: 'NONE', occupation: '' });
  const a = engine.activeAnswers(id);
  assert.equal(a.Q22, undefined, 'Q22 cambia de variante y se vuelve a pedir');
  assert.ok(a.Q18 && a.Q06, 'el resto se conserva');
  const q = engine.questionAt(engine.loadSession(id), 'Q22').question;
  assert.equal(q.variant_id, 'V3_Q22_NONE');
  assert.match(q.text, /empezar a generar ingresos/);
});

// ───────── Métricas (8 fixtures del ingeniero) ─────────

function fromFixture(f) {
  const A = { ...TECH };
  A.Q06 = f.net_income === null ? 'DK' : { amount: f.net_income };
  A.Q08 = f.essential === null ? 'DK' : { amount: f.essential };
  A.Q09 = { amount: f.other };
  A.Q14 = f.reserve ? { amount: f.reserve } : 'DK';
  if (f.debt_due === null) A.Q10 = 'DK';
  else if (f.debt_due === '0') {
    A.Q10 = { presence: 'NO' };
    A.Q11 = { presence: 'NO' };
    delete A.Q12;
    delete A.Q13;
  } else A.Q10 = { presence: 'YES', monthly_due: { amount: f.debt_due } };
  if (f.hours !== undefined) A.Q17 = { hours: f.hours };
  if (f.budget !== undefined) A.Q24 = { amount: f.budget, available_now: f.budget === '0' ? 'UNKNOWN' : 'LATER' };
  if (f.net_income === '0') A.Q07 = 'NO_INCOME';
  if (f.occupation === 'docente') {
    A.Q04 = { route: 'EMPLOYEE', occupation: 'Docente de secundaria' };
    A.Q18 = { skills: 'Enseñar matemáticas', task: 'Preparé alumnos para exámenes de ingreso', result: 'Aprobaron y me recomendaron' };
    A.Q20 = { paid_before: 'YES', activity: 'Clases particulares pagadas', frequency: 'REPEATED' };
    A.Q19 = { text: 'Colegios y familias con hijos en secundaria' };
    A.Q21 = { text: 'Padres de familia de mis antiguos alumnos' };
  }
  return A;
}

for (const f of FIXTURES) {
  test(`fixture ${f.id}: saldo esperado ${f.expected_balance}`, () => {
    const { diag } = finish(fromFixture(f));
    assert.equal(diag.status, 'ready');
    const m = metric(diag.result, 'monthly_balance');
    if (f.expected_balance === null) {
      assert.equal(m.value, null, 'desconocido no se convierte en cero');
      assert.ok(m.reason);
    } else assert.equal(Number(m.value), Number(f.expected_balance));
    assert.equal(jsonschema.check(result3.SCHEMA, strip(diag.result)), null, 'el respaldo cumple el esquema');
    if (f.id === 'ZERO_INCOME') assert.equal(metric(diag.result, 'essential_reserve_months').value, null);
    if (f.id === 'NO_TIME') {
      assert.equal(diag.result.opportunity, null, 'sin horas no se propone trabajo adicional');
      assert.doesNotMatch(diag.result.first_action.instruction, /\b(compra|paga|invierte)\b/i);
    }
    if (f.id === 'TECH') assert.equal(diag.result.first_action.kind, 'COMPARE', 'comparar rentabilidad antes de promocionar');
    if (f.id === 'DIFFERENT_CAPABILITY') assert.doesNotMatch(JSON.stringify(diag.result), /refrigera/i, 'la capacidad cambia la lectura');
  });
}

/** Solo los campos del esquema (la vista guarda además métricas, oferta y trazabilidad). */
function strip(r) {
  const keys = Object.keys(result3.SCHEMA.properties);
  return Object.fromEntries(keys.map((k) => [k, r[k]]));
}

test('métricas: reservas, cobertura y objetivo con las cifras de la simulación', () => {
  const { diag } = finish(TECH);
  const r = diag.result;
  assert.equal(metric(r, 'outflow_month').value, '4800.00');
  assert.equal(metric(r, 'essential_gap').value, '800.00');
  assert.equal(metric(r, 'all_outflow_coverage').value, '0.125', 'Bs 600 son el 12,5 % de Bs 4.800');
  assert.equal(metric(r, 'income_goal_increment').value, '1500.00', 'objetivo adicional: no se resta otra vez');
  assert.equal(metric(r, 'income_goal_gap'), undefined);
  assert.equal(r.currency, 'BOB');
});

// ───────── IA: validación y respaldo ─────────

test('el ejemplo del ingeniero cumple el esquema estricto', () => {
  assert.equal(jsonschema.check(result3.SCHEMA, EXAMPLE), null);
  assert.equal(jsonschema.check(result3.SCHEMA, { ...EXAMPLE, offer_id: 'OTRA' }) !== null, true);
  const api = result3.API_SCHEMA;
  assert.equal(JSON.stringify(api).includes('minLength'), false, 'el esquema para la API no lleva longitudes');
});

async function withAi(model, answers = TECH) {
  result3.setClient(model);
  try {
    const id = answerAll(answers);
    const done = engine.complete(id);
    assert.equal(done.generation_status, 'pending');
    await h.queue.drain({ ignoreSchedule: true });
    await h.queue.drain({ ignoreSchedule: true });
    return engine.getDiagnostic(id);
  } finally {
    result3.setClient(null);
  }
}
const good = () => async () => JSON.parse(JSON.stringify({ ...EXAMPLE, insights: [{ ...EXAMPLE.insights[0], meaning: 'Con ingresos de Bs 5.100 y gastos y cuota de Bs 4.800, el mes deja unos Bs 300 y depende de los trabajos particulares.', metric_refs: ['monthly_balance'] }] }));

test('con IA: el análisis de la IA se publica si pasa todas las validaciones', async () => {
  const d = await withAi(good());
  assert.equal(d.status, 'ready');
  assert.equal(d.narrative_source, 'ai');
  assert.equal(d.result.conclusion.title, EXAMPLE.conclusion.title);
  assert.equal(d.result.traceability.prompt_version, 'FREE_PATRIMONIAL_V3_ES');
  assert.equal(d.result.traceability.knowledge_version, 'BCP_V2_ES');
  assert.equal(d.result.offer.benefits.length, 16, 'la oferta la añade el servidor completa');
});

test('con IA: cifras inventadas, métricas inexistentes o términos prohibidos se rechazan', async () => {
  const cases = [
    [(o) => ({ ...o, conclusion: { ...o.conclusion, interpretation: 'Podrías ganar Bs 9.999 al mes con este servicio.' } }), /UNAUTHORIZED_NUMBER/],
    [(o) => ({ ...o, insights: [{ ...o.insights[0], metric_refs: ['patrimonio_neto'] }] }), /METRIC_NOT_AVAILABLE/],
    [(o) => ({ ...o, growth_direction: { ...o.growth_direction, text: 'Te garantizamos duplicar tus ingresos.' } }), /BANNED_TERM/],
    [(o) => ({ ...o, extra: 1 }), /SCHEMA/],
    [(o) => ({ ...o, first_action: { ...o.first_action, instruction: 'Invierte tus ahorros en publicidad pagada esta semana.' } }), /BANNED_TERM|PAID_ACTION/],
  ];
  for (const [mutate, reason] of cases) {
    const d = await withAi(async () => mutate(await good()()));
    assert.equal(d.narrative_source, 'template', `debió rechazarse: ${reason}`);
    assert.match(d.result.traceability.ai_fallback_reason, reason);
    assert.equal(d.result.offer.benefits.length, 16);
  }
});

test('si la IA falla, el diagnóstico de respaldo llega completo', async () => {
  const d = await withAi(async () => {
    throw new Error('timeout simulado');
  });
  assert.equal(d.status, 'ready');
  assert.equal(d.narrative_source, 'template');
  assert.equal(d.result.traceability.ai_fallback_reason, 'PROVIDER_ERROR');
  assert.ok(d.result.conclusion.title);
});

test('el paquete que recibe la IA trae métricas del servidor, bloqueos y no trae identificadores', () => {
  const id = answerAll({ ...TECH, Q17: { hours: '0' }, Q24: { amount: '0' } });
  const s = engine.loadSession(id);
  const pkg = result3.buildPackage(s, engine.activeAnswers(id));
  const p = JSON.parse(result3.buildPrompt(pkg).user);
  assert.ok(p.metricas.some((m) => m.id === 'monthly_balance' && m.valor === '300.00'));
  assert.ok(p.bloqueos.some((b) => b.id === 'PAID_ACTION'));
  assert.ok(p.bloqueos.some((b) => b.id === 'EXTRA_WORK'));
  assert.ok(p.bloqueos.some((b) => b.id === 'QUIT_JOB'));
  assert.equal(p._facts, undefined);
  assert.doesNotMatch(JSON.stringify(p), /ft_[0-9a-f]{8}|@/, 'sin ids de sesión ni correos');
  assert.match(result3.buildPrompt(pkg).system, /RESULT_FREE_V3_ES/);
});

test('contradicciones: ingreso cero con monto declarado y deudas sí/no', () => {
  const id = answerAll({ ...TECH, Q07: 'NO_INCOME' });
  const pkg = result3.buildPackage(engine.loadSession(id), engine.activeAnswers(id));
  assert.ok(pkg.contradicciones.some((c) => c.id === 'CTR_INCOME_ZERO'));
});

// ───────── Vista ─────────

test('vista: preguntas V3 y diagnóstico con la oferta completa, sin XP', async () => {
  const prev = config.freeCatalogVersion;
  config.freeCatalogVersion = V3;
  try {
    const c = new h.Client();
    await h.consent(c);
    const first = await c.get('/test');
    assert.match(first.text, /¿En qué país vives/);
    assert.match(first.text, /Bolivianos \(Bs\)/);
    assert.match(first.text, /name="special"/);
    // Responder por formulario las 25 preguntas.
    const form = {
      1: { country: 'BO', currency: 'BOB' },
      2: { code: 'A25_34' },
      3: { code: 'D1' },
      4: { route: 'EMPLOYEE', occupation: 'Técnico' },
      5: { priority: 'INCOME', amount: '1.500', target_kind: 'ADDITIONAL_INCOME', horizon_months: '6' },
      6: { amount: '5.100' },
      7: { code: 'MODERATE' },
      8: { amount: '3.500' },
      9: { amount: '500' },
      10: { presence: 'YES', amount: '800' },
      11: { presence: 'YES', amount: '12.000', types: 'LOAN' },
      12: { code: 'ON_TIME' },
      13: { special: 'DK' },
      14: { amount: '600' },
      15: { codes: 'NONE' },
      16: { codes: ['VEHICLE', 'EQUIPMENT'] },
      17: { hours: '8' },
      18: { skills: 'Reparar equipos', task: 'Reparé sin cambiar piezas', result: 'Me volvieron a llamar' },
      19: { text: 'Restaurantes pequeños' },
      20: { paid_before: 'YES', activity: 'Limpieza de aires', frequency: 'REPEATED' },
      21: { text: 'Antiguos clientes' },
      22: { code: 'SALARY_LIMIT' },
      23: { codes: ['KEEP_JOB'] },
      24: { amount: '300', available_now: 'LATER' },
      25: { code: 'SELL_SERVICE' },
    };
    for (let n = 1; n <= 25; n++) {
      const page = await c.get(`/test/pregunta/${n}`);
      const variant = page.text.match(/name="variant_id" value="([^"]+)"/)[1];
      const rev = page.text.match(/name="expected_revision" value="(\d+)"/)[1];
      const ctx = page.text.match(/name="resolved_context_hash" value="([^"]+)"/)[1];
      const res = await c.post(`/test/pregunta/${n}`, { variant_id: variant, expected_revision: rev, resolved_context_hash: ctx, action: 'next', ...form[n] }, { follow: false });
      assert.equal(res.status, 303, `pregunta ${n}: ${res.text && res.text.slice(0, 200)}`);
    }
    const review = await c.get('/test/revision');
    assert.match(review.text, /Bs 5\.100 al mes/);
    const fin = await c.post('/test/finalizar', {});
    assert.match(fin.text, /Tu diagnóstico inicial/);
    assert.match(fin.text, /Qué significan tus números/);
    assert.match(fin.text, /Tu primer paso/);
    assert.match(fin.text, /Construye tu estrategia completa con Día Uno/);
    assert.equal((fin.text.match(/<tr class="(is-tool)?"><th scope="row">/g) || []).length, 16, '14 componentes + 2 herramientas');
    assert.match(fin.text, /Construir mi Plan de Crecimiento Patrimonial/);
    assert.match(fin.text, /No se garantizan ingresos ni rentabilidades/);
    assert.doesNotMatch(fin.text, /\+100 XP|reward-card/, 'sin gamificación en el diagnóstico');
  } finally {
    config.freeCatalogVersion = prev;
  }
});

test('vista: mientras la IA trabaja, la página se actualiza sola (sin botón «Actualizar»)', async () => {
  const prev = config.freeCatalogVersion;
  config.freeCatalogVersion = V3;
  result3.setClient(good());
  try {
    const c = new h.Client();
    await h.consent(c);
    await c.get('/test');
    const s = engine.findOwned({ anonId: h.db.one('SELECT anon_id FROM ft_sessions ORDER BY rowid DESC LIMIT 1').anon_id }, 'en_curso');
    for (const q of cat.SLOTS) if (TECH[q.slot_id] !== undefined) put(s.id, q.slot_id, TECH[q.slot_id]);
    await c.post('/test/finalizar', {});
    const wait = await c.get('/resultado');
    assert.match(wait.text, /data-autorefresh="\/resultado"/);
    assert.doesNotMatch(wait.text, />Actualizar</);
    await h.queue.drain({ ignoreSchedule: true });
    const ready = await c.get('/resultado');
    assert.match(ready.text, /Medir tus servicios antes de captar más trabajos/);
  } finally {
    config.freeCatalogVersion = prev;
    result3.setClient(null);
  }
});

test('validador: las advertencias responsables y pagar deudas existentes no se rechazan', async () => {
  const d = await withAi(async () => {
    const o = await good()();
    o.growth_direction.text = 'Si funciona, podrías crecer de a poco; una primera consulta no garantiza ingresos recurrentes.';
    o.first_action.instruction = 'Revisa tus últimos trabajos y anota cobros, costos y tiempo. Si tienes cuotas atrasadas, paga primero lo exigible del mes.';
    return o;
  });
  assert.equal(d.narrative_source, 'ai', d.result.traceability.ai_fallback_reason);
});
