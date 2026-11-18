'use strict';
// Capa asíncrona del Coach v2: resuelve primero lo que necesita IA (clasificar/extraer automáticos, «Preguntarle a la IA»
// y «Explícamelo mejor») y luego entrega el resultado al pipeline síncrono de respuesta.js dentro de una transacción.
// La IA solo ayuda a entender o a redactar: las cifras las calculan siempre las reglas y toda salida se valida.
const db = require('../../db');
const log = require('../../lib/log');
const money = require('../../lib/money');
const tracker = require('../tracker');
const { getSetting } = require('../../lib/services');
const parser = require('./parser');
const { INTENCIONES } = require('./datos');
const { FORMATOS } = require('./mensajes');
const base = require('./insights/base');
const router = require('./ia/router');
const limites = require('./ia/limites');
const { responder } = require('./respuesta');

const today = () => new Date().toISOString().slice(0, 10);
const MIN_CONFIANZA = 0.7;

/** Disponibilidad y cupo de IA para ofrecer el botón (sin llamar a ningún modelo). */
function estadoIA(userId) {
  const disponible = router.disponible();
  const u = limites.estado(userId);
  const lim = limites.permiteExplicita(userId);
  return { disponible, limiteAlcanzado: disponible && !lim.ok, usadas: u.consultas_usadas, limite: u.consultas_limite };
}

/** Hechos del mes para el consejo: solo cifras ya calculadas, nunca correo, nombre ni notas. */
function hechosConsejo(userId, hoy) {
  const c = base.contexto(userId, { hoy });
  const f = (v) => money.format(v, c.cur);
  const hechos = { mes: c.month, ingresos: f(c.I.toFixed(2)), gastos: f(c.G.toFixed(2)), saldo: f(c.B.toFixed(2)), dias_restantes: c.N - c.d, movimientos_del_mes: c.n };
  const top = c.gastoPorCategoria[0];
  if (top) Object.assign(hechos, { mayor_categoria: top.etiqueta, mayor_categoria_monto: f(top.monto), mayor_categoria_pct: top.pct_del_total === null ? undefined : `${Math.round(top.pct_del_total)} %` });
  const deudas = tracker.debts(userId).filter((d) => Number(d.balance) > 0);
  if (deudas.length) Object.assign(hechos, { deudas_activas: deudas.length, deudas_saldo_total: f(deudas.reduce((a, d) => a + Number(d.balance), 0).toFixed(2)) });
  return hechos;
}

/** Variables de un mensaje del catálogo → pares legibles («monto»: «Bs 250,00») según el tipo declarado de cada variable. */
function formatearHechos(intencion, vars, cur) {
  const def = INTENCIONES[intencion];
  const out = {};
  for (const [k, v] of Object.entries(vars || {})) {
    const tipo = String((def && def.vars[k]) || 'texto').replace('?', '');
    if (v === null || v === undefined || tipo === 'bool' || tipo === 'lista') continue;
    try {
      out[k] = tipo === 'moneda' ? money.format(v, cur) : FORMATOS[tipo] ? FORMATOS[tipo](v, { moneda: cur }) : String(v);
    } catch {
      out[k] = String(v);
    }
  }
  return out;
}

const tonoDe = (userId) => {
  const prefs = db.parse(db.value('SELECT coach_prefs_json FROM users WHERE id = ?', userId), {});
  return ['cercano', 'neutral', 'motivador', 'directo'].includes(prefs && prefs.tono) ? prefs.tono : 'cercano';
};

/** Botones «Preguntarle a la IA» (consejo) y «Explícamelo mejor» (redactar). */
async function resolverBoton(userId, sol, hoy) {
  const origen = sol.mensaje_id ? db.one("SELECT id, conversation_id, intent, payload_json FROM messages WHERE id = ? AND user_id = ? AND role = 'coach'", Number(sol.mensaje_id), userId) : null;
  if (!origen) return { ok: false, motivo: 'IA_NO_DISPONIBLE' };
  if (sol.accion === 'pedir_ia') {
    const pregunta = db.value("SELECT content FROM messages WHERE conversation_id = ? AND user_id = ? AND role = 'usuario' AND id < ? ORDER BY id DESC LIMIT 1", origen.conversation_id, userId, origen.id) || '';
    const r = await router.ejecutar({ userId, tarea: 'consejo', texto: pregunta, hechos: hechosConsejo(userId, hoy), tema: 'consejo', tono: tonoDe(userId), hoy });
    return { ...r, tarea: 'consejo', texto: r.datos && r.datos.texto };
  }
  const payload = db.parse(origen.payload_json, {}) || {};
  const cur = tracker.baseCurrency(userId);
  const hechos = formatearHechos(origen.intent, payload.vars, cur);
  const def = INTENCIONES[origen.intent];
  const r = await router.ejecutar({ userId, tarea: 'redactar', hechos, tema: (def && def.descripcion) || origen.intent, tono: tonoDe(userId), hoy });
  return { ...r, tarea: 'redactar', texto: r.datos && r.datos.texto };
}

/** Texto que el parser no entendió: clasificar (y extraer si es un registro) con la IA barata, con tope diario. */
async function resolverAutomatica(userId, texto, hoy) {
  if (!router.disponible() || getSetting('coach_v2_ia_automatica') !== true) return null;
  const cur = tracker.baseCurrency(userId);
  const r = parser.parsear(texto, { hoy: hoy || today(), moneda: cur });
  if (r.respuesta !== 'no_entendi') return null; // las reglas entendieron, o es una pregunta abierta que se ofrece como consejo
  const k = await router.ejecutar({ userId, tarea: 'clasificar', texto, hoy });
  if (!k.ok || k.datos.confianza < MIN_CONFIANZA || ['fuera_de_alcance', 'consulta_abierta'].includes(k.datos.intencion)) return null;
  const runIds = [k.runId].filter(Boolean);
  if (String(k.datos.intencion).startsWith('registrar_')) {
    const e = await router.ejecutar({ userId, tarea: 'extraer', texto, hoy });
    if (!e.ok || e.datos.confianza < MIN_CONFIANZA || !e.datos.entidades.tipo || !e.datos.entidades.importe) return null;
    if (e.runId) runIds.push(e.runId);
    return { clasificacion: k.datos, extraccion: e.datos, runIds };
  }
  return { clasificacion: k.datos, extraccion: null, runIds };
}

/** Punto de entrada asíncrono: igual que `responder`, pero primero resuelve lo que necesita IA. */
async function responderConIA(userId, sol, { hoy } = {}) {
  const opts = { hoy, ia: null, iaEstado: estadoIA(userId) };
  try {
    if (sol.accion === 'pedir_ia' || sol.accion === 'pedir_redaccion') opts.ia = await resolverBoton(userId, sol, hoy);
    else if (!sol.accion && sol.texto) opts.ia = await resolverAutomatica(userId, String(sol.texto).trim().slice(0, 500), hoy);
  } catch (e) {
    log.error('IA del Coach: falló la resolución previa', { motivo: String(e && e.message).slice(0, 120) });
    opts.ia = sol.accion ? { ok: false, motivo: 'IA_NO_DISPONIBLE' } : null; // las reglas siguen funcionando
  }
  return db.tx(() => responder(userId, sol, opts));
}

module.exports = { responderConIA, estadoIA, hechosConsejo, formatearHechos };
