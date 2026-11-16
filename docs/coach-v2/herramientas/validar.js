'use strict';
// Validador de los datos de docs/coach-v2/json. Sin dependencias.
// Uso: node docs/coach-v2/herramientas/validar.js   (código de salida 1 si hay errores)
const fs = require('node:fs');
const path = require('node:path');
const T = require('./plantillas');

const DIR = path.join(__dirname, '..', 'json');
const leer = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const errores = [];
const avisos = [];
const err = (m) => errores.push(m);
const aviso = (m) => avisos.push(m);

// ───────── JSON bien formados ─────────
const archivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
const D = {};
for (const f of archivos) {
  try {
    D[f] = leer(f);
  } catch (e) {
    err(`${f}: JSON inválido (${e.message})`);
  }
}
if (errores.length) fin();

const cat = D['catalogo-mensajes.json'];
const dic = D['diccionario-categorias.json'];
const casos = D['casos-parser.json'];
const esq = D['esquemas.json'];
const umb = D['umbrales.json'];

// ───────── Catálogo de mensajes ─────────
const TIPOS_GRAFICO = new Set(esq.$defs.TipoGrafico.enum);
const FORMATOS_OK = new Set(['moneda', 'pct', 'pct_signed', 'abs', 'entero', 'fecha', 'mes', 'coma']);
const TIPO_REQUIERE = { moneda: /^moneda/, pct: /^pct/, pct_signed: /^pct/, entero: /^entero/, fecha: /^fecha/, mes: /^mes/ };
const idsIntencion = new Set();
const idsVariante = new Set();
const GRUPOS = new Set(Object.keys(cat.grupos));
const TONOS = new Set(Object.keys(cat.tonos));
const SEV = new Set(Object.keys(cat.severidades));
let nVariantes = 0;

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

for (const it of cat.intenciones) {
  if (idsIntencion.has(it.id)) err(`Intención duplicada: ${it.id}`);
  idsIntencion.add(it.id);
  if (!GRUPOS.has(it.grupo)) err(`${it.id}: grupo desconocido ${it.grupo}`);
  if (!['regla', 'plantilla'].includes(it.origen)) err(`${it.id}: origen inválido`);
  if (it.variantes.length < 2) err(`${it.id}: necesita al menos 2 variantes`);
  if (it.grafico && !TIPOS_GRAFICO.has(it.grafico)) err(`${it.id}: gráfico desconocido ${it.grafico}`);
  for (const b of it.botones || []) if (!cat.botones[b]) err(`${it.id}: botón inexistente ${b}`);
  const vars = it.vars || {};
  const usadas = new Set();
  for (const v of it.variantes) {
    nVariantes++;
    if (idsVariante.has(v.id)) err(`Variante duplicada: ${v.id}`);
    idsVariante.add(v.id);
    if (!v.id.startsWith(`${it.id}.`)) err(`${v.id}: el id debe empezar por ${it.id}.`);
    if (!TONOS.has(v.tono)) err(`${v.id}: tono desconocido ${v.tono}`);
    if (v.severidad && !SEV.has(v.severidad)) err(`${v.id}: severidad desconocida`);
    for (const c of v.cuando || []) {
      if (!(c.var in vars)) err(`${v.id}: la condición usa la variable no declarada ${c.var}`);
      if (!['=', '!=', '<', '<=', '>', '>=', 'en', 'no_en', 'vacio', 'no_vacio'].includes(c.op)) err(`${v.id}: operador ${c.op}`);
    }
    for (const m of v.texto.matchAll(/\{([^{}]+)\}/g)) {
      const [nombre, ...fmts] = m[1].split(':');
      usadas.add(nombre);
      if (!(nombre in vars)) {
        err(`${v.id}: variable no declarada {${nombre}}`);
        continue;
      }
      for (const f of fmts) {
        const base = f.startsWith('plural=') ? 'plural' : f;
        if (base !== 'plural' && !FORMATOS_OK.has(base)) err(`${v.id}: formato desconocido ${f}`);
        if (base === 'plural' && !/^plural=[^|]+\|[^|]+$/.test(f)) err(`${v.id}: plural mal formado ${f}`);
        if (base === 'plural' && !/^entero/.test(vars[nombre])) err(`${v.id}: plural exige variable entera (${nombre})`);
        if (TIPO_REQUIERE[base] && !TIPO_REQUIERE[base].test(vars[nombre]) && !fmts.includes('abs')) err(`${v.id}: formato ${f} sobre variable de tipo ${vars[nombre]} (${nombre})`);
      }
    }
    if (/[{}]/.test(v.texto.replace(/\{[^{}]+\}/g, ''))) err(`${v.id}: llaves sin cerrar`);
    // Renderiza con valores de muestra para comprobar que no lanza.
    try {
      const ejemplo = Object.fromEntries(Object.entries(vars).map(([k, t]) => [k, muestra(t)]));
      const out = T.renderizar(v.texto, ejemplo, { moneda: 'USD' });
      if (!out.trim() || /[{}]/.test(out)) err(`${v.id}: texto renderizado inválido`);
      if (out.length > 420) aviso(`${v.id}: texto largo (${out.length} caracteres)`);
    } catch (e) {
      err(`${v.id}: no renderiza (${e.message})`);
    }
  }
  for (const k of Object.keys(vars)) if (!usadas.has(k) && !it.variantes.some((v) => (v.cuando || []).some((c) => c.var === k))) aviso(`${it.id}: variable declarada pero sin uso: ${k}`);
}

// ───────── Diccionario ─────────
const norm = T.normalizar;
function chequearPalabras(lista, ruta) {
  for (const p of lista) if (typeof p === 'string' && norm(p) !== p) err(`${ruta}: «${p}» no está normalizada (sería «${norm(p)}»)`);
}
for (const [tipo, lista] of Object.entries(dic.verbos_de_tipo)) chequearPalabras(lista, `verbos_de_tipo.${tipo}`);
for (const [tipo, cats] of Object.entries(dic.categorias)) {
  for (const [c, def] of Object.entries(cats)) {
    chequearPalabras(def.sinonimos, `categorias.${tipo}.${c}`);
    for (const [s, sd] of Object.entries(def.subcategorias || {})) chequearPalabras(sd.sinonimos, `categorias.${tipo}.${c}.${s}`);
  }
}
for (const [k, lista] of Object.entries(dic.sinonimos_de_intencion)) chequearPalabras(lista, `sinonimos_de_intencion.${k}`);
chequearPalabras(Object.keys(dic.numeros.palabras), 'numeros.palabras');
chequearPalabras(dic.palabras_vacias, 'palabras_vacias');
// Las categorías base deben existir en el sistema actual (src/domain/tracker.js).
const BASE = {
  ingreso: ['sueldo', 'independiente', 'negocio', 'renta', 'extra', 'otros'],
  gasto: ['vivienda', 'alimentacion', 'transporte', 'servicios', 'salud', 'educacion', 'ocio', 'otros'],
  pago_deuda: ['cuota', 'extra'],
  ahorro: ['reserva', 'meta', 'otros'],
  retiro_ahorro: ['emergencia', 'meta', 'otros'],
};
for (const [tipo, lista] of Object.entries(BASE)) {
  const tiene = Object.keys(dic.categorias[tipo] || {});
  for (const c of lista) if (!tiene.includes(c)) err(`diccionario: falta la categoría base ${tipo}:${c}`);
  for (const c of tiene) if (!lista.includes(c)) err(`diccionario: categoría que no existe en el sistema ${tipo}:${c}`);
}

// ───────── Casos del parser ─────────
const INTENCIONES_PARSER = new Set([
  ...Object.keys(dic.sinonimos_de_intencion),
  'registrar_gasto', 'registrar_ingreso', 'registrar_pago_deuda', 'registrar_ahorro', 'registrar_retiro',
  'corregir_importe', 'corregir_categoria', 'corregir_fecha', 'consejo_especifico', 'fuera_de_alcance', 'consulta_abierta', 'desconocido', 'privacidad_info',
  'explicar_saldo', 'explicar_tasa_ahorro', 'explicar_reserva', 'explicar_estrategias_deuda', 'explicar_hormiga', 'explicar_proyeccion', 'explicar_50_30_20',
  'saludo', 'despedida', 'gracias', 'mayor_movimiento',
]);
const ids = new Set();
const RESPUESTAS_EXTRA = new Set();
for (const c of casos.casos) {
  if (ids.has(c.id)) err(`Caso duplicado ${c.id}`);
  ids.add(c.id);
  if (c.intencion !== null && !INTENCIONES_PARSER.has(c.intencion)) err(`${c.id}: intención de parser desconocida ${c.intencion}`);
  if (c.respuesta && !idsIntencion.has(c.respuesta)) err(`${c.id}: la respuesta ${c.respuesta} no existe en el catálogo`);
  if (!c.respuesta && !c.entidades) err(`${c.id}: sin respuesta ni entidades`);
  if (c.entidades) {
    const e = c.entidades;
    if (e.importe !== null && e.importe !== undefined && !/^[0-9]+(\.[0-9]{1,2})?$/.test(e.importe)) err(`${c.id}: importe mal formado ${e.importe}`);
    if (e.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(e.fecha)) err(`${c.id}: fecha mal formada`);
    if (e.tipo && e.categoria && dic.categorias[e.tipo] && !dic.categorias[e.tipo][e.categoria]) err(`${c.id}: categoría ${e.tipo}:${e.categoria} no existe`);
    if (e.tipo && e.categoria && e.subcategoria && dic.categorias[e.tipo]?.[e.categoria] && !dic.categorias[e.tipo][e.categoria].subcategorias[e.subcategoria]) err(`${c.id}: subcategoría ${e.subcategoria} no existe en ${e.categoria}`);
  }
}
if (casos.casos.length < 150) err(`Se piden al menos 150 casos y hay ${casos.casos.length}`);

// ───────── Umbrales y esquemas ─────────
for (const [grupo, def] of Object.entries(umb)) {
  if (typeof def !== 'object' || ['version', 'estado_global', 'nota'].includes(grupo)) continue;
  for (const [k, u] of Object.entries(def)) if (!('valor' in u) && !('clasificar' in u)) err(`umbrales.${grupo}.${k}: sin valor`);
}
if (!esq.$defs.Movimiento || !esq.$defs.RespuestaCoach || !esq.$defs.IAClasificarSalida) err('esquemas: faltan definiciones clave');
for (const nombre of ['IAClasificarSalida', 'IAExtraerSalida', 'IARedactarSalida']) {
  const s = esq.$defs[nombre];
  if (s.additionalProperties !== false) err(`esquemas.${nombre}: debe tener additionalProperties:false`);
  const req = new Set(s.required || []);
  for (const k of Object.keys(s.properties)) if (!req.has(k)) err(`esquemas.${nombre}: la propiedad ${k} debe estar en required (modo estricto)`);
}

// ───────── Estadística ─────────
function fin() {
  console.log(`Archivos JSON: ${archivos.length}`);
  if (cat) console.log(`Catálogo: ${cat.intenciones.length} intenciones, ${nVariantes} variantes, ${Object.keys(cat.botones).length} botones`);
  if (casos) console.log(`Casos del parser: ${casos.casos.length}`);
  for (const a of avisos) console.log(`AVISO  ${a}`);
  for (const e of errores) console.log(`ERROR  ${e}`);
  console.log(errores.length ? `\n${errores.length} error(es).` : '\nTodo en orden.');
  process.exit(errores.length ? 1 : 0);
}
fin();
