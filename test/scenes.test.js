'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const scenes = require('../src/domain/free/scenes');
const catalog4 = require('../src/domain/free/catalog4');

test('escenas: solo existen para el catálogo V4 y apuntan a preguntas reales', () => {
  assert.equal(scenes.after('FREE_25_V3_ES', 5), null);
  assert.equal(scenes.after(scenes.VERSION, 6), null);
  assert.equal(scenes.VERSION, catalog4.VERSION_ID);
  for (const [ord, s] of Object.entries(scenes.SCENES)) {
    assert.ok(catalog4.SLOTS[Number(ord)], `la pregunta ${ord} existe y tiene otra después`);
    assert.ok(s.block >= 2 && s.block <= scenes.BLOCKS.length);
    assert.ok(['idea', 'pausa'].includes(s.kind));
    assert.ok(s.title && s.text);
    assert.doesNotMatch(s.text, /\d+\s?%/, 'sin estadísticas inventadas');
  }
  const a = scenes.after(scenes.VERSION, 9);
  assert.equal(a.kind, 'pausa');
  assert.equal(a.blockName, 'Deudas y respaldo');
});

const h = require('./helpers');
const config = require('../src/config');

test.before(() => h.start());
test.after(() => h.stop());

test('escenas: tras la pregunta 5 y la 9 hay escena; continuar lleva a la pregunta siguiente', async () => {
  const prev = config.freeCatalogVersion;
  config.freeCatalogVersion = scenes.VERSION;
  try {
    const c = new h.Client();
    await h.consent(c);
    await c.get('/test');
    const form = {
      1: { country: 'BO', currency: 'BOB' },
      2: { codes: 'A25_34' },
      3: { codes: 'D1' },
      4: { codes: 'EMPLOYEE' },
      5: { code: 'INCOME', horizon: 'M6' },
      6: { amount: '5100' },
      7: { codes: 'MODERATE' },
      8: { amount: '3500' },
      9: { amount: '500' },
    };
    const sceneAfter = {};
    for (const n of Object.keys(form).map(Number)) {
      if (n === 6) {
        // Una escena que aún no corresponde (se pide antes de tiempo) vuelve al test.
        const early = await c.get('/test/escena/9', { follow: false });
        assert.equal(early.status, 303);
        assert.equal(early.headers.get('location'), '/test');
      }
      const page = await c.get(`/test/pregunta/${n}`);
      const variant = page.text.match(/name="variant_id" value="([^"]+)"/)[1];
      const rev = page.text.match(/name="expected_revision" value="(\d+)"/)[1];
      const ctx = page.text.match(/name="resolved_context_hash" value="([^"]+)"/)[1];
      const res = await c.post(`/test/pregunta/${n}`, { variant_id: variant, expected_revision: rev, resolved_context_hash: ctx, action: 'next', ...form[n] }, { follow: false });
      assert.equal(res.status, 303);
      sceneAfter[n] = res.headers.get('location');
    }
    assert.equal(sceneAfter[4], '/test/pregunta/5');
    assert.match(sceneAfter[5], /^\/test\/escena\/5/);
    assert.match(sceneAfter[9], /^\/test\/escena\/9/);
    const s5 = await c.get('/test/escena/5');
    assert.match(s5.text, /Tu mes/);
    assert.match(s5.text, /href="\/test\/pregunta\/10"/); // sigue la primera pregunta pendiente
    const s9 = await c.get('/test/escena/9');
    assert.match(s9.text, /data-breath/);
    assert.match(s9.text, /href="\/test\/pregunta\/10"/);
    assert.equal((await c.get('/test/escena/3', { follow: false })).status, 404);
  } finally {
    config.freeCatalogVersion = prev;
  }
});
