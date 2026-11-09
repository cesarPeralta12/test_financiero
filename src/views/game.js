'use strict';
// Piezas visuales del juego: mapa de mundos, tarjeta del jugador y logros.
const { html, raw } = require('../lib/html');
const game = require('../domain/game');

const WORLDS = [
  { icon: 'flag', title: 'Test gratuito', text: 'Descubre tu punto de partida.', reward: '+100 XP' },
  { icon: 'scan', title: 'Evaluación', text: 'Tu radiografía con cifras exactas.', reward: '+250 XP' },
  { icon: 'calendar', title: 'Plan Maestro', text: '90 días de misiones y un mapa de 12 meses.', reward: '+150 XP' },
  { icon: 'rocket', title: 'Acompañamiento', text: 'Coach, calculadora y misiones diarias.', reward: '+40 XP por misión' },
];

/** states: arreglo de 'done' | 'current' | '' por mundo; links opcionales [href, texto]. */
function worldMap(states = [], links = []) {
  return html`<div class="world-map">
    <ol>
      ${WORLDS.map(
        (w, i) => html`<li class="world ${states[i] || ''}">
          <div class="world-node">${raw(game.icon(states[i] === 'done' ? 'check' : states[i] === 'current' ? w.icon : i === 0 ? w.icon : 'lock'))}<span class="world-num">${i + 1}</span></div>
          <h3>${w.title}</h3>
          <p>${w.text}</p>
          <span class="reward">${w.reward}</span>
          ${links[i] ? html`<a class="go" href="${links[i][0]}">${links[i][1]}</a>` : ''}
        </li>`
      )}
    </ol>
  </div>`;
}

function playerCard(user, g, { title = null } = {}) {
  const pct = Math.round(g.progress * 100);
  return html`<section class="player" aria-label="Tu progreso">
    <div class="player-badge">${g.level}<small>NIVEL</small></div>
    <div>
      <h2>${title || (user.name ? `${user.name}` : 'Tu partida')}</h2>
      <p class="lvl-name">${g.name}</p>
      <div class="xpbar" role="img" aria-label="${g.xp} XP de ${g.next || g.xp}"><span style="width:${pct}%"></span></div>
      <div class="player-meta">
        <span class="chip gold">${raw(game.icon('bolt'))}<b>${g.xp.toLocaleString('es')}</b> XP${g.next ? `, faltan ${g.toNext.toLocaleString('es')} para el nivel ${g.level + 1}` : ''}</span>
        <span class="chip fire">${raw(game.icon('flame'))}<b>${g.streak}</b> ${g.streak === 1 ? 'día' : 'días'} de racha</span>
        <span class="chip violet">${raw(game.icon('trophy'))}<b>${g.unlockedCount}</b> de ${g.achievements.length} logros</span>
      </div>
    </div>
  </section>`;
}

function achievementGrid(list) {
  return html`<div class="ach-grid">
    ${list.map(
      (a) => html`<div class="ach ${a.unlocked ? 'on' : 'off'}">
        <div class="ach-ico">${raw(game.icon(a.unlocked ? a.icon : 'lock'))}</div>
        <h3>${a.title}</h3>
        <p>${a.desc}</p>
      </div>`
    )}
  </div>`;
}

function xpTag(n) {
  return html`<span class="xp-tag">${raw(game.icon('bolt'))}+${n} XP</span>`;
}

module.exports = { worldMap, playerCard, achievementGrid, xpTag, WORLDS };
