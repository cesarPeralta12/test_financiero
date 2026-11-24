'use strict';
// Sin cuenta no se entrega el análisis gratuito: se pide registrarse o entrar y luego se muestra.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const config = require('../src/config');
const engine = require('../src/domain/free/engine');
const cat = require('../src/domain/free/catalog4');

const A = { Q01: { country: 'PE', currency: 'PEN' }, Q02: { codes: ['A25_34'] }, Q03: { codes: ['D0'] }, Q04: { codes: ['EMPLOYEE'] }, Q05: { code: 'INCOME', horizon: 'M6' }, Q06: { amount: '2500' }, Q07: { codes: ['SIMILAR'] }, Q08: { amount: '2000' }, Q09: { amount: '1000' }, Q10: { status: 'NO' }, Q13: { amount: '0' }, Q14: { codes: ['NONE'] }, Q15: { codes: ['EQUIPMENT'] }, Q16: { codes: ['H3_7'] }, Q17: { codes: ['SELL'] }, Q18: { codes: ['COMMERCE'] }, Q19: { codes: ['UNPAID'] }, Q20: { codes: ['FRIENDS'] }, Q21: { codes: ['GROWTH'] }, Q22: { codes: ['KEEP_JOB'] }, Q23: { availability: 'NO' }, Q24: { codes: ['SELL_SERVICE'] } };

test.before(async () => {
  await h.start();
  config.resultRequiresAccount = true;
  config.freeCatalogVersion = 'FREE_24_V4_ES';
});
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

async function answered() {
  const c = new h.Client();
  await h.consent(c);
  await c.get('/test');
  const s = h.db.one('SELECT id FROM ft_sessions ORDER BY rowid DESC LIMIT 1');
  for (const q of cat.SLOTS) {
    if (!A[q.slot_id]) continue;
    const cur = engine.loadSession(s.id);
    const r = engine.questionAt(cur, q.slot_id);
    if (r.question) engine.saveAnswer(s.id, q.slot_id, { variant_id: r.question.variant_id, expected_revision: cur.revision, value: A[q.slot_id] });
  }
  const end = await c.post('/test/finalizar', {});
  return { c, end, id: s.id };
}

test('al finalizar sin cuenta se pide registro y no se muestra el análisis', async () => {
  const { c, end, id } = await answered();
  assert.match(end.text, /Regístrate para recibir tu análisis gratuito/);
  assert.doesNotMatch(end.text, /Tus 3 consejos|h-consejos|PEN 500/);
  assert.match(end.text, /\/registro\?siguiente=%2Fresultado/);
  const api = await c.req('GET', `/api/free-tests/${id}/diagnostic`);
  assert.equal(api.status, 403);
  assert.match(api.text, /ACCOUNT_REQUIRED/);
});

test('al registrarse se vinculan las respuestas y se entrega el análisis', async () => {
  const { c, id } = await answered();
  await c.get('/registro?siguiente=%2Fresultado');
  const r = await c.post('/registro?siguiente=%2Fresultado', { name: 'Ana', email: 'gate-nueva@ejemplo.test', password: 'Clave-segura-123', acepto: '1' });
  assert.match(r.url, /\/resultado/);
  assert.match(r.text, /h-consejos/);
  assert.ok(h.db.one('SELECT user_id FROM ft_sessions WHERE id = ?', id).user_id);
});

test('quien ya tiene cuenta entra y recibe el análisis', async () => {
  await h.registerUser(new h.Client(), 'gate-vieja@ejemplo.test');
  const { c, id } = await answered();
  await c.get('/entrar?siguiente=%2Fresultado');
  const r = await c.post('/entrar?siguiente=%2Fresultado', { email: 'gate-vieja@ejemplo.test', password: 'Clave-segura-123' });
  assert.match(r.text, /h-consejos/);
  assert.ok(h.db.one('SELECT user_id FROM ft_sessions WHERE id = ?', id).user_id);
});
