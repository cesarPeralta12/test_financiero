'use strict';
// Cliente mínimo de OpenAI (Chat Completions con salida JSON) por fetch. No añade
// dependencias. Nunca se registran las respuestas del usuario en los logs.
//
// Compatibilidad con gpt-6-luna (probado el 11-11-2026): el modelo rechaza
// `temperature` distinto de 1 (error 400 unsupported_value), por eso solo se envía
// si se configura explícitamente. Con `schema` se usa salida estructurada estricta
// (`json_schema`, strict: true); sin él, el modo JSON simple.

/**
 * Llama al modelo y devuelve { json, usage, latencyMs, model }.
 * { system, user, apiKey, model, baseUrl, timeoutMs, schema, schemaName, temperature, reasoningEffort, fetchImpl }
 */
async function chat({ system, user, apiKey, model, baseUrl = 'https://api.openai.com/v1', timeoutMs = 20000, schema = null, schemaName = 'respuesta', temperature = null, reasoningEffort = null, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('Falta OPENAI_API_KEY.');
  const body = {
    model,
    response_format: schema ? { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } } : { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  if (temperature !== null && temperature !== undefined) body.temperature = temperature;
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // Solo el código y el parámetro del error; nunca el contenido enviado.
      let detail = '';
      try {
        const e = (await res.json()).error || {};
        detail = [e.code, e.param].filter(Boolean).join(' ');
      } catch (_) {
        /* sin cuerpo */
      }
      throw new Error(`OpenAI respondió ${res.status}${detail ? ` (${detail})` : ''}`);
    }
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('Respuesta vacía de OpenAI');
    return { json: JSON.parse(content), usage: data.usage || null, latencyMs: Date.now() - t0, model: data.model || model };
  } finally {
    clearTimeout(timer);
  }
}

/** Compatibilidad: devuelve solo el objeto JSON. */
async function chatJson(opts) {
  return (await chat(opts)).json;
}

module.exports = { chat, chatJson };
