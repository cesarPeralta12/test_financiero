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
// Especificación del resultado gratuito V2: nueve módulos en este orden.
// 01 encabezado · 02 hallazgo · 03 tres cifras · 04 qué significa · 05 oportunidad ·
// 06 primer paso · 07 puente · 08 oferta · 09 confianza y acciones secundarias.
const config = require('../config');

function money(cur, v) {
  if (v === null || v === undefined) return 'Dato pendiente';
  return `${Number(v) < 0 ? '−' : ''}${curLabel(cur)} ${cat.fmtNum(String(v).replace('-', ''))}`;
}
/** Respuestas en las que se basa una conclusión: se nombran por su pregunta, nunca por su número. */
function evidence(refs, answers) {
  const items = (refs || []).map((r) => String(r).slice(0, 3)).filter((r, i, a) => a.indexOf(r) === i && answers[r] && answers[r].status === 'answered');
  if (!items.length) return '';
  const q = (r) => {
    const v = cat.VARIANT_BY_ID[answers[r].variant_id];
    return v ? v.text : 'Tu respuesta';
  };
  return html`<details class="evidence"><summary>Ver en qué respuestas se basa</summary><ul>
    ${items.map((r) => html`<li><span class="muted">${q(r)}</span> ${cat.answerText(answers[r].variant_id, answers[r])}</li>`)}
  </ul></details>`;
}
function block(kicker, title, body, id) {
  return html`<section class="section dx-block" aria-labelledby="h-${id}"><p class="kicker">${kicker}</p><h2 id="h-${id}">${title}</h2>${body}</section>`;
}
/** Valor declarado de una pregunta de dinero (monto, rango o «Dato pendiente»). */
function declared(answers, slot) {
  const a = answers[slot];
  if (!a || a.status !== 'answered') return 'Dato pendiente';
  return cat.fmtMoney(a.value);
}
function duesText(answers, cur) {
  const q10 = answers.Q10;
  const q11 = answers.Q11;
  if (q11 && q11.status === 'answered' && q11.value.codes.includes('NONE')) return 'No aplica';
  if (!q10 || q10.status !== 'answered') return 'Dato pendiente';
  if (q10.value.status === 'NO') return 'No aplica';
  if (q10.value.status === 'NO_DUE') return money(cur, '0');
  return cat.fmtMoney(q10.value.monthly_due);
}
function monthsText(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (n === 0) return '0 meses';
  const r = n < 1 ? n.toFixed(1) : String(Math.round(n * 10) / 10);
  return `${r.replace('.', ',')} ${n === 1 ? 'mes' : 'meses'}`;
}

/** 03 · Tres cifras clave (más las cuotas si existen). Si falta un dato, se dice; nunca se pone 0. */
function figures(r, answers) {
  const cur = r.currency;
  const f = (r.screen && r.screen.figures) || {};
  const bal = r.metrics.find((m) => m.id === 'monthly_balance');
  const balValue = f.balance !== undefined ? f.balance : bal && bal.value;
  const range = r.balance_range;
  const balText = balValue !== null && balValue !== undefined ? money(cur, balValue) : range ? `${money(cur, range.min)} a ${money(cur, range.max)}` : 'No hay datos suficientes';
  const balLabel = balValue !== null && balValue !== undefined && Number(balValue) < 0 ? 'Te falta al mes' : 'Te queda al mes';
  const reserveKnown = answers.Q13 && answers.Q13.status === 'answered';
  const months = monthsText(f.reserve_months);
  const reserveText = months || (reserveKnown ? 'No se puede calcular' : 'No hay datos suficientes');
  const tiles = [
    ['Ingreso mensual', declared(answers, 'Q06')],
    [balLabel, balText],
    ['Reserva para emergencias', reserveText],
  ];
  if (f.dues) tiles.push(['Cuotas de deuda al mes', money(cur, f.dues)]);
  return html`<div class="dx-figures">${tiles.map(([k, v]) => html`<div class="dx-figure"><span class="small muted">${k}</span><strong>${v}</strong></div>`)}</div>
    <p class="small muted">Cifras calculadas con lo que declaraste. <a href="#como-calculamos">Ver cómo lo calculamos</a></p>`;
}

/** «Ver cómo lo calculamos»: tabla con cada monto y las fórmulas, plegada. */
function howCalculated(r, answers) {
  const cur = r.currency;
  const bal = r.metrics.find((m) => m.id === 'monthly_balance');
  const gap = r.metrics.find((m) => m.id === 'essential_gap');
  const range = r.balance_range;
  const balText = bal && bal.value !== null ? money(cur, bal.value) : range ? `Entre ${money(cur, range.min)} y ${money(cur, range.max)}` : 'No hay datos suficientes';
  return html`<details class="evidence dx-calc" id="como-calculamos"><summary>Ver cómo lo calculamos</summary>
    <div class="table-wrap"><table class="calc-table photo-table"><tbody>
      <tr><th scope="row">Ingreso mensual</th><td class="num">${declared(answers, 'Q06')}</td></tr>
      <tr><th scope="row">− Gastos básicos</th><td class="num">${declared(answers, 'Q08')}</td></tr>
      <tr><th scope="row">− Otros gastos</th><td class="num">${declared(answers, 'Q09')}</td></tr>
      <tr><th scope="row">− Cuotas de deuda del mes</th><td class="num">${duesText(answers, cur)}</td></tr>
      <tr class="is-total"><th scope="row">= Saldo estimado al mes</th><td class="num"><strong>${balText}</strong></td></tr>
    </tbody></table></div>
    <ul class="small muted">
      <li><strong>Saldo al mes:</strong> ingreso − gastos básicos − otros gastos − cuotas.</li>
      ${gap && gap.value !== null ? html`<li><strong>Margen antes de otros gastos:</strong> ${money(cur, gap.value)} (ingreso − gastos básicos − cuotas). No es ahorro.</li>` : ''}
      <li><strong>Meses de reserva:</strong> dinero guardado para emergencias ÷ (gastos básicos + cuotas).</li>
      <li>Si un dato falta o marcaste «No lo sé», no lo reemplazamos por cero y no calculamos lo que depende de él.</li>
    </ul>
  </details>`;
}

// 08 · Cinco beneficios antes que funcionalidades.
const BENEFITS = [
  ['Entender tus finanzas de verdad', 'Evaluación profunda de tus gastos, ingresos, deudas, riesgos y recursos.'],
  ['Saber qué hacer primero', 'De tres a siete prioridades, con su justificación, costos y riesgos.'],
  ['Encontrar caminos para ganar más', 'Oportunidades compatibles con tus habilidades, experiencia y tiempo, y cómo comprobar si alguien pagaría.'],
  ['Tener un plan, no solo consejos', 'Acciones para 30 y 90 días y escenarios a uno y tres años.'],
  ['No avanzar a ciegas', 'Seguimiento de tu avance y coach por chat.'],
];
// «Ver todo lo que incluye»: el detalle va plegado después del botón.
const FREE_VS_FULL = [
  ['Resumen estimado de tu flujo mensual', 'Revisión detallada de ingresos, gastos, deudas y costos, con escenarios'],
  ['Una prioridad financiera inicial', 'Prioridades ordenadas con sus criterios y riesgos'],
  ['Una oportunidad para explorar', 'Comparación de oportunidades según tu tiempo, recursos y demanda'],
  ['Un primer paso práctico', 'Un plan de acciones con seguimiento de tu avance'],
  ['Los datos que todavía faltan', 'Validación de tus datos y supuestos, con coach por chat y control de gastos'],
];

function priceText(pkg) {
  if (!pkg) return null;
  return `${pkg.currency} ${moneyLib.formatCents(pkg.price_cents, pkg.currency).replace(/[.,]00$/, '').replace(/^[^\d]+/, '')}`;
}

function offerBlock(r, { products = [], owned = {}, user = null }) {
  if (r.minor) {
    return html`<section class="section offer-pm"><p class="kicker">Siguiente paso</p><h2>Comparte este resultado con un adulto de confianza</h2><p class="muted">Como eres menor de 18 años, no te ofrecemos compras. Este resultado es tuyo y puedes guardarlo.</p></section>`;
  }
  const pkg = products.find((p) => p.code === 'paquete');
  const has = owned.plan_maestro || owned.evaluacion_profunda;
  const price = priceText(pkg);
  const sandbox = config.payments.gateway === 'sandbox';
  return html`<section class="section offer-pm" aria-labelledby="h-oferta">
    <p class="kicker">Plan Maestro</p>
    <h2 id="h-oferta">Construye tu Plan Maestro de Crecimiento Patrimonial</h2>
    <ul class="dx-benefits">${BENEFITS.map(([t, d]) => html`<li><strong>${t}</strong><span class="muted">${d}</span></li>`)}</ul>
    ${has
      ? html`<div class="actions"><a class="btn btn-primary btn-lg" href="/evaluacion">Continuar con mi Plan Maestro</a></div>`
      : html`<div class="offer-cta">
          ${price ? html`<p class="dx-price"><strong>${price}</strong> <span class="muted">· Pago único · Evaluación profunda + plan personalizado</span></p>` : ''}
          <a class="btn btn-primary btn-lg" href="/comprar/paquete">Quiero mi Plan Maestro</a>
          <a class="btn btn-quiet" href="#incluye">Ver qué incluye mi Plan Maestro</a>
          <p class="small muted">Revisarás y confirmarás tus datos antes de construir el plan. Los resultados son estimaciones; no se garantizan ingresos.${!user ? ' Te pediremos crear una cuenta para guardar tu plan.' : ''}</p>
          ${sandbox ? html`<p class="small note note--warn">Versión de prueba: el pago es simulado y no se cobra dinero real.</p>` : ''}
        </div>`}
  </section>`;
}

function resultPage(ctx, { result: r, answers, user, products, owned, completedAt }) {
  const sc = r.screen || {};
  const f = r.first_action;
  const imp = sc.improvement || (r.opportunity ? { title: r.opportunity.title, text: r.opportunity.hypothesis, test: r.opportunity.test, validate: true, evidence_refs: r.opportunity.evidence_refs } : null);
  return html`<div class="dx dx4">
    <header class="section">
      <div class="label-line"><span class="status-pill">Resultado gratuito</span><span class="small faint">${c.dateEs(completedAt)}</span></div>
      <h1 class="dx-title">Tu primer mapa financiero</h1>
      <p class="small muted">Basado en tus respuestas; es una orientación inicial, no un diagnóstico completo.</p>
    </header>

    <section class="section dx-block dx-main" aria-labelledby="h-hallazgo">
      <h2 id="h-hallazgo">${(sc.headline || r.conclusion).title}</h2>
      <p>${sc.headline ? sc.headline.text : r.conclusion.interpretation}</p>
      ${figures(r, answers)}
      ${r.contradictions && r.contradictions.length ? html`<div class="note note--warn">${r.contradictions.map((x) => html`<p>${x.text}</p>`)}</div>` : ''}
    </section>

    ${block('Lo que esto significa', 'Una fortaleza y un freno', html`
      ${sc.strength ? html`<article class="dx-insight"><h3>Lo que estás haciendo bien</h3><p>${sc.strength}</p></article>` : ''}
      <article class="dx-insight"><h3>Lo que más conviene revisar</h3><p>${sc.brake || (r.bottleneck && r.bottleneck.interpretation)}</p></article>
      ${evidence((sc.headline || r.conclusion).evidence_refs, answers)}`, 'significa')}

    ${imp
      ? block('Tu oportunidad de mejora', imp.title, html`<p>${imp.text}</p>
        ${imp.test ? html`<p class="small"><strong>Cómo comprobarlo:</strong> ${imp.test}</p>` : ''}
        ${imp.validate ? html`<p class="small muted">Es una posibilidad que todavía hay que comprobar: conocer personas no significa que comprarán.</p>${evidence(imp.evidence_refs, answers)}` : ''}`, 'oportunidad')
      : ''}

    ${block('Tu primer paso, gratis', 'Algo que puedes hacer esta semana', html`<article class="action-card"><p>${f.instruction}</p>
      <p class="meta"><strong>Sabrás que funcionó cuando:</strong> ${f.done_when}</p>
      <p class="meta small muted">${f.resource_fit} ${f.risk}</p></article>`, 'paso')}

    ${r.minor
      ? ''
      : html`<section class="section dx-bridge"><h2>¿Y si pudieras ir más lejos?</h2>
        <p>Ya sabes por dónde empezar. Falta descubrir qué camino te conviene más, cuánto podría cambiar tu situación y qué pasos seguir. Con los datos de este test no podemos calcular ganancias futuras.</p></section>`}

    ${offerBlock(r, { products, owned, user })}

    <section class="section dx-trust" aria-label="Más opciones">
      ${howCalculated(r, answers)}
      ${r.minor
        ? ''
        : html`<details class="evidence" id="incluye"><summary>Ver todo lo que incluye el Plan Maestro</summary>
        <div class="table-wrap"><table class="offer-table">
          <thead><tr><th scope="col">Resultado gratuito</th><th scope="col">Plan Maestro</th></tr></thead>
          <tbody>${FREE_VS_FULL.map(([a, b]) => html`<tr><td>${a}</td><td>${b}</td></tr>`)}</tbody>
        </table></div></details>`}
      ${!user ? html`<p class="small muted"><strong>Guarda tu resultado.</strong> Con una cuenta no lo pierdes; sin cuenta, tus respuestas se conservan unos días desde tu última actividad. <a href="/registro">Crear mi cuenta</a> · <a href="/entrar?siguiente=/resultado">Ya tengo cuenta</a></p>` : ''}
      <p class="small muted">¿Algo no coincide? <a href="/test/revision">Corrige tus respuestas</a> y generaremos un resultado nuevo. · <a href="/privacidad">Privacidad</a> · <a href="/condiciones">Condiciones</a></p>
    </section>
  </div>`;
}

module.exports = { input, resultPage };
