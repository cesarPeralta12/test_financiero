'use strict';
// API JSON /api/free-tests: creación, autorización, respuestas, concurrencia,
// idempotencia, finalización y diagnóstico.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let base;
test.before(async () => {
  base = await h.start();
});
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

async function api(method, path, { token = null, json, headers = {}, cookie = null } = {}) {
  const res = await fetch(`${base}/api/free-tests${path}`, {
    method,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* sin cuerpo */
  }
  return { status: res.status, body, text };
}

async function create(extra = {}) {
  const r = await api('POST', '', { json: { consent: true, ...extra } });
  assert.equal(r.status, 201, r.text);
  return { id: r.body.session_id, token: r.body.access_token, state: r.body };
}

let seq = 0;
/** Responde un slot siguiendo la pregunta vigente que devuelve la API. */
async function answer(s, q, revision, value, extra = {}) {
  return api('PUT', `/${s.id}/answers/${q.slot_id}`, {
    token: s.token,
    json: { variant_id: q.variant_id, expected_revision: revision, resolved_context_hash: q.resolved_context_hash, idempotency_key: `k-${++seq}`, value, ...extra },
  });
}
async function fillAll(s, answers = h.FREE_ANSWERS) {
  let state = s.state;
  const events = [];
  while (state.next_question) {
    const q = state.next_question;
    const r = await answer(s, q, state.revision ?? s.rev ?? 0, answers[q.slot_id]);
    assert.equal(r.status, 200, `${q.slot_id}: ${r.text}`);
    if (r.body.annotation) events.push(r.body.annotation);
    state = { ...r.body, revision: r.body.revision };
    s.rev = r.body.revision;
  }
  return { state, events };
}

test('crear una sesión exige consentimiento y devuelve un token de acceso no predecible', async () => {
  const no = await api('POST', '', { json: {} });
  assert.equal(no.status, 403);
  assert.equal(no.body.error.code, 'CONSENT_REQUIRED');
  const a = await create();
  const b = await create();
  assert.match(a.id, /^ft_[0-9a-f]{32}$/);
  assert.ok(a.token.length >= 40 && a.token !== b.token && a.id !== b.id);
  assert.equal(a.state.revision, 0);
  assert.equal(a.state.version_id, 'FREE_25_V2_ES');
  assert.equal(a.state.status, 'en_curso');
  assert.equal(a.state.next_question.slot_id, 'Q01');
  assert.equal(a.state.next_question.ordinal, 1);
  assert.deepEqual(a.state.next_question.options.map((o) => o.code).slice(-2), ['DK', 'PNA']);
  assert.ok(a.state.next_question.options.every((o) => o.code && o.label), 'cada opción lleva code y label');
  assert.equal(a.state.progress.total, 25);
  assert.deepEqual(a.state.annotation, null);
  // Versión o idioma no disponibles.
  assert.equal((await api('POST', '', { json: { consent: true, version_id: 'OTRA' } })).body.error.code, 'UNSUPPORTED_VERSION');
  assert.equal((await api('POST', '', { json: { consent: true, locale: 'en' } })).body.error.code, 'UNSUPPORTED_LOCALE');
  assert.equal((await api('POST', '', { json: { consent: true, currency: 'XX' } })).body.error.code, 'INVALID_CURRENCY');
  const withCur = await create({ currency: 'EUR' });
  assert.equal(withCur.state.currency, 'EUR');
});

test('no se accede a un test por conocer su id: sin token o con el token de otro test es 404', async () => {
  const a = await create();
  const b = await create();
  assert.equal((await api('GET', `/${a.id}`)).status, 404);
  assert.equal((await api('GET', `/${a.id}`, { token: b.token })).status, 404);
  assert.equal((await api('GET', `/${a.id}`, { token: 'x'.repeat(43) })).status, 404);
  assert.equal((await api('GET', `/${a.id}`, { token: a.token })).status, 200);
  assert.equal((await api('GET', '/ft_inexistente', { token: a.token })).status, 404);
  assert.equal((await api('PUT', `/${a.id}/answers/Q01`, { json: { variant_id: 'Q01_GOAL', expected_revision: 0, value: 'PAY_DEBT' } })).status, 404);
  assert.equal((await api('POST', `/${a.id}/complete`)).status, 404);
  assert.equal((await api('GET', `/${a.id}/diagnostic`)).status, 404);
  // La misma regla de formato de error en todos los casos.
  assert.equal((await api('GET', `/${a.id}`)).body.error.code, 'NOT_FOUND');
});

test('recorrido completo por API: anotaciones, finalización, diagnóstico y resultado estructurado', async () => {
  const s = await create();
  const { state, events } = await fillAll(s);
  assert.equal(state.next_question, null);
  assert.equal(state.progress.completed_count, 25);
  assert.deepEqual(events.map((e) => e.rule_id), ['A05', 'A08', 'A14']);
  assert.equal(events[0].placement, 'below_next_question');
  // Reanudar no devuelve anotación y muestra el estado.
  const resume = await api('GET', `/${s.id}`, { token: s.token });
  assert.equal(resume.body.annotation, null);
  assert.equal(resume.body.revision, 25);
  // Aún no se puede leer el diagnóstico.
  const early = await api('GET', `/${s.id}/diagnostic`, { token: s.token });
  assert.equal(early.status, 409);
  assert.equal(early.body.error.code, 'NOT_COMPLETED');
  const done = await api('POST', `/${s.id}/complete`, { token: s.token });
  assert.equal(done.status, 200);
  assert.equal(done.body.generation_status, 'ready');
  const again = await api('POST', `/${s.id}/complete`, { token: s.token });
  assert.equal(again.body.diagnostic_id, done.body.diagnostic_id);
  const d = await api('GET', `/${s.id}/diagnostic`, { token: s.token });
  assert.equal(d.body.status, 'ready');
  assert.equal(d.body.narrative_source, 'template');
  const r = d.body.result;
  for (const k of ['result_id', 'session_id', 'answer_revision', 'questionnaire_version', 'result_rules_version', 'narrative_version', 'locale', 'generated_at', 'status', 'narrative_source', 'data_quality', 'invalid_metrics', 'coverage', 'profile', 'attention', 'preliminary', 'facts', 'metrics', 'dimensions', 'strengths', 'findings', 'goal', 'opportunities', 'priorities', 'roadmap', 'first_action', 'missing_data', 'save_result', 'next_step']) {
    assert.ok(k in r, `falta ${k} en el esquema del resultado`);
  }
  assert.equal(r.dimensions.length, 7);
  assert.equal(r.roadmap.length, 4);
  assert.equal(r.answer_revision, 25);
  assert.equal(r.preliminary, true);
  assert.equal(r.profile.title, 'Ingreso estable y reserva limitada');
});

test('errores de validación 422, conflictos 409 y estado vigente sin sobrescribir', async () => {
  const s = await create({ currency: 'USD' });
  const q1 = s.state.next_question;
  const bad = await answer(s, q1, 0, 'NO_EXISTE');
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, 'INVALID_OPTION');
  assert.ok(bad.body.error.message);
  const stale = await answer(s, q1, 7, 'PAY_DEBT');
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'STALE_REVISION');
  assert.equal(stale.body.error.current.revision, 0, 'devuelve el estado vigente');
  const noKeyVariant = await api('PUT', `/${s.id}/answers/Q01`, { token: s.token, json: { variant_id: 'Q01_X', expected_revision: 0, value: 'PAY_DEBT' } });
  assert.equal(noKeyVariant.body.error.code, 'STALE_VARIANT');
  const ok = await api('PUT', `/${s.id}/answers/Q01`, { token: s.token, json: { variant_id: 'Q01_GOAL', expected_revision: 0, value: 'PAY_DEBT', idempotency_key: 'same' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.revision, 1);
  const replay = await api('PUT', `/${s.id}/answers/Q01`, { token: s.token, json: { variant_id: 'Q01_GOAL', expected_revision: 0, value: 'PAY_DEBT', idempotency_key: 'same' } });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.revision, 1, 'el mismo envío repetido no avanza la revisión');
  const conflict = await api('PUT', `/${s.id}/answers/Q01`, { token: s.token, json: { variant_id: 'Q01_GOAL', expected_revision: 0, value: 'BUILD_WEALTH', idempotency_key: 'same' } });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');
  // Incompleto.
  const inc = await api('POST', `/${s.id}/complete`, { token: s.token });
  assert.equal(inc.status, 409);
  assert.equal(inc.body.error.code, 'INCOMPLETE');
  assert.equal(inc.body.error.pending[0].slot_id, 'Q02');
  // Importes y moneda.
  const t = await create({ currency: 'USD' });
  const state = (await api('GET', `/${t.id}`, { token: t.token })).body;
  assert.ok(state);
});

test('importes y edades por API: INVALID_AMOUNT, CURRENCY_MISMATCH, AGE_BELOW_RANGE y confirmación', async () => {
  const s = await create({ currency: 'USD' });
  const upTo = { ...h.FREE_ANSWERS };
  let state = s.state;
  let rev = 0;
  while (state.next_question && state.next_question.ordinal < 17) {
    const r = await answer(s, state.next_question, rev, upTo[state.next_question.slot_id]);
    state = r.body;
    rev = r.body.revision;
  }
  const q17 = state.next_question;
  assert.equal(q17.type, 'age_or_choice');
  const below = await answer(s, q17, rev, { kind: 'AGE', value: 40 });
  assert.equal(below.body.error.code, 'AGE_BELOW_RANGE');
  const confirm = await answer(s, q17, rev, { kind: 'AGE', value: 49 });
  assert.equal(confirm.body.error.code, 'CONFIRMATION_REQUIRED');
  const ok17 = await answer(s, q17, rev, { kind: 'AGE', value: 49, confirmed: true });
  assert.equal(ok17.status, 200);
  const q18 = ok17.body.next_question;
  assert.equal(q18.type, 'money_or_choice');
  assert.equal(q18.currency, 'USD');
  assert.deepEqual(q18.amount_limits, { min: '0.01', max: '999999999.99', decimals: 2 });
  const rev18 = ok17.body.revision;
  assert.equal((await answer(s, q18, rev18, { kind: 'AMOUNT', amount: 3000, currency: 'USD' })).body.error.code, 'INVALID_AMOUNT');
  assert.equal((await answer(s, q18, rev18, { kind: 'AMOUNT', amount: '0', currency: 'USD' })).body.error.code, 'INVALID_AMOUNT');
  assert.equal((await answer(s, q18, rev18, { kind: 'AMOUNT', amount: '10.123', currency: 'USD' })).body.error.code, 'INVALID_AMOUNT');
  const mismatch = await answer(s, q18, rev18, { kind: 'AMOUNT', amount: '100.00', currency: 'EUR' });
  assert.equal(mismatch.status, 422);
  assert.equal(mismatch.body.error.code, 'CURRENCY_MISMATCH');
  const good = await answer(s, q18, rev18, { kind: 'AMOUNT', amount: '3000.5', currency: 'USD' });
  assert.equal(good.status, 200);
});

test('dos pestañas: con la misma revisión solo una escritura gana; la otra recibe 409 sin sobrescribir', async () => {
  const s = await create();
  const q = s.state.next_question;
  const [a, b] = await Promise.all([answer(s, q, 0, 'PAY_DEBT'), answer(s, q, 0, 'BUILD_WEALTH')]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const loser = a.status === 409 ? a : b;
  assert.equal(loser.body.error.code, 'STALE_REVISION');
  const st = await api('GET', `/${s.id}`, { token: s.token });
  assert.equal(st.body.revision, 1);
  assert.equal(h.db.value("SELECT COUNT(*) FROM ft_answers WHERE session_id = ? AND slot_id = 'Q01' AND active = 1", s.id), 1);
});

test('editar tras finalizar retira el diagnóstico anterior; finalizar de nuevo crea otro', async () => {
  const s = await create();
  await fillAll(s);
  const first = await api('POST', `/${s.id}/complete`, { token: s.token });
  const q = (await api('GET', `/${s.id}/questions/Q02`, { token: s.token })).body;
  assert.equal(q.question.variant_id, 'Q02_SITUATION');
  assert.equal(q.answer.value, 'JUST_ENOUGH');
  const edit = await answer(s, q.question, q.revision, 'SHORTFALL');
  assert.equal(edit.status, 200);
  assert.equal(edit.body.annotation, null, 'una edición no crea anotaciones');
  const stale = await api('GET', `/${s.id}/diagnostic`, { token: s.token });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'RESULT_STALE');
  const second = await api('POST', `/${s.id}/complete`, { token: s.token });
  assert.notEqual(second.body.diagnostic_id, first.body.diagnostic_id);
  const d = await api('GET', `/${s.id}/diagnostic`, { token: s.token });
  assert.equal(d.body.result.priorities[0].code, 'P01');
  // Reintento: no hay nada que reintentar si ya está listo.
  const retry = await api('POST', `/${s.id}/diagnostic/retry`, { token: s.token });
  assert.equal(retry.body.generation_status, 'ready');
  // Pedir un slot cuyas previas no están respondidas da 409.
  const fresh = await create();
  assert.equal((await api('GET', `/${fresh.id}/questions/Q05`, { token: fresh.token })).status, 409);
  assert.equal((await api('GET', `/${fresh.id}/questions/Q99`, { token: fresh.token })).status, 404);
});

test('con una sesión de navegador: exige CSRF, y solo su propietario accede', async () => {
  const c = new h.Client();
  await h.consent(c);
  await c.get('/test'); // crea la sesión de navegador
  const noCsrf = await fetch(`${base}/api/free-tests`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: c.cookieHeader() }, body: '{}' });
  assert.equal(noCsrf.status, 403, 'con cookie de sesión se exige X-CSRF-Token');
  const withCsrf = await c.req('POST', '/api/free-tests', { json: {} });
  assert.equal(withCsrf.status, 201);
  const body = JSON.parse(withCsrf.text);
  // El propietario accede por cookie sin token; otro navegador no.
  const own = await api('GET', `/${body.session_id}`, { cookie: c.cookieHeader() });
  assert.equal(own.status, 200);
  const other = new h.Client();
  await other.get('/');
  assert.equal((await api('GET', `/${body.session_id}`, { cookie: other.cookieHeader() })).status, 404);
  // Un PUT con cookie y sin CSRF se rechaza.
  const put = await fetch(`${base}/api/free-tests/${body.session_id}/answers/Q01`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: c.cookieHeader() }, body: JSON.stringify({ variant_id: 'Q01_GOAL', expected_revision: 0, value: 'PAY_DEBT' }) });
  assert.equal(put.status, 403);
  // Con el token de acceso (no ambiental) no hace falta CSRF.
  const viaToken = await api('PUT', `/${body.session_id}/answers/Q01`, { token: body.access_token, json: { variant_id: 'Q01_GOAL', expected_revision: 0, value: 'PAY_DEBT' } });
  assert.equal(viaToken.status, 200);
});

test('vincular el test a una cuenta es idempotente y no se puede robar el de otra cuenta', async () => {
  const s = await create({ currency: 'MXN' });
  const u = new h.Client();
  await h.registerUser(u, 'api-link@ejemplo.test');
  // Sin sesión iniciada: 401.
  const anon = await api('POST', `/${s.id}/link`, { token: s.token });
  assert.equal(anon.status, 401);
  const link = await u.req('POST', `/api/free-tests/${s.id}/link`, { json: {}, headers: { authorization: `Bearer ${s.token}` } });
  assert.equal(link.status, 200);
  const again = await u.req('POST', `/api/free-tests/${s.id}/link`, { json: {}, headers: { authorization: `Bearer ${s.token}` } });
  assert.equal(again.status, 200);
  const row = h.db.one('SELECT * FROM ft_sessions WHERE id = ?', s.id);
  const user = h.db.one("SELECT * FROM users WHERE email = 'api-link@ejemplo.test'");
  assert.equal(row.user_id, user.id);
  assert.equal(user.base_currency, 'MXN');
  // Otra cuenta con el mismo token no puede quedárselo.
  const v = new h.Client();
  await h.registerUser(v, 'api-link2@ejemplo.test');
  const steal = await v.req('POST', `/api/free-tests/${s.id}/link`, { json: {}, headers: { authorization: `Bearer ${s.token}` } });
  assert.equal(steal.status, 409);
  assert.equal(JSON.parse(steal.text).error.code, 'ALREADY_LINKED');
  // El propietario accede por su cuenta sin token.
  assert.equal(JSON.parse((await u.req('GET', `/api/free-tests/${s.id}`)).text).session_id, s.id);
});

test('los errores no incluyen respuestas financieras y el catálogo no se expone', async () => {
  const s = await create();
  const r = await api('PUT', `/${s.id}/answers/Q01`, { token: s.token, json: { variant_id: 'Q01_GOAL', expected_revision: 0, value: 'dato-sensible-123' } });
  assert.equal(r.status, 422);
  assert.ok(!r.text.includes('dato-sensible-123'), 'el error no repite la respuesta');
  const st = await api('GET', `/${s.id}`, { token: s.token });
  assert.doesNotMatch(st.text, /function|when\(|=>/);
  assert.ok([400, 422].includes((await api('PUT', `/${s.id}/answers/Q01`, { token: s.token, json: 'texto' })).status), 'un cuerpo que no es un objeto se rechaza');
  assert.equal((await api('PUT', `/${s.id}/answers/Q01`, { token: s.token, json: {} })).status, 409, 'sin variant_id ni revisión no se guarda nada');
});
