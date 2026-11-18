'use strict';
// «Mi dinero» (Coach v2, S2): resumen del mes, ranking por categoría, registro rápido y lista.
// Se ve y funciona sin JavaScript (formularios normales); public/js/mi-dinero.js añade la hoja de
// registro, la línea inteligente, el deshacer y los efectos.
const { html, raw } = require('../lib/html');
const money = require('../lib/money');
const tracker = require('../domain/tracker');
const c = require('./components');
const G = require('../domain/coach/graficos');

const ICONS = {
  gasto: { alimentacion: '🍽️', vivienda: '🏠', transporte: '🚌', servicios: '💡', salud: '🩺', educacion: '📚', ocio: '🎬', otros: '✨' },
  ingreso: { sueldo: '💼', independiente: '🧑‍💻', negocio: '🏪', renta: '🏘️', extra: '⭐', otros: '✨' },
  ahorro: { reserva: '🛡️', meta: '🎯', otros: '🐖' },
  pago_deuda: { cuota: '💳', extra: '⚡' },
};
const icon = (kind, cat) => (ICONS[kind] && ICONS[kind][cat]) || '•';
// Tipos que se registran desde la hoja rápida (el resto sigue en la calculadora).
const SHEET_KINDS = ['gasto', 'ingreso', 'ahorro', 'pago_deuda'];

function monthLabel(m) {
  return new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(m + '-15T12:00:00Z'));
}
function nextMonth(m) {
  const [y, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 7);
}
function dayLabel(date, today) {
  if (date === today) return 'Hoy';
  const y = new Date(today + 'T12:00:00Z');
  y.setUTCDate(y.getUTCDate() - 1);
  if (date === y.toISOString().slice(0, 10)) return 'Ayer';
  return new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
}
const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Importe con signo: ingresos suman, gastos restan; el resto se muestra sin signo. */
function signed(m, cur) {
  if (m.kind === 'ingreso') return money.format(m.amount, cur, { sign: true });
  if (['gasto', 'pago_deuda'].includes(m.kind)) return `−${money.format(m.amount, cur)}`;
  return money.format(m.amount, cur);
}
const movJson = (m) => JSON.stringify({ id: m.id, tipo: m.kind, categoria: m.category, subcategoria: m.subcategory || null, importe: m.amount, fecha: m.date, nota: m.note || null });

function row(m, cur) {
  const label = tracker.CATEGORIES[m.kind] && tracker.CATEGORIES[m.kind][m.category];
  return html`<li class="md-row-wrap" data-mov-id="${m.id}"><a class="md-row" href="/mi-dinero/movimientos/${m.id}" data-mov="${movJson(m)}">
      <span class="md-ico" aria-hidden="true">${icon(m.kind, m.category)}</span>
      <span class="md-row-main"><strong>${m.note || label || tracker.KINDS[m.kind]}</strong><span class="small muted">${m.note ? label || '' : ''}${m.subcategory ? `${m.note ? ' › ' : ''}${m.subcategory.replace(/_/g, ' ')}` : ''}</span></span>
      <span class="md-amt md-amt--${m.kind === 'ingreso' ? 'in' : ['gasto', 'pago_deuda'].includes(m.kind) ? 'out' : 'neutral'}">${signed(m, cur)}</span>
    </a></li>`;
}

function groupedRows(items, cur, today) {
  const groups = [];
  for (const m of items) {
    const g = groups[groups.length - 1];
    if (g && g.date === m.date) g.items.push(m);
    else groups.push({ date: m.date, items: [m] });
  }
  return html`${groups.map((g) => html`<section class="md-day"><h3 class="md-day-title">${dayLabel(g.date, today)}</h3><ul class="md-list">${g.items.map((m) => row(m, cur))}</ul></section>`)}`;
}

function sheetConfig(userId, cur, today) {
  const info = money.currencyInfo(cur);
  const sym = new Intl.NumberFormat(info.locale, { style: 'currency', currency: money.CURRENCIES[cur] ? cur : 'USD', currencyDisplay: 'narrowSymbol' })
    .formatToParts(0)
    .find((p) => p.type === 'currency');
  const y = new Date(today + 'T12:00:00Z');
  y.setUTCDate(y.getUTCDate() - 1);
  const cats = {};
  for (const k of SHEET_KINDS) cats[k] = tracker.categoryUsage(userId, k).map((code) => [code, tracker.CATEGORIES[k][code], icon(k, code)]);
  const subs = require('../domain/coach/subcategorias').SUBS;
  return {
    cur,
    locale: info.locale,
    sym: sym ? sym.value : cur,
    dec: info.decimals,
    decSep: info.decimalSep,
    today,
    yesterday: y.toISOString().slice(0, 10),
    kinds: SHEET_KINDS.map((k) => [k, tracker.KINDS[k]]),
    cats,
    subs,
    undoSeconds: tracker.UNDO_SECONDS,
  };
}

/** La hoja de registro (se llena con JavaScript; sin JS el botón «+» abre el formulario normal). */
function sheet() {
  return html`<template id="md-sheet-tpl">
    <div class="md-overlay" data-close>
      <div class="md-sheet" role="dialog" aria-modal="true" aria-labelledby="md-sheet-title" tabindex="-1">
        <div class="md-sheet-head">
          <h2 id="md-sheet-title" data-title>Registrar</h2>
          <button class="md-x" type="button" data-close aria-label="Cerrar">✕</button>
        </div>
        <div class="md-line">
          <input class="input" type="text" data-line maxlength="120" autocomplete="off" spellcheck="false" aria-label="Escribe el movimiento en una línea" placeholder="Escribe: «250 súper», «cobré 800», «luz 80»" />
          <div class="md-preview" data-preview aria-live="polite" hidden></div>
        </div>
        <div class="md-kinds" role="radiogroup" aria-label="Tipo de movimiento" data-kinds></div>
        <div class="md-amount" data-amount-box>
          <span class="md-cur" data-cur aria-hidden="true"></span>
          <output class="md-amount-val" data-amount aria-live="off">0</output>
        </div>
        <div class="md-keypad" data-keypad role="group" aria-label="Teclado numérico"></div>
        <p class="md-label">Categoría</p>
        <div class="md-chips" data-cats role="radiogroup" aria-label="Categoría"></div>
        <div class="md-when">
          <div class="md-dates" role="radiogroup" aria-label="Fecha" data-dates></div>
          <input class="input md-note" type="text" data-note maxlength="140" placeholder="Nota (opcional)" aria-label="Nota (opcional)" autocomplete="off" />
        </div>
        <details class="md-more" data-more><summary>Más opciones</summary>
          <label class="md-sub-label">Subcategoría <select class="input" data-sub><option value="">Ninguna</option></select></label>
        </details>
        <p class="md-error" data-error role="alert" hidden></p>
        <div class="md-confirm" data-confirm hidden>
          <p data-confirm-text></p>
          <div class="md-confirm-actions"><button type="button" class="btn btn-primary btn-small" data-confirm-yes>Sí, guardar</button><button type="button" class="btn btn-secondary btn-small" data-confirm-no>Cambiar</button></div>
        </div>
        <div class="md-sheet-foot">
          <button class="btn btn-danger btn-small" type="button" data-delete hidden>Eliminar</button>
          <button class="btn btn-primary md-save" type="button" data-save>Guardar</button>
        </div>
      </div>
    </div>
  </template>`;
}

// ───────── Observaciones (insights) ─────────
const SEV = { alerta: 'Alerta', atencion: 'Atención', logro: 'Logro', info: 'Para tu información' };
/** Adónde lleva cada botón del catálogo desde esta pantalla (las acciones del chat llevan al Coach). */
function hrefBoton(b, month) {
  switch (b.accion) {
    case 'ir': return b.destino;
    case 'abrir_registro': return '/mi-dinero/nuevo';
    case 'abrir_ranking':
    case 'abrir_grafico':
    case 'abrir_insights':
    case 'abrir_detalle': return `/mi-dinero/analisis${qs({ mes: month })}`;
    case 'simular': return '/calculadora/simulador';
    case 'consulta':
    case 'proponer_tarea':
    case 'cambiar_estrategia': return '/coach';
    default: return null;
  }
}

function observacion(ctx, i, { grafico = false, month } = {}) {
  const botones = (i.botones || []).map((b) => ({ b, href: hrefBoton(b, month) })).filter((x) => x.href).slice(0, 3);
  return html`<article class="md-ins md-ins--${i.severidad}" aria-label="${SEV[i.severidad]}: observación">
    <div class="md-ins-head"><span class="md-badge md-badge--${i.severidad}">${SEV[i.severidad]}</span>${i.descartable ? html`<form method="post" action="/mi-dinero/observaciones/descartar" class="md-inline-form">${c.csrfField(ctx)}<input type="hidden" name="id" value="${i.id}" /><button class="md-link" type="submit" aria-label="Descartar esta observación">Descartar</button></form>` : ''}</div>
    <p class="md-ins-text">${i.texto}</p>
    ${grafico && i.grafico ? raw(G.render(i.grafico)) : ''}
    ${botones.length ? html`<div class="md-ins-actions">${botones.map((x) => html`<a class="btn btn-secondary btn-small" href="${x.href}">${x.b.etiqueta}</a>`)}</div>` : ''}
  </article>`;
}

function observaciones(ctx, obs, month) {
  if (!obs || !obs.insights.length) return '';
  return html`<section class="md-obs" aria-labelledby="md-obs-h">
    <div class="md-section-head"><h2 id="md-obs-h">Observaciones</h2><a href="/mi-dinero/analisis${qs({ mes: month })}">Análisis y gráficos ›</a></div>
    <div class="md-ins-list">${obs.insights.map((i) => observacion(ctx, i, { month }))}</div>
    ${obs.mas.length ? html`<p class="small muted"><a href="/mi-dinero/analisis${qs({ mes: month })}">Más observaciones (${obs.mas.length}) ›</a></p>` : ''}
  </section>`;
}

function analisisPage(ctx, d) {
  const { month, obs, graficos } = d;
  const yaMostrados = new Set(graficos.map((g) => g.titulo));
  return html`<div class="md md--analisis">
    <div class="md-head"><h1><a class="md-back" href="/mi-dinero${qs({ mes: month })}" aria-label="Volver a Mi dinero">‹</a> Análisis</h1>
      <nav class="md-month" aria-label="Mes"><a href="/mi-dinero/analisis${qs({ mes: tracker.prevMonth(month) })}" aria-label="Mes anterior">‹</a><span class="md-month-name">${monthLabel(month)}</span>${month < tracker.currentMonth() ? html`<a href="/mi-dinero/analisis${qs({ mes: nextMonth(month) })}" aria-label="Mes siguiente">›</a>` : html`<span class="md-month-off" aria-hidden="true">›</span>`}</nav></div>
    <section aria-labelledby="an-g"><h2 id="an-g" class="md-h2">Gráficos del mes</h2><div class="md-graficos">${graficos.map((g) => raw(G.render(g)))}</div></section>
    <section aria-labelledby="an-o"><h2 id="an-o" class="md-h2">Todas las observaciones</h2>
      ${obs.insights.length + obs.mas.length ? html`<div class="md-ins-list">${[...obs.insights, ...obs.mas].map((i) => observacion(ctx, i, { grafico: Boolean(i.grafico) && !yaMostrados.has(i.grafico.titulo), month }))}</div>` : html`<p class="muted">Aún no hay observaciones para este mes.</p>`}
      <p class="small faint">Las cifras las calcula Día Uno con tus movimientos; son estimaciones simples, no consejos financieros. Los porcentajes se redondean.</p>
    </section>
  </div>`;
}

function hub(ctx, d) {
  const { month, today, cur, summary, recent, userId, obs } = d;
  const f = (v) => money.format(v, cur);
  const gastos = summary.por_categoria.filter((x) => x.tipo === 'gasto');
  const top = gastos.slice(0, 5);
  const max = top.length ? Math.max(...top.map((x) => Number(x.monto))) : 0;
  const config = sheetConfig(userId, cur, today);
  const isCurrent = month === tracker.currentMonth();
  const empty = !summary.n_movimientos && !recent.length;
  const card = (key, label, value, extra = '') =>
    html`<div class="md-card md-card--${key}" data-card="${key}"><span class="md-card-label">${label}</span><strong class="md-card-val ${extra}" data-count="${value}">${f(value)}</strong></div>`;
  return html`<div class="md" data-md data-month="${month}" data-config="${JSON.stringify(config)}">
    <div class="md-head">
      <h1>Mi dinero</h1>
      <nav class="md-month" aria-label="Mes">
        <a href="/mi-dinero${qs({ mes: tracker.prevMonth(month) })}" aria-label="Mes anterior">‹</a>
        <span class="md-month-name">${monthLabel(month)}</span>
        ${month < tracker.currentMonth() ? html`<a href="/mi-dinero${qs({ mes: nextMonth(month) })}" aria-label="Mes siguiente">›</a>` : html`<span class="md-month-off" aria-hidden="true">›</span>`}
      </nav>
    </div>
    <div data-md-body>
      <section class="md-totals" aria-label="Resumen del mes">
        ${card('in', 'Ingresos', summary.ingreso)}
        ${card('out', 'Gastos', summary.gasto)}
        ${card('bal', 'Saldo', summary.saldo, Number(summary.saldo) < 0 ? 'neg' : '')}
      </section>
      <p class="visually-hidden" role="status" aria-live="polite" data-live></p>
      ${empty
        ? html`<div class="md-empty"><div class="md-empty-art" aria-hidden="true">🪙</div><h2>Empieza por tu primer movimiento</h2><p class="muted">Anota un gasto o un ingreso en tres toques. Aquí verás en qué se va tu dinero.</p><a class="btn btn-primary" href="/mi-dinero/nuevo" data-open-register>Registrar ahora</a></div>`
        : html`
      <section class="md-rank" aria-labelledby="md-rank-h">
        <div class="md-section-head"><h2 id="md-rank-h">Gastos por categoría</h2>${gastos.length > 5 ? html`<a href="/mi-dinero/movimientos${qs({ mes: month, tipo: 'gasto', orden: 'importe_desc' })}">Ver todo ›</a>` : ''}</div>
        ${top.length
          ? html`<ul class="md-bars">${top.map((x, i) => html`<li class="md-bar"><span class="md-bar-label"><span aria-hidden="true">${icon('gasto', x.categoria)}</span> ${x.etiqueta}</span><span class="md-bar-track" role="img" aria-label="${x.etiqueta}: ${x.pct_del_total === null ? '' : `${String(x.pct_del_total).replace('.', ',')} %`}"><span class="md-bar-fill" style="--w:${max ? Math.max(4, Math.round((Number(x.monto) / max) * 100)) : 0}%;--i:${i}"></span></span><span class="md-bar-val">${f(x.monto)}<span class="small muted"> · ${x.pct_del_total === null ? '' : `${String(Math.round(x.pct_del_total))} %`}</span></span></li>`)}</ul>`
          : html`<p class="muted">Aún no hay gastos este mes.</p>`}
        ${summary.mes_anterior && isCurrent && Number(summary.mes_anterior.gasto) > 0
          ? html`<p class="small muted md-compare">A la misma altura del mes pasado gastaste ${f(summary.mes_anterior.gasto)}.</p>`
          : ''}
      </section>
      ${observaciones(ctx, obs, month)}
      <section class="md-recent" aria-labelledby="md-recent-h">
        <div class="md-section-head"><h2 id="md-recent-h">Movimientos</h2><span class="md-actions-inline"><form method="post" action="/mi-dinero/repetir" class="md-inline-form">${c.csrfField(ctx)}<button class="md-link" type="submit" data-repeat>Repetir el último</button></form><a href="/mi-dinero/movimientos${qs({ mes: month })}">Ver todos ›</a></span></div>
        ${recent.length ? groupedRows(recent, cur, today) : html`<p class="muted">No hay movimientos este mes.</p>`}
      </section>`}
    </div>
    <a class="md-fab" href="/mi-dinero/nuevo" data-open-register aria-label="Registrar un movimiento"><span aria-hidden="true">+</span></a>
    <div class="md-toast" data-toast role="status" aria-live="polite"></div>
    ${sheet()}
  </div>`;
}

// ───────── Lista completa con orden, filtros y búsqueda ─────────
const ORDER_LABELS = [
  ['fecha_desc', 'Más recientes'],
  ['fecha_asc', 'Más antiguos'],
  ['importe_desc', 'Importe: mayor a menor'],
  ['importe_asc', 'Importe: menor a mayor'],
  ['categoria_asc', 'Categoría (A–Z)'],
  ['nota_asc', 'Nota (A–Z)'],
  ['creado_desc', 'Registrados últimos'],
];

function listPage(ctx, d) {
  const { month, cur, r, query, today } = d;
  const kinds = [].concat(query.tipo || []);
  const cats = [].concat(query.categoria || []);
  const fecha = (v) => tracker.validDate(String(v || '')) || '';
  const desde = fecha(query.desde);
  const hasta = fecha(query.hasta);
  const rango = Boolean(desde || hasta);
  const base = { mes: month, desde, hasta, limite: query.limite, tipo: kinds, categoria: cats, q: query.q, min: query.min, max: query.max, orden: r.order === 'fecha_desc' ? '' : r.order };
  // Periodos rápidos: lo que casi todo el mundo necesita, sin tocar fechas.
  const dia = (n) => {
    const x = new Date(today + 'T12:00:00Z');
    x.setUTCDate(x.getUTCDate() - n);
    return x.toISOString().slice(0, 10);
  };
  const sinPeriodo = { ...base, desde: '', hasta: '', pagina: '' };
  const quick = [
    ['Este mes', { ...sinPeriodo, mes: tracker.currentMonth() }, !rango && month === tracker.currentMonth()],
    ['Últimos 7 días', { ...sinPeriodo, desde: dia(6), hasta: today }, desde === dia(6) && hasta === today],
    ['Últimos 30 días', { ...sinPeriodo, desde: dia(29), hasta: today }, desde === dia(29) && hasta === today],
  ];
  const esRapido = (desde === dia(6) || desde === dia(29)) && hasta === today;
  const avanzado = Boolean(kinds.length || cats.length || query.min || query.max || (rango && !esRapido) || r.order !== 'fecha_desc');
  const chips = [];
  for (const k of kinds) if (tracker.KINDS[k]) chips.push([tracker.KINDS[k], { ...base, tipo: kinds.filter((x) => x !== k) }]);
  for (const k of cats) {
    const label = Object.values(tracker.CATEGORIES).map((o) => o[k]).find(Boolean);
    if (label) chips.push([label, { ...base, categoria: cats.filter((x) => x !== k) }]);
  }
  if (rango && !esRapido) chips.push([desde && hasta ? `Del ${c.dateEs(desde)} al ${c.dateEs(hasta)}` : desde ? `Desde el ${c.dateEs(desde)}` : `Hasta el ${c.dateEs(hasta)}`, { ...base, desde: '', hasta: '' }]);
  if (query.q) chips.push([`«${String(query.q).slice(0, 30)}»`, { ...base, q: '' }]);
  if (query.min) chips.push([`Desde ${query.min}`, { ...base, min: '' }]);
  if (query.max) chips.push([`Hasta ${query.max}`, { ...base, max: '' }]);
  const pages = Math.max(1, Math.ceil(r.total / r.limit));
  const allCats = [...new Set(Object.values(tracker.CATEGORIES).flatMap((o) => Object.keys(o)))];
  const catLabel = (k) => Object.values(tracker.CATEGORIES).map((o) => o[k]).find(Boolean);
  return html`<div class="md md--list">
    <div class="md-head"><h1><a class="md-back" href="/mi-dinero${qs({ mes: month })}" aria-label="Volver a Mi dinero">‹</a> Movimientos</h1>
      ${rango ? html`<span class="small muted">Rango de fechas</span>` : html`<nav class="md-month" aria-label="Mes"><a href="/mi-dinero/movimientos${qs({ ...base, mes: tracker.prevMonth(month) })}" aria-label="Mes anterior">‹</a><span class="md-month-name">${monthLabel(month)}</span>${month < tracker.currentMonth() ? html`<a href="/mi-dinero/movimientos${qs({ ...base, mes: nextMonth(month) })}" aria-label="Mes siguiente">›</a>` : html`<span class="md-month-off" aria-hidden="true">›</span>`}</nav>`}</div>
    <nav class="md-quick" aria-label="Periodo">
      ${quick.map(([label, p, on]) => html`<a class="md-quick-chip" href="/mi-dinero/movimientos${qs(p)}" ${on ? raw('aria-current="true"') : ''}>${label}</a>`)}
    </nav>
    <form class="md-filters" method="get" action="/mi-dinero/movimientos" role="search">
      <input type="hidden" name="mes" value="${month}" />
      <label class="visually-hidden" for="f-q">Buscar</label>
      <input class="input" id="f-q" type="search" name="q" value="${query.q || ''}" placeholder="Buscar (por ejemplo: pan)" maxlength="60" />
      <button class="btn btn-primary" type="submit">Buscar</button>
      <details class="md-more-filters" ${avanzado ? raw('open') : ''}><summary>Más opciones</summary>
        <div class="md-filter-grid">
          <label>Desde <input class="input" type="date" name="desde" value="${desde}" max="${today}" /></label>
          <label>Hasta <input class="input" type="date" name="hasta" value="${hasta}" max="${today}" /></label>
          <label>Qué ver <select class="input" name="tipo"><option value="">Todo</option>${Object.entries(tracker.KINDS).map(([k, l]) => html`<option value="${k}" ${kinds[0] === k ? raw('selected') : ''}>${l}</option>`)}</select></label>
          <label>Categoría <select class="input" name="categoria"><option value="">Todas</option>${allCats.map((k) => html`<option value="${k}" ${cats[0] === k ? raw('selected') : ''}>${catLabel(k)}</option>`)}</select></label>
          <label>Ordenar <select class="input" name="orden">${ORDER_LABELS.map(([k, l]) => html`<option value="${k}" ${r.order === k ? raw('selected') : ''}>${l}</option>`)}</select></label>
          <label>Importe desde <input class="input" name="min" inputmode="decimal" value="${query.min || ''}" /></label>
          <label>Importe hasta <input class="input" name="max" inputmode="decimal" value="${query.max || ''}" /></label>
        </div>
        <button class="btn btn-secondary btn-small" type="submit">Aplicar</button>
      </details>
    </form>
    ${chips.length ? html`<ul class="md-chips-active" aria-label="Filtros activos">${chips.map(([l, p]) => html`<li><a class="md-chip-x" href="/mi-dinero/movimientos${qs(p)}">${l} <span aria-label="Quitar">✕</span></a></li>`)}<li><a class="md-link" href="/mi-dinero/movimientos${qs({ mes: month })}">Limpiar todo</a></li></ul>` : ''}
    <p class="small muted" role="status" aria-live="polite">${r.total > r.limit ? `Mostrando ${(r.page - 1) * r.limit + 1}–${Math.min(r.total, r.page * r.limit)} de ${r.total} movimientos` : `${r.total} ${r.total === 1 ? 'movimiento' : 'movimientos'}`}${chips.length ? ' con estos filtros' : ''}</p>
    ${r.items.length ? groupedRows(r.items, cur, today) : html`<div class="empty"><h3>No hay movimientos con estos filtros</h3><p>Prueba quitar algún filtro.</p></div>`}
    ${pages > 1
      ? html`<nav class="md-pager" aria-label="Páginas">${r.page > 1 ? html`<a class="btn btn-secondary btn-small" href="/mi-dinero/movimientos${qs({ ...base, pagina: r.page - 1 })}">‹ Anterior</a>` : ''}<span class="small muted">Página ${r.page} de ${pages}</span>${r.page < pages ? html`<a class="btn btn-secondary btn-small" href="/mi-dinero/movimientos${qs({ ...base, pagina: r.page + 1 })}">Siguiente ›</a>` : ''}</nav>`
      : ''}
  </div>`;
}

// ───────── Formulario sin JavaScript (nuevo y editar) ─────────
function formPage(ctx, d) {
  const { cur, form = {}, errors = {}, action, submit, title, confirm = null, deleteAction = null, userId } = d;
  const kindcat = form.kindcat || 'gasto:alimentacion';
  const options = SHEET_KINDS.map(
    (k) => html`<optgroup label="${tracker.KINDS[k]}">${tracker.categoryUsage(userId, k).map((code) => html`<option value="${k}:${code}" ${kindcat === `${k}:${code}` ? raw('selected') : ''}>${tracker.KINDS[k]}: ${tracker.CATEGORIES[k][code]}</option>`)}</optgroup>`
  );
  return html`<div class="md md--form">
    <div class="md-head"><h1><a class="md-back" href="/mi-dinero" aria-label="Volver a Mi dinero">‹</a> ${title}</h1></div>
    <form method="post" action="${action}" novalidate class="md-form">
      ${c.csrfField(ctx)}
      ${c.errorSummary(errors)}
      <div class="field"><label for="f-amount">Importe</label>${c.moneyInput({ name: 'amount', value: form.amount, currency: cur, errors })}</div>
      <div class="field"><label for="f-kindcat">Tipo y categoría</label><select class="input" id="f-kindcat" name="kindcat" ${c.invalid(errors, 'kind')}>${options}</select>${c.errorText(errors, 'kind')}${c.errorText(errors, 'category')}</div>
      <div class="field"><label for="f-date">Fecha</label><input class="input" type="date" id="f-date" name="date" value="${form.date || new Date().toISOString().slice(0, 10)}" ${c.invalid(errors, 'date')} />${c.errorText(errors, 'date')}</div>
      <div class="field"><label for="f-note">Nota (opcional)</label><input class="input" id="f-note" name="note" maxlength="140" value="${form.note || ''}" /></div>
      ${confirm ? html`<div class="note note--warn" role="alert"><p>${confirm}</p><label class="check"><input type="checkbox" name="confirmar" value="1" /> Sí, guardarlo así</label></div>` : ''}
      <div class="actions"><button class="btn btn-primary" type="submit">${submit}</button></div>
    </form>
    ${deleteAction ? html`<form method="post" action="${deleteAction}" data-confirm="¿Eliminar este movimiento? Los totales se recalcularán.">${c.csrfField(ctx)}<button class="btn btn-danger" type="submit">Eliminar movimiento</button></form>` : ''}
  </div>`;
}

module.exports = { hub, listPage, formPage, analisisPage, monthLabel, qs };
