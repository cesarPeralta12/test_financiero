'use strict';
// Genera tablas Markdown desde los JSON para los documentos 06, 07 y los apéndices.
// Uso: node docs/coach-v2/herramientas/generar-tablas.js <indice|catalogo|casos|umbrales|diccionario>
const fs = require('node:fs');
const path = require('node:path');
const J = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'json', f), 'utf8'));
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function indice() {
  const c = J('catalogo-mensajes.json');
  const out = [];
  out.push('| Grupo | Intenciones | Variantes | Descripción del grupo |', '|---|---|---|---|');
  for (const [g, d] of Object.entries(c.grupos)) {
    const its = c.intenciones.filter((i) => i.grupo === g);
    out.push(`| \`${g}\` | ${its.length} | ${its.reduce((a, i) => a + i.variantes.length, 0)} | ${esc(d)} |`);
  }
  out.push(`| **Total** | **${c.intenciones.length}** | **${c.intenciones.reduce((a, i) => a + i.variantes.length, 0)}** | |`);
  return out.join('\n');
}

function catalogo() {
  const c = J('catalogo-mensajes.json');
  const out = [];
  for (const [g, d] of Object.entries(c.grupos)) {
    const its = c.intenciones.filter((i) => i.grupo === g);
    if (!its.length) continue;
    out.push(`\n#### Grupo \`${g}\`: ${d}\n`);
    for (const it of its) {
      out.push(`**\`${it.id}\`** (${it.origen}): ${it.descripcion}`);
      out.push(`Variables: ${Object.entries(it.vars).map(([k, v]) => `\`${k}\` (${v})`).join(', ') || 'ninguna'}. Botones: ${(it.botones || []).map((b) => `\`${b}\``).join(', ') || 'ninguno'}.${it.grafico ? ` Gráfico: \`${it.grafico}\`.` : ''}\n`);
      out.push('| Variante | Tono | Sev. | Condición | Texto |', '|---|---|---|---|---|');
      for (const v of it.variantes) {
        const cond = (v.cuando || []).map((x) => `${x.var} ${x.op}${x.valor !== undefined ? ` ${x.valor}` : ''}`).join(' y ') || '—';
        out.push(`| \`${v.id}\` | ${v.tono} | ${v.severidad || 'info'} | ${esc(cond)} | ${esc(v.texto)} |`);
      }
      out.push('');
    }
  }
  return out.join('\n');
}

function casos() {
  const d = J('casos-parser.json');
  const out = ['| Id | Grupo | Texto | Intención | Entidades relevantes | Faltan | Respuesta | Bandera |', '|---|---|---|---|---|---|---|---|'];
  for (const c of d.casos) {
    const e = c.entidades ? Object.entries(c.entidades).filter(([k, v]) => v !== null && v !== false && k !== 'nota').map(([k, v]) => `${k}=${v}`).join(', ') : '';
    out.push(`| ${c.id} | ${c.grupo} | «${esc(c.texto)}» | ${c.intencion === null ? '—' : c.intencion} | ${esc(e)} | ${(c.falta || []).join(', ')} | ${c.respuesta || ''} | ${c.bandera || ''} |`);
  }
  return out.join('\n');
}

function umbrales() {
  const u = J('umbrales.json');
  const out = ['| Grupo | Umbral | Valor | Unidad | Descripción |', '|---|---|---|---|---|'];
  for (const [g, def] of Object.entries(u)) {
    if (typeof def !== 'object' || ['version', 'estado_global', 'nota'].includes(g)) continue;
    for (const [k, v] of Object.entries(def)) {
      const val = 'valor' in v ? JSON.stringify(v.valor) : JSON.stringify(Object.fromEntries(Object.entries(v).filter(([x]) => x !== 'descripcion')));
      out.push(`| ${g} | \`${k}\` | ${esc(val)} | ${esc(v.unidad || '')} | ${esc(v.descripcion || '')} |`);
    }
  }
  return out.join('\n');
}

function diccionario() {
  const d = J('diccionario-categorias.json');
  const out = ['| Tipo | Categoría | Subcategoría | Discrecional | Hormiga | Sinónimos |', '|---|---|---|---|---|---|'];
  for (const [tipo, cats] of Object.entries(d.categorias)) {
    for (const [c, def] of Object.entries(cats)) {
      out.push(`| ${tipo} | **${c}** | — | | | ${esc(def.sinonimos.join(', '))} |`);
      for (const [s, sd] of Object.entries(def.subcategorias || {})) out.push(`| ${tipo} | ${c} | ${s} | ${sd.discrecional ? 'sí' : 'no'} | ${sd.hormiga ? 'sí' : 'no'} | ${esc(sd.sinonimos.join(', '))} |`);
    }
  }
  return out.join('\n');
}

const modo = process.argv[2];
const mapa = { indice, catalogo, casos, umbrales, diccionario };
if (!mapa[modo]) {
  console.error('Uso: generar-tablas.js <indice|catalogo|casos|umbrales|diccionario>');
  process.exit(1);
}
console.log(mapa[modo]());
