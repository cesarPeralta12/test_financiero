'use strict';
// Registro «intención → manejador» del Coach v2 (S3: conversación, registro, resumen, ranking,
// comparación con el mes anterior y explicaciones). Cada manejador lee los datos de la cuenta
// (`tracker`), calcula las cifras en el servidor y devuelve las variables del mensaje del catálogo.
// Las intenciones que necesitan insights de acción (recortes, deudas, metas, tareas) llegan en S4.
const db = require('../../db');
const money = require('../../lib/money');
const tracker = require('../tracker');
const { umbrales } = require('./datos');
const insightsBase = require('./insights/base');
const acciones = require('./insights/acciones');
const ranking = require('./insights/ranking');
const tasks = require('../tasks');
const recurrentes = require('./recurrentes');
const plantillas = require('./plantillas');

const { D } = money;
const MIN_MOVS = umbrales.datos_minimos.min_movimientos_para_insights.valor;
const MIN_DIAS_PROYECCION = umbrales.datos_minimos.min_dias_con_datos_para_proyeccion.valor;
const MIN_MOVS_COMPARAR = umbrales.datos_minimos.min_movimientos_para_comparar_mes.valor;
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const kindLabel = (k) => (tracker.KINDS[k] || k).toLowerCase();
const catLabel = (kind, cat) => (tracker.CATEGORIES[kind] && tracker.CATEGORIES[kind][cat]) || cat;
const pct = (a, b) => (new D(b).gt(0) ? new D(a).div(b).times(100).toNumber() : null);
const r1 = (n) => Math.round(n * 10) / 10;

/** Contexto de una consulta: la cuenta, la fecha de hoy y el resumen del mes (se calcula solo si hace falta). */
function contexto(userId, { hoy = new Date().toISOString().slice(0, 10), entidades = {}, texto = '' } = {}) {
  const mes = hoy.slice(0, 7);
  let resumen = null;
  return {
    userId,
    hoy,
    mes,
    ent: entidades,
    texto,
    cur: tracker.baseCurrency(userId),
    get resumen() {
      if (!resumen) resumen = tracker.summaryDetail(userId, mes);
      return resumen;
    },
  };
}

const pocosDatos = (c) => ({ intencion: 'pocos_datos', vars: { n: c.resumen.n_movimientos, minimo: MIN_MOVS } });
const faltanDatos = (c) => c.resumen.n_movimientos < MIN_MOVS;
const gastos = (c) => c.resumen.por_categoria.filter((x) => x.tipo === 'gasto');

/** Tarjeta de ranking (tabla simple); los gráficos llegan con S4. */
function tarjetaRanking(c, filas, titulo = 'Gastos por categoría') {
  return { tipo: 'ranking', titulo, filas: filas.map((x) => [x.etiqueta, money.format(x.monto, c.cur), x.pct_del_total === null ? '' : `${Math.round(x.pct_del_total)} %`]) };
}

// ───────── Conversación ─────────
const plantilla = () => ({ vars: {} });
const nombrePila = (c) => {
  const n = db.value('SELECT name FROM users WHERE id = ?', c.userId);
  const first = n ? String(n).trim().split(/\s+/)[0] : '';
  return first ? { nombre: first.slice(0, 30) } : {};
};

// ───────── Resumen ─────────
function resumenMes(c) {
  const s = c.resumen;
  if (!s.n_movimientos) return pocosDatos(c);
  return { vars: { mes: c.mes, total_ingreso: s.ingreso, total_gasto: s.gasto, saldo: s.saldo, n: s.n_movimientos } };
}

function saldoMes(c) {
  const s = c.resumen;
  if (!s.n_movimientos) return pocosDatos(c);
  const restantes = s.dias_del_mes - s.dias_transcurridos;
  const vars = { saldo: s.saldo, dias_restantes: restantes };
  if (new D(s.saldo).gt(0) && restantes > 0) vars.por_dia = new D(s.saldo).div(restantes).toFixed(2);
  return { vars };
}

function gastoTotal(c) {
  const s = c.resumen;
  if (!s.n_movimientos) return pocosDatos(c);
  const vars = { total_gasto: s.gasto, mes: c.mes };
  const p = pct(s.gasto, s.ingreso);
  if (p !== null) vars.pct_ingreso = r1(p);
  return { vars };
}

function ingresoTotal(c) {
  const s = c.resumen;
  if (!new D(s.ingreso).gt(0)) return { intencion: 'sin_ingresos_registrados', vars: {} };
  return { vars: { total_ingreso: s.ingreso, mes: c.mes } };
}

function tasaAhorro(c) {
  const s = c.resumen;
  if (!new D(s.ingreso).gt(0)) return { intencion: 'sin_ingresos_registrados', vars: {} };
  return { vars: { tasa_ahorro: r1(pct(s.ahorro_neto, s.ingreso)), monto_ahorro: s.ahorro_neto } };
}

function proyeccionCierre(c) {
  const s = c.resumen;
  if (faltanDatos(c) || s.dias_transcurridos < MIN_DIAS_PROYECCION) return pocosDatos(c);
  if (!new D(s.ingreso).gt(0)) return { intencion: 'sin_ingresos_registrados', vars: {} };
  const proy = new D(s.gasto).div(s.dias_transcurridos).times(s.dias_del_mes);
  return { vars: { proyeccion_gasto: proy.toFixed(2), total_ingreso: s.ingreso, pct_ingreso: r1(pct(proy, s.ingreso)), dias_mes: s.dias_del_mes } };
}

function ultimoMovimiento(c) {
  const m = tracker.lastMovement(c.userId);
  if (!m) return pocosDatos(c);
  return { vars: { tipo: kindLabel(m.kind), monto: m.amount, categoria: catLabel(m.kind, m.category), fecha: m.date } };
}

function gastoHoy(c) {
  const row = db.one("SELECT COUNT(*) AS n FROM movements WHERE user_id = ? AND kind = 'gasto' AND date = ? AND deleted_at IS NULL", c.userId, c.hoy);
  const total = tracker.findMovements(c.userId, { desde: c.hoy, hasta: c.hoy, tipo: 'gasto', limite: 100 }).items.reduce((a, m) => a.plus(m.amount), new D(0));
  return { vars: { total_hoy: total.toFixed(2), n: row.n } };
}

// ───────── Ranking ─────────
function mayorGasto(c) {
  if (faltanDatos(c)) return pocosDatos(c);
  const g = gastos(c)[0];
  if (!g) return pocosDatos(c);
  return { vars: { categoria: g.etiqueta, monto: g.monto, pct: g.pct_del_total, mes: c.mes }, tarjetas: [tarjetaRanking(c, gastos(c).slice(0, 5))] };
}

function menorGasto(c) {
  if (faltanDatos(c)) return pocosDatos(c);
  const g = gastos(c).slice(-1)[0];
  if (!g) return pocosDatos(c);
  return { vars: { categoria: g.etiqueta, monto: g.monto, pct: g.pct_del_total } };
}

function movimientoExtremo(orden) {
  return (c) => {
    if (faltanDatos(c)) return pocosDatos(c);
    const m = tracker.findMovements(c.userId, { mes: c.mes, tipo: 'gasto', orden, limite: 1 }).items[0];
    if (!m) return pocosDatos(c);
    const vars = { monto: m.amount, categoria: catLabel(m.kind, m.category), fecha: m.date };
    if (m.note) vars.nota = m.note;
    return { vars };
  };
}

function top3(c) {
  if (faltanDatos(c)) return pocosDatos(c);
  const g = gastos(c);
  if (g.length < 3) return mayorGasto(c);
  const top = g.slice(0, 3);
  return { vars: { cat1: top[0].etiqueta, cat2: top[1].etiqueta, cat3: top[2].etiqueta, pct_top3: Math.round(top.reduce((a, x) => a + (x.pct_del_total || 0), 0)) }, tarjetas: [tarjetaRanking(c, top)] };
}

function gastoCategoria(c) {
  if (faltanDatos(c)) return pocosDatos(c);
  const code = c.ent.categoria;
  if (!code || !tracker.CATEGORIES.gasto[code]) return { intencion: 'no_entendi', vars: {} };
  const row = gastos(c).find((x) => x.categoria === code);
  const vars = { categoria: tracker.CATEGORIES.gasto[code], monto: row ? row.monto : '0.00', pct: row ? row.pct_del_total || 0 : 0, n: row ? row.n : 0 };
  if (row && row.delta_pct !== null) vars.delta_pct = row.delta_pct;
  return { vars };
}

function diaMasCaro(c) {
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const rows = db.all("SELECT date, SUM(amount_cents) AS cents FROM movements WHERE user_id = ? AND kind = 'gasto' AND deleted_at IS NULL AND date >= ? GROUP BY date", c.userId, since);
  if (rows.length < MIN_MOVS) return pocosDatos(c);
  const por = {};
  let total = 0;
  for (const r of rows) {
    const d = new Date(`${r.date}T12:00:00Z`).getUTCDay();
    (por[d] = por[d] || []).push(r.cents);
    total += r.cents;
  }
  const media = total / rows.length;
  const [dia, lista] = Object.entries(por).map(([d, l]) => [d, l.reduce((a, b) => a + b, 0) / l.length]).sort((a, b) => b[1] - a[1])[0];
  return { vars: { dia_semana: DIAS_SEMANA[dia], promedio: (lista / 100).toFixed(2), pct_sobre_prom: r1(Math.max(0, (lista / media - 1) * 100)) } };
}

// ───────── Comparación ─────────
function compararMesAnterior(c) {
  const s = c.resumen;
  const prevKey = tracker.prevMonth(c.mes);
  if (s.n_movimientos < MIN_MOVS_COMPARAR) return pocosDatos(c);
  const prev = s.mes_anterior;
  const prevCount = db.value("SELECT COUNT(*) FROM movements WHERE user_id = ? AND substr(date, 1, 7) = ? AND kind <> 'transferencia' AND deleted_at IS NULL", c.userId, prevKey);
  if (!prev || prevCount < MIN_MOVS_COMPARAR || !new D(prev.gasto).gt(0)) return { intencion: 'sin_mes_anterior', vars: { mes_anterior: prevKey } };
  // «A la misma altura»: se compara con el mes anterior hasta el mismo día, nunca contra el mes completo.
  const delta = new D(s.gasto).minus(prev.gasto).div(prev.gasto).times(100).toNumber();
  return { vars: { total_actual: s.gasto, total_anterior: prev.gasto, delta_pct: r1(delta), mes: c.mes, mes_anterior: prevKey }, tarjetas: [{ tipo: 'comparacion', titulo: 'Gasto a la misma altura del mes', filas: [[c.mes, money.format(s.gasto, c.cur)], [prevKey, money.format(prev.gasto, c.cur)]] }] };
}

// ───────── Educativo ─────────
function explicarSaldo(c) {
  const s = c.resumen;
  return { vars: { total_ingreso: s.ingreso, total_gasto: s.gasto, pago_deuda: s.pago_deuda, saldo: s.saldo } };
}
function explicarTasa(c) {
  const s = c.resumen;
  const vars = {};
  if (new D(s.ingreso).gt(0) && s.n_movimientos >= MIN_MOVS) vars.tasa_ahorro = r1(pct(s.ahorro_neto, s.ingreso));
  return { vars };
}

// ───────── Acciones y hábitos con el motor de insights (misma fuente que «Mi dinero») ─────────
/** Convierte una regla de insights en la respuesta del Coach: mismo cálculo, mismas variables, mismo gráfico. */
function viaInsight(regla, { sinDatos = null, exigeDatos = true } = {}) {
  return (c) => {
    const ic = insightsBase.contexto(c.userId, { hoy: c.hoy });
    if (exigeDatos && ic.n < MIN_MOVS) return pocosDatos(c);
    const r = regla(ic, c);
    const i = Array.isArray(r) ? r[0] : r;
    if (!i) return sinDatos ? sinDatos(c) : msg('no_entendi', { sugerencia: 'resumen del mes' });
    return { intencion: i.intencion_mensaje, vars: i.variables, grafico: i.grafico };
  };
}
const sinTareas = () => msg('sin_tareas');

function siguientePaso(c) {
  const t = tasks.next(c.userId);
  if (!t) return sinTareas();
  const vars = { tarea: t.title };
  if (t.reason) vars.motivo = t.reason;
  if (t.done_criteria) vars.criterio = t.done_criteria;
  return { vars };
}

// ───────── Registro ─────────
const msg = (intencion, vars = {}) => ({ intencion, vars });

const HANDLERS = {
  // conversación y límites
  saludo: (c) => ({ vars: nombrePila(c) }),
  despedida: (c) => ({ vars: nombrePila(c) }),
  gracias: plantilla,
  ayuda_menu: plantilla,
  identidad_ia: plantilla,
  fuera_de_alcance: plantilla,
  consejo_especifico_no: plantilla,
  privacidad_info: plantilla,
  no_entendi: (c) => ({ vars: { sugerencia: 'resumen del mes' } }),
  // resumen
  resumen_mes: resumenMes,
  saldo_mes: saldoMes,
  gasto_total: gastoTotal,
  ingreso_total: ingresoTotal,
  tasa_ahorro_mes: tasaAhorro,
  proyeccion_cierre: proyeccionCierre,
  ultimo_movimiento: ultimoMovimiento,
  gasto_hoy: gastoHoy,
  // ranking
  // Rankings con gráfico: mismas cifras que «Mi dinero» (motor de insights) más la tarjeta de ranking.
  mayor_gasto: (c) => {
    const r = viaInsight(ranking.mayorCategoria)(c);
    return r.grafico ? { ...r, tarjetas: [tarjetaRanking(c, gastos(c).slice(0, 5))] } : r;
  },
  menor_gasto: viaInsight(ranking.menorCategoria),
  mayor_movimiento: movimientoExtremo('importe_desc'),
  menor_movimiento: movimientoExtremo('importe_asc'),
  top3_concentracion: (c) => {
    const r = viaInsight(ranking.top3)(c);
    return r.grafico ? { ...r, tarjetas: [tarjetaRanking(c, gastos(c).slice(0, 3))] } : r;
  },
  gasto_categoria: (c) => {
    const r = viaInsight((ic, ctx) => ranking.gastoCategoria(ic, ctx.ent && ctx.ent.categoria), { sinDatos: () => msg('no_entendi', { sugerencia: 'resumen del mes' }) })(c);
    return r;
  },
  dia_mas_caro: diaMasCaro,
  gastos_hormiga: viaInsight(ranking.hormiga, { sinDatos: (c) => msg('no_entendi', { sugerencia: 'resumen del mes' }) }),
  suscripciones: viaInsight(ranking.suscripciones),
  gasto_repetido: viaInsight(ranking.gastoRepetido),
  gasto_semana: viaInsight(ranking.gastoSemana, { exigeDatos: false }),
  gasto_fin_de_semana: viaInsight(ranking.finDeSemana),
  recortar_rapido: viaInsight(acciones.recorteRapido),
  deuda_pagar_primero: viaInsight(acciones.deudaPrimero),
  deuda_liquidable: viaInsight(acciones.deudaLiquidable),
  orden_deudas: viaInsight(acciones.ordenDeudas),
  simular_pago_extra: viaInsight((ic, c) => acciones.pagoExtra(ic, c.ent && c.ent.importe)),
  meta_avance: viaInsight(acciones.metaAvance, { exigeDatos: false }),
  meta_en_riesgo: viaInsight(acciones.metaEnRiesgo, { exigeDatos: false }),
  presupuesto_estado: viaInsight((ic) => acciones.presupuesto(ic), { exigeDatos: false }),
  siguiente_paso: siguientePaso,
  // comparación
  comparar_mes_anterior: compararMesAnterior,
  // educativo
  explicar_saldo: explicarSaldo,
  explicar_tasa_ahorro: explicarTasa,
  explicar_reserva: plantilla,
  explicar_estrategias_deuda: plantilla,
  explicar_hormiga: plantilla,
  explicar_proyeccion: plantilla,
  explicar_50_30_20: plantilla,
  explicar_simulacion: plantilla,
  // Pulido (S7): recurrentes y atajos. Se proponen; nada se crea ni se anota sin confirmar.
  recurrente_propuesto: (c) => {
    const r = recurrentes.detectar(c.userId, c.hoy)[0];
    if (!r) return msg('sin_recurrentes');
    return { ...msg('recurrente_propuesto', { nota: r.nota, monto: r.monto, veces: r.veces }), pendiente: { tipo: 'crear_recurrente', propuesta: r, avisos: [], estado: 'pendiente' } };
  },
  recurrente_sugerido_mes: (c) => {
    const r = recurrentes.sugeridosDelMes(c.userId, c.hoy)[0];
    if (!r) return msg('sin_recurrentes');
    const propuesta = { tipo: r.kind, categoria: r.category, subcategoria: r.subcategory, importe: r.amount, fecha: c.hoy, nota: r.note };
    return { ...msg('recurrente_sugerido_mes', { nota: r.note, monto: r.amount }), pendiente: { tipo: 'registro', propuesta, recurrenteId: r.id, avisos: [], estado: 'pendiente' } };
  },
  plantilla_sugerida: (c) => {
    const p = plantillas.candidatas(c.userId, c.hoy)[0];
    if (!p) return msg('sin_recurrentes');
    return { ...msg('plantilla_sugerida', { nota: p.nota, monto: p.monto, veces: p.veces }), pendiente: { tipo: 'crear_plantilla', propuesta: p, avisos: [], estado: 'pendiente' } };
  },
  // IA: aún no disponible en este corte (llega en S6); todo lo demás sigue funcionando
  ia_ofrecer: (c) => {
    const e = c.iaEstado || {};
    if (!e.disponible) return msg('ia_no_disponible');
    if (e.limiteAlcanzado) return msg('ia_limite_alcanzado', { limite: e.limite });
    return msg('ia_ofrecer', { usadas: e.usadas, limite: e.limite });
  },
};

/** Intenciones que el parser puede devolver pero cuyo cálculo llega en cortes posteriores (S4+). */
const PENDIENTES = ['tarea_completada_propuesta'];

module.exports = { HANDLERS, PENDIENTES, contexto, kindLabel, catLabel, msg };
