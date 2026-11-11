'use strict';
// Migración a gpt-6-luna: el cliente no envía temperature por defecto (el modelo solo
// admite 1), usa salida estructurada estricta con esquema, devuelve uso y latencia, y
// la redacción guarda esos metadatos sin contenido del usuario.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const openai = require('../src/domain/ai/openai');
const config = require('../src/config');

function fakeFetch(reply, sink) {
  return async (url, init) => {
    sink.url = url;
    sink.body = JSON.parse(init.body);
    return reply;
  };
}
const OK = { ok: true, status: 200, json: async () => ({ model: 'gpt-6-luna', usage: { prompt_tokens: 120, completion_tokens: 80 }, choices: [{ message: { content: '{"ok":true}' } }] }) };
const SCHEMA = { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } };

test.before(() => h.start());
test.after(() => h.stop());

test('config: el modelo por defecto es gpt-6-luna, sin temperature y sin razonamiento extra', () => {
  // En pruebas no hay OPENAI_MODEL ni OPENAI_TEMPERATURE definidos.
  assert.equal(config.ai.openai.model, process.env.OPENAI_MODEL || 'gpt-6-luna');
  assert.equal(config.ai.openai.temperature, null);
  assert.equal(config.ai.openai.reasoningEffort, 'none');
});

test('cliente: con esquema usa json_schema estricto y no envía temperature', async () => {
  const sink = {};
  const r = await openai.chat({ system: 's', user: 'u', apiKey: 'k', model: 'gpt-6-luna', schema: SCHEMA, schemaName: 'prueba', reasoningEffort: 'none', fetchImpl: fakeFetch(OK, sink) });
  assert.deepEqual(sink.body.response_format, { type: 'json_schema', json_schema: { name: 'prueba', strict: true, schema: SCHEMA } });
  assert.equal('temperature' in sink.body, false);
  assert.equal(sink.body.reasoning_effort, 'none');
  assert.deepEqual(r.json, { ok: true });
  assert.equal(r.model, 'gpt-6-luna');
  assert.equal(r.usage.prompt_tokens, 120);
  assert.ok(Number.isInteger(r.latencyMs));
});

test('cliente: temperature solo se envía si se configura', async () => {
  const sink = {};
  await openai.chat({ system: 's', user: 'u', apiKey: 'k', model: 'otro', temperature: 0.3, fetchImpl: fakeFetch(OK, sink) });
  assert.equal(sink.body.temperature, 0.3);
  assert.equal('reasoning_effort' in sink.body, false);
});

test('cliente: el error del proveedor informa código y parámetro, nunca el contenido', async () => {
  const bad = { ok: false, status: 400, json: async () => ({ error: { code: 'unsupported_value', param: 'temperature', message: 'Unsupported value' } }) };
  await assert.rejects(
    () => openai.chat({ system: 'dato privado', user: 'otro dato privado', apiKey: 'k', model: 'gpt-6-luna', fetchImpl: async () => bad }),
    (err) => /400 \(unsupported_value temperature\)/.test(err.message) && !/privado/.test(err.message)
  );
});

test('redacción: guarda modelo, tokens y latencia, y el motivo si se usó la plantilla', async () => {
  const engine = require('../src/domain/free/engine');
  const catalog = require('../src/domain/free/catalog');
  const narrative = require('../src/domain/free/narrative');
  const put = (sid, slot, value) => {
    const s = engine.loadSession(sid);
    const q = engine.questionAt(s, slot).question;
    if (['money_or_choice', 'age_or_choice'].includes(q.type) && typeof value === 'string') value = { kind: 'CHOICE', code: value };
    return engine.saveAnswer(sid, slot, { variant_id: q.variant_id, expected_revision: s.revision, value });
  };
  const runWith = async (model) => {
    narrative.setClient(model);
    try {
      const s = engine.createSession({ consent: true }).session;
      for (const q of catalog.SLOTS) put(s.id, q.slot_id, h.FREE_ANSWERS[q.slot_id]);
      engine.complete(s.id);
      await h.queue.drain({ ignoreSchedule: true });
      return JSON.parse(h.db.one('SELECT result_json FROM ft_results WHERE session_id = ?', s.id).result_json);
    } finally {
      narrative.setClient(null);
    }
  };
  const good = await runWith(async (prompt) => {
    const p = JSON.parse(prompt.user);
    return { profile_summary: p.perfil.resumen_base, findings: p.hallazgos.map((f) => ({ candidate_id: f.candidate_id, explanation: f.explicacion_base })) };
  });
  assert.equal(good.narrative_source, 'ai');
  assert.equal(good.traceability.ai_usage.model, 'cliente_de_prueba');
  assert.equal(good.traceability.ai_fallback_reason, null);

  const rejected = await runWith(async () => ({ profile_summary: 'corto', findings: [] }));
  assert.equal(rejected.narrative_source, 'template');
  assert.ok(rejected.traceability.ai_fallback_reason, 'queda registrado por qué se usó la plantilla');
});
