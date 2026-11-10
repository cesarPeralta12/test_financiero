'use strict';
// Paquete de hechos FACTS_V1_ES (Fase 1, documentos 01 §11 y 05 §2). Convierte las
// 25 respuestas activas en hechos con estado, origen y evidencia. Es determinista y
// no inventa datos: DK/PNA quedan DESCONOCIDO (nunca cero), las metas y el
// presupuesto de exploración se marcan como tales y no como ingresos reales, y las
// respuestas incompatibles se marcan CONTRADICTORIO sin ocultar el resto.
const crypto = require('node:crypto');
const catalog = require('./catalog');
const knowledge = require('../knowledge');

const { STATUSES: S, CONFIDENCE, SOURCES } = knowledge.evidence;

/**
 * Naturaleza de cada respuesta. «meta» y «presupuesto» nunca se usan como ingreso,
 * saldo ni patrimonio (Q18, Q23 y Q25 en RFP-207 y RFP-211).
 */
const NATURE = Object.freeze({ Q17: 'meta', Q18: 'meta', Q23: 'presupuesto_exploracion', Q25: 'meta' });

/** Datos que el test gratuito no mide y que la evaluación profunda debe pedir. */
const NOT_MEASURED = Object.freeze([
  { field: 'ingreso_personal_neto_mes', question: '¿Cuánto dinero recibes efectivamente al mes?' },
  { field: 'gasto_mensual', question: '¿Cuánto gastas al mes, incluyendo lo esencial?' },
  { field: 'deudas_detalle', question: '¿Cuáles son los saldos, cuotas y tasas de tus deudas?' },
  { field: 'activos_valor', question: '¿Qué valor aproximado tienen tus bienes y ahorros?' },
]);

// Reglas de contradicción. Cada una bloquea solo las conclusiones que dependen de
// esos datos; el resto del diagnóstico sigue disponible.
const CONTRADICTIONS = [
  {
    id: 'CTR_SHORTFALL_SAVING',
    slots: ['Q02', 'Q06'],
    test: (c) => c.Q02 === 'SHORTFALL' && ['P10_19', 'P20_29', 'GE30'].includes(c.Q06),
    explanation: 'Indicas que no cubres tus gastos básicos y, a la vez, que ahorras una parte importante de tus ingresos.',
    question: '¿Cuál describe mejor tu mes habitual: te falta para lo básico o logras ahorrar?',
  },
  {
    id: 'CTR_SAVING_ZERO',
    slots: ['Q02', 'Q06'],
    test: (c) => ['SAVING', 'SAVING_INVESTING'].includes(c.Q02) && c.Q06 === 'ZERO',
    explanation: 'Indicas que ahorras con regularidad, pero también que no ahorras nada en un mes habitual.',
    question: '¿Ahorras algo en un mes habitual? Si es así, ¿qué porcentaje aproximado?',
  },
];

const codeOf = (a) => (a && a.status === 'answered' && typeof a.value === 'string' ? a.value : null);

function labelOf(a) {
  if (!a || a.status !== 'answered') return null;
  const v = a.value;
  if (typeof v === 'string') return catalog.labelFor(a.variant_id, v);
  if (Array.isArray(v)) return v.map((c) => catalog.labelFor(a.variant_id, c)).join(', ');
  if (v && v.kind === 'CHOICE') return catalog.labelFor(a.variant_id, v.code);
  if (v && v.kind === 'AMOUNT') return `${v.amount}${v.currency ? ' ' + v.currency : ''}`;
  if (v && v.kind === 'AGE') return `${v.value} años`;
  return null;
}

function statusOf(a) {
  if (!a) return S.NO_APLICA;
  if (a.status === 'answered') return S.DECLARADO;
  return S.DESCONOCIDO; // unknown (DK) o declined (PNA)
}

/**
 * Construye el paquete de hechos de una sesión completada.
 * @param {object} session fila de ft_sessions
 * @param {object} answers respuestas activas por slot (engine.activeAnswers)
 */
function build(session, answers) {
  const codes = Object.fromEntries(catalog.SLOTS.map((s) => [s.slot_id, codeOf(answers[s.slot_id])]));
  const contradictions = CONTRADICTIONS.filter((c) => c.test(codes)).map((c) => ({ id: c.id, slots: c.slots, explanation: c.explanation, question: c.question }));
  const contradictory = new Set(contradictions.flatMap((c) => c.slots));

  const facts = catalog.SLOTS.map((s) => {
    const a = answers[s.slot_id] || null;
    let status = statusOf(a);
    if (status === S.DECLARADO && contradictory.has(s.slot_id)) status = S.CONTRADICTORIO;
    return {
      id: s.slot_id,
      semantic_key: s.semantic_key,
      variant_id: a ? a.variant_id : null,
      answer_revision: a ? a.answer_revision : null,
      value: a && a.status === 'answered' ? a.value : null,
      label: labelOf(a),
      status,
      reason: a && a.status === 'declined' ? 'PNA' : a && a.status === 'unknown' ? 'DK' : null,
      nature: NATURE[s.slot_id] || 'hecho',
      source: SOURCES.USUARIO,
      evidence_ref: a ? { slot_id: s.slot_id, variant_id: a.variant_id, answer_revision: a.answer_revision } : null,
    };
  });

  const unknowns = facts.filter((f) => f.status === S.DESCONOCIDO).map((f) => ({ id: f.id, semantic_key: f.semantic_key, reason: f.reason }));
  const known = facts.filter((f) => knowledge.evidence.isKnown(f.status)).length;
  const confidence = known >= 22 ? CONFIDENCE.SUFICIENTE : known >= 15 ? CONFIDENCE.PARCIAL : CONFIDENCE.INSUFICIENTE;

  const pkg = {
    fact_package_version: knowledge.VERSIONS.fact_package,
    catalog_version: session.version_id,
    response_revision: session.revision,
    route: codes.Q03,
    currency: session.currency || null,
    facts,
    evidence_refs: facts.filter((f) => f.evidence_ref).map((f) => f.evidence_ref),
    // El test gratuito es cualitativo: no hay métricas monetarias calculadas.
    metrics: [],
    unknowns,
    contradictions,
    missing_required_inputs: NOT_MEASURED,
    confidence,
    // Se completan en las fases 2 y siguientes (reglas RFP y mapa de oportunidades).
    eligible_actions: [],
    blocked_actions: [],
    opportunity_candidates: [],
  };
  pkg.input_hash = inputHash(pkg);
  return pkg;
}

/** Huella de las entradas: mismas respuestas y versiones ⇒ misma huella. */
function inputHash(pkg) {
  const basis = { v: pkg.fact_package_version, c: pkg.catalog_version, f: pkg.facts.map((f) => [f.id, f.variant_id, f.status, f.value]) };
  return crypto.createHash('sha256').update(JSON.stringify(basis)).digest('hex');
}

module.exports = { build, inputHash, NATURE, NOT_MEASURED, CONTRADICTIONS };
