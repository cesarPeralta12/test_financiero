'use strict';
// Registro de prompts POIA_V1_ES (documento 06). Cada prompt tiene un ID por uso,
// propósito, estado y el validador que debe aceptar su salida. Los textos se
// incorporarán en fases posteriores; mientras el estado no sea «activo», el sistema
// usa las vías existentes (NARR_AI_V1_ES para el gratuito y prompts.js del coach/plan)
// o su respaldo determinista. Nunca enviar una salida V2 al validador NARR_AI_V1_ES.

const REGISTRY = Object.freeze([
  { id: 'GLOBAL_PATRIMONIAL_V1_ES', purpose: 'global', status: 'especificado', validator: null },
  { id: 'FREE_PATRIMONIAL_V2_ES', purpose: 'free', status: 'especificado', validator: 'FREE_PATRIMONIAL_V2_ES' },
  { id: 'DEEP_PATRIMONIAL_V2_ES', purpose: 'deep', status: 'especificado', validator: 'DEEP_PATRIMONIAL_V2_ES' },
  { id: 'OPPORTUNITY_MAP_V1_ES', purpose: 'opportunity', status: 'especificado', validator: 'OPPORTUNITY_MAP_V1_ES' },
  { id: 'WEALTH_STAGES_V1_ES', purpose: 'wealth_stages', status: 'especificado', validator: 'WEALTH_STAGES_V1_ES' },
  { id: 'PLAN_PATRIMONIAL_V2_ES', purpose: 'plan', status: 'especificado', validator: 'PLAN_PATRIMONIAL_V2_ES' },
  { id: 'COACH_PATRIMONIAL_V2_ES', purpose: 'coach', status: 'especificado', validator: 'COACH_PATRIMONIAL_V2_ES' },
  { id: 'DIAGNOSTIC_REVIEW_V1_ES', purpose: 'review', status: 'especificado', validator: 'DIAGNOSTIC_REVIEW_V1_ES' },
  // Vigente en el código actual (resultado gratuito con OpenAI).
  { id: 'NARR_AI_V1_ES', purpose: 'free', status: 'activo', validator: 'NARR_AI_V1_ES' },
]);

const BY_ID = Object.freeze(Object.fromEntries(REGISTRY.map((p) => [p.id, p])));

/** Prompt activo para un propósito (o null si solo hay plantilla). */
function activeFor(purpose) {
  return REGISTRY.find((p) => p.purpose === purpose && p.status === 'activo') || null;
}

module.exports = { REGISTRY, BY_ID, activeFor };
