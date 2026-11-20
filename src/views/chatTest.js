'use strict';
// Test gratuito como una sola conversación: Día Uno se presenta, hace las preguntas en el
// mismo chat y la persona responde en la caja de abajo. Sin JavaScript también funciona:
// la caja envía un formulario normal y la página vuelve con la siguiente pregunta.
const { html } = require('../lib/html');
const c = require('./components');

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function welcomeLines(name) {
  const first = name ? cap(String(name).trim().split(/\s+/)[0]) : '';
  return [`¡Hola${first ? `, ${first}` : ''}! 👋 Soy tu asistente financiero.`, 'Te ayudaré en base a tu resultado.', 'Responde como te sientas cómodo.'];
}

const bot = (text, cls = '') => html`<li class="chat-msg chat-msg--bot ${cls}">${text}</li>`;
const me = (text) => html`<li class="chat-msg chat-msg--me">${text}</li>`;

/** Mensajes de una pregunta: el texto y, si ayuda, una aclaración corta. */
function questionMsgs(q) {
  return html`${bot(q.text, 'chat-q')}${q.help ? bot(q.help, 'chat-help') : ''}`;
}
function chips(q) {
  if (!q || !q.chips || !q.chips.length) return '';
  return html`${q.chips.map((x) => html`<button type="button" class="chat-chip" data-say="${x}">${x}</button>`)}`;
}

/**
 * o: { name, started, history: [{ q, a }], current: { text, help, chips, placeholder } | null,
 *      done, error, csrf, progress: { pos, total } }
 */
function chatPage(ctx, o) {
  const lines = welcomeLines(o.name);
  const showStart = !o.started;
  return html`<section class="chat-test${showStart ? ' is-welcome' : ''}" aria-labelledby="h-chat" data-state="${showStart ? 'welcome' : o.done ? 'done' : 'asking'}">
    <h1 id="h-chat" class="visually-hidden">Test gratuito</h1>
    <header class="chat-head">
      <span class="chat-avatar" aria-hidden="true">D1</span>
      <div><strong>Día Uno</strong><span class="small muted">Asistente financiero</span></div>
      ${o.progress && o.started ? html`<span class="chat-progress small muted" aria-label="Avance">${o.progress.pos} de ${o.progress.total}</span>` : ''}
    </header>
    <ol class="chat-log" aria-live="polite">
      ${lines.map((l) => bot(l, 'chat-intro-msg'))}
      ${o.started ? html`<li class="chat-msg chat-msg--me">¡Empecemos!</li>` : ''}
      ${o.history.map((h) => html`${bot(h.q, 'chat-q')}${me(h.a)}`)}
      ${o.started && o.current ? questionMsgs(o.current) : ''}
      ${o.error ? bot(o.error, 'chat-error') : ''}
      ${o.done ? bot('¡Listo! Ya tengo lo que necesito para preparar tu resultado. 🎉', 'chat-q') : ''}
    </ol>
    ${showStart
      ? html`<div class="chat-start-wrap"><form method="get" action="/test"><input type="hidden" name="empezar" value="1" /><button class="btn btn-primary btn-lg chat-start" type="submit">Iniciar</button></form></div>`
      : o.done
        ? html`<form class="chat-finish" method="post" action="/test/finalizar">${c.csrfField(ctx)}<button class="btn btn-primary btn-lg" type="submit">Ver mi resultado</button>
            <a class="small muted" href="/test/revision">Revisar mis respuestas</a></form>`
        : html`<form class="chat-bar" method="post" action="/test/chat" autocomplete="off">
            ${c.csrfField(ctx)}
            <div class="chat-chips" aria-label="Respuestas rápidas">${chips(o.current)}</div>
            <div class="chat-compose">
              <label class="visually-hidden" for="texto">Escribe tu respuesta</label>
              <input class="input chat-input" id="texto" name="texto" type="text" maxlength="200" required placeholder="${(o.current && o.current.placeholder) || 'Escribe tu respuesta'}" />
              <button class="chat-send" type="submit" aria-label="Enviar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2-7-8-1z" fill="currentColor"/></svg></button>
            </div>
          </form>`}
  </section>`;
}

module.exports = { chatPage, welcomeLines };
