'use strict';
// Cliente mínimo de OpenAI (Chat Completions con salida JSON) por fetch. No añade
// dependencias. Nunca se registran las respuestas del usuario en los logs.

/**
 * Llama al modelo y devuelve el objeto JSON de la respuesta.
 * { system, user, apiKey, model, baseUrl, timeoutMs }
 */
async function chatJson({ system, user, apiKey, model, baseUrl = 'https://api.openai.com/v1', timeoutMs = 20000, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('Falta OPENAI_API_KEY.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`OpenAI respondió ${res.status}`);
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('Respuesta vacía de OpenAI');
    return JSON.parse(content);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { chatJson };
