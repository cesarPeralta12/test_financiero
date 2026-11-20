'use strict';
const { html, raw } = require('../lib/html');
const config = require('../config');
const game = require('../domain/game');

const FLASH = {
  sesion_cerrada: ['ok', 'Cerraste sesión.'],
  cuenta_creada: ['ok', 'Tu cuenta está lista. Tus respuestas quedaron guardadas en ella.'],
  bienvenida: ['ok', 'Entraste a tu cuenta.'],
  correo_verificado: ['ok', 'Verificaste tu correo.'],
  verificacion_enviada: ['ok', 'Te enviamos un nuevo enlace de verificación.'],
  clave_cambiada: ['ok', 'Cambiaste tu contraseña. Entra con la nueva.'],
  recuperacion_enviada: ['ok', 'Si el correo tiene una cuenta, te enviamos un enlace para crear una contraseña nueva. Revisa tu bandeja.'],
  enlace_invalido: ['risk', 'El enlace no es válido o ya caducó. Pide uno nuevo.'],
  pago_cancelado: ['warn', 'Cancelaste el pago. No se hizo ningún cargo.'],
  pago_fallido: ['risk', 'La pasarela rechazó el pago. No se hizo ningún cargo; puedes intentarlo de nuevo.'],
  plan_en_cola: ['ok', 'Estamos preparando tu plan. Puede tardar unos segundos.'],
  guardado: ['ok', 'Guardado.'],
  eliminado: ['ok', 'Eliminado.'],
  restaurado: ['ok', 'Listo, lo recuperamos.'],
  plazo_vencido: ['warn', 'Ya pasó el tiempo para deshacer.'],
  observacion_descartada: ['ok', 'Listo, no te lo volveremos a mostrar por unos días.'],
  coach_error: ['warn', 'No pudimos procesar eso. Intenta con otra frase o elige una sugerencia.'],
  repetido: ['ok', 'Repetimos tu último movimiento con la fecha de hoy.'],
  sin_movimientos: ['warn', 'Aún no tienes movimientos que repetir.'],
  tarea_completada: ['ok', 'Marcaste la tarea como completada.'],
  tarea_pospuesta: ['ok', 'Pospusiste la tarea.'],
  tarea_reabierta: ['ok', 'Reabriste la tarea.'],
  escenario_guardado: ['ok', 'Guardaste el escenario. Tus datos reales no cambiaron.'],
  solicitud_enviada: ['ok', 'Recibimos tu solicitud. Te avisaremos por correo cuando esté resuelta.'],
  publicado: ['ok', 'Publicado. Las evaluaciones terminadas conservan su versión.'],
  borrador_creado: ['ok', 'Borrador creado a partir de la versión publicada.'],
  sin_cambios: ['warn', 'No había cambios que guardar.'],
};

function brand() {
  return html`<a class="brand" href="/" aria-label="Día Uno, inicio"
    ><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>Día Uno</a
  >`;
}

function navLinks(ctx) {
  const cur = ctx.active;
  // Dentro de «Mi dinero» cada pantalla marca su propia opción (no siempre «Resumen»).
  const path = ctx.path || '';
  const curEff = cur === 'midinero' ? (path.startsWith('/mi-dinero/movimientos') ? 'md-mov' : path.startsWith('/mi-dinero/atajos') ? 'md-atajos' : path.startsWith('/mi-dinero/analisis') ? 'md-analisis' : 'midinero') : cur;
  const a = (href, label, key, extra = null) =>
    html`<a href="${href}" ${curEff === key ? raw('aria-current="page"') : ''}>${label}${extra}</a>`;
  if (!ctx.user) {
    return html`<a href="/entrar" ${cur === 'entrar' ? raw('aria-current="page"') : ''}>Entrar</a>`;
  }
  // Un grupo es un <details>: funciona sin JavaScript y el script solo lo cierra al tocar fuera o con Escape.
  // Si la página actual es una de sus opciones, el grupo se marca como actual.
  const grupo = (label, keys, items, { align = '', icon = '' } = {}) =>
    html`<details class="nav-menu ${align}" data-nav-menu>
      <summary ${keys.includes(cur) ? raw('data-current') : ''}>${icon ? raw(icon) : ''}<span>${label}</span></summary>
      <div class="nav-pop">${items}</div>
    </details>`;
  const unread = ctx.unread ? html`<span class="count" aria-label="${ctx.unread} sin leer">${ctx.unread}</span>` : '';
  const dinero = ctx.moneyAccess
    ? grupo(
        'Mi dinero',
        ['midinero', 'calculadora'],
        html`${a('/mi-dinero', 'Resumen', 'midinero')}${a('/mi-dinero/movimientos', 'Movimientos', 'md-mov')}${a('/mi-dinero/atajos', 'Recurrentes y atajos', 'md-atajos')}${ctx.premium ? a('/mi-dinero/analisis', 'Análisis', 'md-analisis') : ''}${a('/calculadora', 'Calculadora', 'calculadora')}`
      )
    : a('/calculadora', 'Calculadora', 'calculadora');
  const plan = grupo('Mi plan', ['plan', 'tablero', 'historial'], html`${a('/plan', 'Plan maestro', 'plan')}${a('/tablero', 'Misiones', 'tablero')}${a('/historial', 'Diagnósticos', 'historial')}`);
  const cuenta = grupo(
    'Cuenta',
    ['cuenta', 'logros', 'admin'],
    html`${a('/cuenta', 'Mi cuenta', 'cuenta')}${a('/logros', 'Logros y nivel', 'logros')}${ctx.user.role === 'admin' ? a('/admin', 'Administración', 'admin') : ''}
      <form class="nav-inline-form" method="post" action="/salir"><input type="hidden" name="_csrf" value="${ctx.csrf}" /><button class="nav-logout" type="submit">Salir</button></form>`,
    { align: 'nav-menu--right' }
  );
  return html`<div class="nav-main">${a('/inicio', 'Inicio', 'inicio')}${dinero}${a('/coach', 'Coach', 'coach')}${plan}</div>
    <div class="nav-side">${a('/avisos', 'Avisos', 'avisos', unread)}${cuenta}</div>`;
}

function hud(ctx) {
  const g = ctx.game;
  if (!g) return '';
  const pct = Math.round(g.progress * 100);
  return html`<a class="hud" href="/logros" aria-label="Nivel ${g.level}, ${g.name}. ${g.xp} XP. Racha de ${g.streak} días.">
    <span class="hud-level" aria-hidden="true"><span>${g.level}</span></span>
    <span class="hud-body" aria-hidden="true">
      <span class="hud-name">${g.name}</span>
      <span class="hud-bar"><span class="hud-fill" style="width:${pct}%"></span></span>
      <span class="hud-xp"><span data-hud-xp>${g.xp.toLocaleString('es')}</span> XP${g.next ? html`<span class="hud-next"> / ${g.next.toLocaleString('es')}</span>` : ''}</span>
    </span>
    <span class="hud-streak ${g.activeToday ? 'is-on' : ''}" aria-hidden="true">${raw(game.icon('flame', 'gi gi-flame'))}<b>${g.streak}</b></span>
  </a>`;
}

function layout(ctx, { title, body, wide = false, narrow = false, description = null, minimal = false, refresh = null, focus = false }) {
  const flash = ctx.flash && FLASH[ctx.flash];
  const wrapClass = ['wrap', wide ? 'wrap--wide' : '', narrow ? 'wrap--narrow' : '', focus ? 'wrap--focus' : ''].filter(Boolean).join(' ');
  return html`<!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title ? `${title} | Día Uno` : 'Día Uno'}</title>
        <meta name="description" content="${description || 'Test financiero gratuito, evaluación profunda y Plan Maestro para ordenar tu dinero.'}" />
        ${ctx.csrf ? html`<meta name="csrf-token" content="${ctx.csrf}" />` : ''}
        ${refresh ? html`<meta http-equiv="refresh" content="${refresh}" />` : ''}
        <meta name="theme-color" content="#0b1020" />
        <link rel="preload" href="/fonts/hanken-grotesk-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin />
        <link rel="preload" href="/fonts/bricolage-grotesque-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin />
        <link rel="stylesheet" href="/css/app.css?v=16" />
        <link rel="stylesheet" href="/css/motion.css?v=15" />
        <link rel="stylesheet" href="/css/game.css?v=25" />
        <link rel="stylesheet" href="/css/mi-dinero.css?v=9" />
        <link rel="stylesheet" href="/css/coach-v2.css?v=2" />
        <script src="/js/early.js?v=9"></script>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <script src="/js/app.js?v=14" defer></script>
        <script src="/js/game.js?v=10" defer></script>
        <script src="/js/sfx.js?v=9" defer></script>
        <script src="/js/soft-nav.js?v=1" defer></script>
        <script src="/js/test-fx.js?v=17" defer></script>
        <script src="/js/mi-dinero.js?v=3" defer></script>
        <script src="/js/coach-v2.js?v=2" defer></script>
      </head>
      <body
        data-flash="${ctx.flash || ''}"
        ${ctx.game
          ? raw(
              `data-user="${Number(ctx.user.id)}" data-xp="${ctx.game.xp}" data-level="${ctx.game.level}" data-level-name="${ctx.game.name.replace(/"/g, '')}" data-ach="${ctx.game.achievements
                .filter((a) => a.unlocked)
                .map((a) => a.code)
                .join(',')}" data-ach-titles="${ctx.game.achievements.map((a) => `${a.code}:${a.title}`).join('|')}"`
            )
          : ''}
      >
        <a class="skip" href="#contenido">Saltar al contenido</a>
        ${focus
          ? ''
          : !config.isProd
          ? html`<div class="env-banner">Entorno de ${config.env === 'testing' ? 'pruebas' : 'desarrollo'}: pagos, correos e IA pueden estar simulados.</div>`
          : config.payments.sandboxEnabled
            ? html`<div class="env-banner">Versión de prueba: los pagos son simulados y no se cobra nada.</div>`
            : ''}
        ${focus ? '' : html`<header>
          <div class="bar">
            ${brand()} ${minimal ? '' : hud(ctx)}
            ${minimal
              ? ''
              : html`${ctx.user
                    ? html`<button class="btn btn-secondary btn-small nav-toggle" type="button" aria-expanded="false" aria-controls="menu" data-nav-toggle>Menú</button>`
                    : ''}
                  <nav class="nav" id="menu" aria-label="Principal" ${ctx.user ? raw('data-collapsible') : ''}>${navLinks(ctx)}</nav>`}
          </div>
        </header>`}
        <main id="contenido" tabindex="-1">
          <div class="${wrapClass}">
            ${flash ? html`<div class="note note--${flash[0]} flash" role="status">${flash[1]}</div>` : ''} ${body}
          </div>
        </main>
        ${focus ? '' : html`<footer class="foot">
          <div class="bar">
            <span>Día Uno. Orientación financiera personal; no es asesoría profesional.</span>
            <span class="foot-links"><a href="/privacidad">Privacidad</a><a href="/condiciones">Condiciones</a></span>
          </div>
        </footer>`}
      </body>
    </html>`;
}

module.exports = { layout, FLASH };
