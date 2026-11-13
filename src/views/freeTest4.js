'use strict';
// Pantallas del test gratuito V4 (FREE_24_V4_ES) y de su resultado (RESULT_FREE_V4_ES).
// Botones grandes, una pregunta por pantalla, «Otro» abre una frase corta y los montos
// usan campos numéricos. El resultado sigue los siete bloques del documento de
// correcciones y termina con una sola oferta. Sin puntos, premios ni niveles.
const { html, raw } = require('../lib/html');
const c = require('./components');
const cat = require('../domain/free/catalog4');
const moneyLib = require('../lib/money');

const curLabel = (cur) => (cur === 'BOB' ? 'Bs' : cur || '');
const checked = (cond) => (cond ? raw('checked') : '');

// ───────── Controles ─────────
function field(label, inner, hint = null) {
  return html`<div class="field"><span class="small muted">${label}</span>${inner}${hint ? html`<span class="hint">${hint}</span>` : ''}</div>`;
}
function amountInput(name, value, cur, placeholder = '') {
  return html`<div class="money-field"><span class="money-cur">${curLabel(cur)}</span><input class="input input--num" name="${name}" id="${name}" inputmode="decimal" autocomplete="off" placeholder="${placeholder}" value="${value || ''}" /></div>`;
}
/** Monto o rango (campos vacíos: vacío nunca es cero). */
function moneyFields(form, cur, p = '', label = 'Monto aproximado') {
  return html`${field(label, amountInput(`${p}amount`, form[`${p}amount`], cur))}
    <details class="qf-range" ${form[`${p}min`] || form[`${p}max`] ? raw('open') : ''}><summary class="small">Prefiero dar un rango</summary>
      <div class="range-row">${amountInput(`${p}min`, form[`${p}min`], cur, 'Desde')}<span class="muted">a</span>${amountInput(`${p}max`, form[`${p}max`], cur, 'Hasta')}</div>
    </details>`;
}
function buttons(name, options, values, { multi = false, exclusive = [], max = null, pills = false } = {}) {
  const set = new Set([].concat(values || []));
  const type = multi ? 'checkbox' : 'radio';
  return html`<div class="${pills ? 'pills' : 'options'}" ${max ? raw(`data-max="${max}"`) : ''}>
    ${options.map((o, i) => html`<label class="${pills ? 'pill' : 'option'}" for="${name}-${i}"><input type="${type}" name="${name}" id="${name}-${i}" value="${o.code}" ${checked(set.has(o.code))} ${exclusive.includes(o.code) ? raw('data-exclusive') : ''} /><span class="opt-label">${o.label}</span></label>`)}
  </div>`;
}
function otherField(form, label) {
  return html`<div class="qf-if" data-show-if="codes=OTHER">${field(label || '¿Cuál?', html`<input class="input" name="other" id="other" maxlength="${cat.OTHER_MAX}" placeholder="Una frase corta" value="${form.other || ''}" />`, `Hasta ${cat.OTHER_MAX} caracteres.`)}</div>`;
}
function specials(q, form) {
  const list = q.options.filter((o) => cat.SPECIAL_CODES.includes(o.code));
  return html`<div class="unknown">${list.map((o, i) => html`<label class="pill pill--ghost" for="special-${i}"><input type="radio" name="special" id="special-${i}" value="${o.code}" ${checked(form.special === o.code)} /><span>${o.label}</span></label>`)}</div>`;
}

function input(q, form = {}, errors = {}) {
  const cfg = q.config || {};
  const cur = q.currency;
  const opts = q.options.filter((o) => !cat.SPECIAL_CODES.includes(o.code));
  let body;
  switch (q.type) {
    case 'locale': {
      const suggest = JSON.stringify(cfg.suggest || {});
      body = html`${field('País', c.select({ name: 'country', options: [{ value: '', label: 'Elige tu país' }, ...cfg.countries.map((x) => ({ value: x.code, label: x.label }))], value: form.country || '', errors }))}
        <div data-currency-suggest="${suggest}">${field('Moneda', c.select({ name: 'currency', options: [{ value: '', label: 'Elige tu moneda' }, ...cfg.currencies.map((x) => ({ value: x.code, label: x.label }))], value: form.currency || '', errors }), 'Si cambias la moneda, tendrás que revisar los montos. No convertimos cantidades.')}</div>`;
      break;
    }
    case 'choice': {
      const hint = cfg.multi ? (cfg.max ? `Puedes marcar hasta ${cfg.max === 2 ? 'dos' : 'tres'} opciones.` : 'Puedes marcar varias opciones.') : 'Marca una opción.';
      if (cfg.focus) {
        body = html`${field('¿Qué actividad quieres mejorar?', buttons('focus', cfg.focus, form.focus, { pills: true }))}
          ${Object.entries(cfg.focus_options).map(([k, list]) => html`<div class="qf-if" data-show-if="focus=${k}">${buttons('codes', list, form.focus === k ? form.codes : [])}</div>`)}
          ${otherField(form, cfg.other_label)}`;
      } else {
        // La aclaración se omite si la ayuda de la pregunta ya dice cuántas marcar.
        body = html`${/marca/i.test(q.help || '') ? '' : html`<p class="small muted qf-hint">${hint}</p>`}
          ${buttons('codes', opts, form.codes, { multi: cfg.multi, exclusive: cfg.exclusive || [], max: cfg.max })}
          ${cfg.other ? otherField(form, cfg.other_label) : ''}
          ${cfg.with_total ? html`<div class="qf-total" data-hide-if="codes=NONE">${moneyFields(form, cur, 'total_', '¿Cuánto debes en total? (opcional)')}</div>` : ''}`;
      }
      break;
    }
    case 'goal':
      body = html`${buttons('code', opts, form.code)}
        <div class="qf-if" data-show-if="code=OTHER">${field(cfg.other_label || '¿Cuál?', html`<input class="input" name="other" maxlength="${cat.OTHER_MAX}" placeholder="Una frase corta" value="${form.other || ''}" />`)}</div>
        ${field('¿En cuánto tiempo te gustaría avanzar?', buttons('horizon', cfg.horizons, form.horizon, { pills: true }))}`;
      break;
    case 'money':
      body = moneyFields(form, cur, '', cfg.period === 'MONTH' ? 'Monto aproximado al mes' : 'Monto aproximado');
      break;
    case 'debt_status':
      body = html`${buttons('status', opts, form.status)}
        <div class="qf-if" data-show-if="status=DUE">${moneyFields(form, cur, '', '¿Cuánto debes pagar este mes?')}
          ${field('¿Hay un monto extra por pagos atrasados? (opcional)', amountInput('extra_amount', form.extra_amount, cur), 'No lo sumes al monto anterior.')}</div>`;
      break;
    case 'budget':
      body = html`${buttons('availability', opts, form.availability)}
        <div class="qf-if" data-show-if="availability=YES,MAYBE">${moneyFields(form, cur, '', '¿Cuánto podrías usar? (opcional)')}</div>`;
      break;
    default:
      body = html`<p class="muted">Pregunta no disponible.</p>`;
  }
  return html`<div class="v3-input v4-input" data-type="${q.type}">${body}</div>${specials(q, form)}${c.errorText(errors, 'value')}`;
}

// ───────── Resultado ─────────
function money(cur, v) {
  if (v === null || v === undefined) return 'Dato pendiente';
  return `${Number(v) < 0 ? '−' : ''}${curLabel(cur)} ${cat.fmtNum(v)}`;
}
function evidence(refs, answers) {
  const items = (refs || []).map((r) => String(r).slice(0, 3)).filter((r, i, a) => a.indexOf(r) === i && answers[r]);
  if (!items.length) return '';
  return html`<details class="evidence"><summary>Ver en qué respuestas se basa</summary><ul>
    ${items.map((r) => html`<li>Pregunta ${Number(r.slice(1))}: ${cat.answerText(answers[r].variant_id, answers[r])}</li>`)}
  </ul></details>`;
}
function block(kicker, title, body, id) {
  return html`<section class="section dx-block" aria-labelledby="h-${id}"><p class="kicker">${kicker}</p><h2 id="h-${id}">${title}</h2>${body}</section>`;
}
/** Valor declarado de una pregunta de dinero (monto, rango o «Dato pendiente»). */
function declared(answers, slot) {
  const a = answers[slot];
  if (!a || a.status !== 'answered') return 'Dato pendiente';
  const v = a.value;
  return v.amount !== null ? cat.fmtMoney(v) : `${cat.fmtMoney(v)}`;
}
function duesText(answers, cur) {
  const q10 = answers.Q10;
  const q11 = answers.Q11;
  if (q11 && q11.status === 'answered' && q11.value.codes.includes('NONE')) return money(cur, '0');
  if (!q10 || q10.status !== 'answered') return 'Dato pendiente';
  if (q10.value.status === 'NO' || q10.value.status === 'NO_DUE') return money(cur, '0');
  return cat.fmtMoney(q10.value.monthly_due);
}

function photo(r, answers) {
  const cur = r.currency;
  const bal = r.metrics.find((m) => m.id === 'monthly_balance');
  const range = r.balance_range;
  const balText = bal && bal.value !== null ? money(cur, bal.value) : range ? `Entre ${money(cur, range.min)} y ${money(cur, range.max)}` : 'No podemos calcularlo aún';
  const otherOk = answers.Q09 && answers.Q09.status === 'answered';
  return html`<div class="table-wrap"><table class="calc-table photo-table"><tbody>
      <tr><th scope="row">Ingreso mensual</th><td class="num">${declared(answers, 'Q06')}</td></tr>
      <tr><th scope="row">Gastos básicos</th><td class="num">${declared(answers, 'Q08')}</td></tr>
      <tr><th scope="row">Otros gastos</th><td class="num">${otherOk ? declared(answers, 'Q09') : 'Dato pendiente'}</td></tr>
      <tr><th scope="row">Cuotas de deuda del mes</th><td class="num">${duesText(answers, cur)}</td></tr>
      <tr class="is-total"><th scope="row">Saldo estimado al mes</th><td class="num"><strong>${balText}</strong></td></tr>
    </tbody></table></div>
    <p class="small muted">Es una estimación con las respuestas que declaraste: ingreso − gastos básicos − otros gastos − cuotas. ${!bal || bal.value === null ? 'Si falta un dato, no lo reemplazamos por cero.' : ''}</p>`;
}

const FREE_VS_FULL = [
  ['Resumen estimado de tu flujo mensual', 'Revisión detallada de ingresos, gastos, deudas y costos, con escenarios'],
  ['Una prioridad financiera inicial', 'Prioridades ordenadas con sus criterios y riesgos'],
  ['Una oportunidad para explorar', 'Comparación de oportunidades según tu tiempo, recursos y demanda'],
  ['Un primer paso práctico', 'Un plan de acciones con seguimiento de tu avance'],
  ['Los datos que todavía faltan', 'Validación de tus datos y supuestos, con coach por chat y control de gastos'],
];

function offerBlock(r, { products = [], owned = {}, user = null }) {
  if (r.minor) {
    return html`<section class="section offer-pm"><p class="kicker">Siguiente paso</p><h2>Comparte este resultado con un adulto de confianza</h2><p class="muted">Como eres menor de 18 años, no te ofrecemos compras. Este resultado es tuyo y puedes guardarlo.</p></section>`;
  }
  const pkg = products.find((p) => p.code === 'paquete');
  const has = owned.plan_maestro || owned.evaluacion_profunda;
  return html`<section class="section offer-pm" aria-labelledby="h-oferta">
    <p class="kicker">Siguiente paso</p>
    <h2 id="h-oferta">Este es tu punto de partida. Ahora podemos construir tu camino</h2>
    <p class="lead">Con tus respuestas encontramos una prioridad y un primer paso. Pero todavía hay decisiones importantes que no podemos resolver con un test breve. El diagnóstico completo profundiza en tus números, riesgos y oportunidades para ayudarte a elegir qué hacer primero y cómo medir tus avances.</p>
    <div class="table-wrap"><table class="offer-table">
      <thead><tr><th scope="col">Test gratuito: recibes ahora</th><th scope="col">Diagnóstico completo</th></tr></thead>
      <tbody>${FREE_VS_FULL.map(([a, b]) => html`<tr><td>${a}</td><td>${b}</td></tr>`)}</tbody>
    </table></div>
    ${has
      ? html`<div class="actions"><a class="btn btn-primary btn-lg" href="/evaluacion">Continuar con mi diagnóstico completo</a></div>`
      : html`<div class="offer-cta">
          <a class="btn btn-primary btn-lg" href="/comprar/paquete">Quiero mi diagnóstico completo</a>
          <a class="btn btn-quiet" href="#h-foto">Seguir con mi resultado gratis</a>
          <p class="small muted">Antes de pagar verás qué incluye, el precio y las condiciones.${pkg ? html` Precio: ${moneyLib.formatCents(pkg.price_cents, pkg.currency).replace(/[.,]00$/, '')} ${pkg.currency}, pago único.` : ''}${!user ? ' Te pediremos crear una cuenta para guardar tu diagnóstico.' : ''}</p>
        </div>`}
    <p class="small muted">Las oportunidades deben comprobarse. No se garantizan ingresos ni rentabilidades.</p>
  </section>`;
}

function resultPage(ctx, { result: r, answers, user, products, owned, completedAt }) {
  const o = r.opportunity;
  const f = r.first_action;
  const goal = r.goal;
  return html`<div class="dx dx4">
    <div class="label-line"><span class="status-pill">Tu resultado gratuito</span><span class="small faint">${c.dateEs(completedAt)}</span></div>
    <h1 class="section dx-title">Ya tenemos una primera imagen de tu situación</h1>
    <p class="lead">${goal && goal.code !== 'HELP' ? `Tu prioridad parece ser: ${goal.text.toLowerCase()}.` : 'Podemos ayudarte a elegir tu prioridad.'}</p>

    ${block('Foto de hoy', 'Cómo se mueve tu dinero cada mes', photo(r, answers), 'foto')}

    ${block('Lo más importante', r.conclusion.title, html`<p>${r.conclusion.interpretation}</p>${evidence(r.conclusion.evidence_refs, answers)}
      ${r.insights.slice(0, 2).map((i) => html`<article class="dx-insight"><h3>${i.title}</h3><p>${i.meaning}</p><p class="muted">${i.implication}</p></article>`)}
      ${r.contradictions && r.contradictions.length ? html`<div class="note note--warn">${r.contradictions.map((x) => html`<p>${x.text}</p>`)}</div>` : ''}`, 'hallazgo')}

    ${o
      ? block('Una oportunidad que vale explorar', o.title, html`<p>${o.hypothesis}</p>
        <p class="small"><strong>Cómo comprobarlo:</strong> ${o.test}</p>
        <p class="small muted">Esta posibilidad todavía necesita validarse: conocer personas no significa que comprarán.</p>${evidence(o.evidence_refs, answers)}`, 'oportunidad')
      : ''}

    ${block('Tu primer paso', 'Algo que puedes hacer esta semana', html`<article class="action-card"><p>${f.instruction}</p>
      <p class="meta"><strong>Por qué ahora:</strong> ${f.why_now}</p>
      <p class="meta"><strong>Lo habrás completado cuando:</strong> ${f.done_when}</p>
      <p class="meta small muted">${f.resource_fit} ${f.risk}</p></article>`, 'paso')}

    ${r.missing_data.length
      ? block('Lo que todavía falta saber', '¿Qué descubrirías con el diagnóstico completo?', html`<ul class="findings findings--missing">${r.missing_data.map((m) => html`<li><strong>${m.question}</strong> <span class="muted">${m.why}</span></li>`)}</ul>`, 'falta')
      : ''}

    ${!user ? html`<div class="next-step section"><p class="kicker">Guarda tu resultado</p><p class="muted">Crea una cuenta para no perderlo. Si no, tus respuestas se conservan unos días desde tu última actividad.</p><div class="actions"><a class="btn btn-quiet" href="/registro">Crear mi cuenta</a><a class="btn btn-quiet" href="/entrar?siguiente=/resultado">Ya tengo cuenta</a></div></div>` : ''}

    ${offerBlock(r, { products, owned, user })}
    <p class="small muted section">¿Algo no coincide? <a href="/test/revision">Corrige tus respuestas</a> y generaremos un resultado nuevo.</p>
  </div>`;
}

module.exports = { input, resultPage };
