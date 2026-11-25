'use strict';
// Los 14 puntos del Plan Maestro en pantalla. Cada punto va plegado para no llenar la página de texto;
// se abren de entrada las cinco decisiones y las acciones de mayor impacto.
const { html, raw } = require('../lib/html');

const OPEN = new Set(['PM14', 'PM02']);
const ORDER = ['PM14', 'PM02', 'PM01', 'PM03', 'PM04', 'PM05', 'PM06', 'PM07', 'PM08', 'PM09', 'PM10', 'PM11', 'PM12', 'PM13'];

function block(b) {
  const h = b.title ? html`<h3>${b.title}</h3>` : '';
  if (b.type === 'figures') return html`${h}<ul class="figures">${b.items.map((x) => html`<li class="${x.total ? 'total' : ''}"><span class="k">${x.k}</span><span class="v">${x.v}</span></li>`)}</ul>`;
  if (b.type === 'list') return html`${h}<ul class="ticklist">${b.items.map((x) => html`<li>${x}</li>`)}</ul>`;
  if (b.type === 'text') return html`${h}<p class="muted">${b.text}</p>`;
  if (b.type === 'table') return html`${h}<div class="table-wrap"><table class="data compare stack-sm"><thead><tr>${b.head.map((x) => html`<th>${x}</th>`)}</tr></thead><tbody>${b.rows.map((r) => html`<tr>${r.map((x, i) => html`<td data-label="${b.head[i]}">${i ? x : html`<strong>${x}</strong>`}</td>`)}</tr>`)}</tbody></table></div>`;
  if (b.type === 'cards') return html`${h}<div class="pm-cards">${b.items.map((c) => html`<article class="pm-card"><h4>${c.title}${c.tag ? html` <span class="status-pill">${c.tag}</span>` : ''}</h4>${c.lines.map(([k, v]) => (k ? html`<p><strong>${k}:</strong> ${v}</p>` : html`<p>${v}</p>`))}</article>`)}</div>`;
  return '';
}

function maestroView(m) {
  if (!m) return html`<div class="note"><strong>Esta versión del plan es anterior.</strong> Haz de nuevo la evaluación y genera una versión nueva para recibir los 14 puntos del Plan Maestro.</div>`;
  const by = Object.fromEntries(m.sections.map((s) => [s.id, s]));
  return html`<section class="plan-block" aria-labelledby="b-maestro">
    <h2 id="b-maestro">Tu Plan Maestro de Crecimiento Patrimonial</h2>
    <p class="muted">Toca cada parte para abrirla. Todo se calcula con lo que declaraste; son orientaciones y no garantizan resultados.</p>
    ${ORDER.filter((id) => by[id]).map((id) => html`<details class="pm-section" id="${id.toLowerCase()}" ${OPEN.has(id) ? raw('open') : ''}><summary><strong>${by[id].title}</strong></summary><div class="pm-body"><p>${by[id].intro}</p>${by[id].blocks.map(block)}</div></details>`)}
  </section>`;
}

module.exports = { maestroView, ORDER };
