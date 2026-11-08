'use strict';
// Pantalla de una pregunta (una por pantalla) para el test gratuito y la evaluación profunda.
const { html, raw } = require('../lib/html');
const money = require('../lib/money');
const c = require('./components');
const qs = require('../domain/questionnaire');

const CURRENCY_OPTIONS = Object.entries(money.CURRENCIES).map(([value, v]) => ({ value, label: v.label }));

function optionList(q, form, errors, { multi = false, options = q.options } = {}) {
  const vals = multi ? form.value || [] : [form.value];
  const type = multi ? 'checkbox' : 'radio';
  return html`<div class="options" ${c.describedBy(errors, 'value')}>
      ${options.map(
        (o, i) => html`<label class="option" for="${c.fieldId('value')}${i ? '-' + i : ''}">
          <input
            type="${type}"
            name="value"
            id="${c.fieldId('value')}${i ? '-' + i : ''}"
            value="${o.value}"
            ${vals.includes(o.value) ? raw('checked') : ''}
          />
          <span>${o.label}</span>
        </label>`
      )}
    </div>
    ${c.errorText(errors, 'value')}`;
}

function debtRows(q, form, errors, currency) {
  const rows = form.rows && form.rows.length ? form.rows : [{}];
  const kinds = q.config.kinds || [];
  return html`<div class="rows">
      ${rows.map((r, i) => {
        const k = (f) => `d.${i}.${f}`;
        const n = (f) => `d[${i}][${f}]`;
        return html`<fieldset class="row-card">
          <legend class="visually-hidden">Deuda ${i + 1}</legend>
          <div class="row-head">
            <span>Deuda ${i + 1}</span>
            ${rows.length > 1 ? html`<button class="btn btn-quiet btn-small" type="submit" name="action" value="remove:${i}" formnovalidate>Quitar</button>` : ''}
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="${c.fieldId(k('name'))}">Nombre</label>
              <input class="input" id="${c.fieldId(k('name'))}" name="${n('name')}" value="${r.name || ''}" maxlength="60" ${c.invalid(errors, k('name'))} />
              ${c.errorText(errors, k('name'))}
            </div>
            <div class="field">
              <label for="${c.fieldId(k('kind'))}">Tipo</label>
              ${c.select({ name: n('kind'), errorKey: k('kind'), options: kinds, value: r.kind, errors, placeholder: 'Elige el tipo' })}
            </div>
            <div class="field">
              <label for="${c.fieldId(k('balance'))}">Saldo pendiente</label>
              ${c.moneyInput({ name: n('balance'), errorKey: k('balance'), value: r.balance, currency, errors })}
            </div>
            <div class="field">
              <label for="${c.fieldId(k('payment'))}">Cuota mensual</label>
              ${c.moneyInput({ name: n('payment'), errorKey: k('payment'), value: r.payment, currency, errors })}
            </div>
            <div class="field">
              <label for="${c.fieldId(k('rate'))}">Tasa de interés (%)</label>
              <input class="input input--num" id="${c.fieldId(k('rate'))}" name="${n('rate')}" inputmode="decimal" value="${r.rate || ''}" placeholder="Ej. 36" ${c.invalid(errors, k('rate'))} />
              ${c.errorText(errors, k('rate'))}
            </div>
            <div class="field">
              <label for="${c.fieldId(k('rate_type'))}">Tipo de tasa</label>
              ${c.select({ name: n('rate_type'), errorKey: k('rate_type'), options: qs.RATE_TYPE_OPTIONS, value: r.rate_type, errors, placeholder: 'Elige el tipo de tasa' })}
            </div>
            <div class="field">
              <label for="${c.fieldId(k('fees'))}">Comisiones y seguros al mes (opcional)</label>
              ${c.moneyInput({ name: n('fees'), errorKey: k('fees'), value: r.fees, currency, errors })}
              <span class="hint">Déjalo vacío si no los conoces: no los sumaremos.</span>
            </div>
          </div>
        </fieldset>`;
      })}
    </div>
    ${c.errorText(errors, 'rows')}
    <div class="actions">
      ${rows.length < (q.config.maxRows || 10) ? html`<button class="btn btn-secondary btn-small" type="submit" name="action" value="add" formnovalidate>Agregar otra deuda</button>` : ''}
    </div>
    <div class="unknown">
      <label class="check"><input type="checkbox" name="none" value="1" ${form.none ? raw('checked') : ''} /> <span>No tengo deudas</span></label>
      ${c.errorText(errors, 'none')}
    </div>`;
}

function goalRows(q, form, errors, currency) {
  const rows = form.rows && form.rows.length ? form.rows : [{}];
  return html`<div class="rows">
      ${rows.map((r, i) => {
        const k = (f) => `g.${i}.${f}`;
        const n = (f) => `g[${i}][${f}]`;
        return html`<fieldset class="row-card">
          <legend class="visually-hidden">Meta ${i + 1}</legend>
          <div class="row-head">
            <span>Meta ${i + 1}</span>
            ${rows.length > 1 ? html`<button class="btn btn-quiet btn-small" type="submit" name="action" value="remove:${i}" formnovalidate>Quitar</button>` : ''}
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="${c.fieldId(k('name'))}">Nombre</label>
              <input class="input" id="${c.fieldId(k('name'))}" name="${n('name')}" value="${r.name || ''}" maxlength="60" placeholder="Ej. Fondo para estudios" ${c.invalid(errors, k('name'))} />
              ${c.errorText(errors, k('name'))}
            </div>
            <div class="field">
              <label for="${c.fieldId(k('target'))}">Cuánto necesitas</label>
              ${c.moneyInput({ name: n('target'), errorKey: k('target'), value: r.target, currency, errors })}
            </div>
            <div class="field">
              <label for="${c.fieldId(k('saved'))}">Ya ahorrado para ella</label>
              ${c.moneyInput({ name: n('saved'), errorKey: k('saved'), value: r.saved, currency, errors })}
            </div>
            <div class="field">
              <label for="${c.fieldId(k('months'))}">En cuántos meses (opcional)</label>
              <input class="input input--num" id="${c.fieldId(k('months'))}" name="${n('months')}" inputmode="numeric" value="${r.months ?? ''}" ${c.invalid(errors, k('months'))} />
              ${c.errorText(errors, k('months'))}
            </div>
          </div>
        </fieldset>`;
      })}
    </div>
    ${c.errorText(errors, 'rows')}
    <div class="actions">
      ${rows.length < (q.config.maxRows || 5) ? html`<button class="btn btn-secondary btn-small" type="submit" name="action" value="add" formnovalidate>Agregar otra meta</button>` : ''}
    </div>
    <div class="unknown">
      <label class="check"><input type="checkbox" name="none" value="1" ${form.none ? raw('checked') : ''} /> <span>Aún no tengo metas definidas</span></label>
      ${c.errorText(errors, 'none')}
    </div>`;
}

function inputFor(q, form, errors, currency) {
  switch (q.type) {
    case 'currency':
      return html`<div class="field">
        <label for="${c.fieldId('value')}" class="visually-hidden">Moneda</label>
        ${c.select({ name: 'value', options: CURRENCY_OPTIONS, value: form.value || '', errors, placeholder: 'Elige tu moneda' })}
      </div>`;
    case 'single':
      return optionList(q, form, errors);
    case 'multi':
      return optionList(q, form, errors, { multi: true });
    case 'money':
      return html`<div class="field">
        <label for="${c.fieldId('amount')}" class="visually-hidden">Importe en ${currency}</label>
        ${c.moneyInput({ name: 'amount', value: form.amount, currency, errors })}
      </div>`;
    case 'money_flow':
      return html`<div class="pair">
        <div class="field">
          <label for="${c.fieldId('amount')}">Importe</label>
          ${c.moneyInput({ name: 'amount', value: form.amount, currency, errors })}
        </div>
        <div class="field">
          <label for="${c.fieldId('period')}">Cada cuánto</label>
          ${c.select({ name: 'period', options: c.periodOptions(q.config.periods || ['mensual']), value: form.period || 'mensual', errors })}
        </div>
      </div>`;
    case 'integer':
      return html`<div class="field">
        <label for="${c.fieldId('value')}" class="visually-hidden">Número${q.config.unit ? ' de ' + q.config.unit : ''}</label>
        <input class="input input--num input--short" id="${c.fieldId('value')}" name="value" inputmode="numeric" value="${form.value ?? ''}" ${c.describedBy(errors, 'value')} ${c.invalid(errors, 'value')} />
        ${c.errorText(errors, 'value')}
      </div>`;
    case 'percent':
      return html`<div class="field">
        <label for="${c.fieldId('value')}" class="visually-hidden">Porcentaje</label>
        <div class="money money--suffix input--short">
          <input class="input input--num" id="${c.fieldId('value')}" name="value" inputmode="decimal" value="${form.value ?? ''}" ${c.describedBy(errors, 'value')} ${c.invalid(errors, 'value')} />
          <span class="prefix" aria-hidden="true">%</span>
        </div>
        ${c.errorText(errors, 'value')}
      </div>`;
    case 'breakdown':
      return html`<div class="breakdown">
        ${q.config.fields.map(
          (f) => html`<div class="field">
            <label for="${c.fieldId('f.' + f.key)}">${f.label}</label>
            ${c.moneyInput({ name: `f[${f.key}]`, errorKey: `f.${f.key}`, value: (form.f || {})[f.key], currency, errors })}
          </div>`
        )}
      </div>`;
    case 'debts':
      return debtRows(q, form, errors, currency);
    case 'goals':
      return goalRows(q, form, errors, currency);
    default:
      return html`<p>Tipo de pregunta no disponible.</p>`;
  }
}

/**
 * @param ctx contexto de la vista
 * @param o { base, q, qn, map, form, errors, currency, previous, position, stateList, isLast }
 */
function questionPage(ctx, o) {
  const { q, form = {}, errors = {}, currency } = o;
  const st = o.stateList;
  const section = qs.SECTIONS[q.section] || q.section;
  const helpId = q.help ? 'q-help' : null;
  const isGroup = ['single', 'multi'].includes(q.type);
  const Tag = isGroup ? 'fieldset' : 'div';
  return html`<div class="q-head">
      ${c.ticks(st.ticks, { label: `Pregunta ${q.position} de ${st.total}` })}
      <div class="progress-meta"><span>Pregunta ${q.position} de ${st.total}</span><span>${st.answered} respondidas</span></div>
    </div>
    ${c.errorSummary(errors)}
    <form method="post" action="${o.base}/pregunta/${q.position}${o.actionSuffix || ''}" data-code="${q.code}" novalidate>
      ${c.csrfField(ctx)}
      ${raw(`<${Tag} class="q-body"${helpId ? ` aria-describedby="${helpId}"` : ''}>`)}
      ${isGroup
        ? html`<legend><p class="q-section">${section}</p><h1 class="q-title">${q.prompt}</h1></legend>`
        : html`<p class="q-section">${section}</p>
            <h1 class="q-title" id="q-title">${q.prompt}</h1>`}
      ${q.help ? html`<p class="q-help" id="q-help">${q.help}</p>` : ''}
      ${o.previous
        ? html`<div class="previous">
            <span>Antes respondiste: <strong>${o.previous.text}</strong></span>
            <button class="btn btn-secondary btn-small" type="submit" name="action" value="use_previous" formnovalidate>Usar esta respuesta</button>
          </div>`
        : ''}
      ${o.prefilledNotice ? html`<div class="note note--warn" role="status"><strong>Revisa la respuesta anterior.</strong> Se guardará cuando pulses «Siguiente».</div>` : ''}
      ${inputFor(q, form, errors, currency)}
      ${q.allowUnknown && !['debts', 'goals'].includes(q.type)
        ? html`<div class="unknown"><label class="check"><input type="checkbox" name="unknown" value="1" ${form.unknown ? raw('checked') : ''} data-unknown /> <span>No lo sé</span></label></div>`
        : ''}
      ${raw(`</${Tag}>`)}
      <div class="actions actions--split">
        ${q.position > 1 || o.prevHref
          ? html`<button class="btn btn-secondary" type="submit" name="action" value="prev" formnovalidate>Anterior</button>`
          : html`<span></span>`}
        <button class="btn btn-primary" type="submit" name="action" value="next">${o.isLast ? 'Revisar respuestas' : 'Siguiente'}</button>
      </div>
    </form>
    <p class="saved-note">${o.savedNote || 'Cada respuesta se guarda al avanzar. Puedes cerrar y continuar después en este dispositivo.'}</p>`;
}

module.exports = { questionPage, CURRENCY_OPTIONS };
