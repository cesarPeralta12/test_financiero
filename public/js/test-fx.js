// Test gratuito: sonido opcional, efecto al elegir, partículas mágicas que llenan la barra,
// pausa de respiración guiada y entrada según la dirección.
// Mejora progresiva: sin este archivo el test funciona igual (formulario normal).
(function () {
  'use strict';
  var root = document.documentElement;
  var motion = root.classList.contains('motion');
  var Sfx = window.Sfx;

  var store = {
    get: function (k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
    del: function (k) { try { window.sessionStorage.removeItem(k); } catch (e) { /* sin almacenamiento */ } },
  };
  // Sonido: encendido y suave por defecto; la persona puede apagarlo con el altavoz.
  function pref() { try { return window.localStorage.getItem('du-sfx') !== 'off'; } catch (e) { return true; } }
  function savePref(on) { try { window.localStorage.setItem('du-sfx', on ? 'on' : 'off'); } catch (e) { /* sin almacenamiento */ } }
  var soundOn = pref();
  if (Sfx) Sfx.configurar({ activo: soundOn, volumen: 0.3 });
  function play(name) { if (Sfx && soundOn) { Sfx.iniciar(); Sfx.sonar(name); } }
  // Capas que deben superponerse (sin límite de ráfaga).
  function layer(name) { if (Sfx && soundOn) { Sfx.iniciar(); Sfx.superponer(name); } }
  function chime(i) { if (Sfx && soundOn) { Sfx.iniciar(); Sfx.chispa(i); } }

  function addToggle(host, floating) {
    if (!Sfx || !host) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qf-sound' + (floating ? ' qf-sound--float' : '');
    btn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    btn.setAttribute('aria-label', 'Sonidos y música del test');
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path class="qf-sound-waves" d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    btn.addEventListener('click', function () {
      soundOn = !soundOn;
      savePref(soundOn);
      Sfx.configurar({ activo: soundOn });
      btn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
      if (soundOn) { Sfx.iniciar(); window.setTimeout(function () { Sfx.sonar('punto'); }, 70); }
    });
    host.appendChild(btn);
  }

  // ───────── Escena entre bloques ─────────
  var scenePage = document.querySelector('.scene');
  if (scenePage) {
    addToggle(scenePage, true);
    var timers = [];
    var go = scenePage.querySelector('[data-scene-next]');
    if (go) go.addEventListener('click', function () {
      timers.forEach(window.clearTimeout);
      play('punto');
    });

    // Pausa: respiración guiada de tres respiros con sonido de inhalar, exhalar y cuenco.
    var aura = scenePage.querySelector('[data-aura]');
    var breatheBtn = scenePage.querySelector('[data-breathe]');
    var label = scenePage.querySelector('[data-breath-label]');
    var caption = scenePage.querySelector('[data-breath-caption]');
    if (aura && breatheBtn && label && caption) {
      var CYCLES = 3;
      var running = false;
      var later = function (fn, ms) { timers.push(window.setTimeout(fn, ms)); };
      var setPhase = function (phase, text, cap) {
        aura.setAttribute('data-phase', phase);
        label.textContent = text;
        label.classList.remove('swap');
        void label.offsetWidth; // reinicia el fundido del texto
        label.classList.add('swap');
        caption.textContent = cap;
      };
      var finish = function () {
        setPhase('idle', 'Muy bien', 'Listo. Sigamos a tu ritmo.');
        layer('listo');
        aura.classList.remove('is-active');
        breatheBtn.textContent = 'Respirar otra vez';
        breatheBtn.removeAttribute('aria-disabled');
        running = false;
      };
      var cycle = function (n) {
        if (n >= CYCLES) { finish(); return; }
        setPhase('in', 'Inhala', 'Llena el pecho despacio');
        layer('inhala');
        later(function () { setPhase('hold', 'Sostén', 'Quédate un instante'); }, 4000);
        later(function () { setPhase('out', 'Exhala', 'Suelta la tensión'); layer('exhala'); }, 5500);
        later(function () { cycle(n + 1); }, 10500);
      };
      breatheBtn.addEventListener('click', function () {
        if (running) return;
        running = true;
        breatheBtn.textContent = 'Respirando…';
        breatheBtn.setAttribute('aria-disabled', 'true');
        aura.classList.add('is-active');
        setPhase('idle', 'Prepárate', 'Siéntate cómodo y suelta los hombros');
        layer('campana');
        later(function () { cycle(0); }, 1400);
      });
    }
  }

  var form = document.querySelector('form.qf');
  if (!form) return;

  addToggle(form.querySelector('.qf-top'), false);

  // ── Entrada de la pregunta según la dirección ──
  var body = form.querySelector('.q-body');
  var dir = store.get('du-qdir');
  store.del('du-qdir');
  if (motion && body && dir) body.classList.add(dir === 'prev' ? 'q-enter-prev' : 'q-enter-next');

  // ── Barra de avance: parte de donde quedó y crece hasta su nuevo valor ──
  var fill = form.querySelector('.qf-fill');
  if (fill) {
    var target = fill.style.width;
    var before = store.get('du-qpct');
    store.set('du-qpct', target);
    if (motion && before && before !== target) {
      fill.style.width = before;
      window.requestAnimationFrame(function () { window.requestAnimationFrame(function () { fill.style.width = target; }); });
    }
  }

  form.addEventListener('submit', function (e) {
    var action = e.submitter && e.submitter.value;
    if (action === 'next') store.set('du-qdir', 'next');
    else if (action === 'prev') store.set('du-qdir', 'prev');
  });

  // ── Cambio de pregunta sin recargar la página (navegación general, soft-nav.js) ──
  // Así la música no se corta y los sonidos de la animación terminan completos. Si algo falla, se envía de forma normal.
  var swapping = false;
  form.addEventListener('submit', function (e) {
    if (e.defaultPrevented || swapping || !window.fetch || !window.DuNav || !window.FormData) return;
    if ((form.getAttribute('method') || '').toLowerCase() !== 'post') return;
    var data;
    try { data = new URLSearchParams(new FormData(form, e.submitter)); } catch (err) { return; }
    e.preventDefault();
    swapping = true;
    fetch(form.getAttribute('action') || window.location.href, { method: 'POST', body: data, credentials: 'same-origin', headers: { Accept: 'text/html' } })
      .then(function (r) { return r.text().then(function (text) { return { r: r, text: text }; }); })
      .then(function (x) {
        if (window.DuNav.apply(x.text, x.r.url, { push: x.r.redirected })) return;
        if (x.r.redirected) { window.location.assign(x.r.url); return; }
        document.open(); document.write(x.text); document.close();
      })
      .catch(function () { swapping = false; form.submit(); });
  });

  // ── Elegir una opción: onda desde el toque, brillo y sonido agradable. No avanza solo. ──
  form.addEventListener('pointerdown', function (e) {
    if (!motion) return;
    var label = e.target.closest && e.target.closest('label.option, label.pill');
    if (!label) return;
    var r = label.getBoundingClientRect();
    var d = Math.max(r.width, r.height) * 1.6;
    var ripple = document.createElement('span');
    ripple.className = 'fx-ripple';
    ripple.style.width = ripple.style.height = d + 'px';
    ripple.style.left = e.clientX - r.left - d / 2 + 'px';
    ripple.style.top = e.clientY - r.top - d / 2 + 'px';
    label.appendChild(ripple);
    ripple.addEventListener('animationend', function () { ripple.remove(); });
  });
  form.addEventListener('change', function (e) {
    var input = e.target;
    if (!input || (input.type !== 'radio' && input.type !== 'checkbox')) return;
    if (input.name === 'special') { play('tick'); return; }
    play(input.checked ? 'punto' : 'tick');
    var label = input.closest('label');
    if (motion && label && input.checked) {
      label.classList.remove('fx-picked');
      void label.offsetWidth; // reinicia la animación
      label.classList.add('fx-picked');
    }
  });

  // ── «Siguiente»: partículas mágicas que viajan en espiral hasta la barra y la llenan ──
  function hasAnswer() {
    if (form.querySelector('input[type=radio]:checked, input[type=checkbox]:checked')) return true;
    var any = false;
    form.querySelectorAll('input:not([type=radio]):not([type=checkbox]):not([type=hidden]), select, textarea').forEach(function (el) {
      if (!el.disabled && el.value && el.closest('.q-body')) any = true;
    });
    return any;
  }
  var COLORS = ['#34d399', '#5eead4', '#a7f3d0', '#fde68a', '#c4b5fd', '#ffffff'];

  // Destello que titila en la punta de la barra cada vez que llega una partícula.
  function twinkle(x, y) {
    var s = document.createElement('span');
    s.className = 'fx-twinkle';
    var size = 10 + Math.random() * 10;
    s.style.width = s.style.height = size + 'px';
    s.style.left = x + (Math.random() - 0.5) * 30 - size / 2 + 'px';
    s.style.top = y + (Math.random() - 0.5) * 18 - size / 2 + 'px';
    document.body.appendChild(s);
    s.addEventListener('animationend', function () { s.remove(); });
  }

  function launch(from, done) {
    var progress = form.querySelector('.qf-progress');
    var track = form.querySelector('.qf-track');
    var now = progress ? Number(progress.getAttribute('aria-valuenow')) : 0;
    var max = progress ? Number(progress.getAttribute('aria-valuemax')) : 1;
    var tr = track.getBoundingClientRect();
    var fr = from.getBoundingClientRect();
    var startFrac = tr.width ? fill.getBoundingClientRect().width / tr.width : 0;
    var endFrac = Math.min(1, (now + 1) / max);
    var tx = tr.left + tr.width * endFrac;
    var ty = tr.top + tr.height / 2;
    var N = 14;
    var STEPS = 10;
    var arrived = 0;
    fill.style.transitionDuration = '0.28s';
    for (var i = 0; i < N; i++) {
      (function (i) {
        var p = document.createElement('span');
        p.className = 'fx-particle' + (i % 3 === 0 ? ' fx-particle--star' : '');
        var size = 7 + Math.random() * 8;
        var sx = fr.left + fr.width * (0.12 + Math.random() * 0.76);
        var sy = fr.top + fr.height / 2;
        p.style.width = p.style.height = size + 'px';
        p.style.left = sx - size / 2 + 'px';
        p.style.top = sy - size / 2 + 'px';
        var c = COLORS[i % COLORS.length];
        p.style.background = 'radial-gradient(circle at 35% 35%, #fff, ' + c + ' 55%, ' + c + ')';
        p.style.boxShadow = '0 0 ' + Math.round(size * 1.6) + 'px ' + c;
        p.style.color = c;
        document.body.appendChild(p);
        var dx = tx - sx;
        var dy = ty - sy;
        var amp = 26 + Math.random() * 38; // ancho de la espiral
        var turns = 1.2 + Math.random() * 1.1;
        var phase = Math.random() * Math.PI * 2;
        var lift = 40 + Math.random() * 70;
        var spin = (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 360);
        var frames = [];
        for (var k = 0; k <= STEPS; k++) {
          var t = k / STEPS;
          var e = t * t * (3 - 2 * t); // avance suave
          var wob = Math.sin(t * Math.PI * 2 * turns + phase) * amp * (1 - t);
          var x = dx * e + wob;
          var y = dy * e - lift * Math.sin(Math.PI * Math.min(1, t * 1.5)) * (1 - e);
          var s = t < 0.15 ? 0.3 + (t / 0.15) * 0.9 : 1.2 - 0.85 * ((t - 0.15) / 0.85);
          var tw = 0.75 + 0.25 * Math.sin(t * 30 + i); // titileo
          frames.push({ transform: 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + s.toFixed(2) + ') rotate(' + (spin * t).toFixed(0) + 'deg)', opacity: t === 0 ? 0 : t > 0.93 ? 0.35 : tw, offset: t });
        }
        var anim = p.animate(frames, { duration: 700 + Math.random() * 260, delay: i * 22, easing: 'linear', fill: 'both' });
        anim.onfinish = function () {
          p.remove();
          arrived++;
          chime(arrived - 1); // tintineo: cada llegada suena una nota más arriba
          twinkle(tx, ty);
          fill.style.width = (startFrac + (endFrac - startFrac) * (arrived / N)) * 100 + '%';
          fill.classList.remove('fx-hit');
          void fill.offsetWidth;
          fill.classList.add('fx-hit');
          if (arrived === N) done(Math.round(endFrac * 100) + '%');
        };
      })(i);
    }
  }

  var busy = false;
  var actionBtn = form.querySelector('.qf-actions button[value=next]');
  if (actionBtn) {
    actionBtn.addEventListener('click', function (e) {
      if (busy) { e.preventDefault(); return; }
      if (!motion || !fill || !hasAnswer()) return; // sin movimiento o sin respuesta: envío normal
      e.preventDefault();
      busy = true;
      actionBtn.classList.add('is-launching');
      layer('whoosh');
      var sent = false;
      var send = function () {
        if (sent) return;
        sent = true;
        form.requestSubmit(actionBtn);
      };
      // Red de seguridad: si la animación no termina (pestaña en segundo plano), se envía igual.
      window.setTimeout(send, 2200);
      launch(actionBtn, function (endPct) {
        // La barra ya quedó llena hasta el nuevo punto; la página siguiente no la repite.
        store.set('du-qpct', endPct);
        fill.classList.add('fx-full');
        layer('magia');
        window.setTimeout(send, 420); // deja oír el polvo de estrellas antes de cambiar de página
      });
    });
  }

  // Errores de validación: el aviso siempre es visible; el sonido solo acompaña.
  if (form.querySelector('[role=alert], .error-summary')) play('error');
})();
