'use strict';
// Estados obligatorios de la evidencia (RFP_V1_ES §2). Toda afirmación del
// diagnóstico debe llevar uno de estos estados y su referencia de origen.

const STATUSES = Object.freeze({
  DECLARADO: 'DECLARADO', // El usuario afirmó un hecho vigente.
  CALCULADO: 'CALCULADO', // Resultado del motor sobre datos completos y compatibles.
  CONFIRMADO: 'CONFIRMADO', // Dato contrastado y aceptado por el usuario.
  SUPUESTO: 'SUPUESTO', // Dato hipotético explícito (solo en escenarios).
  HIPOTESIS: 'HIPOTESIS', // Oportunidad o causa aún no validada.
  DESCONOCIDO: 'DESCONOCIDO', // DK, PNA o sin respuesta: nunca equivale a cero.
  CONTRADICTORIO: 'CONTRADICTORIO', // Respuestas que no concuerdan.
  NO_APLICA: 'NO_APLICA', // La pregunta no corresponde a la ruta.
});

/** Nivel de confianza según la calidad de los datos (no la decide el modelo). */
const CONFIDENCE = Object.freeze({ SUFICIENTE: 'suficiente', PARCIAL: 'parcial', INSUFICIENTE: 'insuficiente' });

/** Origen del dato. */
const SOURCES = Object.freeze({ USUARIO: 'usuario', MOTOR: 'motor', SUPUESTO: 'supuesto', HIPOTESIS: 'hipotesis' });

const isKnown = (status) => status === STATUSES.DECLARADO || status === STATUSES.CALCULADO || status === STATUSES.CONFIRMADO;

module.exports = { STATUSES, CONFIDENCE, SOURCES, isKnown };
