'use strict';
// Subcategorías válidas por tipo y categoría, tomadas del diccionario versionado del Coach.
const dic = require('./data/diccionario-categorias.json');

const SUBS = {};
for (const [kind, cats] of Object.entries(dic.categorias)) {
  SUBS[kind] = {};
  for (const [cat, def] of Object.entries(cats)) SUBS[kind][cat] = Object.keys(def.subcategorias || {});
}

/** ¿Es `sub` una subcategoría válida de esa categoría? Vacía siempre es válida. */
function valida(kind, category, sub) {
  if (sub === null || sub === undefined || sub === '') return true;
  return Boolean(SUBS[kind] && SUBS[kind][category] && SUBS[kind][category].includes(sub));
}

module.exports = { SUBS, valida };
