'use strict';
// «Mi contexto financiero actual», en la revisión antes del diagnóstico.
const { html } = require('../lib/html');

function contextoView(x) {
  return html`<section class="section ctx" aria-labelledby="h-contexto">
    <h2 id="h-contexto">Mi contexto financiero actual</h2>
    <p class="muted">Esto es lo que entendimos. Si algo no es así, tócalo para cambiarlo.</p>
    ${x.notes.map((t) => html`<div class="note note--warn"><strong>Revisa.</strong> ${t}</div>`)}
    ${x.groups.map((g) => html`<h3>${g.title}</h3><ul class="figures">${g.rows.map(([k, v, pos]) => html`<li><span class="k">${k}</span><span class="v" data-counted="1">${pos ? html`<a href="/evaluacion/pregunta/${pos}?volver=revision">${v}</a>` : v}</span></li>`)}</ul>`)}
  </section>`;
}

module.exports = { contextoView };
