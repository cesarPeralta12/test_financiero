'use strict';
// Crea una cuenta de demostración con datos ficticios recorriendo la aplicación por
// HTTP, igual que una persona: test gratuito, registro, compra del paquete en la
// pasarela de pruebas, evaluación profunda, Plan Maestro, movimientos y coach.
// Uso (con el servidor en marcha): npm run demo -- [http://localhost:3000]
// Credenciales: DEMO_EMAIL y DEMO_PASSWORD en .env. Nunca en producción.
const config = require('../src/config');
const { FREE_ANSWERS, DEEP_ANSWERS } = require('../test/fixtures');

if (config.isProd) {
  console.error('El script de demostración no se ejecuta en producción.');
  process.exit(1);
}

const base = (process.argv[2] || config.appUrl).replace(/\/$/, '');
const email = process.env.DEMO_EMAIL || 'demo@diauno.test';
const password = process.env.DEMO_PASSWORD;
if (!password) {
  console.error('Define DEMO_PASSWORD en .env (ver .env.example).');
  process.exit(1);
}

const jar = {};
let csrf = null;

function flatten(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' && x !== null ? flatten(x, `${key}[${i}]`, out) : out.push([key, String(x)])));
    else if (v && typeof v === 'object') flatten(v, key, out);
    else if (v !== undefined && v !== null) out.push([key, String(v)]);
  }
  return out;
}

async function req(method, path, form = null) {
  let url = base + path;
  const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
  let body;
  if (form) {
    body = new URLSearchParams(flatten({ _csrf: csrf, ...form })).toString();
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }
  let res = await fetch(url, { method, headers, body, redirect: 'manual' });
  for (let hops = 0; ; hops++) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar[pair.slice(0, i)] = pair.slice(i + 1);
    }
    if (res.status < 300 || res.status >= 400 || hops > 10) break;
    url = new URL(res.headers.get('location'), url).toString();
    res = await fetch(url, { headers: { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') }, redirect: 'manual' });
  }
  const text = await res.text();
  const m = text.match(/<meta name="csrf-token" content="([^"]+)"/);
  if (m) csrf = m[1];
  return { status: res.status, url, text };
}

async function answerAll(path, answers) {
  let r = await req('GET', path);
  for (let i = 0; i < 40; i++) {
    const m = r.url.match(/\/pregunta\/(\d+)/);
    if (!m) break;
    const code = (r.text.match(/data-code="([^"]+)"/) || [])[1];
    r = await req('POST', `${path}/pregunta/${m[1]}`, { action: 'next', ...answers[code] });
    if (r.status === 422) throw new Error(`Respuesta rechazada en ${code}`);
  }
  return r;
}

/** Responde el test gratuito de 25 preguntas por la web (campos ocultos incluidos). */
async function answerFree(answers) {
  const fields = (value) => {
    if (Array.isArray(value)) return { value };
    if (value && typeof value === 'object') {
      if (value.kind === 'AMOUNT') return { amount: value.amount, currency: value.currency };
      if (value.kind === 'AGE') return { age: String(value.value), ...(value.confirmed ? { confirmed: '1' } : {}) };
      return { choice: value.code };
    }
    return { value };
  };
  const hidden = (text, name) => (text.match(new RegExp(`name="${name}" value="([^"]*)"`)) || [])[1];
  let r = await req('GET', '/test');
  for (let i = 0; i < 60; i++) {
    const m = r.url.match(/\/test\/pregunta\/(\d+)/);
    if (!m) break;
    const slot = (r.text.match(/data-slot="([^"]+)"/) || [])[1];
    r = await req('POST', `/test/pregunta/${m[1]}`, {
      action: 'next',
      variant_id: hidden(r.text, 'variant_id'),
      expected_revision: hidden(r.text, 'expected_revision'),
      resolved_context_hash: hidden(r.text, 'resolved_context_hash'),
      ...fields(answers[slot]),
    });
    if (r.status === 422) throw new Error(`Respuesta rechazada en ${slot}`);
  }
  return r;
}

async function waitFor(path, pattern, label) {
  for (let i = 0; i < 40; i++) {
    const r = await req('GET', path);
    if (pattern.test(r.text)) return r;
    await new Promise((s) => setTimeout(s, 1000));
  }
  throw new Error(`Tiempo agotado esperando: ${label}`);
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

async function main() {
  const health = await fetch(`${base}/salud`).catch(() => null);
  if (!health || !health.ok) throw new Error(`No hay un servidor de Día Uno en ${base}. Arráncalo con «npm start».`);

  await req('GET', '/entrar');
  const login = await req('POST', '/entrar', { email, password });
  if (login.status === 200 && /\/inicio/.test(login.url)) {
    console.log(`La cuenta ${email} ya existe. Entra con ella en ${base}/entrar`);
    return;
  }

  console.log('1/7 Test gratuito');
  await req('GET', '/consentimiento');
  await req('POST', '/consentimiento', { acepto: '1' });
  await answerFree(FREE_ANSWERS);
  await req('POST', '/test/finalizar', {});

  console.log('2/7 Registro');
  await req('GET', '/registro');
  const reg = await req('POST', '/registro', { name: 'Ana', email, password, acepto: '1' });
  if (!/cuenta_creada/.test(reg.url)) throw new Error('No se pudo crear la cuenta de demostración.');

  console.log('3/7 Compra del paquete en la pasarela de pruebas');
  await req('GET', '/comprar/paquete');
  const co = await req('POST', '/comprar/paquete', {});
  const checkout = co.url.match(/\/pasarela-pruebas\/([^/?]+)/);
  if (!checkout) throw new Error('No se abrió el checkout de pruebas.');
  await req('POST', `/pasarela-pruebas/${checkout[1]}/aprobar`, {});
  await waitFor('/cuenta', /Pagada/, 'confirmación del pago por webhook');

  console.log('4/7 Evaluación profunda y diagnóstico');
  await answerAll('/evaluacion', DEEP_ANSWERS);
  const rev = await req('GET', '/evaluacion/revision');
  const ack = [...rev.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]);
  await req('POST', '/evaluacion/finalizar', { ack });

  console.log('5/7 Plan Maestro (Día Uno hace 6 días)');
  await req('GET', '/plan');
  await req('POST', '/plan/generar', { start_date: daysAgo(6) });
  await waitFor('/plan', /Plan de 90 días/, 'generación del plan');

  console.log('6/7 Movimientos, presupuesto y tareas');
  const month = new Date().toISOString().slice(0, 7);
  await req('GET', '/calculadora/presupuesto');
  await req('POST', `/calculadora/presupuesto?mes=${month}`, {
    b: { ingreso: { total: '30000' }, gasto: { vivienda: '8000', alimentacion: '5000', transporte: '2000', servicios: '1500', salud: '500', educacion: '1000', ocio: '1200', otros: '500' }, pago_deuda: { cuota: '6540' }, ahorro: { total: '2295' } },
  });
  const movs = [
    [daysAgo(6), 'ingreso:sueldo', '30000', 'Quincena y fin de mes'],
    [daysAgo(6), 'gasto:vivienda', '8000', 'Renta'],
    [daysAgo(5), 'gasto:alimentacion', '1850', 'Supermercado'],
    [daysAgo(4), 'pago_deuda:cuota', '2500', 'Cuota tarjeta'],
    [daysAgo(4), 'pago_deuda:extra', '2040', 'Pago extra tarjeta'],
    [daysAgo(3), 'gasto:servicios', '1480', 'Luz, agua e internet'],
    [daysAgo(2), 'gasto:transporte', '640', 'Gasolina'],
    [daysAgo(1), 'gasto:ocio', '420', 'Cine y cena'],
  ];
  for (const [date, kindcat, amount, note] of movs) await req('POST', '/calculadora/movimientos', { date, kindcat, amount, note });
  const board = await req('GET', '/tablero');
  const tasks = [...board.text.matchAll(/action="\/tareas\/(\d+)\/completar"/g)].map((m) => m[1]);
  for (const id of tasks.slice(0, 2)) await req('POST', `/tareas/${id}/completar`, {});

  console.log('7/7 Conversación con el coach');
  await req('GET', '/coach');
  await req('POST', '/coach/mensajes', { mensaje: '¿Cuál es mi siguiente paso?' });
  await req('POST', '/coach/mensajes', { mensaje: '¿Qué pasa si pago 1000 más a mi tarjeta?' });

  console.log(`\nListo. Entra en ${base}/entrar con DEMO_EMAIL y DEMO_PASSWORD de tu archivo .env.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
