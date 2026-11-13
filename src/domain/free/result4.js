'use strict';
// Resultado gratuito V4 (RESULT_FREE_V4_ES) para el catálogo FREE_24_V4_ES.
// Mismo principio que V3: el servidor calcula y valida; la IA redacta en lenguaje simple
// sin inventar números, habilidades, demanda ni resultados. La página se organiza en
// los siete bloques del documento de correcciones (A título personal, B foto de hoy,
// C hallazgo principal, D oportunidad, E primer paso, F lo que falta saber, G oferta).
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
const catalog = require('./catalog4');
const metrics4 = require('./metrics4');
const r3 = require('./result3');

const RULES_VERSION = 'RESULT_FREE_V4_ES';
const PROMPT_VERSION = 'FREE_PATRIMONIAL_V4_ES';
const VERSIONS = r3.VERSIONS;
const DIR = path.join(__dirname, '../knowledge/v4');
const PROMPT = fs.readFileSync(path.join(DIR, 'prompt_free_patrimonial_v4_es.txt'), 'utf8').trim();
const SCHEMA = JSON.parse(fs.readFileSync(path.join(DIR, 'free_result_v4.schema.json'), 'utf8'));
const API_SCHEMA = schemaLib.forStrictApi(SCHEMA);
const OFFER = r3.OFFER;

// Reglas propias del test V4 que se añaden al prompt del ingeniero.
const V4_RULES = `REGLAS DEL TEST V4: las respuestas se dieron con botones. Las habilidades (Q17) y la experiencia (Q18) son declaradas: escribe «declaras…», nunca las presentes como capacidades comprobadas. Q19 dice si ya las usó en trabajos reales; no supongas ingresos futuros. Q20 son grupos a los que podría ofrecer algo: conocer personas no significa que comprarán. El tiempo (Q16) es un rango: no inventes una cantidad exacta de horas. En Q23 «Tal vez» no es dinero disponible. Este test no pregunta tasas de interés: no las pidas ni las supongas; el detalle de deudas es del diagnóstico completo. Respeta todas las condiciones de Q22. Si la persona es menor de 18 años, no propongas ventas, compras ni compromisos económicos. Evita etiquetas humillantes, urgencia artificial y rentabilidades o plazos de enriquecimiento.`;

let client = null;
function setClient(fn) {
  client = fn || null;
}
function aiEnabled() {
  return Boolean(client) || config.ai.openai.enabled;
}

const val = (answers, s) => (answers[s] && answers[s].status === 'answered' ? answers[s].value : null);
const codes = (answers, s) => (val(answers, s) ? val(answers, s).codes : []);
const label = (answers, s, code) => catalog.labelFor(answers[s].variant_id, code);

// ───────── Paquete de hechos ─────────
function facts(session, answers) {
  const ctx = { get: (s) => answers[s] || null };
  return catalog.SLOTS.map((s) => {
    const applicable = catalog.applicable(s.slot_id, ctx);
    const a = answers[s.slot_id];
    return {
      id: s.slot_id,
      field: s.field,
      status: !applicable ? 'NO_APLICA' : a && a.status === 'answered' ? 'DECLARADO' : 'DESCONOCIDO',
      reason: a && a.status === 'unknown' ? 'DK' : a && a.status === 'declined' ? 'PNA' : !applicable ? 'SALTO' : null,
      value: a && a.status === 'answered' ? a.value : null,
      text: a ? catalog.answerText(a.variant_id, a) : null,
    };
  });
}

function contradictions(answers) {
  const out = [];
  const q10 = val(answers, 'Q10');
  if (q10 && q10.status !== 'NO' && codes(answers, 'Q11').includes('NONE')) {
    out.push({ id: 'CTR_DEBT_PRESENCE', refs: ['Q10', 'Q11'], text: 'En la pregunta 10 indicas deudas y en la 11 que no tienes. Tomamos «No tengo deudas».' });
  }
  return out;
}

function isMinor(answers) {
  return codes(answers, 'Q02').includes('LT18');
}

function blocks(answers, metrics) {
  const out = [];
  const budget = val(answers, 'Q23');
  const zeroBudget = !budget || budget.availability !== 'YES' || !budget.money || (budget.money.amount !== null && new D(budget.money.amount).isZero());
  if (zeroBudget) out.push({ id: 'PAID_ACTION', reason: 'Sin dinero disponible confirmado para probar: ningún paso que cueste dinero.' });
  const hours = codes(answers, 'Q16')[0];
  if (!hours || hours === 'H0') out.push({ id: 'EXTRA_WORK', reason: 'Sin tiempo disponible confirmado: no proponer trabajo adicional; explorar mejoras en su actividad actual.' });
  const pay = codes(answers, 'Q12')[0];
  const bal = metrics.find((m) => m.id === 'monthly_balance');
  if (['MINIMUM', 'LATE', 'UNABLE'].includes(pay) || (bal && bal.value !== null && new D(bal.value).lt(0))) {
    out.push({ id: 'NEW_CREDIT', reason: 'Pagos con dificultad o saldo mensual negativo: no proponer deuda nueva.' });
    out.push({ id: 'SPECULATIVE_INVESTMENT', reason: 'Primero proteger obligaciones: no proponer inversiones de riesgo.' });
  }
  if (codes(answers, 'Q04')[0] === 'EMPLOYEE' || codes(answers, 'Q22').includes('KEEP_JOB')) out.push({ id: 'QUIT_JOB', reason: 'No recomendar dejar el empleo.' });
  if (isMinor(answers)) out.push({ id: 'MINOR', reason: 'Persona menor de 18 años: sin ventas, compras ni compromisos económicos.' });
  return out;
}

function buildPackage(session, answers) {
  const m = metrics4.compute(answers, session.currency);
  const f = facts(session, answers);
  return {
    meta: { purpose: 'free', language: 'es', catalog_version: catalog.VERSION_ID, knowledge_version: VERSIONS.knowledge, rules_version: VERSIONS.rules, prompt_version: PROMPT_VERSION, offer_id: OFFER.offer_id },
    currency: session.currency,
    respuestas: f.map((x) => ({ id: x.id, campo: x.field, estado: x.status, motivo: x.reason, respuesta: x.text })),
    metricas: m.metrics.map((x) => ({ id: x.id, etiqueta: x.label, valor: x.value, unidad: x.unit, formula: x.formula, aproximado: x.approximate, motivo_si_falta: x.reason })),
    saldo_en_rango: m.balance_range,
    contradicciones: contradictions(answers),
    bloqueos: blocks(answers, m.metrics),
    restricciones: val(answers, 'Q22'),
    _facts: f,
    _metrics: m,
  };
}

// ───────── Validación de la salida de la IA ─────────
const BANNED = /garantiz|asegur(amos|ado)|sin riesgo|rentabilidad (asegurada|garantizada)|vas a (ganar|duplicar)|seguro que (vas|ganar)|invierte en |pide un (préstamo|crédito)|\b(renuncia|deja) (a )?tu (empleo|trabajo)\b|\bxp\b|nivel \d|\blogros?\b|insignia|tasa de inter[eé]s/i;
const NEGATED = /\b(no|ni|sin|nunca)\s+((se|te|le|lo|nos|les)\s+)?(garantiz\w*|garantías?|asegur\w*)/gi;
const PAID_HINT = /\b(compra|comprar|contrata|contratar|invierte|invertir|publicidad|anuncios?|gasta en|gastar en|inscríbete|matricúlate)\b/i;
const SELL_HINT = /\b(vend[ea]r?|vendes|cobra[rs]?|ofrece[rs]?|cotiza[rs]?)\b/i;

function collectStrings(o, out = []) {
  if (typeof o === 'string') out.push(o);
  else if (Array.isArray(o)) o.forEach((x) => collectStrings(x, out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (!['evidence_refs', 'metric_refs', 'schema_version', 'catalog_version', 'offer_id', 'kind', 'status', 'field'].includes(k)) collectStrings(v, out);
  return out;
}

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
  for (const r of refsOf(out)) if (!ids.has(String(r).slice(0, 3))) return { ok: false, reason: `EVIDENCE_UNKNOWN_ID ${r}` };
  if (!out.conclusion.evidence_refs.some((r) => known.has(String(r).slice(0, 3)))) return { ok: false, reason: 'CONCLUSION_WITHOUT_EVIDENCE' };
  for (const ins of out.insights) for (const m of ins.metric_refs) if (!metricOk.has(m)) return { ok: false, reason: `METRIC_NOT_AVAILABLE ${m}` };
  const range = pkg._metrics.balance_range;
  const allowed = metrics4.authorizedNumbers(Object.fromEntries(pkg._facts.filter((x) => x.value !== null).map((x) => [x.id, { status: 'answered', value: x.value }])), pkg._metrics.metrics, range ? [range.min, range.max] : []);
  for (const t of collectStrings(out)) {
    const bad = t.replace(NEGATED, '').match(BANNED);
    if (bad) return { ok: false, reason: `BANNED_TERM ${bad[0].trim()}` };
    for (const raw of t.match(/\d[\d.,]*\d|\d/g) || []) {
      const n = raw.replace(/[.,]$/, '');
      if (/^\d{1,2}$/.test(n) && Number(n) <= 12) continue;
      const variants = [n, n.replace(/\./g, ''), n.replace(/\./g, '').replace(',', '.'), n.replace(/,/g, '')];
      if (!variants.some((x) => allowed.has(x) || allowed.has(String(Number(x))))) return { ok: false, reason: `UNAUTHORIZED_NUMBER ${n}` };
    }
  }
  const blocked = new Set(pkg.bloqueos.map((b) => b.id));
  if (blocked.has('PAID_ACTION') && PAID_HINT.test(out.first_action.instruction)) return { ok: false, reason: 'PAID_ACTION_BLOCKED' };
  if (blocked.has('MINOR') && SELL_HINT.test(out.first_action.instruction)) return { ok: false, reason: 'MINOR_SELLING' };
  if (out.offer_id !== OFFER.offer_id) return { ok: false, reason: 'OFFER_ID' };
  return { ok: true };
}

// ───────── Respaldo determinista ─────────
function fmt(currency, v) {
  const cur = currency === 'BOB' ? 'Bs' : currency;
  return `${new D(v).lt(0) ? '−' : ''}${cur} ${catalog.fmtNum(v)}`;
}
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
// Grupos de Q20 en segunda persona para el texto («clientes que ya tuviste»).
const AUDIENCE_2P = { PAST_CLIENTS: 'clientes que ya tuviste', BUSINESS_CLIENTS: 'clientes de tu negocio', FRIENDS: 'amigos o familiares', BUSINESSES: 'negocios que conoces', WORK: 'contactos de trabajo', FOLLOWERS: 'personas que te siguen en redes', OTHER: 'personas de tu entorno' };

function template(pkg, answers) {
  const cur = pkg.currency;
  const M = Object.fromEntries(pkg._metrics.metrics.map((m) => [m.id, m]));
  const num = (id) => (M[id] && M[id].value !== null ? new D(M[id].value) : null);
  const bal = num('monthly_balance');
  const reserve = num('committed_reserve_months');
  const blocked = new Set(pkg.bloqueos.map((b) => b.id));
  const debt = val(answers, 'Q10');
  const hasDues = Boolean(debt && debt.status === 'DUE') && !codes(answers, 'Q11').includes('NONE');
  const andDues = hasDues ? ' y cuotas' : '';
  const pay = codes(answers, 'Q12')[0];
  const variability = codes(answers, 'Q07')[0];
  const skills = codes(answers, 'Q17').filter((c) => !['UNSURE'].includes(c));
  const exp = codes(answers, 'Q18').filter((c) => c !== 'NONE');
  const used = codes(answers, 'Q19');
  const paid = used.some((c) => ['PAID_JOB', 'PAID_SIDE'].includes(c));
  const audience = codes(answers, 'Q20').filter((c) => !['NOBODY', 'UNSURE'].includes(c));
  const hours = codes(answers, 'Q16')[0];
  const minor = blocked.has('MINOR');

  // Prioridad del hallazgo (§6): no cubrir gastos o pagos → poca reserva o ingreso variable → aumentar ingresos → objetivos.
  let title;
  let interpretation;
  let refs = ['Q06', 'Q08', 'Q09', 'Q10'];
  if (pay === 'UNABLE' || pay === 'LATE') {
    title = 'Tus pagos atrasados son lo primero que hay que ordenar';
    interpretation = 'Indicas pagos que hoy te cuesta cubrir. Antes de buscar nuevas oportunidades conviene saber qué debes, a quién y qué opciones de pago existen, para que el atraso no siga creciendo.';
    refs = ['Q10', 'Q12'];
  } else if (bal === null) {
    title = 'Para orientarte con precisión faltan algunos números';
    interpretation = 'Con tus respuestas todavía no podemos calcular cuánto te queda al mes. Te proponemos un primer paso que no depende de ese dato.';
  } else if (bal.isZero()) {
    title = `Tus gastos${andDues} parecen consumir todo lo que recibes`;
    interpretation = `Con los montos que declaraste no te queda margen al mes (${fmt(cur, '0')}). Cualquier imprevisto te obligaría a usar ahorros o pedir prestado; el primer paso es encontrar un gasto que puedas ajustar.`;
  } else if (bal.lt(0)) {
    title = `Tus gastos${andDues} parecen superar lo que recibes`;
    interpretation = `Con los montos que declaraste, el mes cierra en ${fmt(cur, M.monthly_balance.value)}. Antes de pensar en crecer conviene ver de dónde sale esa diferencia.`;
  } else if ((reserve !== null && reserve.lt(1)) || ['HIGH', 'DECREASING'].includes(variability)) {
    title = 'Tienes margen mensual, pero poco respaldo ante un imprevisto';
    interpretation = `Te quedan aproximadamente ${fmt(cur, M.monthly_balance.value)} al mes, pero ${reserve !== null && reserve.lt(1) ? 'tu dinero guardado no alcanza para un mes de gastos' : 'tu ingreso cambia de un mes a otro'}. Proteger ese margen es parte del primer paso.`;
    refs.push('Q13', 'Q07');
  } else {
    title = 'Tienes margen: la clave es decidir a dónde va';
    interpretation = `Con tus montos declarados te quedan aproximadamente ${fmt(cur, M.monthly_balance.value)} al mes. Ese margen puede ir a una reserva, a tus deudas o a probar una forma de ganar más.`;
  }

  const insights = [];
  if (num('committed_reserve_months') !== null) {
    insights.push({ title: 'Tu dinero guardado frente a tus gastos', meaning: reserve.isZero() ? 'Hoy no tienes dinero guardado para una emergencia.' : `Lo que tienes guardado cubre aproximadamente ${String(M.committed_reserve_months.value).replace('.', ',')} meses de gastos básicos${andDues}.`, implication: reserve.isZero() ? 'Cualquier imprevisto tendría que cubrirse con deuda o con ayuda de otros.' : reserve.lt(1) ? 'Es un respaldo pequeño: un mes difícil lo agotaría.' : 'Te da cierto margen para probar cambios sin poner en riesgo lo básico.', evidence_refs: ['Q13', 'Q08', 'Q10'], metric_refs: ['committed_reserve_months'] });
  }

  const b = val(answers, 'Q21');
  const bottleneck = b
    ? { interpretation: `Señalas como principal obstáculo: ${lower(b.other || label(answers, 'Q21', b.codes[0]))}. Lo tomamos como punto de partida.`, status: 'supported', evidence_refs: ['Q21'] }
    : { interpretation: 'Todavía no sabemos qué te frena más; es de lo primero que conviene aclarar.', status: 'insufficient', evidence_refs: ['Q21'] };

  let opportunity = null;
  if (!minor && (skills.length || exp.length) && hours && hours !== 'H0') {
    const what = skills.length ? label(answers, 'Q17', skills[0]) : label(answers, 'Q18', exp[0]);
    const who = audience.length ? AUDIENCE_2P[audience[0]] || 'personas de tu entorno' : null;
    opportunity = {
      title: who ? `Probar una oferta pequeña para ${who}` : 'Comprobar si alguien pagaría por lo que declaras saber hacer',
      hypothesis: `Declaras saber ${lower(what)}${paid ? ' y ya te pagaron por usarlo' : ''}. Podría resolver una necesidad concreta de alguien cercano; todavía no sabemos si comprarían.`,
      why_this_person: [`Declaras: ${lower(what)}.`, paid ? 'Ya te pagaron por usar esa habilidad.' : null, who ? `Podrías ofrecerlo a ${who}.` : null, `Tiempo disponible: ${lower(label(answers, 'Q16', hours))} por semana.`].filter(Boolean).join(' '),
      alternative: codes(answers, 'Q04')[0] === 'EMPLOYEE' ? 'Mejorar tu ingreso en tu empleo actual.' : 'Mejorar precios o costos de lo que ya haces.',
      test: who ? `Pregunta a dos ${who} qué necesitan y en qué momento, sin vender todavía.` : 'Identifica a una persona con ese problema y pregúntale cómo lo resuelve hoy.',
      continue_if: 'Encuentras una necesidad concreta que puedes atender respetando lo que necesitas cuidar.',
      revise_if: 'La necesidad exige más tiempo o dinero del que tienes.',
      unknowns: ['Si hay demanda real y cuánto pagarían.', 'Cuánto te dejaría después de costos.'],
      evidence_refs: ['Q16', 'Q17', 'Q19', 'Q20', 'Q22'],
    };
  }

  let first;
  if (pay === 'UNABLE' || pay === 'LATE') first = { kind: 'CONTACT', instruction: 'Haz una lista de cada pago atrasado (a quién, cuánto y desde cuándo) y llama esta semana al acreedor más urgente para preguntar qué opciones de pago ofrece.', why_now: 'Los atrasos suelen sumar cargos cada semana.', done_when: 'Tienes la lista y hablaste con al menos un acreedor.', resource_fit: 'Solo requiere tu teléfono; sin gasto.', risk: 'No aceptes un préstamo nuevo para pagar otro sin comparar condiciones.', evidence_refs: ['Q10', 'Q12'] };
  else if (bal !== null && bal.lte(0)) first = { kind: 'RECORD', instruction: 'Durante siete días anota cada gasto y marca cuáles no son esenciales.', why_now: bal.isZero() ? 'Sin margen, encontrar un gasto que ajustar es lo que te permitirá ahorrar o pagar algo extra.' : 'Necesitas ver de dónde sale la diferencia antes de decidir qué cambiar.', done_when: bal.isZero() ? 'Tienes siete días anotados y elegiste un gasto para ajustar.' : 'Tienes siete días anotados y sabes qué gastos explican la diferencia.', resource_fit: 'Basta una libreta o el teléfono; sin gasto.', risk: 'No recortes salud ni alimentación sin revisar antes otras opciones.', evidence_refs: ['Q06', 'Q08', 'Q09'] };
  else if (opportunity) first = { kind: 'CONTACT', instruction: opportunity.test, why_now: 'Saber si hay una necesidad real evita invertir tiempo en algo que nadie pide.', done_when: 'Hablaste con dos personas y anotaste qué necesitan.', resource_fit: 'Cabe en tu tiempo disponible; sin gasto.', risk: 'No prometas plazos ni precios antes de comprobar que puedes cumplir.', evidence_refs: ['Q17', 'Q20'] };
  else first = { kind: 'RECORD', instruction: 'Durante siete días anota los gastos que no son esenciales y revisa si alguno puede reducirse sin afectar tus necesidades.', why_now: 'Es la forma más rápida de proteger tu margen mientras decides cómo avanzar.', done_when: 'Tienes siete días anotados y elegiste un gasto para ajustar.', resource_fit: 'Basta una libreta o el teléfono; sin gasto.', risk: 'Ninguno: solo ordena información que ya tienes.', evidence_refs: ['Q08', 'Q09'] };

  let decision = null;
  if (blocked.has('NEW_CREDIT')) decision = { decision: 'Pedir un crédito nuevo para cubrir el mes.', reason: 'Si el mes ya no alcanza, una deuda nueva solo traslada el problema y le suma costos.', evidence_refs: ['Q06', 'Q08'] };

  const missing = [];
  const ask = (cond, field, question, why) => cond && missing.length < 3 && missing.push({ field, question, why });
  ask(!val(answers, 'Q06'), 'net_income_month', '¿Cuánto recibes en un mes normal?', 'Sin este dato no podemos calcular tu margen.');
  ask(!val(answers, 'Q08'), 'essential_expense_month', '¿Cuánto gastas al mes en lo necesario?', 'Permite saber cuánto margen real tienes.');
  ask(Boolean(debt && debt.status !== 'NO'), 'debt_detail', '¿Qué tasa, plazo y condiciones tiene cada una de tus deudas?', 'Permite decidir qué deuda conviene atender primero.');
  ask(Boolean(opportunity), 'demand', '¿Alguien concreto pagaría por lo que ofreces, y cuánto te dejaría?', 'Distingue una idea de una oportunidad real.');
  ask(true, 'expenses_detail', '¿En qué se van exactamente tus gastos de cada mes?', 'Permite encontrar margen sin afectar lo necesario.');

  return {
    schema_version: RULES_VERSION,
    catalog_version: catalog.VERSION_ID,
    conclusion: { title, interpretation, evidence_refs: refs },
    insights: insights.slice(0, 3),
    bottleneck,
    opportunity,
    first_action: first,
    decision_to_review: decision,
    growth_direction: { text: opportunity ? 'Primero comprobar una necesidad concreta; si funciona, decidir cómo repartir el ingreso adicional entre reserva, deudas y tu objetivo.' : 'Primero ordenar tus números y aclarar lo que falta; con eso podremos proponerte una vía que encaje con tu tiempo y tus recursos.', evidence_refs: ['Q05', 'Q16'] },
    missing_data: missing,
    offer_id: OFFER.offer_id,
  };
}

// ───────── Generación y persistencia ─────────
function stamp(extra = {}) {
  return knowledge.stamp({
    knowledge_version: VERSIONS.knowledge,
    rules_framework_version: VERSIONS.rules,
    prompts_version: VERSIONS.prompts,
    catalog_version: catalog.VERSION_ID,
    result_rules_version: RULES_VERSION,
    result_schema_version: RULES_VERSION,
    metrics_version: metrics4.VERSION,
    prompt_version: null,
    model: null,
    ...extra,
  });
}

function envelope(session, pkg, diagnosis, source, answers) {
  const goal = val(answers, 'Q05');
  return {
    ...diagnosis,
    result_rules_version: RULES_VERSION,
    status: 'ready',
    narrative_source: source,
    generated_at: db.now(),
    currency: session.currency,
    metrics: pkg._metrics.metrics,
    balance_range: pkg._metrics.balance_range,
    contradictions: pkg.contradicciones,
    goal: goal ? { text: goal.code === 'OTHER' && goal.other ? goal.other : catalog.labelIn(catalog.OPTIONS.GOALS, goal.code), code: goal.code, horizon: catalog.labelIn(catalog.OPTIONS.HORIZONS, goal.horizon) } : null,
    minor: isMinor(answers),
    offer: OFFER,
    traceability: stamp(),
  };
}

function generate(session, answers) {
  const existing = db.one('SELECT * FROM ft_results WHERE session_id = ? AND answer_revision = ? AND rules_version = ?', session.id, session.revision, RULES_VERSION);
  if (existing) return existing;
  const now = db.now();
  const pkg = buildPackage(session, answers);
  const result = envelope(session, pkg, template(pkg, answers), 'template', answers);
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
  if (wantsAi) queue.enqueue('free_v4_diagnosis', { resultId: r.lastId }, { maxAttempts: 2 });
  return db.one('SELECT * FROM ft_results WHERE id = ?', r.lastId);
}

function buildPrompt(pkg) {
  const base = r3.buildPrompt(pkg);
  return { system: `${PROMPT}\n\n${V4_RULES}\n\n${base.system.slice(base.system.indexOf('Formato de cifras'))}`, user: base.user };
}

async function callModel(prompt) {
  if (client) return { json: await client(prompt), usage: null, latencyMs: null, model: 'cliente_de_prueba' };
  return openai.chat({ ...prompt, ...config.ai.openai, schema: API_SCHEMA, schemaName: 'diagnostico_gratuito_v4', timeoutMs: Math.max(config.ai.openai.timeoutMs, 45000) });
}

function finish(row, result, source, meta, reason) {
  result.status = 'ready';
  result.narrative_source = source;
  Object.assign(result.traceability, { prompt_version: source === 'ai' ? PROMPT_VERSION : null, model: source === 'ai' ? meta && meta.model : null, ai_usage: meta, ai_fallback_reason: reason || null });
  log.info('Diagnóstico gratuito V4', { result: row.id, source, reason: reason || null, ...(meta || {}) });
  db.run("UPDATE ft_results SET status = 'ready', narrative_source = ?, result_json = ?, prompt_version = ?, model = ?, updated_at = ? WHERE id = ? AND status = 'pending'", source, JSON.stringify(result), result.traceability.prompt_version, result.traceability.model, db.now(), row.id);
}

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
    log.warn('IA no disponible para el diagnóstico V4; se usa el respaldo', { result: resultId, error: String(err.message).slice(0, 120) });
    return finish(row, result, 'template', null, 'PROVIDER_ERROR');
  }
  const u = call.usage || {};
  const meta = { model: call.model, latency_ms: call.latencyMs, input_tokens: u.prompt_tokens ?? null, output_tokens: u.completion_tokens ?? null };
  call.json = r3.polish(call.json);
  const check = validateOutput(call.json, pkg);
  if (!check.ok) {
    log.warn('Diagnóstico V4 de la IA rechazado; se usa el respaldo', { result: resultId, reason: check.reason });
    return finish(row, result, 'template', meta, check.reason);
  }
  const fresh = envelope(session, pkg, call.json, 'ai', answers);
  fresh.traceability.input_hash = result.traceability.input_hash;
  finish(row, fresh, 'ai', meta, null);
}

queue.register('free_v4_diagnosis', handle);

module.exports = { RULES_VERSION, PROMPT_VERSION, VERSIONS, SCHEMA, API_SCHEMA, OFFER, setClient, aiEnabled, buildPackage, validateOutput, template, generate, handle, buildPrompt, contradictions, blocks, isMinor };
