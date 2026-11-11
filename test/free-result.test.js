'use strict';
// Resultado del test gratuito (RESULT_FREE_V1_ES): fixture SIM_E_01, casos C01–C12,
// cálculos opcionales, redacción con IA y plantillas de respaldo.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const engine = require('../src/domain/free/engine');
const catalog = require('../src/domain/free/catalog');
const resultSvc = require('../src/domain/free/result');
const metrics = require('../src/domain/free/metrics');
const narrative = require('../src/domain/free/narrative');
const openai = require('../src/domain/ai/openai');

const SLOTS = catalog.SLOTS.map((s) => s.slot_id);

function put(sid, slot, value) {
  const s = engine.loadSession(sid);
  const q = engine.questionAt(s, slot).question;
  if (['money_or_choice', 'age_or_choice'].includes(q.type) && typeof value === 'string') value = { kind: 'CHOICE', code: value };
  return engine.saveAnswer(sid, slot, { variant_id: q.variant_id, expected_revision: s.revision, value });
}
function build(answers) {
  const s = engine.createSession({ consent: true }).session;
  for (const slot of SLOTS) put(s.id, slot, answers[slot]);
  engine.complete(s.id);
  return { id: s.id, result: engine.getDiagnostic(s.id).result };
}
const A = (over = {}) => ({ ...h.FREE_ANSWERS, ...over });
const NEUTRAL = {
  Q01: 'FIND_DIRECTION', Q02: 'SAVING', Q03: 'E', Q04: 'SOME_UNCERTAINTY', Q05: 'NONE', Q06: 'P20_29', Q07: 'LOW', Q08: 'M6_11',
  Q09: 'NO', Q10: 'NO', Q11: 'CURRENT', Q12: 'RECORDED', Q13: ['CASH'], Q14: 'D0', Q15: ['RESERVE'], Q16: 'A25_34',
  Q17: 'NOT_SET', Q18: 'NOT_SET', Q19: 'NEVER', Q20: 'KNOWLEDGE', Q21: 'PRESERVE', Q22: 'DK', Q23: 'DK', Q24: ['DK'], Q25: 'NOT_SET',
};
const N = (over = {}) => ({ ...NEUTRAL, ...over });
const words = (t) => t.trim().split(/\s+/).length;
const states = (r) => Object.fromEntries(r.dimensions.map((d) => [d.code, d.state]));

test.before(() => h.start());
test.after(() => h.stop());

test('SIM_E_01: perfil, atención, cobertura, mapa, fortalezas, prioridades y primer paso', () => {
  const { result: r } = build(A());
  assert.equal(r.title, 'Tu diagnóstico financiero preliminar');
  assert.equal(r.result_rules_version, 'RESULT_FREE_V1_ES');
  assert.equal(r.preliminary, true);
  assert.equal(r.profile.title, 'Ingreso estable y reserva limitada');
  assert.ok(words(r.profile.summary) >= 50 && words(r.profile.summary) <= 90, `resumen de ${words(r.profile.summary)} palabras`);
  assert.match(r.profile.summary, /estabilidad en tu empleo/);
  assert.match(r.profile.summary, /pagos mínimos de tarjeta/);
  assert.match(r.profile.summary, /Tres personas dependen/);
  assert.ok(new Set(r.profile.evidence_refs.map((x) => x.slot_id)).size >= 2, 'dos o más evidencias');
  assert.equal(r.attention.level, 'Alta');
  assert.deepEqual({ k: r.coverage.known_domains, t: r.coverage.total_domains, l: r.coverage.label }, { k: 7, t: 8, l: 'Información suficiente para una primera lectura' });
  assert.deepEqual(states(r), { income_stability: 'strength', saving_capacity: 'critical', emergency_reserve: 'critical', expense_control: 'strength', debt_management: 'attention', protection: 'unknown', income_generation: 'potential' });
  assert.equal(r.dimensions.length, 7);
  assert.equal(r.dimensions.find((d) => d.code === 'protection').label, 'Protección familiar');
  assert.deepEqual(r.strengths.map((x) => x.title), ['Ya registras tus gastos', 'Percibes estabilidad en tus ingresos', 'Identificas recursos para explorar ingresos']);
  assert.deepEqual(r.priorities.map((p) => p.code), ['P04', 'P06', 'P09'], 'no emite P08: ya lleva registro detallado');
  assert.deepEqual(r.findings.map((f) => f.candidate_id).sort(), ['H_GOAL', 'P04', 'P06', 'P09']);
  assert.equal(r.first_action.title, 'Prepara un listado de tus deudas');
  assert.match(r.first_action.instruction, /estado de cuenta/);
  assert.ok(r.first_action.completion_criterion);
  assert.doesNotMatch(JSON.stringify(r), /publicidad|aporte automático/i);
  assert.deepEqual(r.roadmap.map((x) => [x.day_from, x.day_to]), [[1, 15], [16, 30], [31, 60], [61, 90]]);
  assert.match(r.roadmap[0].description, /registro que ya llevas/);
  assert.equal(r.goal.priority.label, 'Aumentar mis ingresos');
  assert.equal(r.goal.income_goal.label, 'Duplicarlos o más');
  assert.deepEqual(r.goal.independence.age, { kind: 'AGE', value: 49 });
  assert.deepEqual(r.goal.independence.monthly_amount, { amount: '3000.00', currency: 'USD' });
  assert.match(r.goal.independence.note, /No calculamos capital necesario/);
  assert.ok(r.missing_data.length <= 5 && r.missing_data.some((m) => m.code === 'debt_details') && r.missing_data.some((m) => m.code === 'reserve_protection'));
  assert.ok(r.missing_data.every((m) => m.code && m.reason && 'related_priority' in m));
  assert.equal(r.next_step.product_id, 'evaluacion');
  assert.match(r.next_step.reason, /saldos, cuotas y tasas/);
  assert.equal(r.opportunities.length <= 2 && r.opportunities.length >= 1, true);
  // Cada hallazgo y prioridad lleva evidencia existente.
  for (const f of r.findings) assert.ok(f.evidence_refs.length >= 1, f.candidate_id);
  for (const p of r.priorities) assert.ok(p.evidence_refs.length >= 1, p.code);
  for (const ref of [...r.profile.evidence_refs, ...r.first_action.evidence_refs]) assert.ok(ref.slot_id && ref.variant_id && Number.isInteger(ref.answer_revision));
  assert.equal(r.save_result.policy_text.includes('30 días'), true, 'el plazo coincide con la política configurada');
});

test('C01: sin cifras exactas, Q18/Q23/Q25 jamás alimentan ingresos, gastos ni saldos', () => {
  const { result: r } = build(A({ Q23: { kind: 'AMOUNT', amount: '500.00', currency: 'USD' } }));
  assert.deepEqual(r.metrics, []);
  assert.deepEqual(r.invalid_metrics, []);
  assert.ok(!r.facts.some((f) => /ingreso mensual|gasto|saldo/i.test(f.label)));
  const dump = JSON.stringify(r.facts) + JSON.stringify(r.metrics);
  assert.doesNotMatch(dump, /3000|500/);
  assert.ok(r.facts.every((f) => f.origin === 'declared'));
});

test('C04/C05: ausencia de deuda declarada, deuda desconocida y deuda familiar', () => {
  const unknown = build(N({ Q09: 'DK', Q10: 'ALL', Q11: 'NO' })).result;
  assert.equal(states(unknown).debt_management, 'unknown', 'Q09 DK queda sin verificar');
  assert.ok(!unknown.strengths.some((x) => x.code === 'no_declared_debt'));
  const none = build(N({ Q09: 'NO' })).result;
  assert.ok(none.strengths.some((x) => x.title === 'No declaras deudas personales'));
  assert.equal(states(none).debt_management, 'strength');
  // Ausencia de deuda coexiste con déficit: ambas ideas se redactan por separado.
  const shortfall = build(N({ Q02: 'SHORTFALL', Q11: 'SHORTFALL' })).result;
  assert.ok(shortfall.strengths.some((x) => x.code === 'no_declared_debt'));
  assert.equal(shortfall.priorities[0].code, 'P01');
  assert.equal(shortfall.profile.title, 'Recursos y gastos por equilibrar');
  assert.equal(shortfall.first_action.code, 'REVIEW_RECORD', 'con registro detallado se revisa el registro, no se pide empezar a registrar');
  assert.doesNotMatch(JSON.stringify(shortfall), /te sobra|sobra dinero|aporte automático/i);
  const noRecord = build(N({ Q02: 'SHORTFALL', Q11: 'SHORTFALL', Q12: 'NONE' })).result;
  assert.equal(noRecord.first_action.code, 'LIST_UPCOMING');
  // Deuda familiar: ningún hallazgo de tarjeta ni primera acción que exija un extracto.
  const family = build(N({ Q09: 'YES', Q10: ['INFORMAL'], Q11: 'OCCASIONAL_DELAY' })).result;
  assert.equal(family.first_action.code, 'DEBT_LIST');
  assert.doesNotMatch(family.first_action.instruction, /estado de cuenta|tarjeta/i);
  assert.doesNotMatch(JSON.stringify(family.findings), /tarjeta/i);
  // Estados de deuda: críticas, atención, fuerte y sin verificar.
  assert.equal(states(build(N({ Q09: 'YES', Q10: ['CARD'], Q11: 'LATE' })).result).debt_management, 'critical');
  assert.equal(states(build(N({ Q09: 'YES', Q10: ['HOME'], Q11: 'UNABLE' })).result).debt_management, 'critical');
  assert.equal(states(build(N({ Q09: 'YES', Q10: ['CARD'], Q11: 'ABOVE_MIN' })).result).debt_management, 'attention');
  assert.equal(states(build(N({ Q09: 'YES', Q10: ['HOME'], Q11: 'ON_TIME' })).result).debt_management, 'strength');
  assert.equal(states(build(N({ Q09: 'YES', Q10: ['HOME'], Q11: 'NOT_DUE' })).result).debt_management, 'unknown');
  assert.equal(states(build(N({ Q09: 'YES', Q10: ['DK'], Q11: 'ON_TIME' })).result).debt_management, 'attention');
});

test('C06: sin ingresos ni presupuesto; negocio sin dinero personal no es desempleo', () => {
  const n = build(N({ Q03: 'N', Q04: 'LT1M', Q05: 'JOB', Q06: 'ZERO', Q08: 'ZERO', Q23: { kind: 'CHOICE', code: 'ZERO' }, Q25: { kind: 'CHOICE', code: 'NOT_SET' }, Q22: 'H4_7', Q24: ['SALES'] })).result;
  assert.equal(n.priorities[0].code, 'P03');
  assert.equal(states(n).income_stability, 'critical');
  assert.match(n.dimensions[0].explanation, /Actualmente no recibes ingresos personales/);
  assert.equal(n.first_action.code, 'PICK_OPPORTUNITY');
  assert.match(n.first_action.instruction, /sin gastar dinero/);
  assert.equal(n.goal.income_goal, null, 'no se aplica un porcentaje de aumento sobre cero');
  assert.doesNotMatch(JSON.stringify(n), /compra|publicidad|curso pagado|inversión inicial/i);
  const b = build(N({ Q03: 'B', Q04: 'ZERO', Q05: 'SALES', Q06: 'ZERO', Q12: 'SEPARATE_RECORDED' })).result;
  assert.equal(b.priorities.find((p) => p.code === 'P03').code, 'P03');
  assert.doesNotMatch(JSON.stringify(b.findings.find((f) => f.candidate_id === 'P03')), /desemplead|sin empleo/i);
  assert.match(b.findings.find((f) => f.candidate_id === 'P03').explanation, /negocio/);
});

test('C07: sin tiempo o sin habilidades; DK/PNA no se convierten en cero', () => {
  const noTime = build(N({ Q22: 'H0', Q24: ['SALES'] })).result;
  assert.equal(noTime.first_action.code, 'FIND_TIME');
  assert.match(noTime.first_action.completion_criterion, /no prometemos tiempo extra/);
  assert.equal(states(noTime).income_generation, 'attention');
  const noSkills = build(N({ Q22: 'H4_7', Q24: ['NONE'] })).result;
  assert.equal(states(noSkills).income_generation, 'attention');
  assert.ok(!noSkills.strengths.some((x) => x.code === 'resources'), 'NONE no se convierte en habilidad');
  assert.equal(states(build(N({ Q22: 'DK', Q24: ['SALES'] })).result).income_generation, 'unknown');
  assert.equal(states(build(N({ Q22: 'H4_7', Q24: ['PNA'] })).result).income_generation, 'unknown');
  assert.equal(states(build(N({ Q22: 'H4_7', Q24: ['SALES'] })).result).income_generation, 'potential');
});

test('C10: metas y antecedentes — NEVER no genera pérdidas; ALREADY no se ignora', () => {
  const r = build(N({ Q19: 'NEVER', Q17: { kind: 'CHOICE', code: 'ALREADY' }, Q18: { kind: 'AMOUNT', amount: '2000.00', currency: 'USD' } })).result;
  assert.doesNotMatch(JSON.stringify(r), /pérdida|perdida/i);
  assert.deepEqual(r.goal.independence.age, { kind: 'CHOICE', code: 'ALREADY' });
  assert.deepEqual(r.goal.independence.monthly_amount, { amount: '2000.00', currency: 'USD' });
  const loss = build(N({ Q19: 'LOSS', Q20: 'FRAUD' })).result;
  assert.doesNotMatch(JSON.stringify(loss), /fraude fue|confirmamos|estafa/i, 'FRAUD es una causa declarada, no un hecho');
  assert.ok(r.findings.every((f) => f.candidate_id !== 'H_GOAL' || /aspiración|no afirmamos/i.test(f.explanation)));
});

test('el mapa y las reglas de reserva, ahorro, protección y atención siguen el orden de la especificación', () => {
  assert.equal(states(build(N({ Q08: 'M1_2' })).result).emergency_reserve, 'attention');
  assert.equal(states(build(N({ Q08: 'M3_5' })).result).emergency_reserve, 'strength');
  assert.equal(states(build(N({ Q08: 'PNA' })).result).emergency_reserve, 'unknown', 'PNA nunca es cero');
  assert.equal(states(build(N({ Q06: 'LT10' })).result).saving_capacity, 'attention');
  assert.equal(states(build(N({ Q06: 'GE30' })).result).saving_capacity, 'strength');
  assert.equal(states(build(N({ Q03: 'N', Q04: 'LT1M', Q05: 'JOB', Q06: 'SUPPORT_SURPLUS', Q08: 'M6_11' })).result).saving_capacity, 'potential');
  assert.equal(states(build(N({ Q03: 'N', Q04: 'LT1M', Q05: 'JOB', Q06: 'USING_RESERVES', Q08: 'M6_11' })).result).saving_capacity, 'critical');
  assert.equal(states(build(N({ Q15: ['NONE'] })).result).protection, 'critical');
  assert.equal(states(build(N({ Q15: ['INSURANCE'] })).result).protection, 'attention', 'declarar un seguro no otorga una fortaleza');
  assert.equal(states(build(N({ Q15: ['PNA'] })).result).protection, 'unknown');
  assert.equal(states(build(N({ Q03: 'O', Q04: 'AT_RISK', Q05: 'FIXED' })).result).income_stability, 'attention');
  assert.equal(states(build(N({ Q04: 'STABLE' })).result).income_stability, 'strength');
  assert.equal(states(build(N({ Q03: 'I', Q04: 'NEW', Q05: 'NONE' })).result).income_stability, 'unknown', 'NEW no es estabilidad baja por sí solo');
  assert.equal(states(build(N({ Q03: 'B', Q04: 'ZERO', Q05: 'NONE', Q06: 'ZERO', Q12: 'MIXED' })).result).expense_control, 'critical');
  // Prioridad de atención.
  assert.equal(build(N({ Q08: 'M1_2' })).result.attention.level, 'Media');
  assert.equal(build(N()).result.attention.level, 'Por definir');
  assert.equal(build(N({ Q08: 'ZERO', Q15: ['NONE'] })).result.attention.level, 'Alta', 'reserva crítica y protección crítica');
  assert.equal(build(N({ Q08: 'ZERO', Q14: 'D2' })).result.attention.level, 'Alta', 'reserva crítica con dependientes');
  assert.notEqual(build(N({ Q08: 'ZERO' })).result.attention.level, 'Alta', 'reserva crítica sola no basta');
});

test('cobertura por dominios y todos los resúmenes respetan 50–90 palabras con dos evidencias', () => {
  assert.equal(build(N({ Q02: 'DK', Q04: 'DK', Q06: 'DK', Q08: 'DK' })).result.coverage.label, 'Lectura parcial');
  assert.equal(build(N({ Q02: 'DK', Q04: 'DK', Q06: 'PNA', Q08: 'PNA', Q09: 'DK', Q10: 'ALL', Q11: 'NO' })).result.coverage.known_domains, 3);
  const cases = [A(), N(), N({ Q08: 'ZERO', Q14: 'D1', Q15: ['NONE'] }), N({ Q02: 'SHORTFALL', Q11: 'SHORTFALL', Q12: 'NONE' }), N({ Q09: 'YES', Q10: ['CARD'], Q11: 'LATE' }), N({ Q03: 'N', Q04: 'LT1M', Q05: 'JOB', Q06: 'ZERO', Q08: 'ZERO' }), N({ Q03: 'O', Q04: 'STABLE', Q05: 'FIXED' }), N({ Q03: 'DK', Q04: 'STABLE', Q05: 'NONE' })];
  for (const a of cases) {
    const r = build(a).result;
    if (r.profile.pending) continue;
    const w = words(r.profile.summary);
    assert.ok(w >= 50 && w <= 90, `${r.profile.title}: ${w} palabras`);
    assert.ok(new Set(r.profile.evidence_refs.map((x) => x.slot_id)).size >= 2, r.profile.title);
  }
});

test('cada ruta usa su lenguaje y ningún texto supone ocupación desconocida', () => {
  for (const route of ['E', 'I', 'B', 'M', 'O', 'DK']) {
    const q12 = ['B', 'M'].includes(route) ? 'SEPARATE_RECORDED' : 'RECORDED';
    const r = build(N({ Q03: route, Q04: 'STABLE', Q05: route === 'E' ? 'TIME' : route === 'B' ? 'SALES' : route === 'I' ? 'CLIENTS' : route === 'M' ? 'TIME' : route === 'O' ? 'FIXED' : 'TIME', Q12: q12, Q22: 'H4_7', Q24: ['SALES'], Q01: 'INCREASE_INCOME' })).result;
    const opp = r.opportunities[0].description;
    if (route === 'E') assert.match(opp, /no implica dejar tu empleo/);
    if (route === 'B') assert.match(opp, /no uses la facturación como ingreso personal/);
    if (route === 'O') assert.match(opp, /sin productos de inversión/);
    if (route === 'DK') assert.doesNotMatch(JSON.stringify(r), /empleado|tu empleo|tu negocio/);
  }
});

test('la combinación N + SUPPORT_SURPLUS conserva la incertidumbre y propone aclarar, sin cambiar de ruta', () => {
  const { id, result: r } = build(N({ Q03: 'N', Q04: 'LT1M', Q05: 'JOB', Q06: 'SUPPORT_SURPLUS', Q08: 'M6_11' }));
  assert.equal(r.first_action.code, 'CLARIFY_DATA');
  assert.equal(engine.loadSession(id).route, 'N');
  assert.equal(engine.activeAnswers(id).Q06.value, 'SUPPORT_SURPLUS');
});

// ───────── Cálculos opcionales (adaptador) ─────────
const money = (amount, currency = 'USD', period = 'monthly') => ({ amount, currency, period });

test('C02: déficit con importes válidos — saldo −3920 y sin afirmar dinero sobrante', () => {
  const m = metrics.compute({ I: money('768'), G: money('4688'), D: money('0') });
  const bal = m.metrics.find((x) => x.code === 'balance');
  assert.equal(bal.value, '-3920.00');
  assert.deepEqual(bal.input_refs, ['I', 'G', 'D']);
  assert.ok(bal.formula);
  assert.equal(m.metrics.find((x) => x.code === 'margin').value, '0.0', 'max(B, 0) / I');
  // En el resultado alimenta P01 y se menciona el importe solo con B válido.
  const s = engine.createSession({ consent: true }).session;
  for (const slot of SLOTS) put(s.id, slot, N()[slot]);
  const r = resultSvc.build(engine.loadSession(s.id), engine.activeAnswers(s.id), { monetary: { I: money('768'), G: money('4688'), D: money('0') } });
  assert.equal(r.priorities[0].code, 'P01');
  assert.match(r.priorities[0].reason, /-3920\.00 USD/);
  assert.equal(r.first_action.code, 'REVIEW_RECORD');
  assert.equal(r.metrics.find((x) => x.code === 'balance').origin, undefined);
});

test('C03: vivienda al 1311 % es inconsistente cuando forma parte de G y no se reinterpreta', () => {
  const m = metrics.compute({ I: money('768'), G: money('4688'), D: money('0'), V: money('10068.48'), v_in_g: true });
  assert.ok(!m.metrics.some((x) => x.code === 'housing_pct'));
  assert.deepEqual(m.invalid_metrics.find((x) => x.code === 'housing_pct').reason, 'INCONSISTENT_TOTALS');
  assert.equal(m.invalid_metrics[0].message, 'No pudimos calcularlo con los datos disponibles.');
  assert.ok(!JSON.stringify(m).includes('131.1') && !JSON.stringify(m).includes('13.11'));
  // Un porcentaje mayor a 100 no es un error por sí solo si la fórmula es coherente.
  const ok = metrics.compute({ I: money('768'), V: money('1000'), v_in_g: false });
  assert.equal(ok.metrics.find((x) => x.code === 'housing_pct').value, '130.2');
});

test('C09: no duplica deuda en gastos; alcance ambiguo, monedas mezcladas y denominador cero', () => {
  const inc = metrics.compute({ I: money('1000'), G: money('800'), D: money('200'), g_includes_debt: true });
  assert.equal(inc.metrics.find((x) => x.code === 'balance').value, '200.00', 'se resta G una sola vez');
  const exc = metrics.compute({ I: money('1000'), G: money('800'), D: money('200'), g_includes_debt: false });
  assert.equal(exc.metrics.find((x) => x.code === 'balance').value, '0.00');
  const amb = metrics.compute({ I: money('1000'), G: money('800'), D: money('200') });
  assert.equal(amb.invalid_metrics[0].reason, 'AMBIGUOUS_SCOPE');
  assert.equal(amb.metrics.length, 0, 'sin alcance conocido se oculta el balance');
  const mixed = metrics.compute({ I: money('1000', 'USD'), G: money('800', 'EUR'), D: money('0', 'USD') });
  assert.equal(mixed.invalid_metrics[0].reason, 'CURRENCY_MISMATCH');
  const zero = metrics.compute({ I: money('0'), G: money('800'), D: money('0') });
  assert.ok(zero.metrics.some((x) => x.code === 'balance'));
  assert.equal(zero.invalid_metrics.find((x) => x.code === 'margin').reason, 'ZERO_INCOME', 'nunca divide por cero');
  const tooSmall = metrics.compute({ I: money('1000'), G: money('100'), D: money('200'), g_includes_debt: true });
  assert.equal(tooSmall.invalid_metrics[0].reason, 'INCONSISTENT_TOTALS', 'G menor que un componente');
  const missing = metrics.compute({ I: money('1000') });
  assert.equal(missing.invalid_metrics[0].reason, 'MISSING_DATA');
});

test('normalización de períodos y meses de reserva', () => {
  const m = (flow) => metrics.toMonthly(flow) && metrics.toMonthly(flow).value.toFixed(2);
  assert.equal(m({ amount: '100', period: 'weekly' }), '433.33');
  assert.equal(m({ amount: '100', period: 'every_14_days' }), '216.67');
  assert.equal(m({ amount: '100', period: 'twice_monthly' }), '200.00');
  assert.equal(m({ amount: '1200', period: 'annual' }), '100.00');
  assert.equal(m({ amount: '10', period: 'daily', days_per_month: 20 }), '200.00');
  assert.equal(metrics.toMonthly({ amount: '10', period: 'daily' }), null, 'el diario exige días pagados');
  assert.equal(metrics.toMonthly({ amount: '10', period: 'quincenal' }), null, 'quincenal ambiguo no se interpreta');
  assert.match(metrics.toMonthly({ amount: '10', period: 'weekly' }).factor, /^× 4\.3333/);
  const r = metrics.compute({ A: money('6000'), GB: money('2000') });
  assert.equal(r.metrics.find((x) => x.code === 'reserve_months').value, '3.0');
  assert.equal(metrics.compute({ A: money('6000'), GB: money('0') }).invalid_metrics.find((x) => x.code === 'reserve_months').reason, 'ZERO_EXPENSES');
});

// ───────── Generación, IA y plantillas ─────────
test('C11: generación idempotente, plantilla sin IA y un resultado por revisión', () => {
  assert.equal(narrative.enabled(), false);
  const s = engine.createSession({ consent: true }).session;
  for (const slot of SLOTS) put(s.id, slot, A()[slot]);
  const a = engine.complete(s.id);
  assert.equal(a.generation_status, 'ready');
  assert.equal(a.narrative_source, 'template');
  engine.complete(s.id);
  assert.equal(h.db.value('SELECT COUNT(*) FROM ft_results WHERE session_id = ?', s.id), 1);
  const jobs = h.db.value("SELECT COUNT(*) FROM jobs WHERE type = 'free_narrative'");
  assert.equal(jobs, 0, 'sin IA no se encola nada');
});

function fakeModel(mutate) {
  return async (prompt) => {
    const pkg = JSON.parse(prompt.user);
    const out = { profile_summary: pkg.perfil.resumen_base.replace('Es una lectura preliminar', 'Esta lectura es preliminar'), findings: pkg.hallazgos.map((f) => ({ candidate_id: f.candidate_id, explanation: f.explicacion_base })) };
    return mutate ? mutate(out) : out;
  };
}
async function withAi(model, fn) {
  narrative.setClient(model);
  try {
    const s = engine.createSession({ consent: true }).session;
    for (const slot of SLOTS) put(s.id, slot, A()[slot]);
    const done = engine.complete(s.id);
    await fn(s, done);
  } finally {
    narrative.setClient(null);
  }
}

test('con IA: el resultado queda pendiente y pasa a listo con la redacción validada', async () => {
  await withAi(fakeModel(), async (s, done) => {
    assert.equal(done.generation_status, 'pending');
    assert.equal(engine.getDiagnostic(s.id).status, 'pending');
    await h.queue.drain({ ignoreSchedule: true });
    const d = engine.getDiagnostic(s.id);
    assert.equal(d.status, 'ready');
    assert.equal(d.narrative_source, 'ai');
    assert.match(d.result.profile.summary, /Esta lectura es preliminar/);
    assert.equal(d.result.narrative_version, 'NARR_AI_V1_ES');
    // La estructura (perfil, prioridades, acción) no cambia.
    assert.equal(d.result.profile.title, 'Ingreso estable y reserva limitada');
    assert.equal(d.result.first_action.code, 'DEBT_LIST');
  });
});

test('la salida de IA con cifras, promesas o hallazgos ajenos se rechaza y se usa la plantilla', async () => {
  const bad = {
    cifra: (o) => ({ ...o, profile_summary: `${o.profile_summary} Podrías ahorrar 45 mil al año.` }),
    promesa: (o) => ({ ...o, findings: o.findings.map((f, i) => (i ? f : { ...f, explanation: `${f.explanation} Te garantizamos resultados.` })) }),
    hallazgo: (o) => ({ ...o, findings: o.findings.slice(1) }),
    corto: (o) => ({ ...o, profile_summary: 'Todo bien.' }),
    forma: () => ({ texto: 'otra cosa' }),
  };
  for (const [name, mutate] of Object.entries(bad)) {
    await withAi(fakeModel(mutate), async (s) => {
      await h.queue.drain({ ignoreSchedule: true });
      const d = engine.getDiagnostic(s.id);
      assert.equal(d.status, 'ready', name);
      assert.equal(d.narrative_source, 'template', name);
      assert.doesNotMatch(JSON.stringify(d.result), /garantizamos|45 mil/, name);
    });
  }
});

test('si la IA falla, tras un reintento se publica con plantillas y no se pide repetir el test', async () => {
  let calls = 0;
  await withAi(async () => {
    calls++;
    throw new Error('timeout');
  }, async (s) => {
    await h.queue.drain({ ignoreSchedule: true });
    await h.queue.drain({ ignoreSchedule: true });
    assert.equal(calls, 2);
    const d = engine.getDiagnostic(s.id);
    assert.equal(d.status, 'ready');
    assert.equal(d.narrative_source, 'template');
    assert.equal(d.result.profile.title, 'Ingreso estable y reserva limitada');
  });
});

test('un error al generar deja failed con reintento disponible, sin pedir repetir las preguntas', () => {
  const s = engine.createSession({ consent: true }).session;
  for (const slot of SLOTS) put(s.id, slot, A()[slot]);
  const done = engine.complete(s.id);
  assert.equal(done.generation_status, 'ready');
  // Simula un fallo de datos al generar esta revisión.
  h.db.run('DELETE FROM ft_results WHERE session_id = ?', s.id);
  const bad = { I: { amount: 'no-es-un-numero', currency: 'USD' }, G: { amount: '1', currency: 'USD' }, D: { amount: '0', currency: 'USD' } };
  const row = resultSvc.generate(engine.loadSession(s.id), engine.activeAnswers(s.id), { monetary: bad });
  assert.equal(row.status, 'failed');
  assert.deepEqual(engine.getDiagnostic(s.id), { status: 'failed', retry_available: true });
  const retry = engine.retryDiagnostic(s.id);
  assert.equal(retry.generation_status, 'ready');
  assert.equal(engine.getDiagnostic(s.id).result.profile.title, 'Ingreso estable y reserva limitada');
  assert.equal(engine.loadSession(s.id).status, 'completada', 'no se pidió repetir las preguntas');
});

test('cliente OpenAI: formato de la petición, errores y tiempo de espera', async () => {
  let captured;
  const ok = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"a":1}' } }] }) };
  };
  const out = await openai.chatJson({ system: 'sys', user: 'usr', apiKey: 'sk-test', model: 'gpt-x', baseUrl: 'http://fake/v1', fetchImpl: ok });
  assert.deepEqual(out, { a: 1 });
  assert.equal(captured.url, 'http://fake/v1/chat/completions');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, 'gpt-x');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal('temperature' in body, false, 'gpt-6-luna no admite temperature: no se envía por defecto');
  assert.equal(captured.init.headers.authorization, 'Bearer sk-test');
  await assert.rejects(() => openai.chatJson({ system: 's', user: 'u', apiKey: '', model: 'm' }), /OPENAI_API_KEY/);
  await assert.rejects(() => openai.chatJson({ system: 's', user: 'u', apiKey: 'k', model: 'm', fetchImpl: async () => ({ ok: false, status: 429 }) }), /429/);
  await assert.rejects(() => openai.chatJson({ system: 's', user: 'u', apiKey: 'k', model: 'm', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [] }) }) }), /vacía/);
  await assert.rejects(
    () => openai.chatJson({ system: 's', user: 'u', apiKey: 'k', model: 'm', timeoutMs: 20, fetchImpl: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('abortado')))) }),
    /abortado/
  );
});

test('el prompt a la IA no incluye datos de identidad ni respuestas crudas', () => {
  const { result } = build(A());
  const prompt = narrative.buildPrompt(result);
  const all = `${prompt.system} ${prompt.user}`;
  assert.doesNotMatch(all, /ft_[0-9a-f]{8}|@|session_id|answer_revision/);
  assert.match(prompt.system, /No inventes/);
});
