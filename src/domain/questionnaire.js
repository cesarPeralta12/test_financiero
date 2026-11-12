'use strict';
// Cuestionarios versionados, evaluaciones y respuestas. Cada evaluación queda
// ligada a la versión con la que empezó; publicar otra versión no la modifica.
const db = require('../db');
const money = require('../lib/money');
const calc = require('./calc');

const SECTIONS = {
  perfil: 'Tu moneda',
  ingresos: 'Ingresos',
  gastos: 'Gastos',
  deudas: 'Deudas',
  ahorro: 'Ahorro',
  dependientes: 'Dependientes',
  habitos: 'Hábitos',
  objetivos: 'Objetivos',
  riesgos: 'Riesgos',
  oportunidades: 'Oportunidades',
  metas: 'Metas',
};

const RATE_TYPE_OPTIONS = Object.entries(calc.RATE_TYPES).map(([value, label]) => ({ value, label }));

function hydrate(q) {
  return {
    ...q,
    options: db.parse(q.options_json, []) || [],
    config: db.parse(q.config_json, {}) || {},
    required: Boolean(q.required),
    allowUnknown: Boolean(q.allow_unknown),
  };
}

function load(questionnaireId) {
  const qn = db.one('SELECT * FROM questionnaires WHERE id = ?', questionnaireId);
  if (!qn) return null;
  qn.questions = db.all('SELECT * FROM questions WHERE questionnaire_id = ? ORDER BY position', questionnaireId).map(hydrate);
  return qn;
}

function published(kind) {
  const row = db.one("SELECT id FROM questionnaires WHERE kind = ? AND status = 'publicado' ORDER BY version DESC LIMIT 1", kind);
  return row ? load(row.id) : null;
}

// ───────── Evaluaciones ─────────
function ownerClause(owner) {
  if (owner.userId) return { sql: 'user_id = ?', params: [owner.userId] };
  if (owner.anonId) return { sql: 'anon_id = ? AND user_id IS NULL', params: [owner.anonId] };
  return null;
}

function findEvaluation(kind, owner, status = null) {
  const o = ownerClause(owner);
  if (!o) return null;
  const st = status ? ' AND status = ?' : '';
  const params = [kind, ...o.params, ...(status ? [status] : [])];
  return db.one(
    `SELECT * FROM evaluations WHERE kind = ? AND ${o.sql}${st} ORDER BY (status = 'en_curso') DESC, updated_at DESC, id DESC LIMIT 1`,
    ...params
  );
}

function latestFinished(kind, owner) {
  const o = ownerClause(owner);
  if (!o) return null;
  return db.one(
    `SELECT * FROM evaluations WHERE kind = ? AND ${o.sql} AND status = 'finalizada' ORDER BY completed_at DESC, id DESC LIMIT 1`,
    kind,
    ...o.params
  );
}

function startEvaluation(kind, owner) {
  const qn = published(kind);
  if (!qn) throw new Error(`No hay un cuestionario ${kind} publicado.`);
  const r = db.run(
    `INSERT INTO evaluations (kind, questionnaire_id, user_id, anon_id, status, current_position, started_at, updated_at)
     VALUES (?, ?, ?, ?, 'en_curso', 1, ?, ?)`,
    kind,
    qn.id,
    owner.userId || null,
    owner.userId ? null : owner.anonId,
    db.now(),
    db.now()
  );
  return db.one('SELECT * FROM evaluations WHERE id = ?', r.lastId);
}

function answers(evaluationId) {
  const map = {};
  for (const a of db.all('SELECT * FROM answers WHERE evaluation_id = ?', evaluationId)) {
    map[a.code] = { value: db.parse(a.value_json), unknown: Boolean(a.is_unknown), skipped: Boolean(a.is_skipped), fromPrevious: Boolean(a.from_previous), questionId: a.question_id, updatedAt: a.updated_at };
  }
  return map;
}

function isAnswered(q, a) {
  if (!a || a.skipped) return false;
  if (a.unknown) return q.allowUnknown;
  return a.value !== null && a.value !== undefined;
}

function isApplicable(q, map) {
  const cond = q.config && q.config.show_if;
  if (!cond) return true;
  const a = map[cond.code];
  if (!a || a.unknown || a.skipped) return false;
  if (cond.in) return cond.in.includes(a.value);
  if (cond.not_empty) return Array.isArray(a.value) && a.value.length > 0;
  return true;
}

function status(evaluation, qn, map) {
  const items = qn.questions.map((q) => {
    const applicable = isApplicable(q, map);
    const a = map[q.code];
    return { q, applicable, answered: applicable && isAnswered(q, a), answer: a };
  });
  const missing = items.filter((i) => i.applicable && i.q.required && !i.answered);
  const done = items.filter((i) => !i.applicable || i.answered).length;
  return { items, missing, done, total: items.length, complete: missing.length === 0 };
}

function nextApplicable(qn, map, from, dir = 1) {
  let pos = from + dir;
  while (pos >= 1 && pos <= qn.questions.length) {
    const q = qn.questions[pos - 1];
    if (isApplicable(q, map)) return pos;
    pos += dir;
  }
  return null;
}

function firstUnanswered(qn, map) {
  for (const q of qn.questions) {
    if (isApplicable(q, map) && !isAnswered(q, map[q.code])) return q.position;
  }
  return null;
}

function saveAnswer(evaluation, q, parsed, { fromPrevious = false } = {}) {
  db.tx(() => {
    db.run(
      `INSERT INTO answers (evaluation_id, question_id, code, value_json, is_unknown, is_skipped, from_previous, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(evaluation_id, question_id) DO UPDATE SET value_json = excluded.value_json, is_unknown = excluded.is_unknown,
         is_skipped = 0, from_previous = excluded.from_previous, updated_at = excluded.updated_at`,
      evaluation.id,
      q.id,
      q.code,
      parsed.unknown ? null : JSON.stringify(parsed.value),
      parsed.unknown ? 1 : 0,
      fromPrevious ? 1 : 0,
      db.now()
    );
    const patch = q.type === 'currency' && !parsed.unknown ? parsed.value : null;
    db.run(
      'UPDATE evaluations SET updated_at = ?, current_position = ?, base_currency = COALESCE(?, base_currency) WHERE id = ?',
      db.now(),
      q.position,
      patch,
      evaluation.id
    );
  });
}

function setPosition(evaluation, pos) {
  db.run('UPDATE evaluations SET current_position = ?, updated_at = ? WHERE id = ?', pos, db.now(), evaluation.id);
}

// ───────── Lectura y validación de respuestas ─────────
function bodyArray(v) {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'object') return Object.keys(v).sort((a, b) => Number(a) - Number(b)).map((k) => v[k]);
  return [v];
}

function parsePercent(raw) {
  const s = String(raw ?? '').trim().replace('%', '').replace(',', '.');
  if (!s) return { empty: true };
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: 'Escribe un porcentaje, por ejemplo 15 o 24,5.' };
  const d = new money.D(s);
  return { value: d.toString(), d };
}

/**
 * Valida el envío de una pregunta. Devuelve { ok, value, unknown, errors, form }.
 * `form` conserva lo escrito para volver a mostrarlo si hay errores.
 */
function parseSubmission(q, body, currency) {
  const errors = {};
  const form = {};
  const unknown = q.allowUnknown && (body.unknown === '1' || body.unknown === 'on');
  if (unknown) return { ok: true, unknown: true, value: null, errors, form: { unknown: true } };
  const reqMsg = q.allowUnknown ? 'Responde esta pregunta o marca «No lo sé».' : 'Responde esta pregunta para continuar.';
  const optionValues = q.options.map((o) => o.value);

  switch (q.type) {
    case 'currency': {
      form.value = body.value;
      if (!body.value) errors.value = 'Elige una moneda.';
      else if (!money.CURRENCIES[body.value]) errors.value = 'Elige una de las monedas de la lista.';
      return result(body.value);
    }
    case 'single': {
      form.value = body.value;
      if (!body.value) errors.value = reqMsg;
      else if (!optionValues.includes(body.value)) errors.value = 'Elige una de las opciones.';
      return result(body.value);
    }
    case 'multi': {
      const vals = bodyArray(body.value).filter(Boolean);
      form.value = vals;
      const exclusive = q.config.exclusive || [];
      if (!vals.length) errors.value = 'Marca al menos una opción.';
      else if (vals.some((v) => !optionValues.includes(v))) errors.value = 'Elige opciones de la lista.';
      else if (vals.length > 1 && vals.some((v) => exclusive.includes(v))) {
        const label = q.options.find((o) => exclusive.includes(o.value))?.label || 'Ninguna';
        errors.value = `«${label}» no se puede combinar con otras opciones.`;
      }
      return result([...new Set(vals)]);
    }
    case 'money': {
      form.amount = body.amount;
      const p = money.parseAmount(body.amount, currency);
      if (p.empty) errors.amount = q.allowUnknown ? 'Escribe una cantidad o marca «No lo sé». Si no tienes, escribe 0.' : 'Escribe una cantidad. Si no tienes, escribe 0.';
      else if (!p.ok) errors.amount = p.error;
      return result(p.value);
    }
    case 'money_flow': {
      form.amount = body.amount;
      form.period = body.period;
      if (asksPresence(q)) {
        // Primero Sí/No: quien no tiene ese ingreso no debería tener que escribir un 0.
        form.has = body.has;
        if (body.has === 'no') return result({ amount: money.parseAmount('0', currency).value, period: 'mensual' });
        if (body.has !== 'si') {
          errors.has = 'Elige Sí o No para continuar.';
          return result(null);
        }
      }
      const p = money.parseAmount(body.amount, currency);
      const periods = q.config.periods || ['mensual'];
      if (p.empty) errors.amount = q.allowUnknown ? 'Escribe una cantidad o marca «No lo sé». Si no tienes, escribe 0.' : 'Escribe una cantidad. Si no tienes, escribe 0.';
      else if (!p.ok) errors.amount = p.error;
      if (!body.period || !periods.includes(body.period)) errors.period = 'Elige cada cuánto ocurre.';
      return result({ amount: p.value, period: body.period });
    }
    case 'integer': {
      form.value = body.value;
      const s = String(body.value ?? '').trim();
      const min = q.config.min ?? 0;
      const max = q.config.max ?? 1000;
      if (!s) errors.value = reqMsg;
      else if (!/^\d+$/.test(s)) errors.value = 'Escribe un número entero, sin decimales.';
      else if (Number(s) < min || Number(s) > max) errors.value = `Escribe un número entre ${min} y ${max}.`;
      return result(Number(s));
    }
    case 'percent': {
      form.value = body.value;
      const p = parsePercent(body.value);
      if (p.empty) errors.value = reqMsg;
      else if (p.error) errors.value = p.error;
      else if (p.d.gt(100)) errors.value = 'Escribe un porcentaje entre 0 y 100.';
      return result(p.value);
    }
    case 'breakdown': {
      const f = body.f || {};
      const value = {};
      form.f = {};
      for (const field of q.config.fields) {
        form.f[field.key] = f[field.key];
        const p = money.parseAmount(f[field.key], currency);
        if (p.empty) errors[`f.${field.key}`] = 'Escribe una cantidad o 0.';
        else if (!p.ok) errors[`f.${field.key}`] = p.error;
        else value[field.key] = p.value;
      }
      return result(value);
    }
    case 'debts': {
      const none = body.none === '1' || body.none === 'on';
      const rows = bodyArray(body.d).map((r) => r || {});
      form.none = none;
      form.rows = rows;
      const filled = rows.filter((r) => ['name', 'balance', 'payment', 'rate'].some((k) => String(r[k] ?? '').trim()));
      if (none) {
        if (filled.length) errors.none = 'Marcaste «No tengo deudas», pero hay deudas escritas. Quita las filas o desmarca la casilla.';
        return result([]);
      }
      if (!filled.length) {
        errors.rows = 'Registra al menos una deuda o marca «No tengo deudas».';
        return result([]);
      }
      const kinds = (q.config.kinds || []).map((k) => k.value);
      const out = [];
      rows.forEach((r, i) => {
        if (!filled.includes(r)) return;
        const e = (k, m) => (errors[`d.${i}.${k}`] = m);
        const name = String(r.name || '').trim().slice(0, 60);
        if (!name) e('name', 'Ponle un nombre, por ejemplo «Tarjeta banco».');
        if (!kinds.includes(r.kind)) e('kind', 'Elige el tipo de deuda.');
        const bal = money.parseAmount(r.balance, currency);
        if (bal.empty) e('balance', 'Escribe el saldo pendiente.');
        else if (!bal.ok) e('balance', bal.error);
        const pay = money.parseAmount(r.payment, currency);
        if (pay.empty) e('payment', 'Escribe la cuota mensual. Escribe 0 si hoy no pagas.');
        else if (!pay.ok) e('payment', pay.error);
        let rate = null;
        const rateRaw = String(r.rate ?? '').trim();
        if (rateRaw) {
          const p = parsePercent(rateRaw);
          if (p.error) e('rate', p.error);
          else if (p.d.gt(500)) e('rate', 'Revisa la tasa: parece demasiado alta.');
          else rate = p.value;
        }
        const rateType = Object.keys(calc.RATE_TYPES).includes(r.rate_type) ? r.rate_type : null;
        if (!rateType) e('rate_type', 'Elige el tipo de tasa o «No lo sé».');
        if (rateType && rateType !== 'desconocido' && rate === null && !rateRaw) e('rate', 'Escribe la tasa o elige «No lo sé» en el tipo de tasa.');
        let fees = null;
        if (String(r.fees ?? '').trim()) {
          const fp = money.parseAmount(r.fees, currency);
          if (!fp.ok) e('fees', fp.error);
          else fees = fp.value;
        }
        out.push({ name, kind: r.kind, balance: bal.value, payment: pay.value, rate, rate_type: rateType, fees });
      });
      if (out.length > (q.config.maxRows || 10)) errors.rows = `Registra como máximo ${q.config.maxRows || 10} deudas.`;
      return result(out);
    }
    case 'goals': {
      const none = body.none === '1' || body.none === 'on';
      const rows = bodyArray(body.g).map((r) => r || {});
      form.none = none;
      form.rows = rows;
      const filled = rows.filter((r) => ['name', 'target', 'saved', 'months'].some((k) => String(r[k] ?? '').trim()));
      if (none) {
        if (filled.length) errors.none = 'Marcaste «Aún no tengo metas», pero hay metas escritas. Quita las filas o desmarca la casilla.';
        return result([]);
      }
      if (!filled.length) {
        errors.rows = 'Escribe al menos una meta o marca «Aún no tengo metas».';
        return result([]);
      }
      const out = [];
      rows.forEach((r, i) => {
        if (!filled.includes(r)) return;
        const e = (k, m) => (errors[`g.${i}.${k}`] = m);
        const name = String(r.name || '').trim().slice(0, 60);
        if (!name) e('name', 'Ponle un nombre a la meta.');
        const t = money.parseAmount(r.target, currency);
        if (t.empty) e('target', 'Escribe cuánto necesitas.');
        else if (!t.ok) e('target', t.error);
        else if (new money.D(t.value).lte(0)) e('target', 'El objetivo debe ser mayor que 0.');
        let saved = '0.00';
        if (String(r.saved ?? '').trim()) {
          const s = money.parseAmount(r.saved, currency);
          if (!s.ok) e('saved', s.error);
          else saved = s.value;
        }
        let months = null;
        if (String(r.months ?? '').trim()) {
          if (!/^\d+$/.test(String(r.months).trim()) || Number(r.months) < 1 || Number(r.months) > 600) e('months', 'Escribe un número de meses entre 1 y 600.');
          else months = Number(r.months);
        }
        out.push({ name, target: t.value, saved, months });
      });
      return result(out);
    }
    default:
      throw new Error(`Tipo de pregunta no soportado: ${q.type}`);
  }

  function result(value) {
    const ok = Object.keys(errors).length === 0;
    return { ok, unknown: false, value: ok ? value : null, errors, form };
  }
}

/** Preguntas de ingreso opcional que primero preguntan Sí/No (el contenido vive en la BD). */
const PRESENCE_CODES = new Set(['ingresos_adicionales']);
function asksPresence(q) {
  return q.type === 'money_flow' && (PRESENCE_CODES.has(q.code) || Boolean(q.config && q.config.presence));
}

/** Convierte una respuesta guardada en valores de formulario. */
function toForm(q, a) {
  if (!a) return {};
  if (a.unknown) return { unknown: true };
  const v = a.value;
  switch (q.type) {
    case 'money':
      return { amount: v };
    case 'money_flow':
      if (asksPresence(q) && v && Number(v.amount) === 0) return { has: 'no' };
      return { amount: v && v.amount, period: v && v.period, ...(asksPresence(q) && v ? { has: 'si' } : {}) };
    case 'breakdown':
      return { f: v || {} };
    case 'debts':
    case 'goals':
      return { rows: Array.isArray(v) ? v.map((r) => ({ ...r, months: r.months ?? '' })) : [], none: Array.isArray(v) && v.length === 0 };
    default:
      return { value: v };
  }
}

/** Texto legible de una respuesta (pantallas de revisión). */
function display(q, a, currency) {
  if (!a) return 'Sin responder';
  if (a.skipped) return 'No aplica';
  if (a.unknown) return 'No lo sé';
  const v = a.value;
  const label = (val) => q.options.find((o) => o.value === val)?.label || val;
  switch (q.type) {
    case 'currency':
      return money.CURRENCIES[v]?.label || v;
    case 'single':
      return label(v);
    case 'multi':
      return (v || []).map(label).join(', ');
    case 'money':
      return money.format(v, currency);
    case 'money_flow':
      if (asksPresence(q) && Number(v.amount) === 0) return 'No';
      return `${money.format(v.amount, currency)} · ${calc.PERIODS[v.period]?.label.toLowerCase() || v.period}`;
    case 'integer':
      return `${v}${q.config.unit ? ' ' + q.config.unit : ''}`;
    case 'percent':
      return `${String(v).replace('.', ',')} %`;
    case 'breakdown':
      return q.config.fields.map((f) => `${f.label}: ${money.format(v[f.key], currency)}`).join('; ');
    case 'debts':
      if (!v.length) return 'No tengo deudas';
      return v.map((d) => `${d.name}: saldo ${money.format(d.balance, currency)}, cuota ${money.format(d.payment, currency)}`).join('; ');
    case 'goals':
      if (!v.length) return 'Aún no tengo metas';
      return v.map((g) => `${g.name}: ${money.format(g.target, currency)}`).join('; ');
    default:
      return JSON.stringify(v);
  }
}

module.exports = {
  asksPresence,
  SECTIONS,
  RATE_TYPE_OPTIONS,
  load,
  published,
  findEvaluation,
  latestFinished,
  startEvaluation,
  answers,
  isAnswered,
  isApplicable,
  status,
  nextApplicable,
  firstUnanswered,
  saveAnswer,
  setPosition,
  parseSubmission,
  toForm,
  display,
};
