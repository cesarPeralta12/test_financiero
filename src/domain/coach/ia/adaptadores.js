'use strict';
// Adaptadores de IA del Coach con la misma interfaz: llamar({ tarea, modelo, prefijo, variable, esquema, maxTokens, ttl })
// → { texto, uso: { entrada, salida, cacheLectura, cacheEscritura }, modelo }.
//  · anthropic: la parte fija va en `system` con un punto de corte explícito de caché; lo variable, al final.
//  · local: simulación determinista para desarrollo y pruebas (sin red, sin costo). Imita la contabilidad de caché
//    (la primera llamada con un prefijo escribe, las siguientes leen) para poder probar costos y alarmas.
const parser = require('../parser');
const { diccionario } = require('../datos');
const { tokens } = require('./prefijos');

// ───────── Anthropic ─────────
// Interfaz verificada solo contra la documentación; la llamada real no se pudo probar en esta sesión (sin clave).
async function anthropic({ modelo, prefijo, variable, esquema, maxTokens, ttl, cliente }) {
  const params = {
    model: modelo,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: prefijo.texto, cache_control: { type: 'ephemeral', ttl } }],
    messages: [{ role: 'user', content: variable }],
  };
  if (esquema) params.output_config = { format: { type: 'json_schema', schema: esquema } };
  const msg = await cliente().messages.create(params);
  const u = msg.usage || {};
  return {
    texto: (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(),
    uso: { entrada: u.input_tokens || 0, salida: u.output_tokens || 0, cacheLectura: u.cache_read_input_tokens || 0, cacheEscritura: u.cache_creation_input_tokens || 0 },
    modelo: msg.model || modelo,
    parada: msg.stop_reason,
  };
}

// ───────── OpenAI ─────────
// Chat Completions con salida estructurada estricta. La caché de OpenAI es automática: exige un prefijo idéntico de
// al menos 1.024 tokens (los de redactar y consejo son más cortos y no se benefician). Verificado solo contra el
// cliente existente y la documentación; no se pudo probar una llamada real sin clave.
async function openai({ tarea, modelo, prefijo, variable, esquema, maxTokens }) {
  const config = require('../../../config');
  const { chat } = require('../../ai/openai');
  const { forStrictApi } = require('../../../lib/jsonschema');
  const o = config.ai.openai;
  const r = await chat({
    system: prefijo.texto,
    user: variable,
    apiKey: o.apiKey,
    model: modelo,
    baseUrl: o.baseUrl,
    timeoutMs: o.timeoutMs,
    schema: forStrictApi(esquema),
    schemaName: `coach_${tarea}`,
    temperature: o.temperature,
    reasoningEffort: o.reasoningEffort,
    maxTokens,
  });
  const u = r.usage || {};
  const cacheada = (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0;
  return {
    texto: JSON.stringify(r.json),
    uso: { entrada: Math.max(0, (u.prompt_tokens || 0) - cacheada), salida: u.completion_tokens || 0, cacheLectura: cacheada, cacheEscritura: 0 },
    modelo: r.model || modelo,
    parada: 'stop',
  };
}

// ───────── Local ─────────
const vistos = new Set(); // prefijos «calientes» (simula la caché del proveedor)
const LISTA = Object.entries(diccionario.sinonimos_de_intencion).filter(([, v]) => Array.isArray(v));

function pesoPalabras(texto, frase) {
  const t = new Set(texto.split(' '));
  const f = frase.split(' ').filter((w) => w.length > 3);
  return f.length ? f.filter((w) => t.has(w)).length / f.length : 0;
}

function simularClasificar(variable) {
  const m = /<mensaje>([\s\S]*?)<\/mensaje>/.exec(variable);
  const texto = require('../normalizar').normalizar(m ? m[1] : variable);
  let mejor = { intencion: 'fuera_de_alcance', p: 0 };
  for (const [intencion, frases] of LISTA) for (const f of frases) {
    const p = pesoPalabras(texto, f);
    if (p > mejor.p || (p === mejor.p && p > 0 && f.length > (mejor.largo || 0))) mejor = { intencion, p, largo: f.length };
  }
  const cat = mejor.intencion === 'gasto_categoria' ? (parser.parsear(texto, { hoy: '2026-01-01', moneda: 'USD' }).entidades.categoria || null) : null;
  return JSON.stringify({ intencion: mejor.p >= 0.6 ? mejor.intencion : 'fuera_de_alcance', confianza: mejor.p >= 0.6 ? Math.min(0.95, 0.55 + mejor.p * 0.4) : 0.3, categoria_consultada: cat });
}

function simularExtraer(variable) {
  const m = /<mensaje>([\s\S]*?)<\/mensaje>/.exec(variable);
  const h = /<hoy>([\s\S]*?)<\/hoy>/.exec(variable);
  const r = parser.parsear(m ? m[1] : variable, { hoy: h ? h[1] : new Date().toISOString().slice(0, 10), moneda: 'USD' });
  const e = r.entidades;
  return JSON.stringify({ entidades: { tipo: e.tipo, importe: e.importe, categoria: e.categoria, subcategoria: e.subcategoria, fecha: e.fecha, nota: e.nota, recurrente: Boolean(e.recurrente) }, confianza: e.importe && e.tipo ? 0.8 : 0.4 });
}

function simularRedactar(variable) {
  const v = JSON.parse(variable);
  const hechos = (v.hechos || []).map((x) => `${String(x.clave).replace(/_/g, ' ')}: ${x.valor}`).join('; ');
  return JSON.stringify({ texto: `${v.tema}. ${hechos}.` });
}

function simularConsejo(variable) {
  const v = JSON.parse(variable);
  const h = v.hechos || {};
  const partes = [];
  if (h.saldo !== undefined) partes.push(`este mes te quedan ${h.saldo}`);
  if (h.dias_restantes !== undefined) partes.push(`y faltan ${h.dias_restantes} días`);
  if (h.mayor_categoria) partes.push(`tu mayor gasto es ${h.mayor_categoria}`);
  return JSON.stringify({ texto: `Con tus datos${partes.length ? `, ${partes.join(' ')}` : ''}. Es una orientación general, no una recomendación personal: la decisión es tuya y puedes revisarla con calma.` });
}

async function local({ tarea, prefijo, variable }) {
  const salidas = { clasificar: simularClasificar, extraer: simularExtraer, redactar: simularRedactar, consejo: simularConsejo };
  const texto = salidas[tarea](variable);
  const fijo = prefijo.tokens;
  const caliente = vistos.has(prefijo.version);
  vistos.add(prefijo.version);
  return {
    texto,
    uso: { entrada: tokens(variable), salida: tokens(texto), cacheLectura: caliente ? fijo : 0, cacheEscritura: caliente ? 0 : fijo },
    modelo: 'local',
    parada: 'end_turn',
  };
}

/** Solo para pruebas: olvida los prefijos calientes del adaptador local. */
function reiniciarLocal() {
  vistos.clear();
}

module.exports = { anthropic, openai, local, reiniciarLocal };
