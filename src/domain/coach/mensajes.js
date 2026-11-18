'use strict';
// Plantillas y selector de mensajes del Coach (referencia: docs/coach-v2/herramientas/plantillas.js y 03 §4).
// El texto sale del catálogo; las cifras las calcula el servidor; ninguna variante la redacta una IA.
const money = require('../../lib/money');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function numero(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Valor numérico inválido: ${v}`);
  return n;
}

/** Porcentaje: entero salvo que sea menor que 10 (un decimal). */
function fmtPct(n, firma = false) {
  const abs = Math.abs(n);
  const txt = (abs < 10 ? abs.toFixed(1) : String(Math.round(abs))).replace('.', ',');
  const signo = n < 0 ? '-' : firma && n > 0 ? '+' : '';
  return `${signo}${txt} %`;
}

const FORMATOS = {
  moneda: (v, ctx) => money.format(numero(v), ctx.moneda || 'USD'),
  pct: (v) => fmtPct(numero(v)),
  pct_signed: (v) => fmtPct(numero(v), true),
  entero: (v) => new Intl.NumberFormat('es').format(Math.round(numero(v))),
  fecha: (v) => {
    const [, m, d] = String(v).slice(0, 10).split('-').map(Number);
    return `${d} de ${MESES_CORTOS[m - 1]}.`;
  },
  mes: (v) => MESES[Number(String(v).slice(5, 7)) - 1],
  coma: (v) => (v === undefined || v === null || v === '' ? '' : `, ${v}`),
};

/** Aplica una cadena de formatos a un valor (abs:pct, abs:moneda…). */
function aplicar(valor, formatos, ctx) {
  let v = valor;
  for (const f of formatos) {
    if (f === 'abs') v = Math.abs(numero(v));
    else if (f.startsWith('plural=')) {
      const [sing, plur] = f.slice(7).split('|');
      v = numero(valor) === 1 ? sing : plur;
    } else if (FORMATOS[f]) v = FORMATOS[f](v, ctx);
    else throw new Error(`Formato desconocido: ${f}`);
  }
  return String(v);
}

/** Convierte una plantilla en texto. Lanza si falta una variable obligatoria. */
function renderizar(texto, vars, ctx = { moneda: 'USD' }) {
  return texto
    .replace(/\{([^{}]+)\}/g, (todo, interior) => {
      const [nombre, ...formatos] = interior.split(':');
      if (!(nombre in vars)) throw new Error(`Variable sin valor: ${nombre}`);
      return aplicar(vars[nombre], formatos, ctx);
    })
    .replace(/([^.])\.\.(?!\.)/g, '$1.'); // «14 de nov.» + «.» no deja dos puntos
}

/** Evalúa las condiciones declarativas de una variante (todas deben cumplirse). No hay código ni expresiones. */
function cumple(cuando, vars) {
  return (cuando || []).every((c) => {
    const v = vars[c.var];
    switch (c.op) {
      case '=': return String(v) === String(c.valor);
      case '!=': return String(v) !== String(c.valor);
      case '<': return numero(v) < numero(c.valor);
      case '<=': return numero(v) <= numero(c.valor);
      case '>': return numero(v) > numero(c.valor);
      case '>=': return numero(v) >= numero(c.valor);
      case 'en': return c.valor.includes(v);
      case 'no_en': return !c.valor.includes(v);
      case 'vacio': return v === undefined || v === null || v === '';
      case 'no_vacio': return !(v === undefined || v === null || v === '');
      default: throw new Error(`Operador desconocido: ${c.op}`);
    }
  });
}

/**
 * Elige una variante: filtra por condiciones, prefiere el tono pedido, evita las usadas recientemente
 * (si el tono preferido no tiene otra, rota a otro tono) y desempata de forma determinista con una semilla (un reintento devuelve lo mismo).
 */
function elegirVariante(intencion, vars, { tono = null, recientes = [], semilla = 0 } = {}) {
  let cand = intencion.variantes.filter((v) => cumple(v.cuando, vars));
  if (!cand.length) cand = intencion.variantes.filter((v) => !v.cuando);
  if (!cand.length) throw new Error(`Sin variante aplicable en ${intencion.id}`);
  const preferidas = tono && tono !== 'mixto' ? cand.filter((v) => v.tono === tono) : [];
  let pool = preferidas.length ? preferidas : cand;
  let frescas = pool.filter((v) => !recientes.includes(v.id));
  if (!frescas.length) frescas = cand.filter((v) => !recientes.includes(v.id)); // la misma pregunta no recibe siempre el mismo texto
  if (frescas.length) pool = frescas;
  return pool[Math.abs(semilla) % pool.length];
}

module.exports = { renderizar, cumple, elegirVariante, aplicar, FORMATOS, fmtPct };
