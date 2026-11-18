'use strict';
// Base de los insights (docs/coach-v2/05): contexto del mes con todo lo que cada regla necesita y la
// fábrica de un insight. Todas las sumas son exactas (decimal.js) sobre movimientos no borrados,
// sin transferencias. Las comparaciones usan «la misma altura del mes».
const db = require('../../../db');
const money = require('../../../lib/money');
const tracker = require('../../tracker');
const { umbrales, diccionario } = require('../datos');

const { D } = money;
const ZERO = new D(0);
const VERSION_REGLAS = 'INSIGHTS_V1';

// Los umbrales del JSON traen { valor, unidad, descripcion }: aquí se toma solo el valor.
const v = (o) => (o && typeof o === 'object' && !Array.isArray(o) && 'valor' in o ? o.valor : o);
const U = {
  minMovs: v(umbrales.datos_minimos.min_movimientos_para_insights),
  minDiasProyeccion: v(umbrales.datos_minimos.min_dias_con_datos_para_proyeccion),
  minMovsComparar: v(umbrales.datos_minimos.min_movimientos_para_comparar_mes),
  minMesesTendencia: v(umbrales.datos_minimos.min_meses_para_tendencia),
  cambioPct: v(umbrales.comparacion.cambio_relevante_pct),
  cambioPctIngreso: v(umbrales.comparacion.cambio_relevante_minimo_pct_ingreso),
  cambioMinimo: v(umbrales.comparacion.cambio_minimo_absoluto_sin_ingreso),
  top1Alta: v(umbrales.ranking.concentracion_alta_top1_pct),
  top3Alta: v(umbrales.ranking.concentracion_alta_top3_pct),
  hormigaIngresoPct: v(umbrales.habitos.hormiga_tope_pct_ingreso),
  hormigaSinIngresoPct: v(umbrales.habitos.hormiga_tope_sin_ingreso_pct_gasto),
  hormigaFrecuencia: v(umbrales.habitos.hormiga_frecuencia_minima),
  hormigaAvisoPct: v(umbrales.habitos.hormiga_aviso_pct_gasto),
  repetidoMin: v(umbrales.habitos.gasto_repetido_minimo),
  finDeSemanaPct: v(umbrales.habitos.fin_de_semana_diferencia_pct),
  recortePct: v(umbrales.recorte.recorte_ilustrativo_pct),
  recorteDiscrecionales: v(umbrales.recorte.categorias_discrecionales),
  nuncaRecortar: v(umbrales.recorte.nunca_recortar),
  recorteMaximoPct: v(umbrales.recorte.recorte_maximo_sobre_categoria_pct),
  presupuestoCerca: v(umbrales.presupuesto.aviso_cerca_pct),
  presupuestoExcedido: v(umbrales.presupuesto.alerta_excedido_pct),
  metaRiesgoMeses: v(umbrales.metas.meta_en_riesgo_meses_extra),
  metaRedondeo: v(umbrales.metas.aporte_sugerido_redondeo),
  proyeccionAviso: v(umbrales.ritmo_y_proyeccion.proyeccion_margen_aviso_pct),
  proyeccionAlerta: v(umbrales.ritmo_y_proyeccion.proyeccion_margen_alerta_pct),
};

const r1 = (n) => Math.round(n * 10) / 10;
const fx = (d) => new D(d).toFixed(2);
const pct = (a, b) => (new D(b).gt(0) ? new D(a).div(b).times(100).toNumber() : null);
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dow = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = domingo

/** Subcategorías con una bandera del diccionario: Set de «categoria:sub». */
function banderas(bandera) {
  const out = new Set();
  for (const [cat, def] of Object.entries(diccionario.categorias.gasto)) for (const [sub, sd] of Object.entries(def.subcategorias || {})) if (sd[bandera]) out.add(`${cat}:${sub}`);
  return out;
}
const HORMIGA = banderas('hormiga');
const DISCRECIONAL = banderas('discrecional');
const RECURRENTE = banderas('recurrente_probable');

/** Contexto de cálculo de un mes para una cuenta. */
function contexto(userId, { hoy = new Date().toISOString().slice(0, 10), mes = null } = {}) {
  const month = mes || hoy.slice(0, 7);
  const actual = month === hoy.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const N = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = actual ? Math.min(Number(hoy.slice(8, 10)), N) : N;
  const resumen = tracker.summaryDetail(userId, month, hoy);
  const filas = db.all("SELECT id, date, kind, category, subcategory, amount, note, note_norm FROM movements WHERE user_id = ? AND substr(date, 1, 7) = ? AND kind <> 'transferencia' AND deleted_at IS NULL ORDER BY date, id", userId, month);
  const ctx = {
    userId,
    hoy,
    month,
    actual,
    cur: tracker.baseCurrency(userId),
    N,
    d,
    resumen,
    filas,
    gastos: filas.filter((f) => f.kind === 'gasto'),
    I: new D(resumen.ingreso),
    G: new D(resumen.gasto),
    Dd: new D(resumen.pago_deuda),
    S: new D(resumen.ahorro_neto),
    B: new D(resumen.saldo),
    L: new D(resumen.saldo_libre),
    n: resumen.n_movimientos,
    f: (v) => money.format(v, tracker.baseCurrency(userId)),
  };
  ctx.gastoPorCategoria = resumen.por_categoria.filter((x) => x.tipo === 'gasto');
  return ctx;
}

/** Suma de gastos por categoría para cualquier mes y tope de día (para tendencias y a la misma altura). */
function gastoMes(userId, month, hastaDia = 31, kind = 'gasto') {
  const rows = db.all("SELECT amount FROM movements WHERE user_id = ? AND substr(date, 1, 7) = ? AND CAST(substr(date, 9, 2) AS INTEGER) <= ? AND kind = ? AND deleted_at IS NULL", userId, month, hastaDia, kind);
  return rows.reduce((a, r) => a.plus(r.amount), ZERO);
}
const contarMes = (userId, month) => db.value("SELECT COUNT(*) FROM movements WHERE user_id = ? AND substr(date, 1, 7) = ? AND kind <> 'transferencia' AND deleted_at IS NULL", userId, month) || 0;

const ORDEN_SEV = { alerta: 4, atencion: 3, logro: 2, info: 1 };

/** Fábrica de un insight (contrato de docs/coach-v2/04 §2.3). */
function insight(tipo, ctx, { intencion, severidad = 'info', prioridad = 0, vars = {}, grafico = null, acciones = [], formula = '', grupo = null, descartable = true }) {
  return {
    id: `${tipo}:${ctx.month}`,
    tipo,
    severidad,
    prioridad,
    intencion_mensaje: intencion,
    variables: vars,
    grafico,
    acciones,
    evidencia: { formula },
    periodo: ctx.month,
    version_reglas: VERSION_REGLAS,
    descartable,
    grupo: grupo || tipo,
  };
}

module.exports = { ZERO, D, U, r1, fx, pct, addDays, dow, HORMIGA, DISCRECIONAL, RECURRENTE, contexto, gastoMes, contarMes, insight, ORDEN_SEV, VERSION_REGLAS };
