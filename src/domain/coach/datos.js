'use strict';
// Datos versionados del Coach v2: catálogo de mensajes, diccionario, umbrales y esquemas.
// Se cargan y VALIDAN al arrancar: si algo está roto la aplicación no arranca (mejor que responder
// mal). Cada respuesta guarda `catalog_version` (hash de los JSON) para reproducirla con la versión
// con que se generó. Equivalente a docs/coach-v2/herramientas/validar.js.
const crypto = require('node:crypto');
const catalogo = require('./data/catalogo-mensajes.json');
const diccionario = require('./data/diccionario-categorias.json');
const umbrales = require('./data/umbrales.json');
const esquemas = require('./data/esquemas.json');
const T = require('./mensajes');

const FORMATOS_OK = new Set(['moneda', 'pct', 'pct_signed', 'abs', 'entero', 'fecha', 'mes', 'coma']);
const OPERADORES = new Set(['=', '!=', '<', '<=', '>', '>=', 'en', 'no_en', 'vacio', 'no_vacio']);
const MAX_CARACTERES = 420;

function muestra(tipo) {
  const t = String(tipo).replace('?', '');
  if (t === 'moneda') return '1234.50';
  if (t === 'pct') return 31.2;
  if (t === 'pct_signed') return -18;
  if (t === 'entero') return 3;
  if (t === 'fecha') return '2026-11-14';
  if (t === 'mes') return '2026-11';
  if (t === 'bool') return true;
  if (t === 'lista') return 'A, B y C';
  if (t === 'texto') return 'Ejemplo';
  if (t.includes('|')) return t.split('|')[0];
  return 'x';
}

/** Devuelve la lista de problemas del catálogo (vacía si está bien). */
function validarCatalogo(cat = catalogo, esq = esquemas) {
  const errores = [];
  const err = (m) => errores.push(m);
  const tiposGrafico = new Set(esq.$defs.TipoGrafico.enum);
  const grupos = new Set(Object.keys(cat.grupos));
  const tonos = new Set(Object.keys(cat.tonos));
  const severidades = new Set(Object.keys(cat.severidades));
  const ids = new Set();
  const idsVariante = new Set();
  for (const it of cat.intenciones) {
    if (ids.has(it.id)) err(`Intención duplicada: ${it.id}`);
    ids.add(it.id);
    if (!grupos.has(it.grupo)) err(`${it.id}: grupo desconocido ${it.grupo}`);
    if (!['regla', 'plantilla'].includes(it.origen)) err(`${it.id}: origen inválido ${it.origen}`);
    for (const b of it.botones || []) if (!cat.botones[b]) err(`${it.id}: botón inexistente ${b}`);
    if (it.grafico && !tiposGrafico.has(it.grafico)) err(`${it.id}: tipo de gráfico desconocido ${it.grafico}`);
    if (!it.variantes || it.variantes.length < 2) err(`${it.id}: necesita al menos 2 variantes`);
    const vars = it.vars || {};
    const muestras = Object.fromEntries(Object.entries(vars).map(([k, t]) => [k, muestra(t)]));
    for (const v of it.variantes || []) {
      if (idsVariante.has(v.id)) err(`Variante duplicada: ${v.id}`);
      idsVariante.add(v.id);
      if (!new RegExp(`^${it.id}\\.\\d+$`).test(v.id)) err(`${v.id}: el id debe ser «${it.id}.N»`);
      if (!tonos.has(v.tono)) err(`${v.id}: tono desconocido ${v.tono}`);
      if (v.severidad && !severidades.has(v.severidad)) err(`${v.id}: severidad desconocida ${v.severidad}`);
      for (const m of String(v.texto).matchAll(/\{([^{}]+)\}/g)) {
        const [nombre, ...formatos] = m[1].split(':');
        if (!(nombre in vars)) err(`${v.id}: la variable {${nombre}} no está declarada en vars`);
        for (const f of formatos) if (!FORMATOS_OK.has(f) && !f.startsWith('plural=')) err(`${v.id}: formato desconocido «${f}»`);
      }
      for (const c of v.cuando || []) {
        if (!(c.var in vars)) err(`${v.id}: la condición usa una variable no declarada (${c.var})`);
        if (!OPERADORES.has(c.op)) err(`${v.id}: operador desconocido ${c.op}`);
      }
      try {
        const texto = T.renderizar(v.texto, muestras, { moneda: 'USD' });
        if (texto.length > MAX_CARACTERES) err(`${v.id}: ${texto.length} caracteres (máximo ${MAX_CARACTERES})`);
        if (/[{}]/.test(texto)) err(`${v.id}: quedó una llave sin resolver`);
      } catch (e) {
        err(`${v.id}: no se puede renderizar (${e.message})`);
      }
    }
  }
  for (const [id, b] of Object.entries(cat.botones)) if (!b.etiqueta || !b.accion) err(`Botón ${id}: falta etiqueta o acción`);
  return errores;
}

const problemas = validarCatalogo();
if (problemas.length) {
  throw new Error(`El catálogo de mensajes del Coach tiene ${problemas.length} problema(s):\n- ${problemas.slice(0, 12).join('\n- ')}`);
}

const INTENCIONES = Object.freeze(Object.fromEntries(catalogo.intenciones.map((i) => [i.id, i])));
const hash = crypto.createHash('sha256').update(JSON.stringify([catalogo, diccionario, umbrales])).digest('hex').slice(0, 8);
const CATALOG_VERSION = `${catalogo.version}+${hash}`;

module.exports = { catalogo, diccionario, umbrales, esquemas, INTENCIONES, CATALOG_VERSION, validarCatalogo, muestra };
