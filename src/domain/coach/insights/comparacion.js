'use strict';
// Insights 13–17 (comparaciones). docs/coach-v2/05 §1.1, §1.2 y §2.3.
// Todo se compara «a la misma altura del mes»; un cambio se destaca solo si es relevante.
const tracker = require('../../tracker');
const G = require('../graficos');
const { D, ZERO, U, r1, fx, insight, gastoMes, contarMes } = require('./base');

const mesesAtras = (month, n) => {
  let m = month;
  for (let i = 0; i < n; i++) m = tracker.prevMonth(m);
  return m;
};

/** Datos de comparación (null si alguno de los dos meses tiene pocos movimientos). */
function datos(c) {
  const prev = c.resumen.mes_anterior;
  const prevKey = tracker.prevMonth(c.month);
  if (!prev || c.n < U.minMovsComparar || contarMes(c.userId, prevKey) < U.minMovsComparar) return null;
  return { prev, prevKey };
}

/** Filtro de relevancia 1.2: |delta| ≥ 15 % y |delta_monto| ≥ max(1 % de I, 10 unidades). */
function relevante(c, deltaPct, deltaMonto) {
  const minimo = c.I.gt(0) ? D.max(c.I.times(U.cambioPctIngreso).div(100), U.cambioMinimo) : new D(U.cambioMinimo);
  return Math.abs(deltaPct) >= U.cambioPct && new D(deltaMonto).abs().gte(minimo);
}

function cambioGastoTotal(c) {
  const d = datos(c);
  if (!d || !new D(d.prev.gasto).gt(0)) return null;
  const delta = c.G.minus(d.prev.gasto);
  const dp = delta.div(d.prev.gasto).times(100).toNumber();
  if (!relevante(c, dp, delta)) return null;
  const baja = dp < 0;
  const items = [{ id: 'gasto', etiqueta: 'Gasto total', valor: fx(c.G), valor_comparado: fx(d.prev.gasto), delta_pct: r1(dp) }];
  return insight('INS-CAMBIO-GASTO-TOTAL', c, { intencion: 'comparar_mes_anterior', severidad: baja ? 'logro' : 'atencion', prioridad: baja ? 72 : 74, vars: { total_actual: fx(c.G), total_anterior: fx(d.prev.gasto), delta_pct: r1(dp), mes: c.month, mes_anterior: d.prevKey }, grafico: G.comparativaMeses(c.cur, 'Gasto: este mes frente al anterior (a la misma altura)', items, c.month, d.prevKey), acciones: ['ver_ranking', 'ver_grafico'], grupo: 'cambio-total', formula: '(G − G_ant) / G_ant × 100 a la misma altura; relevante si ≥ 15 % y ≥ max(1 % de I, 10)' });
}

/** Cambios por categoría que cumplen la relevancia, con el mes anterior > 0 (si es 0 es «categoría nueva», sin %). */
function cambiosPorCategoria(c) {
  const d = datos(c);
  if (!d) return [];
  const out = [];
  for (const x of c.gastoPorCategoria) {
    if (x.delta_pct === null || x.delta_monto === null) continue;
    if (relevante(c, x.delta_pct, x.delta_monto)) out.push({ ...x, anterior: new D(x.monto).minus(x.delta_monto) });
  }
  return { lista: out, prevKey: d.prevKey };
}

function categoriaCambio(c, sube) {
  const r = cambiosPorCategoria(c);
  if (!r.lista || !r.lista.length) return null;
  const cand = r.lista.filter((x) => (sube ? Number(x.delta_monto) > 0 : Number(x.delta_monto) < 0)).sort((a, b) => (sube ? Number(b.delta_monto) - Number(a.delta_monto) : Number(a.delta_monto) - Number(b.delta_monto)));
  const x = cand[0];
  if (!x) return null;
  const items = cand.slice(0, 4).map((y) => ({ id: y.categoria, etiqueta: y.etiqueta, valor: y.monto, valor_comparado: y.anterior.toFixed(2), delta_pct: y.delta_pct }));
  return insight(sube ? 'INS-CATEGORIA-SUBIO' : 'INS-CATEGORIA-BAJO', c, {
    intencion: sube ? 'categoria_subio' : 'categoria_bajo',
    severidad: sube ? 'atencion' : 'logro',
    prioridad: sube ? 75 : 72,
    vars: { categoria: x.etiqueta, delta_pct: x.delta_pct, delta_monto: x.delta_monto, mes_anterior: r.prevKey },
    grafico: G.comparativaMeses(c.cur, `${x.etiqueta}: este mes frente al anterior`, items, c.month, r.prevKey),
    acciones: sube ? ['ver_detalle', 'simular_recorte'] : ['ver_detalle', 'ver_ranking'],
    grupo: 'cambio-categoria',
    formula: sube ? 'argmax delta_monto con delta > 0 y relevancia' : 'argmin delta_monto con delta < 0 y relevancia',
  });
}

function cambioIngreso(c) {
  const d = datos(c);
  if (!d || !new D(d.prev.ingreso).gt(0) || !c.I.gt(0)) return null;
  const delta = c.I.minus(d.prev.ingreso);
  const dp = delta.div(d.prev.ingreso).times(100).toNumber();
  const baja = dp < 0 && relevante(c, dp, delta);
  const items = [{ id: 'ingreso', etiqueta: 'Ingresos', valor: fx(c.I), valor_comparado: fx(d.prev.ingreso), delta_pct: r1(dp) }];
  return insight('INS-CAMBIO-INGRESO', c, { intencion: 'comparar_ingresos', severidad: baja ? 'atencion' : 'info', prioridad: baja ? 62 : 50, vars: { total_actual: fx(c.I), total_anterior: fx(d.prev.ingreso), delta_pct: r1(dp), mes_anterior: d.prevKey }, grafico: G.comparativaMeses(c.cur, 'Ingresos: este mes frente al anterior', items, c.month, d.prevKey), acciones: ['ver_movimientos'], grupo: 'cambio-ingreso', formula: '(I − I_ant) / I_ant × 100 a la misma altura' });
}

/** Tendencia del gasto en los últimos 3 a 6 meses cerrados. */
function tendenciaMeses(c) {
  const meses = [];
  for (let i = 1; i <= 6; i++) {
    const m = mesesAtras(c.month, i);
    if (contarMes(c.userId, m) >= U.minMovsComparar) meses.unshift({ mes: m, gasto: gastoMes(c.userId, m) });
    else if (meses.length) break;
  }
  if (meses.length < U.minMesesTendencia) return null;
  const ult = meses.slice(-3);
  const crece = (a, b) => a.gasto.gt(0) && b.gasto.minus(a.gasto).div(a.gasto).times(100).toNumber();
  const c1 = crece(ult[0], ult[1]);
  const c2 = crece(ult[1], ult[2]);
  const direccion = c1 >= 5 && c2 >= 5 ? 'sube' : c1 <= -5 && c2 <= -5 ? 'baja' : 'estable';
  const primero = meses[0].gasto;
  const delta = primero.gt(0) ? meses[meses.length - 1].gasto.minus(primero).div(primero).times(100).toNumber() : 0;
  const nombre = (m) => new Intl.DateTimeFormat('es', { month: 'short', timeZone: 'UTC' }).format(new Date(`${m}-15T12:00:00Z`));
  const sev = direccion === 'baja' ? { severidad: 'logro', prioridad: 45 } : direccion === 'sube' ? { severidad: 'atencion', prioridad: 63 } : { severidad: 'info', prioridad: 20 };
  return insight('INS-TENDENCIA-MESES', c, { intencion: 'tendencia_meses', ...sev, vars: { n_meses: meses.length, direccion, delta_pct: r1(delta) }, grafico: G.mesAMes(c.cur, 'Gasto de los últimos meses', meses.map((x) => ({ mes: x.mes, etiqueta: nombre(x.mes), valor: x.gasto.toFixed(2) }))), acciones: ['ver_grafico'], formula: 'tres meses cerrados seguidos que crecen (o bajan) ≥ 5 % cada uno' });
}

module.exports = { cambioGastoTotal, categoriaSubio: (c) => categoriaCambio(c, true), categoriaBajo: (c) => categoriaCambio(c, false), cambioIngreso, tendenciaMeses, datos, relevante };
void ZERO;
