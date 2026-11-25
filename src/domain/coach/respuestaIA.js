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
const conversacion = require('./conversacion');
const coach = require('../coach');
const I = require('./intenciones');
const router = require('./ia/router');
const limites = require('./ia/limites');
const { responder, esperaDato } = require('./respuesta');

const today = () => new Date().toISOString().slice(0, 10);
const MIN_CONFIANZA = 0.7;

/** Disponibilidad y cupo de IA para ofrecer el botón (sin llamar a ningún modelo). */
function estadoIA(userId) {
  const disponible = router.disponible();
  const u = limites.estado(userId);
  const lim = limites.permiteExplicita(userId);
  return { disponible, limiteAlcanzado: disponible && !lim.ok, usadas: u.consultas_usadas, limite: u.consultas_limite };
}

/** Hechos para el consejo: el mes, el diagnóstico, el plan, las metas y las deudas; nunca correo, nombre ni notas. */
const hechosConsejo = (userId, hoy) => conversacion.hechos(userId, hoy);

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
    const previa = db.one("SELECT id, content FROM messages WHERE conversation_id = ? AND user_id = ? AND role = 'usuario' AND id < ? ORDER BY id DESC LIMIT 1", origen.conversation_id, userId, origen.id);
    const pregunta = previa ? previa.content : '';
    const historial = previa ? conversacion.memoria(userId, origen.conversation_id, previa.id) : [];
    const r = await router.ejecutar({ userId, tarea: 'consejo', texto: pregunta, hechos: hechosConsejo(userId, hoy), tema: 'consejo', tono: tonoDe(userId), historial, hoy });
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

// Cuando una frase larga cae en una regla que no tiene nada útil que decir («no tienes tareas»), conviene conversar.
const FLOJAS = new Set(['no_entendi', 'sin_tareas', 'sin_plan', 'pocos_datos']);
function reglaFloja(userId, texto, r, hoy) {
  if (texto.split(/\s+/).length < 6 || !I.HANDLERS[r.respuesta]) return false;
  const c = I.contexto(userId, { hoy, texto });
  c.ent = r.entidades;
  const out = I.HANDLERS[r.respuesta](c) || {};
  // Con una pregunta más amplia, «siguiente paso» tampoco debe tapar lo que de verdad preguntó.
  return FLOJAS.has(out.intencion) || (r.respuesta === 'siguiente_paso' && texto.split(/\s+/).length >= 8);
}

/**
 * Pregunta abierta: se responde directamente. Si la IA no está, falla o se agotó el cupo, queda el consejo calculado
 * por reglas: la persona nunca recibe solo un mensaje de error.
 */
async function resolverConsejo(userId, texto, hoy) {
  if (getSetting('coach_v2_ia_directa') !== true || esperaDato(userId, texto)) return null;
  const r = parser.parsear(texto, { hoy: hoy || today(), moneda: tracker.baseCurrency(userId) });
  const abierta = r.respuesta === 'ia_ofrecer' || (r.respuesta === 'no_entendi' && texto.split(/\s+/).length >= 4);
  if (!abierta && !reglaFloja(userId, texto, r, hoy)) return null;
  const respaldo = conversacion.respaldo(userId, texto, hoy);
  if (conversacion.sinIA(texto)) return { ok: false, motivo: 'REGLAS', respaldo };
  if (!router.disponible()) return { ok: false, motivo: 'IA_NO_DISPONIBLE', respaldo };
  const k = await router.ejecutar({ userId, tarea: 'consejo', texto, hechos: hechosConsejo(userId, hoy), tema: 'consejo', tono: tonoDe(userId), historial: conversacion.memoria(userId, coach.conversation(userId).id), hoy });
  return { ...k, tarea: 'consejo', texto: k.datos && k.datos.texto, respaldo };
}

/** Punto de entrada asíncrono: igual que `responder`, pero primero resuelve lo que necesita IA. */
async function responderConIA(userId, sol, { hoy } = {}) {
  const opts = { hoy, ia: null, consejo: null, iaEstado: estadoIA(userId) };
  try {
    if (sol.accion === 'pedir_ia' || sol.accion === 'pedir_redaccion') opts.ia = await resolverBoton(userId, sol, hoy);
    else if (!sol.accion && sol.texto) {
      const texto = String(sol.texto).trim().slice(0, 500);
      opts.ia = await resolverAutomatica(userId, texto, hoy);
      if (!opts.ia) opts.consejo = await resolverConsejo(userId, texto, hoy);
    }
  } catch (e) {
    log.error('IA del Coach: falló la resolución previa', { motivo: String(e && e.message).slice(0, 120) });
    opts.ia = sol.accion ? { ok: false, motivo: 'IA_NO_DISPONIBLE' } : null; // las reglas siguen funcionando
  }
  return db.tx(() => responder(userId, sol, opts));
}

module.exports = { responderConIA, estadoIA, hechosConsejo, formatearHechos };
