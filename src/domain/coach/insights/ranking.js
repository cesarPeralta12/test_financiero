'use strict';
// Insights 7–12 (rankings) y 18–23 (hábitos). docs/coach-v2/05 §2.2, §2.4, §3.1 y §3.2.
const db = require('../../../db');
const tracker = require('../../tracker');
const G = require('../graficos');
const { D, ZERO, U, r1, fx, pct, addDays, dow, HORMIGA, RECURRENTE, insight } = require('./base');
const { diccionario } = require('../datos');

const catLabel = (cat) => tracker.CATEGORIES.gasto[cat] || cat;
const subLabel = (s) => String(s).replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());
const filasRanking = (c, n = U_N) => c.gastoPorCategoria.slice(0, n).map((x) => ({ id: x.categoria, etiqueta: x.etiqueta, valor: x.monto, pct: x.pct_del_total }));
const U_N = 5;

function mayorCategoria(c) {
  const g = c.gastoPorCategoria[0];
  if (!g || !c.G.gt(0)) return null;
  const alta = g.pct_del_total >= U.top1Alta;
  return insight('INS-MAYOR-CATEGORIA', c, { intencion: 'mayor_gasto', severidad: alta ? 'atencion' : 'info', prioridad: alta ? 66 : 58, vars: { categoria: g.etiqueta, monto: g.monto, pct: g.pct_del_total, mes: c.month }, grafico: G.barrasCategorias(c.cur, 'Gastos por categoría', filasRanking(c)), acciones: ['ver_ranking', 'simular_recorte', 'mes_anterior'], formula: 'argmax C[c]' });
}

function menorCategoria(c) {
  const lista = c.gastoPorCategoria.filter((x) => Number(x.monto) > 0);
  if (lista.length < 2) return null;
  const g = lista[lista.length - 1];
  return insight('INS-MENOR-CATEGORIA', c, { intencion: 'menor_gasto', prioridad: 20, vars: { categoria: g.etiqueta, monto: g.monto, pct: g.pct_del_total }, grafico: G.barrasCategorias(c.cur, 'Gastos por categoría', filasRanking(c)), acciones: ['ver_ranking'], formula: 'argmin C[c] con C > 0' });
}

function movimientoExtremo(c, mayor) {
  if (!c.gastos.length) return null;
  const orden = [...c.gastos].sort((a, b) => (mayor ? new D(b.amount).cmp(a.amount) : new D(a.amount).cmp(b.amount)) || b.id - a.id);
  const m = orden[0];
  const vars = { monto: m.amount, categoria: catLabel(m.category), fecha: m.date };
  if (mayor && m.note) vars.nota = m.note;
  return insight(mayor ? 'INS-MAYOR-MOVIMIENTO' : 'INS-MENOR-MOVIMIENTO', c, { intencion: mayor ? 'mayor_movimiento' : 'menor_movimiento', prioridad: mayor ? 25 : 10, vars, acciones: mayor ? ['editar', 'ver_detalle'] : ['ver_detalle'], formula: mayor ? 'gasto de mayor importe del mes' : 'gasto de menor importe del mes' });
}

function top3(c) {
  if (c.gastoPorCategoria.length < 3 || !c.G.gt(0)) return null;
  const t = c.gastoPorCategoria.slice(0, 3);
  const p = Math.round(t.reduce((a, x) => a + (x.pct_del_total || 0), 0));
  const alta = p >= U.top3Alta;
  return insight('INS-TOP3', c, { intencion: 'top3_concentracion', severidad: alta ? 'atencion' : 'info', prioridad: alta ? 65 : 40, vars: { cat1: t[0].etiqueta, cat2: t[1].etiqueta, cat3: t[2].etiqueta, pct_top3: p }, grafico: G.barrasCategorias(c.cur, 'Tres categorías principales', filasRanking(c, 3)), acciones: ['ver_ranking', 'ver_grafico'], formula: '(C1 + C2 + C3) / G × 100' });
}

/** Solo a pedido (no aparece en el feed): cuánto va en una categoría. */
function gastoCategoria(c, code) {
  if (!tracker.CATEGORIES.gasto[code]) return null;
  const row = c.gastoPorCategoria.find((x) => x.categoria === code);
  const vars = { categoria: catLabel(code), monto: row ? row.monto : '0.00', pct: row ? row.pct_del_total || 0 : 0, n: row ? row.n : 0 };
  if (row && row.delta_pct !== null) vars.delta_pct = row.delta_pct;
  return insight('INS-GASTO-CATEGORIA', c, { intencion: 'gasto_categoria', prioridad: 0, vars, grafico: G.barrasCategorias(c.cur, 'Gastos por categoría', filasRanking(c)), acciones: ['ver_ranking', 'mes_anterior', 'simular_recorte'], formula: 'C[c] y pct[c]', descartable: false });
}

// ───────── Hábitos ─────────
function ingresoRef(c) {
  return c.I.gt(0) ? c.I.times(U.hormigaIngresoPct).div(100) : c.G.times(U.hormigaSinIngresoPct).div(100);
}

/** Grupos de gastos chicos y repetidos (≥ 6 movimientos): la clave es la subcategoría o la nota normalizada. */
function gruposHormiga(c) {
  const tope = ingresoRef(c);
  const grupos = {};
  for (const f of c.gastos) {
    const marcada = f.subcategory && HORMIGA.has(`${f.category}:${f.subcategory}`);
    if (!(marcada || new D(f.amount).lte(tope))) continue;
    const clave = f.subcategory || f.note_norm || f.category;
    const g = grupos[clave] || (grupos[clave] = { clave, etiqueta: f.subcategory ? subLabel(f.subcategory) : f.note || catLabel(f.category), n: 0, total: ZERO });
    g.n++;
    g.total = g.total.plus(f.amount);
  }
  return Object.values(grupos).filter((g) => g.n >= U.hormigaFrecuencia).sort((a, b) => b.total.cmp(a.total));
}

function hormiga(c) {
  const hab = gruposHormiga(c);
  if (!hab.length || !c.G.gt(0)) return null;
  const total = hab.reduce((a, g) => a.plus(g.total), ZERO);
  const p = r1(pct(total, c.G));
  if (p < U.hormigaAvisoPct) return null;
  const vars = { monto_total: total.toFixed(2), n: hab.reduce((a, g) => a + g.n, 0), pct_gasto: p, principal: hab[0].etiqueta.toLowerCase() };
  if (c.d >= 20) vars.monto_anual = total.times(12).toFixed(2); // proyección simple, no una meta
  const filas = hab.slice(0, 5).map((g) => ({ id: g.clave, etiqueta: g.etiqueta, valor: g.total.toFixed(2), pct: r1(pct(g.total, c.G)) }));
  return insight('INS-HORMIGA', c, { intencion: 'gastos_hormiga', severidad: 'atencion', prioridad: 60, vars, grafico: G.barrasCategorias(c.cur, 'Gastos chicos y repetidos', filas), acciones: ['ver_detalle', 'simular_recorte', 'crear_tarea'], formula: 'grupos de gastos pequeños con ≥ 6 movimientos; se menciona si pct_gasto ≥ 8 %' });
}

/** Meses anteriores con el mismo concepto y un importe parecido (±10 %): recurrente. */
function suscripciones(c) {
  const desde = `${addDays(`${c.month}-01`, -190).slice(0, 7)}-01`;
  const filas = db.all("SELECT date, category, subcategory, amount, note_norm FROM movements WHERE user_id = ? AND kind = 'gasto' AND deleted_at IS NULL AND date >= ? AND substr(date, 1, 7) <= ?", c.userId, desde, c.month);
  const grupos = {};
  for (const f of filas) {
    const clave = f.note_norm || (f.subcategory && RECURRENTE.has(`${f.category}:${f.subcategory}`) ? f.subcategory : null);
    if (!clave) continue;
    const mes = f.date.slice(0, 7);
    const g = grupos[clave] || (grupos[clave] = {});
    g[mes] = (g[mes] || ZERO).plus(f.amount);
  }
  const rec = [];
  for (const [clave, porMes] of Object.entries(grupos)) {
    const montos = Object.values(porMes).map((v) => Number(v)).sort((a, b) => a - b);
    const med = montos[Math.floor(montos.length / 2)];
    const parecidos = montos.filter((m) => Math.abs(m - med) <= med * 0.1);
    if (parecidos.length >= 3 && porMes[c.month]) rec.push({ clave, monto: new D(porMes[c.month]) });
  }
  // Marcadas como recurrentes probables en el diccionario (streaming, gimnasio…) y presentes este mes.
  const marcadas = {};
  for (const f of c.gastos) if (f.subcategory && RECURRENTE.has(`${f.category}:${f.subcategory}`) && !rec.some((r) => r.clave === (f.note_norm || f.subcategory))) marcadas[f.note_norm || f.subcategory] = (marcadas[f.note_norm || f.subcategory] || ZERO).plus(f.amount);
  for (const [clave, monto] of Object.entries(marcadas)) rec.push({ clave, monto });
  if (!rec.length || !c.G.gt(0)) return null;
  const total = rec.reduce((a, r) => a.plus(r.monto), ZERO);
  return insight('INS-SUSCRIPCIONES', c, { intencion: 'suscripciones', prioridad: 55, vars: { n: rec.length, monto_total: total.toFixed(2), pct_gasto: r1(pct(total, c.G)) }, acciones: ['ver_detalle', 'crear_tarea'], formula: 'mismo concepto con importe parecido (±10 %) en ≥ 3 meses, o marcado recurrente' });
}

function gastoRepetido(c) {
  const grupos = {};
  for (const f of c.gastos) {
    if (!f.note_norm) continue;
    const g = grupos[f.note_norm] || (grupos[f.note_norm] = { nota: f.note, n: 0, total: ZERO });
    g.n++;
    g.total = g.total.plus(f.amount);
  }
  const top = Object.values(grupos).filter((g) => g.n >= U.repetidoMin).sort((a, b) => b.total.cmp(a.total))[0];
  if (!top) return null;
  return insight('INS-GASTO-REPETIDO', c, { intencion: 'gasto_repetido', prioridad: 35, vars: { nota: top.nota, n: top.n, monto_total: top.total.toFixed(2) }, acciones: ['guardar_plantilla', 'ver_detalle'], formula: 'misma nota ≥ 3 veces en el mes' });
}

/** Gasto diario de los últimos `dias` días terminando hoy (incluye ceros). */
function gastoPorDia(c, dias) {
  const desde = addDays(c.hoy, -(dias - 1));
  const rows = db.all("SELECT date, SUM(amount_cents) AS cents FROM movements WHERE user_id = ? AND kind = 'gasto' AND deleted_at IS NULL AND date >= ? AND date <= ? GROUP BY date", c.userId, desde, c.hoy);
  const mapa = Object.fromEntries(rows.map((r) => [r.date, r.cents]));
  return Array.from({ length: dias }, (_, i) => {
    const date = addDays(desde, i);
    return { date, cents: mapa[date] || 0 };
  });
}

function diaMasCaro(c) {
  const dias = gastoPorDia(c, 56);
  const semanasConDatos = new Set(dias.filter((d) => d.cents > 0).map((d) => Math.floor(dias.findIndex((x) => x.date === d.date) / 7)));
  if (semanasConDatos.size < 4) return null;
  const sumas = new Array(7).fill(0);
  const cuenta = new Array(7).fill(0);
  for (const d of dias) {
    const i = (dow(d.date) + 6) % 7; // lunes = 0
    sumas[i] += d.cents;
    cuenta[i]++;
  }
  const prom = sumas.map((s, i) => s / (cuenta[i] || 1) / 100);
  const media = prom.reduce((a, b) => a + b, 0) / 7;
  const max = prom.indexOf(Math.max(...prom));
  if (!(prom[max] > 0)) return null;
  const nombres = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  return insight('INS-DIA-MAS-CARO', c, { intencion: 'dia_mas_caro', prioridad: 30, vars: { dia_semana: nombres[max], promedio: prom[max].toFixed(2), pct_sobre_prom: r1(Math.max(0, (prom[max] / media - 1) * 100)) }, grafico: G.mapaSemana(c.cur, 'Gasto promedio por día de la semana', prom.map((v) => v.toFixed(2)), max), acciones: ['ver_grafico', 'ver_insights'], formula: 'promedio de gasto por día de la semana en 8 semanas (mínimo 4 con datos)' });
}

function finDeSemana(c) {
  const dias = gastoPorDia(c, 28);
  const fin = dias.filter((d) => [0, 6].includes(dow(d.date)));
  const sem = dias.filter((d) => ![0, 6].includes(dow(d.date)));
  const pf = fin.reduce((a, d) => a + d.cents, 0) / (fin.length || 1) / 100;
  const ps = sem.reduce((a, d) => a + d.cents, 0) / (sem.length || 1) / 100;
  if (ps <= 0 || (pf / ps - 1) * 100 < U.finDeSemanaPct) return null;
  return insight('INS-FIN-DE-SEMANA', c, { intencion: 'gasto_fin_de_semana', prioridad: 32, vars: { prom_finde: pf.toFixed(2), prom_semana: ps.toFixed(2), pct: Math.round((pf / ps - 1) * 100) }, acciones: ['ver_grafico'], formula: 'promedio diario sáb–dom vs lun–vie en 4 semanas; se destaca si ≥ +30 %' });
}

function gastoSemana(c) {
  if (!c.actual) return null;
  const idx = (dow(c.hoy) + 6) % 7; // días transcurridos de la semana (lunes = 0)
  const dias = gastoPorDia(c, idx + 8);
  const esta = dias.slice(-(idx + 1));
  const antes = dias.slice(-(idx + 1) - 7, -7);
  const total = esta.reduce((a, d) => a + d.cents, 0) / 100;
  const prev = antes.reduce((a, d) => a + d.cents, 0) / 100;
  const vars = { total_semana: total.toFixed(2) };
  if (prev > 0) vars.delta_pct = r1(((total - prev) / prev) * 100);
  const spark = gastoPorDia(c, 14).map((d) => (d.cents / 100).toFixed(2));
  return insight('INS-GASTO-SEMANA', c, { intencion: 'gasto_semana', prioridad: 28, vars, grafico: G.sparkline(c.cur, 'Gasto diario de las últimas 2 semanas', spark), acciones: ['ver_grafico', 'ver_ranking'], formula: 'G de la semana actual y delta frente a la anterior a la misma altura' });
}

module.exports = { mayorCategoria, menorCategoria, movimientoExtremo, top3, gastoCategoria, hormiga, suscripciones, gastoRepetido, diaMasCaro, finDeSemana, gastoSemana, gruposHormiga, gastoPorDia, subLabel };
void diccionario;
