'use strict';
// Proveedor de IA mediante API. El servidor calcula las cifras; la IA solo
// explica y propone acciones con esos resultados. Cada llamada queda registrada
// (modelo, versión de instrucciones, entrada, tokens y costo estimado) y se
// aplican límites por cuenta y un límite global de gasto mensual.
const db = require('../../db');
const config = require('../../config');
const log = require('../../lib/log');
const { getSetting } = require('../../lib/services');

// Precio por millón de tokens (USD), entrada / salida. Ver docs/DECISIONES.md.
const PRICING = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-fable-5-1': [10, 50],
  local: [0, 0],
};

class AiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

function monthlySpendMicros() {
  return db.value("SELECT COALESCE(SUM(cost_micros), 0) FROM ai_runs WHERE created_at >= ? AND status = 'ok'", monthStart()) || 0;
}

function userMonthlyCount(userId, purpose) {
  return db.value("SELECT COUNT(*) FROM ai_runs WHERE user_id = ? AND purpose = ? AND status = 'ok' AND created_at >= ?", userId, purpose, monthStart()) || 0;
}

function userLimit(userId, purpose) {
  if (purpose === 'coach') {
    const override = db.value('SELECT ai_monthly_limit FROM users WHERE id = ?', userId);
    return override ?? getSetting('ai_coach_monthly_limit');
  }
  return getSetting('ai_plan_monthly_limit');
}

/** Comprueba los límites antes de llamar. Lanza AiError('limite_cuenta' | 'limite_global'). */
function checkLimits(userId, purpose) {
  const budgetMicros = Math.round(Number(getSetting('ai_global_monthly_budget_usd')) * 1e6);
  if (monthlySpendMicros() >= budgetMicros) throw new AiError('limite_global', 'Se alcanzó el límite global de uso de IA de este mes.');
  if (userId && userMonthlyCount(userId, purpose) >= userLimit(userId, purpose)) {
    throw new AiError('limite_cuenta', 'Alcanzaste el límite mensual de uso de IA de tu cuenta.');
  }
}

function usage(userId, purpose) {
  return { used: userMonthlyCount(userId, purpose), limit: userLimit(userId, purpose) };
}

function record({ userId, purpose, provider, model, promptVersion, input, output, status, errorCode = null, inTok = 0, outTok = 0, latency = null }) {
  const [pi, po] = PRICING[model] || PRICING['claude-opus-5-5'];
  const cost = Math.round(inTok * pi + outTok * po); // micro-dólares
  const r = db.run(
    `INSERT INTO ai_runs (user_id, purpose, provider, model, prompt_version, input_json, output_text, status, error_code, input_tokens, output_tokens, cost_micros, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    purpose,
    provider,
    model,
    promptVersion,
    JSON.stringify(input),
    output === null || output === undefined ? null : typeof output === 'string' ? output : JSON.stringify(output),
    status,
    errorCode,
    inTok,
    outTok,
    cost,
    latency,
    db.now()
  );
  return r.lastId;
}

let client = null;
function anthropic() {
  if (!client) {
    const Anthropic = require('@anthropic-ai/sdk');
    const C = Anthropic.default || Anthropic;
    client = new C({ apiKey: config.ai.apiKey, timeout: config.ai.timeoutMs, maxRetries: 2 });
  }
  return client;
}

function providerName() {
  return config.ai.provider === 'anthropic' && config.ai.apiKey ? 'anthropic' : 'local';
}

/**
 * Una llamada al modelo. `localFn` produce la respuesta del proveedor local de
 * desarrollo (sin red) con la misma forma: { content: [...bloques], stop_reason, usage }.
 */
async function call({ userId, purpose, promptVersion, system, messages, tools = null, outputSchema = null, effort = 'medium', maxTokens = 16000, input, localFn, skipLimits = false }) {
  if (!skipLimits) {
    try {
      checkLimits(userId, purpose);
    } catch (e) {
      record({ userId, purpose, provider: providerName(), model: providerName() === 'local' ? 'local' : config.ai.model, promptVersion, input: { omitido: 'límite alcanzado' }, output: null, status: 'limite', errorCode: e.code });
      throw e;
    }
  }
  const provider = providerName();
  const model = provider === 'local' ? 'local' : config.ai.model;
  const started = Date.now();
  if (!config.isProd && getSetting('ai_simulate_failure')) {
    record({ userId, purpose, provider, model, promptVersion, input, output: null, status: 'error', errorCode: 'error_simulado', latency: 0 });
    throw new AiError('proveedor_no_disponible', 'El proveedor de IA no respondió (fallo simulado desde el panel).');
  }
  try {
    let msg;
    if (provider === 'local') {
      msg = await localFn();
    } else {
      const params = {
        model,
        max_tokens: maxTokens,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages,
        output_config: { effort, ...(outputSchema ? { format: { type: 'json_schema', schema: outputSchema } } : {}) },
      };
      if (tools) params.tools = tools;
      msg = await anthropic().beta.messages.create(params);
    }
    const inTok = (msg.usage && msg.usage.input_tokens) || 0;
    const outTok = (msg.usage && msg.usage.output_tokens) || 0;
    if (msg.stop_reason === 'refusal') {
      record({ userId, purpose, provider, model: msg.model || model, promptVersion, input, output: null, status: 'error', errorCode: 'rechazo_del_modelo', inTok, outTok, latency: Date.now() - started });
      throw new AiError('rechazo', 'El modelo no pudo responder a esta solicitud.');
    }
    const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const runId = record({ userId, purpose, provider, model: msg.model || model, promptVersion, input, output: text || msg.content, status: 'ok', inTok, outTok, latency: Date.now() - started });
    return { message: msg, text, runId };
  } catch (e) {
    if (e instanceof AiError) throw e;
    const Anthropic = provider === 'anthropic' ? require('@anthropic-ai/sdk') : null;
    const C = Anthropic ? Anthropic.default || Anthropic : null;
    let code = 'error_proveedor';
    if (C && e instanceof C.RateLimitError) code = 'limite_proveedor';
    else if (C && e instanceof C.AuthenticationError) code = 'credencial_invalida';
    else if (C && e instanceof C.APIConnectionError) code = 'sin_conexion';
    else if (C && e instanceof C.APIError) code = `http_${e.status || 'desconocido'}`;
    record({ userId, purpose, provider, model, promptVersion, input, output: null, status: 'error', errorCode: code, latency: Date.now() - started });
    log.warn('Fallo del proveedor de IA', { code, purpose });
    throw new AiError('proveedor_no_disponible', 'El proveedor de IA no está disponible en este momento.');
  }
}

module.exports = { call, usage, checkLimits, monthlySpendMicros, AiError, PRICING, providerName, monthStart };
