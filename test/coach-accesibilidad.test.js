'use strict';
// CV2-602 (parte automática): comprobaciones mínimas de accesibilidad en las pantallas del Coach y de Mi dinero.
// NO sustituyen la revisión con lector de pantalla, teclado, zoom y contraste, que sigue pendiente de una persona
// (lista en docs/coach-v2/OPERACION.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const entitlements = require('../src/domain/entitlements');
const recurrentes = require('../src/domain/coach/recurrentes');
const plantillas = require('../src/domain/coach/plantillas');
const { setSetting } = require('../src/lib/services');

test.before(() => h.start());
test.after(() => h.stop());

function revisar(ruta, html) {
  const fallos = [];
  if (!/<html[^>]*\blang="es/i.test(html)) fallos.push('falta lang="es"');
  const h1 = (html.match(/<h1[\s>]/g) || []).length;
  if (h1 !== 1) fallos.push(`hay ${h1} <h1>`);
  if (/<img\b(?![^>]*\balt=)/i.test(html)) fallos.push('imagen sin alt');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const paraLabels = new Set([...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
    const attrs = m[2];
    if (/type="(hidden|submit|button|checkbox|radio)"/i.test(attrs)) continue;
    const id = (/\bid="([^"]+)"/.exec(attrs) || [])[1];
    const antes = html.slice(0, m.index);
    const envuelto = antes.lastIndexOf('<label') > antes.lastIndexOf('</label>'); // etiqueta implícita: <label>Texto <select>…
    const tiene = envuelto || (id && paraLabels.has(id)) || /aria-label(ledby)?=/.test(attrs);
    if (!tiene) fallos.push(`campo sin etiqueta: ${m[0].slice(0, 70)}`);
  }
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const texto = m[2].replace(/<[^>]+>/g, '').trim();
    if (!texto && !/aria-label=/.test(m[1])) fallos.push('botón sin nombre');
  }
  for (const m of html.matchAll(/\bfor="([^"]+)"/g)) if (!ids.has(m[1])) fallos.push(`label for="${m[1]}" sin campo`);
  return fallos.map((f) => `${ruta}: ${f}`);
}

test('las pantallas del Coach y de Mi dinero pasan las comprobaciones automáticas básicas', async () => {
  const c = new h.Client();
  await h.registerUser(c, 'a11y@ejemplo.test');
  const u = h.db.one('SELECT * FROM users WHERE email = ?', 'a11y@ejemplo.test');
  entitlements.grantManual({ userId: u.id, code: 'acompanamiento', days: 30, adminId: null, reason: 'prueba de accesibilidad' });
  setSetting('coach_v2_enabled', true);
  await c.get('/');
  recurrentes.crear(u.id, { tipo: 'gasto', categoria: 'servicios', monto: '9.00', nota: 'Nube', dia: 3 });
  plantillas.crear(u.id, { etiqueta: 'Pan', tipo: 'gasto', categoria: 'alimentacion', monto: '2' });
  await c.post('/mi-dinero/nuevo', { kindcat: 'gasto:alimentacion', amount: '12,50', date: new Date().toISOString().slice(0, 10), note: 'café' });
  await c.post('/coach/enviar', { texto: 'resumen del mes' });
  const fallos = [];
  for (const ruta of ['/coach', '/mi-dinero', '/mi-dinero/movimientos', '/mi-dinero/nuevo', '/mi-dinero/atajos', '/mi-dinero/analisis']) {
    const r = await c.get(ruta);
    assert.equal(r.status, 200, ruta);
    fallos.push(...revisar(ruta, r.text));
  }
  setSetting('coach_v2_enabled', false);
  assert.deepEqual(fallos, []);
});
