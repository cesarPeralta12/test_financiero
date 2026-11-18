'use strict';
// Ejecuta casos-parser.json contra el parser de referencia y resume los resultados.
// Uso: node docs/coach-v2/herramientas/probar-parser.js [--detalle]
const fs = require('node:fs');
const path = require('node:path');
const { parsear } = require('./parser-referencia');

const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'json', 'casos-parser.json'), 'utf8'));
const { fecha_referencia: hoy, moneda_cuenta: moneda } = doc.contexto;
const CLAVES = ['tipo', 'importe', 'categoria', 'subcategoria', 'fecha', 'recurrente']; // «nota» es informativa

const fallos = [];
const porGrupo = {};
for (const c of doc.casos) {
  const r = parsear(c.texto, { hoy, moneda });
  const problemas = [];
  const intEsperada = c.intencion === undefined ? null : c.intencion;
  if (r.intencion !== intEsperada) problemas.push(`intención ${r.intencion} ≠ ${intEsperada}`);
  if (c.entidades) {
    for (const k of CLAVES) {
      if (!(k in c.entidades)) continue;
      const esp = c.entidades[k];
      const got = r.entidades[k];
      if ((esp === null ? null : esp) !== (got === undefined ? null : got)) problemas.push(`${k}: ${JSON.stringify(got)} ≠ ${JSON.stringify(esp)}`);
    }
  }
  const faltaEsp = [...(c.falta || [])].sort().join(',');
  const faltaGot = [...r.falta].sort().join(',');
  if (faltaEsp !== faltaGot) problemas.push(`falta [${faltaGot}] ≠ [${faltaEsp}]`);
  if (c.respuesta && r.respuesta !== c.respuesta) problemas.push(`respuesta ${r.respuesta} ≠ ${c.respuesta}`);
  if (c.bandera && r.bandera !== c.bandera) problemas.push(`bandera ${r.bandera} ≠ ${c.bandera}`);
  porGrupo[c.grupo] = porGrupo[c.grupo] || { total: 0, ok: 0 };
  porGrupo[c.grupo].total++;
  if (!problemas.length) porGrupo[c.grupo].ok++;
  else fallos.push({ id: c.id, texto: c.texto, problemas });
}

const total = doc.casos.length;
const ok = total - fallos.length;
console.log(`Casos: ${total}  Correctos: ${ok}  (${((ok / total) * 100).toFixed(1)} %)\n`);
console.log('| Grupo | Correctos / total |');
console.log('|---|---|');
for (const [g, v] of Object.entries(porGrupo)) console.log(`| ${g} | ${v.ok} / ${v.total} |`);
if (fallos.length) {
  console.log('\nFallos:');
  for (const f of fallos) console.log(`${f.id} «${f.texto}»\n    ${f.problemas.join('\n    ')}`);
}
process.exit(fallos.length && process.argv.includes('--estricto') ? 1 : 0);
