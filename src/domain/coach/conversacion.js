'use strict';
// Conversación libre del Coach: lo que se sabe de la persona (hechos), lo que se habló (memoria corta) y un consejo
// de respaldo calculado por reglas cuando la IA no responde o se agotó el cupo.
// A la IA viajan cifras ya calculadas, prioridades, metas, tareas y el texto que la persona escribe;
// nunca su nombre, su correo, sus notas ni el nombre que le puso a una deuda.
const db = require('../../db');
const money = require('../../lib/money');
const tracker = require('../tracker');
const tasks = require('../tasks');
const planDomain = require('../plan');
const { normalizar } = require('./normalizar');
const base = require('./insights/base');

const { D } = money;
const DEUDA = { tarjeta: 'tarjeta de crédito', personal: 'préstamo personal', auto: 'crédito de auto', hipoteca: 'hipoteca', estudios: 'crédito educativo', familiar: 'préstamo familiar', otra: 'otra deuda' };
const MEMORIA = 4; // mensajes anteriores que se recuerdan: pocos, para gastar poco
const MEMORIA_LARGO = 160;
// Preguntas sugeridas: se contestan con reglas y las cifras de la persona, sin gastar IA.
const SUGERIDAS = { ahorro: '¿Cómo empiezo a ahorrar?', ingreso: '¿Cómo puedo ganar más dinero?' };
// Respuestas del Coach que se recuerdan: las que no citan notas ni nombres.
const RECORDABLES = new Set(['consejo_ia', 'consejo_calculado', 'ia_respuesta_prefijo', 'resumen_mes', 'saldo_mes', 'gasto_total', 'ingreso_total', 'mayor_gasto', 'simular_pago_extra', 'comparar_mes_anterior', 'proyeccion_cierre']);

const seguro = (fn, def) => {
  try {
    return fn();
  } catch {
    return def;
  }
};

/** Todo lo que el Coach sabe, como cifras y textos ya calculados. */
function hechos(userId, hoy) {
  const c = base.contexto(userId, { hoy });
  const f = (v) => money.format(v, c.cur);
  const out = { mes: c.month, movimientos_del_mes: c.n, dias_restantes: c.N - c.d };
  if (c.n) Object.assign(out, { ingresos: f(c.I.toFixed(2)), gastos: f(c.G.toFixed(2)), saldo: f(c.B.toFixed(2)) });
  const top = c.gastoPorCategoria[0];
  if (top) Object.assign(out, { mayor_categoria: top.etiqueta, mayor_categoria_monto: f(top.monto), mayor_categoria_pct: top.pct_del_total === null ? undefined : `${Math.round(top.pct_del_total)} %` });

  const deudas = tracker.debts(userId).filter((d) => Number(d.balance) > 0);
  if (deudas.length) {
    out.deudas_activas = deudas.length;
    out.deudas_saldo_total = f(deudas.reduce((a, d) => a.plus(d.balance), new D(0)).toFixed(2));
    out.deudas = deudas.slice(0, 4).map((d) => ({ tipo: DEUDA[d.kind] || 'deuda', saldo: f(d.balance), cuota: d.payment ? f(d.payment) : undefined }));
  }
  const row = db.one('SELECT result_json FROM diagnoses WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', userId);
  const diag = row ? db.parse(row.result_json, null) : null;
  if (diag) {
    out.diagnostico = seguro(() => ({
      ingresos: diag.income && diag.income.total ? f(diag.income.total) : undefined,
      gastos: diag.expenses && diag.expenses.total ? f(diag.expenses.total) : undefined,
      cuotas_de_deuda: diag.debtPayments ? f(diag.debtPayments) : undefined,
      saldo_disponible: diag.balance !== null && diag.balance !== undefined ? f(diag.balance) : undefined,
      meses_de_reserva: diag.reserve && diag.reserve.months !== null ? diag.reserve.months : undefined,
      prioridades: (diag.priorities || []).slice(0, 3).map((p) => p.title),
    }), undefined);
  } else {
    // Sin evaluación de pago: los consejos del test gratuito también orientan la conversación.
    const ft = db.one('SELECT r.result_json FROM ft_results r JOIN ft_sessions s ON s.id = r.session_id WHERE s.user_id = ? AND s.completed_revision IS NOT NULL ORDER BY s.completed_at DESC, r.id DESC LIMIT 1', userId);
    const sc = ft ? (db.parse(ft.result_json, {}) || {}).screen : null;
    if (sc && Array.isArray(sc.tips)) out.consejos_del_test = sc.tips.slice(0, 3).map((t) => t.action);
  }
  const plan = seguro(() => planDomain.current(userId), null);
  const contenido = plan ? db.parse(plan.content_json, null) : null;
  if (contenido && contenido.startDate) out.dia_del_plan = seguro(() => planDomain.dayNumber(contenido.startDate), undefined);
  const t = seguro(() => tasks.next(userId), null);
  if (t) out.proxima_tarea = t.title;
  const metas = tracker.goals(userId).slice(0, 4);
  if (metas.length) out.metas = metas.map((g) => ({ meta: g.name, objetivo: f(g.target_amount), ahorrado: f(g.saved) }));
  return out;
}

/** Últimos mensajes anteriores a `antesDe`, del más viejo al más nuevo, sin el nombre de la persona. */
function memoria(userId, convId, antesDe = Number.MAX_SAFE_INTEGER) {
  const nombre = String(db.value('SELECT name FROM users WHERE id = ?', userId) || '').trim();
  const partes = nombre.split(/\s+/).filter((x) => x.length > 2).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = partes.length ? new RegExp(`(${partes.join('|')})`, 'gi') : null;
  const limpio = (s) => (re ? s.replace(re, '[persona]') : s).slice(0, MEMORIA_LARGO);
  return db
    .all("SELECT role, intent, content FROM messages WHERE conversation_id = ? AND user_id = ? AND id < ? AND role IN ('usuario', 'coach') ORDER BY id DESC LIMIT 24", convId, userId, antesDe)
    .filter((m) => (m.role === 'usuario' ? !/^\[\w+\]$/.test(m.content) : RECORDABLES.has(m.intent)))
    .slice(0, MEMORIA)
    .reverse()
    .map((m) => ({ de: m.role === 'usuario' ? 'persona' : 'coach', texto: limpio(m.content) }));
}

const EMOCION = /\b(preocup\w*|estres\w*|angusti\w*|agobi\w*|ansied\w*|ansios\w*|desesper\w*|miedo|triste|no puedo mas)\b/;
const hayEmocion = (texto) => EMOCION.test(normalizar(texto));

const TEMAS = [
  ['deuda', /\b(deud\w*|debo|prestamo\w*|credito\w*|tarjeta\w*|cuota\w*|atras\w*)\b/],
  ['ahorro', /\b(ahorr\w*|guardar|reserva|emergencia\w*|fondo|meta\w*|comprar|juntar)\b/],
  ['ingreso', /\b(ganar|ingreso\w*|sueldo|trabajo|negocio|emprend\w*|vender|vendo|aumento|renunci\w*)\b/],
  ['gasto', /\b(gast\w*|recort\w*|reducir|alcanza|plata|dinero)\b/],
];

/** Consejo calculado por reglas con las cifras de la persona. Nunca promete resultados ni recomienda productos. */
function respaldo(userId, texto, hoy) {
  const n = normalizar(texto);
  const c = base.contexto(userId, { hoy });
  const f = (v) => money.format(v, c.cur);
  const h = hechos(userId, hoy);
  const tema = (TEMAS.find(([, re]) => re.test(n)) || ['general'])[0];
  const out = [];
  if (hayEmocion(texto)) out.push('Entiendo que esto te preocupe; vamos paso a paso.');
  const mayor = h.mayor_categoria ? `${h.mayor_categoria} (${h.mayor_categoria_monto})` : null;
  if (tema === 'deuda') {
    out.push(h.deudas_activas
      ? `Debes ${h.deudas_saldo_total} en total. Primero cuida que ninguna cuota se atrase; después, si te queda algo, ponlo en la deuda más cara y evita sumar otra.`
      : 'No tengo deudas tuyas anotadas. Si debes algo, dime cuánto y cuánto pagas al mes, o anótalo en la calculadora, y vemos por cuál empezar.');
  } else if (tema === 'ahorro') {
    const parte = c.B.gt(0) ? c.B.times(0.2).floor() : null;
    if (parte && parte.gt(0)) out.push(`Este mes te quedan ${h.saldo}. Podrías separar ${f(parte.toFixed(2))} apenas cobres, antes de gastar, y ver cómo te sientes con ese monto.`);
    else if (c.n) out.push(`Este mes todavía no te queda dinero libre${mayor ? `. Lo primero sería mirar ${mayor}, que es donde más se va` : ''}. Empieza con un monto muy pequeño, aunque sea simbólico.`);
    else out.push('Empieza con un monto pequeño y fijo apenas cobres, aunque sea simbólico. Cuando anotes tus gastos e ingresos te digo cuánto podrías separar.');
  } else if (tema === 'ingreso') {
    out.push('Empieza por algo que ya sabes hacer: pregunta a tres personas qué les resolvería y cuánto pagarían por eso. Compruébalo antes de invertir dinero o dejar lo que hoy te da ingresos.');
  } else if (tema === 'gasto' && mayor) {
    out.push(`Donde más se va tu dinero este mes es ${mayor}. Elige ahí un gasto que puedas bajar esta semana sin tocar lo esencial.`);
  } else if (h.proxima_tarea) {
    out.push(`Lo siguiente en tu plan es: ${h.proxima_tarea}. Si te parece, empezamos por ahí.`);
  } else if (h.diagnostico && h.diagnostico.prioridades && h.diagnostico.prioridades.length) {
    out.push(`Según tu diagnóstico, tu prioridad es: ${h.diagnostico.prioridades[0]}.`);
  } else if (h.consejos_del_test && h.consejos_del_test.length) {
    out.push(`De tu test salió este consejo para ti: ${h.consejos_del_test[0]}`);
  } else if (mayor) {
    out.push(`Este mes tu mayor gasto es ${mayor}. Puedo ayudarte a revisarlo.`);
  } else {
    out.push('Para ayudarte con cifras necesito conocer un poco tu mes. Cuéntame cuánto recibiste y en qué gastaste; puedes escribirlo como «gasté 50 en comida».');
  }
  const pregunta = { deuda: '¿Quieres que veamos cuál pagar primero?', ahorro: '¿Para qué te gustaría ahorrar?', ingreso: '¿Qué sabes hacer que otra persona podría necesitar?', gasto: '¿Qué gasto te costaría menos bajar?' }[tema];
  if (pregunta) out.push(pregunta);
  return out.join(' ').replace(/\.\s*\./g, '.');
}

const sinIA = (texto) => Object.values(SUGERIDAS).some((s) => normalizar(s) === normalizar(texto));

module.exports = { SUGERIDAS, sinIA, hechos, memoria, respaldo, hayEmocion };
