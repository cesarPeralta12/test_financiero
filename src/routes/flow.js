'use strict';
// Flujo de cuestionario compartido: una pregunta por pantalla, progreso, anterior,
// validación, «No lo sé» donde está previsto, revisión y correcciones antes de finalizar.
const express = require('express');
const db = require('../db');
const { html, raw } = require('../lib/html');
const qs = require('../domain/questionnaire');
const { questionPage } = require('../views/question');
const c = require('../views/components');
const { owner, intParam, notFound, wrap } = require('./util');
const { rateLimit } = require('../lib/security');

/**
 * opts: {
 *   kind, base, title, guards: [], before(req,res) → bool (true = respondió),
 *   currency(req, evaluation, map), previous(req, q, evaluation) → {value, text}|null,
 *   reviewExtra(req, ctx) → {html, blocking}, finish(req, res, evaluation, map),
 *   onStart(req, evaluation), allowRestart
 * }
 */
function createFlow(opts) {
  const router = express.Router();
  const guards = opts.guards || [];

  function load(req) {
    const o = owner(req);
    let ev = qs.findEvaluation(opts.kind, o, 'en_curso');
    return { o, ev };
  }

  function stateList(qn, map, current) {
    const st = qs.status(null, qn, map);
    const tickStates = st.items.map((it) => (it.q.position === current ? 'now' : !it.applicable ? 'na' : it.answered ? 'done' : ''));
    return { ticks: tickStates, total: qn.questions.length, answered: st.items.filter((i) => i.answered).length, status: st };
  }

  function renderQuestion(req, res, ev, qn, q, { form, errors = {}, prefilledNotice = false, status = 200 }) {
    const map = qs.answers(ev.id);
    const currency = opts.currency(req, ev, map);
    const prev = opts.previous ? opts.previous(req, q, ev, currency) : null;
    const st = stateList(qn, map, q.position);
    const lastApplicable = qs.nextApplicable(qn, map, q.position, 1) === null;
    return res.status(status).page({
      title: `${opts.title}: pregunta ${q.position}`,
      body: questionPage(res.locals.ctx, {
        base: opts.base,
        q,
        qn,
        map,
        form: form ?? qs.toForm(q, map[q.code]),
        errors,
        currency,
        previous: prev,
        prefilledNotice,
        stateList: st,
        isLast: lastApplicable,
        actionSuffix: req.query.volver === 'revision' ? '?volver=revision' : '',
      }),
    });
  }

  router.get(opts.base, ...guards, wrap(async (req, res) => {
    if (opts.before && opts.before(req, res)) return;
    let { o, ev } = load(req);
    if (!ev) {
      const done = qs.latestFinished(opts.kind, o);
      if (done && opts.doneRedirect && req.query.nuevo !== '1') return res.redirect(303, opts.doneRedirect);
      ev = qs.startEvaluation(opts.kind, o);
      if (opts.onStart) opts.onStart(req, ev);
    }
    const qn = qs.load(ev.questionnaire_id);
    const map = qs.answers(ev.id);
    const pos = qs.firstUnanswered(qn, map);
    if (pos === null) return res.redirect(303, `${opts.base}/revision`);
    res.redirect(303, `${opts.base}/pregunta/${pos}`);
  }));

  router.get(`${opts.base}/pregunta/:n`, ...guards, (req, res, next) => {
    if (opts.before && opts.before(req, res)) return;
    const { ev } = load(req);
    if (!ev) return res.redirect(303, opts.base);
    const qn = qs.load(ev.questionnaire_id);
    const n = intParam(req.params.n);
    const q = n && qn.questions[n - 1];
    if (!q) return next(notFound());
    const map = qs.answers(ev.id);
    if (!qs.isApplicable(q, map)) {
      const fwd = qs.nextApplicable(qn, map, n, 1);
      return res.redirect(303, fwd ? `${opts.base}/pregunta/${fwd}` : `${opts.base}/revision`);
    }
    qs.setPosition(ev, n);
    renderQuestion(req, res, ev, qn, q, {});
  });

  router.post(`${opts.base}/pregunta/:n`, ...guards, (req, res, next) => {
    if (opts.before && opts.before(req, res)) return;
    const limit = rateLimit({ key: `answer:${req.session.id}`, limit: 240, windowMs: 60_000 });
    if (!limit.allowed) {
      const e = new Error('limite');
      e.status = 429;
      return next(e);
    }
    const { ev } = load(req);
    if (!ev) return res.redirect(303, opts.base);
    const qn = qs.load(ev.questionnaire_id);
    const n = intParam(req.params.n);
    const q = n && qn.questions[n - 1];
    if (!q) return next(notFound());
    const action = String(req.body.action || 'next');
    const map = qs.answers(ev.id);
    const currency = opts.currency(req, ev, map);

    // Filas dinámicas de deudas y metas, sin validar todavía.
    if (action === 'add' || action.startsWith('remove:')) {
      const parsed = qs.parseSubmission(q, req.body, currency);
      const form = parsed.form;
      form.rows = form.rows || [];
      if (action === 'add') form.rows.push({});
      else form.rows.splice(Number(action.split(':')[1]), 1);
      form.none = false;
      return renderQuestion(req, res, ev, qn, q, { form });
    }

    if (action === 'use_previous') {
      const prev = opts.previous && opts.previous(req, q, ev, currency);
      if (!prev) return renderQuestion(req, res, ev, qn, q, {});
      return renderQuestion(req, res, ev, qn, q, { form: qs.toForm(q, { value: prev.value, unknown: false }), prefilledNotice: true });
    }

    const parsed = qs.parseSubmission(q, req.body, currency);
    if (action === 'prev') {
      if (parsed.ok) qs.saveAnswer(ev, q, parsed);
      const after = qs.answers(ev.id);
      const back = qs.nextApplicable(qn, after, n, -1);
      return res.redirect(303, back ? `${opts.base}/pregunta/${back}` : opts.prevHref || opts.base);
    }
    if (!parsed.ok) return renderQuestion(req, res, ev, qn, q, { form: parsed.form, errors: parsed.errors, status: 422 });
    const prev = opts.previous && opts.previous(req, q, ev, currency);
    const fromPrevious = Boolean(prev && JSON.stringify(prev.value) === JSON.stringify(parsed.value));
    qs.saveAnswer(ev, q, parsed, { fromPrevious });
    const after = qs.answers(ev.id);
    const fwd = qs.nextApplicable(qn, after, n, 1);
    if (req.query.volver === 'revision') return res.redirect(303, `${opts.base}/revision`);
    res.redirect(303, fwd ? `${opts.base}/pregunta/${fwd}` : `${opts.base}/revision`);
  });

  function reviewPage(req, res, { errors = null, status = 200 } = {}) {
    const { ev } = load(req);
    if (!ev) return res.redirect(303, opts.base);
    const qn = qs.load(ev.questionnaire_id);
    const map = qs.answers(ev.id);
    const currency = opts.currency(req, ev, map);
    const st = qs.status(ev, qn, map);
    const extra = opts.reviewExtra ? opts.reviewExtra(req, ev, qn, map, currency, res.locals.ctx) : { html: '', blocking: false };
    const canFinish = st.complete && !extra.blocking;
    const ticksList = st.items.map((it) => (!it.applicable ? 'na' : it.answered ? 'done' : ''));
    return res.status(status).page({
      title: `${opts.title}: revisión`,
      body: html`<div class="q-head">
          ${c.ticks(ticksList)}
          <div class="progress-meta"><span>Revisión</span><span>${st.items.filter((i) => i.answered).length} de ${st.total} respondidas</span></div>
        </div>
        <h1>Revisa tus respuestas</h1>
        <p class="muted">Puedes cambiar cualquier respuesta antes de ${opts.finishVerb || 'ver tu resultado'}. Después quedarán fijas en ${opts.kind === 'gratuito' ? 'tu resultado' : 'tu diagnóstico'}.</p>
        ${errors ? html`<div class="error-summary" role="alert"><h2>Aún no puedes continuar</h2><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : ''}
        ${st.missing.length
          ? html`<div class="note note--risk" role="status"><strong>Faltan ${st.missing.length} ${st.missing.length === 1 ? 'respuesta obligatoria' : 'respuestas obligatorias'}.</strong> Están marcadas abajo.</div>`
          : ''}
        ${extra.html}
        <ol class="review">
          ${st.items.map((it) => {
            const missing = it.applicable && it.q.required && !it.answered;
            return html`<li>
              <span class="n">${it.q.position}</span>
              <span class="q">${it.q.prompt}</span>
              <span class="a ${missing ? 'missing' : ''}">${!it.applicable ? 'No aplica' : missing ? 'Falta responder' : qs.display(it.q, it.answer, currency)}</span>
              ${it.applicable ? html`<a class="edit" href="${opts.base}/pregunta/${it.q.position}?volver=revision" aria-label="Cambiar la respuesta ${it.q.position}">Cambiar</a>` : html`<span></span>`}
            </li>`;
          })}
        </ol>
        <form method="post" action="${opts.base}/finalizar">
          ${c.csrfField(res.locals.ctx)}
          ${extra.ackFields || ''}
          <div class="actions">
            <button class="btn btn-primary" type="submit" ${canFinish ? '' : raw('aria-disabled="true"')}>${opts.finishLabel}</button>
            <a class="btn btn-quiet" href="${opts.base}/pregunta/${qn.questions.length}">Volver a las preguntas</a>
          </div>
        </form>`,
    });
  }

  router.get(`${opts.base}/revision`, ...guards, (req, res) => {
    if (opts.before && opts.before(req, res)) return;
    reviewPage(req, res);
  });

  // La pregunta en la URL de edición vuelve a la revisión al guardar.
  router.post(`${opts.base}/finalizar`, ...guards, wrap(async (req, res) => {
    if (opts.before && opts.before(req, res)) return;
    const { ev } = load(req);
    if (!ev) return res.redirect(303, opts.base);
    const qn = qs.load(ev.questionnaire_id);
    const map = qs.answers(ev.id);
    const st = qs.status(ev, qn, map);
    const errors = [];
    if (!st.complete) errors.push(`Faltan ${st.missing.length} respuestas obligatorias.`);
    const currency = opts.currency(req, ev, map);
    if (opts.validateFinish) errors.push(...opts.validateFinish(req, ev, qn, map, currency));
    if (errors.length) return reviewPage(req, res, { errors, status: 422 });
    db.tx(() => {
      // Las respuestas de preguntas que dejaron de aplicar no cuentan.
      for (const it of st.items) {
        if (!it.applicable && it.answer) db.run('UPDATE answers SET is_skipped = 1 WHERE evaluation_id = ? AND question_id = ?', ev.id, it.q.id);
      }
      db.run("UPDATE evaluations SET status = 'finalizada', completed_at = ?, updated_at = ?, base_currency = ? WHERE id = ? AND status = 'en_curso'", db.now(), db.now(), currency, ev.id);
    });
    const finished = db.one('SELECT * FROM evaluations WHERE id = ?', ev.id);
    await opts.finish(req, res, finished, qs.answers(ev.id));
  }));

  return router;
}

module.exports = { createFlow };
