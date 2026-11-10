'use strict';
// Fase 1: versiones de la metodología, paquete de hechos con estados de evidencia y
// trazabilidad guardada en cada resultado del test gratuito.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const engine = require('../src/domain/free/engine');
const catalog = require('../src/domain/free/catalog');
const narrative = require('../src/domain/free/narrative');
const knowledge = require('../src/domain/knowledge');

const SLOTS = catalog.SLOTS.map((s) => s.slot_id);
const A = (over = {}) => ({ ...h.FREE_ANSWERS, ...over });

function put(sid, slot, value) {
  const s = engine.loadSession(sid);
  const q = engine.questionAt(s, slot).question;
  if (['money_or_choice', 'age_or_choice'].includes(q.type) && typeof value === 'string') value = { kind: 'CHOICE', code: value };
  return engine.saveAnswer(sid, slot, { variant_id: q.variant_id, expected_revision: s.revision, value });
}
function run(answers) {
  const s = engine.createSession({ consent: true }).session;
  for (const slot of SLOTS) put(s.id, slot, answers[slot]);
  engine.complete(s.id);
  const row = h.db.one('SELECT * FROM ft_results WHERE session_id = ? ORDER BY id DESC LIMIT 1', s.id);
  return { id: s.id, row, pkg: JSON.parse(row.fact_package_json), result: engine.getDiagnostic(s.id).result };
}
const fact = (pkg, id) => pkg.facts.find((f) => f.id === id);

test.before(() => h.start());
test.after(() => h.stop());

test('knowledge: versiones vigentes, procedencia y huella estable', () => {
  assert.deepEqual(
    { k: knowledge.VERSIONS.knowledge, r: knowledge.VERSIONS.rules, p: knowledge.VERSIONS.prompts },
    { k: 'BCP_V1_ES', r: 'RFP_V1_ES', p: 'POIA_V1_ES' }
  );
  for (const v of Object.values(knowledge.VERSIONS)) assert.ok(knowledge.PROVENANCE[v], `sin procedencia: ${v}`);
  assert.equal(knowledge.LEVERS.length, 10);
  assert.equal(knowledge.PHASES.length, 7);
  assert.match(knowledge.hash(), /^[0-9a-f]{64}$/);
  assert.equal(knowledge.hash(), knowledge.hash());
  // Ningún prompt V2 está activo todavía: el gratuito sigue con NARR_AI_V1_ES o plantilla.
  assert.equal(knowledge.prompts.activeFor('free').id, 'NARR_AI_V1_ES');
  assert.equal(knowledge.prompts.activeFor('plan'), null);
});

test('cada resultado nuevo guarda catálogo, reglas, conocimiento, esquema y huellas', () => {
  const { row, result } = run(A());
  assert.equal(row.catalog_version, 'FREE_25_V2_ES');
  assert.equal(row.knowledge_version, 'BCP_V1_ES');
  assert.equal(row.rules_framework_version, 'RFP_V1_ES');
  assert.equal(row.result_schema_version, 'RESULT_FREE_V2_ES');
  assert.equal(row.methodology_hash, knowledge.hash());
  assert.match(row.input_hash, /^[0-9a-f]{64}$/);
  assert.equal(row.prompt_version, null, 'sin IA no hay prompt');
  assert.equal(row.narrative_source, 'template');
  assert.equal(result.traceability.knowledge_version, 'BCP_V1_ES');
  assert.equal(result.traceability.input_hash, row.input_hash);
  assert.equal(result._fact_package, undefined, 'el paquete no se expone dentro del resultado');
});

test('paquete de hechos: 25 hechos con estado y evidencia; DK/PNA quedan DESCONOCIDO, nunca cero', () => {
  const { pkg } = run(A({ Q06: 'DK', Q08: 'PNA' }));
  assert.equal(pkg.facts.length, 25);
  assert.equal(pkg.catalog_version, 'FREE_25_V2_ES');
  const q06 = fact(pkg, 'Q06');
  assert.equal(q06.status, 'DESCONOCIDO');
  assert.equal(q06.reason, 'DK');
  assert.equal(q06.value, null);
  assert.equal(fact(pkg, 'Q08').reason, 'PNA');
  assert.ok(pkg.unknowns.some((u) => u.id === 'Q06') && pkg.unknowns.some((u) => u.id === 'Q08'));
  const q01 = fact(pkg, 'Q01');
  assert.equal(q01.status, 'DECLARADO');
  assert.deepEqual(q01.evidence_ref.slot_id, 'Q01');
  assert.ok(q01.label);
  // El test gratuito no calcula cifras: ninguna métrica y datos monetarios pendientes.
  assert.deepEqual(pkg.metrics, []);
  assert.ok(pkg.missing_required_inputs.some((m) => m.field === 'ingreso_personal_neto_mes'));
});

test('metas y presupuesto de exploración no se tratan como ingreso real (Q17, Q18, Q23, Q25)', () => {
  const { pkg } = run(A());
  assert.equal(fact(pkg, 'Q18').nature, 'meta');
  assert.equal(fact(pkg, 'Q25').nature, 'meta');
  assert.equal(fact(pkg, 'Q17').nature, 'meta');
  assert.equal(fact(pkg, 'Q23').nature, 'presupuesto_exploracion');
  assert.equal(fact(pkg, 'Q02').nature, 'hecho');
  assert.match(fact(pkg, 'Q17').label, /49 años/);
});

test('contradicción: bloquea solo los datos implicados y formula una pregunta', () => {
  const { pkg, result } = run(A({ Q02: 'SHORTFALL', Q06: 'P20_29' }));
  assert.equal(pkg.contradictions.length, 1);
  assert.equal(pkg.contradictions[0].id, 'CTR_SHORTFALL_SAVING');
  assert.ok(pkg.contradictions[0].question);
  assert.equal(fact(pkg, 'Q02').status, 'CONTRADICTORIO');
  assert.equal(fact(pkg, 'Q06').status, 'CONTRADICTORIO');
  assert.equal(fact(pkg, 'Q09').status, 'DECLARADO', 'el resto sigue disponible');
  assert.equal(result.evidence.contradictions.length, 1);
  assert.equal(run(A()).pkg.contradictions.length, 0);
});

test('mismas respuestas y versiones ⇒ misma huella de entrada; respuestas distintas ⇒ otra', () => {
  const a = run(A()).row.input_hash;
  const b = run(A()).row.input_hash;
  const c = run(A({ Q01: 'BUILD_WEALTH' })).row.input_hash;
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('los resultados anteriores sin trazabilidad siguen siendo legibles', () => {
  const { id, row } = run(A());
  const old = JSON.parse(row.result_json);
  delete old.traceability;
  delete old.evidence;
  delete old.result_schema_version;
  h.db.run(
    `UPDATE ft_results SET result_json = ?, catalog_version = NULL, knowledge_version = NULL, rules_framework_version = NULL,
       result_schema_version = NULL, methodology_hash = NULL, input_hash = NULL, fact_package_json = NULL WHERE id = ?`,
    JSON.stringify(old),
    row.id
  );
  const d = engine.getDiagnostic(id);
  assert.equal(d.status, 'ready');
  assert.equal(d.result.result_rules_version, 'RESULT_FREE_V1_ES');
  assert.ok(d.result.profile.title);
});

test('con IA: se registran la versión de prompt y el modelo usados', async () => {
  narrative.setClient(async (prompt) => {
    const p = JSON.parse(prompt.user);
    return { profile_summary: p.perfil.resumen_base, findings: p.hallazgos.map((f) => ({ candidate_id: f.candidate_id, explanation: f.explicacion_base })) };
  });
  try {
    const s = engine.createSession({ consent: true }).session;
    for (const slot of SLOTS) put(s.id, slot, A()[slot]);
    engine.complete(s.id);
    await h.queue.drain({ ignoreSchedule: true });
    const row = h.db.one('SELECT * FROM ft_results WHERE session_id = ?', s.id);
    assert.equal(row.narrative_source, 'ai');
    assert.equal(row.prompt_version, 'NARR_AI_V1_ES');
    assert.equal(row.model, 'cliente_de_prueba');
    assert.equal(JSON.parse(row.result_json).traceability.prompt_version, 'NARR_AI_V1_ES');
  } finally {
    narrative.setClient(null);
  }
});
