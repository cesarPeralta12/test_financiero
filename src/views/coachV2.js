'use strict';
// El Coach como conversación de tarjetas (docs/coach-v2/08 §4). Todo se renderiza en el servidor:
// cada botón y cada sugerencia es un formulario que funciona sin JavaScript; public/js/coach-v2.js
// los envía con fetch y agrega la respuesta sin recargar. Cada respuesta indica su origen con texto.
const { html, raw } = require('../lib/html');
const money = require('../lib/money');
const tracker = require('../domain/tracker');
const G = require('../domain/coach/graficos');
const c = require('./components');

const ACCION_ETIQUETA = { confirmar: 'Confirmar', cancelar: 'Cancelar', deshacer: 'Deshacer', consulta: 'Consulta', corregir: 'Corregir', repetir_ultimo: 'Repetir el último', proponer_tarea: 'Crear tarea', proponer_completar_tarea: 'Marcar como hecha' };
const SEV = { alerta: 'Alerta', atencion: 'Atención', logro: 'Logro' };
const ORIGEN = { regla: 'Respuesta calculada', plantilla: 'Respuesta calculada', boton: 'Respuesta calculada', cache: 'Respuesta calculada', ia: 'Redactada con IA' };
const ENVIAN = ['confirmar', 'cancelar', 'deshacer', 'consulta', 'repetir_ultimo', 'proponer_tarea', 'proponer_completar_tarea'];
const ENLACES = { abrir_ranking: '/mi-dinero/analisis', abrir_grafico: '/mi-dinero/analisis', abrir_insights: '/mi-dinero/analisis', abrir_detalle: '/mi-dinero/analisis', abrir_registro: '/mi-dinero/nuevo', simular: '/calculadora/simulador', cambiar_estrategia: '/calculadora/deudas', editar: '/mi-dinero/movimientos' };

const iconoCalculo = raw('<svg viewBox="0 0 24 24" aria-hidden="true" class="cv-ico"><rect x="4" y="3" width="16" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8h8M8 12h2m4 0h2M8 16h2m4 0h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>');

function formAccion(ctx, campos, etiqueta, { clase = 'btn btn-secondary btn-small', extra = '' } = {}) {
  return html`<form class="cv-act" method="post" action="/coach/enviar" data-cv-form>${c.csrfField(ctx)}${Object.entries(campos).map(([k, v]) => (v === undefined || v === null ? '' : html`<input type="hidden" name="${k}" value="${v}" />`))}<input type="hidden" name="etiqueta" value="${etiqueta}" /><button class="${clase}" type="submit">${etiqueta}${extra ? raw(extra) : ''}</button></form>`;
}

/** Corregir un dato de la propuesta pendiente: categoría (fichas), importe o fecha; cada opción es un formulario. */
function corregir(ctx, b, m) {
  const mensajeId = m.id;
  const pd = m.pendiente || {};
  const tipo = pd.propuesta && pd.propuesta.tipo;
  if (b.campo === 'categoria' && tipo && tracker.CATEGORIES[tipo]) {
    return html`<details class="cv-fix"><summary>${b.etiqueta}</summary><div class="cv-fix-body">${Object.entries(tracker.CATEGORIES[tipo]).map(([code, label]) => formAccion(ctx, { accion: 'corregir', campo: 'categoria', valor: code, mensaje_id: mensajeId }, label, { clase: 'cv-chip' }))}</div></details>`;
  }
  if (b.campo === 'importe') {
    return html`<details class="cv-fix"><summary>${b.etiqueta}</summary><form class="cv-act cv-fix-body" method="post" action="/coach/enviar" data-cv-form>${c.csrfField(ctx)}<input type="hidden" name="accion" value="corregir" /><input type="hidden" name="campo" value="importe" /><input type="hidden" name="mensaje_id" value="${mensajeId}" /><input type="hidden" name="etiqueta" value="Importe corregido" /><label class="visually-hidden" for="cv-imp-${mensajeId}">Importe</label><input class="input" id="cv-imp-${mensajeId}" name="valor" inputmode="decimal" autocomplete="off" required placeholder="Importe" /><button class="btn btn-secondary btn-small" type="submit">Corregir</button></form></details>`;
  }
  if (b.campo === 'fecha') {
    return html`<details class="cv-fix"><summary>${b.etiqueta}</summary><form class="cv-act cv-fix-body" method="post" action="/coach/enviar" data-cv-form>${c.csrfField(ctx)}<input type="hidden" name="accion" value="corregir" /><input type="hidden" name="campo" value="fecha" /><input type="hidden" name="mensaje_id" value="${mensajeId}" /><input type="hidden" name="etiqueta" value="Fecha corregida" /><label class="visually-hidden" for="cv-fec-${mensajeId}">Fecha</label><input class="input" type="date" id="cv-fec-${mensajeId}" name="valor" required /><button class="btn btn-secondary btn-small" type="submit">Corregir</button></form></details>`;
  }
  return '';
}

function boton(ctx, b, m) {
  if (b.accion === 'corregir') return corregir(ctx, b, m);
  if (ENVIAN.includes(b.accion)) {
    const p = b.params || {};
    const campos = { accion: b.accion, mensaje_id: p.mensaje_id, intencion: b.intencion };
    return formAccion(ctx, campos, b.etiqueta, { clase: b.accion === 'confirmar' ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small' });
  }
  const destino = b.accion === 'ir' ? b.destino : ENLACES[b.accion];
  if (destino) return html`<a class="btn btn-secondary btn-small" href="${destino}">${b.etiqueta}</a>`;
  if (b.accion === 'silenciar' || b.accion === 'activar_sonido') return html`<button class="btn btn-secondary btn-small" type="button" data-cv-sonido>${b.etiqueta}</button>`;
  return '';
}

function tarjetaDatos(t, cur) {
  if (!t || !t.filas) return '';
  void cur;
  return html`<div class="cv-card"><h4>${t.titulo}</h4><table><tbody>${t.filas.map((f) => html`<tr>${f.map((x, i) => (i ? html`<td>${x}</td>` : html`<th scope="row">${x}</th>`))}</tr>`)}</tbody></table></div>`;
}

/** Tarjeta del Coach. `m`: { id, intencion, origen, mensaje:{texto,severidad}, tarjetas, graficos, botones, pendiente }. */
function tarjeta(ctx, m, { activa = false, cur = 'USD' } = {}) {
  const sev = m.mensaje.severidad;
  const botones = activa ? (m.botones || []).map((b) => boton(ctx, b, m)) : [];
  return html`<div class="cv-msg cv-msg--coach" role="listitem" data-id="${m.id}" data-intent="${m.intencion || ''}">
    <div class="cv-meta"><span class="cv-origin">${iconoCalculo}${ORIGEN[m.origen] || ORIGEN.regla}</span>${SEV[sev] ? html`<span class="cv-sev cv-sev--${sev}">${SEV[sev]}</span>` : ''}</div>
    <div class="cv-bubble">
      <p class="cv-text">${m.mensaje.texto}</p>
      ${(m.tarjetas || []).map((t) => tarjetaDatos(t, cur))}
      ${(m.graficos || []).map((g) => html`<div class="cv-chart">${raw(G.render(g))}</div>`)}
      ${m.pendiente && m.pendiente.estado === 'pendiente' && activa ? html`<p class="cv-pend small muted">Aún no se guardó nada: confirma o cancela.</p>` : ''}
    </div>
    ${botones.length ? html`<div class="cv-actions" role="group" aria-label="Acciones de esta respuesta">${botones}</div>` : ''}
  </div>`;
}

const usuario = (texto) => html`<div class="cv-msg cv-msg--usuario" role="listitem"><span class="visually-hidden">Tú: </span>${texto}</div>`;
const errorTarjeta = (mensaje) => html`<div class="cv-msg cv-msg--error" role="alert"><div class="cv-bubble"><p class="cv-text">${mensaje}</p></div></div>`;

function chips(ctx, lista) {
  return html`<div class="cv-chips" data-chips role="group" aria-label="Sugerencias">${lista.map((s) => {
    if (s.accion === 'ir') return html`<a class="cv-sugerencia" href="${s.destino}">${s.etiqueta}</a>`;
    return html`<form class="cv-act" method="post" action="/coach/enviar" data-cv-form>${c.csrfField(ctx)}<input type="hidden" name="accion" value="consulta" /><input type="hidden" name="intencion" value="${s.intencion}" /><input type="hidden" name="etiqueta" value="${s.etiqueta}" /><button class="cv-sugerencia" type="submit">${s.etiqueta}</button></form>`;
  })}</div>`;
}

/** Mensajes guardados → vista (solo los botones del último mensaje del Coach siguen activos). */
function historial(ctx, filas, cur) {
  const ultimo = [...filas].reverse().find((f) => f.role === 'coach' && f.origin);
  return filas.map((f) => {
    if (f.role === 'usuario') {
      const accion = /^\[(\w+)\]$/.exec(f.content);
      return usuario(accion ? ACCION_ETIQUETA[accion[1]] || 'Consulta' : f.content);
    }
    if (f.role === 'sistema') return html`<div class="cv-msg cv-msg--sistema" role="listitem"><div class="cv-bubble">${f.content}</div></div>`;
    if (!f.origin) return ''; // mensajes del Coach anterior (con otra forma): no se mezclan con las tarjetas
    const p = f.payload || {};
    return tarjeta(ctx, { id: f.id, intencion: f.intent, origen: f.origin, mensaje: { texto: f.content, severidad: p.severidad || 'info' }, tarjetas: p.tarjetas, graficos: p.graficos, botones: p.botones, pendiente: p.pendiente }, { activa: ultimo && ultimo.id === f.id, cur });
  });
}

function pagina(ctx, d) {
  const { filas, sugerencias, cur, vacia } = d;
  return html`<div class="cv" data-cv>
    <div class="cv-head"><h1>Coach</h1><span class="status-pill">Calcula con tus cifras</span></div>
    <p class="muted small">Responde con lo que calculó Día Uno con tus movimientos, sin inventar números. No sustituye a un profesional y no guarda cambios sin tu confirmación.</p>
    <div class="cv-chat" id="cv-chat" role="log" aria-live="polite" aria-label="Conversación con el Coach" data-chat>
      ${vacia
        ? html`<div class="cv-welcome"><div class="cv-welcome-art" aria-hidden="true">🧭</div><h2>Hola, soy tu Coach</h2><p>Puedo registrar un gasto con una frase («café 8,50»), decirte en qué se va tu dinero y qué podrías ajustar. Pregúntame o elige una sugerencia.</p></div>`
        : historial(ctx, filas, cur)}
      <div id="cv-fin" tabindex="-1"></div>
    </div>
    <div class="cv-composer">
      ${chips(ctx, sugerencias)}
      <form class="cv-form" method="post" action="/coach/enviar" data-cv-form data-cv-texto>
        ${c.csrfField(ctx)}
        <label class="visually-hidden" for="cv-msg">Mensaje para el Coach</label>
        <input class="input" id="cv-msg" name="texto" maxlength="500" autocomplete="off" placeholder="Escribe: 250 súper, cobré 800, ¿en qué gasto más?" required />
        <button class="btn btn-primary" type="submit">Enviar</button>
      </form>
    </div>
  </div>`;
}

/** Fragmento que el navegador agrega a la conversación: lo que se pidió, la tarjeta y las sugerencias nuevas. */
function fragmento(ctx, { texto, respuesta, error, sugerencias, cur }) {
  return html`${texto ? usuario(texto) : ''}${error ? errorTarjeta(error) : tarjeta(ctx, { id: respuesta.id, intencion: respuesta.intencion, origen: respuesta.origen, mensaje: respuesta.mensaje, tarjetas: respuesta.tarjetas, graficos: respuesta.graficos, botones: respuesta.botones, pendiente: respuesta.propuesta ? { estado: 'pendiente', propuesta: respuesta.propuesta.propuesta } : null }, { activa: true, cur })}${chips(ctx, sugerencias)}`;
}

module.exports = { pagina, fragmento, tarjeta, usuario, chips, historial, errorTarjeta, ACCION_ETIQUETA };
void money;
