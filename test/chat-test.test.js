'use strict';
// Intérprete de respuestas escritas con tus palabras (se usará en la evaluación en forma de chat).
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const config = require('../src/config');
const chat4 = require('../src/domain/free/chat4');
const cat = require('../src/domain/free/catalog4');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

const V = cat.VARIANT_BY_ID;

test('intérprete: entiende respuestas libres comunes', () => {
  assert.deepEqual(chat4.interpret(V.V4_Q01, 'Bolivia').fields, { country: 'BO', currency: 'BOB' });
  assert.deepEqual(chat4.interpret(V.V4_Q02, 'tengo 29').fields, { codes: ['A25_34'] });
  assert.deepEqual(chat4.interpret(V.V4_Q04, 'vendo ropa en la feria').fields, { codes: ['INDEPENDENT'] });
  assert.deepEqual(chat4.interpret(V.V4_Q06, 'gano unos 2.500').fields, { amount: '2500' });
  assert.deepEqual(chat4.interpret(V.V4_Q10, 'no tengo deudas').fields, { status: 'NO' });
  assert.deepEqual(chat4.interpret(V.V4_Q10, 'sí, pago 400').fields, { status: 'DUE', amount: '400' });
  assert.deepEqual(chat4.interpret(V.V4_Q17, 'vender y cocinar').fields, { codes: ['SELL', 'COOK'] });
  assert.deepEqual(chat4.interpret(V.V4_Q07, 'no sé').fields, { special: 'DK' });
  assert.ok(chat4.interpret(V.V4_Q06, 'mucho').error, 'sin cifra no inventa un monto');
});
