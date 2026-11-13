'use strict';
// Control de calidad visual: recorre las pantallas principales con Chrome sin
// interfaz, comprueba que no haya desplazamiento horizontal desde 360 px y guarda
// capturas. Uso: npm run check:mobile -- [carpeta-capturas] [--anchos=360,1280]
// Requiere Google Chrome o Microsoft Edge instalados (CHROME_PATH para otra ruta).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const h = require('../test/helpers');

const outDir = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || path.join(os.tmpdir(), 'dia-uno-capturas'));
const widths = (process.argv.find((a) => a.startsWith('--anchos=')) || '--anchos=360,1280').split('=')[1].split(',').map(Number);
const shots = !process.argv.includes('--sin-capturas');
const dark = process.argv.includes('--oscuro');
// --movimiento: deja las animaciones activas y espera a que terminen antes de capturar.
const withMotion = process.argv.includes('--movimiento');

function chromePath() {
  const c = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return c.find((p) => p && fs.existsSync(p));
}

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    } else if (m.method) listeners.forEach((l) => l(m));
  };
  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        pending.set(n, { resolve, reject });
        ws.send(JSON.stringify({ id: n, method, params }));
      }),
    once: (method) => new Promise((r) => listeners.push((m) => m.method === method && r(m.params))),
    close: () => ws.close(),
  };
}

// Respuestas de la simulación ficticia del ingeniero para recorrer el test V3.
const V3_ANSWERS = {
  Q01: { country: 'BO', currency: 'BOB' }, Q02: 'A25_34', Q03: 'D1',
  Q04: { route: 'EMPLOYEE', occupation: 'Técnico de refrigeración y aire acondicionado' },
  Q05: { priority: 'INCOME', description: 'Aumentar mis ingresos y luego ahorrar para una vivienda', amount: '1500', target_kind: 'ADDITIONAL_INCOME', horizon_months: '6' },
  Q06: { amount: '5100' }, Q07: 'MODERATE', Q08: { amount: '3500' }, Q09: { amount: '500' },
  Q10: { presence: 'YES', monthly_due: { amount: '800' } }, Q11: { presence: 'YES', total_balance: { amount: '12000' }, types: ['LOAN'] },
  Q12: { code: 'ON_TIME' }, Q13: 'DK', Q14: { amount: '600' }, Q15: { codes: ['NONE'] },
  Q16: { codes: ['VEHICLE', 'EQUIPMENT'], detail: 'Motocicleta propia y herramientas' }, Q17: { hours: '8' },
  Q18: { skills: 'Diagnosticar fallas y reparar equipos', task: 'Reparé equipos sin cambiar piezas que parecían dañadas', result: 'Los clientes me volvieron a llamar' },
  Q19: { text: 'Viviendas, pequeños restaurantes y tiendas con refrigeradores' },
  Q20: { paid_before: 'YES', activity: 'Reparación y limpieza de aires acondicionados', frequency: 'REPEATED' },
  Q21: { text: 'Antiguos clientes y dos conocidos con restaurantes' },
  Q22: { code: 'OTHER', detail: 'Dependo de recomendaciones y no sé cuánto gano por trabajo' },
  Q23: { codes: ['KEEP_JOB', 'CARE'], detail: 'No trabajar todos los domingos' }, Q24: { amount: '300', available_now: 'LATER' }, Q25: 'SELL_SERVICE',
};

/** Cliente anónimo con una sesión V3 respondida hasta la pregunta `upTo` (y finalizada si se pide). */
async function v3Client(upTo, finish = false) {
  const config = require('../src/config');
  const engine = require('../src/domain/free/engine');
  const prev = config.freeCatalogVersion;
  config.freeCatalogVersion = 'FREE_25_V3_ES';
  const a = new h.Client();
  await h.consent(a);
  await a.get('/test?nuevo=1');
  config.freeCatalogVersion = prev;
  const s = h.db.one("SELECT id FROM ft_sessions WHERE version_id = 'FREE_25_V3_ES' ORDER BY rowid DESC LIMIT 1");
  for (const [slot, value] of Object.entries(V3_ANSWERS).slice(0, upTo)) {
    const cur = engine.loadSession(s.id);
    const r = engine.questionAt(cur, slot);
    if (r.question) engine.saveAnswer(s.id, slot, { variant_id: r.question.variant_id, expected_revision: cur.revision, value });
  }
  if (finish) await a.post('/test/finalizar', {});
  return a.cookies;
}

async function main() {
  const exe = chromePath();
  if (!exe) {
    console.error('No se encontró Chrome ni Edge. Define CHROME_PATH.');
    process.exit(2);
  }
  const base = await h.start();
  const today = new Date().toISOString().slice(0, 10);

  // Datos de demostración (ficticios) para recorrer todas las pantallas.
  const c = new h.Client();
  await c.get('/');
  const anonCookie = { ...c.cookies };
  await h.consent(c);
  const q1 = await c.get('/test');
  await h.answerFree(c);
  await c.post('/test/finalizar', {});
  await h.registerUser(c, 'demo@diauno.test', { name: 'Ana' });
  await h.payViaWebhook(c, 'paquete');
  await h.answerAll(c, '/evaluacion', h.DEEP_ANSWERS);
  const rev = await c.get('/evaluacion/revision');
  await c.post('/evaluacion/finalizar', { ack: [...rev.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]) });
  const diag = h.db.one('SELECT id FROM diagnoses ORDER BY id DESC LIMIT 1');
  await c.post('/plan/generar', { start_date: today });
  await h.queue.drain({ ignoreSchedule: true });
  await c.post('/coach/mensajes', { mensaje: '¿Cuál es mi siguiente paso?' });
  await c.post('/coach/mensajes', { mensaje: '¿Qué pasa si pago 1000 más a mi tarjeta?' });
  await c.post('/coach/mensajes', { mensaje: 'Gasté 350 en el super' });
  await c.post('/calculadora/movimientos', { date: today, kindcat: 'ingreso:sueldo', amount: '30000' });
  await c.post('/calculadora/movimientos', { date: today, kindcat: 'gasto:vivienda', amount: '8000', note: 'Renta' });
  const debt = h.db.one('SELECT id FROM debts LIMIT 1');
  await c.post(`/calculadora/deudas/${debt.id}/saldo`, { balance: '38000', date: today });
  const userCookie = { ...c.cookies };
  const admin = new h.Client();
  await h.login(admin, 'admin@diauno.test', 'Prueba-Admin-2026');
  const adminCookie = { ...admin.cookies };
  const plan = h.db.one('SELECT id FROM plan_versions LIMIT 1');
  void q1;

  const pages = [
    ['portada', '/', {}],
    ['consentimiento', '/consentimiento', {}],
    ['entrar', '/entrar', {}],
    ['registro', '/registro', {}],
    // Test gratuito V3 (FREE_25_V3_ES): primera pregunta, deudas y diagnóstico.
    ['v3-pregunta-pais', '/test/pregunta/1', anonCookie, () => v3Client(0)],
    ['v3-pregunta-interes', '/test/pregunta/13', anonCookie, () => v3Client(12)],
    ['v3-pregunta-deudas', '/test/pregunta/10', anonCookie, () => v3Client(9)],
    ['v3-pregunta-saldo', '/test/pregunta/11', anonCookie, () => v3Client(10)],
    ['v3-resultado', '/resultado', anonCookie, () => v3Client(25, true)],
    ['resultado', '/resultado', userCookie],
    ['inicio', '/inicio', userCookie],
    ['comprar', '/comprar/acompanamiento', userCookie],
    ['pregunta-deudas', '/evaluacion/pregunta/9', userCookie, async () => {
      await c.post('/evaluacion/nueva', {});
      return c.cookies;
    }],
    ['diagnostico', `/diagnostico/${diag.id}`, userCookie],
    ['plan', '/plan', userCookie],
    ['tablero', '/tablero', userCookie],
    ['coach', '/coach', userCookie],
    ['movimientos', '/calculadora/movimientos', userCookie],
    ['presupuesto', '/calculadora/presupuesto', userCookie],
    ['deudas', '/calculadora/deudas', userCookie],
    ['metas', '/calculadora/metas', userCookie],
    ['simulador', '/calculadora/simulador', userCookie],
    ['cuenta', '/cuenta', userCookie],
    ['logros', '/logros', userCookie],
    ['admin', '/admin', adminCookie],
    ['admin-usuarios', '/admin/usuarios', adminCookie],
    ['admin-ia', '/admin/ia', adminCookie],
    ['plan-version', `/plan/version/${plan.id}`, userCookie],
  ];

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dia-uno-chrome-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch {
      /* esperando a Chrome */
    }
  }
  const s = await cdp(target.webSocketDebuggerUrl);
  await s.send('Page.enable');
  await s.send('Network.enable');
  // Sin animaciones para que las capturas de página completa muestren todo el contenido.
  await s.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' },
      { name: 'prefers-reduced-motion', value: withMotion ? 'no-preference' : 'reduce' },
    ],
  });
  if (shots) fs.mkdirSync(outDir, { recursive: true });
  const problems = [];
  const host = new URL(base).hostname;

  for (const [name, url, cookies0, prepare] of pages) {
    const cookies = prepare ? await prepare() : cookies0;
    await s.send('Network.clearBrowserCookies');
    for (const [k, v] of Object.entries(cookies)) await s.send('Network.setCookie', { name: k, value: v, domain: host, path: '/' });
    for (const w of widths) {
      await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: w < 768 });
      const loaded = s.once('Page.loadEventFired');
      await s.send('Page.navigate', { url: base + url });
      await loaded;
      await new Promise((r) => setTimeout(r, withMotion ? 2600 : 150));
      const { result } = await s.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => { const d = document.documentElement; const wide = [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > d.clientWidth + 1).slice(0, 3).map(e => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : '')); return { sw: d.scrollWidth, cw: d.clientWidth, h: d.scrollHeight, path: location.pathname, wide }; })()`,
      });
      const v = result.value;
      const overflow = v.sw > v.cw + 1;
      if (overflow) problems.push(`${name} @${w}px: ancho ${v.sw} > ${v.cw} (${v.wide.join(', ')})`);
      if (v.path !== url.split('?')[0]) problems.push(`${name}: redirigió a ${v.path}`);
      if (shots) {
        const shot = await s.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(v.h, 6000), scale: 1 } });
        fs.writeFileSync(path.join(outDir, `${name}-${w}${dark ? '-oscuro' : ''}.png`), Buffer.from(shot.data, 'base64'));
      }
      console.log(`${overflow ? '✖' : '✔'} ${name} @${w}px${overflow ? ` desborda (${v.sw}px)` : ''}`);
    }
  }
  s.close();
  proc.kill();
  await h.stop();
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* Chrome puede tardar en liberar el perfil */
  }
  if (shots) console.log(`\nCapturas en ${outDir}`);
  if (problems.length) {
    console.error(`\nProblemas:\n- ${problems.join('\n- ')}`);
    process.exitCode = 1;
  } else console.log('Sin desplazamiento horizontal en ningún ancho.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
