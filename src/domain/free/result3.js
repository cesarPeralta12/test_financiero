'use strict';
// Diagnóstico gratuito V3 (RESULT_FREE_V3_ES, documentos 02, 06 y 07 del paquete V3).
// «El código valida los datos y cálculos; la IA elabora el análisis personalizado.»
//   1) El servidor arma el paquete: hechos con estado, métricas (metrics3), bloqueos,
//      restricciones y contradicciones. Nada se infiere: desconocido ≠ cero.
//   2) La IA (OpenAI, prompt FREE_PATRIMONIAL_V3_ES) interpreta y redacta según el
//      esquema estricto del ingeniero.
//   3) El servidor valida forma (esquema), evidencia, métricas citadas, cifras y
//      bloqueos. Si algo falla, publica un diagnóstico determinista de respaldo.
// Sin XP ni gamificación. La oferta (14 componentes + 2 herramientas) la añade el
// servidor desde OFFER_PM_V1_ES; la IA no la redacta.
const fs = require('node:fs');
const path = require('node:path');
const D = require('decimal.js');
const db = require('../../db');
const config = require('../../config');
const log = require('../../lib/log');
const queue = require('../../lib/queue');
const schemaLib = require('../../lib/jsonschema');
const openai = require('../ai/openai');
const knowledge = require('../knowledge');
const catalog = require('./catalog3');
const metrics3 = require('./metrics3');

const RULES_VERSION = 'RESULT_FREE_V3_ES';
const PROMPT_VERSION = 'FREE_PATRIMONIAL_V3_ES';
const VERSIONS = { knowledge: 'BCP_V2_ES', rules: 'RFP_V2_ES', prompts: 'POIA_V2_ES' };
const DIR = path.join(__dirname, '../knowledge/v3');
const PROMPT = fs.readFileSync(path.join(DIR, 'prompt_free_patrimonial_v3_es.txt'), 'utf8').trim();
const SCHEMA = JSON.parse(fs.readFileSync(path.join(DIR, 'free_result_v3.schema.json'), 'utf8'));
const API_SCHEMA = schemaLib.forStrictApi(SCHEMA);
const OFFER = JSON.parse(fs.readFileSync(path.join(DIR, 'offer_pm_v1_es.json'), 'utf8'));

let client = null; // inyectable en pruebas: async (prompt) => objeto JSON
function setClient(fn) {
  client = fn || null;
}
function aiEnabled() {
  return Boolean(client) || config.ai.openai.enabled;
}

// ───────── Paquete de hechos ─────────
const val = (answers, s) => (answers[s] && answers[s].status === 'answered' ? answers[s].value : null);
const statusOf = (answers, s, applicable) => (!applicable ? 'NO_APLICA' : !answers[s] ? 'DESCONOCIDO' : answers[s].status === 'answered' ? 'DECLARADO' : 'DESCONOCIDO');

function facts(session, answers) {
  const ctx = { get: (s) => answers[s] || null };
  return catalog.SLOTS.map((s) => {
    const applicable = catalog.applicable(s.slot_id, ctx);
    const a = answers[s.slot_id];
    return {
      id: s.slot_id,
      field: s.field,
      status: statusOf(answers, s.slot_id, applicable),
      reason: a && a.status === 'unknown' ? 'DK' : a && a.status === 'declined' ? 'PNA' : !applicable ? 'NO_DEBT_CONFIRMED' : null,
      value: a && a.status === 'answered' ? a.value : null,
      text: a ? catalog.answerText(a.variant_id, a) : null,
      answer_revision: a ? a.answer_revision : null,
    };
  });
}

/** Contradicciones entre respuestas (bloquean solo lo que dependa de ellas). */
function contradictions(answers) {
  const out = [];
  const q06 = val(answers, 'Q06');
  if (val(answers, 'Q07') === 'NO_INCOME' && q06 && q06.amount && new D(q06.amount).gt(0)) {
    out.push({ id: 'CTR_INCOME_ZERO', refs: ['Q06', 'Q07'], text: 'Indicas un ingreso mayor que cero y, a la vez, que hoy tu ingreso es cero.' });
  }
  const p10 = val(answers, 'Q10') && val(answers, 'Q10').presence;
  const p11 = val(answers, 'Q11') && val(answers, 'Q11').presence;
  if (p10 && p11 && ((p10 === 'NO' && p11 === 'YES') || (p10 === 'YES' && p11 === 'NO'))) {
    out.push({ id: 'CTR_DEBT_PRESENCE', refs: ['Q10', 'Q11'], text: 'En una respuesta dices que tienes deudas y en otra que no.' });
  }
  return out;
}

/** Bloqueos del servidor: lo que ninguna propuesta puede pedir. */
function blocks(answers, metrics) {
  const out = [];
  const budget = val(answers, 'Q24');
  const zeroBudget = !budget || (budget.amount !== null && new D(budget.amount).isZero()) || budget.available_now !== 'YES';
  if (zeroBudget) out.push({ id: 'PAID_ACTION', reason: 'Sin presupuesto disponible confirmado para probar: ningún paso que cueste dinero.' });
  const hours = val(answers, 'Q17');
  if (!hours || hours.hours === 0) out.push({ id: 'EXTRA_WORK', reason: 'Sin horas disponibles confirmadas: no proponer trabajo adicional.' });
  const pay = val(answers, 'Q12');
  const bal = metrics.find((m) => m.id === 'monthly_balance');
  if ((pay && ['OVERDUE_UNABLE', 'MINIMUM'].includes(pay.code)) || (bal && bal.value !== null && new D(bal.value).lt(0))) {
    out.push({ id: 'NEW_CREDIT', reason: 'Pagos con dificultad o saldo mensual negativo: no proponer deuda nueva.' });
    out.push({ id: 'SPECULATIVE_INVESTMENT', reason: 'Primero proteger obligaciones: no proponer inversiones de riesgo.' });
  }
  const route = val(answers, 'Q04') && val(answers, 'Q04').route;
  if (route === 'EMPLOYEE') out.push({ id: 'QUIT_JOB', reason: 'No recomendar dejar el empleo.' });
  return out;
}

/** Paquete que recibe la IA: solo datos de esta persona, sin identificadores. */
function buildPackage(session, answers) {
  const m = metrics3.compute(answers, session.currency);
  const f = facts(session, answers);
  return {
    meta: { purpose: 'free', language: 'es', catalog_version: catalog.VERSION_ID, knowledge_version: VERSIONS.knowledge, rules_version: VERSIONS.rules, prompt_version: PROMPT_VERSION, offer_id: OFFER.offer_id },
    currency: session.currency,
    respuestas: f.map((x) => ({ id: x.id, campo: x.field, estado: x.status, motivo: x.reason, respuesta: x.text })),
    metricas: m.metrics.map((x) => ({ id: x.id, etiqueta: x.label, valor: x.value, unidad: x.unit, formula: x.formula, aproximado: x.approximate, motivo_si_falta: x.reason })),
    contradicciones: contradictions(answers),
    bloqueos: blocks(answers, m.metrics),
    restricciones: val(answers, 'Q23'),
    _facts: f,
    _metrics: m,
  };
}

// ───────── Validación semántica de la salida ─────────
// Promesas de resultado, órdenes de riesgo y gamificación. Las advertencias
// responsables («no garantiza», «sin garantía») se quitan antes de comprobar.
const BANNED = /garantiz|asegur(amos|ado)|sin riesgo|rentabilidad (asegurada|garantizada)|vas a (ganar|duplicar)|seguro que (vas|ganar)|invierte en |pide un (préstamo|crédito)|\b(renuncia|deja) (a )?tu (empleo|trabajo)\b|\bxp\b|nivel \d|\blogros?\b|insignia/i;
const NEGATED = /\b(no|ni|sin|nunca)\s+((se|te|le|lo|nos|les)\s+)?(garantiz\w*|garantías?|asegur\w*)/gi;
// Gasto en algo nuevo; pagar deudas existentes sí puede ser el paso correcto.
const PAID_HINT = /\b(compra|comprar|contrata|contratar|invierte|invertir|publicidad|anuncios?|gasta en|gastar en|inscríbete|matricúlate)\b/i;

function collectStrings(o, out = []) {
  if (typeof o === 'string') out.push(o);
  else if (Array.isArray(o)) o.forEach((x) => collectStrings(x, out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (!['evidence_refs', 'metric_refs', 'schema_version', 'catalog_version', 'offer_id', 'kind', 'status', 'field'].includes(k)) collectStrings(v, out);
  return out;
}

/** Valida forma y contenido. Devuelve { ok, reason }. */
function validateOutput(out, pkg) {
  const shape = schemaLib.check(SCHEMA, out);
  if (shape) return { ok: false, reason: `SCHEMA: ${shape}` };
  const ids = new Set(catalog.SLOTS.map((s) => s.slot_id));
  const known = new Set(pkg._facts.filter((x) => x.status === 'DECLARADO').map((x) => x.id));
  const metricOk = new Set(pkg._metrics.metrics.filter((x) => x.value !== null).map((x) => x.id));
  const refsOf = (o, acc = []) => {
    if (Array.isArray(o)) o.forEach((x) => refsOf(x, acc));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) (k === 'evidence_refs' ? acc.push(...v) : refsOf(v, acc));
    return acc;
  };
  for (const r of refsOf(out)) {
    const id = String(r).slice(0, 3);
    if (!ids.has(id)) return { ok: false, reason: `EVIDENCE_UNKNOWN_ID ${r}` };
  }
  // La conclusión debe apoyarse al menos en una respuesta realmente declarada.
  if (!out.conclusion.evidence_refs.some((r) => known.has(String(r).slice(0, 3)))) return { ok: false, reason: 'CONCLUSION_WITHOUT_EVIDENCE' };
  for (const ins of out.insights) for (const m of ins.metric_refs) if (!metricOk.has(m)) return { ok: false, reason: `METRIC_NOT_AVAILABLE ${m}` };
  const texts = collectStrings(out);
  const allowed = metrics3.authorizedNumbers(Object.fromEntries(pkg._facts.filter((x) => x.value !== null).map((x) => [x.id, { status: 'answered', value: x.value }])), pkg._metrics.metrics);
  for (const t of texts) {
    const bad = t.replace(NEGATED, '').match(BANNED);
    if (bad) return { ok: false, reason: `BANNED_TERM ${bad[0].trim()}` };
    // Cualquier cifra debe ser un dato declarado o una métrica del servidor (se toleran
    // conteos pequeños como «tres trabajos» escritos con cifras del 1 al 12).
    for (const raw of t.match(/\d[\d.,]*\d|\d/g) || []) {
      const n = raw.replace(/[.,]$/, '');
      if (/^\d{1,2}$/.test(n) && Number(n) <= 12) continue;
      const variants = [n, n.replace(/\./g, ''), n.replace(/\./g, '').replace(',', '.'), n.replace(/,/g, '')];
      if (!variants.some((x) => allowed.has(x) || allowed.has(String(Number(x))))) return { ok: false, reason: `UNAUTHORIZED_NUMBER ${n}` };
    }
  }
  const blocked = new Set(pkg.bloqueos.map((b) => b.id));
  if (blocked.has('PAID_ACTION') && PAID_HINT.test(out.first_action.instruction)) return { ok: false, reason: 'PAID_ACTION_BLOCKED' };
  if (out.offer_id !== OFFER.offer_id) return { ok: false, reason: 'OFFER_ID' };
  return { ok: true };
}

// ───────── Respaldo determinista ─────────
function fmt(currency, v) {
  const cur = currency === 'BOB' ? 'Bs' : currency;
  return `${new D(v).lt(0) ? '−' : ''}${cur} ${catalog.fmtNum(v)}`;
}

function template(pkg, answers) {
  const cur = pkg.currency;
  const M = Object.fromEntries(pkg._metrics.metrics.map((m) => [m.id, m]));
  const has = (id) => M[id] && M[id].value !== null;
  const num = (id) => (has(id) ? new D(M[id].value) : null);
  const q = (s) => val(answers, s);
  const route = q('Q04') && q('Q04').route;
  const paid = q('Q20') && q('Q20').paid_before === 'YES';
  const skills = q('Q18') && q('Q18').skills;
  const hours = q('Q17') ? q('Q17').hours : null;
  const access = q('Q21') && q('Q21').text;
  const pay = q('Q12') && q('Q12').code;
  const bal = num('monthly_balance');
  const gap = num('essential_gap');
  const blocked = new Set(pkg.bloqueos.map((b) => b.id));

  let title;
  let interpretation;
  const refs = ['Q06', 'Q08', 'Q09', 'Q10'];
  if (pay === 'OVERDUE_UNABLE') {
    title = 'Tus pagos atrasados son lo primero que hay que ordenar';
    interpretation = 'Indicas pagos vencidos que hoy no puedes cubrir. Antes de buscar nuevas oportunidades conviene saber exactamente qué debes, a quién y qué opciones de pago existen, para que el atraso no siga creciendo.';
    refs.push('Q12');
  } else if (bal === null) {
    title = 'Para orientarte con precisión faltan algunos números';
    interpretation = 'Con tus respuestas todavía no podemos calcular cuánto te queda al mes. Te proponemos un primer paso que no depende de ese dato y te pedimos lo mínimo que falta para completar la lectura.';
  } else if (bal.lt(0)) {
    title = 'Hoy tus gastos y cuotas superan lo que recibes';
    interpretation = `Con tus promedios declarados, el mes cierra en ${fmt(cur, M.monthly_balance.value)}. Antes de pensar en crecer conviene saber de dónde sale esa diferencia y qué ingreso adicional realista podría cubrirla.`;
  } else if (paid) {
    title = 'Ya cobras por algo que sabes hacer: conviene medirlo antes de crecer';
    interpretation = `Tu mes cierra con un margen aproximado de ${fmt(cur, M.monthly_balance.value)} y ya te han pagado por una habilidad fuera de tu actividad principal. Saber cuánto te deja cada trabajo te dirá si vale la pena hacer más de lo mismo o cambiar de oferta.`;
    refs.push('Q20');
  } else {
    title = 'Tienes margen: la clave es decidir a dónde va';
    interpretation = `Con tus promedios declarados te queda aproximadamente ${fmt(cur, M.monthly_balance.value)} al mes. Ese margen puede convertirse en reserva, en pago de deudas o en una prueba para generar más ingresos; conviene decidirlo con intención.`;
  }

  const insights = [];
  if (gap !== null && bal !== null && !gap.eq(bal)) {
    insights.push({ title: 'Lo básico y tus cuotas frente a tu ingreso', meaning: `Sin contar los otros gastos, tu ingreso deja ${fmt(cur, M.essential_gap.value)} después de lo básico y las cuotas.`, implication: gap.lt(0) ? 'Lo esencial ya no alcanza: cualquier imprevisto obliga a usar reservas o deuda.' : 'La diferencia con lo que realmente te queda está en los otros gastos: ahí hay espacio para decidir.', evidence_refs: ['Q06', 'Q08', 'Q10'], metric_refs: ['essential_gap'] });
  }
  if (has('committed_reserve_months')) {
    const r = num('committed_reserve_months');
    insights.push({ title: 'Tu reserva frente a tus compromisos', meaning: `Tu reserva cubre aproximadamente ${String(M.committed_reserve_months.value).replace('.', ',')} meses de gastos básicos y cuotas.`, implication: r.lt(1) ? 'Es una reserva pequeña: un mes difícil la agotaría.' : 'Te da cierto margen para probar cambios sin poner en riesgo lo básico.', evidence_refs: ['Q14', 'Q08', 'Q10'], metric_refs: ['committed_reserve_months'] });
  }
  if (has('income_goal_gap')) {
    insights.push({ title: 'La distancia a tu objetivo', meaning: `Para llegar al ingreso que te propusiste faltan aproximadamente ${fmt(cur, M.income_goal_gap.value)} al mes.`, implication: 'Antes de fijar cuántas ventas o clientes necesitas hay que saber cuánto te deja cada uno y cuánto tiempo te toma.', evidence_refs: ['Q05', 'Q06'], metric_refs: ['income_goal_gap'] });
  }

  const b = q('Q22');
  const bottleneck = b
    ? { interpretation: `Señalas como principal obstáculo: ${catalog.labelFor(answers.Q22.variant_id, b.code).toLowerCase()}${b.detail ? ` (${b.detail})` : ''}. Lo tomamos como punto de partida, aunque todavía hay que comprobar su peso real.`, status: 'supported', evidence_refs: ['Q22'] }
    : { interpretation: 'No conocemos todavía qué te impide aumentar tus ingresos; es una de las primeras cosas que conviene aclarar.', status: 'insufficient', evidence_refs: ['Q22'] };

  let opportunity = null;
  if ((paid || skills) && hours && hours > 0 && !blocked.has('EXTRA_WORK')) {
    opportunity = {
      title: paid ? 'Ordenar y repetir lo que ya te pagan' : 'Probar si alguien pagaría por lo que sabes hacer',
      hypothesis: paid ? 'Puede que tus trabajos fuera de tu actividad principal tengan más demanda o margen del que aprovechas hoy.' : 'Lo que declaras saber hacer podría resolver un problema concreto para alguien de tu entorno.',
      why_this_person: [skills ? `Declaras saber: ${skills}.` : null, paid ? 'Ya te han pagado por ello.' : null, access ? `Tienes acceso a: ${access}.` : null, `Dispones de ${hours} horas por semana.`].filter(Boolean).join(' '),
      alternative: route === 'EMPLOYEE' ? 'Mejorar tu ingreso en tu empleo actual, si conoces el camino y sus requisitos.' : 'Mejorar los precios o costos de lo que ya haces antes de buscar algo nuevo.',
      test: access ? 'Conversa con una o dos personas de tu entorno sobre qué necesitan y en qué momento, sin vender todavía.' : 'Identifica a una persona que tenga ese problema y pregúntale cómo lo resuelve hoy.',
      continue_if: 'Encuentras una necesidad concreta que puedes atender dentro de tus horarios y restricciones.',
      revise_if: 'La necesidad exige más tiempo, dinero o disponibilidad de la que tienes.',
      unknowns: ['Si hay demanda real y cuánto pagarían.', 'Cuánto te dejaría cada trabajo después de costos.'],
      evidence_refs: ['Q17', 'Q18', 'Q20', 'Q21', 'Q23'],
    };
  }

  let first;
  if (pay === 'OVERDUE_UNABLE') first = { kind: 'CONTACT', instruction: 'Haz una lista de cada pago vencido con a quién le debes, cuánto y desde cuándo, y comunícate con el acreedor más urgente para preguntar qué opciones de pago ofrece.', why_now: 'Los atrasos suelen sumar intereses y cargos cada semana.', done_when: 'Tienes la lista completa y hablaste con al menos un acreedor.', resource_fit: 'Solo requiere tu teléfono y tiempo; sin gasto.', risk: 'No aceptes un nuevo préstamo para pagar otro sin comparar condiciones.', evidence_refs: ['Q10', 'Q11', 'Q12'] };
  else if (bal !== null && bal.lt(0)) first = { kind: 'RECORD', instruction: 'Durante dos semanas anota cada gasto y cada ingreso, marcando qué es básico y qué no.', why_now: 'Necesitas ver de dónde sale la diferencia antes de decidir qué cambiar.', done_when: 'Tienes dos semanas registradas y sabes qué gastos explican la diferencia.', resource_fit: 'Basta una libreta o el teléfono; sin gasto.', risk: 'No recortes gastos de salud o alimentación sin revisar antes las otras opciones.', evidence_refs: ['Q06', 'Q08', 'Q09'] };
  else if (paid) first = { kind: 'COMPARE', instruction: 'Reconstruye tus últimos tres trabajos pagados: cuánto cobraste, cuánto gastaste en materiales y transporte, y cuánto tiempo te tomó. Marca como pendiente lo que no recuerdes.', why_now: 'Sin saber cuánto te deja cada trabajo no sabes cuál conviene repetir.', done_when: 'Puedes comparar esos trabajos o sabes exactamente qué datos te faltan.', resource_fit: 'Usa tus propios registros; sin gasto.', risk: 'No uses información confidencial de tu empleador.', evidence_refs: ['Q20', 'Q22'] };
  else if (skills && hours) first = { kind: 'CONTACT', instruction: 'Elige una de tus habilidades y conversa con dos personas que podrían necesitarla para entender qué problema tienen hoy. No vendas todavía.', why_now: 'Saber si hay una necesidad real evita invertir tiempo en algo que nadie pide.', done_when: 'Hablaste con dos personas y anotaste qué necesitan.', resource_fit: `Cabe en tus ${hours} horas semanales; sin gasto.`, risk: 'No prometas plazos ni precios antes de comprobar que puedes cumplir.', evidence_refs: ['Q17', 'Q18', 'Q21'] };
  else first = { kind: 'CLARIFY', instruction: 'Escribe una tarea concreta que hayas resuelto bien y qué resultado obtuviste. Es la base para encontrar cómo generar más ingresos.', why_now: 'Sin ese ejemplo no podemos proponerte una oportunidad que encaje contigo.', done_when: 'Tienes por escrito una tarea y su resultado.', resource_fit: 'Toma menos de una hora; sin gasto.', risk: 'Ninguno: solo ordena información que ya tienes.', evidence_refs: ['Q18'] };

  const budget = q('Q24');
  let decision = null;
  if (budget && budget.amount && new D(budget.amount).gt(0) && opportunity) decision = { decision: 'Gastar tu presupuesto de prueba en publicidad o materiales de inmediato.', reason: 'Primero conviene comprobar que hay una necesidad real y cuánto dejaría cada trabajo.', evidence_refs: ['Q24', 'Q22'] };
  else if (blocked.has('NEW_CREDIT')) decision = { decision: 'Pedir un crédito nuevo para cubrir el mes.', reason: 'Con pagos en dificultad, una deuda nueva suele empeorar el problema que intenta resolver.', evidence_refs: ['Q12', 'Q10'] };

  const missing = [];
  const askIf = (s, field, question, why) => {
    if (missing.length < 3 && (!answers[s] || answers[s].status !== 'answered')) missing.push({ field, question, why });
  };
  askIf('Q06', 'net_income_month', '¿Cuánto recibes en un mes normal, después de los costos de tu actividad?', 'Sin este dato no podemos calcular tu margen.');
  askIf('Q08', 'essential_expense_month', '¿Cuánto necesitas al mes para lo básico?', 'Permite saber cuánto margen real tienes.');
  askIf('Q13', 'debt_cost', '¿Qué tasa de interés tiene tu deuda más preocupante?', 'Sin la tasa no se puede comparar qué deuda conviene atacar primero.');
  askIf('Q18', 'skill_evidence', '¿Qué tarea concreta has resuelto bien y con qué resultado?', 'Es la base para proponerte una oportunidad que encaje contigo.');
  askIf('Q14', 'emergency_cash', '¿Cuánto dinero tienes disponible para una emergencia?', 'Permite saber cuánto tiempo podrías sostenerte ante un imprevisto.');

  return {
    schema_version: RULES_VERSION,
    catalog_version: catalog.VERSION_ID,
    conclusion: { title, interpretation, evidence_refs: refs },
    insights: insights.slice(0, 3),
    bottleneck,
    opportunity,
    first_action: first,
    decision_to_review: decision,
    growth_direction: { text: opportunity ? 'Primero ordenar tus números y comprobar una oportunidad concreta; si funciona, decidir cómo repartir el ingreso adicional entre reserva, obligaciones y tus objetivos.' : 'Primero ordenar tus números y aclarar lo que falta; con eso podremos proponerte una vía de crecimiento que encaje con tu tiempo y tus recursos.', evidence_refs: ['Q05', 'Q17'] },
    missing_data: missing,
    offer_id: OFFER.offer_id,
  };
}

// ───────── Generación y persistencia ─────────
function stamp(pkg, extra = {}) {
  return knowledge.stamp({
    knowledge_version: VERSIONS.knowledge,
    rules_framework_version: VERSIONS.rules,
    prompts_version: VERSIONS.prompts,
    catalog_version: catalog.VERSION_ID,
    result_rules_version: RULES_VERSION,
    result_schema_version: RULES_VERSION,
    metrics_version: metrics3.VERSION,
    prompt_version: null,
    model: null,
    ...extra,
  });
}

/** Resultado que se guarda: diagnóstico + métricas + oferta + trazabilidad. */
function envelope(session, pkg, diagnosis, source, extra = {}) {
  return {
    ...diagnosis,
    result_rules_version: RULES_VERSION,
    status: 'ready',
    narrative_source: source,
    generated_at: db.now(),
    currency: session.currency,
    metrics: pkg._metrics.metrics,
    contradictions: pkg.contradicciones,
    offer: OFFER,
    traceability: stamp(pkg, extra),
  };
}

function generate(session, answers) {
  const existing = db.one('SELECT * FROM ft_results WHERE session_id = ? AND answer_revision = ? AND rules_version = ?', session.id, session.revision, RULES_VERSION);
  if (existing) return existing;
  const now = db.now();
  const pkg = buildPackage(session, answers);
  const result = envelope(session, pkg, template(pkg, answers), 'template');
  const inputHash = require('node:crypto').createHash('sha256').update(JSON.stringify({ v: RULES_VERSION, r: pkg.respuestas, m: pkg.metricas })).digest('hex');
  result.traceability.input_hash = inputHash;
  const wantsAi = aiEnabled();
  result.status = wantsAi ? 'pending' : 'ready';
  const stored = { ...pkg, _facts: undefined, _metrics: undefined };
  const r = db.run(
    `INSERT INTO ft_results (session_id, answer_revision, rules_version, status, narrative_source, result_json, created_at, updated_at,
       catalog_version, knowledge_version, rules_framework_version, prompt_version, model, result_schema_version, methodology_hash, input_hash, fact_package_json)
     VALUES (?, ?, ?, ?, 'template', ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    session.id,
    session.revision,
    RULES_VERSION,
    result.status,
    JSON.stringify(result),
    now,
    now,
    catalog.VERSION_ID,
    VERSIONS.knowledge,
    VERSIONS.rules,
    RULES_VERSION,
    result.traceability.methodology_hash,
    inputHash,
    JSON.stringify(stored)
  );
  if (wantsAi) queue.enqueue('free_v3_diagnosis', { resultId: r.lastId }, { maxAttempts: 2 });
  return db.one('SELECT * FROM ft_results WHERE id = ?', r.lastId);
}

function buildPrompt(pkg) {
  const user = JSON.stringify({ ...pkg, _facts: undefined, _metrics: undefined });
  const system = `${PROMPT}\n\nFormato de cifras: escribe los montos tal como aparecen en las respuestas o métricas, con el símbolo de la moneda (${pkg.currency === 'BOB' ? 'Bs' : pkg.currency}). Español neutro, cercano y directo.`;
  return { system, user };
}

async function callModel(prompt) {
  if (client) return { json: await client(prompt), usage: null, latencyMs: null, model: 'cliente_de_prueba' };
  return openai.chat({ ...prompt, ...config.ai.openai, schema: API_SCHEMA, schemaName: 'diagnostico_gratuito_v3', timeoutMs: Math.max(config.ai.openai.timeoutMs, 45000) });
}

function finish(row, result, source, meta, reason) {
  result.status = 'ready';
  result.narrative_source = source;
  Object.assign(result.traceability, { prompt_version: source === 'ai' ? PROMPT_VERSION : null, model: source === 'ai' ? meta && meta.model : null, ai_usage: meta, ai_fallback_reason: reason || null });
  log.info('Diagnóstico gratuito V3', { result: row.id, source, reason: reason || null, ...(meta || {}) });
  db.run(
    "UPDATE ft_results SET status = 'ready', narrative_source = ?, result_json = ?, prompt_version = ?, model = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
    source,
    JSON.stringify(result),
    result.traceability.prompt_version,
    result.traceability.model,
    db.now(),
    row.id
  );
}

/** Trabajo de cola: pide el análisis a la IA, lo valida y lo publica; si falla, deja el respaldo. */
async function handle({ resultId }, job) {
  const row = db.one('SELECT * FROM ft_results WHERE id = ?', resultId);
  if (!row || row.status !== 'pending') return;
  const result = db.parse(row.result_json);
  const session = db.one('SELECT * FROM ft_sessions WHERE id = ?', row.session_id);
  const answers = {};
  for (const a of db.all('SELECT * FROM ft_answers WHERE session_id = ? AND active = 1', row.session_id)) answers[a.slot_id] = { slot_id: a.slot_id, variant_id: a.variant_id, status: a.response_status, value: db.parse(a.value_json, null), answer_revision: a.answer_revision };
  const pkg = buildPackage(session, answers);
  let call;
  try {
    call = await callModel(buildPrompt(pkg));
  } catch (err) {
    if (job && job.attempts < job.max_attempts) throw err;
    log.warn('IA no disponible para el diagnóstico V3; se usa el respaldo', { result: resultId, error: String(err.message).slice(0, 120) });
    return finish(row, result, 'template', null, 'PROVIDER_ERROR');
  }
  const u = call.usage || {};
  const meta = { model: call.model, latency_ms: call.latencyMs, input_tokens: u.prompt_tokens ?? null, output_tokens: u.completion_tokens ?? null };
  const check = validateOutput(call.json, pkg);
  if (!check.ok) {
    log.warn('Diagnóstico V3 de la IA rechazado; se usa el respaldo', { result: resultId, reason: check.reason });
    return finish(row, result, 'template', meta, check.reason);
  }
  const keep = { input_hash: result.traceability.input_hash };
  const fresh = envelope(session, pkg, call.json, 'ai');
  fresh.traceability.input_hash = keep.input_hash;
  finish(row, fresh, 'ai', meta, null);
}

queue.register('free_v3_diagnosis', handle);

module.exports = { RULES_VERSION, PROMPT_VERSION, VERSIONS, SCHEMA, API_SCHEMA, OFFER, setClient, aiEnabled, buildPackage, validateOutput, template, generate, handle, buildPrompt, contradictions, blocks };
