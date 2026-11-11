'use strict';
// Motor determinista del test gratuito FREE_25_V2_ES. Resuelve la pregunta
// siguiente, valida y guarda respuestas, invalida dependencias, emite anotaciones y
// finaliza el test. Todo ocurre en transacciones sincronas; ningún modelo de IA
// participa en elegir preguntas, opciones ni la ruta.
const crypto = require('node:crypto');
const db = require('../../db');
const { token, sha256 } = require('../../lib/security');
const catalog = require('./catalog');
const catalog3 = require('./catalog3');
const { FreeError, validate, validCurrency, checkAgeAgainstRange } = require('./values');
const annotations = require('./annotations');
const resultSvc = require('./result');

// ───────── Catálogos ─────────
// Cada sesión se interpreta SOLO con el catálogo con el que se creó (FREE_25_V2_ES
// histórico o FREE_25_V3_ES). No hay migración semántica entre versiones.
function routeFrom(a) {
  if (!a) return null;
  if (a.status === 'answered' && typeof a.value === 'string') return a.value;
  return 'U'; // Q03 = DK o PNA: ruta desconocida, sin inferir ocupación.
}

function v2Revalidates(answer, variant, ctx, session) {
  if (answer.status !== 'answered' || !answer.value) return true;
  if (variant.type === 'money_or_choice' && answer.value.kind === 'AMOUNT') return answer.value.currency === session.currency;
  if (variant.type === 'age_or_choice' && answer.value.kind === 'AGE') {
    const q16 = ctx.code('Q16');
    return q16 === null ? true : checkAgeAgainstRange(answer.value, q16).ok;
  }
  return true;
}

const V2 = {
  ...catalog,
  ROUTE_SLOT: 'Q03',
  CURRENCY_SLOT: null,
  hasAnnotations: true,
  routeOf: (get) => routeFrom(get('Q03')),
  applicable: () => true,
  validate,
  revalidates: v2Revalidates,
  results: () => resultSvc,
};
const V3 = { ...catalog3, hasAnnotations: false, results: () => require('./result3') };
const CATALOGS = { [V2.VERSION_ID]: V2, [V3.VERSION_ID]: V3 };
for (const C of Object.values(CATALOGS)) {
  C.ORDER = C.SLOTS.map((s) => s.slot_id);
  C.TOTAL = C.SLOTS.length;
}

/** Catálogo de una sesión (V2 por defecto para llamadas sin sesión). */
function cat(session) {
  return (session && CATALOGS[session.version_id]) || V2;
}
const SLOT_BY_ID = catalog.SLOT_BY_ID;
const TOTAL = 25;
const MONEY_TYPES = ['money_or_choice'];

// ───────── Contexto de resolución ─────────
/** Contexto de solo lectura sobre respuestas activas. `limit` oculta slots posteriores. */
function buildCtx(answers, session, limit = TOTAL) {
  const C = cat(session);
  const get = (s) => (C.SLOT_BY_ID[s].ordinal <= limit ? answers[s] || null : null);
  return {
    cat: C,
    get,
    route: C.routeOf(get),
    currency: session ? session.currency : null,
    code: (s) => {
      const a = get(s);
      return a && a.status === 'answered' && typeof a.value === 'string' ? a.value : null;
    },
    list: (s) => {
      const a = get(s);
      return a && a.status === 'answered' && Array.isArray(a.value) ? a.value : null;
    },
    status: (s) => {
      const a = get(s);
      return a ? a.status : 'unanswered';
    },
    value: (s) => {
      const a = get(s);
      return a ? a.value : null;
    },
    variantId: (s) => {
      const a = get(s);
      return a ? a.variant_id : null;
    },
  };
}

/** Variantes que coinciden con el contexto para un slot. */
function matching(slotId, ctx) {
  return ctx.cat.SLOT_BY_ID[slotId].variants.filter((v) => v.when(ctx));
}

function resolve(slotId, ctx) {
  const hit = matching(slotId, ctx);
  if (hit.length !== 1) {
    throw new FreeError(500, 'CATALOG_CONFIG', `El slot ${slotId} resolvió ${hit.length} variantes; error de configuración del catálogo.`);
  }
  return hit[0];
}

function contextHash(variant, ctx) {
  const r = ctx.cat.renderVariant(variant, ctx);
  const dump = JSON.stringify({ v: ctx.cat.VERSION_ID, id: variant.id, t: r.text, h: r.help, o: r.options.map((o) => o.code) });
  return sha256(dump).slice(0, 16);
}

/** Pregunta resuelta lista para el cliente (sin condiciones ni respuestas ajenas). */
function publicQuestion(slotId, ctx, session) {
  const variant = resolve(slotId, ctx);
  const r = ctx.cat.renderVariant(variant, ctx);
  const q = {
    catalog_version: ctx.cat.VERSION_ID,
    slot_id: slotId,
    ordinal: ctx.cat.SLOT_BY_ID[slotId].ordinal,
    variant_id: variant.id,
    type: variant.type,
    text: r.text,
    help: r.help,
    options: r.options,
    resolved_context_hash: contextHash(variant, ctx),
  };
  if (variant.type === 'multi') {
    q.min_selected = variant.min_selected;
    q.max_selected = variant.max_selected;
  }
  if (MONEY_TYPES.includes(variant.type)) {
    q.currency = session.currency || null;
    q.amount_limits = { min: '0.01', max: '999999999.99', decimals: 2 };
  }
  if (variant.type === 'age_or_choice') q.age_limits = { min: 18, max: 100 };
  if (ctx.cat === V3) {
    // Campos de la variante V3 (opciones auxiliares, límites y periodo), sin funciones.
    q.config = Object.fromEntries(Object.entries(variant).filter(([k, v]) => !['id', 'slot_id', 'when', 'type', 'text', 'help', 'options'].includes(k) && typeof v !== 'function'));
    q.currency = session ? session.currency || null : null;
  }
  return q;
}

// ───────── Acceso a datos ─────────
function loadSession(id) {
  return typeof id === 'string' ? db.one('SELECT * FROM ft_sessions WHERE id = ?', id) : null;
}

function activeAnswers(sessionId) {
  const map = {};
  for (const r of db.all('SELECT * FROM ft_answers WHERE session_id = ? AND active = 1', sessionId)) {
    map[r.slot_id] = { slot_id: r.slot_id, variant_id: r.variant_id, status: r.response_status, value: db.parse(r.value_json, null), answer_revision: r.answer_revision, context_hash: r.context_hash, answered_at: r.answered_at };
  }
  return map;
}

/** Slots que aplican con las respuestas actuales (V3 omite Q12/Q13 sin deudas confirmadas). */
function applicableOrder(answers, session) {
  const C = cat(session);
  const ctx = buildCtx(answers, session);
  return C.ORDER.filter((s) => C.applicable(s, ctx));
}

function nextPending(answers, session) {
  return applicableOrder(answers, session).find((s) => !answers[s]) || null;
}

function progress(answers, session) {
  const C = cat(session);
  const next = nextPending(answers, session);
  const skipped = C.TOTAL - applicableOrder(answers, session).length;
  return { completed_count: Object.keys(answers).length + skipped, total: C.TOTAL, next_ordinal: next ? C.SLOT_BY_ID[next].ordinal : null };
}

function nextQuestion(session, answers) {
  const next = nextPending(answers, session);
  return next ? publicQuestion(next, buildCtx(answers, session), session) : null;
}

function deactivate(sessionId, slotId, revision) {
  db.run('UPDATE ft_answers SET active = 0, deactivated_at = ? WHERE session_id = ? AND slot_id = ? AND active = 1', db.now(), sessionId, slotId);
}

// ───────── Sesiones ─────────
function createSession({ userId = null, anonId = null, currency = null, locale = catalog.LOCALE, versionId = catalog.VERSION_ID, consent = false } = {}) {
  const C = CATALOGS[versionId];
  if (!C) throw new FreeError(422, 'UNSUPPORTED_VERSION', `Versión de catálogo no disponible: ${versionId}.`);
  if (locale !== C.LOCALE) throw new FreeError(422, 'UNSUPPORTED_LOCALE', `Idioma no disponible: ${locale}.`);
  // En V3 la moneda la declara el usuario en Q01: no se hereda de la cuenta.
  if (C === V3) currency = null;
  if (currency !== null && currency !== undefined && !validCurrency(currency)) throw new FreeError(422, 'INVALID_CURRENCY', 'La moneda debe ser un código ISO 4217 válido, por ejemplo USD.');
  const id = `ft_${crypto.randomBytes(16).toString('hex')}`;
  const raw = token(32);
  const now = db.now();
  db.run(
    `INSERT INTO ft_sessions (id, version_id, locale, user_id, anon_id, token_hash, currency, route, status, revision, annotation_version, issued_annotation_count, consent_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'en_curso', 0, ?, 0, ?, ?, ?)`,
    id,
    versionId,
    locale,
    userId,
    userId ? null : anonId,
    sha256(raw),
    currency || null,
    C.ANNOTATION_VERSION,
    consent ? now : null,
    now,
    now
  );
  return { session: loadSession(id), accessToken: raw };
}

/** Autorización: token de acceso (anónimo no predecible) o propietario por cuenta/sesión. */
function authorize(session, { bearer = null, userId = null, anonId = null } = {}) {
  if (!session) return false;
  if (bearer && session.token_hash && sha256(bearer) === session.token_hash) return true;
  if (userId && session.user_id === userId) return true;
  if (anonId && session.anon_id === anonId && !session.user_id) return true;
  return false;
}

function findOwned({ userId, anonId }, status = null) {
  const st = status ? ' AND status = ?' : '';
  if (userId) return db.one(`SELECT * FROM ft_sessions WHERE user_id = ?${st} ORDER BY updated_at DESC, rowid DESC LIMIT 1`, userId, ...(status ? [status] : []));
  if (anonId) return db.one(`SELECT * FROM ft_sessions WHERE anon_id = ? AND user_id IS NULL${st} ORDER BY updated_at DESC, rowid DESC LIMIT 1`, anonId, ...(status ? [status] : []));
  return null;
}

/** Última sesión completada cuyo resultado corresponde a su revisión vigente. */
function findLatestResultSession(owner) {
  const where = owner.userId ? ['user_id = ?', owner.userId] : owner.anonId ? ['anon_id = ? AND user_id IS NULL', owner.anonId] : null;
  if (!where) return null;
  return db.one(`SELECT * FROM ft_sessions WHERE ${where[0]} AND completed_revision IS NOT NULL ORDER BY completed_at DESC, rowid DESC LIMIT 1`, where[1]);
}

function stateOf(session) {
  const answers = activeAnswers(session.id);
  return {
    session_id: session.id,
    version_id: session.version_id,
    locale: session.locale,
    status: session.status,
    revision: session.revision,
    currency: session.currency,
    progress: progress(answers, session),
    next_question: nextQuestion(session, answers),
    annotation: null,
    annotation_budget_remaining: Math.max(0, annotations.MAX_PER_SESSION - session.issued_annotation_count),
  };
}

function getState(sessionId) {
  const session = loadSession(sessionId);
  if (!session) throw new FreeError(404, 'NOT_FOUND', 'No encontramos este test.');
  return stateOf(session);
}

/** Pregunta de un slot concreto (para volver a editar). Exige slots previos respondidos. */
function questionAt(session, slotId) {
  const C = cat(session);
  if (!C.SLOT_BY_ID[slotId]) throw new FreeError(404, 'NOT_FOUND', 'Pregunta no encontrada.');
  const answers = activeAnswers(session.id);
  const order = applicableOrder(answers, session);
  const prior = order.filter((s) => C.SLOT_BY_ID[s].ordinal < C.SLOT_BY_ID[slotId].ordinal);
  const missing = prior.find((s) => !answers[s]);
  if (missing) return { redirect: missing };
  // Pregunta que no aplica (p. ej. Q12/Q13 sin deudas): se salta a la siguiente.
  if (!order.includes(slotId)) {
    const after = order.find((s) => C.SLOT_BY_ID[s].ordinal > C.SLOT_BY_ID[slotId].ordinal && !answers[s]) || order.find((s) => C.SLOT_BY_ID[s].ordinal > C.SLOT_BY_ID[slotId].ordinal);
    return { redirect: after || null, skipped: true };
  }
  const ctx = buildCtx(answers, session);
  return { question: publicQuestion(slotId, ctx, session), answer: answers[slotId] || null, answers };
}

// ───────── Guardado de respuestas ─────────
function canonical(obj) {
  return JSON.stringify(obj, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));
}

/** Invalida respuestas posteriores cuya variante, contexto o validez dejaron de aplicar. */
function reconcile(session, answers, fromOrdinal, { routeChanged }) {
  const C = cat(session);
  const invalidated = [];
  for (const slotId of C.ORDER) {
    if (C.SLOT_BY_ID[slotId].ordinal <= fromOrdinal || !answers[slotId]) continue;
    const a = answers[slotId];
    const ctx = buildCtx(answers, session);
    // En V2 un cambio de ruta invalida todo lo posterior; en V3 solo lo que cambió de variante.
    let ok = !(routeChanged && C === V2) && C.applicable(slotId, ctx);
    if (ok) {
      const hit = matching(slotId, ctx);
      ok = hit.length === 1 && hit[0].id === a.variant_id && contextHash(hit[0], ctx) === a.context_hash && C.revalidates(a, hit[0], ctx, session);
    }
    if (!ok) {
      deactivate(session.id, slotId);
      delete answers[slotId];
      invalidated.push(slotId);
    }
  }
  return invalidated;
}

function eventObject(row) {
  return { event_id: row.event_id, rule_id: row.rule_id, group_id: row.group_id, text: row.text_snapshot, placement: 'below_next_question', after_slot: row.after_slot, target_slot: row.target_slot, answer_revision: row.answer_revision };
}

/** Retira eventos cuyas condiciones dejaron de ser ciertas tras una edición. */
function retireEvents(session, answers) {
  const retired = [];
  if (!cat(session).hasAnnotations) return retired;
  for (const ev of db.all('SELECT * FROM ft_annotation_events WHERE session_id = ? AND invalidated_at IS NULL', session.id)) {
    const rule = annotations.RULE_BY_ID[ev.rule_id];
    const still = answers[ev.after_slot] && rule && rule.cond(buildCtx(answers, session, SLOT_BY_ID[ev.after_slot].ordinal));
    if (!still) {
      db.run('UPDATE ft_annotation_events SET invalidated_at = ? WHERE event_id = ?', db.now(), ev.event_id);
      retired.push(ev.event_id);
    }
  }
  return retired;
}

function emitAnnotation(session, answers, slotId, revision, count) {
  if (!cat(session).hasAnnotations) return null;
  if (!annotations.EVAL_POINTS.includes(slotId) || count >= annotations.MAX_PER_SESSION) return null;
  const target = nextPending(answers, session);
  if (!target) return null;
  const past = db.all('SELECT rule_id, group_id FROM ft_annotation_events WHERE session_id = ?', session.id);
  const [pick] = annotations.candidates(buildCtx(answers, session, SLOT_BY_ID[slotId].ordinal), slotId, {
    emittedRules: new Set(past.map((e) => e.rule_id)),
    emittedGroups: new Set(past.map((e) => e.group_id)),
  });
  if (!pick) return null;
  const eventId = `ann_${crypto.randomBytes(10).toString('hex')}`;
  db.run(
    `INSERT INTO ft_annotation_events (event_id, session_id, annotation_version, rule_id, group_id, after_slot, target_slot, answer_revision, text_snapshot, issued_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    eventId,
    session.id,
    session.annotation_version,
    pick.id,
    pick.group,
    slotId,
    target,
    revision,
    pick.text,
    db.now()
  );
  return eventObject(db.one('SELECT * FROM ft_annotation_events WHERE event_id = ?', eventId));
}

/**
 * Guarda la respuesta de un slot. `input`: { variant_id, expected_revision, value,
 * resolved_context_hash?, idempotency_key?, change_currency? }.
 */
function saveAnswer(sessionId, slotId, input) {
  return db.tx(() => {
    const session = loadSession(sessionId);
    if (!session) throw new FreeError(404, 'NOT_FOUND', 'No encontramos este test.');
    const C = cat(session);
    const slotDef = C.SLOT_BY_ID[slotId];
    if (!slotDef) throw new FreeError(404, 'NOT_FOUND', 'Pregunta no encontrada.');
    if (!input || typeof input !== 'object') throw new FreeError(422, 'INVALID_OPTION', 'Envía variant_id, expected_revision y value.');

    // La idempotencia se comprueba antes que la revisión.
    const key = typeof input.idempotency_key === 'string' && input.idempotency_key ? input.idempotency_key.slice(0, 120) : null;
    const payloadHash = sha256(canonical({ slotId, variant_id: input.variant_id, value: input.value, expected_revision: input.expected_revision, ctx: input.resolved_context_hash || null, cc: Boolean(input.change_currency) }));
    if (key) {
      const prev = db.one('SELECT * FROM ft_idempotency WHERE session_id = ? AND idem_key = ?', session.id, key);
      if (prev) {
        if (prev.payload_hash !== payloadHash) throw new FreeError(409, 'IDEMPOTENCY_CONFLICT', 'Esa clave de idempotencia ya se usó con otro contenido.');
        return { ...db.parse(prev.response_json), idempotent_replay: true };
      }
    }

    if (!Number.isInteger(input.expected_revision) || input.expected_revision !== session.revision) {
      throw new FreeError(409, 'STALE_REVISION', 'El test cambió desde que cargaste la pregunta. Recarga y vuelve a intentarlo.', { current: stateOf(session) });
    }

    const answers = activeAnswers(session.id);
    const order = applicableOrder(answers, session);
    const missingPrior = order.filter((s) => C.SLOT_BY_ID[s].ordinal < slotDef.ordinal).find((s) => !answers[s]);
    if (missingPrior) throw new FreeError(409, 'STALE_VARIANT', `Primero responde ${missingPrior}.`, { current: stateOf(session) });
    if (!order.includes(slotId)) throw new FreeError(409, 'NOT_APPLICABLE', 'Esta pregunta no aplica con tus respuestas anteriores.', { current: stateOf(session) });

    const ctx = buildCtx(answers, session);
    const variant = resolve(slotId, ctx);
    if (input.variant_id !== variant.id || (input.resolved_context_hash && input.resolved_context_hash !== contextHash(variant, ctx))) {
      throw new FreeError(409, 'STALE_VARIANT', 'La pregunta cambió por tus respuestas anteriores. Recarga para ver la pregunta vigente.', { current: stateOf(session) });
    }

    const parsed = C.validate(variant, input.value, session);
    let newCurrency = session.currency;
    let currencyChanged = false;
    if (C === V3 && slotId === C.CURRENCY_SLOT && parsed.status === 'answered') {
      // La moneda declarada en Q01 rige todos los montos; si cambia, se piden de nuevo.
      newCurrency = parsed.value.currency;
      currencyChanged = Boolean(session.currency) && session.currency !== newCurrency;
    } else if (C === V2 && parsed.status === 'answered' && parsed.value && parsed.value.kind === 'AMOUNT') {
      if (!session.currency) {
        newCurrency = parsed.value.currency;
      } else if (parsed.value.currency !== session.currency) {
        if (input.change_currency !== true) throw new FreeError(422, 'CURRENCY_MISMATCH', `La moneda de la sesión es ${session.currency}. Envía change_currency en true para cambiarla; tus importes anteriores se borrarán.`);
        newCurrency = parsed.value.currency;
        currencyChanged = true;
      }
    }
    if (variant.type === 'age_or_choice' && parsed.status === 'answered') {
      const chk = checkAgeAgainstRange(parsed.value, ctx.code('Q16'));
      if (!chk.ok) {
        // Con CONFIRMATION_REQUIRED el cliente muestra la confirmación en la misma pantalla.
        throw new FreeError(422, chk.code, chk.message);
      }
    }

    const previous = answers[slotId] || null;
    const revision = session.revision + 1;
    const routeOf = (ans) => C.routeOf((x) => ans[x] || null);
    const oldRoute = routeOf(answers);
    if (previous) deactivate(session.id, slotId);
    db.run(
      `INSERT INTO ft_answers (session_id, slot_id, variant_id, value_json, response_status, context_hash, answer_revision, active, answered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      session.id,
      slotId,
      variant.id,
      parsed.value === null ? null : JSON.stringify(parsed.value),
      parsed.status,
      contextHash(variant, ctx),
      revision,
      db.now()
    );
    answers[slotId] = { slot_id: slotId, variant_id: variant.id, status: parsed.status, value: parsed.value, answer_revision: revision, context_hash: contextHash(variant, ctx) };
    const session2 = { ...session, currency: newCurrency };
    const newRoute = routeOf(answers);
    const routeChanged = slotId === C.ROUTE_SLOT && previous && oldRoute !== newRoute;

    const invalidated = reconcile(session2, answers, slotDef.ordinal, { routeChanged });
    if (currencyChanged && C === V2) {
      for (const s of C.ORDER) {
        const a = answers[s];
        if (s !== slotId && a && a.value && a.value.kind === 'AMOUNT' && a.value.currency !== newCurrency) {
          deactivate(session.id, s);
          delete answers[s];
          invalidated.push(s);
        }
      }
      // Los slots posteriores al borrado dependen de un contexto distinto: reconcilia de nuevo.
      invalidated.push(...reconcile(session2, answers, 0, { routeChanged: false }));
    }

    const retired = retireEvents(session2, answers);
    const advance = !previous;
    const annotation = advance ? emitAnnotation(session2, answers, slotId, revision, session.issued_annotation_count) : null;
    const count = session.issued_annotation_count + (annotation ? 1 : 0);

    db.run(
      `UPDATE ft_sessions SET revision = ?, route = ?, currency = ?, status = 'en_curso', updated_at = ?, issued_annotation_count = ? WHERE id = ?`,
      revision,
      routeOf(answers),
      newCurrency,
      db.now(),
      count,
      session.id
    );

    const fresh = loadSession(session.id);
    const response = {
      session_id: fresh.id,
      revision: fresh.revision,
      status: fresh.status,
      invalidated_slots: [...new Set(invalidated)].sort(),
      progress: progress(answers, fresh),
      next_question: nextQuestion(fresh, answers),
      annotation,
      invalidated_annotation_ids: retired,
      annotation_budget_remaining: Math.max(0, annotations.MAX_PER_SESSION - count),
    };
    if (key) db.run('INSERT INTO ft_idempotency (session_id, idem_key, payload_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)', session.id, key, payloadHash, JSON.stringify(response), db.now());
    return response;
  });
}

/** Marca un evento como mostrado (una sola vez) y lo devuelve si no estaba invalidado. */
function takeAnnotationToShow(sessionId, eventId) {
  return db.tx(() => {
    const ev = db.one('SELECT * FROM ft_annotation_events WHERE event_id = ? AND session_id = ?', eventId, sessionId);
    if (!ev || ev.invalidated_at || ev.shown_at) return null;
    db.run('UPDATE ft_annotation_events SET shown_at = ? WHERE event_id = ?', db.now(), eventId);
    return eventObject(ev);
  });
}

// ───────── Finalización y resultado ─────────
function completenessProblems(session, answers) {
  const problems = [];
  const ctx = buildCtx(answers, session);
  for (const s of applicableOrder(answers, session)) {
    const a = answers[s];
    if (!a) {
      problems.push({ slot_id: s, reason: 'UNANSWERED' });
      continue;
    }
    const hit = matching(s, ctx);
    if (hit.length !== 1 || hit[0].id !== a.variant_id || contextHash(hit[0], ctx) !== a.context_hash) problems.push({ slot_id: s, reason: 'STALE_VARIANT' });
    else if (a.status === 'answered' && hit[0].type === 'age_or_choice' && !checkAgeAgainstRange(a.value, ctx.code('Q16')).ok) problems.push({ slot_id: s, reason: 'CONFIRMATION_PENDING' });
  }
  return problems;
}

/** Servicio de resultado del catálogo de la sesión (V2: RESULT_FREE_V2, V3: RESULT_FREE_V3_ES). */
function resultsFor(session) {
  return cat(session).results();
}

function resultRow(session, revision) {
  return db.one('SELECT * FROM ft_results WHERE session_id = ? AND answer_revision = ? AND rules_version = ?', session.id, revision, resultsFor(session).RULES_VERSION);
}

function publicResultRow(row) {
  if (!row) return null;
  return { diagnostic_id: row.id, status: row.status, narrative_source: row.narrative_source };
}

/** Finaliza una sola vez por revisión y encola la redacción del resultado. */
function complete(sessionId) {
  return db.tx(() => {
    const session = loadSession(sessionId);
    if (!session) throw new FreeError(404, 'NOT_FOUND', 'No encontramos este test.');
    if (session.completed_revision === session.revision && session.status === 'completada') {
      const row = resultRow(session, session.revision);
      return { session_id: session.id, revision: session.revision, generation_status: row ? row.status : 'failed', ...(publicResultRow(row) || {}) };
    }
    const answers = activeAnswers(session.id);
    const problems = completenessProblems(session, answers);
    if (problems.length) throw new FreeError(409, 'INCOMPLETE', 'Aún hay preguntas pendientes o por confirmar.', { pending: problems });
    db.run("UPDATE ft_sessions SET status = 'completada', completed_revision = revision, completed_at = ?, updated_at = ? WHERE id = ?", db.now(), db.now(), session.id);
    const row = resultsFor(session).generate(loadSession(session.id), answers);
    return { session_id: session.id, revision: session.revision, generation_status: row.status, ...publicResultRow(row) };
  });
}

function getDiagnostic(sessionId) {
  const session = loadSession(sessionId);
  if (!session) throw new FreeError(404, 'NOT_FOUND', 'No encontramos este test.');
  if (session.completed_revision === null) throw new FreeError(409, 'NOT_COMPLETED', 'El test aún no está completo.');
  if (session.completed_revision !== session.revision || session.status !== 'completada') {
    throw new FreeError(409, 'RESULT_STALE', 'Cambiaste respuestas después de finalizar: vuelve a finalizar el test para generar un resultado actualizado.');
  }
  const row = resultRow(session, session.completed_revision);
  if (!row) return { status: 'failed', retry_available: true };
  if (row.status === 'ready') return { status: 'ready', narrative_source: row.narrative_source, result: db.parse(row.result_json) };
  return { status: row.status, retry_available: row.status === 'failed' };
}

function retryDiagnostic(sessionId) {
  return db.tx(() => {
    const session = loadSession(sessionId);
    if (!session || session.completed_revision !== session.revision || session.status !== 'completada') throw new FreeError(409, 'RESULT_STALE', 'No hay un resultado vigente para reintentar.');
    const row = resultRow(session, session.revision);
    if (row && row.status !== 'failed') return { generation_status: row.status, diagnostic_id: row.id };
    if (row) db.run('DELETE FROM ft_results WHERE id = ?', row.id);
    const fresh = resultsFor(session).generate(session, activeAnswers(session.id));
    return { generation_status: fresh.status, diagnostic_id: fresh.id };
  });
}

/** Vincula una sesión (acceso por token) a la cuenta; idempotente. */
function linkToUser(sessionId, userId) {
  const session = loadSession(sessionId);
  if (!session) throw new FreeError(404, 'NOT_FOUND', 'No encontramos este test.');
  if (session.user_id && session.user_id !== userId) throw new FreeError(409, 'ALREADY_LINKED', 'Este test ya pertenece a otra cuenta.');
  db.run('UPDATE ft_sessions SET user_id = ?, anon_id = NULL, updated_at = ? WHERE id = ?', userId, db.now(), sessionId);
  if (session.currency) db.run('UPDATE users SET base_currency = COALESCE(base_currency, ?) WHERE id = ?', session.currency, userId);
  return { session_id: sessionId, linked: true };
}

/** Datos de la sesión para el resultado y revisión (solo lectura). */
function snapshot(sessionId) {
  const session = loadSession(sessionId);
  return session ? { session, answers: activeAnswers(session.id) } : null;
}

module.exports = {
  TOTAL,
  CATALOGS,
  catalogOf: cat,
  applicableOrder,
  buildCtx,
  resolve,
  matching,
  publicQuestion,
  contextHash,
  createSession,
  authorize,
  findOwned,
  findLatestResultSession,
  loadSession,
  activeAnswers,
  getState,
  stateOf,
  questionAt,
  nextPending,
  progress,
  saveAnswer,
  takeAnnotationToShow,
  complete,
  completenessProblems,
  getDiagnostic,
  retryDiagnostic,
  linkToUser,
  snapshot,
  FreeError,
};
