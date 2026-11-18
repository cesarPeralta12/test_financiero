'use strict';
// CV2-603: una cuenta con 10.000 movimientos cumple los objetivos de rendimiento de docs/coach-v2/03 §8
// (registrar < 150 ms, respuesta por reglas < 300 ms, insights del mes < 500 ms; p95 sobre varias repeticiones).
// Los límites de esta prueba tienen el mismo valor que los objetivos; si el equipo de CI fuera muy lento, ver el runbook.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const entitlements = require('../src/domain/entitlements');
const tracker = require('../src/domain/tracker');
const insights = require('../src/domain/coach/insights');
const { setSetting } = require('../src/lib/services');

test.before(() => h.start());
test.after(() => h.stop());

const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)];
async function medir(n, fn) {
  const t = [];
  for (let i = 0; i < n; i++) {
    const t0 = process.hrtime.bigint();
    await fn(i);
    t.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return p95(t);
}

test('10.000 movimientos: registrar, responder por reglas, insights y listas dentro de los objetivos', async () => {
  const c = new h.Client();
  await h.registerUser(c, 'carga@ejemplo.test');
  const u = h.db.one('SELECT * FROM users WHERE email = ?', 'carga@ejemplo.test');
  entitlements.grantManual({ userId: u.id, code: 'acompanamiento', days: 30, adminId: null, reason: 'carga' });
  setSetting('coach_v2_enabled', true);
  await c.get('/');

  // 10.000 movimientos en ~14 meses, con notas repetidas y variadas
  const cats = ['alimentacion', 'transporte', 'servicios', 'ocio', 'salud', 'otros'];
  const notas = ['super', 'bus', 'luz', 'cine', 'farmacia', 'café', 'taxi', 'pan'];
  const ahora = new Date().toISOString();
  h.db.tx(() => {
    for (let i = 0; i < 10000; i++) {
      const d = new Date(Date.now() - (i % 420) * 86400000).toISOString().slice(0, 10);
      const nota = notas[i % notas.length];
      h.db.run(
        "INSERT INTO movements (user_id, date, kind, category, amount, currency, note, note_norm, source, created_at, updated_at) VALUES (?, ?, 'gasto', ?, ?, 'USD', ?, ?, 'usuario', ?, ?)",
        u.id, d, cats[i % cats.length], String(5 + (i % 90)) + '.50', nota, nota, ahora, ahora
      );
    }
    for (let m = 0; m < 14; m++) {
      const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - m, 1)).toISOString().slice(0, 10);
      h.db.run("INSERT INTO movements (user_id, date, kind, category, amount, currency, note, note_norm, source, created_at, updated_at) VALUES (?, ?, 'ingreso', 'sueldo', '4000.00', 'USD', 'sueldo', 'sueldo', 'usuario', ?, ?)", u.id, d, ahora, ahora);
    }
  });
  assert.ok(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', u.id) >= 10000);

  const hoy = new Date().toISOString().slice(0, 10);
  const registrar = await medir(30, (i) => {
    const v = tracker.validateMovement(u.id, { kind: 'gasto', category: 'otros', amount: String(10 + i), date: hoy, note: `prueba ${i}` });
    tracker.createMovement(u.id, v.value);
  });
  const reglas = await medir(18, async () => {
    const r = await c.req('POST', '/api/v1/coach/mensajes', { json: { texto: 'resumen del mes' } });
    assert.equal(r.status, 200);
  });
  h.resetRateLimits();
  const mayor = await medir(10, async () => {
    const r = await c.req('POST', '/api/v1/coach/mensajes', { json: { texto: 'en qué gasto más' } });
    assert.equal(r.status, 200);
  });
  const ins = await medir(10, () => insights.listar(u.id, { mes: hoy.slice(0, 7), max: 10 }));
  const lista = await medir(10, async () => {
    const r = await c.req('GET', '/api/v1/movimientos?orden=importe_desc&limite=50', {});
    assert.equal(r.status, 200);
  });
  const resumen = await medir(10, () => tracker.summaryDetail(u.id, hoy.slice(0, 7), hoy));
  console.log(`  p95 (ms): registrar ${registrar.toFixed(1)} · reglas ${reglas.toFixed(1)} · mayor gasto ${mayor.toFixed(1)} · insights ${ins.toFixed(1)} · lista ${lista.toFixed(1)} · resumen ${resumen.toFixed(1)}`);
  assert.ok(registrar < 150, `registrar p95 ${registrar} ms`);
  assert.ok(reglas < 300, `respuesta por reglas p95 ${reglas} ms`);
  assert.ok(mayor < 300, `mayor gasto p95 ${mayor} ms`);
  assert.ok(ins < 500, `insights p95 ${ins} ms`);
  assert.ok(lista < 300, `lista p95 ${lista} ms`);
  assert.ok(resumen < 300, `resumen p95 ${resumen} ms`);
  setSetting('coach_v2_enabled', false);
});
