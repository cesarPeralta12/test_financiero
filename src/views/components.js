'use strict';
const { html, raw } = require('../lib/html');
const money = require('../lib/money');
const calc = require('../domain/calc');

const csrfField = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.csrf}" />`;

/** Regla de marcas: una marca por pregunta (o por día). */
function ticks(states, { label, days = false } = {}) {
  return html`<ol class="ticks${days ? ' ticks--days' : ''}" aria-hidden="true">
      ${states.map((s, i) => html`<li class="${s}${days && (i + 1) % 7 === 0 ? ' week' : ''}"></li>`)}
    </ol>
    ${label ? html`<p class="visually-hidden">${label}</p>` : ''}`;
}

function errorSummary(errors, labels = {}) {
  const keys = Object.keys(errors || {});
  if (!keys.length) return '';
  return html`<div class="error-summary" role="alert" tabindex="-1" data-autofocus>
    <h2>Revisa ${keys.length === 1 ? 'este dato' : 'estos datos'}</h2>
    <ul>
      ${keys.map((k) => html`<li><a href="#${fieldId(k)}">${labels[k] ? `${labels[k]}: ` : ''}${errors[k]}</a></li>`)}
    </ul>
  </div>`;
}

function fieldId(key) {
  return 'f-' + String(key).replace(/[^a-zA-Z0-9]+/g, '-');
}

function errorText(errors, key) {
  return errors && errors[key] ? html`<span class="error-text" id="${fieldId(key)}-err">${errors[key]}</span>` : '';
}

function describedBy(errors, key, hintId = null) {
  const ids = [hintId, errors && errors[key] ? `${fieldId(key)}-err` : null].filter(Boolean);
  return ids.length ? raw(`aria-describedby="${ids.join(' ')}"`) : '';
}
function invalid(errors, key) {
  return errors && errors[key] ? raw('aria-invalid="true"') : '';
}

function textField({ name, label, value = '', type = 'text', errors = {}, hint = null, autocomplete = null, required = false, inputmode = null, maxlength = null }) {
  const id = fieldId(name);
  const hintId = hint ? `${id}-hint` : null;
  return html`<div class="field">
    <label for="${id}">${label}</label>
    ${hint ? html`<span class="hint" id="${hintId}">${hint}</span>` : ''}
    <input
      class="input"
      id="${id}"
      name="${name}"
      type="${type}"
      value="${value ?? ''}"
      ${autocomplete ? raw(`autocomplete="${autocomplete}"`) : ''}
      ${inputmode ? raw(`inputmode="${inputmode}"`) : ''}
      ${maxlength ? raw(`maxlength="${maxlength}"`) : ''}
      ${required ? raw('required') : ''}
      ${describedBy(errors, name, hintId)}
      ${invalid(errors, name)}
    />
    ${errorText(errors, name)}
  </div>`;
}

function moneyInput({ name, id, value, currency, errors = {}, errorKey, labelledBy = null, ariaLabel = null }) {
  const key = errorKey || name;
  return html`<div class="money">
      <span class="prefix" aria-hidden="true">${currency}</span>
      <input
        class="input input--num"
        id="${id || fieldId(key)}"
        name="${name}"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        value="${value ?? ''}"
        ${labelledBy ? raw(`aria-labelledby="${labelledBy}"`) : ''}
        ${ariaLabel ? raw(`aria-label="${ariaLabel} en ${currency}"`) : ''}
        ${describedBy(errors, key)}
        ${invalid(errors, key)}
      />
    </div>
    ${errorText(errors, key)}`;
}

function select({ name, id, options, value, errors = {}, errorKey, ariaLabel = null, placeholder = null }) {
  const key = errorKey || name;
  return html`<select class="input" id="${id || fieldId(key)}" name="${name}" ${ariaLabel ? raw(`aria-label="${ariaLabel}"`) : ''} ${describedBy(errors, key)} ${invalid(errors, key)}>
      ${placeholder ? html`<option value="">${placeholder}</option>` : ''}
      ${options.map((o) => html`<option value="${o.value}" ${String(value) === String(o.value) ? raw('selected') : ''}>${o.label}</option>`)}
    </select>
    ${errorText(errors, key)}`;
}

/** Etiqueta de procedencia de una cifra: dato ingresado, cálculo o supuesto. */
function src(kind) {
  const labels = { dato: 'Tu dato', calculo: 'Cálculo', supuesto: 'Supuesto' };
  return html`<span class="src src--${kind}">${labels[kind]}</span>`;
}

function legend() {
  return html`<div class="legend" aria-label="Procedencia de las cifras">${src('dato')}${src('calculo')}${src('supuesto')}</div>`;
}

function fmt(v, currency, opts) {
  return money.format(v, currency, opts);
}

function durationText(days) {
  if (!days) return 'sin vencimiento';
  if (days % 365 === 0) return days === 365 ? '12 meses' : `${days / 365} años`;
  if (days % 30 === 0) return `${days / 30} meses`;
  return `${days} días`;
}

const GRANT_LABELS = {
  evaluacion_profunda: 'Evaluación profunda',
  plan_maestro: 'Plan Maestro',
  acompanamiento: 'Coach y calculadora',
};

function offerCard(ctx, p, { featured = false, owned = false, cta = 'Continuar al pago', note = null } = {}) {
  const grants = JSON.parse(p.grants_json);
  const includes = JSON.parse(p.includes_json);
  return html`<article class="offer${featured ? ' offer--featured' : ''}" aria-labelledby="offer-${p.code}">
    <div class="offer-head">
      <h3 id="offer-${p.code}">${p.name}</h3>
      <span class="price">${money.formatCents(p.price_cents, p.currency)}<small>${p.currency}, pago único</small></span>
    </div>
    <p class="muted">${p.summary}</p>
    <ul class="ticklist">
      ${includes.map((i) => html`<li>${i}</li>`)}
    </ul>
    <div class="terms">
      <dl>
        ${grants.map((g) => html`<dt>${GRANT_LABELS[g.code]}</dt><dd>Acceso durante ${durationText(g.days)}</dd>`)}
      </dl>
    </div>
    ${note ? html`<p class="small muted offer-note">${note}</p>` : ''}
    <div class="actions">
      ${owned
        ? html`<span class="status-pill">Ya lo tienes</span>`
        : html`<a class="btn ${featured ? 'btn-primary' : 'btn-secondary'}" href="/comprar/${p.code}">${cta}</a>`}
    </div>
  </article>`;
}

function badge(text, tone = '') {
  return html`<span class="badge${tone ? ' badge--' + tone : ''}">${text}</span>`;
}

const ORDER_STATUS = {
  pendiente: ['Pendiente', 'warn'],
  pagada: ['Pagada', 'ok'],
  fallida: ['Fallida', 'bad'],
  cancelada: ['Cancelada', ''],
  reembolsada: ['Reembolsada', ''],
};

function dateEs(iso, { time = false } = {}) {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(iso + 'T12:00:00Z') : new Date(iso);
  return new Intl.DateTimeFormat('es', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'UTC',
  }).format(d);
}
function dateShort(iso) {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(iso + 'T12:00:00Z') : new Date(iso);
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
}

function monthsText(n) {
  if (n === null || n === undefined) return '—';
  if (n === 0) return 'ya cumplida';
  if (n < 12) return `${n} ${n === 1 ? 'mes' : 'meses'}`;
  const y = Math.floor(n / 12);
  const m = n % 12;
  return `${y} ${y === 1 ? 'año' : 'años'}${m ? ` y ${m} ${m === 1 ? 'mes' : 'meses'}` : ''}`;
}

function periodOptions(periods) {
  return periods.map((p) => ({ value: p, label: calc.PERIODS[p].label }));
}

module.exports = {
  csrfField,
  ticks,
  errorSummary,
  errorText,
  fieldId,
  describedBy,
  invalid,
  textField,
  moneyInput,
  select,
  src,
  legend,
  fmt,
  offerCard,
  badge,
  ORDER_STATUS,
  GRANT_LABELS,
  durationText,
  dateEs,
  dateShort,
  monthsText,
  periodOptions,
};
