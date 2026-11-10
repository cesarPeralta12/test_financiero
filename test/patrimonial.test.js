'use strict';
// Fase 2 — Resultado gratuito V2 de crecimiento patrimonial (RESULT_FREE_V2_ES).
// Casos sintéticos del documento 03 (G01–G18), del manual de reglas 05 (C01–C12) y de
// prompts 06 (P01–P12) que aplican al test gratuito. Todos son deterministas.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const engine = require('../src/domain/free/engine');
const catalog = require('../src/domain/free/catalog');
const narrative = require('../src/domain/free/narrative');
const patrimonial = require('../src/domain/free/patrimonial');
const config = require('../src/config');

const SLOTS = catalog.SLOTS.map((s) => s.slot_id);

// Perfil base neutro: empleado, ahorra, sin deudas, sin tiempo ni habilidades declaradas.
const NEUTRAL = {
  Q01: 'FIND_DIRECTION', Q02: 'SAVING', Q03: 'E', Q04: 'SOME_UNCERTAINTY', Q05: 'NONE', Q06: 'P20_29', Q07: 'LOW', Q08: 'M6_11',
  Q09: 'NO', Q10: 'NO', Q11: 'CURRENT', Q12: 'RECORDED', Q13: ['CASH'], Q14: 'D0', Q15: ['RESERVE'], Q16: 'A25_34',
  Q17: 'NOT_SET', Q18: 'NOT_SET', Q19: 'NEVER', Q20: 'KNOWLEDGE', Q21: 'PRESERVE', Q22: 'DK', Q23: 'DK', Q24: ['DK'], Q25: 'NOT_SET',
};
const N = (over = {}) => ({ ...NEUTRAL, ...over });
// Perfil sin ingresos (ruta N) con variantes propias.
const NO_INCOME = (over = {}) => N({ Q03: 'N', Q04: 'M1_3', Q05: 'JOB', Q06: 'ZERO', Q07: 'POSSIBLE', Q08: 'ZERO', Q11: 'SUPPORT', ...over });
// Perfil de negocio (ruta B): Q12 usa la variante para negocio.
const BUSINESS = (over = {}) => N({ Q03: 'B', Q04: 'ZERO', Q05: 'MARGIN', Q06: 'ZERO', Q12: 'SEPARATE_PARTIAL', Q13: ['BUSINESS'], ...over });

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
  const result = engine.getDiagnostic(s.id).result;
  return { id: s.id, p: result.patrimonial, result, pkg: JSON.parse(row.fact_package_json) };
}
const rules = (pkg) => pkg.signals.map((x) => x.rule_id);
const blockedIds = (pkg) => pkg.blocked_actions.map((b) => b.id);
// Todo el texto visible del bloque V2 (sin referencias de evidencia).
function visibleText(p) {
  const strip = (o) => (Array.isArray(o) ? o.map(strip) : o && typeof o === 'object' ? Object.entries(o).filter(([k]) => !['evidence_refs', 'version', 'rules_version', 'knowledge_version', 'action_id', 'code', 'rule_id'].includes(k)).map(([, v]) => strip(v)) : o);
  return JSON.stringify(strip(p));
}

test.before(() => h.start());
test.after(() => h.stop());

// ───────── Estructura ─────────

test('estructura: seis bloques, versiones y una sola acción del catálogo autorizado', () => {
  const { p, result } = run(N());
  assert.equal(p.version, 'RESULT_FREE_V2_ES');
  assert.equal(p.rules_version, 'RFP_V1_ES');
  assert.equal(p.knowledge_version, 'BCP_V1_ES');
  assert.equal(result.result_schema_version, 'RESULT_FREE_V2_ES');
  for (const k of ['starting_point', 'brakes', 'resources', 'opportunity', 'first_action', 'missing']) assert.ok(k in p, `falta ${k}`);
  assert.ok(patrimonial.ACTION_BY_ID[p.first_action.action_id], 'la acción sale del catálogo');
  assert.equal(p.first_action.capital, 'Sin costo');
  assert.ok(p.first_action.done_when);
  assert.ok(p.brakes.length <= 2, 'máximo dos frenos');
  assert.ok(p.resources.length <= 4);
  assert.ok(p.missing.length >= 1 && p.missing.length <= 3, 'como máximo tres preguntas');
});

test('el motor registra señales, acciones elegibles, bloqueos y candidatas en el paquete de hechos', () => {
  const { pkg, p } = run(N({ Q22: 'H4_7', Q24: ['SALES'] }));
  assert.ok(Array.isArray(pkg.signals));
  assert.ok(pkg.eligible_actions.includes(p.first_action.action_id), 'la acción elegida es elegible');
  assert.equal(pkg.opportunity_candidates.length, 1);
  assert.equal(pkg.opportunity_candidates[0].status, 'HIPOTESIS');
});

// ───────── Casos G del documento 03 ─────────

test('G01 · empleado estable con margen y habilidad: no solo recortes, evalúa crecer', () => {
  const { p } = run(N({ Q04: 'STABLE', Q05: 'NEGOTIATION', Q22: 'H4_7', Q24: ['SALES'] }));
  assert.equal(p.opportunity.status, 'HIPOTESIS');
  assert.equal(p.opportunity.lever, 'ingresos');
  assert.equal(p.first_action.category, 'creacion');
  assert.equal(p.first_action.action_id, 'ACT_EMP_RAISE');
  assert.equal(p.brakes.length, 0);
});

test('G02 / C03 / P01 · sin ingresos, con habilidad y poco tiempo: protección y oferta por validar sin capital', () => {
  const { p, pkg } = run(NO_INCOME({ Q22: 'H1_3', Q23: 'ZERO', Q24: ['SALES'] }));
  assert.ok(rules(pkg).includes('RFP-102'));
  assert.equal(p.brakes[0].title, 'Hoy no recibes ingresos personales');
  assert.equal(p.opportunity.status, 'HIPOTESIS', 'la alerta no borra la búsqueda de ingresos (RFP-109)');
  assert.equal(p.dual_focus, true);
  assert.ok(blockedIds(pkg).includes('PAID_ACTION'));
  assert.equal(p.first_action.capital, 'Sin costo');
  assert.doesNotMatch(visibleText(p), /garantiza|seguro que|conseguirás/i);
});

test('G03 / C01 / P02 · negocio sin retiro personal no se confunde con desempleo', () => {
  const { p, pkg } = run(BUSINESS());
  assert.ok(rules(pkg).includes('RFP-107'));
  assert.ok(!rules(pkg).includes('RFP-102'), 'no se activa la regla de «sin ingresos»');
  assert.match(p.starting_point.text, /negocio que todavía no te deja dinero/);
  assert.match(p.starting_point.text, /no significa que no tenga ventas/);
  assert.doesNotMatch(visibleText(p), /no recibes ingresos personales/);
  assert.equal(p.first_action.action_id, 'ACT_ORG_SEPARATE', 'primero separar negocio y hogar');
});

test('G04 / P05 · pagos vencidos y ganas de invertir: protección y ninguna inversión especulativa', () => {
  const { p, pkg } = run(N({ Q09: 'YES', Q10: ['CARD'], Q11: 'LATE', Q21: 'HIGH_VARIATION' }));
  assert.ok(rules(pkg).includes('RFP-103'));
  assert.equal(p.first_action.action_id, 'ACT_PROT_PAYMENTS');
  assert.ok(blockedIds(pkg).includes('SPECULATIVE_INVESTMENT'));
  assert.ok(blockedIds(pkg).includes('NEW_CREDIT'));
});

test('G05 / C06 / P03 · una meta en dinero (Q18) no se presenta como ingreso ni patrimonio', () => {
  const { p } = run(N({ Q18: { kind: 'AMOUNT', amount: '3000.00', currency: 'USD' } }));
  const txt = visibleText(p);
  assert.doesNotMatch(txt, /3000|3\.000|5000|5\.000/, 'las metas no aparecen como cifras del diagnóstico');
  assert.ok(p.missing.some((m) => m.code === 'ingreso_personal_neto_mes'), 'pide el ingreso real');
});

test('G06 / C09 / P07 · habilidad marcada sin experiencia: potencial por validar, sin precio', () => {
  const { p } = run(N({ Q22: 'H4_7', Q24: ['DIGITAL'] }));
  assert.equal(p.opportunity.status, 'HIPOTESIS');
  assert.match(p.opportunity.hypothesis, /todavía no una competencia comprobada/);
  assert.match(p.opportunity.hypothesis, /no sabemos aún si hay demanda/);
  assert.match(p.resources[0].text, /por validar/);
  assert.doesNotMatch(visibleText(p), /\$|cobra[rs]? \d|precio de \d/i);
});

test('G07 / C08 / P06 · sin tiempo y sin presupuesto: nada que exija horas o dinero', () => {
  const { p, pkg } = run(N({ Q22: 'H0', Q23: 'ZERO', Q24: ['SALES'], Q05: 'NEGOTIATION' }));
  assert.ok(blockedIds(pkg).includes('TIME_HEAVY'));
  assert.ok(blockedIds(pkg).includes('PAID_ACTION'));
  for (const id of pkg.eligible_actions) assert.ok(patrimonial.ACTION_BY_ID[id].hours <= 1, `${id} pide demasiado tiempo`);
  assert.equal(p.first_action.effort, 'Una hora o menos');
  assert.ok(!rules(pkg).includes('RFP-206'), 'sin tiempo no se activa la palanca de habilidades');
});

test('G08 / C05 / P04 · deuda o ahorro desconocidos (DK): no se asume cero', () => {
  const { p, pkg } = run(N({ Q06: 'DK', Q09: 'DK', Q10: 'NONE', Q11: 'NO' }));
  const q09 = pkg.facts.find((f) => f.id === 'Q09');
  assert.equal(q09.status, 'DESCONOCIDO');
  assert.ok(pkg.eligible_actions.includes('ACT_ORG_DEBTS'), 'propone reunir los datos de la deuda');
  assert.ok(p.missing.some((m) => /no lo tomamos como cero/.test(m.reason)));
  assert.doesNotMatch(visibleText(p), /no tienes deudas|sin deudas/i);
});

test('G09 / C07 · respuestas contradictorias: se pregunta antes de concluir', () => {
  const { p } = run(N({ Q02: 'SHORTFALL', Q06: 'P20_29' }));
  assert.equal(p.missing[0].code, 'CTR_SHORTFALL_SAVING');
  assert.match(p.starting_point.text, /no coinciden/);
});

test('G11 · oportunidad sin evidencia de mercado: sin puntajes inventados', () => {
  const { pkg } = run(N({ Q22: 'H4_7', Q24: ['CREATIVE'] }));
  for (const c of pkg.opportunity_candidates) assert.equal(c.scores, null);
});

test('sin datos para una vía de crecimiento: se pregunta en vez de inventarla', () => {
  const { p, pkg } = run(N());
  assert.equal(p.opportunity.status, 'DESCONOCIDO');
  assert.equal(p.opportunity.hypothesis, null);
  assert.ok(p.opportunity.question);
  assert.equal(pkg.opportunity_candidates.length, 0);
});

test('G13 / C10 / P10 · si la IA falla, el resultado V2 llega completo por plantilla', async () => {
  narrative.setClient(async () => {
    throw new Error('timeout simulado');
  });
  try {
    const s = engine.createSession({ consent: true }).session;
    for (const slot of SLOTS) put(s.id, slot, NO_INCOME({ Q22: 'H1_3', Q24: ['SALES'] })[slot]);
    engine.complete(s.id);
    for (let i = 0; i < 4; i++) await h.queue.drain({ ignoreSchedule: true });
    const d = engine.getDiagnostic(s.id);
    assert.equal(d.status, 'ready');
    assert.equal(d.narrative_source, 'template');
    assert.equal(d.result.patrimonial.version, 'RESULT_FREE_V2_ES');
    assert.equal(d.result.patrimonial.first_action.action_id, 'ACT_JOB_TARGET');
  } finally {
    narrative.setClient(null);
  }
});

test('C10 · la IA no puede cambiar el bloque V2: la redacción solo toca perfil y hallazgos V1', async () => {
  const before = run(N({ Q22: 'H4_7', Q24: ['SALES'] })).p;
  narrative.setClient(async (prompt) => {
    const x = JSON.parse(prompt.user);
    return { profile_summary: x.perfil.resumen_base, findings: x.hallazgos.map((f) => ({ candidate_id: f.candidate_id, explanation: f.explicacion_base })) };
  });
  try {
    const s = engine.createSession({ consent: true }).session;
    for (const slot of SLOTS) put(s.id, slot, N({ Q22: 'H4_7', Q24: ['SALES'] })[slot]);
    engine.complete(s.id);
    await h.queue.drain({ ignoreSchedule: true });
    const d = engine.getDiagnostic(s.id);
    assert.equal(d.narrative_source, 'ai');
    assert.deepEqual(d.result.patrimonial, before);
  } finally {
    narrative.setClient(null);
  }
});

test('G15 / P12 · dos sesiones con las mismas respuestas ⇒ el mismo resultado, sin cruces', () => {
  const a = run(NO_INCOME({ Q22: 'H1_3', Q24: ['SALES'] }));
  const b = run(NO_INCOME({ Q22: 'H1_3', Q24: ['SALES'] }));
  const strip = (p) => JSON.stringify(p, (k, v) => (k === 'evidence_refs' ? undefined : v));
  assert.equal(strip(a.p), strip(b.p));
  assert.notEqual(a.id, b.id);
  assert.notEqual(run(N()).p.first_action.action_id, a.p.first_action.action_id, 'perfiles distintos ⇒ acciones distintas');
});

test('G16 / C11 / P11 · cambiar una respuesta genera un resultado nuevo y conserva el anterior', () => {
  const { id, p } = run(N({ Q05: 'NEGOTIATION', Q22: 'H4_7', Q24: ['SALES'] }));
  assert.equal(p.first_action.action_id, 'ACT_EMP_RAISE');
  put(id, 'Q05', 'SKILLS');
  engine.complete(id);
  const rows = h.db.all('SELECT answer_revision, input_hash FROM ft_results WHERE session_id = ? ORDER BY id', id);
  assert.ok(rows.length >= 2, 'el resultado anterior se conserva');
  assert.notEqual(rows[0].input_hash, rows[rows.length - 1].input_hash);
  const now = engine.getDiagnostic(id).result.patrimonial;
  assert.equal(now.first_action.action_id, 'ACT_VALIDATE_OFFER');
});

test('C02 · ingreso variable y habilidad de ventas: propuesta condicionada, sin precio ni plazo', () => {
  const { p, pkg } = run(N({ Q03: 'I', Q04: 'VARIABLE', Q05: 'CLIENTS', Q22: 'H4_7', Q24: ['SALES'] }));
  assert.ok(rules(pkg).includes('RFP-106'));
  assert.equal(p.first_action.action_id, 'ACT_FIND_CLIENTS');
  assert.match(p.first_action.instruction, /No vendas todavía/);
  assert.doesNotMatch(visibleText(p), /\d+ (días|semanas|meses) (para|hasta) (vender|cobrar)/);
});

test('C04 · ingreso estable, reserva y pagos al día: se ven recursos, no solo gastos', () => {
  const { p } = run(N({ Q04: 'STABLE', Q08: 'M6_11', Q09: 'YES', Q10: ['CARD'], Q11: 'FULL', Q13: ['NONE'], Q22: 'H4_7', Q24: ['TEACHING'] }));
  const codes = p.resources.map((r) => r.code);
  assert.ok(codes.includes('RESERVE'));
  assert.ok(codes.includes('PAYMENTS'));
  assert.ok(codes.includes('SKILLS'));
  assert.notEqual(p.first_action.category, 'proteccion');
});

test('dependientes sin respaldo activan la revisión de protección familiar (RFP-105)', () => {
  const { pkg } = run(N({ Q14: 'D2', Q15: ['NONE'] }));
  assert.ok(rules(pkg).includes('RFP-105'));
  assert.ok(pkg.eligible_actions.includes('ACT_PROT_FAMILY'));
});

test('fraude previo bloquea propuestas de inversión (RFP-108)', () => {
  const { pkg } = run(N({ Q19: 'LOSS', Q20: 'FRAUD' }));
  assert.ok(rules(pkg).includes('RFP-108'));
  assert.ok(blockedIds(pkg).includes('SPECULATIVE_INVESTMENT'));
});

test('honestidad: el bloque V2 nunca muestra cifras de ingreso, gasto, saldo ni patrimonio', () => {
  const cases = [N(), NO_INCOME({ Q22: 'H1_3', Q24: ['SALES'] }), BUSINESS(), N({ Q09: 'YES', Q10: ['CARD'], Q11: 'LATE' }), N({ Q18: { kind: 'AMOUNT', amount: '3000.00', currency: 'USD' } })];
  for (const answers of cases) {
    const txt = visibleText(run(answers).p);
    assert.doesNotMatch(txt, /\d/, 'sin números en el texto visible');
    assert.doesNotMatch(txt, /patrimonio neto de|tu saldo es|ahorras el/i);
  }
});

test('redacción: sin palabras duplicadas en ningún tramo de tiempo', () => {
  for (const t of ['HLT1', 'H1_3', 'H4_7', 'H8_14', 'H15PLUS']) {
    const txt = visibleText(run(N({ Q22: t, Q24: ['SALES'], Q05: 'SKILLS' })).p);
    assert.doesNotMatch(txt, /\b(\p{L}+) \1\b/u, 'palabra repetida con ' + t);
  }
});

// ───────── Vista ─────────

test('vista: muestra los seis bloques V2 primero y la lectura V1 plegada', async () => {
  const c = new h.Client();
  await h.consent(c);
  await h.answerFree(c);
  await c.post('/test/finalizar', {});
  const page = await c.get('/resultado');
  assert.equal(page.status, 200);
  for (const t of ['Tu punto de partida', 'Qué está frenando tu crecimiento', 'Tus recursos para progresar', 'Oportunidad por explorar', 'Tu Día Uno', 'Qué necesitamos para diseñar tu plan patrimonial']) {
    assert.match(page.text, new RegExp(t), `falta el bloque «${t}»`);
  }
  assert.match(page.text, /data-version="RESULT_FREE_V2_ES"/);
  assert.match(page.text, /<details class="v1-detail section"><summary>Ver el análisis detallado<\/summary>/);
  assert.ok(page.text.indexOf('Tu Día Uno') < page.text.indexOf('Ver el análisis detallado'), 'V2 antes que V1');
  assert.match(page.text, /Sin costo/);
});

test('vista: con FREE_RESULT_V2 apagado se muestra solo la lectura V1', async () => {
  const prev = config.freeResultV2;
  config.freeResultV2 = false;
  try {
    const c = new h.Client();
    await h.consent(c);
    await h.answerFree(c);
    await c.post('/test/finalizar', {});
    const page = await c.get('/resultado');
    assert.doesNotMatch(page.text, /data-version="RESULT_FREE_V2_ES"/);
    assert.doesNotMatch(page.text, /Ver el análisis detallado/);
    assert.match(page.text, /Tu perfil financiero/);
  } finally {
    config.freeResultV2 = prev;
  }
});
