'use strict';
// Evaluación profunda (de pago) en forma de conversación: presentación, una pregunta a la vez,
// respuestas escritas y saltos («no tengo deudas» no sigue preguntando por deudas).
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const config = require('../src/config');
const deepChat = require('../src/domain/deepChat');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

// Respuesta escrita según lo que pregunta el asistente.
const REPLIES = [
  [/moneda/i, 'bolivianos'],
  [/fuente principal/i, '5000 al mes'],
  [/neta/i, 'sí, es neta'],
  [/otros ingresos/i, 'no'],
  [/mes malo/i, 'baja un poco'],
  [/en qué gastas|desglosa/i, 'comida y alquiler'],
  [/alimentaci/i, '1500'],
  [/vivienda/i, '1200'],
  [/una o pocas veces al año/i, 'no'],
  [/¿Tienes deudas\?/i, 'no tengo deudas'],
  [/apartas dinero/i, 'sí, 300 al mes'],
  [/ahorro tienes disponible/i, '2000'],
  [/no puedes retirar/i, 'no'],
  [/dependen económicamente/i, 'ninguna'],
  [/seguro o servicio de salud/i, 'no'],
  [/ingreso se detuviera/i, 'no'],
  [/gasto importante/i, 'ninguno'],
  [/dejar de gastar/i, 'no'],
  [/ingreso extra/i, 'no'],
  [/podrías vender/i, 'no'],
  [/metas quieres/i, 'fondo para emergencias'],
  [/cuánto necesitas/i, '10000'],
  [/cuánto tiempo/i, '1 año'],
  [/lo más importante/i, 'construir mi fondo para emergencias'],
  [/ajustar tus gastos/i, 'un poco'],
  // Genéricas para variantes del cuestionario.
  [/cuánto gastas en total/i, '2700'],
  [/^¿(Tienes|Recibes|Podrías|Apartas|Esperas)/i, 'no'],
  [/cuánto/i, '1000'],
];

test('intérprete de la evaluación: «no tengo deudas» termina la pregunta sin pedir montos', () => {
  const q = { type: 'debts', config: { simple: true, kinds: [{ value: 'tarjeta', label: 'Tarjeta de crédito' }] } };
  const s1 = deepChat.nextStep(q, {}, 'BOB');
  const r = s1.apply('no tengo deudas');
  assert.deepEqual(r.body.kinds, ['ninguna']);
  assert.equal(deepChat.nextStep(q, r.body, 'BOB'), null);
  const s2 = deepChat.nextStep(q, {}, 'BOB').apply('sí, una tarjeta');
  assert.deepEqual(s2.body.kinds, ['tarjeta']);
  assert.match(deepChat.nextStep(q, s2.body, 'BOB').text, /Cuánto debes en total en tarjeta de crédito/);
});

test('evaluación de pago como chat: se responde escribiendo y no pregunta por deudas que no hay', async () => {
  const c = new h.Client();
  await h.consent(c);
  await h.registerUser(c, 'chat-pago@ejemplo.test');
  await h.payViaWebhook(c, 'paquete');
  config.deepChat = true;
  try {
    let page = await c.get('/evaluacion');
    if (/\/conocido/.test(page.url)) page = await c.post('/evaluacion/conocido', { action: 'ninguno' });
    assert.match(page.text, /Soy tu asistente financiero/);
    assert.match(page.text, />Iniciar</);
    page = await c.get('/evaluacion?empezar=1');
    assert.match(page.text, /name="texto"/);
    let text = (page.text.match(/chat-msg--bot chat-q">([^<]+)</) || [])[1];
    const asked = [text];
    let r;
    for (let i = 0; i < 60 && text; i++) {
      const hit = REPLIES.find(([re]) => re.test(text));
      assert.ok(hit, `sin respuesta de prueba para «${text}»`);
      const res = await c.req('POST', '/evaluacion/chat', { form: { texto: hit[1] }, headers: { accept: 'application/json' } });
      r = JSON.parse(res.text);
      assert.equal(res.status, 200, `«${text}» → «${hit[1]}»: ${r.error}`);
      if (r.done) break;
      text = r.next.text;
      asked.push(text);
    }
    assert.ok(r && r.done, `llegó al final; última: ${asked[asked.length - 1]}`);
    assert.ok(!asked.some((q) => /pago atrasado|pagas tus tarjetas|Cuánto debes/i.test(q)), 'sin deudas no pregunta por deudas');
    const end = await c.get('/evaluacion');
    assert.match(end.text, /\/evaluacion\/revision/);
    const rev = await c.get('/evaluacion/revision');
    assert.equal(rev.status, 200);
  } finally {
    config.deepChat = false;
  }
});
