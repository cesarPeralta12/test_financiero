'use strict';
// Prueba los sonidos de referencia en Chromium sin cabeza (Playwright preinstalado).
// Renderiza cada sonido fuera de línea y comprueba: pico, silencio al final y duración.
// Uso: node docs/coach-v2/herramientas/probar-sfx.js
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const codigo = fs.readFileSync(path.join(__dirname, 'sfx-referencia.js'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<button id="b">ok</button>');
  await page.addScriptTag({ content: codigo });
  const res = await page.evaluate(async () => {
    const out = {};
    for (const nombre of Object.keys(Sfx.SONIDOS)) {
      for (const vol of [0.2, 1]) {
        const { datos, tasa, duracion } = await Sfx.renderizar(nombre, vol);
        let pico = 0;
        for (let i = 0; i < datos.length; i++) pico = Math.max(pico, Math.abs(datos[i]));
        const cola = datos.slice(datos.length - Math.floor(tasa * 0.05));
        let picoCola = 0;
        for (let i = 0; i < cola.length; i++) picoCola = Math.max(picoCola, Math.abs(cola[i]));
        out[`${nombre}@${vol}`] = { pico: +pico.toFixed(4), picoCola: +picoCola.toFixed(5), duracion: +duracion.toFixed(2), sonoro: pico > 0.001 };
      }
    }
    // En vivo: sin gesto el contexto puede quedar suspendido; con clic debe iniciar sin lanzar.
    Sfx.configurar({ activo: true, volumen: 0.2 });
    const antes = Sfx.sonar('ingreso'); // sin iniciar: debe devolver false, sin error
    document.getElementById('b').addEventListener('click', () => Sfx.iniciar());
    document.getElementById('b').click();
    await new Promise((r) => setTimeout(r, 150));
    const estadoCtx = Sfx._estado.ctx ? Sfx._estado.ctx.state : 'sin_contexto';
    return { out, antes, estadoCtx };
  });
  await browser.close();

  let ok = true;
  console.log('| Sonido | Volumen | Pico | Pico en los últimos 50 ms | Duración total (s) |');
  console.log('|---|---|---|---|---|');
  for (const [k, v] of Object.entries(res.out)) {
    const [nombre, vol] = k.split('@');
    const maximo = vol === '1' ? 0.26 : 0.07;
    const bien = v.sonoro && v.pico <= maximo && v.picoCola < 0.005;
    if (!bien) ok = false;
    console.log(`| ${nombre} | ${vol} | ${v.pico} | ${v.picoCola} | ${v.duracion} | ${bien ? '' : '← FALLA'}`.replace(/ \|  $/, ' |'));
  }
  console.log(`\nsonar() sin iniciar el contexto devuelve false sin lanzar: ${res.antes === false}`);
  console.log(`Estado del contexto tras un clic: ${res.estadoCtx}`);
  console.log(`Errores de página: ${errores.length ? errores.join('; ') : 'ninguno'}`);
  if (res.antes !== false || errores.length) ok = false;
  console.log(ok ? '\nTodo en orden.' : '\nHay fallos.');
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
