'use strict';
// Normalización de texto del usuario (referencia: docs/coach-v2/herramientas/plantillas.js).
// Minúsculas, sin tildes ni signos raros y espacios colapsados. El texto nunca se usa como código.

/** Normaliza una nota o frase: minúsculas, sin tildes, solo letras, números y .,$%-/ */
function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.,$%\-/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { normalizar };
