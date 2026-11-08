'use strict';
const express = require('express');
const db = require('../db');
const { html, raw, prose } = require('../lib/html');
const money = require('../lib/money');
const { content, track } = require('../lib/services');
const consent = require('../domain/consent');
const qs = require('../domain/questionnaire');
const c = require('../views/components');
const { owner } = require('./util');

const router = express.Router();

// Titular dividido en palabras para la animación de entrada (sin JavaScript).
function words(text) {
  return String(text)
    .split(/\s+/)
    .map((w, i) => html`<span class="word"><span style="--i:${i}">${w}</span></span>`)
    .reduce((acc, w, i) => (i ? html`${acc} ${w}` : w), '');
}

router.get('/favicon.svg', (req, res) => {
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400')
    .send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#265b4d"/><g fill="#ffffff"><rect x="7" y="7" width="5" height="5" rx="1"/></g><g fill="#ffffff" opacity=".35"><rect x="13.5" y="7" width="5" height="5" rx="1"/><rect x="20" y="7" width="5" height="5" rx="1"/><rect x="7" y="13.5" width="5" height="5" rx="1"/><rect x="13.5" y="13.5" width="5" height="5" rx="1"/><rect x="20" y="13.5" width="5" height="5" rx="1"/><rect x="7" y="20" width="5" height="5" rx="1"/><rect x="13.5" y="20" width="5" height="5" rx="1"/><rect x="20" y="20" width="5" height="5" rx="1"/></g></svg>`);
});

router.get('/', (req, res) => {
  if (req.session && req.session.anon_id) track('visita', { anonId: req.session.anon_id, dedupe: `visita:${req.session.anon_id}` });
  const hero = content('portada');
  const products = Object.fromEntries(db.all('SELECT * FROM products WHERE active = 1').map((p) => [p.code, p]));
  const price = (code) => (products[code] ? `${money.formatCents(products[code].price_cents, products[code].currency)} ${products[code].currency}` : 'De pago');
  const o = owner(req);
  const inProgress = qs.findEvaluation('gratuito', o, 'en_curso');
  const finished = qs.latestFinished('gratuito', o);
  const states = Array.from({ length: 25 }, (_, i) => (i === 0 ? 'now' : ''));

  res.page({
    title: null,
    body: html`<section class="hero" aria-labelledby="hero-title">
        <h1 id="hero-title">${words(hero ? hero.title : 'Ordena tu dinero empezando por saber dónde estás.')}</h1>
        <p class="lead">${hero ? hero.body : ''}</p>
        <div class="actions actions--center">
          ${inProgress
            ? html`<a class="btn btn-primary" href="/test">Continuar el test</a>`
            : finished
              ? html`<a class="btn btn-primary" href="/resultado">Ver mi resultado</a>`
              : html`<a class="btn btn-primary btn-shine" href="/test">Comenzar el test gratuito</a>`}
          ${req.user ? html`<a class="btn btn-secondary" href="/inicio">Ir a mi cuenta</a>` : html`<a class="btn btn-secondary" href="/entrar">Ya tengo cuenta</a>`}
        </div>
        <div class="hero-ticks">
          ${c.ticks(states)}
          <div class="progress-meta"><span>25 preguntas, una por pantalla. Sin tarjeta y sin crear cuenta.</span></div>
        </div>
      </section>

      <section class="section" aria-labelledby="recorrido">
        <h2 id="recorrido" class="visually-hidden">Recorrido</h2>
        <ol class="journey">
          <li><span class="step">Paso 1</span><h3>Test gratuito</h3><p>Fortalezas, riesgos y por dónde empezar.</p><span class="price-tag">Gratis</span></li>
          <li><span class="step">Paso 2</span><h3>Evaluación profunda</h3><p>Diagnóstico con tus cifras exactas.</p><span class="price-tag">${price('evaluacion')}</span></li>
          <li><span class="step">Paso 3</span><h3>Plan Maestro</h3><p>90 días de acciones y una hoja de ruta de 12 meses.</p><span class="price-tag">${price('plan_maestro')}</span></li>
          <li><span class="step">Paso 4</span><h3>Coach y calculadora</h3><p>Simula, registra y avanza con apoyo.</p><span class="price-tag">${price('acompanamiento')}</span></li>
        </ol>
      </section>

      <section class="section day-demo" aria-labelledby="h-dia" data-day-demo>
        <p class="day-number" aria-hidden="true"><span class="day-label">Día</span> <span class="day-value" data-day-value>1</span><span>de 90</span></p>
        ${c.ticks(Array.from({ length: 90 }, (_, i) => (i === 0 ? 'now' : '')), { days: true })}
        <h2 id="h-dia">Cada día cuenta</h2>
        <p class="muted">Con el Plan Maestro, tu Día Uno es la fecha que eliges para empezar. Desde ahí, 90 días de acciones con fecha, motivo e indicador, y una hoja de ruta de 12 meses para no perder el rumbo.</p>
      </section>

      <section class="section split" aria-label="Qué es gratis y qué es de pago">
        <div>
          <h3>Gratis</h3>
          <ul class="ticklist">
            <li>Las 25 preguntas del test inicial</li>
            <li>Tu orientación: fortalezas, riesgos y prioridades</li>
            <li>Una o dos acciones para empezar hoy</li>
            <li>Consultar tu resultado cuando quieras, sin pagar</li>
          </ul>
        </div>
        <div>
          <h3>De pago</h3>
          <ul class="ticklist ticklist--muted">
            <li>Evaluación profunda y diagnóstico detallado</li>
            <li>Plan Maestro con presupuesto, estrategia de deuda y escenarios</li>
            <li>Coach de IA, calculadora, simulador y tablero de progreso</li>
            <li>Paquete completo con las tres partes</li>
          </ul>
        </div>
      </section>

      <hr class="rule" />
      <p class="small muted center">
        Antes de guardar cualquier dato financiero te pediremos tu consentimiento. Tus respuestas no se usan para publicidad.
        <a href="/privacidad">Cómo tratamos tus datos</a>.
      </p>`,
  });
});

function legal(key) {
  return (req, res) => {
    const doc = content(key);
    if (!doc) return res.status(404).page({ title: 'No disponible', body: html`<h1>Documento no disponible</h1>` });
    res.page({
      title: doc.title,
      body: html`<article class="prose">
        <h1>${doc.title}</h1>
        <p class="small faint">Versión ${doc.version}, publicada el ${c.dateEs(doc.published_at)}.</p>
        ${prose(doc.body)}
      </article>`,
    });
  };
}
router.get('/privacidad', legal('privacidad'));
router.get('/condiciones', legal('condiciones'));

function consentPage(res, { error = null } = {}) {
  const doc = consent.current();
  return res.page({
    title: 'Consentimiento',
    body: html`<h1>${doc.title}</h1>
      <div class="prose">${prose(doc.body)}</div>
      <form method="post" action="${res.req.originalUrl}" novalidate>
        ${c.csrfField(res.locals.ctx)}
        ${error ? html`<div class="error-summary" role="alert"><h2>Falta tu confirmación</h2><ul><li><a href="#f-acepto">${error}</a></li></ul></div>` : ''}
        <div class="field">
          <label class="check" for="f-acepto">
            <input type="checkbox" id="f-acepto" name="acepto" value="1" ${error ? raw('aria-invalid="true"') : ''} />
            <span>Acepto que Día Uno guarde mis respuestas para calcular mi orientación, según la <a href="/privacidad">política de privacidad</a> y las <a href="/condiciones">condiciones de uso</a>.</span>
          </label>
        </div>
        <div class="actions">
          <button class="btn btn-primary" type="submit">Aceptar y empezar</button>
          <a class="btn btn-quiet" href="/">Volver</a>
        </div>
      </form>
      <p class="small faint">Versión ${doc.version} del texto de consentimiento.</p>`,
  });
}

router.get('/consentimiento', (req, res) => consentPage(res));

router.post('/consentimiento', (req, res) => {
  if (req.body.acepto !== '1') return consentPage(res.status(422), { error: 'Marca la casilla para continuar. Sin tu consentimiento no podemos guardar tus respuestas.' });
  const o = owner(req);
  if (!consent.has(o)) consent.record(o);
  const next = typeof req.query.siguiente === 'string' && req.query.siguiente.startsWith('/') && !req.query.siguiente.startsWith('//') ? req.query.siguiente : '/test';
  res.redirect(303, next);
});

module.exports = router;
