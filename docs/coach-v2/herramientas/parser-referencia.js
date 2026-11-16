'use strict';
// Parser de referencia (sin IA): intención + entidades a partir de texto libre.
// Es la especificación ejecutable de 07-parser-lenguaje-natural.md. No es código de
// la aplicación; se porta a src/domain/coach/ en la fase 2 del plan.
const fs = require('node:fs');
const path = require('node:path');
const { normalizar } = require('./plantillas');

const DIC = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'json', 'diccionario-categorias.json'), 'utf8'));
const MAX = 999999999.99;
const DIAS = DIC.fechas.dias_semana;
const MESES = DIC.fechas.meses;

// ───────── Utilidades ─────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** ¿La frase aparece en el texto como palabras completas? (acepta plural simple con s) */
function tiene(texto, frase) {
  return new RegExp(`(^|\\s)${esc(frase)}(s|es)?(?=\\s|$|[.,])`).test(texto);
}
const hayAlguna = (texto, frases) => frases.some((f) => tiene(texto, f));

function fechaISO(d) {
  return d.toISOString().slice(0, 10);
}
function sumarDias(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return fechaISO(d);
}
function diaSemana(iso) {
  return (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7; // lunes = 0
}

// ───────── Fechas ─────────
/** Extrae una fecha del texto. Devuelve { fecha, estado, resto } con estado ok|futura|invalida|ninguna. */
function extraerFecha(t, hoy) {
  let m;
  const ok = (fecha, resto) => ({ fecha, estado: fecha > hoy ? 'futura' : 'ok', resto });
  if (/(^|\s)(esta manana|esta tarde|esta noche|hoy)(?=\s|$)/.test(t)) return ok(hoy, t.replace(/(esta manana|esta tarde|esta noche|hoy)/, ' '));
  if (/(^|\s)(anteayer|antier|antes de ayer)(?=\s|$)/.test(t)) return ok(sumarDias(hoy, -2), t.replace(/(anteayer|antier|antes de ayer)/, ' '));
  if (/(^|\s)(anoche|ayer)(?=\s|$)/.test(t)) return ok(sumarDias(hoy, -1), t.replace(/(anoche|ayer)/, ' '));
  if (/(^|\s)manana(?=\s|$)/.test(t)) return { fecha: sumarDias(hoy, 1), estado: 'futura', resto: t.replace(/manana/, ' ') };
  // día de la semana: «el viernes», «el lunes pasado»
  m = t.match(new RegExp(`(^|\\s)(?:el )?(${DIAS.join('|')})( pasado)?(?=\\s|$)`));
  if (m) {
    const objetivo = DIAS.indexOf(m[2]);
    const dif = (diaSemana(hoy) - objetivo + 7) % 7;
    let fecha = sumarDias(hoy, -dif);
    if (m[3] && dif === 0) fecha = sumarDias(hoy, -7);
    return { fecha, estado: 'ok', resto: t.replace(m[0], ' ') };
  }
  // «5 de noviembre» (con año opcional)
  m = t.match(new RegExp(`(^|\\s)(?:el )?(\\d{1,2}) de (${MESES.join('|')})(?: de (\\d{4}))?(?=\\s|$)`));
  if (m) {
    const mes = (MESES.indexOf(m[3]) % 12 === 8 && m[3] === 'setiembre' ? 8 : MESES.indexOf(m[3]) >= 9 ? MESES.indexOf(m[3]) - 1 : MESES.indexOf(m[3])) + 1;
    return construir(Number(m[4] || hoy.slice(0, 4)), mes, Number(m[2]), hoy, t.replace(m[0], ' '));
  }
  // 05/11, 05/11/2026
  m = t.match(/(^|\s)(?:el )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s|$)/);
  if (m) {
    const dd = Number(m[2]);
    const mm = Number(m[3]);
    if (mm <= 12) {
      const y = m[4] ? (m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4])) : Number(hoy.slice(0, 4));
      return construir(y, mm, dd, hoy, t.replace(m[0], ' '));
    }
  }
  return { fecha: null, estado: 'ninguna', resto: t };
}
function construir(y, m, d, hoy, resto) {
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const real = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(real.getTime()) || fechaISO(real) !== iso) return { fecha: null, estado: 'invalida', resto };
  return { fecha: iso, estado: iso > hoy ? 'futura' : 'ok', resto };
}

// ───────── Importes ─────────
/** Misma regla de separadores que parseAmount de src/lib/money.js. */
function leerNumero(s) {
  s = s.replace(/^\$/, '').replace(/[.,]+$/, '');
  if (!/^[0-9.,]+$/.test(s)) return null;
  const ult = { p: s.lastIndexOf('.'), c: s.lastIndexOf(',') };
  let decimal = null;
  if (ult.p >= 0 && ult.c >= 0) decimal = ult.p > ult.c ? '.' : ',';
  else if (ult.p >= 0 || ult.c >= 0) {
    const sep = ult.p >= 0 ? '.' : ',';
    const veces = s.split(sep).length - 1;
    const despues = s.length - s.lastIndexOf(sep) - 1;
    const entera = s.slice(0, s.indexOf(sep));
    if (veces > 1) decimal = null;
    else if (despues === 3 && entera !== '0' && entera !== '') decimal = null;
    else decimal = sep;
  }
  let norm;
  if (decimal) {
    const miles = decimal === '.' ? ',' : '.';
    const [ent, ...resto] = s.split(decimal);
    if (resto.length > 1) return null;
    norm = `${ent.split(miles).join('')}.${resto[0] || '0'}`;
  } else norm = s.replace(/[.,]/g, '');
  if (!/^\d+(\.\d+)?$/.test(norm)) return null;
  const frac = norm.split('.')[1];
  if (frac && frac.length > 2) return { invalido: true };
  return { valor: Number(norm) };
}

function palabrasNumero(tokens, i) {
  // Devuelve { valor, hasta } para un grupo de palabras-número desde i, o null.
  const P = DIC.numeros.palabras;
  let total = 0;
  let cur = 0;
  let j = i;
  let fuerte = false;
  while (j < tokens.length && (tokens[j] in P || (tokens[j] === 'y' && j > i && tokens[j + 1] in P))) {
    const w = tokens[j];
    if (w !== 'y') {
      const v = P[w];
      if (['un', 'una', 'uno'].includes(w) && !['mil', 'luca', 'lucas', 'millon'].includes(tokens[j + 1])) break;
      if (v === 1000 || v === 1000000) {
        total += (cur || 1) * v;
        cur = 0;
      } else cur += v;
      if (v >= 2 || ['cien', 'ciento'].includes(w)) fuerte = true;
    }
    j++;
  }
  if (j === i || !fuerte) return null;
  return { valor: total + cur, hasta: j };
}

/** Busca el importe. Devuelve { valor|null, estado, bandera, resto }. */
function extraerImporte(t, monedaCuenta) {
  const tokens = t.split(' ');
  let moneda = null;
  let bandera = null;
  for (const [k, v] of Object.entries(DIC.normalizacion.equivalencias)) if (tokens.includes(k)) moneda = v === 'peso' ? monedaCuenta : v.toUpperCase();
  if (tokens.includes('bs') || tokens.includes('bob')) moneda = 'BOB';
  if (moneda && moneda !== monedaCuenta) bandera = 'moneda_distinta';

  const MULT = DIC.numeros.multiplicadores_sufijo;
  const usados = new Set();
  let valor = null;
  let estado = 'ninguno';
  for (let i = 0; i < tokens.length && valor === null; i++) {
    let tk = tokens[i];
    if (tk.includes('/')) continue;
    let mult = 1;
    const mk = tk.match(/^(\$?[\d.,]+)k$/);
    if (mk) {
      tk = mk[1];
      mult = 1000;
    }
    if (/^-?\$?\d[\d.,]*$/.test(tk)) {
      if (tk.startsWith('-')) {
        estado = 'invalido';
        usados.add(i);
        continue;
      }
      const r = leerNumero(tk);
      usados.add(i);
      if (!r || r.invalido) {
        estado = 'invalido';
        continue;
      }
      let v = r.valor * mult;
      const sig = tokens[i + 1];
      if (sig && MULT[sig] && (sig !== 'm' && sig !== 'k')) {
        v *= MULT[sig].valor;
        usados.add(i + 1);
        if (MULT[sig].regional) bandera = bandera || 'regional_confirmar';
      }
      if (v <= 0 || v > MAX) {
        estado = 'invalido';
        continue;
      }
      valor = v;
      estado = 'ok';
    }
  }
  if (valor === null && estado !== 'invalido') {
    if (tokens.includes('cero')) estado = 'invalido';
    for (let i = 0; i < tokens.length && estado === 'ninguno'; i++) {
      const g = palabrasNumero(tokens, i);
      if (g) {
        let v = g.valor;
        const sig = tokens[g.hasta];
        if (sig && DIC.numeros.multiplicadores_sufijo[sig] && sig !== 'mil' && sig !== 'm' && sig !== 'k') {
          v *= DIC.numeros.multiplicadores_sufijo[sig].valor;
          if (DIC.numeros.multiplicadores_sufijo[sig].regional) bandera = bandera || 'regional_confirmar';
          usados.add(g.hasta);
        }
        for (let k = i; k < g.hasta; k++) usados.add(k);
        valor = v;
        estado = v > 0 && v <= MAX ? 'ok' : 'invalido';
        if (estado === 'invalido') valor = null;
      }
    }
  }
  const resto = tokens.filter((_, i) => !usados.has(i)).join(' ');
  return { valor, estado, bandera, resto };
}

// ───────── Categorías ─────────
function buscarCategoria(t, tipo) {
  const cats = DIC.categorias[tipo] || {};
  let mejor = null;
  // La categoría «otros» solo gana si nada más coincide; el nombre de cada categoría cuenta como sinónimo.
  const mejora = (cat, sub, f) => {
    const largo = f.length - (cat === 'otros' ? 100 : 0);
    if (!mejor || largo > mejor.largo) mejor = { cat, sub, nota: f, largo };
  };
  for (const [cat, def] of Object.entries(cats)) {
    for (const [sub, sd] of Object.entries(def.subcategorias || {})) for (const f of sd.sinonimos) if (tiene(t, f)) mejora(cat, sub, f);
    for (const f of [...def.sinonimos, cat]) if (tiene(t, f)) mejora(cat, mejor && mejor.cat === cat ? mejor.sub : null, f);
  }
  return mejor;
}

// ───────── Intenciones ─────────
const EDUCATIVO = [
  ['explicar_estrategias_deuda', ['bola de nieve', 'avalancha']],
  ['explicar_50_30_20', ['50/30/20']],
  ['explicar_tasa_ahorro', ['tasa de ahorro']],
  ['explicar_reserva', ['reserva de emergencia', 'fondo de emergencia']],
  ['explicar_hormiga', ['hormiga']],
  ['explicar_proyeccion', ['proyeccion']],
  ['explicar_saldo', ['saldo']],
];
const CUE_EDUCATIVO = ['explicame', 'que es', 'que son', 'como calculas', 'como se calcula', 'que significa', 'que diferencia', 'cual es la diferencia', 'bola de nieve o avalancha'];

function mejorFrase(t, lista) {
  let mejor = 0;
  for (const f of lista) if (tiene(t, f) && f.length > mejor) mejor = f.length;
  return mejor;
}

function intencionPorFrases(t) {
  let mejor = null;
  for (const [intencion, frases] of Object.entries(DIC.sinonimos_de_intencion)) {
    if (['saludo', 'despedida', 'gracias', 'deshacer', 'ayuda_menu', 'tarea_completada', 'identidad_ia'].includes(intencion)) continue;
    const largo = mejorFrase(t, frases);
    if (largo && (!mejor || largo > mejor.largo)) mejor = { intencion, largo };
  }
  return mejor;
}

const CONVERSACION = [
  ['saludo', ['hola', 'buenas', 'buenos dias', 'buen dia', 'buenas tardes', 'buenas noches', 'que tal']],
  ['despedida', ['adios', 'hasta luego', 'chao', 'nos vemos']],
  ['gracias', ['gracias', 'muchas gracias', 'mil gracias']],
];

function resultado(intencion, confianza, entidades, falta = [], extra = {}) {
  return {
    intencion,
    confianza,
    entidades: { tipo: null, importe: null, categoria: null, subcategoria: null, fecha: null, nota: null, recurrente: false, ...entidades },
    alternativas: [],
    falta,
    ...extra,
  };
}

/**
 * parsear(texto, { hoy: 'AAAA-MM-DD', moneda: 'USD' }) -> ResultadoParser (+ bandera, respuesta)
 */
function parsear(texto, { hoy, moneda = 'USD' } = {}) {
  const crudo = String(texto || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\([^)]*\)/g, ' ');
  const t = normalizar(crudo);
  if (!t) return resultado('desconocido', 0, {}, [], { respuesta: 'no_entendi' });

  const palabras = t.split(' ');
  const corto = palabras.length <= 4;

  // 1) Conversación breve
  if (corto) {
    for (const [intencion, frases] of CONVERSACION) if (frases.some((f) => t === f || t.startsWith(`${f} `))) return resultado(intencion, 0.95, {}, [], { respuesta: intencion });
  }
  const identidad = DIC.sinonimos_de_intencion.identidad_ia;
  if (hayAlguna(t, identidad)) return resultado('identidad_ia', 0.95, {}, [], { respuesta: 'identidad_ia' });

  // 2) Educativo
  if (hayAlguna(t, CUE_EDUCATIVO) || t.includes('bola de nieve') || t.includes('avalancha')) {
    for (const [intencion, claves] of EDUCATIVO) if (claves.some((c) => t.includes(c))) return resultado(intencion, 0.9, {}, [], { respuesta: intencion });
  }
  // 3) Límites
  if (hayAlguna(t, DIC.asesoria_especifica)) return resultado('consejo_especifico', 0.85, {}, [], { respuesta: 'consejo_especifico_no' });
  if (hayAlguna(t, DIC.fuera_de_alcance)) return resultado('fuera_de_alcance', 0.85, {}, [], { respuesta: 'fuera_de_alcance' });
  if (tiene(t, 'privacidad') || tiene(t, 'que datos usas')) return resultado('privacidad_info', 0.9, {}, [], { respuesta: 'privacidad_info' });

  // 4) Correcciones del último registro
  if (/^(no era|era|mejor|corrige|cambia|cambialo|cambiala)\b/.test(t)) {
    const f = extraerFecha(t, hoy);
    const imp = extraerImporte(f.resto, moneda);
    const cat = buscarCategoria(t, 'gasto');
    const imp2 = imp.estado === 'ok' ? imp : null;
    const ultimo = /(^|\s)(?:era|a) (\d[\d.,]*)\b/.test(t) ? t.match(/(\d[\d.,]*)\s*$/) : null;
    const valorCorr = ultimo ? leerNumero(ultimo[1]) : imp2 && { valor: imp2.valor };
    if (valorCorr && valorCorr.valor) return resultado('corregir_importe', 0.85, { importe: valorCorr.valor.toFixed(2) }, [], { respuesta: 'registro_editado' });
    if (f.fecha && f.estado === 'ok') return resultado('corregir_fecha', 0.85, { fecha: f.fecha }, [], { respuesta: 'registro_editado' });
    if (cat) return resultado('corregir_categoria', 0.85, { categoria: cat.cat }, [], { respuesta: 'registro_editado' });
  }
  if (hayAlguna(t, DIC.sinonimos_de_intencion.deshacer)) return resultado('deshacer', 0.9, {}, [], { respuesta: 'deshacer_ok' });

  // 5) Fecha e importe
  const f = extraerFecha(t, hoy);
  const imp = extraerImporte(f.resto, moneda);
  const hayImporte = imp.estado !== 'ninguno';

  // 6) Simulación: lleva importe pero es una consulta
  if (['que pasa si', 'y si pago', 'simula', 'simulacion', 'si pago mas'].some((p) => t.includes(p))) return resultado('simular_pago_extra', 0.9, {}, [], { respuesta: 'simular_pago_extra' });

  // 7) Tarea hecha / ayuda (frases cortas)
  if (!hayImporte) {
    if (hayAlguna(t, DIC.sinonimos_de_intencion.tarea_completada)) return resultado('tarea_completada', 0.8, {}, [], { respuesta: 'tarea_completada_propuesta' });
    if (hayAlguna(t, DIC.sinonimos_de_intencion.ayuda_menu)) return resultado('ayuda_menu', 0.9, {}, [], { respuesta: 'ayuda_menu' });
  }

  // 8) Consultas por frases (sin importe, o con importe pero sin verbo de registro)
  const tipoVerbo = detectarTipo(t);
  if (!hayImporte || !tipoVerbo) {
    const m = intencionPorFrases(t);
    if (m) {
      if (m.intencion === 'gasto_categoria') {
        const cat = buscarCategoria(t, 'gasto');
        if (cat) return resultado('gasto_categoria', 0.9, { categoria: cat.cat, subcategoria: ['super'].includes(cat.sub) ? cat.sub : null }, [], { respuesta: 'gasto_categoria' });
      }
      return resultado(m.intencion, Math.min(0.97, 0.7 + m.largo / 40), {}, [], { respuesta: m.intencion });
    }
  }

  // 9) Registro
  const regional = imp.bandera === 'regional_confirmar';
  const tipoDeclarado = tipoVerbo;
  const hipotetico = !tipoDeclarado && (hayAlguna(t, DIC.hipoteticos) || /\?/.test(texto));
  if (hipotetico) return resultado('consulta_abierta', 0.3, {}, [], { respuesta: 'ia_ofrecer' });
  let tipo = tipoDeclarado;
  let cat = tipo ? buscarCategoria(t, tipo) : null;
  if (!tipo && (hayImporte || buscarCategoria(t, 'gasto'))) {
    const cg = buscarCategoria(t, 'gasto');
    if (cg && cg.cat !== 'otros') {
      tipo = 'gasto';
      cat = cg;
    }
  }
  if (tipo === 'gasto' && !cat && hayAlguna(t, DIC.verbos_de_comida)) cat = { cat: 'alimentacion', sub: 'restaurante', nota: t.split(' ').find((w) => DIC.verbos_de_comida.includes(w)) };
  if (tipo || hayImporte) {
    const falta = [];
    const entidades = { tipo, importe: imp.estado === 'ok' ? imp.valor.toFixed(2) : null, categoria: null, subcategoria: null, fecha: null, nota: null };
    if (!tipo) falta.push('tipo');
    if (imp.estado !== 'ok') falta.push('importe');
    if (cat) {
      entidades.categoria = cat.cat;
      entidades.subcategoria = cat.sub;
      entidades.nota = cat.nota;
    } else if (tipo === 'ahorro' || tipo === 'retiro_ahorro' || tipo === 'pago_deuda') {
      entidades.categoria = tipo === 'pago_deuda' ? 'cuota' : 'otros';
      if (tipo === 'pago_deuda' && /(extra|adelanto)/.test(t)) entidades.categoria = 'extra';
    } else if (tipo === 'ingreso' && /vendi/.test(t)) {
      entidades.categoria = 'extra';
    } else falta.push('categoria');
    if (f.estado === 'ok') entidades.fecha = f.fecha;
    else if (f.estado === 'ninguna') entidades.fecha = hoy;
    else falta.push('fecha');
    entidades.recurrente = hayAlguna(t, DIC.marcadores_de_recurrente);
    if (!entidades.nota) entidades.nota = notaResiduo(imp.resto) || null;
    const intencion = tipo ? { gasto: 'registrar_gasto', ingreso: 'registrar_ingreso', pago_deuda: 'registrar_pago_deuda', ahorro: 'registrar_ahorro', retiro_ahorro: 'registrar_retiro' }[tipo] : null;
    let respuesta = 'registro_vista_previa';
    if (falta.includes('fecha')) respuesta = 'aclarar_fecha';
    else if (imp.bandera === 'moneda_distinta') respuesta = 'moneda_info';
    else if (falta.includes('importe')) respuesta = 'aclarar_importe';
    else if (falta.includes('tipo')) respuesta = 'aclarar_tipo';
    else if (falta.includes('categoria')) respuesta = 'aclarar_categoria';
    const confianza = falta.length ? 0.55 : regional ? 0.7 : 0.95;
    return resultado(intencion, confianza, entidades, falta, { respuesta, bandera: imp.bandera || undefined });
  }

  // 10) Sin reglas: consulta abierta (ofrece IA) o desconocido
  if (palabras.length >= 5 || /\?/.test(texto)) return resultado('consulta_abierta', 0.3, {}, [], { respuesta: 'ia_ofrecer' });
  return resultado('desconocido', 0.1, {}, [], { respuesta: 'no_entendi' });
}

function detectarTipo(t) {
  const V = DIC.verbos_de_tipo;
  const deuda = /(tarjeta|prestamo|deuda|credito|cuota|abono|abone|amortice|liquide)/.test(t);
  if (hayAlguna(t, DIC.verbos_de_comida)) return 'gasto';
  if (/deposite/.test(t) && /(ahorro|fondo|meta|reserva)/.test(t)) return 'ahorro';
  if (hayAlguna(t, V.retiro_ahorro) || (/(saque|retire|use|tome)/.test(t) && /(ahorro|reserva|fondo)/.test(t))) return 'retiro_ahorro';
  if (/(ahorre|aparte|guarde|separe|aporte|puse en mi fondo|meti a mi ahorro)/.test(t)) return 'ahorro';
  if (/(^|\s)(cobre|cobro|recibi|me pagaron|me depositaron|me llego|gane|vendi|me enviaron|me mandaron|me dio|me dieron|me transfirieron|me abonaron|ingreso|sueldo es)(\s|$)/.test(t)) return 'ingreso';
  if (/(sueldo es|mi sueldo|mi salario)/.test(t)) return 'ingreso';
  if (deuda && /(pague|pago|abono|abone|cuota|amortice|liquide)/.test(t)) return 'pago_deuda';
  if (/(^|\s)(gaste|gasto|pague|pago|compre|compra|costo|me cobraron|consumi)(\s|$)/.test(t)) return 'gasto';
  return null;
}

function notaResiduo(resto) {
  const vacias = new Set([...DIC.palabras_vacias, ...DIC.numeros.frases_de_importe, 'gaste', 'compre', 'pague', 'anota', 'apunta', 'costo', 'cobre', 'recibi', 'me', 'pagaron', 'depositaron', 'llego', 'gane', 'vendi', 'dolares', 'euros', 'bs', 'cada', 'mes', 'cosas', 'cosa']);
  const rest = resto.split(' ').filter((w) => w && !vacias.has(w) && !/^\d/.test(w));
  return rest.join(' ');
}

module.exports = { parsear };
