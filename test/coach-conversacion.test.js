'use strict';
// Coach en conversación libre: responde directo, recuerda lo hablado, usa diagnóstico y metas, da un consejo
// calculado si la IA falla y anota conversando, sin salir del chat.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const entitlements = require('../src/domain/entitlements');
const tracker = require('../src/domain/tracker');
const adaptadores = require('../src/domain/coach/ia/adaptadores');
const validar = require('../src/domain/coach/ia/validar');
const conversacion = require('../src/domain/coach/conversacion');
const { setSetting } = require('../src/lib/services');

const original = adaptadores.local;
let enviado = [];
let contestar = null;

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => {
  h.resetRateLimits();
  setSetting('coach_v2_enabled', true);
  setSetting('coach_v2_ia_directa', true);
  setSetting('ai_coach_monthly_limit', 20);
  enviado = [];
  contestar = () => ({ texto: 'Podrías empezar por algo pequeño. ¿Qué te gustaría lograr?' });
  adaptadores.local = async ({ variable }) => {
    const v = JSON.parse(variable);
    enviado.push(v);
    const t = contestar(v);
    return { texto: JSON.stringify(t), uso: { entrada: 10, salida: 10, cacheLectura: 0, cacheEscritura: 0 }, modelo: 'local' };
  };
});
test.afterEach(() => {
  adaptadores.local = original;
  setSetting('coach_v2_enabled', false);
});

let seq = 0;
async function user(name = 'Maribel') {
  const c = new h.Client();
  const email = `coachconv${++seq}@ejemplo.test`;
  await h.registerUser(c, email, { name });
  const u = h.db.one('SELECT * FROM users WHERE email = ?', email);
  entitlements.grantManual({ userId: u.id, code: 'acompanamiento', days: 30, adminId: null, reason: 'prueba de conversación' });
  await c.get('/');
  return { c, u };
}
const post = async (c, json) => JSON.parse((await c.req('POST', '/api/v1/coach/mensajes', { json })).text);
const say = (c, texto) => post(c, { texto });

test('una pregunta abierta se responde directo y recuerda lo hablado', async () => {
  const { c } = await user();
  const a = await say(c, '¿me conviene mudarme de ciudad por trabajo?');
  assert.equal(a.intencion, 'consejo_ia');
  assert.equal(a.origen, 'ia');
  assert.match(a.mensaje.texto, /algo pequeño/);
  assert.equal(enviado[0].conversacion, undefined, 'el primer mensaje no tiene memoria');
  await say(c, '¿y eso cómo lo hago si tengo poco tiempo?');
  const mem = enviado[1].conversacion;
  assert.deepEqual(mem.map((m) => m.de), ['persona', 'coach']);
  assert.match(mem[0].texto, /mudarme de ciudad/);
  assert.match(mem[1].texto, /algo pequeño/);
});

test('la IA recibe cifras, metas y deudas, pero nunca el nombre, el correo, las notas ni el nombre de la deuda', async () => {
  const { c, u } = await user('Maribel Quispe');
  const month = tracker.currentMonth();
  tracker.createMovement(u.id, { kind: 'gasto', category: 'ocio', subcategory: null, date: `${month}-01`, amount: '120.00', currency: 'USD', note: 'regalo secreto', noteNorm: 'regalo secreto', debtId: null, goalId: null, toGoalId: null });
  const d = tracker.validateDebt(u.id, { name: 'Le debo a Pedro', kind: 'familiar', balance: '500', payment: '50', rate_type: 'desconocido' });
  assert.ok(d.ok, JSON.stringify(d.errors));
  tracker.createDebt(u.id, d.value);
  const hechos = conversacion.hechos(u.id);
  assert.equal(hechos.deudas[0].tipo, 'préstamo familiar');
  assert.match(hechos.mayor_categoria, /Ocio/);
  await say(c, 'Maribel soy yo, ¿cómo hago para dormir tranquila con todo esto?');
  await say(c, '¿y tú crees que eso me sirva de verdad?');
  const todo = JSON.stringify(enviado[1]);
  assert.doesNotMatch(todo, /Maribel|Quispe|Pedro|regalo secreto|coachconv/);
});

test('puede repetir una cifra de tu pregunta, pero no inventar otra; si inventa, se reintenta una vez', async () => {
  assert.equal(validar.texto({ texto: 'Un regalo de 50 cabría.' }, { hechos: {}, dicho: ['¿puedo gastar 50 en un regalo?'] }).ok, true);
  assert.equal(validar.texto({ texto: 'Tienes 999 libres.' }, { hechos: {}, dicho: ['¿puedo gastar 50?'] }).motivo, 'cifra_no_autorizada');
  const { c } = await user();
  contestar = (v) => (v.aviso ? { texto: 'Con lo que me cuentas, piénsalo con calma. ¿Es urgente?' } : { texto: 'Tienes USD 98765 ahorrados.' });
  const r = await say(c, '¿será buena idea mudarme con mi hermana este año?');
  assert.equal(r.intencion, 'consejo_ia');
  assert.equal(enviado.length, 2);
  assert.match(enviado[1].aviso, /cifra_no_autorizada/);
  assert.doesNotMatch(r.mensaje.texto, /98765/);
});

test('si la IA falla o se acaba el cupo, igual da un consejo con las cifras', async () => {
  const { c, u } = await user();
  const month = tracker.currentMonth();
  const mov = (kind, category, amount) => tracker.createMovement(u.id, { kind, category, subcategory: null, date: `${month}-01`, amount, currency: 'USD', note: null, noteNorm: null, debtId: null, goalId: null, toGoalId: null });
  mov('ingreso', 'sueldo', '1000.00');
  mov('gasto', 'ocio', '400.00');
  adaptadores.local = async () => {
    throw new Error('503');
  };
  const r = await say(c, 'quiero ahorrar para una moto, ¿cómo hago?');
  assert.equal(r.intencion, 'consejo_calculado');
  assert.match(r.mensaje.texto, /120/, 'el 20 % de lo que queda (600)');
  assert.doesNotMatch(r.mensaje.texto, /IA no respondió|Proveedor/);
  setSetting('ai_coach_monthly_limit', 0);
  const lim = await say(c, 'me siento estresado con todas mis deudas y no sé qué hacer');
  assert.equal(lim.intencion, 'consejo_calculado');
  assert.match(lim.mensaje.texto, /Entiendo que esto te preocupe/);
  assert.match(lim.mensaje.texto, /Ya usaste tus 0 respuestas/);
});

test('se anota conversando: gasto → cuánto → en qué → confirmar', async () => {
  const { c, u } = await user();
  const a = await post(c, { accion: 'iniciar_registro', valor: 'gasto' });
  assert.equal(a.intencion, 'aclarar_importe');
  const b = await say(c, '50');
  assert.equal(b.intencion, 'aclarar_categoria');
  const d = await say(c, 'comida');
  assert.equal(d.intencion, 'registro_vista_previa');
  assert.equal(d.propuesta.propuesta.importe, '50.00');
  assert.equal(d.propuesta.propuesta.categoria, 'alimentacion');
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', u.id), 0, 'nada se guarda sin confirmar');
  await post(c, { accion: 'confirmar', mensaje_id: d.id });
  assert.equal(h.db.value('SELECT COUNT(*) FROM movements WHERE user_id = ?', u.id), 1);
  assert.equal(enviado.length, 0, 'anotar no gasta IA');
});

test('un registro a medias no atrapa la conversación', async () => {
  const { c } = await user();
  await post(c, { accion: 'iniciar_registro', valor: 'gasto' });
  const r = await say(c, '¿cómo puedo ganar más dinero con lo que sé?');
  assert.equal(r.intencion, 'consejo_ia');
  const nuevo = await say(c, 'cobré 800');
  assert.equal(nuevo.propuesta.propuesta.tipo, 'ingreso');
});

test('reconoce la preocupación al anotar y las tarjetas salen con Confirmar, Corregir y Cancelar', async () => {
  const { c } = await user();
  await c.get('/coach');
  const r = await c.req('POST', '/coach/enviar', { form: { texto: 'gasté 120 en comida y me preocupa' }, headers: { 'x-fragment': '1' }, follow: false });
  assert.match(r.text, /Entiendo que te preocupe/);
  assert.match(r.text, /<summary>Corregir<\/summary>/);
  assert.match(r.text, />Confirmar</);
  assert.match(r.text, />Cancelar</);
});

test('ahorro de IA: las preguntas sugeridas se contestan con reglas y la memoria enviada es corta', async () => {
  const { c, u } = await user();
  for (const q of Object.values(conversacion.SUGERIDAS)) assert.equal((await say(c, q)).intencion, 'consejo_calculado');
  assert.equal(enviado.length, 0);
  assert.equal(h.db.value("SELECT COUNT(*) FROM ai_runs WHERE user_id = ?", u.id), 0);
  for (let i = 0; i < 5; i++) await say(c, `¿${i} será buena idea mudarme con mi hermana este verano? ${'bla '.repeat(90)}`);
  const ult = enviado[enviado.length - 1].conversacion;
  assert.ok(ult.length <= 4);
  assert.ok(ult.every((m) => m.texto.length <= 160));
});

test('con la respuesta directa apagada vuelve a ofrecerse el botón', async () => {
  setSetting('coach_v2_ia_directa', false);
  const { c } = await user();
  assert.equal((await say(c, '¿me conviene mudarme de ciudad por trabajo?')).intencion, 'ia_ofrecer');
  assert.equal(enviado.length, 0);
});
