'use strict';
// Criterio de aceptación «Cálculos»: ingresos cero, ahorro negativo, tasa nominal y
// efectiva, deuda sin amortización y meta sin aporte.
process.env.APP_ENV = 'testing';
const test = require('node:test');
const assert = require('node:assert/strict');
const calc = require('../src/domain/calc');
const money = require('../src/lib/money');
const { D } = money;

test('normaliza flujos a periodicidad mensual', () => {
  assert.equal(calc.toMonthly('1200', 'mensual').toFixed(2), '1200.00');
  assert.equal(calc.toMonthly('600', 'quincenal').toFixed(2), '1200.00');
  assert.equal(calc.toMonthly('300', 'semanal').toFixed(2), '1300.00'); // 300 × 52 ÷ 12
  assert.equal(calc.toMonthly('12000', 'anual').toFixed(2), '1000.00');
  assert.equal(calc.toMonthly(null, 'mensual'), null, 'dato desconocido no se convierte en cero');
});

test('saldo disponible = ingresos − gastos − pagos de deuda', () => {
  const r = calc.availableBalance({ income: '2000', expenses: '1200', debtPayments: '300' });
  assert.equal(r.value.toFixed(2), '500.00');
  const unknown = calc.availableBalance({ income: '2000', expenses: null, debtPayments: '0' });
  assert.equal(unknown.value, null);
  assert.deepEqual(unknown.missing, ['gastos']);
});

test('ahorro negativo: el saldo puede ser negativo y se informa así', () => {
  const r = calc.availableBalance({ income: '1000', expenses: '1100', debtPayments: '200' });
  assert.equal(r.value.toFixed(2), '-300.00');
  const rate = calc.savingsRate('-300', '1000');
  assert.equal(rate.value.toFixed(2), '-0.30');
});

test('ingresos cero: no se calcula la tasa de ahorro', () => {
  const r = calc.savingsRate('100', '0');
  assert.equal(r.value, null);
  assert.equal(r.reason, 'ingresos_cero');
  const unknown = calc.savingsRate('100', null);
  assert.equal(unknown.reason, 'dato_desconocido');
});

test('tasa nominal anual se mensualiza como tasa ÷ 12', () => {
  const i = calc.monthlyRate('24', 'nominal_anual');
  assert.equal(i.toFixed(6), '0.020000');
});

test('tasa efectiva anual se convierte como (1 + tasa)^(1/12) − 1', () => {
  const i = calc.monthlyRate('26.8241795', 'efectiva_anual');
  assert.equal(i.toFixed(6), '0.020000');
  const j = calc.monthlyRate('12', 'efectiva_anual');
  assert.equal(j.toFixed(8), '0.00948879');
  assert.ok(calc.effectiveAnnual(j).minus('0.12').abs().lt('1e-12'));
});

test('tasa de tipo desconocido deja la simulación incompleta', () => {
  assert.equal(calc.monthlyRate('30', 'desconocido'), null);
  const p = calc.projectDebt({ balance: '1000', payment: '100', ratePercent: '30', rateType: 'desconocido' });
  assert.equal(p.status, 'tasa_desconocida');
  assert.equal(p.complete, false);
});

test('deuda sin amortización: el pago no cubre el interés y no hay fecha ficticia', () => {
  // 10 000 al 36 % nominal anual → 300 de interés mensual; pago de 250.
  const p = calc.projectDebt({ balance: '10000', payment: '250', ratePercent: '36', rateType: 'nominal_anual' });
  assert.equal(p.status, 'pago_no_cubre_interes');
  assert.equal(p.alert, true);
  assert.equal(p.months, null);
  assert.equal(p.firstInterest.toFixed(2), '300.00');
  assert.equal(p.shortfall.toFixed(2), '50.00');
  // Pago exactamente igual al interés tampoco amortiza.
  const q = calc.projectDebt({ balance: '10000', payment: '300', ratePercent: '36', rateType: 'nominal_anual' });
  assert.equal(q.status, 'pago_no_cubre_interes');
});

test('comisiones conocidas se suman; desconocidas no', () => {
  const sin = calc.projectDebt({ balance: '1000', payment: '100', ratePercent: '12', rateType: 'nominal_anual' });
  const con = calc.projectDebt({ balance: '1000', payment: '100', ratePercent: '12', rateType: 'nominal_anual', fees: '10' });
  assert.equal(sin.feesKnown, false);
  assert.equal(con.feesKnown, true);
  assert.ok(con.months > sin.months);
});

test('proyección de deuda amortizable', () => {
  const p = calc.projectDebt({ balance: '1000', payment: '100', ratePercent: '12', rateType: 'nominal_anual' });
  assert.equal(p.status, 'proyectada');
  assert.equal(p.months, 11);
  assert.equal(p.schedule[0].interest.toFixed(2), '10.00');
  assert.equal(p.schedule.at(-1).balance.toFixed(2), '0.00');
  // Total pagado = saldo inicial + intereses.
  assert.equal(p.totalPaid.toFixed(2), new D('1000').plus(p.totalInterest).toFixed(2));
});

test('meta sin aporte: no existe un plazo alcanzable', () => {
  const g = calc.goalProgress({ target: '5000', saved: '1000', monthly: '0' });
  assert.equal(g.reachable, false);
  assert.equal(g.reason, 'sin_aporte');
  assert.equal(g.months, null);
  assert.equal(g.progress.toFixed(2), '0.20');
  const neg = calc.goalProgress({ target: '5000', saved: '0', monthly: '-50' });
  assert.equal(neg.reachable, false);
});

test('meta con aporte: plazo = pendiente ÷ aporte (redondeado hacia arriba)', () => {
  const g = calc.goalProgress({ target: '5000', saved: '1000', monthly: '300', desiredMonths: 10 });
  assert.equal(g.pending.toFixed(2), '4000.00');
  assert.equal(g.months, 14);
  assert.equal(g.needed.toFixed(2), '400.00');
  assert.equal(g.onTrack, false);
  const done = calc.goalProgress({ target: '100', saved: '150', monthly: '0' });
  assert.equal(done.reason, 'meta_cumplida');
  assert.equal(done.progress.toFixed(2), '1.00');
});

test('avalancha: el pago extra reduce plazo e intereses sin contarse dos veces', () => {
  const debts = [
    { name: 'Tarjeta', balance: '3000', payment: '150', rate: '48', rateType: 'nominal_anual' },
    { name: 'Préstamo', balance: '5000', payment: '200', rate: '18', rateType: 'efectiva_anual' },
  ];
  const base = calc.projectDebts(debts);
  const plus = calc.projectDebts(debts, { extra: '100' });
  assert.ok(plus.months < base.months);
  assert.ok(plus.totalInterest.lt(base.totalInterest));
  const unknown = calc.projectDebts([...debts, { name: 'Familiar', balance: '500', payment: '50', rate: null, rateType: 'desconocido' }]);
  assert.deepEqual(unknown.incomplete, ['Familiar']);
});

test('lectura de importes escritos por personas', () => {
  assert.equal(money.parseAmount('1.250,50', 'COP').value, '1250.50');
  assert.equal(money.parseAmount('1,250.50', 'MXN').value, '1250.50');
  assert.equal(money.parseAmount('1.250', 'MXN').value, '1250.00');
  assert.equal(money.parseAmount('1,5', 'EUR').value, '1.50');
  assert.equal(money.parseAmount('$ 3 400', 'USD').value, '3400.00');
  assert.equal(money.parseAmount('0', 'USD').value, '0.00');
  assert.equal(money.parseAmount('', 'USD').empty, true);
  assert.equal(money.parseAmount('-5', 'USD').ok, false);
  assert.equal(money.parseAmount('12,345', 'USD').value, '12345.00');
  assert.equal(money.parseAmount('1.2.3,45', 'EUR').value, '123.45');
  assert.equal(money.parseAmount('abc', 'USD').ok, false);
  assert.equal(money.parseAmount('1,999', 'USD').ok, true);
});

test('redondeo de presentación ROUND_HALF_UP a dos decimales', () => {
  assert.equal(money.str('0.005'), '0.01');
  assert.equal(money.str('2.675'), '2.68'); // en coma flotante sería 2.67
  assert.equal(money.str('-1.005'), '-1.01');
});
