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
const deepChat = require('../domain/deepChat');
const chatView = require('../views/chatTest');

// Estado de la conversación por sesión (pregunta a medias, aviso pendiente, «Iniciar» tocado).
// Vive en memoria: si el servidor se reinicia, solo se repite la pregunta en curso.
const chatMem = new Map();
function chatState(req) {
  const key = req.session ? req.session.id : null;
  if (!key) return {};
  let st = chatMem.get(key);
  if (!st) {
    st = {};
    chatMem.set(key, st);
    if (chatMem.size > 5000) chatMem.delete(chatMem.keys().next().value);
  }
  return st;
}

/**
 * opts: {
 *   kind, base, title, guards: [], before(req,res) → bool (true = respondió),
 *   currency(req, evaluation, map), previous(req, q, evaluation) → {value, text}|null,
 *   reviewExtra(req, ctx) → {html, blocking}, finish(req, res, evaluation, map),
 *   onStart(req, evaluation), allowRestart,
 *   beforeQuestions(req, res, evaluation, qn, map) → bool (true = respondió: p. ej. la pantalla «lo que ya sabemos»)
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

  /** Siguiente pregunta que de verdad hay que hacer: las confirmadas desde «lo que ya sabemos» se saltan (se pueden cambiar desde la revisión). */
  function nextToAsk(qn, map, from) {
    let pos = qs.nextApplicable(qn, map, from, 1);
    while (pos !== null) {
      const q = qn.questions[pos - 1];
      const a = map[q.code];
      if (!(a && a.known && qs.isAnswered(q, a))) return pos;
      pos = qs.nextApplicable(qn, map, pos, 1);
    }
    return null;
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
      focus: true,
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
    if (opts.beforeQuestions && opts.beforeQuestions(req, res, ev, qn, map)) return;
    if (opts.chat && opts.chat()) {
      if (req.query.empezar === '1') chatState(req).started = ev.id;
      return renderChat(req, res, ev, qn);
    }
    const pos = qs.firstUnanswered(qn, map);
    if (pos === null) return res.redirect(303, `${opts.base}/revision`);
    res.redirect(303, `${opts.base}/pregunta/${pos}`);
  }));

  // ───────── Conversación (opts.chat): una pregunta a la vez, dividida en mensajes cortos ─────────
  /** Pregunta y paso actuales. Lo respondido a medias de una pregunta vive en la sesión. */
  /**
   * Respuestas que ya se deducen de otra: sin deudas, no hay pagos atrasados ni tarjetas.
   * (La versión con botones ya oculta esas preguntas; esto cubre cuestionarios anteriores.)
   */
  function autoAnswer(q, map) {
    const debts = map.deudas && !map.deudas.unknown ? map.deudas.value : null;
    if (!Array.isArray(debts)) return null;
    const has = (v) => q.options.some((o) => o.value === v);
    if (q.code === 'atraso_actual' && !debts.length && has('no')) return 'no';
    if (q.code === 'pago_tarjeta' && !debts.some((d) => d.kind === 'tarjeta') && has('sin_tarjeta')) return 'sin_tarjeta';
    return null;
  }

  function chatCurrent(req, ev, qn) {
    let map = qs.answers(ev.id);
    let pos = qs.firstUnanswered(qn, map);
    for (let guard = 0; pos !== null && guard < 5; guard++) {
      const q0 = qn.questions[pos - 1];
      const auto = autoAnswer(q0, map);
      if (auto === null) break;
      qs.saveAnswer(ev, q0, qs.parseSubmission(q0, { value: auto }, opts.currency(req, ev, map)));
      map = qs.answers(ev.id);
      pos = qs.firstUnanswered(qn, map);
    }
    if (pos === null) return { done: true, map };
    const q = qn.questions[pos - 1];
    const currency = opts.currency(req, ev, map);
    const saved = chatState(req).partial;
    const body = saved && saved.ev === ev.id && saved.code === q.code ? saved.body : {};
    const step = deepChat.nextStep(q, body, currency);
    const st = qs.status(null, qn, map);
    const applicable = st.items.filter((i) => i.applicable);
    return { q, body, step, currency, map, progress: { pos: applicable.filter((i) => i.answered).length + 1, total: applicable.length } };
  }
  const stepView = (step) => (step ? { text: step.text, help: step.help, chips: step.chips, placeholder: step.kind === 'amount' ? 'Escribe el monto, por ejemplo «2500»' : 'Escribe tu respuesta con tus palabras' } : null);

  function renderChat(req, res, ev, qn) {
    const cur = chatCurrent(req, ev, qn);
    const mem = chatState(req);
    const error = mem.error || null;
    delete mem.error;
    const started = mem.started === ev.id || Object.values(cur.map).some((a) => !a.known);
    return res.page({
      title: opts.title,
      focus: true,
      body: chatView.chatPage(res.locals.ctx, {
        base: opts.base,
        title: opts.title,
        name: req.user ? req.user.name : null,
        welcome: opts.chatWelcome ? opts.chatWelcome(req) : null,
        started,
        current: stepView(cur.step),
        done: cur.done,
        doneText: '¡Listo! Ya tengo todo. Antes de preparar tu diagnóstico, revisa que tus datos estén bien.',
        finish: html`<div class="chat-finish"><a class="btn btn-primary btn-lg" href="${opts.base}/revision">Revisar y ${opts.finishVerb || 'continuar'}</a></div>`,
        progress: cur.progress,
        error,
      }),
    });
  }

  router.post(`${opts.base}/chat`, ...guards, (req, res) => {
    if (opts.before && opts.before(req, res)) return;
    const wantsJson = (req.get('accept') || '').includes('application/json');
    const reply = (status, out) => {
      if (wantsJson) return res.status(status).json(out);
      if (out.error) chatState(req).error = out.error;
      return res.redirect(303, opts.base);
    };
    const limit = rateLimit({ key: `answer:${req.session.id}`, limit: 240, windowMs: 60_000 });
    if (!limit.allowed) return reply(429, { error: 'Vas muy rápido. Espera unos segundos.' });
    const { ev } = load(req);
    if (!ev) return reply(409, { go: opts.base });
    const qn = qs.load(ev.questionnaire_id);
    const cur = chatCurrent(req, ev, qn);
    if (cur.done || !cur.step) return reply(200, { done: true });
    const texto = typeof req.body.texto === 'string' ? req.body.texto.trim().slice(0, 200) : '';
    if (!texto) return reply(422, { error: 'Escribe tu respuesta o toca una opción.' });
    const r = cur.step.apply(texto);
    if (r.error) return reply(422, { error: r.error });
    const body = r.unknown ? { unknown: '1' } : r.body;
    const nextStep = r.unknown ? null : deepChat.nextStep(cur.q, body, cur.currency);
    if (nextStep) {
      chatState(req).partial = { ev: ev.id, code: cur.q.code, body };
    } else {
      const parsed = qs.parseSubmission(cur.q, deepChat.toSubmission(cur.q, body), cur.currency);
      if (!parsed.ok) {
        // Algo no cuadró al armar la respuesta completa: se vuelve a empezar esa pregunta.
        delete chatState(req).partial;
        return reply(422, { error: `${Object.values(parsed.errors)[0] || 'No pude guardar esa respuesta.'} Empecemos esa pregunta de nuevo.` });
      }
      qs.saveAnswer(ev, cur.q, parsed);
      delete chatState(req).partial;
    }
    const after = chatCurrent(req, ev, qn);
    return reply(200, { next: stepView(after.step), done: after.done, progress: after.progress });
  });

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
      const fwd = nextToAsk(qn, map, n);
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
    const fwd = nextToAsk(qn, after, n);
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
