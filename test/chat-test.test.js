'use strict';
// Test gratuito en forma de chat: bienvenida, respuestas escritas con tus palabras y saltos sin repetir temas.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const config = require('../src/config');
const chat4 = require('../src/domain/free/chat4');
const cat = require('../src/domain/free/catalog4');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

const V = cat.VARIANT_BY_ID;

test('intérprete: entiende respuestas libres comunes', () => {
  assert.deepEqual(chat4.interpret(V.V4_Q01, 'Bolivia').fields, { country: 'BO', currency: 'BOB' });
  assert.deepEqual(chat4.interpret(V.V4_Q02, 'tengo 29').fields, { codes: ['A25_34'] });
  assert.deepEqual(chat4.interpret(V.V4_Q04, 'vendo ropa en la feria').fields, { codes: ['INDEPENDENT'] });
  assert.deepEqual(chat4.interpret(V.V4_Q06, 'gano unos 2.500').fields, { amount: '2500' });
  assert.deepEqual(chat4.interpret(V.V4_Q10, 'no tengo deudas').fields, { status: 'NO' });
  assert.deepEqual(chat4.interpret(V.V4_Q10, 'sí, pago 400').fields, { status: 'DUE', amount: '400' });
  assert.deepEqual(chat4.interpret(V.V4_Q17, 'vender y cocinar').fields, { codes: ['SELL', 'COOK'] });
  assert.deepEqual(chat4.interpret(V.V4_Q07, 'no sé').fields, { special: 'DK' });
  assert.ok(chat4.interpret(V.V4_Q06, 'mucho').error, 'sin cifra no inventa un monto');
});

async function send(c, n, texto) {
  const page = await c.get(`/test/pregunta/${n}`);
  const pick = (re) => page.text.match(re)[1];
  return c.post(`/test/pregunta/${n}`, { variant_id: pick(/name="variant_id" value="([^"]+)"/), expected_revision: pick(/name="expected_revision" value="(\d+)"/), resolved_context_hash: pick(/name="resolved_context_hash" value="([^"]+)"/), action: 'next', texto }, { follow: false });
}

test('chat: bienvenida, respuestas escritas y sin deudas no vuelve a preguntar por deudas', async () => {
  const prev = config.freeCatalogVersion;
  config.freeCatalogVersion = 'FREE_24_V4_ES';
  try {
    const c = new h.Client();
    await h.consent(c);
    const hello = await c.get('/test');
    assert.match(hello.text, /Soy tu asistente financiero/);
    assert.match(hello.text, />Iniciar</);
    const q1 = await c.get('/test?empezar=1');
    assert.match(q1.text, /name="texto"/);
    assert.equal((await send(c, 1, 'Bolivia')).status, 303);
    const bad = await send(c, 2, 'asdkj qwe');
    assert.equal(bad.status, 422);
    assert.match(bad.text, /No te entendí/);
    const ok = await send(c, 2, 'tengo 29 años');
    assert.equal(ok.status, 303);
    // Historial de la conversación: lo escrito aparece interpretado.
    assert.match((await c.get('/test/pregunta/3')).text, /chat-msg--me">25 a 34</);
    const debt = await send(c, 10, 'no tengo deudas');
    assert.equal(debt.status, 303);
    assert.doesNotMatch(debt.location, /pregunta\/1[12]\b/, 'sin deudas no pregunta tipos ni pagos');
  } finally {
    config.freeCatalogVersion = prev;
  }
});

test('chat único: se responde escribiendo, sin deudas no pregunta por deudas y al final se ve el resultado', async () => {
  const prev = config.freeCatalogVersion;
  config.freeCatalogVersion = 'FREE_24_V4_ES';
  try {
    const c = new h.Client();
    await h.consent(c);
    const hello = await c.get('/test');
    assert.match(hello.text, /Soy tu asistente financiero/);
    assert.match(hello.text, />Iniciar</);
    const started = await c.get('/test?empezar=1');
    assert.match(started.text, /¿En qué país vives\?/);
    assert.match(started.text, /name="texto"/);
    const say = async (texto) => {
      const r = await c.req('POST', '/test/chat', { form: { texto }, headers: { accept: 'application/json' } });
      return { status: r.status, ...JSON.parse(r.text) };
    };
    const asked = [];
    const answers = ['Bolivia', 'tengo 30', 'ninguna', 'soy empleado', 'ganar más en 1 año', '4000', 'casi lo mismo', '2000', '500', 'no tengo deudas', '300', 'ninguna', 'computadora', '5 horas', 'vender', 'comercio', 'todavía no', 'amigos', 'no veo cómo crecer en mi puesto', 'conservar mi empleo', 'no', 'mejorar en mi empleo'];
    let r = await say('mmm');
    assert.equal(r.status, 422, 'no entiende: pide repetir sin avanzar');
    for (const a of answers) {
      r = await say(a);
      assert.equal(r.status, 200, `«${a}»: ${r.error}`);
      if (r.next) asked.push(r.next.text);
      if (r.done) break;
    }
    assert.ok(r.done, `terminó la conversación; última pregunta: ${asked[asked.length - 1]}`);
    assert.ok(!asked.some((q) => /¿Qué deudas tienes|¿Cómo vas con tus pagos/.test(q)), 'sin deudas no vuelve a preguntar por deudas');
    const end = await c.get('/test');
    assert.match(end.text, /Ver mi resultado/);
  } finally {
    config.freeCatalogVersion = prev;
  }
});
