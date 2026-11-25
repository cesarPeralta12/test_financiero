'use strict';
// Validación de lo que entra y sale de la IA (docs/coach-v2/03 §7 y 10 §4.3, casos A4, A6, A7, A9).
// La IA nunca calcula: toda salida se valida contra esquema, hechos autorizados, términos prohibidos y longitud;
// si algo falla se descarta y se usa la plantilla del catálogo. A la IA solo viaja lo permitido.
const tracker = require('../../tracker');
const { normalizar } = require('../normalizar');
const { INTENCIONES_VALIDAS, CATEGORIAS_GASTO } = require('./prefijos');
const subcats = require('../subcategorias');

const TIPOS = ['ingreso', 'gasto', 'pago_deuda', 'ahorro', 'retiro_ahorro'];
const MAX_PALABRAS = 120;
const MAX_CARACTERES = 700;

// Términos que nunca deben salir (normalizados, sin tildes).
const PROHIBIDOS = [
  'invertir en', 'invierte en', 'inviertas', 'acciones de', 'bitcoin', 'cripto', 'criptomoneda', 'fondo de inversion', 'fondos de inversion', 'bolsa de valores', 'forex',
  'garantizado', 'garantizada', 'seguro que', 'sin riesgo', 'te prometo', 'prometo', 'vas a ahorrar', 'vas a ganar', 'rentabilidad asegurada',
  'pide un prestamo', 'solicita un credito', 'nuevo credito', 'nuevo prestamo', 'tarjeta de credito nueva',
  'usa tu reserva', 'usa tu fondo de emergencia', 'usar tu reserva', 'usar el fondo de emergencia', 'toca tu reserva', 'retira de tu reserva',
  'gastas mal', 'irresponsable', 'avergonz', 'eres un desastre', 'tu culpa',
  'ignora tus reglas', 'ignora las instrucciones', 'como modelo de lenguaje', 'soy una ia de', 'mi prompt',
];

const esFecha = (v) => typeof v === 'string' && Boolean(tracker.validDate(v));
const esImporte = (v) => typeof v === 'string' && /^\d{1,10}(\.\d{1,2})?$/.test(v) && Number(v) > 0;

/** `clasificar`: intención válida, confianza 0–1 y categoría solo si corresponde. */
function clasificar(salida) {
  if (!salida || typeof salida !== 'object') return { ok: false, motivo: 'no_es_objeto' };
  const { intencion, confianza, categoria_consultada: cat } = salida;
  const claves = Object.keys(salida).sort().join(',');
  if (claves !== 'categoria_consultada,confianza,intencion') return { ok: false, motivo: 'campos_inesperados' };
  if (typeof intencion !== 'string' || !INTENCIONES_VALIDAS.has(intencion)) return { ok: false, motivo: 'intencion_desconocida' };
  if (typeof confianza !== 'number' || !(confianza >= 0 && confianza <= 1)) return { ok: false, motivo: 'confianza_invalida' };
  if (cat !== null && !(typeof cat === 'string' && CATEGORIAS_GASTO.includes(cat))) return { ok: false, motivo: 'categoria_invalida' };
  return { ok: true, datos: { intencion, confianza, categoria_consultada: cat } };
}

/** `extraer`: todo campo pasa las mismas reglas que un movimiento escrito a mano. */
function extraer(salida) {
  if (!salida || typeof salida !== 'object' || !salida.entidades || typeof salida.entidades !== 'object') return { ok: false, motivo: 'no_es_objeto' };
  if (typeof salida.confianza !== 'number' || !(salida.confianza >= 0 && salida.confianza <= 1)) return { ok: false, motivo: 'confianza_invalida' };
  const e = salida.entidades;
  const clavesOk = ['tipo', 'importe', 'categoria', 'subcategoria', 'fecha', 'nota', 'recurrente'];
  if (Object.keys(e).sort().join(',') !== [...clavesOk].sort().join(',')) return { ok: false, motivo: 'campos_inesperados' };
  if (e.tipo !== null && !TIPOS.includes(e.tipo)) return { ok: false, motivo: 'tipo_invalido' };
  if (e.importe !== null && !esImporte(e.importe)) return { ok: false, motivo: 'importe_invalido' };
  if (e.fecha !== null && !esFecha(e.fecha)) return { ok: false, motivo: 'fecha_invalida' };
  if (typeof e.recurrente !== 'boolean') return { ok: false, motivo: 'recurrente_invalido' };
  if (e.categoria !== null) {
    if (!e.tipo || !tracker.CATEGORIES[e.tipo] || !tracker.CATEGORIES[e.tipo][e.categoria]) return { ok: false, motivo: 'categoria_invalida' };
    if (!subcats.valida(e.tipo, e.categoria, e.subcategoria)) return { ok: false, motivo: 'subcategoria_invalida' };
  } else if (e.subcategoria !== null) return { ok: false, motivo: 'subcategoria_sin_categoria' };
  if (e.nota !== null && (typeof e.nota !== 'string' || e.nota.length > 140 || /[<>]/.test(e.nota))) return { ok: false, motivo: 'nota_invalida' };
  return { ok: true, datos: { entidades: { ...e }, confianza: salida.confianza } };
}

// ───────── Cifras autorizadas ─────────
/** Todos los números que aparecen en un texto, como valores (1.234,56 → 1234.56; 31 % → 31). */
function numerosDe(texto) {
  const out = [];
  for (const m of String(texto).matchAll(/\d[\d.,\s]*\d|\d/g)) {
    let s = m[0].replace(/\s/g, '');
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) s = lastDot > lastComma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
    else if (lastComma >= 0) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
    else if (lastDot >= 0 && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Números autorizados: los de los hechos y sus redondeos naturales (entero y un decimal). */
function autorizados(hechos) {
  const set = new Set();
  const agrega = (n) => {
    for (const v of [n, Math.round(n), Math.round(n * 10) / 10, Math.round(n * 100) / 100]) set.add(Math.round(v * 100) / 100);
  };
  const recorre = (v) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'number') return agrega(v);
    if (typeof v === 'string') return numerosDe(v).forEach(agrega);
    if (Array.isArray(v)) return v.forEach(recorre);
    if (typeof v === 'object') return Object.values(v).forEach(recorre);
  };
  recorre(hechos);
  return set;
}

/** `redactar` y `consejo`: texto corto, sin términos prohibidos y sin una sola cifra que no estuviera en los hechos. */
/** `hechos` puede llegar como { hechos, dicho }: en un consejo también vale repetir cifras de la pregunta o de lo hablado. */
function texto(salida, hechos, { maxPalabras = MAX_PALABRAS } = {}) {
  if (!salida || typeof salida !== 'object' || Object.keys(salida).join(',') !== 'texto' || typeof salida.texto !== 'string') return { ok: false, motivo: 'forma_invalida' };
  const t = salida.texto.trim();
  if (!t) return { ok: false, motivo: 'vacio' };
  if (t.length > MAX_CARACTERES || t.split(/\s+/).length > maxPalabras) return { ok: false, motivo: 'demasiado_largo' };
  if (/<[^>]+>|https?:\/\/|www\./i.test(t)) return { ok: false, motivo: 'contenido_no_permitido' };
  const n = normalizar(t);
  const prohibido = PROHIBIDOS.find((p) => n.includes(p));
  if (prohibido) return { ok: false, motivo: 'termino_prohibido', detalle: prohibido };
  const ok = autorizados(hechos);
  const ajeno = numerosDe(t).find((x) => !ok.has(Math.round(x * 100) / 100));
  if (ajeno !== undefined) return { ok: false, motivo: 'cifra_no_autorizada', detalle: String(ajeno) };
  return { ok: true, datos: { texto: t } };
}

// ───────── Privacidad de lo que se envía (A9) ─────────
const CORREO = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const TELEFONO = /\+?\d[\d\s().-]{7,}\d/g;

/** Texto escrito por la persona: sin correos ni teléfonos, máximo 500 caracteres, dentro de etiquetas como DATO. */
function limpiarTexto(t) {
  return String(t || '').replace(CORREO, '[dato]').replace(TELEFONO, '[dato]').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
}

const CLAVES_HECHOS = /^[a-z_]{1,40}$/;
/** Hechos permitidos: claves cortas y valores de texto sin datos personales (nunca correo, nombre ni notas completas). */
function hechosSeguros(hechos) {
  const out = {};
  for (const [k, v] of Object.entries(hechos || {})) {
    if (!CLAVES_HECHOS.test(k) || ['correo', 'email', 'nombre', 'telefono', 'nota', 'notas', 'name'].includes(k)) continue;
    if (v === null || v === undefined) continue;
    out[k] = typeof v === 'object' ? JSON.parse(JSON.stringify(v), (kk, vv) => (typeof vv === 'string' ? limpiarTexto(vv).slice(0, 80) : vv)) : typeof v === 'string' ? limpiarTexto(v).slice(0, 80) : v;
  }
  return out;
}

module.exports = { clasificar, extraer, texto, numerosDe, autorizados, limpiarTexto, hechosSeguros, PROHIBIDOS };
