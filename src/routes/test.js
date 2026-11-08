'use strict';
// F02 Test inicial y F03 Resultado gratuito.
const express = require('express');
const db = require('../db');
const { html } = require('../lib/html');
const money = require('../lib/money');
const qs = require('../domain/questionnaire');
const consent = require('../domain/consent');
const freeResult = require('../domain/freeResult');
const entitlements = require('../domain/entitlements');
const { track, content } = require('../lib/services');
const c = require('../views/components');
const { createFlow } = require('./flow');
const { owner } = require('./util');

const router = express.Router();

function currencyFor(req, ev, map) {
  const a = map.moneda;
  if (a && !a.unknown && a.value) return a.value;
  return (req.user && req.user.base_currency) || ev.base_currency || 'USD';
}

router.use(
  createFlow({
    kind: 'gratuito',
    base: '/test',
    title: 'Test gratuito',
    finishLabel: 'Ver mi resultado',
    doneRedirect: '/resultado',
    before(req, res) {
      if (!consent.has(owner(req))) {
        res.redirect(303, `/consentimiento?siguiente=${encodeURIComponent(req.originalUrl.startsWith('/test') && req.method === 'GET' ? req.originalUrl : '/test')}`);
        return true;
      }
      return false;
    },
    currency: currencyFor,
    onStart(req, ev) {
      track('test_iniciado', { anonId: req.session.anon_id, userId: req.user && req.user.id, dedupe: `test_iniciado:${ev.id}` });
    },
    async finish(req, res, ev, map) {
      freeResult.create(ev, map);
      track('test_finalizado', { anonId: req.session.anon_id, userId: req.user && req.user.id, dedupe: `test_finalizado:${ev.id}` });
      if (req.user && !req.user.base_currency && ev.base_currency) {
        db.run('UPDATE users SET base_currency = ?, updated_at = ? WHERE id = ? AND base_currency IS NULL', ev.base_currency, db.now(), req.user.id);
      }
      res.redirect(303, '/resultado');
    },
  })
);

router.post('/test/repetir', (req, res) => {
  const o = owner(req);
  const open = qs.findEvaluation('gratuito', o, 'en_curso');
  if (!open) {
    const ev = qs.startEvaluation('gratuito', o);
    track('test_iniciado', { anonId: req.session.anon_id, userId: req.user && req.user.id, dedupe: `test_iniciado:${ev.id}` });
  }
  res.redirect(303, '/test');
});

function indicatorList(r) {
  const cur = r.currency;
  const i = r.indicators;
  const row = (label, value, cls = '') => html`<li class="${cls}"><span class="k">${label}${c.src('calculo')}</span><span class="v num">${value}</span></li>`;
  const bal = money.dec(i.balance);
  return html`<ul class="figures">
    ${row('Ingresos al mes', i.income !== null ? c.fmt(i.income, cur) : 'Sin dato')}
    ${row('Gastos al mes', i.expenses !== null ? c.fmt(i.expenses, cur) : 'Sin dato')}
    ${row('Pagos de deuda al mes', i.debtPayments !== null ? c.fmt(i.debtPayments, cur) : 'Sin dato')}
    <li class="total">
      <span class="k">Saldo disponible ${c.src('calculo')}</span>
      <span class="v num ${bal && bal.lt(0) ? 'neg' : ''}">${i.balance !== null ? c.fmt(i.balance, cur) : 'No calculable'}</span>
    </li>
    ${row(
      'Tasa de ahorro',
      i.savingsRate !== null ? money.formatPercent(i.savingsRate, 1) : i.savingsRateReason === 'ingresos_cero' ? 'No aplica sin ingresos' : 'Sin dato'
    )}
    ${row('Meses que cubre tu ahorro', i.reserveMonths !== null ? money.formatNumber(i.reserveMonths, cur, 1) : 'Sin dato')}
  </ul>`;
}

router.get('/resultado', (req, res) => {
  const o = owner(req);
  const ev = qs.latestFinished('gratuito', o);
  if (!ev) return res.redirect(303, '/test');
  const row = db.one('SELECT * FROM free_results WHERE evaluation_id = ?', ev.id);
  const r = JSON.parse(row.result_json);
  const offer = content('oferta_evaluacion');
  const ents = req.user ? entitlements.active(req.user.id) : {};
  const products = db.all("SELECT * FROM products WHERE active = 1 AND code IN ('evaluacion', 'paquete') ORDER BY sort");
  const open = qs.findEvaluation('gratuito', o, 'en_curso');

  res.page({
    title: 'Tu orientación',
    body: html`<div class="label-line"><span class="status-pill">Orientación preliminar</span><span class="small faint">${c.dateEs(ev.completed_at)}</span></div>
      <h1 class="section" style="margin-top:20px">Tu orientación</h1>
      <p class="lead">Una primera lectura de tus ${qs.load(ev.questionnaire_id).questions.length} respuestas. No es un diagnóstico ni un plan: no incluye proyecciones.</p>

      ${r.missing.length
        ? html`<div class="note note--warn"><strong>Hay datos insuficientes.</strong> Algunas cifras no se pudieron calcular; las verás abajo.</div>`
        : ''}

      <section class="section" aria-labelledby="h-cifras">
        <h2 id="h-cifras">Tus cifras de hoy</h2>
        <p class="small muted">Calculadas a partir de tus respuestas y convertidas a un mes.</p>
        ${indicatorList(r)}
      </section>

      <section class="section" aria-labelledby="h-fort">
        <h2 id="h-fort">Fortalezas</h2>
        ${r.strengths.length ? html`<ul class="findings">${r.strengths.map((s) => html`<li>${s}</li>`)}</ul>` : html`<p class="muted">Con tus respuestas aún no identificamos fortalezas claras. Es un punto de partida, no un juicio.</p>`}
      </section>

      <section class="section" aria-labelledby="h-riesgos">
        <h2 id="h-riesgos">Riesgos</h2>
        ${r.risks.length
          ? html`<ul class="findings findings--risk">${r.risks.map((x) => html`<li class="${x.level}"><span class="visually-hidden">Riesgo ${x.level}: </span>${x.text}</li>`)}</ul>`
          : html`<p class="muted">No detectamos riesgos importantes con los datos que diste.</p>`}
      </section>

      <section class="section" aria-labelledby="h-prio">
        <h2 id="h-prio">Prioridades</h2>
        <ol class="priority-list">${r.priorities.map((p) => html`<li>${p.title}</li>`)}</ol>
      </section>

      <section class="section" aria-labelledby="h-acciones">
        <h2 id="h-acciones">Para empezar</h2>
        ${r.actions.map((a) => html`<div class="action-card"><h3>${a.title}</h3><p>${a.detail}</p></div>`)}
      </section>

      ${r.missing.length
        ? html`<section class="section" aria-labelledby="h-faltan">
            <h2 id="h-faltan">Datos insuficientes</h2>
            <ul class="findings findings--missing">${r.missing.map((m) => html`<li>${m}</li>`)}</ul>
          </section>`
        : ''}

      ${!req.user
        ? html`<div class="next-step">
            <p class="kicker">Guarda tu resultado</p>
            <h2>Crea una cuenta para no perderlo</h2>
            <p class="muted">Tus respuestas quedarán ligadas a tu cuenta y podrás consultarlas desde cualquier dispositivo. Sin cuenta, se borran a los 30 días.</p>
            <div class="actions"><a class="btn btn-primary" href="/registro">Crear mi cuenta</a><a class="btn btn-quiet" href="/entrar?siguiente=/resultado">Ya tengo cuenta</a></div>
          </div>`
        : ''}

      <hr class="rule" />
      <section aria-labelledby="h-oferta">
        <h2 id="h-oferta">${offer ? offer.title : 'Evaluación profunda'}</h2>
        <p class="muted">${offer ? offer.body : ''}</p>
        ${ents.evaluacion_profunda
          ? html`<div class="actions"><a class="btn btn-primary" href="/evaluacion">Empezar mi evaluación profunda</a></div>`
          : products.map((p) => c.offerCard(res.locals.ctx, p, { featured: p.code === 'evaluacion', cta: p.code === 'evaluacion' ? 'Comprar la evaluación' : 'Comprar el paquete' }))}
      </section>

      <div class="actions actions--center section">
        ${open
          ? html`<a class="btn btn-quiet" href="/test">Continuar el test que empezaste</a>`
          : html`<form class="inline-form" method="post" action="/test/repetir">${c.csrfField(res.locals.ctx)}<button class="btn btn-quiet" type="submit">Repetir el test</button></form>`}
      </div>`,
  });
});

module.exports = router;
