'use strict';
// Pantallas del test gratuito V3 (FREE_25_V3_ES) y de su diagnóstico (RESULT_FREE_V3_ES).
// Una columna, lectura breve, cálculos y evidencia desplegables, y la oferta completa
// del Plan Maestro (14 componentes + 2 herramientas). Sin XP ni gamificación.
const { html, raw } = require('../lib/html');
const c = require('./components');
const cat = require('../domain/free/catalog3');
const moneyLib = require('../lib/money');

const curLabel = (cur) => (cur === 'BOB' ? 'Bs' : cur || '');
const checked = (cond) => (cond ? raw('checked') : '');

// ───────── Controles ─────────
function radios(name, options, value, { cls = 'options', pill = false } = {}) {
  return html`<div class="${cls}">
    ${options.map((o, i) => html`<label class="${pill ? 'pill' : 'option'}" for="${name}-${i}"><input type="radio" name="${name}" id="${name}-${i}" value="${o.code}" ${checked(value === o.code)} /><span class="opt-label">${o.label}</span></label>`)}
  </div>`;
}
function checks(name, options, values = [], { exclusive = [] } = {}) {
  const set = new Set(Array.isArray(values) ? values : [values]);
  return html`<div class="options">
    ${options.map((o, i) => html`<label class="option" for="${name}-${i}"><input type="checkbox" name="${name}" id="${name}-${i}" value="${o.code}" ${checked(set.has(o.code))} ${exclusive.includes(o.code) ? raw('data-exclusive') : ''} /><span class="opt-label">${o.label}</span></label>`)}
  </div>`;
}
function field(label, inner, hint = null) {
  return html`<div class="field"><span class="small muted">${label}</span>${inner}${hint ? html`<span class="hint">${hint}</span>` : ''}</div>`;
}
function textInput(name, value, { placeholder = '', max = 300, area = false } = {}) {
  return area
    ? html`<textarea class="input" name="${name}" id="${name}" rows="3" maxlength="${max}" placeholder="${placeholder}">${value || ''}</textarea>`
    : html`<input class="input" name="${name}" id="${name}" maxlength="${max}" placeholder="${placeholder}" value="${value || ''}" />`;
}
function amountInput(name, value, cur, placeholder = '0') {
  return html`<div class="money-field"><span class="money-cur">${curLabel(cur)}</span><input class="input input--num" name="${name}" id="${name}" inputmode="decimal" autocomplete="off" placeholder="${placeholder}" value="${value || ''}" /></div>`;
}
/** Monto o rango. `p` prefija los nombres (p. ej. extra_). */
function moneyFields(form, cur, p = '', { label = 'Monto aproximado' } = {}) {
  return html`${field(label, amountInput(`${p}amount`, form[`${p}amount`], cur))}
    <details class="qf-range" ${form[`${p}min`] || form[`${p}max`] ? raw('open') : ''}><summary class="small">Prefiero dar un rango</summary>
      <div class="range-row">${amountInput(`${p}min`, form[`${p}min`], cur, 'mínimo')}<span class="muted">a</span>${amountInput(`${p}max`, form[`${p}max`], cur, 'máximo')}</div>
    </details>`;
}
function specials(form) {
  return html`<div class="unknown">${cat.SPECIAL.map((o, i) => html`<label class="pill pill--ghost" for="special-${i}"><input type="radio" name="special" id="special-${i}" value="${o.code}" ${checked(form.special === o.code)} /><span>${o.label}</span></label>`)}</div>`;
}

/** Controles de una pregunta V3 según su tipo. */
function input(q, form = {}, errors = {}) {
  const cfg = q.config || {};
  const cur = q.currency;
  const opts = q.options.filter((o) => !cat.SPECIAL_CODES.includes(o.code));
  let body;
  switch (q.type) {
    case 'locale':
      body = html`${field('País', c.select({ name: 'country', options: [{ value: '', label: 'Elige tu país' }, ...cfg.countries.map((x) => ({ value: x.code, label: x.label }))], value: form.country || '', errors }))}
        ${field('Moneda', c.select({ name: 'currency', options: [{ value: '', label: 'Elige tu moneda' }, ...cfg.currencies.map((x) => ({ value: x.code, label: x.label }))], value: form.currency || '', errors }), cur ? 'Si cambias la moneda, te pediremos de nuevo los montos, sin convertirlos.' : null)}`;
      break;
    case 'enum':
      body = radios('code', opts, form.code);
      break;
    case 'enum_detail':
      body = html`${radios('code', opts, form.code)}${field(cfg.detail_label || 'Detalle (opcional)', textInput('detail', form.detail, { max: cfg.detail_max || 300, area: true }))}`;
      break;
    case 'activity':
      body = html`${radios('route', opts, form.route)}${field('Tu puesto o actividad, en una frase', textInput('occupation', form.occupation, { max: 180, placeholder: 'Ej.: técnico de refrigeración en una empresa' }))}`;
      break;
    case 'goal':
      body = html`${radios('priority', opts, form.priority)}
        ${field('Cuéntalo en tus palabras (opcional)', textInput('description', form.description, { max: 500, area: true, placeholder: 'Ej.: ganar Bs 1.500 más al mes en seis meses' }))}
        <details class="qf-range" ${form.amount ? raw('open') : ''}><summary class="small">Quiero ponerle un monto y un plazo</summary>
          ${field('Monto', amountInput('amount', form.amount, cur))}
          ${field('Ese monto es…', c.select({ name: 'target_kind', options: [{ value: '', label: 'Elige una opción' }, ...cfg.target_kinds.map((x) => ({ value: x.code, label: x.label }))], value: form.target_kind || '', errors }))}
          ${field('Plazo en meses', html`<input class="input input--num input--short" name="horizon_months" inputmode="numeric" value="${form.horizon_months || ''}" />`)}
        </details>`;
      break;
    case 'money':
      body = html`${moneyFields(form, cur, '', { label: cfg.period === 'MONTH' ? 'Monto aproximado al mes' : 'Monto aproximado' })}
        ${cfg.breakdown ? field('Si tienes varias fuentes, cuéntanos cuáles (opcional)', textInput('breakdown', form.breakdown, { max: 300, placeholder: 'Ej.: sueldo y trabajos particulares' })) : ''}
        ${cfg.available_now ? field('¿Está disponible?', radios('available_now', cfg.available_now, form.available_now, { cls: 'pills', pill: true })) : ''}`;
      break;
    case 'debt_payment':
      body = html`${radios('presence', cfg.presence, form.presence, { cls: 'pills', pill: true })}
        <div class="qf-if" data-show-if="presence=YES">${moneyFields(form, cur, '', { label: cfg.amount_label || 'Cuotas de este mes' })}
        ${field('Pagos atrasados para ponerte al día (opcional)', amountInput('extra_amount', form.extra_amount, cur))}</div>`;
      break;
    case 'debt_inventory':
      body = html`${moneyFields(form, cur, '', { label: 'Deuda total pendiente' })}
        ${field('Tipo de deuda (puedes marcar varios)', checks('types', cfg.types, form.types))}
        <div class="qf-if" data-show-if="types=OTHER">${field('¿Cuál?', textInput('other_detail', form.other_detail, { max: cfg.other_max || 60, placeholder: 'Ej.: crédito en tienda, cooperativa, prestamista…' }))}</div>`;
      break;
    case 'rate':
      body = html`${field('Tasa de interés (%)', html`<input class="input input--num input--short" name="rate" inputmode="decimal" value="${form.rate || ''}" placeholder="Ej.: 2,5" />`)}
        ${field('¿Es mensual o anual?', radios('period', cfg.periods, form.period, { cls: 'pills', pill: true }))}
        <input type="hidden" name="rate_type" value="${form.rate_type || 'UNKNOWN'}" />`;
      break;
    case 'multi_enum':
    case 'multi_text':
    case 'resources':
      body = html`${checks('codes', opts, form.codes, { exclusive: cfg.exclusive || [] })}${cfg.detail_label ? field(cfg.detail_label, textInput('detail', form.detail, { max: cfg.detail_max || 300, area: true })) : ''}`;
      break;
    case 'hours':
      body = field('Horas por semana', html`<input class="input input--num input--short" name="hours" inputmode="numeric" value="${form.hours ?? ''}" placeholder="0" />`);
      break;
    case 'skill_examples':
      body = html`${field('Hasta dos habilidades', textInput('skills', form.skills, { max: 200, placeholder: 'Ej.: diagnosticar fallas y reparar equipos' }))}
        ${field('Una tarea que resolviste', textInput('task', form.task, { max: 500, area: true, placeholder: 'Ej.: reparé un equipo sin cambiar una pieza que parecía dañada' }))}
        ${field('Qué resultado obtuviste', textInput('result', form.result, { max: 500, area: true, placeholder: 'Ej.: el cliente ahorró la pieza y me volvió a llamar' }))}`;
      break;
    case 'text':
      body = textInput('text', form.text, { max: cfg.max || 500, area: true, placeholder: cfg.placeholder || '' });
      break;
    case 'paid_experience':
      body = html`${radios('paid_before', [{ code: 'YES', label: 'Sí' }, { code: 'NO', label: 'Nunca' }], form.paid_before, { cls: 'pills', pill: true })}
        <div class="qf-if" data-show-if="paid_before=YES">${field('¿Qué hiciste?', textInput('activity', form.activity, { max: 300, placeholder: 'Ej.: limpieza de aires acondicionados' }))}
        ${field('¿Cuántas veces?', radios('frequency', cfg.frequency || cat.OPTIONS.FREQUENCY, form.frequency, { cls: 'pills', pill: true }))}</div>`;
      break;
    default:
      body = html`<p class="muted">Pregunta no disponible.</p>`;
  }
  return html`<div class="v3-input" data-type="${q.type}">${body}</div>${specials(form)}${c.errorText(errors, 'value')}`;
}

// ───────── Diagnóstico ─────────
function money(cur, v) {
  if (v === null || v === undefined) return '—';
  return `${Number(v) < 0 ? '−' : ''}${curLabel(cur)} ${cat.fmtNum(v)}`;
}
function metricValue(m, cur) {
  if (m.value === null) return 'Sin calcular';
  if (m.unit === 'money') return money(cur, m.value);
  if (m.unit === 'months') return `${String(m.value).replace('.', ',')} meses`;
  return `${String(Number((Number(m.value) * 100).toFixed(1))).replace('.', ',')} %`;
}
const REASON = {
  CURRENCY_MISMATCH: 'hay montos en otra moneda',
  DEBT_CONTRADICTION: 'tus respuestas sobre deudas no coinciden',
  ZERO_DENOMINATOR: 'no se puede dividir entre cero',
};
function reasonText(r) {
  if (!r) return '';
  if (REASON[r]) return REASON[r];
  if (/_RANGE$/.test(r)) return 'diste un rango, no un monto';
  if (/_UNKNOWN$|_NOT_ANSWERED$|_UNSURE$/.test(r)) return `falta la pregunta ${Number(r.slice(1, 3))}`;
  return 'faltan datos';
}

function evidence(refs, answers) {
  const items = (refs || []).map((r) => String(r).slice(0, 3)).filter((r, i, a) => a.indexOf(r) === i && answers[r]);
  if (!items.length) return '';
  return html`<details class="evidence"><summary>Ver en qué respuestas se basa</summary><ul>
    ${items.map((r) => html`<li>Pregunta ${Number(r.slice(1))}: ${cat.answerText(answers[r].variant_id, answers[r])}</li>`)}
  </ul></details>`;
}
function block(title, body, id) {
  return html`<section class="section dx-block" aria-labelledby="h-${id}"><h2 id="h-${id}">${title}</h2>${body}</section>`;
}

/** Oferta completa: 14 componentes + 2 herramientas, con precio y condiciones reales. */
function offerBlock(ctx, r, { products = [], owned = {}, user = null }) {
  const offer = r.offer;
  const pkg = products.find((p) => p.code === 'paquete');
  return html`<section class="section offer-pm" aria-labelledby="h-oferta">
    <p class="kicker">Siguiente paso</p>
    <h2 id="h-oferta">Construye tu estrategia completa con Día Uno</h2>
    <p class="lead">Este diagnóstico es el primer paso. Con el Plan Maestro de Crecimiento Patrimonial profundizamos en tu situación para ayudarte a generar más ingresos, organizar tu dinero, identificar oportunidades, construir activos y proteger tu patrimonio, con acompañamiento por chat y herramientas para controlar tu avance.</p>
    <div class="table-wrap"><table class="offer-table">
      <thead><tr><th scope="col">Qué recibirás</th><th scope="col">Cómo te ayudará</th></tr></thead>
      <tbody>${offer.benefits.map((b) => html`<tr class="${b.id.startsWith('TOOL') ? 'is-tool' : ''}"><th scope="row">${b.title}</th><td>${b.description}</td></tr>`)}</tbody>
    </table></div>
    ${owned.plan_maestro || owned.evaluacion_profunda
      ? html`<div class="actions"><a class="btn btn-primary btn-lg" href="/evaluacion">Continuar con mi Plan</a></div>`
      : pkg
        ? html`<div class="offer-cta">
            <p class="offer-price"><strong>${moneyLib.formatCents(pkg.price_cents, pkg.currency)} ${pkg.currency}</strong> <span class="muted">pago único · ${pkg.name}</span></p>
            <a class="btn btn-primary btn-lg" href="/comprar/paquete">${offer.cta}</a>
            ${!user ? html`<p class="small muted">Te pediremos crear una cuenta para guardar tu diagnóstico y tu plan.</p>` : ''}
          </div>`
        : ''}
    <p class="small muted">El plan se construye después de completar y confirmar tu información. Las cifras y estimaciones requieren datos suficientes; las oportunidades deben comprobarse. No se garantizan ingresos ni rentabilidades.</p>
  </section>`;
}

function resultPage(ctx, { result: r, answers, user, products, owned, completedAt }) {
  const cur = r.currency;
  const shown = r.metrics.filter((m) => ['monthly_balance', 'essential_gap', 'committed_reserve_months', 'income_goal_gap', 'income_goal_increment'].includes(m.id));
  const o = r.opportunity;
  const f = r.first_action;
  return html`<div class="dx">
    <div class="label-line"><span class="status-pill">Tu diagnóstico inicial</span><span class="small faint">${c.dateEs(completedAt)}</span></div>
    <h1 class="section dx-title">${r.conclusion.title}</h1>
    <p class="lead">${r.conclusion.interpretation}</p>
    ${evidence(r.conclusion.evidence_refs, answers)}

    ${block('Qué significan tus números', html`
      ${r.insights.map((i) => html`<article class="dx-insight"><h3>${i.title}</h3><p>${i.meaning}</p><p class="muted">${i.implication}</p>${evidence(i.evidence_refs, answers)}</article>`)}
      <details class="dx-calcs" ${r.insights.length ? '' : raw('open')}><summary>Ver los cálculos con tus promedios declarados</summary>
        <table class="calc-table"><tbody>
          ${shown.map((m) => html`<tr><th scope="row">${m.label}<br /><span class="small muted">${m.formula}</span></th><td class="num">${metricValue(m, cur)}${m.value !== null && m.approximate ? html`<br /><span class="small muted">aprox.</span>` : ''}${m.value === null ? html`<br /><span class="small muted">${reasonText(m.reason)}</span>` : ''}</td></tr>`)}
        </tbody></table>
        <p class="small muted">Calculado por Día Uno con tus respuestas. No es patrimonio neto ni ahorro real: son relaciones aproximadas para orientarte.</p>
      </details>
      ${r.contradictions && r.contradictions.length ? html`<div class="note note--warn">${r.contradictions.map((x) => html`<p>${x.text} Revísalo para que los cálculos sean confiables.</p>`)}</div>` : ''}`, 'numeros')}

    ${block('Dónde parece estar tu principal freno', html`<p>${r.bottleneck.interpretation}</p>
      <p class="small muted">${r.bottleneck.status === 'supported' ? 'Basado en lo que declaraste.' : r.bottleneck.status === 'hypothesis' ? 'Es una hipótesis por comprobar.' : 'Todavía no hay datos suficientes para afirmarlo.'}</p>${evidence(r.bottleneck.evidence_refs, answers)}`, 'freno')}

    ${o
      ? block('Una oportunidad concreta por explorar', html`<h3>${o.title}</h3><p>${o.hypothesis}</p>
        <div class="table-wrap"><table class="calc-table"><thead><tr><th scope="col">A tu favor</th><th scope="col">Lo que falta comprobar</th></tr></thead>
          <tbody><tr><td>${o.why_this_person}</td><td><ul>${o.unknowns.map((u) => html`<li>${u}</li>`)}</ul></td></tr></tbody></table></div>
        <p><strong>Cómo comprobarlo:</strong> ${o.test}</p>
        <p class="small"><strong>Sigue si:</strong> ${o.continue_if} <strong>Revisa si:</strong> ${o.revise_if}</p>
        <p class="small muted"><strong>Alternativa:</strong> ${o.alternative}</p>${evidence(o.evidence_refs, answers)}`, 'oportunidad')
      : ''}

    ${block('Tu primer paso', html`<article class="action-card"><p>${f.instruction}</p>
      <p class="meta"><strong>Por qué ahora:</strong> ${f.why_now}</p>
      <p class="meta"><strong>Lo habrás completado cuando:</strong> ${f.done_when}</p>
      <p class="meta small muted">${f.resource_fit} ${f.risk}</p></article>${evidence(f.evidence_refs, answers)}`, 'paso')}

    ${r.decision_to_review ? block('Una decisión que conviene posponer', html`<p><strong>${r.decision_to_review.decision}</strong></p><p>${r.decision_to_review.reason}</p>`, 'decision') : ''}

    ${block('Tu dirección inicial', html`<p>${r.growth_direction.text}</p>
      ${r.missing_data.length ? html`<p class="small muted">Para afinar tu plan necesitaremos:</p><ul class="findings findings--missing">${r.missing_data.map((m) => html`<li><strong>${m.question}</strong> <span class="muted">${m.why}</span></li>`)}</ul>` : ''}`, 'direccion')}

    ${!user ? html`<div class="next-step section"><p class="kicker">Guarda tu diagnóstico</p><p class="muted">Crea una cuenta para no perderlo. Si no, tus respuestas se conservan unos días desde tu última actividad.</p><div class="actions"><a class="btn btn-quiet" href="/registro">Crear mi cuenta</a><a class="btn btn-quiet" href="/entrar?siguiente=/resultado">Ya tengo cuenta</a></div></div>` : ''}

    ${offerBlock(ctx, r, { products, owned, user })}
    <p class="small muted section">¿Algo no coincide? <a href="/test/revision">Corrige tus respuestas</a> y generaremos un diagnóstico nuevo.</p>
  </div>`;
}

module.exports = { input, resultPage, money };
