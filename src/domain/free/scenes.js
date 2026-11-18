'use strict';
// Escenas entre bloques del test gratuito V4: una pantalla corta que respira entre preguntas.
// Son solo presentación: no son preguntas, no se guardan ni cambian el resultado.
// Contenido sin cifras ni estadísticas: son ideas generales de orientación.
// ⚠ Pendiente de validar por el responsable de contenido financiero (ver docs/PLAN-TEST-INTERACTIVO-Y-COACH-V2.md).
const VERSION = 'FREE_24_V4_ES';

const BLOCKS = ['Tu situación', 'Tu mes', 'Deudas y respaldo', 'Tus oportunidades', 'Lo que te frena'];

// Clave: ordinal de la pregunta que se acaba de responder. `block` es el bloque que empieza.
const SCENES = {
  5: {
    kind: 'idea',
    block: 2,
    title: 'Ahora, tu mes',
    text: 'Ordenar el dinero empieza por ver el mes completo: lo que entra, lo que sale y lo que queda. No hace falta que los números sean exactos; aproximados sirven.',
  },
  9: {
    kind: 'pausa',
    block: 3,
    title: 'Un momento antes de seguir',
    text: 'Las siguientes preguntas son sobre deudas y respaldo. No hay respuestas buenas ni malas: solo sirven para darte un primer paso realista. Respira un momento.',
  },
  14: {
    kind: 'idea',
    block: 4,
    title: 'Mirando hacia adelante',
    text: 'Un colchón para imprevistos suele dar tranquilidad aunque empieces con poco. Ahora veamos qué recursos tienes para mejorar tu situación.',
  },
  20: {
    kind: 'idea',
    block: 5,
    title: 'Ya casi terminas',
    text: 'Muchas personas tienen algo que pueden aprovechar: tiempo, una habilidad o gente que las conoce. Las últimas preguntas ayudan a ver qué te frena para empezar.',
  },
};

/** Escena que corresponde tras responder la pregunta `ordinal` (o null). Solo para el catálogo V4. */
function after(catalogVersion, ordinal) {
  if (catalogVersion !== VERSION) return null;
  const s = SCENES[ordinal];
  return s ? { ...s, ordinal, blockName: BLOCKS[s.block - 1], blockCount: BLOCKS.length } : null;
}

module.exports = { VERSION, BLOCKS, SCENES, after };
