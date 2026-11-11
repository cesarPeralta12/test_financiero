'use strict';
// Redacción del resultado gratuito. El backend ya calculó todo el contenido con
// reglas; aquí la IA (OpenAI) solo puede reescribir el resumen del perfil y las
// explicaciones de los hallazgos usando ese paquete. La salida se valida contra la
// estructura: mismos hallazgos, solo cifras ya autorizadas y sin promesas. Ante
// cualquier problema se conserva el texto de plantilla y el resultado queda listo.
const db = require('../../db');
const config = require('../../config');
const log = require('../../lib/log');
const queue = require('../../lib/queue');
const openai = require('../ai/openai');

const NARRATIVE_VERSION = 'NARR_AI_V1_ES';

// Esquema estricto de la salida (json_schema, strict: true).
const NARR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['profile_summary', 'findings'],
  properties: {
    profile_summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['candidate_id', 'explanation'],
        properties: { candidate_id: { type: 'string' }, explanation: { type: 'string' } },
      },
    },
  },
};
let client = null; // inyectable en pruebas: async (prompt) => objeto JSON

function setClient(fn) {
  client = fn || null;
}

function enabled() {
  return Boolean(client) || config.ai.openai.enabled;
}

function enqueue(resultId) {
  return queue.enqueue('free_narrative', { resultId }, { maxAttempts: 2 });
}

const words = (t) => String(t).trim().split(/\s+/).filter(Boolean).length;
const NUMBER_RE = /\d+(?:[.,]\d+)?/g;
const BANNED = /garantiz|garantía|prometemos|promesa|aseguramos|rentabilidad|vas a duplicar|probabilidad|https?:|www\.|\binvierte en\b/i;

function authorizedNumbers(result) {
  const pool = [result.profile.summary, ...result.findings.map((f) => `${f.title} ${f.explanation}`), ...result.metrics.map((m) => String(m.value))];
  if (result.goal && result.goal.independence) {
    const i = result.goal.independence;
    pool.push(JSON.stringify(i.age || ''), JSON.stringify(i.monthly_amount || ''));
  }
  if (result.goal && result.goal.income_goal) pool.push(JSON.stringify(result.goal.income_goal));
  return new Set(pool.join(' ').match(NUMBER_RE) || []);
}

/** Valida la salida del modelo. Devuelve { ok, reason }. */
function validateOutput(result, out) {
  if (!out || typeof out !== 'object') return { ok: false, reason: 'NOT_OBJECT' };
  if (typeof out.profile_summary !== 'string') return { ok: false, reason: 'NO_SUMMARY' };
  const w = words(out.profile_summary);
  if (result.profile.pending ? w < 10 || w > 90 : w < 50 || w > 90) return { ok: false, reason: 'SUMMARY_LENGTH' };
  if (!Array.isArray(out.findings)) return { ok: false, reason: 'NO_FINDINGS' };
  const expected = result.findings.map((f) => f.candidate_id).sort();
  const got = out.findings.map((f) => f && f.candidate_id).sort();
  if (JSON.stringify(expected) !== JSON.stringify(got)) return { ok: false, reason: 'FINDINGS_MISMATCH' };
  const texts = [out.profile_summary];
  for (const f of out.findings) {
    if (typeof f.explanation !== 'string' || f.explanation.length < 20 || f.explanation.length > 500) return { ok: false, reason: 'FINDING_LENGTH' };
    texts.push(f.explanation);
  }
  const allowed = authorizedNumbers(result);
  for (const t of texts) {
    if (BANNED.test(t)) return { ok: false, reason: 'BANNED_TERM' };
    for (const n of t.match(NUMBER_RE) || []) if (!allowed.has(n)) return { ok: false, reason: 'UNAUTHORIZED_NUMBER' };
  }
  return { ok: true };
}

function buildPrompt(result) {
  const system = [
    'Eres redactor de un diagnóstico financiero preliminar en español neutro, tono respetuoso y claro.',
    'Reescribe el resumen del perfil y las explicaciones de los hallazgos usando EXCLUSIVAMENTE los datos del paquete.',
    'No inventes datos, importes, saldos, tasas, plazos ni entidades. No prometas resultados ni recomiendes productos financieros.',
    'No uses cifras que no aparezcan en el paquete. Lo desconocido se llama «sin verificar», nunca cero.',
    'El resumen debe tener entre 50 y 90 palabras (si el perfil está pendiente, entre 10 y 90).',
    'Responde solo con JSON: {"profile_summary": string, "findings": [{"candidate_id": string, "explanation": string}]}.',
  ].join(' ');
  const user = JSON.stringify({
    perfil: { titulo: result.profile.title, resumen_base: result.profile.summary, pendiente: result.profile.pending },
    hallazgos: result.findings.map((f) => ({ candidate_id: f.candidate_id, titulo: f.title, explicacion_base: f.explanation })),
    meta: result.goal
      ? {
          independencia: result.goal.independence ? { edad: result.goal.independence.age, monto_mensual: result.goal.independence.monthly_amount } : null,
          ingreso: result.goal.income_goal ? { tipo: result.goal.income_goal.kind, etiqueta: result.goal.income_goal.label || null, monto: result.goal.income_goal.amount || null, moneda: result.goal.income_goal.currency || null } : null,
        }
      : null,
    cobertura: result.coverage.label,
  });
  return { system, user };
}

/** Devuelve { json, usage, latencyMs, model }. El cliente de pruebas devuelve solo el JSON. */
async function callModel(prompt) {
  if (client) return { json: await client(prompt), usage: null, latencyMs: null, model: 'cliente_de_prueba' };
  return openai.chat({ ...prompt, ...config.ai.openai, schema: NARR_SCHEMA, schemaName: 'redaccion_resultado' });
}

/** Metadatos operativos (sin contenido del usuario). */
function usageMeta(call) {
  if (!call) return null;
  const u = call.usage || {};
  return { model: call.model, latency_ms: call.latencyMs, input_tokens: u.prompt_tokens ?? null, output_tokens: u.completion_tokens ?? null };
}

function finish(row, result, source, meta = null, reason = null) {
  result.status = 'ready';
  result.narrative_source = source;
  const promptVersion = source === 'ai' ? NARRATIVE_VERSION : null;
  const model = source === 'ai' ? (meta && meta.model) || config.ai.openai.model : null;
  if (source === 'ai') result.narrative_version = NARRATIVE_VERSION;
  if (result.traceability) Object.assign(result.traceability, { prompt_version: promptVersion, model, ai_usage: meta, ai_fallback_reason: reason });
  log.info('Redacción del resultado gratuito', { result: row.id, source, reason, ...(meta || {}) });
  db.run(
    "UPDATE ft_results SET status = 'ready', narrative_source = ?, result_json = ?, prompt_version = ?, model = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
    source,
    JSON.stringify(result),
    promptVersion,
    model,
    db.now(),
    row.id
  );
}

/** Manejador de cola: pide la redacción y la valida; ante fallos usa la plantilla. */
async function handle({ resultId }, job) {
  const row = db.one('SELECT * FROM ft_results WHERE id = ?', resultId);
  if (!row || row.status !== 'pending') return;
  const result = db.parse(row.result_json);
  let out;
  let meta = null;
  try {
    const call = await callModel(buildPrompt(result));
    out = call.json;
    meta = usageMeta(call);
  } catch (err) {
    if (job && job.attempts < job.max_attempts) throw err; // reintento con espera
    log.warn('IA no disponible para el resultado gratuito; se usa la plantilla', { result: resultId, error: String(err.message).slice(0, 120) });
    return finish(row, result, 'template', null, 'PROVIDER_ERROR');
  }
  const check = validateOutput(result, out);
  if (!check.ok) {
    log.warn('Salida de IA rechazada; se usa la plantilla', { result: resultId, reason: check.reason });
    return finish(row, result, 'template', meta, check.reason);
  }
  result.profile.summary = out.profile_summary.trim();
  const byId = Object.fromEntries(out.findings.map((f) => [f.candidate_id, f.explanation.trim()]));
  for (const f of result.findings) f.explanation = byId[f.candidate_id];
  finish(row, result, 'ai', meta);
}

queue.register('free_narrative', handle);

module.exports = { enabled, enqueue, setClient, validateOutput, buildPrompt, handle, NARRATIVE_VERSION };
