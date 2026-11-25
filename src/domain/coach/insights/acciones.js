'use strict';
// Insights 24–31 (recortes, deudas, metas y presupuesto). docs/coach-v2/05 §2.5 y §3.3–3.5.
// Todo se redacta como hipótesis, nunca se sugiere recortar vivienda, salud, educación ni servicios,
// y nunca se usan ahorros ni la reserva de emergencia para liquidar una deuda (L ya los excluye).
const tracker = require('../../tracker');
const calc = require('../../calc');
const G = require('../graficos');
const { D, ZERO, U, r1, fx, pct, insight, DISCRECIONAL } = require('./base');
const { subLabel } = require('./ranking');

const lista = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

// ───────── Recortes ─────────
/** Gastos discrecionales por categoría o subcategoría; vivienda, salud, educación y servicios nunca. */
function discrecionales(c) {
  const grupos = {};
  for (const f of c.gastos) {
    if (U.nuncaRecortar.includes(f.category)) continue;
    const sub = f.subcategory && DISCRECIONAL.has(`${f.category}:${f.subcategory}`);
    if (!(U.recorteDiscrecionales.includes(f.category) || sub)) continue;
    const clave = sub ? `${f.category}:${f.subcategory}` : f.category;
    const g = grupos[clave] || (grupos[clave] = { clave, etiqueta: sub ? subLabel(f.subcategory) : tracker.CATEGORIES.gasto[f.category] || f.category, total: ZERO });
    g.total = g.total.plus(f.amount);
  }
  return Object.values(grupos).sort((a, b) => b.total.cmp(a.total));
}

function recorteRapido(c) {
  if (!c.G.gt(0)) return null;
  const grupos = discrecionales(c);
  const total = grupos.reduce((a, g) => a.plus(g.total), ZERO);
  if (!grupos.length || total.lt(c.G.times(0.1))) return insight('INS-RECORTE-RAPIDO', c, { intencion: 'sin_recorte_obvio', prioridad: 50, acciones: ['ver_ranking', 'simular_pago_extra'], formula: 'discrecional < 10 % del gasto' });
  const top = grupos[0];
  const rp = Math.min(U.recortePct[U.recortePct.length - 1], U.recorteMaximoPct);
  const libera = top.total.times(rp).div(100);
  const vars = { categoria: top.etiqueta, monto: top.total.toFixed(2), recorte_pct: rp, libera: libera.toFixed(2) };
  const sim = tracker.simulate(c.userId, { pago_extra_deuda: libera.toFixed(2) });
  if (sim && sim.scenario && sim.scenario.debtMonths) vars.meses_deuda = sim.scenario.debtMonths;
  const filas = grupos.slice(0, 5).map((g) => ({ id: g.clave, etiqueta: g.etiqueta, valor: g.total.toFixed(2), pct: r1(pct(g.total, c.G)) }));
  return insight('INS-RECORTE-RAPIDO', c, { intencion: 'recortar_rapido', prioridad: 50, vars, grafico: G.barrasCategorias(c.cur, 'Gastos discrecionales', filas), acciones: ['simular_recorte', 'crear_tarea', 'ver_ranking'], formula: 'mayor gasto discrecional × 20 % (hipótesis; tope 30 %)' });
}

// ───────── Deudas ─────────
function deudasActivas(c) {
  return tracker
    .debts(c.userId)
    .map((d) => ({ ...d, s: new D(d.balance || 0) }))
    .filter((d) => d.s.gt(0));
}
/** Bola de nieve: menor saldo primero (la avalancha por tasa efectiva se muestra como alternativa cuando exista el dato). */
const ordenBolaNieve = (ds) => [...ds].sort((a, b) => a.s.cmp(b.s) || a.name.localeCompare(b.name));

function interesRestante(d) {
  try {
    const p = calc.projectDebt({ balance: d.balance, payment: d.payment, ratePercent: d.rate, rateType: d.rate_type, fees: d.fees });
    return p.complete && p.totalInterest ? new D(p.totalInterest).toFixed(2) : null;
  } catch {
    return null;
  }
}

function deudaLiquidable(c) {
  const ds = ordenBolaNieve(deudasActivas(c));
  if (!ds.length) return null;
  const L = c.L;
  const alcanza = c.L.gt(0) ? ds.find((d) => d.s.lte(L)) : null;
  if (alcanza) {
    const vars = { deuda: alcanza.name, saldo_deuda: alcanza.s.toFixed(2), saldo_libre: L.toFixed(2), queda: L.minus(alcanza.s).toFixed(2) };
    const ahorro = interesRestante(alcanza);
    if (ahorro) vars.interes_ahorro = ahorro;
    return insight('INS-DEUDA-LIQUIDABLE', c, { intencion: 'deuda_liquidable', severidad: 'logro', prioridad: 80, vars, acciones: ['simular_pago_extra', 'crear_tarea', 'ver_deudas'], formula: 's ≤ L y L > 0; nunca se usa ahorro ni reserva' });
  }
  const cerca = ds[0];
  const libre = L.gt(0) ? L : ZERO;
  const vars = { deuda: cerca.name, saldo_deuda: cerca.s.toFixed(2), falta: cerca.s.minus(libre).toFixed(2) };
  if (libre.gt(0)) vars.meses = cerca.s.minus(libre).div(libre).ceil().toNumber();
  return insight('INS-DEUDA-LIQUIDABLE', c, { intencion: 'deuda_ninguna_liquidable', severidad: 'info', prioridad: 45, vars, acciones: ['simular_pago_extra', 'simular_recorte', 'ver_deudas'], formula: 'ninguna deuda cabe en L; se muestra la más cercana' });
}

function deudaPrimero(c) {
  const ds = ordenBolaNieve(deudasActivas(c));
  if (!ds.length) return null;
  return insight('INS-DEUDA-PRIMERO', c, { intencion: 'deuda_pagar_primero', prioridad: 62, vars: { deuda: ds[0].name, saldo_deuda: ds[0].s.toFixed(2), estrategia: 'bola de nieve', razon: 'Es la de menor saldo: al liquidarla se libera su cuota para la siguiente' }, acciones: ['simular_pago_extra', 'ver_deudas', 'cambiar_estrategia'], formula: 'bola de nieve: menor saldo primero' });
}

function ordenDeudas(c) {
  const ds = ordenBolaNieve(deudasActivas(c));
  if (ds.length < 2) return null;
  return insight('INS-ORDEN-DEUDAS', c, { intencion: 'orden_deudas', prioridad: 48, vars: { estrategia: 'bola de nieve', lista: lista(ds.map((d) => d.name)), n: ds.length }, acciones: ['cambiar_estrategia', 'simular_pago_extra', 'ver_deudas'], formula: 'orden por menor saldo' });
}

/** Pago extra ilustrativo (hipótesis): efecto en meses e intereses con la proyección de deudas; no toca datos reales. */
function pagoExtra(c, extra = null) {
  const ds = deudasActivas(c);
  if (!ds.length) return null;
  const monto = extra && new D(extra).gt(0) ? new D(extra) : c.L.gt(0) ? c.L.times(0.5) : ZERO;
  if (!monto.gt(0)) return null;
  const entrada = ds.map((d) => ({ name: d.name, balance: d.balance, payment: d.payment, rate: d.rate, rateType: d.rate_type, fees: d.fees }));
  const antes = calc.projectDebts(entrada);
  const despues = calc.projectDebts(entrada, { extra: monto });
  if (!antes.months || !despues.months) return null; // sin tasas conocidas o sin plazo alcanzable: no se inventa
  const vars = { extra: monto.toFixed(2), meses_antes: antes.months, meses_nuevo: despues.months, interes_menos: D.max(new D(antes.totalInterest).minus(despues.totalInterest), 0).toFixed(2), saldo_libre_nuevo: c.L.minus(monto).toFixed(2) };
  return insight('INS-PAGO-EXTRA', c, { intencion: 'simular_pago_extra', prioridad: 0, vars, acciones: ['crear_tarea', 'ver_deudas'], formula: 'proyección de deudas con el pago extra (hipótesis, no cambia tus datos)', descartable: false });
}

// ───────── Metas ─────────
function metaAvance(c) {
  const g = tracker.goals(c.userId).find((x) => x.progress && x.progress.valid && x.progress.pending && !x.progress.pending.isZero());
  if (!g) return null;
  const p = g.progress;
  const vars = { meta: g.name, ahorrado: g.saved, objetivo: new D(g.target_amount).toFixed(2), avance_pct: Math.round(p.progress.times(100).toNumber()) };
  if (p.reachable && p.months) vars.meses = p.months;
  return insight('INS-META-AVANCE', c, { intencion: 'meta_avance', prioridad: 42, vars, grafico: G.medidor('medidor_meta', c.cur, `Meta: ${g.name}`, 'Ahorrado', Number(g.saved), Number(g.target_amount)), acciones: ['ver_metas', 'registrar_gasto'], formula: 'ahorrado / objetivo; meses con el aporte medio de los últimos 3 meses cerrados' });
}

function metaEnRiesgo(c) {
  for (const g of tracker.goals(c.userId)) {
    const p = g.progress;
    if (!p || !p.valid || !p.desiredMonths || p.onTrack !== false || !p.reachable || !p.months) continue;
    const extra = p.months - p.desiredMonths;
    if (extra < U.metaRiesgoMeses) continue;
    const sugerido = Math.ceil(p.needed.toNumber() / U.metaRedondeo) * U.metaRedondeo;
    return insight('INS-META-RIESGO', c, { intencion: 'meta_en_riesgo', severidad: 'atencion', prioridad: 70, vars: { meta: g.name, meses_extra: extra, aporte_actual: new D(g.monthly).toFixed(2), aporte_sugerido: String(sugerido) }, grafico: G.medidor('medidor_meta', c.cur, `Meta: ${g.name}`, 'Ahorrado', Number(g.saved), Number(g.target_amount)), acciones: ['simular_recorte', 'ver_metas', 'crear_tarea'], formula: 'meses con el aporte actual − meses deseados ≥ 3' });
  }
  return null;
}

// ───────── Presupuesto ─────────
function presupuesto(c) {
  const b = tracker.budgetSummary(c.userId, c.month);
  if (!b) return [];
  const out = { excedido: null, cerca: null };
  for (const x of c.gastoPorCategoria) {
    const prev = b.byCategory[`gasto:${x.categoria}`];
    if (!prev || !prev.gt(0)) continue;
    const real = new D(x.monto);
    const p = pct(real, prev);
    const nombre = x.etiqueta;
    if (p >= U.presupuestoExcedido) {
      if (!out.excedido || real.minus(prev).gt(out.excedido.exceso)) out.excedido = { nombre, real, prev, p, exceso: real.minus(prev), code: x.categoria };
    } else if (p >= U.presupuestoCerca) {
      if (!out.cerca || p > out.cerca.p) out.cerca = { nombre, real, prev, p, code: x.categoria };
    }
  }
  const res = [];
  const g = (e, tipo) => G.medidor('medidor_presupuesto', c.cur, `Presupuesto de ${e.nombre}`, e.nombre, Number(e.real.toFixed(2)), Number(e.prev.toFixed(2)), tipo);
  if (out.excedido) res.push(insight('INS-PRESUPUESTO-EXCEDIDO', c, { intencion: 'presupuesto_excedido', severidad: 'alerta', prioridad: 90, vars: { categoria: out.excedido.nombre, exceso: out.excedido.exceso.toFixed(2), pct_usado: Math.round(out.excedido.p) }, grafico: g(out.excedido), acciones: ['ver_presupuesto', 'simular_recorte'], formula: 'real / previsto ≥ 100 %' }));
  if (out.cerca) res.push(insight('INS-PRESUPUESTO-CERCA', c, { intencion: 'presupuesto_cerca', severidad: 'atencion', prioridad: 77, vars: { categoria: out.cerca.nombre, pct_usado: Math.round(out.cerca.p), queda: out.cerca.prev.minus(out.cerca.real).toFixed(2), dias_restantes: c.N - c.d }, grafico: g(out.cerca), acciones: ['ver_presupuesto', 'simular_recorte'], formula: 'real / previsto entre 80 % y 100 %' }));
  return res;
}

module.exports = { recorteRapido, deudaLiquidable, deudaPrimero, ordenDeudas, pagoExtra, metaAvance, metaEnRiesgo, presupuesto, discrecionales };
void fx;
