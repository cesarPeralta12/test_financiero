'use strict';
// Motor de insights del Coach v2 (docs/coach-v2/05): calcula todas las observaciones aplicables de un mes,
// las ordena (severidad, prioridad, id) y devuelve las primeras; el resto queda en «Más observaciones».
// La IA no interviene en ningún cálculo.
const db = require('../../../db');
const log = require('../../../lib/log');
const base = require('./base');
const estado = require('./estado');
const ranking = require('./ranking');
const comparacion = require('./comparacion');
const acciones = require('./acciones');
const { INTENCIONES, CATALOG_VERSION, catalogo } = require('../datos');
const { elegirVariante, renderizar } = require('../mensajes');
const G = require('../graficos');
const money = require('../../../lib/money');

const { ORDEN_SEV } = base;
const HORAS_ALERTA = 24;
const DIAS_DESCARTE = 7;

/** Reglas del feed, en el orden del documento (las de «a pedido» no entran). */
const REGLAS = [
  ['estado.resumenMes', estado.resumenMes],
  ['estado.saldoMes', estado.saldoMes],
  ['estado.gastoVsIngreso', estado.gastoVsIngreso],
  ['estado.tasaAhorro', estado.tasaAhorro],
  ['estado.sinIngresos', estado.sinIngresos],
  ['estado.proyeccion', estado.proyeccion],
  ['ranking.mayorCategoria', ranking.mayorCategoria],
  ['ranking.menorCategoria', ranking.menorCategoria],
  ['ranking.mayorMovimiento', (c) => ranking.movimientoExtremo(c, true)],
  ['ranking.menorMovimiento', (c) => ranking.movimientoExtremo(c, false)],
  ['ranking.top3', ranking.top3],
  ['comparacion.cambioGastoTotal', comparacion.cambioGastoTotal],
  ['comparacion.categoriaSubio', comparacion.categoriaSubio],
  ['comparacion.categoriaBajo', comparacion.categoriaBajo],
  ['comparacion.cambioIngreso', comparacion.cambioIngreso],
  ['comparacion.tendenciaMeses', comparacion.tendenciaMeses],
  ['habitos.hormiga', ranking.hormiga],
  ['habitos.suscripciones', ranking.suscripciones],
  ['habitos.gastoRepetido', ranking.gastoRepetido],
  ['habitos.diaMasCaro', ranking.diaMasCaro],
  ['habitos.finDeSemana', ranking.finDeSemana],
  ['habitos.gastoSemana', ranking.gastoSemana],
  ['acciones.recorteRapido', acciones.recorteRapido],
  ['acciones.deudaLiquidable', acciones.deudaLiquidable],
  ['acciones.deudaPrimero', acciones.deudaPrimero],
  ['acciones.ordenDeudas', acciones.ordenDeudas],
  ['acciones.metaAvance', acciones.metaAvance],
  ['acciones.metaEnRiesgo', acciones.metaEnRiesgo],
  ['acciones.presupuesto', acciones.presupuesto],
  ['calidad.sinRegistro', estado.sinRegistro],
  ['calidad.muchosEnOtros', estado.muchosEnOtros],
  ['calidad.racha', estado.racha],
];

/** Calcula todas las observaciones aplicables. Una regla que falla no tumba a las demás. */
function calcular(userId, { hoy, mes } = {}) {
  const ctx = base.contexto(userId, { hoy, mes });
  if (ctx.n < base.U.minMovs) return { ctx, insights: [estado.pocosDatos(ctx)] };
  const out = [];
  for (const [nombre, fn] of REGLAS) {
    try {
      const r = fn(ctx);
      if (Array.isArray(r)) out.push(...r.filter(Boolean));
      else if (r) out.push(r);
    } catch (e) {
      log.error('Regla de insight falló', { regla: nombre, motivo: e.message });
    }
  }
  return { ctx, insights: out };
}

const comparar = (a, b) => (ORDEN_SEV[b.severidad] - ORDEN_SEV[a.severidad]) || (b.prioridad - a.prioridad) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Descartes vigentes: {id → severidad}; las alertas solo se silencian 24 h, el resto 7 días. */
function descartados(userId, ahora = Date.now()) {
  const rows = db.all('SELECT insight_id, severity, dismissed_at FROM insight_dismissals WHERE user_id = ?', userId);
  const vigentes = {};
  for (const r of rows) {
    const horas = (ahora - Date.parse(r.dismissed_at)) / 3600000;
    const limite = r.severity === 'alerta' ? HORAS_ALERTA : DIAS_DESCARTE * 24;
    if (horas < limite) vigentes[r.insight_id] = r.severity;
  }
  return vigentes;
}

function descartar(userId, insightId, severidad) {
  const ok = ['info', 'logro', 'atencion', 'alerta'].includes(severidad);
  if (!ok || !/^INS-[A-Z0-9-]+:\d{4}-\d{2}$/.test(String(insightId))) return false;
  db.run(
    `INSERT INTO insight_dismissals (user_id, insight_id, severity, dismissed_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, insight_id) DO UPDATE SET severity = excluded.severity, dismissed_at = excluded.dismissed_at`,
    userId,
    insightId,
    severidad,
    db.now()
  );
  return true;
}

/** Selección (§3.7): pocos datos manda; sin descartados; uno por grupo; orden por severidad, prioridad e id. */
function seleccionar(insights, { max = 3, descartadosVigentes = {} } = {}) {
  if (insights.some((i) => i.tipo === 'INS-POCOS-DATOS')) {
    const solo = insights.filter((i) => i.tipo === 'INS-POCOS-DATOS');
    return { visibles: solo.slice(0, max), resto: [], total: solo.length };
  }
  let lista = insights.filter((i) => i.prioridad > 0 && !(i.id in descartadosVigentes && descartadosVigentes[i.id] === i.severidad));
  const porGrupo = {};
  for (const i of lista.sort(comparar)) if (!porGrupo[i.grupo]) porGrupo[i.grupo] = i; // el primero de cada grupo es el mejor
  lista = Object.values(porGrupo).sort(comparar);
  // Dentro de «cambio de categoría» gana el de mayor |delta_monto| entre subió y bajó.
  return { visibles: lista.slice(0, max), resto: lista.slice(max), total: lista.length };
}

const semillaDe = (id) => [...String(id)].reduce((a, ch) => a + ch.charCodeAt(0), 0);

/** Texto final de un insight con las variantes del catálogo (cifras ya calculadas por el servidor). */
function texto(insight, { cur, tono = 'cercano' }) {
  const it = INTENCIONES[insight.intencion_mensaje];
  if (!it) return null;
  const v = elegirVariante(it, insight.variables, { tono, semilla: semillaDe(insight.id) });
  try {
    return { texto: renderizar(v.texto, insight.variables, { moneda: cur }), variante_id: v.id, tono: v.tono };
  } catch (e) {
    log.error('Insight sin renderizar', { variante: v.id, motivo: e.message });
    return null;
  }
}

const botonesDe = (ids) =>
  (ids || []).map((id) => {
    const b = catalogo.botones[id];
    return b ? { id, etiqueta: b.etiqueta, accion: b.accion, ...(b.destino ? { destino: b.destino } : {}), ...(b.params ? { params: b.params } : {}), ...(b.intencion ? { intencion: b.intencion } : {}) } : null;
  }).filter(Boolean);

/** Observaciones de un mes listas para mostrar: ordenadas, con su texto y sus botones. */
function listar(userId, { hoy, mes, max = 3, tono = 'cercano' } = {}) {
  const { ctx, insights } = calcular(userId, { hoy, mes });
  const sel = seleccionar(insights, { max, descartadosVigentes: descartados(userId) });
  const vista = (i) => {
    const t = texto(i, { cur: ctx.cur, tono });
    return t ? { ...i, texto: t.texto, variante_id: t.variante_id, tono: t.tono, botones: botonesDe(i.acciones) } : null;
  };
  return { mes: ctx.month, moneda: ctx.cur, insights: sel.visibles.map(vista).filter(Boolean), mas: sel.resto.map(vista).filter(Boolean), total: sel.total, catalog_version: CATALOG_VERSION };
}

/** Gráfico de un tipo para un mes: los que son del mes salen directo; el resto, del insight que lo trae. */
function grafico(userId, tipo, { hoy, mes } = {}) {
  if (!G.TIPOS.includes(tipo)) return { error: 'TIPO_DESCONOCIDO' };
  const ctx = base.contexto(userId, { hoy, mes });
  if (ctx.n < base.U.minMovs) return { error: 'SIN_DATOS' };
  if (tipo === 'barras_categorias') {
    const filas = ctx.gastoPorCategoria.slice(0, 8).map((x) => ({ id: x.categoria, etiqueta: x.etiqueta, valor: x.monto, pct: x.pct_del_total }));
    return filas.length ? { grafico: G.barrasCategorias(ctx.cur, 'Gastos por categoría', filas), ctx } : { error: 'SIN_DATOS' };
  }
  if (tipo === 'barra_ingreso_gasto') return { grafico: G.barraIngresoGasto(ctx.cur, 'Ingresos y gastos del mes', base.fx(ctx.I), base.fx(ctx.G), base.fx(ctx.B)), ctx };
  if (tipo === 'cascada_mes') return { grafico: G.cascadaMes(ctx.cur, 'Cómo se va tu ingreso', base.fx(ctx.I), base.fx(ctx.G), base.fx(ctx.Dd), base.fx(ctx.S), base.fx(ctx.L)), ctx };
  const { insights } = calcular(userId, { hoy, mes });
  const i = insights.find((x) => x.grafico && x.grafico.tipo === tipo);
  return i ? { grafico: i.grafico, ctx } : { error: 'SIN_DATOS' };
}

void money;
module.exports = { grafico, calcular, seleccionar, listar, descartar, descartados, texto, botonesDe, REGLAS, contexto: base.contexto };
