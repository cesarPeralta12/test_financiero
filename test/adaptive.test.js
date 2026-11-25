'use strict';
// Evaluación adaptativa (v4): se pregunta solo lo necesario y el plan sale completo con menos datos.
process.env.DEEP_QUESTIONNAIRE_VERSION = '4';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const config = require('../src/config');
const qs = require('../src/domain/questionnaire');
const deep = require('../src/domain/deep');
const planDomain = require('../src/domain/plan');
const rulesRepo = require('../src/domain/rules');
const adaptive = require('../src/domain/adaptive');
const { DEEP_V3 } = require('../src/db/content-deep-v3');
const { DEEP_V4 } = require('../src/db/content-deep-v4');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

const F = (amount) => ({ amount, period: 'mensual' });
const G = (viv, ocio) => ({ vivienda: viv, alimentacion: '900.00', transporte: '200.00', servicios: '200.00', salud: '0.00', educacion: '0.00', ocio, otros: '0.00' });
const FULL = {
  moneda_base: 'BOB', actividad: 'EMPLOYEE', ingreso_principal: F('4000.00'), ingreso_es_neto: 'neto', ingresos_adicionales: F('0.00'), caida_ingreso: '0',
  negocio_situacion: 'DEPENDE', negocio_ventas: '10000.00', negocio_ganancia: '2500.00', negocio_clientes: 'C10_30', negocio_recurrencia: 'ALGUNOS', negocio_equipo: 'SOLO', negocio_problema: 'MARGEN',
  gastos_desglose: G('1000.00', '300.00'), gastos_anuales: '0.00', deudas: [], atraso_actual: 'no', pago_tarjeta: 'minimo', ahorro_mensual: F('200.00'), ahorro_disponible: '2000.00', ahorro_no_disponible: '0.00',
  capital_invertir: '500.00', activos: { inmuebles: '0.00', terrenos: '0.00', vehiculos: '8000.00', inversiones: '0.00', negocio: '0.00', equipos: '0.00', otros: '0.00' }, bienes_vendibles: '0.00',
  dependientes: 0, cobertura_salud: 'no', respaldo_ingreso: 'no', gastos_previstos: ['ninguno'], gasto_reducible: F('100.00'), ajuste_gasto: 'poco', habitos: ['ANOTA'],
  horas_semana: 'H8_14', habilidades: ['SELL'], a_quien_ofrecer: ['FRIENDS'], ingreso_extra_posible: F('300.00'), metas: [], prioridad: 'deuda',
  perfil_riesgo: 'B', reaccion_perdida: 'CALMA', objetivo_ingreso: '7000.00', objetivo_patrimonio: '100000.00', objetivo_plazo: '3', motivacion: 'FAMILIA',
};
const UNK = Symbol('no lo sé');
const TARJETA = [{ name: 'Tarjeta', kind: 'tarjeta', balance: '5000.00', payment: '400.00', rate: null, rate_type: 'desconocido', fees: null }];
const QN = { questions: DEEP_V4.questions.map((q, i) => ({ options: [], config: {}, ...q, position: i + 1, id: i + 1 })) };

/** Responde en orden solo lo que la evaluación pregunta. */
function recorrer(over = {}) {
  const r = { ...FULL, ...over };
  const map = {};
  const hechas = [];
  for (let i = 0; i < 100; i++) {
    const pos = qs.firstUnanswered(QN, map);
    if (pos === null) break;
    const q = QN.questions[pos - 1];
    assert.ok(!hechas.includes(q.code), `repite ${q.code}`);
    hechas.push(q.code);
    map[q.code] = r[q.code] === UNK ? { value: null, unknown: true, skipped: false } : { value: r[q.code], unknown: false, skipped: false };
  }
  assert.ok(qs.status(null, QN, map).complete);
  const rules = rulesRepo.current().rules;
  const diag = deep.diagnose(map, rules);
  const content = planDomain.buildContent(diag, rules, '2026-11-25');
  const todo = JSON.stringify(content.maestro);
  assert.equal(content.maestro.sections.length, 14);
  assert.doesNotMatch(todo, /NaN|undefined|Infinity|\[object|: null,/);
  for (const s of content.maestro.sections) assert.ok(s.blocks.length, s.id);
  deep.checks(map, rules, QN);
  require('../src/domain/contexto').build(0, QN, map, 'BOB');
  return { hechas, map, content, has: (c) => hechas.includes(c) };
}

test('la v4 tiene las mismas preguntas que la v3, sin perder ni repetir ninguna', () => {
  assert.deepEqual(DEEP_V4.questions.map((q) => q.code).sort(), DEEP_V3.questions.map((q) => q.code).sort());
  assert.ok(DEEP_V4.questions.every((q) => q.type && q.prompt));
});

test('personas distintas reciben preguntas distintas y todas terminan con los 14 puntos', () => {
  const casos = {
    empleado: recorrer(),
    apretado: recorrer({ gastos_desglose: G('3000.00', '0.00'), deudas: TARJETA, atraso_actual: 'mas_30', ahorro_mensual: F('0.00'), ahorro_disponible: '0.00', activos: { ...FULL.activos, vehiculos: '0.00' } }),
    negocio: recorrer({ actividad: 'BUSINESS', deudas: TARJETA }),
    empieza: recorrer({ actividad: 'INDEPENDENT', negocio_situacion: 'EMPEZANDO', negocio_ventas: '0.00', negocio_clientes: 'C0' }),
    sinTrabajo: recorrer({ actividad: 'NONE', ingreso_principal: F('0.00'), horas_semana: 'H0', habilidades: ['UNSURE'] }),
    noSabe: recorrer({ caida_ingreso: UNK, gastos_desglose: UNK, gastos_anuales: UNK, ahorro_no_disponible: UNK, activos: UNK, capital_invertir: UNK, gasto_reducible: UNK, objetivo_ingreso: UNK, objetivo_patrimonio: UNK }),
    familia: recorrer({ dependientes: 2, metas: [{ kind: 'viaje', name: 'Viaje', target: '3000.00', saved: '0.00', months: 12 }] }),
  };
  for (const [k, x] of Object.entries(casos)) assert.ok(x.hechas.length >= 20 && x.hechas.length < 43, `${k}: ${x.hechas.length}`);
  console.log('   preguntas por persona:', Object.entries(casos).map(([k, x]) => `${k} ${x.hechas.length}`).join(', '));
  const { empleado: e, apretado: a, negocio: n, empieza: z, sinTrabajo: s, noSabe: u, familia: f } = casos;
  for (const c of ['negocio_situacion', 'negocio_ventas', 'atraso_actual', 'pago_tarjeta', 'respaldo_ingreso', 'bienes_vendibles', 'ingreso_extra_posible', 'prioridad']) assert.ok(!e.has(c), `empleado: ${c}`);
  for (const c of ['capital_invertir', 'perfil_riesgo', 'reaccion_perdida', 'objetivo_patrimonio', 'ahorro_no_disponible', 'bienes_vendibles', 'ajuste_gasto']) assert.ok(!a.has(c), `apretado: ${c}`);
  for (const c of ['atraso_actual', 'ingreso_extra_posible', 'motivacion']) assert.ok(a.has(c), `apretado: ${c}`);
  assert.ok(n.has('negocio_problema') && !n.has('a_quien_ofrecer') && !n.has('ingreso_es_neto'));
  assert.ok(!z.has('negocio_ganancia') && !z.has('negocio_recurrencia') && !z.has('negocio_equipo') && z.has('negocio_problema'));
  assert.ok(!s.has('caida_ingreso') && !s.has('a_quien_ofrecer'));
  assert.ok(!u.has('objetivo_plazo'), 'sin meta no hay plazo que pedir');
  assert.ok(u.has('gasto_reducible') && u.has('reaccion_perdida') === false, 'ante la duda se pregunta');
  assert.ok(f.has('respaldo_ingreso') && f.has('prioridad'));
});

test('comentarios y montos sugeridos usan las cifras de la persona', () => {
  const { map } = recorrer();
  const hasta = (code) => Object.fromEntries(Object.entries(map).slice(0, Object.keys(map).indexOf(code)));
  assert.match(adaptive.pause('ahorro_mensual', hasta('ahorro_mensual'), 'BOB').text, /te quedan Bs.1\.400,00/);
  for (const c of ['gastos_desglose', 'dependientes', 'horas_semana', 'metas']) assert.match(adaptive.pause(c, hasta(c), 'BOB').help, /Consejo: /, c);
  assert.equal(adaptive.pause('ahorro_disponible', hasta('ahorro_disponible'), 'BOB'), null, 'solo al entrar al tema');
  assert.equal(adaptive.pause('moneda_base', {}, 'BOB'), null);
  assert.equal(adaptive.pause('gastos_desglose', { moneda_base: { value: 'BOB', known: true } }, 'BOB'), null, 'sin conversación previa no hay respiro');
  assert.deepEqual(adaptive.suggestions('objetivo_ingreso', map), ['5000', '6000', '8000']);
  assert.equal(adaptive.suggestions('objetivo_patrimonio', map).length, 3);
  assert.deepEqual(adaptive.suggestions('moneda_base', map), []);
  assert.deepEqual(adaptive.suggestions('objetivo_ingreso', {}), []);
});

test('chat v4 de punta a punta, sin conteos en la revisión', async () => {
  const c = new h.Client();
  await h.consent(c);
  await h.registerUser(c, 'adaptativo@ejemplo.test');
  await h.payViaWebhook(c, 'paquete');
  const DI = [
    [/^✅/, 'Seguir'],
    [/moneda/i, 'bolivianos'], [/Cómo trabajas/i, 'soy empleado'], [/fuente principal/i, '4000'], [/en la mano/i, 'sí'], [/otros ingresos/i, 'no'], [/mes malo/i, 'no baja'], [/en qué gastas/i, 'comida y alquiler'], [/gastas al mes en/i, '900'], [/veces al año/i, 'no'], [/¿Tienes deudas/i, 'no'],
    [/Apartas/i, 'no'], [/disponible de inmediato/i, '0'], [/bienes tienes/i, 'ninguno'], [/dependen económicamente/i, 'ninguna'], [/seguro o servicio/i, 'no'], [/gasto importante/i, 'ninguno'], [/te identificas/i, 'anoto mis gastos'],
    [/tiempo a la semana/i, 'de 8 a 14 horas'], [/se te da mejor/i, 'vender'], [/ofrecerle/i, 'amigos'], [/metas quieres/i, 'aún no tengo'], [/hacerlo crecer/i, 'acepto altibajos moderados'], [/ganar al mes/i, '7000'], [/reunido/i, 'no lo sé'], [/llegar ahí/i, '3 años'], [/Qué cambiaría/i, 'mi familia'],
  ];
  config.deepChat = true;
  let pasos = 0;
  try {
    let page = await c.get('/evaluacion');
    if (/conocido/.test(page.url)) await c.post('/evaluacion/conocido', { action: 'ninguno' });
    page = await c.get('/evaluacion?empezar=1');
    let t = page.text.match(/chat-msg--bot chat-q">([^<]+)</)[1];
    let r;
    let comentario = false;
    let respiros = 0;
    assert.match(page.text, /chat-pause" href="\/inicio"/);
    for (let i = 0; i < 60; i++) {
      const d = DI.find(([re]) => re.test(t));
      assert.ok(d, `sin respuesta para «${t}»`);
      h.resetRateLimits();
      r = JSON.parse((await c.req('POST', '/evaluacion/chat', { form: { texto: d[1] }, headers: { accept: 'application/json' } })).text);
      assert.ok(!r.error, `«${t}»: ${r.error}`);
      pasos++;
      if (r.done) break;
      if (pasos === 4) {
        // Pausa: Inicio ofrece continuar y se retoma en la misma pregunta.
        assert.match((await c.get('/inicio')).text, /Continuar mi evaluación/);
        assert.ok((await c.get('/evaluacion')).text.includes(r.next.text));
      }
      if (/Ya conozco tu mes/.test(r.next.text)) comentario = true;
      if (/^✅/.test(r.next.text)) respiros++;
      if (/ganar al mes/.test(r.next.text)) assert.ok(r.next.chips.includes('8000'));
      t = r.next.text;
    }
    assert.ok(r.done, t);
    assert.ok(comentario);
    assert.equal(respiros, 5);
    assert.match((await c.get('/evaluacion')).text, /¡Terminaste!/);
    assert.ok(pasos < 35, `pasos: ${pasos}`);
  } finally {
    config.deepChat = false;
  }
  const rev = await c.get('/evaluacion/revision');
  assert.doesNotMatch(rev.text, /respondidas|No aplica|tienes un negocio/i);
  assert.match(rev.text, /Mi contexto financiero actual/);
  const fin = await c.post('/evaluacion/finalizar', { ack: [...rev.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]) });
  assert.match(fin.url, /diagnostico/);
  await c.post('/plan/generar', { start_date: '2026-11-25' });
  await h.queue.drain({ ignoreSchedule: true });
  assert.match((await c.get('/plan')).text, /id="pm14"/);
});
