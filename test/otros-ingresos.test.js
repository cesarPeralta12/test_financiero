'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const qs = require('../src/domain/questionnaire');

const q = { code: 'ingresos_adicionales', type: 'money_flow', config: { periods: ['mensual', 'quincenal', 'semanal', 'anual'] }, options: [] };

test('otros ingresos: «No» se guarda como 0 sin pedir monto', () => {
  const r = qs.parseSubmission(q, { has: 'no' }, 'USD');
  assert.equal(r.ok, true);
  assert.equal(Number(r.value.amount), 0);
  assert.equal(qs.display(q, { value: r.value }, 'USD'), 'No');
  assert.deepEqual(qs.toForm(q, { value: r.value }), { has: 'no' });
});

test('otros ingresos: «Sí» exige monto y periodo; sin elegir pide Sí o No', () => {
  assert.equal(qs.parseSubmission(q, {}, 'BOB').errors.has, 'Elige Sí o No para continuar.');
  assert.ok(qs.parseSubmission(q, { has: 'si', amount: '', period: 'mensual' }, 'BOB').errors.amount);
  const r = qs.parseSubmission(q, { has: 'si', amount: '1.200', period: 'mensual' }, 'BOB');
  assert.equal(r.ok, true);
  assert.equal(Number(r.value.amount), 1200);
});
