// Coach v2: conversación de tarjetas sin recargar. Cada botón y sugerencia es un formulario que ya funciona
// sin JavaScript; aquí se envían con fetch, se agrega la tarjeta con una animación suave y suena un pop.
(function () {
  'use strict';
  var root = document.querySelector('[data-cv]');
  if (!root) return;
  var chat = root.querySelector('[data-chat]');
  var fin = document.getElementById('cv-fin');
  var motion = document.documentElement.classList.contains('motion');
  var Sfx = window.Sfx;
  var busy = false;

  // ───────── Sonido (misma preferencia que el resto) ─────────
  function pref() { try { return window.localStorage.getItem('du-sfx') !== 'off'; } catch (e) { return true; } }
  var soundOn = pref();
  if (Sfx) Sfx.configurar({ activo: soundOn, volumen: 0.3 });
  function play(name) { if (Sfx && soundOn) { Sfx.iniciar(); Sfx.sonar(name); } }
  var head = root.querySelector('.cv-head');
  if (Sfx && head) {
    var tg = document.createElement('button');
    tg.type = 'button';
    tg.className = 'qf-sound';
    tg.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    tg.setAttribute('aria-label', 'Sonidos');
    tg.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path class="qf-sound-waves" d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    tg.addEventListener('click', function () {
      soundOn = !soundOn;
      try { window.localStorage.setItem('du-sfx', soundOn ? 'on' : 'off'); } catch (e) { /* sin almacenamiento */ }
      Sfx.configurar({ activo: soundOn });
      tg.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
      if (soundOn) { Sfx.iniciar(); window.setTimeout(function () { Sfx.sonar('punto'); }, 70); }
    });
    head.appendChild(tg);
  }

  // Sonido según lo que ocurrió (nunca depende solo del sonido: el texto lo dice igual).
  var SONIDO = { registrar_gasto_ok: 'gasto', registrar_ingreso_ok: 'ingreso', primer_registro: 'meta', registrar_pago_deuda_ok: 'gasto', registrar_ahorro_ok: 'racha', registrar_retiro_ok: 'gasto', tarea_creada: 'punto', tarea_completada_ok: 'meta', deshacer_ok: 'deshacer', cancelado: 'tick', registro_importe_alto: 'error', registro_duplicado_posible: 'error', registro_fecha_futura: 'error', error_generico: 'error' };

  function scrollEnd() {
    if (fin && fin.scrollIntoView) fin.scrollIntoView({ block: 'end', behavior: motion ? 'smooth' : 'auto' });
  }

  function typing() {
    var t = document.createElement('div');
    t.className = 'cv-msg cv-msg--coach cv-typing';
    t.setAttribute('role', 'status');
    t.innerHTML = '<div class="cv-bubble"><span class="visually-hidden">El Coach está calculando…</span><i></i><i></i><i></i></div>';
    chat.insertBefore(t, fin);
    scrollEnd();
    return t;
  }

  var mia = false;
  function insertar(htmlText) {
    var tpl = document.createElement('template');
    tpl.innerHTML = htmlText;
    var nuevas = tpl.content.querySelector('[data-chips]');
    if (nuevas) {
      nuevas.remove();
      var viejas = root.querySelector('.cv-composer [data-chips]');
      if (viejas) viejas.replaceWith(nuevas);
    }
    // Solo la última respuesta tiene botones activos: se retiran los de las anteriores.
    chat.querySelectorAll('.cv-actions, .cv-pend').forEach(function (n) { n.remove(); });
    var bienvenida = chat.querySelector('.cv-welcome');
    if (bienvenida) bienvenida.remove();
    var intent = (tpl.content.querySelector('.cv-msg--coach') || {}).dataset;
    // Tu mensaje ya se mostró al enviarlo.
    if (mia) tpl.content.querySelectorAll('.cv-msg--usuario').forEach(function (n) { n.remove(); });
    chat.insertBefore(tpl.content, fin);
    play((intent && SONIDO[intent.intent]) || 'recibir');
    scrollEnd();
  }

  function enviar(form) {
    if (busy) return;
    busy = true;
    // El cuerpo se arma ANTES de desactivar los campos (FormData ignora los desactivados).
    var cuerpo = new URLSearchParams(new FormData(form));
    var botones = form.querySelectorAll('button, input');
    botones.forEach(function (b) { if (b.type !== 'hidden') b.disabled = true; });
    var t0 = Date.now();
    var dicho = (cuerpo.get('texto') || cuerpo.get('etiqueta') || '').trim();
    mia = Boolean(dicho);
    if (dicho) {
      var bienvenida = chat.querySelector('.cv-welcome');
      if (bienvenida) bienvenida.remove();
      var yo = document.createElement('div');
      yo.className = 'cv-msg cv-msg--usuario';
      yo.setAttribute('role', 'listitem');
      yo.textContent = dicho;
      chat.insertBefore(yo, fin);
      if (form.hasAttribute('data-cv-texto')) form.querySelector('input[name=texto]').value = '';
    }
    var ind = typing();
    play('enviar');
    window.fetch(form.action, { method: 'POST', credentials: 'same-origin', headers: { 'X-Fragment': '1', 'Content-Type': 'application/x-www-form-urlencoded' }, body: cuerpo.toString() })
      .then(function (r) { return r.text(); })
      .then(function (txt) {
        // Un respiro mínimo para dar ritmo (solo con movimiento).
        var espera = motion ? Math.max(0, 320 - (Date.now() - t0)) : 0;
        window.setTimeout(function () {
          ind.remove();
          insertar(txt);
          if (form.hasAttribute('data-cv-texto')) { var inp = form.querySelector('input[name=texto]'); if (inp) inp.focus(); }
          busy = false;
          botones.forEach(function (b) { b.disabled = false; });
        }, espera);
      })
      .catch(function () {
        ind.remove();
        if (form.hasAttribute('data-cv-texto')) form.querySelector('input[name=texto]').value = dicho;
        var e = document.createElement('div');
        e.className = 'cv-msg cv-msg--error';
        e.setAttribute('role', 'alert');
        e.innerHTML = '<div class="cv-bubble"><p class="cv-text">Sin conexión. Tu mensaje no se envió; inténtalo de nuevo cuando vuelva.</p></div>';
        chat.insertBefore(e, fin);
        play('error');
        busy = false;
        botones.forEach(function (b) { b.disabled = false; });
      });
  }

  root.addEventListener('submit', function (e) {
    var f = e.target.closest && e.target.closest('form[data-cv-form]');
    if (!f) return;
    e.preventDefault();
    enviar(f);
  });

  scrollEnd();
})();
