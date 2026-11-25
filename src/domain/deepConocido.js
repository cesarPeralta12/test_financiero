'use strict';
// Evaluación profunda inteligente: reúne lo que Día Uno YA sabe de la persona para no volver a preguntarlo.
// Fuentes, de la más actual a la más antigua: Mi dinero (movimientos, deudas y metas de los últimos meses),
// el test gratuito y la evaluación profunda anterior. Cada dato indica su origen y su fecha; lo que tiene más de
// 90 días llega sin marcar (puede haber cambiado). La persona siempre confirma: nada se guarda solo.
const db = require('../db');
const money = require('../lib/money');
const tracker = require('./tracker');
const qs = require('./questionnaire');

const { D } = money;
const ZERO = new D(0);
const DIAS_FRESCO = 90;
const MESES = 3; // meses completos que se promedian
const MIN_MESES = 2; // con menos meses con datos no se sugiere nada

/** Preguntas de situación o decisión: dependen del momento y no se prellenan (solo se ofrecen «Usar esta respuesta»). */
const NO_PRELLENAR = new Set(['atraso_actual', 'pago_tarjeta', 'gastos_previstos', 'prioridad', 'ajuste_gasto', 'caida_ingreso']);

const ORIGEN = {
  movimientos: 'Tus movimientos en Mi dinero',
  cuenta: 'Lo que ya registraste en Día Uno',
  test_gratuito: 'Tu test gratuito',
  evaluacion_anterior: 'Tu evaluación anterior',
};
const DEPENDENTS = { D0: 0, D1: 1, D2: 2, D3: 3, D4PLUS: 4 };
const INGRESO_PRINCIPAL = ['sueldo', 'independiente', 'negocio'];
const INGRESO_ADICIONAL = ['renta', 'extra', 'otros'];
const GASTO_KEYS = ['vivienda', 'alimentacion', 'transporte', 'servicios', 'salud', 'educacion', 'ocio', 'otros'];

const hoyIso = () => new Date().toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86400000);
const mesesAtras = (hoy, n) => new Date(Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)) - 1 - n, 1)).toISOString().slice(0, 7);

/** Promedios mensuales de los últimos meses completos, solo sobre los meses que tienen datos de ese tipo. */
function promedios(userId, hoy) {
  const meses = Array.from({ length: MESES }, (_, i) => mesesAtras(hoy, i + 1));
  const filas = db.all(
    `SELECT substr(date, 1, 7) AS mes, kind, category, SUM(CAST(amount AS REAL)) AS total FROM movements
      WHERE user_id = ? AND deleted_at IS NULL AND substr(date, 1, 7) >= ? AND substr(date, 1, 7) <= ? GROUP BY mes, kind, category`,
    userId,
    meses[meses.length - 1],
    meses[0]
  );
  const por = (kind, cats) => {
    const total = {};
    for (const f of filas) if (f.kind === kind && (!cats || cats.includes(f.category))) total[f.mes] = (total[f.mes] || 0) + f.total;
    const con = Object.values(total).filter((v) => v > 0);
    return con.length >= MIN_MESES ? { avg: con.reduce((a, b) => a + b, 0) / con.length, meses: con.length } : null;
  };
  const gastoPorCat = {};
  const mesesGasto = new Set(filas.filter((f) => f.kind === 'gasto').map((f) => f.mes));
  if (mesesGasto.size >= MIN_MESES) {
    for (const k of GASTO_KEYS) {
      const suma = filas.filter((f) => f.kind === 'gasto' && f.category === k).reduce((a, f) => a + f.total, 0);
      gastoPorCat[k] = suma / mesesGasto.size;
    }
  }
  const retiros = (() => {
    const total = {};
    for (const f of filas) if (f.kind === 'ahorro' || f.kind === 'retiro_ahorro') total[f.mes] = (total[f.mes] || 0) + (f.kind === 'ahorro' ? f.total : -f.total);
    const con = Object.values(total).filter((v) => v > 0);
    return con.length >= MIN_MESES ? { avg: con.reduce((a, b) => a + b, 0) / con.length, meses: con.length } : null;
  })();
  return {
    desde: meses[meses.length - 1],
    hasta: meses[0],
    ingresoPrincipal: por('ingreso', INGRESO_PRINCIPAL),
    ingresoAdicional: por('ingreso', INGRESO_ADICIONAL),
    gastoTotal: por('gasto', null),
    gastoPorCat: Object.keys(gastoPorCat).length ? gastoPorCat : null,
    ahorro: retiros,
  };
}

const r2 = (n) => new D(n).toDecimalPlaces(2).toFixed(2);

/** Candidatos de Mi dinero y de la cuenta (deudas y metas): los más actuales. */
function desdeCuenta(userId, hoy) {
  const out = {};
  const p = promedios(userId, hoy);
  const detalle = (m) => `promedio de ${m.meses} ${m.meses === 1 ? 'mes' : 'meses'} (${p.desde} a ${p.hasta})`;
  const mov = (code, value, det) => (out[code] = { value, source: 'movimientos', date: hoy, detail: det });
  if (p.ingresoPrincipal) mov('ingreso_principal', { amount: r2(p.ingresoPrincipal.avg), period: 'mensual' }, detalle(p.ingresoPrincipal));
  if (p.ingresoAdicional) mov('ingresos_adicionales', { amount: r2(p.ingresoAdicional.avg), period: 'mensual' }, detalle(p.ingresoAdicional));
  if (p.gastoTotal) mov('gasto_total', { amount: r2(p.gastoTotal.avg), period: 'mensual' }, detalle(p.gastoTotal));
  if (p.gastoPorCat) mov('gastos_desglose', Object.fromEntries(GASTO_KEYS.map((k) => [k, r2(p.gastoPorCat[k])])), `promedio de tus gastos por categoría (${p.desde} a ${p.hasta})`);
  if (p.ahorro) mov('ahorro_mensual', { amount: r2(p.ahorro.avg), period: 'mensual' }, detalle(p.ahorro));

  const deudas = tracker.debts(userId);
  if (deudas.length) {
    const fecha = deudas.map((d) => String(d.updated_at || d.created_at || hoy).slice(0, 10)).sort().pop();
    const value = deudas.slice(0, 10).map((d) => ({ name: d.name, kind: d.kind, balance: r2(d.balance), payment: r2(d.payment), rate: d.rate === null || d.rate === undefined || d.rate === '' ? null : String(d.rate), rate_type: d.rate_type, fees: d.fees ? r2(d.fees) : null }));
    out.deudas = { value, source: 'cuenta', date: hoy, detail: `${deudas.length} ${deudas.length === 1 ? 'deuda registrada' : 'deudas registradas'} (última actualización ${fecha})` };
    out.pago_deudas_total = { value: { amount: r2(deudas.reduce((a, d) => a.plus(d.payment), ZERO)), period: 'mensual' }, source: 'cuenta', date: hoy, detail: 'suma de las cuotas de tus deudas' };
  }
  const metas = tracker.goals(userId).filter((g) => g.kind === 'meta' && g.status === 'activa');
  if (metas.length) out.metas = { value: metas.slice(0, 5).map((g) => ({ name: g.name, target: r2(g.target_amount), saved: r2(g.saved), months: g.target_months || null })), source: 'cuenta', date: hoy, detail: `${metas.length} ${metas.length === 1 ? 'meta registrada' : 'metas registradas'}` };
  return out;
}

/** Test gratuito V4: moneda, ingreso, dinero guardado, personas a cargo, «no tengo deudas» e ingreso fijo. Solo montos exactos. */
function desdeTestGratuito(userId, currency) {
  const s = db.one("SELECT id, currency, completed_at FROM ft_sessions WHERE user_id = ? AND version_id = 'FREE_24_V4_ES' AND completed_revision IS NOT NULL ORDER BY completed_at DESC LIMIT 1", userId);
  const out = {};
  if (!s) return out;
  const fecha = String(s.completed_at || '').slice(0, 10) || hoyIso();
  const slot = (id) => {
    const row = db.one("SELECT value_json FROM ft_answers WHERE session_id = ? AND slot_id = ? AND active = 1 AND response_status = 'answered'", s.id, id);
    return row ? db.parse(row.value_json, null) : null;
  };
  if (s.currency) out.moneda_base = { value: s.currency, source: 'test_gratuito', date: fecha };
  const exacto = (v) => v && v.amount !== null && v.amount !== undefined && (!currency || v.currency === currency);
  const ing = slot('Q06');
  if (exacto(ing)) out.ingreso_principal = { value: { amount: ing.amount, period: 'mensual' }, source: 'test_gratuito', date: fecha };
  const ah = slot('Q13');
  if (exacto(ah)) out.ahorro_disponible = { value: ah.amount, source: 'test_gratuito', date: fecha };
  const dep = slot('Q03');
  if (dep && dep.codes && DEPENDENTS[dep.codes[0]] !== undefined) out.dependientes = { value: DEPENDENTS[dep.codes[0]], source: 'test_gratuito', date: fecha };
  // Perfil: los códigos son los mismos que en la evaluación.
  const uno = (id, code) => {
    const v = slot(id);
    if (v && v.codes && v.codes.length) out[code] = { value: v.codes[0], source: 'test_gratuito', date: fecha };
  };
  const varios = (id, code) => {
    const v = slot(id);
    if (v && v.codes && v.codes.length) out[code] = { value: v.codes, source: 'test_gratuito', date: fecha };
  };
  uno('Q04', 'actividad');
  if (slot('Q16') && slot('Q16').codes && slot('Q16').codes[0] !== 'H15') uno('Q16', 'horas_semana');
  varios('Q17', 'habilidades');
  varios('Q20', 'a_quien_ofrecer');
  // «No tengo deudas» (si dijo que sí tiene, hay que preguntar: faltan el saldo y la cuota de cada una).
  const deuda = slot('Q10');
  const tipos = slot('Q11');
  if ((deuda && deuda.status === 'NO') || (tipos && tipos.codes && tipos.codes.includes('NONE'))) out.deudas = { value: [], source: 'test_gratuito', date: fecha };
  // Siempre recibe el mismo monto: en un mes malo no baja.
  const varia = slot('Q07');
  if (varia && varia.codes && varia.codes[0] === 'FIXED') out.caida_ingreso = { value: '0', source: 'test_gratuito', date: fecha, estable: true };
  return out;
}

/** Evaluación profunda anterior: todas las respuestas válidas, con la fecha en que se terminó. */
function desdeEvaluacionAnterior(userId, evId, currency) {
  const prev = db.one("SELECT id, completed_at, base_currency FROM evaluations WHERE user_id = ? AND kind = 'profundo' AND status = 'finalizada' AND id <> ? ORDER BY completed_at DESC, id DESC LIMIT 1", userId, evId);
  const out = {};
  if (!prev) return out;
  const fecha = String(prev.completed_at || '').slice(0, 10) || hoyIso();
  for (const [code, a] of Object.entries(qs.answers(prev.id))) {
    if (a.unknown || a.skipped || a.value === null || a.value === undefined) continue;
    if (code === 'moneda_base' || !currency || !prev.base_currency || prev.base_currency === currency) out[code] = { value: a.value, source: 'evaluacion_anterior', date: fecha };
  }
  return out;
}

/** Gastos declarados en el test gratuito, para recordarlos al pedir el detalle por categoría (null si no hay o es otra moneda). */
function gastosDelTest(userId, currency) {
  const s = db.one("SELECT id FROM ft_sessions WHERE user_id = ? AND version_id = 'FREE_24_V4_ES' AND completed_revision IS NOT NULL ORDER BY completed_at DESC LIMIT 1", userId);
  if (!s) return null;
  const monto = (id) => {
    const row = db.one("SELECT value_json FROM ft_answers WHERE session_id = ? AND slot_id = ? AND active = 1 AND response_status = 'answered'", s.id, id);
    const v = row ? db.parse(row.value_json, null) : null;
    return v && v.amount && v.currency === currency && Number(v.amount) > 0 ? money.format(v.amount, currency) : null;
  };
  const basicos = monto('Q08');
  const extras = monto('Q09');
  return basicos || extras ? { basicos, extras } : null;
}

/**
 * Lo que ya se sabe para esta evaluación: [{ code, position, label, value, text, source, sourceLabel, date, detail, fresh }]
 * en el orden del cuestionario. La fuente más reciente gana; lo ya respondido igual no se repite.
 */
function candidatos(userId, ev, qn, { hoy = hoyIso(), incluirVolatiles = false } = {}) {
  const user = db.one('SELECT base_currency FROM users WHERE id = ?', userId) || {};
  const actuales = qs.answers(ev.id);
  const sinDatos = !db.value('SELECT 1 FROM movements WHERE user_id = ? AND deleted_at IS NULL LIMIT 1', userId);
  // Moneda: la ya respondida, la de la evaluación anterior o el test gratuito; si hay movimientos, la de la cuenta.
  const base0 = { ...desdeTestGratuito(userId, null), ...desdeEvaluacionAnterior(userId, ev.id, null) };
  let currency = (actuales.moneda_base && !actuales.moneda_base.unknown && actuales.moneda_base.value) || (base0.moneda_base && base0.moneda_base.value) || (!sinDatos && user.base_currency) || null;
  // Lo de Mi dinero está en la moneda de la cuenta: solo sirve si la evaluación usa esa misma moneda.
  const cuenta = !currency || currency === user.base_currency ? desdeCuenta(userId, hoy) : {};
  const free = desdeTestGratuito(userId, currency);
  const anterior = desdeEvaluacionAnterior(userId, ev.id, currency);
  const mejor = {};
  const fuentes = [cuenta, free, anterior]; // empate de fecha: gana la primera
  for (const f of fuentes) {
    for (const [code, c] of Object.entries(f)) {
      if (!mejor[code] || c.date > mejor[code].date) mejor[code] = c;
    }
  }
  if (currency && !mejor.moneda_base) mejor.moneda_base = { value: currency, source: 'cuenta', date: hoy, detail: 'la moneda de tu cuenta' };
  const out = [];
  for (const q of qn.questions) {
    const c = mejor[q.code];
    if (!c || (!incluirVolatiles && NO_PRELLENAR.has(q.code) && !c.estable)) continue;
    if (!qs.isApplicable(q, { ...actuales, ...Object.fromEntries(Object.entries(mejor).map(([k, v]) => [k, { value: v.value }])) })) continue;
    const ya = actuales[q.code];
    if (ya && !ya.unknown && JSON.stringify(ya.value) === JSON.stringify(c.value)) continue;
    const curQ = (q.code === 'moneda_base' ? c.value : currency) || 'USD';
    out.push({
      code: q.code,
      position: q.position,
      label: q.prompt,
      value: c.value,
      text: qs.display(q, { value: c.value }, curQ),
      source: c.source,
      sourceLabel: ORIGEN[c.source],
      date: c.date,
      detail: c.detail || null,
      fresh: c.source === 'movimientos' || c.source === 'cuenta' || diasEntre(c.date, hoy) <= DIAS_FRESCO,
    });
  }
  return out;
}

/** Candidato para una sola pregunta (sugerencia «Usar esta respuesta»), incluso en las que no se prellenan. */
function paraPregunta(userId, ev, qn, code, opts = {}) {
  return candidatos(userId, ev, qn, { ...opts, incluirVolatiles: true }).find((c) => c.code === code) || null;
}

module.exports = { gastosDelTest, candidatos, paraPregunta, ORIGEN, NO_PRELLENAR, DIAS_FRESCO };
