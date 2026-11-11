'use strict';
// Utilidades de prueba: aplicación con base en memoria y cliente HTTP con cookies y CSRF.
process.env.APP_ENV = 'testing';
process.env.DATABASE_PATH = ':memory:';
process.env.AI_PROVIDER = 'local';
// Las pruebas históricas usan el catálogo V2; las de V3 lo eligen explícitamente.
process.env.FREE_CATALOG_VERSION = process.env.FREE_CATALOG_VERSION || 'FREE_25_V2_ES';
process.env.PAYMENT_WEBHOOK_SECRET = 'whsec_pruebas';
process.env.SANDBOX_AUTO_DELIVER = 'false';
process.env.ADMIN_EMAIL = 'admin@diauno.test';
process.env.ADMIN_PASSWORD = 'Prueba-Admin-2026';

const db = require('../src/db');
db.open(':memory:');
require('../src/db/seed').seed({ quiet: true });
require('../src/jobs');
const { createApp } = require('../src/app');
const queue = require('../src/lib/queue');
const { resetRateLimits } = require('../src/lib/security');
const sandbox = require('../src/domain/gateways/sandbox');

let server;
let base;

async function start() {
  if (server) return base;
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}

async function stop() {
  if (server) await new Promise((r) => server.close(r));
  server = null;
}

class Client {
  constructor() {
    this.cookies = {};
    this.csrf = null;
  }
  cookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  store(res) {
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of set) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i);
      const v = pair.slice(i + 1);
      if (/Max-Age=0/.test(c) || v === '') delete this.cookies[k];
      else this.cookies[k] = v;
    }
  }
  async req(method, path, { form = null, json = null, headers = {}, follow = true } = {}) {
    let url = path.startsWith('http') ? path : base + path;
    let body;
    const h = { cookie: this.cookieHeader(), ...headers };
    if (form) {
      if (this.csrf && form._csrf === undefined) form = { _csrf: this.csrf, ...form };
      body = new URLSearchParams(flatten(form)).toString();
      h['content-type'] = 'application/x-www-form-urlencoded';
    } else if (json) {
      body = JSON.stringify(json);
      h['content-type'] = 'application/json';
      if (this.csrf) h['x-csrf-token'] = this.csrf;
    }
    let res = await fetch(url, { method, headers: h, body, redirect: 'manual' });
    this.store(res);
    let hops = 0;
    while (follow && res.status >= 300 && res.status < 400 && hops++ < 10) {
      url = new URL(res.headers.get('location'), url).toString();
      res = await fetch(url, { headers: { cookie: this.cookieHeader() }, redirect: 'manual' });
      this.store(res);
    }
    const text = await res.text();
    const m = text.match(/<meta name="csrf-token" content="([^"]+)"/);
    if (m) this.csrf = m[1];
    return { status: res.status, text, url, headers: res.headers, location: res.headers.get('location') };
  }
  get(path, opts) {
    return this.req('GET', path, opts);
  }
  post(path, form = {}, opts = {}) {
    return this.req('POST', path, { form, ...opts });
  }
}

function flatten(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' && x !== null ? flatten(x, `${key}[${i}]`, out) : out.push([key, String(x)])));
    else if (v && typeof v === 'object') flatten(v, key, out);
    else if (v !== undefined && v !== null) out.push([key, String(v)]);
  }
  return out;
}

const { FREE_ANSWERS, DEEP_ANSWERS } = require('./fixtures');

/** Responde un cuestionario completo siguiendo las redirecciones del flujo. */
async function answerAll(client, base, answers) {
  let r = await client.get(base);
  for (let guard = 0; guard < 40; guard++) {
    const m = r.url.match(/\/pregunta\/(\d+)/);
    if (!m) break;
    const pos = m[1];
    const code = (r.text.match(/data-code="([^"]+)"/) || [])[1];
    const ans = code ? answers[code] : null;
    if (!ans) throw new Error(`Sin respuesta de prueba para la pregunta ${pos} (${code})`);
    r = await client.post(`${base}/pregunta/${pos}`, { action: 'next', ...ans });
    if (r.status === 422) throw new Error(`Respuesta rechazada en ${code}: ${(r.text.match(/error-text[^>]*>([^<]+)/) || [])[1]}`);
  }
  return r;
}

async function registerUser(client, email, { password = 'Clave-segura-123', name = 'Prueba' } = {}) {
  await client.get('/registro');
  return client.post('/registro', { name, email, password, acepto: '1' });
}

async function login(client, email, password) {
  await client.get('/entrar');
  return client.post('/entrar', { email, password });
}

async function consent(client) {
  await client.get('/consentimiento');
  return client.post('/consentimiento', { acepto: '1' });
}

/** Simula el pago aprobado enviando el webhook firmado de la pasarela de pruebas. */
async function payViaWebhook(client, productCode) {
  await client.get(`/comprar/${productCode}`);
  const r = await client.post(`/comprar/${productCode}`, {}, { follow: false });
  const checkoutId = r.location.split('/').pop();
  sandbox.resolveCheckout(checkoutId, 'aprobar');
  const d = db.one('SELECT * FROM sandbox_deliveries ORDER BY id DESC LIMIT 1');
  const res = await deliver(d.payload);
  return { checkoutId, delivery: d, res };
}

async function deliver(payload, { signature = null } = {}) {
  const sig = signature || sandbox.sign(payload);
  const res = await fetch(`${base}/webhooks/pagos/sandbox`, { method: 'POST', headers: { 'content-type': 'application/json', 'dia-firma': sig }, body: payload });
  return { status: res.status, body: await res.json() };
}

/** Convierte un `value` de la API a los campos del formulario web. */
function formFields(value) {
  if (Array.isArray(value)) return { value };
  if (value && typeof value === 'object') {
    if (value.kind === 'AMOUNT') return { amount: value.amount, currency: value.currency };
    if (value.kind === 'AGE') return { age: String(value.value), ...(value.confirmed ? { confirmed: '1' } : {}) };
    return { choice: value.code };
  }
  return { value };
}

const hidden = (html, name) => (html.match(new RegExp(`name="${name}" value="([^"]*)"`)) || [])[1];

/** Responde el test gratuito por la web siguiendo las redirecciones. `answers` por slot (Q01…Q25). */
async function answerFree(client, answers = FREE_ANSWERS, { stopAfter = 25 } = {}) {
  let r = await client.get('/test');
  for (let guard = 0; guard < 60; guard++) {
    const m = r.url.match(/\/test\/pregunta\/(\d+)/);
    if (!m) break;
    const slot = (r.text.match(/data-slot="([^"]+)"/) || [])[1];
    if (Number(m[1]) > stopAfter) break;
    if (!(slot in answers)) throw new Error(`Sin respuesta de prueba para ${slot}`);
    r = await client.post(`/test/pregunta/${m[1]}`, {
      action: 'next',
      variant_id: hidden(r.text, 'variant_id'),
      expected_revision: hidden(r.text, 'expected_revision'),
      resolved_context_hash: hidden(r.text, 'resolved_context_hash'),
      ...formFields(answers[slot]),
    });
    if (r.status === 422) throw new Error(`Respuesta rechazada en ${slot}: ${(r.text.match(/error-text[^>]*>([^<]+)/) || [])[1]}`);
  }
  return r;
}

module.exports = { start, stop, Client, db, queue, resetRateLimits, FREE_ANSWERS, DEEP_ANSWERS, answerAll, answerFree, formFields, registerUser, login, consent, payViaWebhook, deliver, sandbox };
