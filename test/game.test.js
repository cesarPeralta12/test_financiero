'use strict';
// Capa de juego: XP, niveles, rachas y logros se derivan de la actividad,
// no del dinero; el panel del jugador y la página de logros respetan la sesión.
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const game = require('../src/domain/game');

test.before(() => h.start());
test.after(() => h.stop());
test.beforeEach(() => h.resetRateLimits());

test('niveles: umbrales y progreso', () => {
  assert.equal(game.levelFor(0).level, 1);
  assert.equal(game.levelFor(149).level, 1);
  assert.equal(game.levelFor(150).level, 2);
  assert.equal(game.levelFor(150).name, 'Aprendiz');
  const l = game.levelFor(275);
  assert.equal(l.toNext, 125);
  assert.ok(l.progress > 0.49 && l.progress < 0.51);
  const max = game.levelFor(999999);
  assert.equal(max.level, game.LEVELS.length);
  assert.equal(max.next, null);
  assert.equal(max.progress, 1);
});

test('una cuenta nueva empieza en nivel 1 con el logro de registro', async () => {
  const c = new h.Client();
  await h.registerUser(c, 'jugador@ejemplo.test');
  const u = h.db.one("SELECT id FROM users WHERE email = 'jugador@ejemplo.test'");
  const p = game.profile(u.id);
  assert.equal(p.xp, game.XP.cuenta);
  assert.equal(p.level, 1);
  assert.equal(p.unlockedCount, 1);
  assert.ok(p.achievements.find((a) => a.code === 'jugador').unlocked);
  const home = await c.get('/inicio');
  assert.match(home.text, /class="hud"/);
  assert.match(home.text, /data-xp="50"/);
});

test('el XP crece con las acciones del recorrido y desbloquea logros', async () => {
  const c = new h.Client();
  await h.consent(c);
  await h.answerAll(c, '/test', h.FREE_ANSWERS);
  const fin = await c.post('/test/finalizar', {});
  assert.match(fin.text, /Mundo 1 completado/);
  await h.registerUser(c, 'xp@ejemplo.test');
  const u = h.db.one("SELECT id FROM users WHERE email = 'xp@ejemplo.test'");
  const p1 = game.profile(u.id);
  assert.equal(p1.xp, game.XP.test + game.XP.cuenta);
  assert.equal(p1.level, 2);

  await h.payViaWebhook(c, 'paquete');
  await h.answerAll(c, '/evaluacion', h.DEEP_ANSWERS);
  const rev = await c.get('/evaluacion/revision');
  await c.post('/evaluacion/finalizar', { ack: [...rev.text.matchAll(/name="ack" value="([^"]+)"/g)].map((m) => m[1]) });
  await c.post('/plan/generar', { start_date: new Date().toISOString().slice(0, 10) });
  await h.queue.drain({ ignoreSchedule: true });
  const t = h.db.one("SELECT id FROM tasks WHERE user_id = ? AND status = 'pendiente' ORDER BY position LIMIT 1", u.id);
  await c.get('/tablero');
  await c.post(`/tareas/${t.id}/completar`, {});
  const p2 = game.profile(u.id);
  const expected = game.XP.test + game.XP.cuenta + game.XP.evaluacion + game.XP.plan + game.XP.tarea;
  assert.equal(p2.xp, expected);
  for (const code of ['primer_paso', 'radiografia', 'dia_uno', 'primera_mision']) {
    assert.ok(p2.achievements.find((a) => a.code === code).unlocked, `falta el logro ${code}`);
  }
  assert.ok(p2.streak >= 1);
  assert.equal(p2.activeToday, true);

  // Reabrir y completar la misma tarea no suma XP dos veces.
  await c.post(`/tareas/${t.id}/reabrir`, {});
  await c.post(`/tareas/${t.id}/completar`, {});
  assert.equal(game.profile(u.id).xp, expected);
});

test('el XP no depende del dinero: dos cuentas con ingresos distintos y las mismas acciones suman lo mismo', async () => {
  const run = async (email, ingreso) => {
    const c = new h.Client();
    await h.consent(c);
    await h.answerAll(c, '/test', { ...h.FREE_ANSWERS, ingreso_mensual: { amount: ingreso, period: 'mensual' } });
    await c.post('/test/finalizar', {});
    await h.registerUser(c, email);
    return game.profile(h.db.one('SELECT id FROM users WHERE email = ?', email).id).xp;
  };
  assert.equal(await run('poco@ejemplo.test', '8000'), await run('mucho@ejemplo.test', '900000'));
});

test('la página de logros exige sesión y muestra niveles y logros', async () => {
  const anon = new h.Client();
  const r = await anon.get('/logros', { follow: false });
  assert.equal(r.status, 303);
  const c = new h.Client();
  await h.registerUser(c, 'logros@ejemplo.test');
  const page = await c.get('/logros');
  assert.equal(page.status, 200);
  assert.match(page.text, /Logros \(1 de 17\)/);
  assert.match(page.text, /Leyenda Día Uno/);
  assert.match(page.text, /no es una calificación financiera/i);
});

test('la portada muestra el mapa de mundos y el test muestra la etapa y el XP', async () => {
  const c = new h.Client();
  const home = await c.get('/');
  assert.match(home.text, /Tu mapa: cuatro mundos/);
  assert.match(home.text, /Cómo se juega/);
  await h.consent(c);
  const q = await c.get('/test');
  assert.match(q.text, /class="q-stage"/);
  assert.match(q.text, /0 XP/);
});
