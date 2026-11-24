'use strict';
// Escena entre bloques del test (ver domain/free/scenes.js).
const { html, raw } = require('../lib/html');

// Chispas que orbitan el orbe: ángulo, distancia, tamaño y retraso del titileo.
const SPARKS = [
  [0, 96, 6, 0],
  [60, 104, 4, 0.6],
  [120, 92, 7, 1.1],
  [180, 100, 4, 1.7],
  [240, 94, 6, 0.3],
  [300, 106, 5, 1.4],
];

function aura() {
  return html`<div class="aura" data-aura data-phase="idle" aria-hidden="true">
    <span class="aura-halo"></span><span class="aura-halo aura-halo--2"></span><span class="aura-halo aura-halo--3"></span>
    <span class="aura-orbit">${raw(SPARKS.map(([a, r, s, d]) => `<i style="--a:${a}deg;--r:${r}px;--s:${s}px;--d:${d}s"></i>`).join(''))}</span>
    <span class="aura-core"></span>
  </div>`;
}

function scenePage(scene, { continueHref }) {
  const pause = scene.kind === 'pausa';
  return html`<section class="scene scene--${scene.kind}" aria-labelledby="scene-title">
    <p class="scene-block">${scene.blockName}</p>
    ${pause ? aura() : html`<div class="scene-art" aria-hidden="true"><i></i><i></i><i></i></div>`}
    ${pause ? html`<p class="breath-label" data-breath-label aria-live="polite">Cuando quieras</p>` : ''}
    <h1 class="scene-title" id="scene-title">${scene.title}</h1>
    <p class="scene-text">${scene.text}</p>
    ${pause
      ? html`<p class="scene-caption" data-breath-caption>Toca «Respirar conmigo» y sigue el círculo. Dura unos 30 segundos.</p>
        <button class="btn btn-secondary scene-breathe" type="button" data-breathe>Respirar conmigo</button>`
      : ''}
    <a class="btn btn-primary scene-next" href="${continueHref}" data-scene-next>Continuar</a>
  </section>`;
}

module.exports = { scenePage };
