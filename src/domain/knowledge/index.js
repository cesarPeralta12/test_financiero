'use strict';
// Gobierno metodológico de Día Uno (Fase 1). Reúne en un solo lugar las versiones
// vigentes de conocimiento, reglas, prompts y esquemas que se guardan junto a cada
// resultado, para que cualquier diagnóstico pueda rastrearse y releerse con la
// versión que lo generó. Fuente rectora: «PROMPT MAESTRO — PLAN ESTRATÉGICO DE
// CRECIMIENTO PATRIMONIAL» (Google Drive, sin copiar ni modificar). Este módulo no
// lee Drive en tiempo real: incorpora un extracto aprobado y versionado.
const crypto = require('node:crypto');
const evidence = require('./evidence');
const prompts = require('./prompts');

/** Versiones vigentes. Cambiar cualquiera exige subir el identificador. */
const VERSIONS = Object.freeze({
  knowledge: 'BCP_V1_ES', // Base de conocimiento patrimonial (documento 04)
  rules: 'RFP_V1_ES', // Reglas financieras y de crecimiento (documento 05)
  prompts: 'POIA_V1_ES', // Prompts operativos de IA (documento 06)
  fact_package: 'FACTS_V1_ES', // Contrato del paquete de hechos
});

/** Procedencia documental de cada versión (bitácora de decisiones). */
const PROVENANCE = Object.freeze({
  BCP_V1_ES: { document: '04_Base_Conocimiento_Patrimonial_V1.md', date: '2026-11-10', status: 'pendiente_aprobacion' },
  RFP_V1_ES: { document: '05_Manual_Reglas_Financieras_V1.md', date: '2026-11-10', status: 'pendiente_aprobacion' },
  POIA_V1_ES: { document: '06_Prompts_Operativos_IA_V1.md', date: '2026-11-10', status: 'pendiente_aprobacion' },
  FACTS_V1_ES: { document: '01_Manual_Tecnico_Dia_Uno.md §11', date: '2026-11-10', status: 'implementado' },
  RESULT_FREE_V1_ES: { document: 'Dia_Uno_Resultado_Test_Gratuito_Especificacion_Desarrollo.docx', date: '2026-11-09', status: 'vigente' },
  FREE_25_V2_ES: { document: 'Dia_Uno_Backend_Test_Gratuito_25_Preguntas.docx', date: '2026-11-09', status: 'vigente' },
});

/** Las 10 palancas de creación patrimonial (BCP_V1_ES §4). */
const LEVERS = Object.freeze(['ingresos', 'margen', 'gastos', 'ahorro', 'activos', 'recurrencia', 'escalabilidad', 'riesgo', 'liquidez', 'capacidad_futura']);

/** Las 7 fases del Prompt Maestro (BCP_V1_ES §3). */
const PHASES = Object.freeze(['diagnostico', 'mapa_riqueza', 'acumulacion', 'maquina_ingresos', 'implementacion', 'errores', 'principios']);

/** Huella estable de la metodología vigente: permite verificarla en cada despliegue. */
function hash() {
  const dump = JSON.stringify({ VERSIONS, LEVERS, PHASES, statuses: evidence.STATUSES, prompts: prompts.REGISTRY });
  return crypto.createHash('sha256').update(dump).digest('hex');
}

/**
 * Bloque de trazabilidad que acompaña a cada resultado nuevo.
 * `extra` permite añadir catálogo, reglas del resultado, modelo y fuente.
 */
function stamp(extra = {}) {
  return {
    knowledge_version: VERSIONS.knowledge,
    rules_framework_version: VERSIONS.rules,
    prompts_version: VERSIONS.prompts,
    fact_package_version: VERSIONS.fact_package,
    methodology_hash: hash(),
    ...extra,
  };
}

module.exports = { VERSIONS, PROVENANCE, LEVERS, PHASES, hash, stamp, evidence, prompts };
