'use strict';
// Enrutador de IA del Coach v2 (docs/coach-v2/03 §1 y 02 §2). Cuatro tareas, cada una con su modelo, su prefijo fijo
// cacheable, su esquema de salida, su tope de tokens y su validación:
//   clasificar  (Haiku)  · automática cuando el parser duda · JSON estricto
//   extraer     (Haiku)  · automática en un registro dudoso · JSON estricto
//   redactar    (Haiku)  · solo con el botón «Explícamelo mejor» · texto validado contra los hechos
//   consejo     (Sonnet) · solo con el botón «Preguntarle a la IA» · texto validado contra los hechos
// Todo es opcional: si la IA no está disponible, se agotó un límite o la salida no pasa la validación, el Coach
// responde con reglas y plantillas del catálogo (nunca se rompe).
const config = require('../../../config');
const log = require('../../../lib/log');
const { getSetting } = require('../../../lib/services');
const ai = require('../../ai/provider');
const { PREFIJOS } = require('./prefijos');
const validar = require('./validar');
const limites = require('./limites');
const cache = require('./cache');
const adaptadores = require('./adaptadores');

const TAREAS = {
  clasificar: { automatica: true, maxTokens: 60, esquema: { type: 'object', additionalProperties: false, required: ['intencion', 'confianza', 'categoria_consultada'], properties: { intencion: { type: 'string' }, confianza: { type: 'number' }, categoria_consultada: { type: ['string', 'null'] } } } },
  extraer: { automatica: true, maxTokens: 120, esquema: { type: 'object', additionalProperties: false, required: ['entidades', 'confianza'], properties: { entidades: { type: 'object', additionalProperties: false, required: ['tipo', 'importe', 'categoria', 'subcategoria', 'fecha', 'nota', 'recurrente'], properties: { tipo: { type: ['string', 'null'], enum: ['ingreso', 'gasto', 'pago_deuda', 'ahorro', 'retiro_ahorro', null] }, importe: { type: ['string', 'null'] }, categoria: { type: ['string', 'null'] }, subcategoria: { type: ['string', 'null'] }, fecha: { type: ['string', 'null'] }, nota: { type: ['string', 'null'] }, recurrente: { type: 'boolean' } } }, confianza: { type: 'number' } } } },
  redactar: { automatica: false, maxTokens: 220, cacheable: true, esquema: { type: 'object', additionalProperties: false, required: ['texto'], properties: { texto: { type: 'string' } } } },
  consejo: { automatica: false, maxTokens: 320, cacheable: true, esquema: { type: 'object', additionalProperties: false, required: ['texto'], properties: { texto: { type: 'string' } } } },
};

/** ¿Hay un proveedor real? En desarrollo y pruebas se usa el adaptador local; en producción sin clave no hay IA. */
function proveedorActual() {
  const p = config.ai.coachProvider;
  if (p === 'openai' && config.ai.openai.apiKey) return 'openai';
  if (p === 'anthropic' && ai.providerName() === 'anthropic') return 'anthropic';
  return 'local';
}

function disponible() {
  return proveedorActual() !== 'local' || !config.isProd;
}

/** Lo que viaja a la IA: solo texto de la persona (≤ 500 caracteres, dentro de etiquetas) o hechos permitidos. */
function armarVariable(tarea, { texto, hechos, tema, tono, hoy, historial = [], aviso = null }) {
  if (tarea === 'clasificar') return `<mensaje>${validar.limpiarTexto(texto)}</mensaje>`;
  if (tarea === 'extraer') return `<mensaje>${validar.limpiarTexto(texto)}</mensaje>\n<hoy>${hoy || new Date().toISOString().slice(0, 10)}</hoy>`;
  if (tarea === 'redactar') {
    const seguros = validar.hechosSeguros(hechos);
    return JSON.stringify({ tema: String(tema || '').slice(0, 80), hechos: Object.entries(seguros).slice(0, 12).map(([clave, valor]) => ({ clave, valor: String(valor) })), tono: tono || 'cercano', longitud_maxima_palabras: 80 });
  }
  const out = { pregunta: validar.limpiarTexto(texto), hechos: validar.hechosSeguros(hechos) };
  if (historial.length) out.conversacion = historial.map((m) => ({ de: m.de === 'coach' ? 'coach' : 'persona', texto: validar.limpiarTexto(m.texto).slice(0, 160) }));
  if (aviso) out.aviso = aviso;
  return JSON.stringify(out);
}

const razon = (motivo) => ({ ok: false, motivo });

/**
 * Ejecuta una tarea de IA. Devuelve { ok: true, datos, origen: 'ia'|'cache', runId? } o { ok: false, motivo }.
 * motivos: IA_NO_DISPONIBLE · AUTOMATICA_APAGADA · LIMITE_MENSUAL · LIMITE_DIARIO · LIMITE_GLOBAL · CORTE_GASTO · SALIDA_INVALIDA
 */
async function ejecutar({ userId, tarea, texto = '', hechos = {}, tema = '', tono = 'cercano', hoy, historial = [], aviso = null, proveedor = null }) {
  const def = TAREAS[tarea];
  if (!def) throw new Error(`Tarea de IA desconocida: ${tarea}`);
  if (!disponible()) return razon('IA_NO_DISPONIBLE');
  if (def.automatica && getSetting('coach_v2_ia_automatica') !== true) return razon('AUTOMATICA_APAGADA');
  const prefijo = PREFIJOS[tarea];
  const variable = armarVariable(tarea, { texto, hechos, tema, tono, hoy, historial, aviso });
  const key = def.cacheable ? cache.clave(userId, tarea, texto || tema, historial.length ? { hechos, historial } : hechos, prefijo.version) : null;
  // Una respuesta ya guardada no cuesta nada: se entrega aunque el cupo de llamadas reales se haya agotado.
  if (key) {
    const guardado = cache.leer(key);
    if (guardado) return { ok: true, datos: guardado, origen: 'cache' };
  }
  const lim = def.automatica ? limites.permiteAutomatica(userId) : limites.permiteExplicita(userId);
  if (!lim.ok) return { ok: false, motivo: lim.motivo, limite: lim.limite };

  const nombre = proveedorActual();
  const real = nombre !== 'local';
  const modelo = nombre === 'openai' ? config.ai.coachOpenaiModels[tarea] : nombre === 'anthropic' ? config.ai.coachModels[tarea] : 'local';
  const t0 = Date.now();
  let r;
  try {
    r = await (proveedor || adaptadores[nombre])({ tarea, modelo, prefijo, variable, esquema: def.esquema, maxTokens: def.maxTokens, ttl: config.ai.cacheTtl, cliente: ai.anthropic });
  } catch (e) {
    ai.record({ userId, purpose: `coach_${tarea}`, task: tarea, provider: nombre, model: modelo, promptVersion: prefijo.version, input: { omitido: 'error del proveedor' }, output: null, status: 'error', errorCode: 'error_proveedor', latency: Date.now() - t0 });
    log.warn('IA del Coach no disponible', { tarea, motivo: String(e && e.message).slice(0, 120) });
    return razon('IA_NO_DISPONIBLE');
  }

  let salida = null;
  try {
    salida = JSON.parse(r.texto);
  } catch {
    salida = null;
  }
  const v = tarea === 'clasificar' ? validar.clasificar(salida) : tarea === 'extraer' ? validar.extraer(salida) : validar.texto(salida, tarea === 'consejo' ? { hechos, dicho: [validar.limpiarTexto(texto), ...historial.map((m) => m.texto)] } : hechos, { maxPalabras: 120 });
  // La llamada ocurrió (y costó): se registra siempre, también cuando la salida se descarta.
  const runId = ai.record({
    userId,
    purpose: `coach_${tarea}`,
    task: tarea,
    provider: nombre,
    model: r.modelo,
    promptVersion: prefijo.version,
    input: { variable },
    output: v.ok ? r.texto : null,
    status: 'ok',
    errorCode: v.ok ? null : `salida_descartada:${v.motivo}`,
    inTok: r.uso.entrada,
    outTok: r.uso.salida,
    cacheRead: r.uso.cacheLectura,
    cacheWrite: r.uso.cacheEscritura,
    ttl: config.ai.cacheTtl,
    latency: Date.now() - t0,
  });
  // Un consejo descartado se pide una sola vez más, diciendo qué falló (por ejemplo, una cifra que no estaba en los hechos).
  if (!v.ok && tarea === 'consejo' && !aviso) {
    const otra = await ejecutar({ userId, tarea, texto, hechos, tema, tono, hoy, historial, proveedor, aviso: `Tu respuesta anterior se descartó (${v.motivo}). Usa solo cifras que aparezcan en hechos o en la conversación, menos de 100 palabras y sin términos prohibidos.` });
    if (otra.ok) return otra;
  }
  if (!v.ok) return { ok: false, motivo: 'SALIDA_INVALIDA', detalle: v.motivo, runId };
  if (key) cache.guardar(userId, tarea, key, v.datos);
  return { ok: true, datos: v.datos, origen: 'ia', runId };
}

module.exports = { ejecutar, disponible, proveedorActual, TAREAS, armarVariable };
