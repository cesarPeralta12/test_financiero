'use strict';
// Compila toda la documentación de docs/coach-v2 en un solo Markdown descargable:
// docs/coach-v2/COACH-V2-COMPLETO.md. Uso: node docs/coach-v2/herramientas/compilar.js
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const tabla = (modo) => execFileSync('node', [path.join(__dirname, 'generar-tablas.js'), modo], { encoding: 'utf8' }).trim();
const slug = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-');

const docs = fs.readdirSync(RAIZ).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();
const titulos = {};
for (const f of docs) titulos[f] = leer(f).match(/^# (.+)$/m)[1];
titulos['README.md'] = 'Coach v2 de Día Uno: especificación completa';

/** Reemplaza enlaces entre archivos por anclas internas del documento único. */
function enlaces(md) {
  return md.replace(/\]\(((?:\d\d-[^)]*|README)\.md)\)/g, (m, f) => (titulos[f] ? `](#${slug(titulos[f])})` : m));
}

const fecha = new Date().toISOString().slice(0, 10);
const partes = [];
partes.push(`# Coach v2 de Día Uno: documento completo\n\n_Compilado el ${fecha} a partir de \`docs/coach-v2/\`. Contiene la especificación (documentos 01 a 12), el catálogo de mensajes legible, el diccionario, los 244 casos del parser, los umbrales, los esquemas JSON, la migración SQL y el código de referencia. No incluye cambios al código de la aplicación._\n`);

// Índice
const indice = ['## Contenido\n', `- [Resumen y cómo leer esto](#${slug(titulos['README.md'])})`];
for (const f of docs) indice.push(`- [${titulos[f]}](#${slug(titulos[f])})`);
indice.push('- [Apéndice A · Catálogo de mensajes completo](#apéndice-a--catálogo-de-mensajes-completo)');
indice.push('- [Apéndice B · Diccionario de categorías y sinónimos](#apéndice-b--diccionario-de-categorías-y-sinónimos)');
indice.push('- [Apéndice C · Casos de prueba del parser](#apéndice-c--casos-de-prueba-del-parser)');
indice.push('- [Apéndice D · Umbrales de producto](#apéndice-d--umbrales-de-producto)');
indice.push('- [Apéndice E · Esquemas JSON](#apéndice-e--esquemas-json)');
indice.push('- [Apéndice F · Migración SQL propuesta](#apéndice-f--migración-sql-propuesta)');
indice.push('- [Apéndice G · Precios y calculadora de costos](#apéndice-g--precios-y-calculadora-de-costos)');
indice.push('- [Apéndice H · Código de referencia](#apéndice-h--código-de-referencia)');
partes.push(indice.join('\n') + '\n');

partes.push(enlaces(leer('README.md')));
for (const f of docs) partes.push('\n---\n\n' + enlaces(leer(f)));

partes.push('\n---\n\n# Apéndice A · Catálogo de mensajes completo\n');
partes.push('Versión `MSG_V1_ES`. Cada intención muestra sus variables, botones y todas sus variantes. Fuente: `json/catalogo-mensajes.json`.\n');
partes.push('Resumen por grupo:\n\n' + tabla('indice'));
partes.push(tabla('catalogo'));

partes.push('\n---\n\n# Apéndice B · Diccionario de categorías y sinónimos\n');
partes.push('Palabras ya normalizadas (minúsculas, sin tildes). Fuente: `json/diccionario-categorias.json`, que también contiene verbos por tipo, sinónimos de intención, números en palabras, fechas, monedas y listas de límites.\n');
partes.push(tabla('diccionario'));

partes.push('\n---\n\n# Apéndice C · Casos de prueba del parser\n');
partes.push('Fecha de referencia 2026-11-16 (lunes), moneda de la cuenta USD. El grupo `prueba_ciega_v1` documenta frases que no estaban en el banco inicial. Fuente: `json/casos-parser.json`.\n');
partes.push(tabla('casos'));

partes.push('\n---\n\n# Apéndice D · Umbrales de producto\n');
partes.push('Todos son reglas de producto **pendientes de validar** por el responsable de contenido financiero. Fuente: `json/umbrales.json`.\n');
partes.push(tabla('umbrales'));

partes.push('\n---\n\n# Apéndice E · Esquemas JSON\n');
partes.push('JSON Schema 2020-12. Fuente: `json/esquemas.json`.\n\n```json\n' + leer('json/esquemas.json').trim() + '\n```');

partes.push('\n---\n\n# Apéndice F · Migración SQL propuesta\n');
partes.push('Probada con `herramientas/probar-migracion.js` sobre las migraciones 001 a 004 reales. No está aplicada al proyecto.\n\n```sql\n' + leer('herramientas/005_coach_v2.sql').trim() + '\n```');

partes.push('\n---\n\n# Apéndice G · Precios y calculadora de costos\n');
partes.push('Precios (`json/precios-modelos.json`):\n\n```json\n' + leer('json/precios-modelos.json').trim() + '\n```\n');
partes.push('Calculadora (`herramientas/costos.js`), salida actual:\n\n```text\n' + execFileSync('node', [path.join(__dirname, 'costos.js')], { encoding: 'utf8' }).trim() + '\n```\n');
partes.push('Código:\n\n```js\n' + leer('herramientas/costos.js').trim() + '\n```');

partes.push('\n---\n\n# Apéndice H · Código de referencia\n');
partes.push('Especificación ejecutable; **no es código de la aplicación**. Cada archivo está en `docs/coach-v2/herramientas/`.\n');
for (const f of ['plantillas.js', 'parser-referencia.js', 'probar-parser.js', 'validar.js', 'sfx-referencia.js', 'probar-sfx.js', 'probar-migracion.js', 'generar-tablas.js']) {
  partes.push(`\n## ${f}\n\n\`\`\`js\n${leer(`herramientas/${f}`).trim()}\n\`\`\``);
}

const salida = path.join(RAIZ, 'COACH-V2-COMPLETO.md');
fs.writeFileSync(salida, partes.join('\n') + '\n');
const texto = fs.readFileSync(salida, 'utf8');
const bloques = (texto.match(/^```/gm) || []).length;
console.log(`Escrito ${path.relative(process.cwd(), salida)}: ${(texto.length / 1024).toFixed(0)} KB, ${texto.split('\n').length} líneas, ${bloques} marcas de bloque de código (${bloques % 2 === 0 ? 'balanceadas' : 'DESBALANCEADAS'}).`);
