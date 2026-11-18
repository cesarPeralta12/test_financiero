'use strict';
// Insights 1–6 (estado del mes) y 32–35 (calidad de datos y racha). docs/coach-v2/05 §2.1 y §2.6.
const db = require('../../../db');
const G = require('../graficos');
const { D, ZERO, U, r1, fx, pct, addDays, insight } = require('./base');

function resumenMes(c) {
  const grafico = G.barraIngresoGasto(c.cur, 'Ingresos y gastos del mes', fx(c.I), fx(c.G), fx(c.B));
  return insight('INS-RESUMEN-MES', c, { intencion: 'resumen_mes', prioridad: 50, vars: { mes: c.month, total_ingreso: fx(c.I), total_gasto: fx(c.G), saldo: fx(c.B), n: c.n }, grafico, acciones: ['ver_ranking', 'mes_anterior', 'ver_movimientos'], formula: 'I, G y B = I − G − D del mes' });
}

function saldoMes(c) {
  const restantes = c.N - c.d;
  const vars = { saldo: fx(c.B), dias_restantes: restantes };
  if (restantes > 0 && c.B.gt(0)) vars.por_dia = c.B.div(restantes).toFixed(2);
  const sev = c.B.lte(0) ? { severidad: 'alerta', prioridad: 92 } : { severidad: 'info', prioridad: 55 };
  return insight('INS-SALDO-MES', c, { intencion: 'saldo_mes', ...sev, vars, grafico: G.barraIngresoGasto(c.cur, 'Ingresos y gastos del mes', fx(c.I), fx(c.G), fx(c.B)), acciones: ['ver_ranking', 'ver_grafico'], formula: 'B = I − G − D; por día = B / (N − d)' });
}

function gastoVsIngreso(c) {
  if (!(c.I.gt(0) && c.G.gt(I_(c)))) return null;
  return insight('INS-GASTO-VS-INGRESO', c, { intencion: 'gasto_mayor_ingreso', severidad: 'alerta', prioridad: 95, vars: { total_gasto: fx(c.G), total_ingreso: fx(c.I), diferencia: c.G.minus(c.I).toFixed(2) }, grafico: G.barraIngresoGasto(c.cur, 'Ingresos y gastos del mes', fx(c.I), fx(c.G), fx(c.B)), acciones: ['ver_ranking', 'simular_recorte'], formula: 'G > I y I > 0' });
}
const I_ = (c) => c.I;

function tasaAhorro(c) {
  if (!c.I.gt(0)) return null;
  const tasa = r1(pct(c.S, c.I));
  const sev = c.S.gt(0) ? { severidad: 'logro', prioridad: 45 } : { severidad: 'info', prioridad: 30 };
  return insight('INS-TASA-AHORRO', c, { intencion: 'tasa_ahorro_mes', ...sev, vars: { tasa_ahorro: tasa, monto_ahorro: fx(c.S) }, grafico: G.medidor('medidor_meta', c.cur, 'Ahorro frente a ingresos', 'Ahorro neto', Number(c.S.toFixed(2)), Number(c.I.toFixed(2))), acciones: ['ver_metas', 'ver_grafico'], formula: 'S / I × 100' });
}

function sinIngresos(c) {
  if (!(c.G.gt(0) && c.I.isZero())) return null;
  return insight('INS-SIN-INGRESOS', c, { intencion: 'sin_ingresos_registrados', severidad: 'atencion', prioridad: 85, acciones: ['registrar_ingreso'], formula: 'G > 0 e I = 0' });
}

/** Gasto acumulado por día del mes hasta hoy. */
function acumuladoDiario(c) {
  const porDia = new Array(c.N).fill(ZERO);
  for (const f of c.gastos) porDia[Number(f.date.slice(8, 10)) - 1] = porDia[Number(f.date.slice(8, 10)) - 1].plus(f.amount);
  let acum = ZERO;
  return porDia.slice(0, c.d).map((v) => {
    acum = acum.plus(v);
    return acum;
  });
}

function proyeccion(c) {
  if (c.d < U.minDiasProyeccion || !c.I.gt(0)) return null;
  const P = c.G.div(c.d).times(c.N);
  const p = r1(pct(P, c.I));
  const sev = p >= U.proyeccionAlerta ? { severidad: 'alerta', prioridad: 88 } : p >= U.proyeccionAviso ? { severidad: 'atencion', prioridad: 78 } : { severidad: 'info', prioridad: 60 };
  const diario = acumuladoDiario(c).map((v) => v.toFixed(2));
  const grafico = G.tendenciaVsRitmo(c.cur, 'Gasto acumulado y ritmo', diario, [{ etiqueta: 'Ingresos del mes', valor: fx(c.I) }, { etiqueta: 'Proyección al cierre', valor: P.toFixed(2) }], `Hasta el día ${c.d} gastaste ${c.f(c.G.toFixed(2))}; a este ritmo cerrarías en ${c.f(P.toFixed(2))} frente a ingresos de ${c.f(c.I.toFixed(2))}.`);
  return insight('INS-PROYECCION-CIERRE', c, { intencion: 'proyeccion_cierre', ...sev, vars: { proyeccion_gasto: P.toFixed(2), total_ingreso: fx(c.I), pct_ingreso: p, dias_mes: c.N }, grafico, acciones: ['ver_grafico', 'ver_insights'], formula: 'P = G / d × N (proyección simple)' });
}

// ───────── Calidad de datos y racha ─────────
function pocosDatos(c) {
  return insight('INS-POCOS-DATOS', c, { intencion: 'pocos_datos', prioridad: 99, vars: { n: c.n, minimo: U.minMovs }, acciones: ['registrar_gasto', 'registrar_ingreso'], formula: 'movimientos del mes < 5' });
}

function sinRegistro(c) {
  if (!c.actual) return null;
  const ult = db.value("SELECT MAX(date) FROM movements WHERE user_id = ? AND deleted_at IS NULL AND kind <> 'transferencia'", c.userId);
  if (!ult) return null;
  const dias = Math.round((Date.parse(`${c.hoy}T12:00:00Z`) - Date.parse(`${ult}T12:00:00Z`)) / 86400000);
  if (dias < 3) return null;
  return insight('INS-SIN-REGISTRO', c, { intencion: 'sin_registro_hace_dias', severidad: 'atencion', prioridad: 85, vars: { dias }, acciones: ['registrar_gasto', 'entendido'], formula: 'días desde el último movimiento ≥ 3' });
}

function muchosEnOtros(c) {
  const otros = c.gastoPorCategoria.find((x) => x.categoria === 'otros');
  if (!otros || otros.pct_del_total === null || otros.pct_del_total < 25) return null;
  const filas = c.gastoPorCategoria.slice(0, 5).map((x) => ({ id: x.categoria, etiqueta: x.etiqueta, valor: x.monto, pct: x.pct_del_total }));
  return insight('INS-MUCHOS-EN-OTROS', c, { intencion: 'muchos_en_otros', severidad: 'atencion', prioridad: 40, vars: { pct: Math.round(otros.pct_del_total) }, grafico: G.barrasCategorias(c.cur, 'Gastos por categoría', filas), acciones: ['ver_detalle', 'corregir_categoria'], formula: 'pct[otros] ≥ 25 %' });
}

/** Racha de días seguidos con registro, terminando hoy o ayer. */
function racha(c) {
  if (!c.actual) return null;
  const dias = new Set(db.all("SELECT DISTINCT date FROM movements WHERE user_id = ? AND deleted_at IS NULL AND kind <> 'transferencia' AND date >= ?", c.userId, addDays(c.hoy, -60)).map((r) => r.date));
  let cursor = dias.has(c.hoy) ? c.hoy : addDays(c.hoy, -1);
  let n = 0;
  while (dias.has(cursor)) {
    n++;
    cursor = addDays(cursor, -1);
  }
  if (n < 3 || !(n === 3 || n % 7 === 0)) return null;
  return insight('INS-RACHA', c, { intencion: 'racha_registro', severidad: 'logro', prioridad: 40, vars: { racha: n }, acciones: ['ver_insights'], formula: 'racha ≥ 3 y múltiplos de 7' });
}

module.exports = { resumenMes, saldoMes, gastoVsIngreso, tasaAhorro, sinIngresos, proyeccion, pocosDatos, sinRegistro, muchosEnOtros, racha, acumuladoDiario };
void D;
