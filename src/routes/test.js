'use strict';
// F02 Test inicial (25 preguntas con variantes) y F03 Resultado gratuito.
// Las pantallas usan el mismo motor que la API JSON (/api/free-tests).
const express = require('express');
const db = require('../db');
const { html } = require('../lib/html');
const money = require('../lib/money');
const { sha256 } = require('../lib/security');
const consent = require('../domain/consent');
const entitlements = require('../domain/entitlements');
const engine = require('../domain/free/engine');
const catalog = require('../domain/free/catalog');
const { FreeError } = require('../domain/free/values');
const { track, content } = require('../lib/services');
const c = require('../views/components');
const ft = require('../views/freeTest');
const { owner, intParam, notFound, wrap } = require('./util');
const { rateLimit } = require('../lib/security');
const game = require('../domain/game');
const config = require('../config');
const ft3 = require('../views/freeTest3');

const router = express.Router();

function needConsent(req, res) {
  if (consent.has(owner(req))) return false;
  const back = req.method === 'GET' && req.originalUrl.startsWith('/test') ? req.originalUrl : '/test';
  res.redirect(303, `/consentimiento?siguiente=${encodeURIComponent(back)}`);
  return true;
}

/** Sesión sobre la que se trabaja: la que está en curso o, si no hay, la última completada. */
function workingSession(req) {
  const o = owner(req);
  return engine.findOwned(o, 'en_curso') || engine.findLatestResultSession(o);
}

function startSession(req) {
  const o = owner(req);
  const { session } = engine.createSession({ userId: o.userId, anonId: o.anonId, currency: (req.user && req.user.base_currency) || null, consent: true, versionId: config.freeCatalogVersion });
  track('test_iniciado', { anonId: req.session.anon_id, userId: req.user && req.user.id, dedupe: `test_iniciado:${session.id}` });
  return session;
}

// Motivo visible de cada pregunta que se salta en la revisión (catálogo V3).
const SKIP_REASON = {
  Q07: 'No aplica: indicaste que hoy no recibes ingresos',
  Q11: 'No aplica: no indicaste pagos de deudas este mes',
  Q12: 'No aplica: no indicaste pagos de deudas este mes',
  Q13: 'No aplica: no indicaste pagos de deudas este mes',
};

const asArray = (v) => (v === undefined || v === null || v === '' ? [] : Array.isArray(v) ? v : typeof v === 'object' ? Object.values(v) : [v]);

/** Convierte lo enviado por el formulario al `value` del contrato de la API. */
function toValue(variant, body, session) {
  const errors = {};
  const form = {};
  let value;
  switch (variant.type) {
    case 'single':
      form.value = body.value;
      value = typeof body.value === 'string' ? body.value : undefined;
      if (value === undefined) errors.value = 'Elige una opción para continuar.';
      break;
    case 'multi':
      form.value = asArray(body.value);
      value = form.value;
      if (!value.length) errors.value = 'Elige al menos una opción.';
      break;
    case 'money_or_choice': {
      form.amount = body.amount;
      form.currency = body.currency;
      form.choice = body.choice;
      const hasAmount = String(body.amount || '').trim() !== '';
      if (body.choice && hasAmount) errors.amount = 'Escribe un importe o elige una opción, no ambos.';
      else if (body.choice) value = { kind: 'CHOICE', code: body.choice };
      else if (hasAmount) {
        const cur = body.currency || session.currency || 'USD';
        const p = money.parseAmount(body.amount, cur);
        if (!p.ok) errors.amount = p.error || 'Escribe un importe válido.';
        else value = { kind: 'AMOUNT', amount: p.value, currency: cur };
      } else errors.amount = 'Escribe un importe o elige una opción.';
      break;
    }
    case 'age_or_choice': {
      form.age = body.age;
      form.choice = body.choice;
      form.confirmed = body.confirmed === '1';
      const hasAge = String(body.age || '').trim() !== '';
      if (body.choice && hasAge) errors.age = 'Escribe una edad o elige una opción, no ambos.';
      else if (body.choice) value = { kind: 'CHOICE', code: body.choice };
      else if (hasAge) {
        if (!/^\d{1,3}$/.test(String(body.age).trim())) errors.age = 'Escribe tu edad con números, sin decimales.';
        else value = { kind: 'AGE', value: Number(String(body.age).trim()), ...(form.confirmed ? { confirmed: true } : {}) };
      } else errors.age = 'Escribe una edad o elige una opción.';
      break;
    }
    default:
      errors.value = 'Tipo de pregunta no disponible.';
  }
  return { value, errors, form };
}

function formFromAnswer(q, a) {
  if (!a) return {};
  if (q.catalog_version === 'FREE_25_V3_ES') return engine.CATALOGS.FREE_25_V3_ES.toForm(engine.CATALOGS.FREE_25_V3_ES.VARIANT_BY_ID[q.variant_id], a);
  if (a.status !== 'answered') {
    if (q.type === 'single' || q.type === 'multi') return { value: q.type === 'multi' ? [a.status === 'unknown' ? 'DK' : 'PNA'] : a.status === 'unknown' ? 'DK' : 'PNA' };
    return { choice: a.status === 'unknown' ? 'DK' : 'PNA' };
  }
  if (q.type === 'single' || q.type === 'multi') return { value: a.value };
  if (a.value.kind === 'CHOICE') return { choice: a.value.code };
  if (a.value.kind === 'AMOUNT') return { amount: a.value.amount, currency: a.value.currency };
  return { age: a.value.value, confirmed: a.value.confirmed === true };
}

function renderQuestion(req, res, session, question, { form, errors = {}, status = 200, note = null, confirmNeeded = false, answer = null }) {
  return res.status(status).page({
    title: `Test gratuito: pregunta ${question.ordinal}`,
    focus: true,
    body: ft.questionPage(res.locals.ctx, { q: question, session, form: form ?? formFromAnswer(question, answer), errors, note, confirmNeeded }),
  });
}

function reviewItems(session) {
  const C = engine.catalogOf(session);
  const answers = engine.activeAnswers(session.id);
  const ctx = engine.buildCtx(answers, session);
  const applicable = new Set(engine.applicableOrder(answers, session));
  return C.SLOTS.map((s) => {
    if (!applicable.has(s.slot_id)) return { ordinal: s.ordinal, text: C.renderVariant(s.variants[0], ctx).text, answered: true, skipped: true, display: SKIP_REASON[s.slot_id] || 'No aplica según tus respuestas anteriores' };
    let text = `Pregunta ${s.ordinal}`;
    try {
      text = engine.publicQuestion(s.slot_id, ctx, session).text;
    } catch {
      /* pregunta aún sin resolver: depende de respuestas pendientes */
    }
    const a = answers[s.slot_id];
    return { ordinal: s.ordinal, text, answered: Boolean(a), display: a ? (C.answerText ? C.answerText(a.variant_id, a) : ft.answerText(a.variant_id, a)) : '' };
  });
}

router.get('/test', (req, res) => {
  if (needConsent(req, res)) return;
  const o = owner(req);
  let s = engine.findOwned(o, 'en_curso');
  if (!s) {
    if (engine.findLatestResultSession(o) && req.query.nuevo !== '1') return res.redirect(303, '/resultado');
    s = startSession(req);
  }
  const next = engine.nextPending(engine.activeAnswers(s.id), s);
  res.redirect(303, next ? `/test/pregunta/${engine.catalogOf(s).SLOT_BY_ID[next].ordinal}` : '/test/revision');
});

router.get('/test/pregunta/:n', (req, res, next) => {
  if (needConsent(req, res)) return;
  const s = workingSession(req);
  if (!s) return res.redirect(303, '/test');
  const n = intParam(req.params.n);
  const C = engine.catalogOf(s);
  const slot = n && C.SLOTS[n - 1];
  if (!slot) return next(notFound());
  const r = engine.questionAt(s, slot.slot_id);
  if (r.skipped && !r.redirect) return res.redirect(303, '/test/revision');
  if (r.redirect) return res.redirect(303, `/test/pregunta/${C.SLOT_BY_ID[r.redirect].ordinal}`);
  const note = typeof req.query.nota === 'string' ? engine.takeAnnotationToShow(s.id, req.query.nota) : null;
  renderQuestion(req, res, s, r.question, { answer: r.answer, note });
});

router.post('/test/pregunta/:n', (req, res, next) => {
  if (needConsent(req, res)) return;
  const limit = rateLimit({ key: `answer:${req.session.id}`, limit: 240, windowMs: 60_000 });
  if (!limit.allowed) {
    const e = new Error('limite');
    e.status = 429;
    return next(e);
  }
  const s = workingSession(req);
  if (!s) return res.redirect(303, '/test');
  const n = intParam(req.params.n);
  const C = engine.catalogOf(s);
  const slot = n && C.SLOTS[n - 1];
  if (!slot) return next(notFound());
  if (String(req.body.action) === 'prev') {
    // Pregunta anterior que aplica (V3 omite Q12/Q13 sin deudas).
    const order = engine.applicableOrder(engine.activeAnswers(s.id), s);
    const prev = order.filter((x) => C.SLOT_BY_ID[x].ordinal < n).pop();
    return res.redirect(303, prev ? `/test/pregunta/${C.SLOT_BY_ID[prev].ordinal}` : '/test');
  }

  const variant = C.VARIANT_BY_ID[req.body.variant_id];
  if (!variant || variant.slot_id !== slot.slot_id) return res.redirect(303, '/test');
  const parsed = C.fromForm ? { ...C.fromForm(variant, req.body), errors: {} } : toValue(variant, req.body, s);
  const q = (() => {
    const r = engine.questionAt(s, slot.slot_id);
    return r.question || null;
  })();
  if (!q) return res.redirect(303, '/test');
  if (Object.keys(parsed.errors).length) return renderQuestion(req, res, s, q, { form: parsed.form, errors: parsed.errors, status: 422 });

  const expected = Number.parseInt(req.body.expected_revision, 10);
  const changeCurrency = Boolean(!C.fromForm && s.currency && parsed.value && parsed.value.kind === 'AMOUNT' && parsed.value.currency !== s.currency);
  const idem = `web:${sha256(`${s.id}|${slot.slot_id}|${req.body.variant_id}|${expected}|${JSON.stringify(parsed.value)}`).slice(0, 32)}`;
  try {
    const out = engine.saveAnswer(s.id, slot.slot_id, {
      variant_id: req.body.variant_id,
      expected_revision: expected,
      resolved_context_hash: req.body.resolved_context_hash,
      value: parsed.value,
      change_currency: changeCurrency,
      idempotency_key: idem,
    });
    const nextQ = out.next_question;
    const note = out.annotation ? `?nota=${encodeURIComponent(out.annotation.event_id)}` : '';
    return res.redirect(303, nextQ ? `/test/pregunta/${nextQ.ordinal}${note}` : '/test/revision');
  } catch (err) {
    if (!(err instanceof FreeError)) return next(err);
    if (err.status === 409) return res.redirect(303, '/test');
    const errors = {};
    let confirmNeeded = false;
    if (err.code === 'CONFIRMATION_REQUIRED') confirmNeeded = true;
    else if (!C.fromForm && ['INVALID_AMOUNT', 'CURRENCY_MISMATCH'].includes(err.code)) errors.amount = err.message;
    else if (['INVALID_AGE', 'AGE_BELOW_RANGE'].includes(err.code)) errors.age = err.message;
    else errors[C.fromForm || variant.type === 'single' || variant.type === 'multi' ? 'value' : 'choice'] = err.message;
    return renderQuestion(req, res, s, q, { form: parsed.form, errors, status: 422, confirmNeeded });
  }
});

router.get('/test/revision', (req, res) => {
  if (needConsent(req, res)) return;
  const s = workingSession(req);
  if (!s) return res.redirect(303, '/test');
  const items = reviewItems(s);
  const problems = engine.completenessProblems(s, engine.activeAnswers(s.id));
  res.page({ title: 'Test gratuito: revisión', body: ft.reviewPage(res.locals.ctx, { items, canFinish: !problems.length, completed: s.completed_revision !== null }) });
});

router.post('/test/finalizar', wrap(async (req, res) => {
  if (needConsent(req, res)) return;
  const s = workingSession(req);
  if (!s) return res.redirect(303, '/test');
  try {
    engine.complete(s.id);
  } catch (err) {
    if (!(err instanceof FreeError) || err.code !== 'INCOMPLETE') throw err;
    return res.status(422).page({ title: 'Test gratuito: revisión', body: ft.reviewPage(res.locals.ctx, { items: reviewItems(s), canFinish: false, errors: [`Faltan ${err.extra.pending.length} respuestas por completar o confirmar.`] }) });
  }
  track('test_finalizado', { anonId: req.session.anon_id, userId: req.user && req.user.id, dedupe: `test_finalizado:${s.id}:${s.revision}` });
  if (req.user && !req.user.base_currency && s.currency) {
    db.run('UPDATE users SET base_currency = ?, updated_at = ? WHERE id = ? AND base_currency IS NULL', s.currency, db.now(), req.user.id);
  }
  res.redirect(303, '/resultado');
}));

router.post('/test/repetir', (req, res) => {
  const o = owner(req);
  if (!engine.findOwned(o, 'en_curso')) startSession(req);
  res.redirect(303, '/test');
});

router.post('/test/reintentar', (req, res) => {
  const s = workingSession(req);
  if (s) {
    try {
      engine.retryDiagnostic(s.id);
    } catch (err) {
      if (!(err instanceof FreeError)) throw err;
    }
  }
  res.redirect(303, '/resultado');
});

router.get('/resultado', (req, res) => {
  const o = owner(req);
  const s = engine.findLatestResultSession(o);
  if (!s) return res.redirect(303, '/test');
  const open = engine.findOwned(o, 'en_curso');
  let diag;
  try {
    diag = engine.getDiagnostic(s.id);
  } catch (err) {
    if (!(err instanceof FreeError)) throw err;
    // Cambiaste respuestas después de finalizar: el resultado anterior se retira.
    return res.page({
      title: 'Tu diagnóstico',
      body: html`<h1 class="section">Tu diagnóstico preliminar</h1>
        <div class="note note--warn"><strong>Cambiaste respuestas.</strong> Retiramos el resultado anterior porque ya no coincide con lo que respondiste. Revisa tus respuestas y vuelve a finalizar para generar uno nuevo.</div>
        <div class="actions"><a class="btn btn-primary" href="/test">Continuar mi test</a><a class="btn btn-quiet" href="/test/revision">Revisar mis respuestas</a></div>`,
    });
  }
  if (diag.status !== 'ready') {
    return res.page({
      title: 'Tu diagnóstico',
      body: html`<h1 class="section">Tu diagnóstico preliminar</h1>
        ${diag.status === 'pending'
          ? html`<div class="dx-wait" role="status" aria-live="polite" data-autorefresh="/resultado"><div class="dx-spinner" aria-hidden="true"></div><p><strong>Estamos preparando tu diagnóstico.</strong></p><p class="muted">Analizamos tus respuestas; tarda unos segundos y la página se actualizará sola.</p><noscript><a class="btn btn-primary" href="/resultado">Ver mi diagnóstico</a></noscript></div>`
          : html`<div class="note note--risk" role="alert">No pudimos generar tu diagnóstico. Tus respuestas siguen guardadas: no necesitas repetir el test.</div><form method="post" action="/test/reintentar">${c.csrfField(res.locals.ctx)}<button class="btn btn-primary" type="submit">Reintentar</button></form>`}`,
    });
  }
  const offer = content('oferta_evaluacion');
  const owned = req.user ? entitlements.active(req.user.id) : {};
  const products = db.all("SELECT * FROM products WHERE active = 1 AND code IN ('evaluacion', 'paquete') ORDER BY sort");
  if (s.version_id === 'FREE_25_V3_ES') {
    return res.page({
      title: 'Tu diagnóstico',
      body: html`${ft3.resultPage(res.locals.ctx, { result: diag.result, answers: engine.activeAnswers(s.id), user: req.user, products, owned, completedAt: s.completed_at })}
        <div class="actions actions--center section">
          ${open
            ? html`<a class="btn btn-quiet" href="/test">Continuar el test que empezaste</a>`
            : html`<form class="inline-form" method="post" action="/test/repetir">${c.csrfField(res.locals.ctx)}<button class="btn btn-quiet" type="submit">Repetir el test</button></form>`}
        </div>`,
    });
  }
  res.page({
    title: 'Tu diagnóstico',
    body: html`${ft.resultPage(res.locals.ctx, { result: diag.result, answers: engine.activeAnswers(s.id), user: req.user, products, offer, owned, reward: true, completedAt: s.completed_at })}
      <div class="actions actions--center section">
        ${open
          ? html`<a class="btn btn-quiet" href="/test">Continuar el test que empezaste</a>`
          : html`<form class="inline-form" method="post" action="/test/repetir">${c.csrfField(res.locals.ctx)}<button class="btn btn-quiet" type="submit">Repetir el test</button></form>`}
      </div>`,
  });
});

module.exports = router;
