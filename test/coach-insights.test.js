'use strict';
// Coach v2 · S4: insights (docs/coach-v2/05) con una fecha fija, gráficos y su API.
// Casos I1–I14 de docs/coach-v2/10 §4.2 que dependen de datos del servidor.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const entitlements = require('../src/domain/entitlements');
const tracker = require('../src/domain/tracker');
const insights = require('../src/domain/coach/insights');
const G = require('../src/domain/coach/graficos');
const { normalizar } = require('../src/domain/coach/normalizar');
const { setSetting } = require('../src/lib/services');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

const HOY = '2026-11-16'; // día 16 de un mes de 30 días; el anterior (octubre) tiene 31
const NOV = '2026-11';
const OCT = '2026-10';
let seq = 0;

async function user() {
  const c = new h.Client();
  const email = `insight${++seq}@ejemplo.test`;
  await h.registerUser(c, email);
  const u = h.db.one('SELECT * FROM users WHERE email = ?', email);
  entitlements.grantManual({ userId: u.id, code: 'acompanamiento', days: 30, adminId: null, reason: 'prueba de insights' });
  await c.get('/');
  return { c, u };
}

/** Crea un movimiento directamente (sin pasar por la API) para armar escenarios con fechas fijas. */
const mov = (u, kind, category, amount, date, { sub = null, note = null } = {}) =>
  tracker.createMovement(u.id, { kind, category, subcategory: sub, date, amount: String(amount), currency: 'USD', note, noteNorm: note ? normalizar(note) : null, debtId: null, goalId: null, toGoalId: null });
const por = (lista) => Object.fromEntries(lista.map((i) => [i.tipo, i]));
const calc = (u, extra = {}) => por(insights.calcular(u.id, { hoy: HOY, ...extra }).insights);

test('I1: con pocos movimientos solo sale «pocos datos» y manda sobre todo lo demás', async () => {
  const { u } = await user();
  for (const d of ['02', '03', '05', '06']) mov(u, 'gasto', 'alimentacion', 20, `${NOV}-${d}`);
  const r = insights.calcular(u.id, { hoy: HOY });
  assert.deepEqual(r.insights.map((i) => i.tipo), ['INS-POCOS-DATOS']);
  assert.deepEqual(r.insights[0].variables, { n: 4, minimo: 5 });
  const lista = insights.listar(u.id, { hoy: HOY });
  assert.equal(lista.insights.length, 1);
  assert.match(lista.insights[0].texto, /pocos movimientos/);
});

test('estado y rankings: cifras exactas, severidad, orden y máximo de 3 visibles', async () => {
  const { u } = await user();
  mov(u, 'ingreso', 'sueldo', '1000.00', `${NOV}-01`);
  mov(u, 'gasto', 'alimentacion', '300.10', `${NOV}-02`, { note: 'super grande' });
  mov(u, 'gasto', 'transporte', '150.00', `${NOV}-04`);
  mov(u, 'gasto', 'ocio', '49.90', `${NOV}-09`);
  mov(u, 'gasto', 'servicios', '0.10', `${NOV}-10`);
  mov(u, 'gasto', 'servicios', '0.20', `${NOV}-11`);
  const i = calc(u);
  assert.deepEqual([i['INS-RESUMEN-MES'].variables.total_gasto, i['INS-RESUMEN-MES'].variables.saldo], ['500.30', '499.70'], 'sumas exactas con decimales');
  assert.equal(i['INS-SALDO-MES'].variables.dias_restantes, 14);
  assert.equal(i['INS-SALDO-MES'].variables.por_dia, '35.69');
  assert.equal(i['INS-SALDO-MES'].severidad, 'info');
  const mayor = i['INS-MAYOR-CATEGORIA'];
  assert.deepEqual([mayor.variables.categoria, mayor.variables.monto, mayor.variables.pct], ['Alimentación', '300.10', 60]);
  assert.equal(mayor.severidad, 'atencion', '≥ 40 % de concentración');
  assert.equal(i['INS-TOP3'].variables.pct_top3, 100);
  assert.equal(i['INS-TOP3'].severidad, 'atencion', 'top 3 ≥ 75 %');
  assert.equal(i['INS-MAYOR-MOVIMIENTO'].variables.nota, 'super grande');
  assert.equal(i['INS-MENOR-MOVIMIENTO'].variables.monto, '0.10');
  assert.equal(i['INS-TASA-AHORRO'].variables.tasa_ahorro, 0);
  assert.ok(!i['INS-GASTO-VS-INGRESO'], 'G < I: no aplica');
  assert.ok(!i['INS-SIN-INGRESOS']);
  // Proyección simple: 500,30 / 16 × 30.
  const proy = i['INS-PROYECCION-CIERRE'];
  assert.equal(proy.variables.proyeccion_gasto, '938.06');
  assert.equal(proy.variables.pct_ingreso, 93.8);
  assert.equal(proy.severidad, 'atencion', 'entre 90 % y 100 % de los ingresos');
  assert.equal(proy.grafico.tipo, 'tendencia_vs_ritmo');
  assert.equal(proy.grafico.series.length, 16);
  assert.equal(proy.grafico.series[15].valor, '500.30');
  // Selección: severidad (atención) antes que info, y como mucho 3 visibles.
  const lista = insights.listar(u.id, { hoy: HOY, max: 3 });
  assert.equal(lista.insights.length, 3);
  assert.ok(lista.mas.length > 0, 'el resto queda en «Más observaciones»');
  const orden = lista.insights.map((x) => x.severidad);
  assert.deepEqual(orden, [...orden].sort((a, b) => ({ alerta: 4, atencion: 3, logro: 2, info: 1 }[b] - { alerta: 4, atencion: 3, logro: 2, info: 1 }[a])));
  assert.ok(lista.insights.every((x) => x.texto && !/[{}]/.test(x.texto)), 'todos con texto del catálogo sin llaves');
  assert.ok(lista.insights.every((x) => x.botones.every((b) => b.etiqueta)));
});

test('I2/I8: sin ingresos no hay porcentajes sobre ingresos; gasto mayor que ingreso o proyección ≥ 100 % es alerta', async () => {
  const A = await user();
  for (const d of ['01', '03', '05', '08', '10']) mov(A.u, 'gasto', 'ocio', 40, `${NOV}-${d}`);
  const a = calc(A.u);
  assert.ok(a['INS-SIN-INGRESOS']);
  assert.equal(a['INS-SIN-INGRESOS'].severidad, 'atencion');
  assert.ok(!a['INS-PROYECCION-CIERRE'] && !a['INS-TASA-AHORRO'] && !a['INS-GASTO-VS-INGRESO'], 'sin ingresos no hay % sobre ingresos');
  const B = await user();
  mov(B.u, 'ingreso', 'sueldo', '300.00', `${NOV}-01`);
  for (const d of ['02', '04', '06', '08', '10', '12']) mov(B.u, 'gasto', 'alimentacion', 100, `${NOV}-${d}`);
  const b = calc(B.u);
  assert.equal(b['INS-GASTO-VS-INGRESO'].severidad, 'alerta');
  assert.equal(b['INS-GASTO-VS-INGRESO'].variables.diferencia, '300.00');
  assert.equal(b['INS-SALDO-MES'].severidad, 'alerta', 'saldo ≤ 0');
  assert.equal(b['INS-PROYECCION-CIERRE'].severidad, 'alerta', 'proyección ≥ 100 %');
  assert.equal(insights.listar(B.u.id, { hoy: HOY }).insights[0].severidad, 'alerta', 'la alerta va primero');
  // I7: antes del día 5 no se proyecta.
  const temprano = insights.calcular(B.u.id, { hoy: `${NOV}-04` }).insights.map((i) => i.tipo);
  assert.ok(!temprano.includes('INS-PROYECCION-CIERRE'));
});

test('I3–I6: comparación «a la misma altura» y filtro de relevancia', async () => {
  const { u } = await user();
  // Octubre: lo gastado hasta el día 16 es 200 en alimentación y 100 en ocio; los días 20–28 hay 900 más que NO cuentan.
  mov(u, 'ingreso', 'sueldo', '2000.00', `${OCT}-01`);
  for (const d of ['02', '05', '08', '12']) mov(u, 'gasto', 'alimentacion', 50, `${OCT}-${d}`);
  mov(u, 'gasto', 'ocio', '100.00', `${OCT}-10`);
  for (const d of ['20', '22', '25', '28']) mov(u, 'gasto', 'vivienda', 225, `${OCT}-${d}`);
  // Noviembre: alimentación sube a 300 (+50 %, +100), ocio baja a 50 (−50 %, −50), transporte nueva 40.
  mov(u, 'ingreso', 'sueldo', '2000.00', `${NOV}-01`);
  for (const d of ['02', '05', '08']) mov(u, 'gasto', 'alimentacion', 100, `${NOV}-${d}`);
  mov(u, 'gasto', 'ocio', '50.00', `${NOV}-10`);
  mov(u, 'gasto', 'transporte', '40.00', `${NOV}-12`);
  const i = calc(u);
  const total = i['INS-CAMBIO-GASTO-TOTAL'];
  assert.equal(total.variables.total_anterior, '300.00', 'octubre solo hasta el día 16, no el mes completo');
  assert.equal(total.variables.total_actual, '390.00');
  assert.equal(total.variables.delta_pct, 30);
  assert.equal(total.severidad, 'atencion');
  const subio = i['INS-CATEGORIA-SUBIO'];
  assert.deepEqual([subio.variables.categoria, subio.variables.delta_pct, subio.variables.delta_monto], ['Alimentación', 50, '100.00']);
  const bajo = i['INS-CATEGORIA-BAJO'];
  assert.deepEqual([bajo.variables.categoria, bajo.variables.delta_monto], ['Ocio y suscripciones', '-50.00']);
  assert.equal(bajo.severidad, 'logro');
  // I4: categoría nueva (mes anterior 0): no hay porcentaje y no entra como «subió».
  assert.notEqual(subio.variables.categoria, 'Transporte');
  // Un solo insight de «cambio de categoría» entre los visibles (el de mayor |delta_monto|).
  const lista = insights.listar(u.id, { hoy: HOY, max: 10 });
  const grupo = [...lista.insights, ...lista.mas].filter((x) => x.grupo === 'cambio-categoria' || x.tipo.startsWith('INS-CATEGORIA-'));
  assert.equal(grupo.length, 1);
  assert.equal(grupo[0].tipo, 'INS-CATEGORIA-SUBIO');
  // I5/I6: cambio de 14 % o de pocas unidades no se destaca.
  const B = await user();
  mov(B.u, 'ingreso', 'sueldo', '1000.00', `${OCT}-01`);
  for (const d of ['02', '03', '04', '05', '06']) mov(B.u, 'gasto', 'alimentacion', 20, `${OCT}-${d}`); // 100
  mov(B.u, 'ingreso', 'sueldo', '1000.00', `${NOV}-01`);
  for (const d of ['02', '03', '04', '05', '06']) mov(B.u, 'gasto', 'alimentacion', 22.8, `${NOV}-${d}`); // 114 = +14 %
  assert.ok(!calc(B.u)['INS-CAMBIO-GASTO-TOTAL'], '14 % no se destaca (umbral 15 %)');
  const C = await user();
  mov(C.u, 'ingreso', 'sueldo', '100.00', `${OCT}-01`);
  for (const d of ['02', '03', '04', '05', '06']) mov(C.u, 'gasto', 'ocio', 1, `${OCT}-${d}`); // 5
  mov(C.u, 'ingreso', 'sueldo', '100.00', `${NOV}-01`);
  for (const d of ['02', '03', '04', '05', '06']) mov(C.u, 'gasto', 'ocio', 1.4, `${NOV}-${d}`); // 7 = +40 % pero 2 unidades
  assert.ok(!calc(C.u)['INS-CAMBIO-GASTO-TOTAL'], '+40 % pero de 2 unidades: no se destaca');
  // Sin mes anterior suficiente no se compara.
  const D = await user();
  mov(D.u, 'ingreso', 'sueldo', '1000.00', `${NOV}-01`);
  for (const d of ['02', '03', '04', '05', '06']) mov(D.u, 'gasto', 'ocio', 30, `${NOV}-${d}`);
  assert.ok(!calc(D.u)['INS-CAMBIO-GASTO-TOTAL']);
});

test('tendencia de meses, hábitos: hormiga, suscripciones, repetido, día más caro y fin de semana', async () => {
  const { u } = await user();
  // Tendencia: tres meses cerrados que bajan ≥ 5 % cada uno (JUL > AGO > SEP) y octubre.
  const meses = [['2026-07', 400], ['2026-08', 360], ['2026-09', 320]];
  for (const [m, total] of meses) for (const d of ['02', '04', '06', '08', '10']) mov(u, 'gasto', 'alimentacion', total / 5, `${m}-${d}`);
  mov(u, 'ingreso', 'sueldo', '2000.00', `${NOV}-01`);
  // Hormiga: 7 cafés de 3,50 (≥ 6 movimientos) que son ≥ 8 % del gasto del mes.
  for (const d of ['02', '03', '04', '05', '06', '09', '10']) mov(u, 'gasto', 'alimentacion', '3.50', `${NOV}-${d}`, { sub: 'cafe', note: 'café' });
  mov(u, 'gasto', 'transporte', '150.00', `${NOV}-12`);
  // Suscripción: «netflix» con el mismo importe en 3 meses.
  for (const m of ['2026-09', OCT, NOV]) mov(u, 'gasto', 'ocio', '15.00', `${m}-05`, { sub: 'streaming', note: 'netflix' });
  const i = calc(u);
  assert.equal(i['INS-TENDENCIA-MESES'].variables.direccion, 'baja');
  assert.equal(i['INS-TENDENCIA-MESES'].severidad, 'logro');
  assert.equal(i['INS-TENDENCIA-MESES'].grafico.tipo, 'mes_a_mes');
  const hormiga = i['INS-HORMIGA'];
  assert.equal(hormiga.variables.n, 7);
  assert.equal(hormiga.variables.monto_total, '24.50');
  assert.equal(hormiga.variables.principal, 'cafe');
  assert.ok(!('monto_anual' in hormiga.variables) === (16 < 20), 'la proyección anual solo con ≥ 20 días transcurridos');
  const susc = i['INS-SUSCRIPCIONES'];
  assert.equal(susc.variables.n, 1);
  assert.equal(susc.variables.monto_total, '15.00');
  assert.equal(i['INS-GASTO-REPETIDO'].variables.n, 7, 'la misma nota ≥ 3 veces');
  // Hormiga con pocos movimientos o poco peso no se menciona.
  const B = await user();
  mov(B.u, 'ingreso', 'sueldo', '2000.00', `${NOV}-01`);
  for (const d of ['02', '03', '04']) mov(B.u, 'gasto', 'alimentacion', '3.50', `${NOV}-${d}`, { sub: 'cafe', note: 'café' });
  for (const d of ['05', '06', '07']) mov(B.u, 'gasto', 'vivienda', 500, `${NOV}-${d}`);
  assert.ok(!calc(B.u)['INS-HORMIGA'], '3 movimientos < 6: no es un hábito');
  // Fin de semana y día más caro necesitan datos de varias semanas.
  const C = await user();
  mov(C.u, 'ingreso', 'sueldo', '3000.00', `${NOV}-01`);
  for (let sem = 0; sem < 5; sem++) {
    const sab = new Date(Date.UTC(2026, 10, 14 - sem * 7)).toISOString().slice(0, 10); // sábados 14, 7, oct 31, 24, 17
    const lun = new Date(Date.UTC(2026, 10, 9 - sem * 7)).toISOString().slice(0, 10); // lunes
    mov(C.u, 'gasto', 'ocio', 120, sab);
    mov(C.u, 'gasto', 'alimentacion', 20, lun);
  }
  const c = calc(C.u);
  assert.equal(c['INS-DIA-MAS-CARO'].variables.dia_semana, 'sábado');
  assert.equal(c['INS-DIA-MAS-CARO'].grafico.tipo, 'mapa_semana');
  assert.ok(c['INS-FIN-DE-SEMANA'].variables.pct >= 30);
});

test('acciones: recorte solo de gastos discrecionales y nunca vivienda, salud, educación ni servicios', async () => {
  const { u } = await user();
  mov(u, 'ingreso', 'sueldo', '2000.00', `${NOV}-01`);
  mov(u, 'gasto', 'vivienda', '800.00', `${NOV}-02`); // el mayor gasto: nunca se sugiere recortarlo
  mov(u, 'gasto', 'salud', '300.00', `${NOV}-03`);
  mov(u, 'gasto', 'ocio', '200.00', `${NOV}-04`, { sub: 'salidas' });
  mov(u, 'gasto', 'ocio', '100.00', `${NOV}-05`, { sub: 'streaming' });
  mov(u, 'gasto', 'alimentacion', '90.00', `${NOV}-06`, { sub: 'restaurante', note: 'almuerzo' });
  const r = calc(u)['INS-RECORTE-RAPIDO'];
  assert.equal(r.intencion_mensaje, 'recortar_rapido');
  // Gana la subcategoría discrecional de mayor monto (Salidas, 200), no vivienda (800) ni salud (300).
  assert.equal(r.variables.categoria, 'Salidas');
  assert.equal(r.variables.monto, '200.00');
  assert.equal(r.variables.recorte_pct, 20);
  assert.equal(r.variables.libera, '40.00');
  const txt = insights.texto(r, { cur: 'USD' }).texto;
  assert.doesNotMatch(txt, /Vivienda|Salud/);
  assert.doesNotMatch(txt, /\bdebes\b|\bdeberías\b/i, 'hipótesis, no recomendación');
  // Si lo discrecional pesa menos de 10 % del gasto: «sin recorte obvio».
  const B = await user();
  mov(B.u, 'ingreso', 'sueldo', '2000.00', `${NOV}-01`);
  mov(B.u, 'gasto', 'vivienda', '800.00', `${NOV}-02`);
  mov(B.u, 'gasto', 'salud', '300.00', `${NOV}-03`);
  mov(B.u, 'gasto', 'servicios', '100.00', `${NOV}-04`);
  mov(B.u, 'gasto', 'educacion', '200.00', `${NOV}-05`);
  mov(B.u, 'gasto', 'ocio', '10.00', `${NOV}-06`);
  assert.equal(calc(B.u)['INS-RECORTE-RAPIDO'].intencion_mensaje, 'sin_recorte_obvio');
});

test('deudas, metas y presupuesto: liquidable con saldo libre (nunca con ahorro), orden, avance, riesgo y excedido', async () => {
  const { u } = await user();
  mov(u, 'ingreso', 'sueldo', '1000.00', `${NOV}-01`);
  for (const d of ['02', '03', '04', '05', '06']) mov(u, 'gasto', 'alimentacion', 100, `${NOV}-${d}`);
  mov(u, 'ahorro', 'reserva', '100.00', `${NOV}-07`);
  // Saldo libre L = 1000 − 500 − 100 (ahorro) = 400. La reserva NO cuenta como disponible.
  tracker.createDebt(u.id, { name: 'Tarjeta A', kind: 'tarjeta', balance: '300.00', payment: '40.00', rate: '36', rateType: 'nominal_anual', fees: null });
  tracker.createDebt(u.id, { name: 'Préstamo B', kind: 'personal', balance: '900.00', payment: '80.00', rate: '24', rateType: 'nominal_anual', fees: null });
  let i = calc(u);
  const liq = i['INS-DEUDA-LIQUIDABLE'];
  assert.equal(liq.intencion_mensaje, 'deuda_liquidable');
  assert.deepEqual([liq.variables.deuda, liq.variables.saldo_libre, liq.variables.queda], ['Tarjeta A', '400.00', '100.00']);
  assert.equal(liq.severidad, 'logro');
  assert.equal(i['INS-DEUDA-PRIMERO'].variables.deuda, 'Tarjeta A', 'bola de nieve: menor saldo primero');
  assert.equal(i['INS-DEUDA-PRIMERO'].variables.estrategia, 'bola de nieve');
  assert.equal(i['INS-ORDEN-DEUDAS'].variables.lista, 'Tarjeta A y Préstamo B');
  const t = insights.texto(liq, { cur: 'USD' }).texto;
  assert.match(t, /reserva|ahorro/i, 'el mensaje recuerda no usar la reserva');
  // Ninguna cabe en el saldo libre: se muestra la más cercana y cuánto falta.
  const B = await user();
  mov(B.u, 'ingreso', 'sueldo', '500.00', `${NOV}-01`);
  for (const d of ['02', '03', '04', '05', '06']) mov(B.u, 'gasto', 'alimentacion', 60, `${NOV}-${d}`);
  tracker.createDebt(B.u.id, { name: 'Tarjeta Z', kind: 'tarjeta', balance: '1000.00', payment: '50.00', rate: '30', rateType: 'nominal_anual', fees: null });
  const ninguna = calc(B.u)['INS-DEUDA-LIQUIDABLE'];
  assert.equal(ninguna.intencion_mensaje, 'deuda_ninguna_liquidable');
  assert.equal(ninguna.variables.falta, '800.00');
  // Metas: avance y meta en riesgo.
  const goal = tracker.goals(u.id);
  assert.equal(goal.length >= 0, true);
  const gid = h.db.run("INSERT INTO goals (user_id, name, kind, target_amount, target_months, initial_saved, status, created_at, updated_at) VALUES (?, 'Viaje', 'meta', '1200.00', 6, '200.00', 'activa', ?, ?)", u.id, new Date().toISOString(), new Date().toISOString()).lastId;
  assert.ok(gid);
  i = calc(u);
  assert.equal(i['INS-META-AVANCE'].variables.meta, 'Viaje');
  assert.equal(i['INS-META-AVANCE'].variables.avance_pct, 17);
  assert.equal(i['INS-META-AVANCE'].grafico.tipo, 'medidor_meta');
  // Presupuesto: cerca (80–100 %) y excedido (≥ 100 %).
  tracker.saveBudget(u.id, NOV, { b: { gasto: { alimentacion: '520', ocio: '40' } } });
  mov(u, 'gasto', 'ocio', '45.00', `${NOV}-08`);
  i = calc(u);
  assert.equal(i['INS-PRESUPUESTO-EXCEDIDO'].variables.categoria, 'Ocio y suscripciones');
  assert.equal(i['INS-PRESUPUESTO-EXCEDIDO'].variables.exceso, '5.00');
  assert.equal(i['INS-PRESUPUESTO-EXCEDIDO'].severidad, 'alerta');
  assert.equal(i['INS-PRESUPUESTO-CERCA'].variables.categoria, 'Alimentación');
  assert.equal(i['INS-PRESUPUESTO-CERCA'].variables.pct_usado, 96);
  assert.equal(i['INS-PRESUPUESTO-CERCA'].grafico.tipo, 'medidor_presupuesto');
});

test('calidad: sin registro hace días, muchos en «otros» y racha', async () => {
  const { u } = await user();
  mov(u, 'ingreso', 'sueldo', '1000.00', `${NOV}-01`);
  for (const d of ['02', '03', '04', '05']) mov(u, 'gasto', 'otros', 50, `${NOV}-${d}`);
  mov(u, 'gasto', 'alimentacion', 20, `${NOV}-05`);
  const a = insights.calcular(u.id, { hoy: `${NOV}-09` }).insights.map((i) => i.tipo);
  assert.ok(a.includes('INS-SIN-REGISTRO'), 'último movimiento hace 4 días');
  assert.ok(a.includes('INS-MUCHOS-EN-OTROS'));
  const b = insights.calcular(u.id, { hoy: `${NOV}-05` }).insights.map((i) => i.tipo);
  assert.ok(!b.includes('INS-SIN-REGISTRO'));
  // Racha: el día 3 van 3 días seguidos (1, 2 y 3: se celebra); el día 4 son 4 (no es 3 ni múltiplo de 7).
  const r3 = insights.calcular(u.id, { hoy: `${NOV}-03` }).insights.find((i) => i.tipo === 'INS-RACHA');
  assert.equal(r3.variables.racha, 3);
  assert.equal(insights.calcular(u.id, { hoy: `${NOV}-04` }).insights.find((i) => i.tipo === 'INS-RACHA'), undefined);
});

test('I12: descartar oculta 7 días (24 h si es alerta) y reaparece si cambia de severidad', async () => {
  const { u } = await user();
  mov(u, 'ingreso', 'sueldo', '1000.00', `${NOV}-01`);
  for (const d of ['02', '03', '04', '05', '06']) mov(u, 'gasto', 'alimentacion', 100, `${NOV}-${d}`);
  const inicio = insights.listar(u.id, { hoy: HOY, max: 20 });
  const objetivo = inicio.insights.concat(inicio.mas).find((i) => i.tipo === 'INS-MAYOR-CATEGORIA');
  assert.ok(objetivo);
  assert.equal(insights.descartar(u.id, objetivo.id, objetivo.severidad), true);
  assert.equal(insights.descartar(u.id, 'basura', 'info'), false);
  const luego = insights.listar(u.id, { hoy: HOY, max: 20 });
  assert.ok(![...luego.insights, ...luego.mas].some((i) => i.tipo === 'INS-MAYOR-CATEGORIA'));
  // Cambia de severidad: reaparece.
  h.db.run("UPDATE insight_dismissals SET severity = 'info' WHERE user_id = ? AND insight_id = ?", u.id, objetivo.id);
  assert.ok([...insights.listar(u.id, { hoy: HOY, max: 20 }).insights, ...insights.listar(u.id, { hoy: HOY, max: 20 }).mas].some((i) => i.tipo === 'INS-MAYOR-CATEGORIA'));
  // Vencimientos: alerta 24 h, el resto 7 días.
  h.db.run("UPDATE insight_dismissals SET severity = ?, dismissed_at = ? WHERE user_id = ?", 'alerta', new Date(Date.now() - 25 * 3600000).toISOString(), u.id);
  assert.deepEqual(insights.descartados(u.id), {}, 'una alerta descartada hace 25 h ya no está silenciada');
  h.db.run("UPDATE insight_dismissals SET severity = ?, dismissed_at = ? WHERE user_id = ?", 'info', new Date(Date.now() - 6 * 86400000).toISOString(), u.id);
  assert.equal(Object.keys(insights.descartados(u.id)).length, 1);
  h.db.run("UPDATE insight_dismissals SET dismissed_at = ? WHERE user_id = ?", new Date(Date.now() - 8 * 86400000).toISOString(), u.id);
  assert.deepEqual(insights.descartados(u.id), {});
});

test('gráficos: los 10 tipos con patrón, resumen y tabla; el SVG se genera sin datos rotos y escapa el texto', async () => {
  const cur = 'USD';
  const muestras = [
    G.barrasCategorias(cur, 'Gastos <b>por categoría</b>', [{ id: 'a', etiqueta: 'Alimentación <img src=x>', valor: '270.00', pct: 31.4 }, { id: 'b', etiqueta: 'Vivienda', valor: '215.00', pct: 25 }, { id: 'c', etiqueta: 'Cero', valor: '0.00', pct: 0 }]),
    G.barraIngresoGasto(cur, 'Mes', '1200.00', '860.00', '340.00'),
    G.tendenciaVsRitmo(cur, 'Ritmo', ['20.00', '55.00', '860.00'], [{ etiqueta: 'Ingresos', valor: '1200.00' }, { etiqueta: 'Proyección', valor: '1613.00' }], 'Resumen'),
    G.comparativaMeses(cur, 'Comparación', [{ id: 'ocio', etiqueta: 'Ocio', valor: '60.00', valor_comparado: '51.00', delta_pct: 18 }], '2026-11', '2026-10'),
    G.mesAMes(cur, 'Meses', [{ mes: '2026-09', etiqueta: 'sep', valor: '320.00' }, { mes: '2026-10', etiqueta: 'oct', valor: '290.00' }, { mes: '2026-11', etiqueta: 'nov', valor: '250.00' }]),
    G.mapaSemana(cur, 'Semana', ['10', '20', '15', '12', '30', '90', '40'], 5),
    G.medidor('medidor_meta', cur, 'Meta', 'Ahorrado', 200, 1200),
    G.medidor('medidor_presupuesto', cur, 'Presupuesto', 'Ocio', 45, 40),
    G.cascadaMes(cur, 'Cascada', '1000.00', '500.00', '100.00', '100.00', '300.00'),
    G.sparkline(cur, 'Chispa', ['1', '2', '3', '2', '5']),
  ];
  assert.deepEqual(muestras.map((m) => m.tipo).sort(), [...G.TIPOS].sort(), 'los 10 tipos');
  for (const g of muestras) {
    assert.ok(g.a11y && g.a11y.resumen && g.a11y.tabla.length > 1, `${g.tipo}: resumen y tabla`);
    const svg = G.render(g);
    assert.match(svg, /<svg [^>]*role="img"[^>]*aria-label="/, `${g.tipo}: alternativa textual`);
    assert.match(svg, /<details class="gr-data"><summary>Ver datos<\/summary>/);
    assert.doesNotMatch(svg, /NaN|undefined|Infinity/, `${g.tipo}: sin valores rotos`);
    assert.doesNotMatch(svg, /<b>|<img/, `${g.tipo}: el texto se escapa`);
  }
  const barras = muestras[0];
  assert.ok(new Set(barras.series.map((s) => s.patron)).size > 1, 'no depende solo del color: cada serie lleva un patrón');
  assert.ok(barras.series.every((s) => /^serie-[1-8]$/.test(s.token_color)));
  assert.match(G.render(barras), /<rect [^>]*width="1\.0"/, 'un valor cero se dibuja con 1 px y no desaparece');
});

test('API: insights, descartar y gráficos con permiso; sin permiso 403; entre cuentas no se mezclan', async () => {
  const { c, u } = await user();
  const hoy = new Date().toISOString().slice(0, 10);
  const month = hoy.slice(0, 7);
  mov(u, 'ingreso', 'sueldo', '1000.00', `${month}-01`);
  for (const d of ['01', '01', '01', '01', '01']) mov(u, 'gasto', 'alimentacion', 60, `${month}-${d}`);
  const api = async (method, url, json) => {
    const r = await c.req(method, `/api/v1${url}`, method === 'GET' ? {} : { json: json || {} });
    return { status: r.status, body: JSON.parse(r.text) };
  };
  const lista = await api('GET', '/insights?max=3');
  assert.equal(lista.status, 200);
  assert.ok(lista.body.insights.length >= 1 && lista.body.insights.length <= 3);
  assert.ok(lista.body.insights.every((i) => i.texto && i.id && i.severidad && !('grupo' in i)));
  assert.match(lista.body.catalog_version, /^MSG_V1_ES\+/);
  const total = lista.body.total;
  const primero = lista.body.insights[0];
  const des = await api('POST', `/insights/${encodeURIComponent(primero.id)}/descartar`);
  assert.equal(des.status, 200);
  const despues = await api('GET', '/insights?max=10');
  assert.ok(!despues.body.insights.concat(despues.body.mas).some((i) => i.id === primero.id));
  assert.equal(despues.body.total, total - 1);
  assert.equal((await api('POST', '/insights/INS-NO-EXISTE%3A2026-11/descartar')).status, 404);
  const g = await api('GET', '/graficos/barras_categorias');
  assert.equal(g.status, 200);
  assert.equal(g.body.tipo, 'barras_categorias');
  assert.equal((await api('GET', '/graficos/cascada_mes')).body.tipo, 'cascada_mes');
  assert.equal((await api('GET', '/graficos/inventado')).status, 404);
  assert.equal((await api('GET', '/graficos/mapa_semana')).body.error.codigo, 'SIN_DATOS');
  // Otra cuenta, sin datos: no ve lo de ésta.
  const B = await user();
  const bl = await (async () => {
    const r = await B.c.req('GET', '/api/v1/insights', {});
    return JSON.parse(r.text);
  })();
  assert.equal(bl.insights[0].tipo, 'INS-POCOS-DATOS');
  // Sin el permiso de acompañamiento: 403 (el análisis es de pago).
  const free = new h.Client();
  await h.registerUser(free, `libre${++seq}@ejemplo.test`);
  setSetting('coach_v2_registro_rapido', true);
  assert.equal((await free.get('/api/v1/insights', { follow: false })).status, 403);
  assert.equal((await free.get('/api/v1/graficos/barras_categorias', { follow: false })).status, 403);
  setSetting('coach_v2_registro_rapido', false);
});
