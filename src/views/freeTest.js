'use strict';
// Pantallas del test gratuito de 25 preguntas y de su resultado (12 secciones).
const { html, raw } = require('../lib/html');
const money = require('../lib/money');
const c = require('./components');
const catalog = require('../domain/free/catalog');
const { STATE_LABEL } = require('../domain/free/result');
const config = require('../config');
const v3 = require('./freeTest3');

const SPECIAL_CODES = catalog.SPECIAL_CODES;
const CURRENCY_OPTIONS = Object.entries(money.CURRENCIES).map(([value, v]) => ({ value, label: v.label }));

/** Texto legible de una respuesta activa. */
function answerText(variantId, a) {
  if (!a) return 'Sin responder';
  if (a.status === 'unknown') return 'No lo sé';
  if (a.status === 'declined') return 'Prefiero no responder';
  const v = a.value;
  if (Array.isArray(v)) return v.map((x) => catalog.labelFor(variantId, x)).join(', ');
  if (v && typeof v === 'object') {
    if (v.kind === 'AMOUNT') return `${v.amount} ${v.currency}`;
    if (v.kind === 'AGE') return `${v.value} años`;
    if (v.kind === 'CHOICE') return catalog.labelFor(variantId, v.code);
  }
  return catalog.labelFor(variantId, v);
}

function optionBlock(q, form, errors) {
  const multi = q.type === 'multi';
  const type = multi ? 'checkbox' : 'radio';
  const selected = multi ? form.value || [] : [form.value];
  const ordinary = q.options.filter((o) => !SPECIAL_CODES.includes(o.code));
  const specials = q.options.filter((o) => SPECIAL_CODES.includes(o.code));
  const exclusive = new Set(['NONE', ...SPECIAL_CODES]);
  const input = (o, i, cls) => html`<input type="${type}" name="value" id="${c.fieldId('value')}-${cls}${i}" value="${o.code}" ${selected.includes(o.code) ? raw('checked') : ''} ${multi && exclusive.has(o.code) ? raw('data-exclusive') : ''} />`;
  return html`<div class="options" ${c.describedBy(errors, 'value')}>
      ${ordinary.map((o, i) => html`<label class="option" for="${c.fieldId('value')}-o${i}">${input(o, i, 'o')}<span class="opt-label">${o.label}</span></label>`)}
    </div>
    <div class="unknown">
      ${specials.map((o, i) => html`<label class="pill pill--ghost" for="${c.fieldId('value')}-s${i}">${input(o, i, 's')}<span>${o.label}</span></label>`)}
    </div>
    ${c.errorText(errors, 'value')}`;
}

function choiceBlock(q, form, errors) {
  const choices = q.options;
  return html`<fieldset class="field"><legend class="small muted">O elige una opción</legend>
    <div class="pills" ${c.describedBy(errors, 'choice')}>
      ${choices.map((o, i) => html`<label class="pill ${SPECIAL_CODES.includes(o.code) ? 'pill--ghost' : ''}" for="${c.fieldId('choice')}-${i}"><input type="radio" name="choice" id="${c.fieldId('choice')}-${i}" value="${o.code}" ${form.choice === o.code ? raw('checked') : ''} /><span>${o.label}</span></label>`)}
    </div>
    ${c.errorText(errors, 'choice')}
  </fieldset>`;
}

function moneyBlock(q, form, errors) {
  const cur = form.currency || q.currency || 'USD';
  const opts = CURRENCY_OPTIONS.some((o) => o.value === cur) ? CURRENCY_OPTIONS : [{ value: cur, label: cur }, ...CURRENCY_OPTIONS];
  return html`<div class="field">
      <label for="${c.fieldId('amount')}">Importe mensual aproximado</label>
      ${c.moneyInput({ name: 'amount', value: form.amount, currency: cur, errors })}
    </div>
    <div class="field">
      <label for="${c.fieldId('currency')}">Moneda</label>
      ${c.select({ name: 'currency', options: opts, value: cur, errors })}
      ${q.currency ? html`<span class="hint">Si cambias la moneda, borraremos los importes que ya escribiste y te los pediremos de nuevo, sin convertirlos.</span>` : ''}
    </div>
    ${choiceBlock(q, form, errors)}`;
}

function ageBlock(q, form, errors, confirmNeeded) {
  return html`<div class="field">
      <label for="${c.fieldId('age')}">Edad</label>
      <input class="input input--num input--short" id="${c.fieldId('age')}" name="age" inputmode="numeric" value="${form.age ?? ''}" ${c.describedBy(errors, 'age')} ${c.invalid(errors, 'age')} />
      ${c.errorText(errors, 'age')}
    </div>
    ${confirmNeeded
      ? html`<div class="note note--warn" role="status"><label class="check"><input type="checkbox" name="confirmed" value="1" ${form.confirmed ? raw('checked') : ''} /> <span>Esa edad podría haber pasado o estar próxima. Sí, la mantengo como meta.</span></label></div>`
      : ''}
    ${choiceBlock(q, form, errors)}`;
}

/** Pantalla de una pregunta. o: { q, session, form, errors, note, confirmNeeded, prevHref } */
function questionPage(ctx, o) {
  const { q, form = {}, errors = {} } = o;
  const isV4 = q.catalog_version === 'FREE_24_V4_ES';
  // V4: avance real (solo preguntas que aplican); el número de pregunta no salta.
  const prog = o.progress;
  const total = isV4 && prog ? prog.total : isV4 ? 24 : 25;
  // Posición de esta pregunta entre las que aplican (también al volver a una ya respondida).
  const idx = isV4 && prog && prog.order ? prog.order.indexOf(q.slot_id) : -1;
  const pos = idx >= 0 ? idx + 1 : isV4 && prog ? Math.min(prog.completed_count + 1, total) : q.ordinal;
  const isLast = isV4 ? q.ordinal === 24 : q.ordinal === total;
  const pct = Math.round(((pos - 1) / total) * 100);
  const isV3 = q.catalog_version === 'FREE_25_V3_ES' || isV4;
  const isGroup = !isV3 && ['single', 'multi'].includes(q.type);
  const Tag = isGroup ? 'fieldset' : 'div';
  let input;
  if (isV4) input = require('./freeTest4').input(q, form, errors);
  else if (isV3) input = v3.input(q, form, errors);
  else if (isGroup) input = optionBlock(q, form, errors);
  else if (q.type === 'money_or_choice') input = moneyBlock(q, form, errors);
  else input = ageBlock(q, form, errors, o.confirmNeeded);
  return html`<form class="qf" method="post" action="/test/pregunta/${q.ordinal}" data-slot="${q.slot_id}" data-variant="${q.variant_id}" novalidate>
      ${c.csrfField(ctx)}
      <input type="hidden" name="variant_id" value="${q.variant_id}" />
      <input type="hidden" name="expected_revision" value="${o.session.revision}" />
      <input type="hidden" name="resolved_context_hash" value="${q.resolved_context_hash}" />
      <div class="qf-top">
        ${q.ordinal > 1
          ? html`<button class="qf-back" type="submit" name="action" value="prev" formnovalidate aria-label="Pregunta anterior"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
          : html`<a class="qf-back" href="/" aria-label="Salir del test"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></a>`}
        <div class="qf-progress" role="progressbar" aria-label="Avance del test" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${pos - 1}" aria-valuetext="Pregunta ${pos} de ${total}">
          <span class="qf-chapter">Pregunta ${pos} de ${total}</span>
          <div class="qf-track"><span class="qf-fill" style="width:${pct}%"></span></div>
        </div>
      </div>
      ${c.errorSummary(errors)}
      ${raw(`<${Tag} class="q-body">`)}
      ${isV4 && q.config && q.config.intro ? html`<p class="qf-intro">${q.config.intro}</p>` : ''}
      <div class="qf-card">
        ${isGroup ? html`<legend class="q-title">${q.text}</legend>` : html`<h1 class="q-title" id="q-title">${q.text}</h1>`}
      </div>
      ${o.note ? html`<p class="qf-note" role="note">${o.note.text}</p>` : ''}
      ${isV4 && q.help ? html`<p class="q-sub">${q.help}</p>` : ''}
      ${q.help && !isV4 ? html`<details class="qf-why"><summary>¿Por qué preguntamos?</summary><p class="q-help" id="q-help">${q.help}</p></details>` : ''}
      ${input}
      ${raw(`</${Tag}>`)}
      <div class="qf-actions">
        <button class="btn btn-primary btn-block" type="submit" name="action" value="next">${isLast ? (isV4 ? 'Revisar mis respuestas' : 'Revisar respuestas') : 'Siguiente'}</button>
      </div>
    </form>`;
}

function reviewPage(ctx, { items, canFinish, errors, completed }) {
  return html`<div class="q-head">
      ${c.ticks(items.map((i) => (i.answered ? 'done' : '')))}
      <div class="progress-meta"><span>Revisión</span><span>${items.filter((i) => i.answered && !i.skipped).length} de ${items.filter((i) => !i.skipped).length} respondidas</span></div>
    </div>
    <h1>Revisa tus respuestas</h1>
    <p class="muted">Puedes cambiar cualquier respuesta antes de ver tu resultado. Si cambias una, las preguntas que dependen de ella se te pedirán de nuevo.</p>
    ${errors && errors.length ? html`<div class="error-summary" role="alert"><h2>Aún no puedes continuar</h2><ul>${errors.map((e) => html`<li>${e}</li>`)}</ul></div>` : ''}
    <ol class="review">
      ${items.map((it) => html`<li>
        <span class="n">${it.ordinal}</span>
        <span class="q">${it.text}</span>
        <span class="a ${it.answered ? '' : 'missing'}">${it.answered ? it.display : 'Falta responder'}</span>
        <a class="edit" href="/test/pregunta/${it.ordinal}" aria-label="Cambiar la respuesta ${it.ordinal}">${it.answered ? 'Cambiar' : 'Responder'}</a>
      </li>`)}
    </ol>
    <form method="post" action="/test/finalizar">
      ${c.csrfField(ctx)}
      <div class="actions">
        <button class="btn btn-primary" type="submit" ${canFinish ? '' : raw('aria-disabled="true"')}>${completed ? 'Actualizar mi resultado' : items.length === 24 ? 'Ver mi resultado gratuito' : 'Ver mi resultado'}</button>
      </div>
    </form>`;
}

// ───────── Resultado ─────────
const STATE_ICON = { strength: '✔', attention: '▲', critical: '■', potential: '◆', unknown: '?' };

function evidenceList(refs, answers) {
  if (!refs || !refs.length) return '';
  return html`<details class="evidence"><summary>Ver evidencia</summary><ul>
    ${refs.map((r) => html`<li>Pregunta ${Number(r.slot_id.slice(1))}: ${answerText(r.variant_id, answers[r.slot_id])}</li>`)}
  </ul></details>`;
}

function section(n, title, body, id) {
  return html`<section class="section" aria-labelledby="h-${id}"><h2 id="h-${id}"><span class="kicker">${n}</span> ${title}</h2>${body}</section>`;
}

/** Resultado V2 de crecimiento patrimonial: seis bloques compactos (documento 02 §4.1). */
function patrimonialBlocks(p, answers) {
  const f = p.first_action;
  const o = p.opportunity;
  return html`<div class="v2" data-version="${p.version}">
    ${section(1, 'Tu punto de partida', html`<p>${p.starting_point.text}</p>${evidenceList(p.starting_point.evidence_refs, answers)}`, 'v2-partida')}

    ${section(2, 'Qué está frenando tu crecimiento', p.brakes.length
      ? html`<ul class="findings">${p.brakes.map((b) => html`<li><strong>${b.title}.</strong> ${b.why}${evidenceList(b.evidence_refs, answers)}</li>`)}</ul>`
      : html`<p class="muted">Con tus respuestas no vemos un freno urgente. Eso no significa que no exista: faltan tus cifras reales para confirmarlo.</p>`, 'v2-frenos')}

    ${section(3, 'Tus recursos para progresar', p.resources.length
      ? html`<ul class="findings">${p.resources.map((x) => html`<li>${x.text}${evidenceList(x.evidence_refs, answers)}</li>`)}</ul>`
      : html`<p class="muted">Todavía no declaraste recursos que podamos señalar. No queremos inventarlos.</p>`, 'v2-recursos')}

    ${section(4, 'Oportunidad por explorar', html`<article class="action-card"><p class="kicker">${o.status === 'HIPOTESIS' ? 'Hipótesis por comprobar' : 'Sin datos suficientes'}</p><h3>${o.title}</h3>
      ${o.hypothesis ? html`<p>${o.hypothesis}</p>` : ''}
      <p class="meta"><strong>Para confirmarlo:</strong> ${o.question}</p>${evidenceList(o.evidence_refs, answers)}</article>
      ${p.dual_focus ? html`<p class="small muted">Aunque hay algo urgente que proteger, no dejamos de buscar cómo puedes generar más: ambas cosas pueden avanzar a la vez.</p>` : ''}`, 'v2-oportunidad')}

    ${section(5, 'Tu Día Uno', html`<article class="action-card"><p class="kicker">${f.category_label}</p><h3>${f.title}</h3><p>${f.instruction}</p>
      <p class="meta"><strong>Por qué ahora:</strong> ${f.why}</p>
      <p class="meta"><strong>Tiempo:</strong> ${f.effort} · <strong>Dinero:</strong> ${f.capital}</p>
      <p class="meta"><strong>Sabrás que lo lograste cuando:</strong> ${f.done_when}</p></article>`, 'v2-diauno')}

    ${section(6, 'Qué necesitamos para diseñar tu plan patrimonial', html`<ul class="findings findings--missing">${p.missing.map((m) => html`<li><strong>${m.question}</strong><br /><span class="muted">${m.reason}</span></li>`)}</ul>
      <p class="small muted">${p.scope_note}</p>`, 'v2-falta')}
  </div>`;
}

function resultPage(ctx, o) {
  const { result: r, answers, user, products, offer, owned, reward, completedAt } = o;
  const goal = r.goal;
  const goalLines = [];
  if (goal.priority) goalLines.push(html`<li><strong>Tu prioridad:</strong> ${goal.priority.label}.</li>`);
  if (goal.income_goal) {
    goalLines.push(html`<li><strong>Tu meta de ingreso:</strong> ${goal.income_goal.kind === 'AMOUNT' ? `${goal.income_goal.amount} ${goal.income_goal.currency} al mes` : goal.income_goal.label}. <span class="muted">${goal.income_goal.note}</span></li>`);
  }
  if (goal.independence) {
    const ind = goal.independence;
    const age = ind.age ? (ind.age.kind === 'AGE' ? `a los ${ind.age.value} años` : 'ya puedes hacerlo') : null;
    const amount = ind.monthly_amount ? `${ind.monthly_amount.amount} ${ind.monthly_amount.currency} al mes` : null;
    goalLines.push(html`<li><strong>Independencia:</strong> ${[amount, age].filter(Boolean).join(', ')}. <span class="muted">${ind.note}</span></li>`);
  }
  const f = r.first_action;
  const v2 = Boolean(r.patrimonial) && config.freeResultV2;
  const head = html`<div class="label-line"><span class="status-pill">Lectura preliminar</span><span class="small faint">${c.dateEs(completedAt)}</span></div>
    <h1 class="section" style="margin-top:20px">${r.title}</h1>
    <p class="lead">${r.scope_text}</p>
    ${r.narrative_source === 'ai' ? html`<p class="small muted">Redactamos tus resultados en detalle a partir de tus respuestas.</p>` : ''}`;

  // Lectura V1 detallada (doce secciones), sin cambios de contenido.
  const detail = html`
    ${section(1, 'Tu perfil financiero', html`<h3>${r.profile.title}</h3><p>${r.profile.summary}</p>${evidenceList(r.profile.evidence_refs, answers)}`, 'perfil')}

    ${section(2, 'Prioridad y alcance', html`<p><span class="status-pill">Prioridad de atención: ${r.attention.level}</span> <span class="status-pill">${r.coverage.label} (${r.coverage.known_domains} de ${r.coverage.total_domains} temas)</span></p>
      <ul class="findings">${r.attention.reasons.map((x) => html`<li>${x}</li>`)}</ul>
      <p class="small muted">Es una lectura preliminar. La prioridad de atención no es una medida de confianza: puede haber una señal urgente y mucha información sin verificar.</p>`, 'prioridad')}

    ${section(3, 'Tu punto de partida', html`<ul class="figures">
        ${r.facts.map((x) => html`<li><span class="k">${x.label} <span class="src src--dato">Declarado</span></span><span class="v">${x.value ? x.value.label : x.reason === 'unknown' ? 'Sin verificar (respondiste «No lo sé»)' : x.reason === 'declined' ? 'No quisiste responder' : 'No aplica'}</span></li>`)}
      </ul>
      ${r.metrics.length ? html`<ul class="figures">${r.metrics.map((m) => html`<li><span class="k">${m.label || m.code} <span class="src src--calculo">Calculado</span></span><span class="v num">${m.value}${m.currency ? ` ${m.currency}` : ' %'}</span></li>`)}</ul>` : ''}
      ${r.invalid_metrics.length ? html`<div class="note note--warn">No pudimos calcularlo con los datos disponibles.</div>` : ''}
      <p class="small muted">No pedimos tus ingresos ni gastos exactos, por eso no mostramos cifras de ingreso, gasto ni saldo.</p>`, 'partida')}

    ${section(4, 'Tu mapa financiero', html`<ul class="map">
        ${r.dimensions.map((d) => html`<li class="map-item map-item--${d.state}"><div class="map-head"><strong>${d.label}</strong> <span class="status-pill"><span aria-hidden="true">${STATE_ICON[d.state]}</span> ${STATE_LABEL[d.state]}</span></div><p>${d.explanation}</p>${evidenceList(d.evidence_refs, answers)}</li>`)}
      </ul>`, 'mapa')}

    ${section(5, 'Tus fortalezas', r.strengths.length ? html`<ul class="findings">${r.strengths.map((s) => html`<li>${s.title}${evidenceList(s.evidence_refs, answers)}</li>`)}</ul>` : html`<p class="muted">Con lo que respondiste todavía no hay evidencia suficiente para señalar fortalezas. No queremos inventarlas.</p>`, 'fortalezas')}

    ${section(6, 'Hallazgos principales', r.findings.length ? html`${r.findings.map((x) => html`<article class="action-card"><h3>${x.title}</h3><p>${x.explanation}</p>${evidenceList(x.evidence_refs, answers)}</article>`)}` : html`<p class="muted">No hay hallazgos que señalar con los datos actuales.</p>`, 'hallazgos')}

    ${section(7, 'Tu objetivo', html`<ul class="findings">${goalLines}</ul>${goal.pending.length ? html`<p class="small muted">${goal.pending.join(' ')}</p>` : ''}`, 'objetivo')}

    ${section(8, 'Oportunidad para mejorar', html`${r.opportunities.map((x) => html`<article class="action-card"><h3>${x.title}</h3><p>${x.description}</p>${evidenceList(x.evidence_refs, answers)}</article>`)}`, 'oportunidad')}

    ${section(9, 'Tus prioridades', r.priorities.length ? html`<ol class="priority-list">${r.priorities.map((p) => html`<li><strong>${p.title}</strong><br /><span class="muted">${p.reason}</span></li>`)}</ol>` : html`<p class="muted">Aún no hay prioridades claras; primero conviene completar los datos pendientes.</p>`, 'prioridades')}

    ${section(10, 'Tu hoja de ruta de 90 días', html`<p class="small muted">Etapas generales y orientativas, sujetas a lo que confirmes después. No prometen ventas, ahorros ni pagos en una fecha.</p>
      <ol class="roadmap">${r.roadmap.map((s) => html`<li><strong>Días ${s.day_from}–${s.day_to}: ${s.focus}.</strong> ${s.description}</li>`)}</ol>`, 'ruta')}

    ${section(11, 'Tu primer paso', html`<article class="action-card"><h3>${f.title}</h3><p>${f.instruction}</p><p class="meta"><strong>Cómo sabrás que lo lograste:</strong> ${f.completion_criterion}</p></article>`, 'paso')}

    ${section(12, 'Qué falta y cómo seguir', r.missing_data.length ? html`<ul class="findings findings--missing">${r.missing_data.map((m) => html`<li>${m.reason}</li>`)}</ul>` : html`<p class="muted">No hay datos pendientes destacados.</p>`, 'seguir')}`;

  // Guardar el resultado y continuar a la evaluación profunda.
  const followUp = html`
      ${!user
        ? html`<div class="next-step"><p class="kicker">Guarda tu resultado</p><h3>Crea una cuenta para no perderlo</h3><p class="muted">Tus respuestas y tu resultado quedarán ligados a tu cuenta. ${r.save_result.policy_text}</p><div class="actions"><a class="btn btn-primary" href="/registro">Crear mi cuenta</a><a class="btn btn-quiet" href="/entrar?siguiente=/resultado">Ya tengo cuenta</a></div></div>`
        : ''}
      <hr class="rule" />
      <h3>${offer ? offer.title : 'Evaluación profunda'}</h3>
      <p class="muted">${v2 ? r.patrimonial.next_step : r.next_step.reason}</p>
      <p class="muted">${offer ? offer.body : ''}</p>
      ${owned.evaluacion_profunda ? html`<div class="actions"><a class="btn btn-primary" href="/evaluacion">Empezar mi evaluación profunda</a></div>` : products.map((p) => c.offerCard(ctx, p, { featured: p.code === 'evaluacion', cta: p.code === 'evaluacion' ? 'Comprar la evaluación' : 'Comprar el paquete' }))}
      <p class="small muted">¿Algo no coincide? <a href="/test/revision">Corrige tus respuestas</a>: generaremos un resultado nuevo y retiraremos el anterior. No necesitas pagar para hacerlo.</p>`;

  return html`${head}
    ${v2
      ? html`${patrimonialBlocks(r.patrimonial, answers)}
        <section class="section" aria-label="Cómo seguir">${followUp}</section>
        <details class="v1-detail section"><summary>Ver el análisis detallado</summary>${detail}</details>`
      : html`${detail}<section class="section" aria-label="Cómo seguir">${followUp}</section>`}

    ${reward ? html`<section class="reward-card" aria-label="Recompensa"><div><p><span class="plus">+100 XP</span> y el logro <strong>«Primer paso»</strong>. ${user ? 'Ya cuentan en tu nivel.' : 'Crea tu cuenta para guardarlos.'}</p></div></section>` : ''}`;
}

module.exports = { questionPage, reviewPage, resultPage, answerText };
