'use strict';
// Tabla de reglas de consejos del resultado gratuito V4: mismo caso, mismo consejo; sin IA.
const test = require('node:test');
const assert = require('node:assert/strict');
const advice = require('../src/domain/free/advice4');

const ans = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { status: 'answered', value: v }]));
const metrics = ({ bal, ingreso, basicos, otros, cuotas = '0.00', reserve }) => [
  { id: 'monthly_balance', value: bal, operands: { ingreso, basicos, otros, cuotas } },
  { id: 'committed_reserve_months', value: reserve, operands: {} },
];

test('saldo positivo sin reserva: separar el 20 % y cuánto juntaría en 6 meses', () => {
  const t = advice.tips(ans({ Q10: { status: 'NO' }, Q07: { codes: ['SIMILAR'] } }), metrics({ bal: '1500.00', ingreso: '4000.00', basicos: '2000.00', otros: '500.00', reserve: '0' }), 'PEN');
  assert.equal(t[0].rule, 'R05');
  assert.match(t[0].action, /Separa PEN 300 cada mes/);
  assert.match(t[0].why, /PEN 1\.?800/);
  assert.ok(t.length <= advice.MAX_TIPS);
});

test('saldo negativo y atrasos: primero deudas, luego recortar el faltante', () => {
  const t = advice.tips(ans({ Q12: { codes: ['LATE'] }, Q10: { status: 'DUE' } }), metrics({ bal: '-300.00', ingreso: '2000.00', basicos: '1500.00', otros: '400.00', cuotas: '400.00', reserve: '0' }), 'BOB');
  assert.deepEqual(t.map((x) => x.rule).slice(0, 2), ['R01', 'R02']);
  assert.match(t[1].action, /Bs 300/);
  assert.ok(!t.some((x) => x.rule === 'R11'), 'sin ideas de ingresos mientras hay atrasos');
});

test('sin datos para el saldo: pide anotar gastos', () => {
  const t = advice.tips(ans({}), [], 'PEN');
  assert.equal(t[0].rule, 'R10');
});

test('saldo negativo sin atrasos: siempre hay 3 consejos útiles (recortar, sin deuda nueva, primer fondo)', () => {
  const t = advice.tips(ans({ Q10: { status: 'NO' } }), metrics({ bal: '-500.00', ingreso: '2500.00', basicos: '2000.00', otros: '1000.00', reserve: '0' }), 'PEN');
  assert.deepEqual(t.map((x) => x.rule), ['R02', 'R13', 'R14']);
  assert.match(t[2].action, /PEN 500/);
});
