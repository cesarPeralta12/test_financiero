'use strict';
// Gráficos del Coach (docs/coach-v2/05 §4): el JSON es el contrato (esquemas.json › Grafico) y la vista
// solo lo dibuja. Se renderizan en el servidor como SVG sin librerías (compatible con la política de
// seguridad) y funcionan sin JavaScript. Accesibles: cada serie lleva un patrón además del color, los
// valores están como texto, hay un resumen y una tabla «Ver datos».
const money = require('../../lib/money');
const { escape } = require('../../lib/html');

const PATRONES = ['liso', 'rayas', 'puntos', 'cuadros'];
const token = (i) => `serie-${(i % 8) + 1}`;
const patron = (i) => PATRONES[i % PATRONES.length];
const fmt = (v, cur) => money.format(v, cur);
const pctTxt = (p) => (p === null || p === undefined ? '' : `${p < 10 ? String(p.toFixed(1)).replace('.', ',') : Math.round(p)} %`);

function base(tipo, titulo, cur, extra) {
  return { tipo, titulo, moneda: cur, orden: 'valor_desc', series: [], ...extra };
}

// ───────── Constructores de datos ─────────
function barrasCategorias(cur, titulo, filas, { destacar = 0 } = {}) {
  const series = filas.map((x, i) => ({ id: x.id, etiqueta: x.etiqueta, valor: x.valor, pct: x.pct ?? null, token_color: token(i), patron: patron(i), destacar: i === destacar }));
  const top = filas[0];
  return base('barras_categorias', titulo, cur, {
    series,
    a11y: {
      resumen: top ? `${top.etiqueta} es la categoría más grande: ${fmt(top.valor, cur)}${top.pct == null ? '' : `, ${pctTxt(top.pct)} del total`}.` : 'Sin datos.',
      tabla: [['Categoría', 'Monto', '%'], ...filas.map((x) => [x.etiqueta, fmt(x.valor, cur), pctTxt(x.pct)])],
    },
  });
}

function barraIngresoGasto(cur, titulo, ingreso, gasto, saldo) {
  const series = [
    { id: 'ingreso', etiqueta: 'Ingresos', valor: ingreso, token_color: token(2), patron: 'liso' },
    { id: 'gasto', etiqueta: 'Gastos', valor: gasto, token_color: token(5), patron: 'rayas' },
    { id: 'saldo', etiqueta: 'Saldo', valor: saldo, token_color: token(0), patron: 'puntos' },
  ];
  return base('barra_ingreso_gasto', titulo, cur, { orden: 'fijo', series, a11y: { resumen: `Ingresos ${fmt(ingreso, cur)}, gastos ${fmt(gasto, cur)}; saldo ${fmt(saldo, cur)}.`, tabla: [['Concepto', 'Monto'], ...series.map((s) => [s.etiqueta, fmt(s.valor, cur)])] } });
}

function tendenciaVsRitmo(cur, titulo, diario, referencias, resumen) {
  const series = diario.map((v, i) => ({ id: `d${String(i + 1).padStart(2, '0')}`, etiqueta: String(i + 1), valor: v }));
  return base('tendencia_vs_ritmo', titulo, cur, {
    orden: 'fecha',
    series,
    referencias,
    a11y: { resumen, tabla: [['Día', 'Acumulado'], ...series.filter((_, i) => i === series.length - 1 || (i + 1) % 5 === 0).map((s) => [s.etiqueta, fmt(s.valor, cur)])] },
  });
}

function comparativaMeses(cur, titulo, items, mesActual, mesAnterior) {
  const series = items.map((x, i) => ({ id: x.id, etiqueta: x.etiqueta, valor: x.valor, valor_comparado: x.valor_comparado, delta_pct: x.delta_pct ?? null, token_color: token(i), patron: patron(i), destacar: i === 0 }));
  const t = items[0];
  return base('comparativa_meses', titulo, cur, {
    orden: 'cambio_desc',
    series,
    etiquetas: { actual: mesActual, anterior: mesAnterior },
    a11y: {
      resumen: t ? `${t.etiqueta}: ${fmt(t.valor, cur)} este mes frente a ${fmt(t.valor_comparado, cur)} el anterior${t.delta_pct == null ? '' : `, ${t.delta_pct > 0 ? '+' : ''}${pctTxt(t.delta_pct)}`}.` : 'Sin datos.',
      tabla: [['Categoría', 'Este mes', 'Mes anterior', 'Cambio'], ...items.map((x) => [x.etiqueta, fmt(x.valor, cur), fmt(x.valor_comparado, cur), x.delta_pct == null ? 'nueva' : `${x.delta_pct > 0 ? '+' : ''}${pctTxt(x.delta_pct)}`])],
    },
  });
}

function mesAMes(cur, titulo, puntos) {
  const series = puntos.map((p, i) => ({ id: p.mes, etiqueta: p.etiqueta, valor: p.valor, token_color: token(i), patron: 'liso' }));
  return base('mes_a_mes', titulo, cur, { orden: 'fecha', series, a11y: { resumen: `Gasto de los últimos ${puntos.length} meses: ${puntos.map((p) => `${p.etiqueta} ${fmt(p.valor, cur)}`).join(', ')}.`, tabla: [['Mes', 'Gasto'], ...puntos.map((p) => [p.etiqueta, fmt(p.valor, cur)])] } });
}

function mapaSemana(cur, titulo, promedios, masAlto) {
  const nombres = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  const series = promedios.map((v, i) => ({ id: nombres[i], etiqueta: nombres[i], valor: v, token_color: token(i), patron: i === masAlto ? 'rayas' : 'liso', destacar: i === masAlto }));
  return base('mapa_semana', titulo, cur, { orden: 'fijo', series, a11y: { resumen: `El día de mayor gasto promedio es ${nombres[masAlto]}: ${fmt(promedios[masAlto], cur)}.`, tabla: [['Día', 'Promedio'], ...series.map((s) => [s.etiqueta, fmt(s.valor, cur)])] } });
}

function medidor(tipo, cur, titulo, etiqueta, valor, objetivo, usado) {
  const p = objetivo > 0 ? (valor / objetivo) * 100 : null;
  return base(tipo, titulo, cur, {
    orden: 'fijo',
    series: [{ id: 'valor', etiqueta, valor: String(valor), pct: p, token_color: token(0), patron: 'liso', destacar: true }],
    referencias: [{ etiqueta: tipo === 'medidor_meta' ? 'Objetivo' : 'Previsto', valor: String(objetivo) }],
    a11y: { resumen: `${etiqueta}: ${fmt(valor, cur)} de ${fmt(objetivo, cur)}${p === null ? '' : ` (${pctTxt(p)})`}.${usado ? '' : ''}`, tabla: [['Concepto', 'Monto'], [etiqueta, fmt(valor, cur)], [tipo === 'medidor_meta' ? 'Objetivo' : 'Previsto', fmt(objetivo, cur)]] },
  });
}

function cascadaMes(cur, titulo, ingreso, gasto, deuda, ahorro, saldo) {
  const pasos = [
    ['Ingresos', Number(ingreso)],
    ['Gastos', -Number(gasto)],
    ['Deudas', -Number(deuda)],
    ['Ahorro', -Number(ahorro)],
    ['Saldo libre', Number(saldo)],
  ];
  const series = pasos.map(([etiqueta, v], i) => ({ id: etiqueta.toLowerCase().replace(/\s/g, '_'), etiqueta, valor: String(v), token_color: token(i), patron: patron(i) }));
  return base('cascada_mes', titulo, cur, { orden: 'fijo', series, a11y: { resumen: `De ${fmt(ingreso, cur)} de ingresos, ${fmt(gasto, cur)} van a gastos, ${fmt(deuda, cur)} a deudas y ${fmt(ahorro, cur)} a ahorro: quedan ${fmt(saldo, cur)}.`, tabla: [['Paso', 'Monto'], ...series.map((s) => [s.etiqueta, fmt(s.valor, cur)])] } });
}

function sparkline(cur, titulo, valores) {
  const series = valores.slice(-30).map((v, i) => ({ id: `p${i + 1}`, etiqueta: String(i + 1), valor: String(v) }));
  const ult = series[series.length - 1];
  return base('sparkline', titulo, cur, { orden: 'fecha', series, a11y: { resumen: ult ? `Último valor: ${fmt(ult.valor, cur)}.` : 'Sin datos.', tabla: [['Punto', 'Valor'], ...series.map((s) => [s.etiqueta, fmt(s.valor, cur)])] } });
}

// ───────── Vista SVG ─────────
const W = 340;
let uid = 0;

function defs(id) {
  return `<defs>
    <pattern id="${id}-rayas" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="gr-bg"/><line x1="0" y1="0" x2="0" y2="6" class="gr-pat" stroke-width="2.5"/></pattern>
    <pattern id="${id}-puntos" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" class="gr-bg"/><circle cx="3" cy="3" r="1.4" class="gr-pat-fill"/></pattern>
    <pattern id="${id}-cuadros" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" class="gr-bg"/><rect width="4" height="4" class="gr-pat-fill"/><rect x="4" y="4" width="4" height="4" class="gr-pat-fill"/></pattern>
  </defs>`;
}
// Relleno: color del token + patrón (el patrón se dibuja encima con un borde claro entre barras).
function fill(id, s) {
  const cls = `gs ${s.token_color}`;
  const pat = s.patron && s.patron !== 'liso' ? `<rect x="@x" y="@y" width="@w" height="@h" rx="3" fill="url(#${id}-${s.patron})" class="gr-over"/>` : '';
  return { cls, pat };
}
function barra(id, s, x, y, w, h) {
  const f = fill(id, s);
  const base = `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(w, 1).toFixed(1)}" height="${h}" rx="3" class="${f.cls}${s.destacar ? ' gr-hl' : ''}"/>`;
  return base + f.pat.replace('@x', x.toFixed(1)).replace('@y', y.toFixed(1)).replace('@w', Math.max(w, 1).toFixed(1)).replace('@h', h);
}
const corta = (t, n = 22) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const txt = (x, y, t, cls = '', anchor = 'start') => `<text x="${x}" y="${y}" class="gr-t ${cls}" text-anchor="${anchor}">${escape(t)}</text>`;

function svgBarrasH(g, id) {
  const cur = g.moneda;
  const max = Math.max(...g.series.map((s) => Number(s.valor)), 1);
  const lab = 124;
  const val = 92;
  const ancho = W - lab - val;
  const alto = 18;
  const sep = 10;
  const filas = g.series.map((s, i) => {
    const y = 8 + i * (alto + sep);
    const w = (Number(s.valor) / max) * ancho;
    return txt(0, y + 13, corta(s.etiqueta, 20), 'gr-lab') + barra(id, s, lab, y, w, alto) + txt(lab + w + 6, y + 13, `${fmt(s.valor, cur)}${s.pct != null ? ` · ${pctTxt(s.pct)}` : ''}`, 'gr-val');
  });
  const h = 8 + g.series.length * (alto + sep);
  return { h, body: filas.join('') };
}

function svgIngresoGasto(g, id) {
  const cur = g.moneda;
  const [ing, gas, sal] = g.series;
  const max = Math.max(Number(ing.valor), Number(gas.valor), Math.abs(Number(sal.valor)), 1);
  const lab = 70;
  const ancho = W - lab - 100;
  const fila = (s, i) => {
    const y = 8 + i * 30;
    const w = (Math.abs(Number(s.valor)) / max) * ancho;
    return txt(0, y + 14, s.etiqueta, 'gr-lab') + barra(id, { ...s, destacar: s.id === 'saldo' }, lab, y, w, 20) + txt(lab + w + 6, y + 14, `${fmt(s.valor, cur)}`, 'gr-val');
  };
  return { h: 100, body: [ing, gas, sal].map(fila).join('') };
}

function svgLinea(g, id, { puntos, ref = null, etiqueta = true }) {
  const alto = 130;
  const left = 8;
  const w = W - left - 8;
  const max = Math.max(...puntos, ...(ref ? [ref] : []), 1);
  const x = (i) => left + (puntos.length > 1 ? (i / (puntos.length - 1)) * w : w / 2);
  const y = (v) => alto - 16 - (v / max) * (alto - 36);
  const d = puntos.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const refLinea = ref ? `<line x1="${left}" x2="${W - 8}" y1="${y(ref).toFixed(1)}" y2="${y(ref).toFixed(1)}" class="gr-ref" stroke-dasharray="5 4"/>` : '';
  const ultimo = puntos[puntos.length - 1];
  return {
    h: alto,
    body: `${refLinea}<path d="${d}" class="gr-line" fill="none" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(puntos.length - 1).toFixed(1)}" cy="${y(ultimo).toFixed(1)}" r="4" class="gr-dot"/>${etiqueta ? txt(left, alto - 2, g.series[0].etiqueta, 'gr-ax') + txt(W - 8, alto - 2, g.series[g.series.length - 1].etiqueta, 'gr-ax', 'end') : ''}`,
  };
}

function svgColumnas(g, id) {
  const cur = g.moneda;
  const n = g.series.length;
  const max = Math.max(...g.series.map((s) => Number(s.valor)), 1);
  const alto = 130;
  const ancho = (W - 16) / n;
  const body = g.series
    .map((s, i) => {
      const h = Math.max((Number(s.valor) / max) * (alto - 44), 1);
      const x = 8 + i * ancho + ancho * 0.15;
      return barra(id, s, x, alto - 22 - h, ancho * 0.7, h) + txt(x + ancho * 0.35, alto - 8, s.etiqueta, 'gr-ax', 'middle') + (n <= 7 ? txt(x + ancho * 0.35, alto - 26 - h, fmt(s.valor, cur), 'gr-val gr-small', 'middle') : '');
    })
    .join('');
  return { h: alto, body };
}

function svgComparativa(g, id) {
  const cur = g.moneda;
  const max = Math.max(...g.series.flatMap((s) => [Number(s.valor), Number(s.valor_comparado)]), 1);
  const lab = 96;
  const ancho = W - lab - 70;
  const body = g.series
    .map((s, i) => {
      const y = 8 + i * 50;
      const w1 = (Number(s.valor) / max) * ancho;
      const w2 = (Number(s.valor_comparado) / max) * ancho;
      const cambio = s.delta_pct == null ? 'nueva' : `${s.delta_pct > 0 ? '+' : ''}${pctTxt(s.delta_pct)}`;
      return txt(0, y + 14, corta(s.etiqueta, 16), 'gr-lab') + barra(id, { ...s, destacar: true }, lab, y, w1, 16) + txt(lab + w1 + 5, y + 13, fmt(s.valor, cur), 'gr-val gr-small') + barra(id, { ...s, token_color: 'serie-0', patron: 'liso', destacar: false }, lab, y + 20, w2, 12) + txt(lab + w2 + 5, y + 30, fmt(s.valor_comparado, cur), 'gr-val gr-small gr-mute') + txt(W, y + 13, cambio, 'gr-val', 'end');
    })
    .join('');
  return { h: 8 + g.series.length * 50, body };
}

function svgMedidor(g, id) {
  const s = g.series[0];
  const p = Math.max(0, Math.min(s.pct ?? 0, 100));
  const sobre = (s.pct ?? 0) >= 100;
  const w = (W - 16) * (p / 100);
  const marca80 = 8 + (W - 16) * 0.8;
  const body = `<rect x="8" y="22" width="${W - 16}" height="20" rx="10" class="gr-track"/>${barra(id, { ...s, token_color: sobre && g.tipo === 'medidor_presupuesto' ? 'serie-6' : 'serie-1', patron: sobre ? 'rayas' : 'liso', destacar: true }, 8, 22, w, 20)}${g.tipo === 'medidor_presupuesto' ? `<line x1="${marca80}" x2="${marca80}" y1="18" y2="46" class="gr-ref" stroke-width="2"/>` : ''}${txt(8, 14, s.etiqueta, 'gr-lab')}${txt(W - 8, 14, `${fmt(s.valor, g.moneda)} de ${fmt(g.referencias[0].valor, g.moneda)} · ${pctTxt(s.pct)}`, 'gr-val', 'end')}`;
  return { h: 54, body };
}

function svgCascada(g, id) {
  const cur = g.moneda;
  const valores = g.series.map((s) => Number(s.valor));
  const total = valores[0] || 1;
  const alto = 130;
  const ancho = (W - 16) / g.series.length;
  let acum = 0;
  const body = g.series
    .map((s, i) => {
      const v = valores[i];
      const ini = i === 0 || i === g.series.length - 1 ? 0 : acum;
      const fin = i === 0 ? v : i === g.series.length - 1 ? v : acum + v;
      acum = i === 0 ? v : i === g.series.length - 1 ? acum : acum + v;
      const top = Math.max(ini, fin);
      const bot = Math.min(ini, fin);
      const k = (alto - 46) / total;
      const x = 8 + i * ancho + ancho * 0.12;
      return barra(id, s, x, alto - 22 - Math.max(top, 0) * k, ancho * 0.76, Math.max((top - bot) * k, 1)) + txt(x + ancho * 0.38, alto - 8, corta(s.etiqueta, 10), 'gr-ax gr-small', 'middle') + txt(x + ancho * 0.38, alto - 26 - Math.max(top, 0) * k, fmt(Math.abs(v), cur), 'gr-val gr-small', 'middle');
    })
    .join('');
  return { h: alto, body };
}

/** Dibuja un gráfico (JSON) como HTML con SVG, resumen accesible y tabla de datos. */
function render(g) {
  const id = `gr${++uid}`;
  let r;
  switch (g.tipo) {
    case 'barras_categorias': r = svgBarrasH(g, id); break;
    case 'barra_ingreso_gasto': r = svgIngresoGasto(g, id); break;
    case 'tendencia_vs_ritmo': r = svgLinea(g, id, { puntos: g.series.map((s) => Number(s.valor)), ref: g.referencias && g.referencias[1] ? Number(g.referencias[1].valor) : null }); break;
    case 'sparkline': r = svgLinea(g, id, { puntos: g.series.map((s) => Number(s.valor)), etiqueta: false }); break;
    case 'comparativa_meses': r = svgComparativa(g, id); break;
    case 'mes_a_mes':
    case 'mapa_semana': r = svgColumnas(g, id); break;
    case 'medidor_meta':
    case 'medidor_presupuesto': r = svgMedidor(g, id); break;
    case 'cascada_mes': r = svgCascada(g, id); break;
    default: r = { h: 0, body: '' };
  }
  const filas = (g.a11y && g.a11y.tabla) || [];
  const tabla = filas.length
    ? `<details class="gr-data"><summary>Ver datos</summary><table><thead><tr>${filas[0].map((c) => `<th scope="col">${escape(c)}</th>`).join('')}</tr></thead><tbody>${filas.slice(1).map((f) => `<tr>${f.map((c, i) => (i ? `<td>${escape(c)}</td>` : `<th scope="row">${escape(c)}</th>`)).join('')}</tr>`).join('')}</tbody></table></details>`
    : '';
  return `<figure class="gr gr--${g.tipo}"><figcaption>${escape(g.titulo)}</figcaption><svg viewBox="0 0 ${W} ${r.h}" width="100%" role="img" aria-label="${escape(g.a11y ? g.a11y.resumen : g.titulo)}" focusable="false">${defs(id)}${r.body}</svg><p class="gr-sum">${escape(g.a11y ? g.a11y.resumen : '')}</p>${tabla}</figure>`;
}

module.exports = { barrasCategorias, barraIngresoGasto, tendenciaVsRitmo, comparativaMeses, mesAMes, mapaSemana, medidor, cascadaMes, sparkline, render, TIPOS: ['barras_categorias', 'barra_ingreso_gasto', 'tendencia_vs_ritmo', 'comparativa_meses', 'mes_a_mes', 'mapa_semana', 'medidor_meta', 'medidor_presupuesto', 'cascada_mes', 'sparkline'] };
