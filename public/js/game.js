// Día Uno: recompensas del juego. Compara el XP, el nivel y los logros con lo que
// este navegador vio la última vez y celebra lo nuevo. Los datos los calcula el servidor.
(function () {
  'use strict';
  const body = document.body;
  const motion = document.documentElement.classList.contains('motion');
  const STAR = '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"/></svg>';

  function pop(text, anchor) {
    const el = document.createElement('div');
    el.className = 'xp-pop';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = text;
    const r = anchor ? anchor.getBoundingClientRect() : { left: window.innerWidth / 2, width: 0, top: window.innerHeight / 3 };
    el.style.left = r.left + r.width / 2 + 'px';
    el.style.top = Math.max(r.top, 20) + 'px';
    document.body.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 1500);
  }

  let stack;
  function toast(title, subtitle, delay) {
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('role', 'status');
      document.body.appendChild(stack);
    }
    setTimeout(function () {
      const t = document.createElement('div');
      t.className = 'toast';
      t.innerHTML = '<span class="ico">' + STAR + '</span><span><small></small><strong></strong></span>';
      t.querySelector('small').textContent = subtitle;
      t.querySelector('strong').textContent = title;
      stack.appendChild(t);
      setTimeout(function () {
        t.classList.add('out');
        setTimeout(function () {
          t.remove();
        }, 450);
      }, 4200);
    }, delay || 0);
  }

  function levelUp(level, name) {
    const wrap = document.createElement('div');
    wrap.className = 'levelup';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Subiste al nivel ' + level);
    wrap.innerHTML =
      '<div class="levelup-card"><div class="levelup-badge"></div><p class="kicker">¡Subiste de nivel!</p><h2></h2><p class="muted">Sigue completando misiones para desbloquear el siguiente.</p><div class="actions actions--center"><button class="btn btn-primary" type="button">¡Vamos!</button></div></div>';
    wrap.querySelector('.levelup-badge').textContent = level;
    wrap.querySelector('h2').textContent = 'Nivel ' + level + ': ' + name;
    document.body.appendChild(wrap);
    const btn = wrap.querySelector('button');
    const close = function () {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = function (e) {
      if (e.key === 'Escape') close();
    };
    btn.addEventListener('click', close);
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) close();
    });
    document.addEventListener('keydown', onKey);
    btn.focus();
    if (motion && window.DiaUnoConfetti) {
      setTimeout(function () {
        window.DiaUnoConfetti(null, 180);
      }, 250);
    }
  }

  function countHud(from, to) {
    const el = document.querySelector('[data-hud-xp]');
    if (!el || !motion) return;
    const start = performance.now();
    const d = 1200;
    function f(t) {
      const k = Math.min((t - start) / d, 1);
      const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      el.textContent = v.toLocaleString('es');
      if (k < 1) requestAnimationFrame(f);
    }
    requestAnimationFrame(f);
  }

  // Pausas entre capítulos del cuestionario (estilo test de personalidad).
  const PAUSES = {
    2: { art: '🧾', title: '¿Sabías?', text: 'Anotar tus gastos aunque sea una semana suele mostrar fugas que no veías. Ahora hablemos de lo que sale de tu bolsillo.' },
    3: { art: '🎒', title: '¿Sabías?', text: 'Una deuda con interés alto puede crecer aunque pagues la cuota mínima. Saber cuánto pagas es el primer paso para aligerar la mochila.' },
    4: { art: '🐷', title: '¿Sabías?', text: 'Un fondo para emergencias de unos tres meses de gastos es la base de cualquier plan. Veamos cómo va tu alcancía.' },
    5: { breath: true, title: 'Tomemos un momento', text: 'Respira despacio antes de seguir. Ya casi terminas.' },
  };
  function interlude(ch, onClose) {
    const p = PAUSES[ch];
    if (!p) return onClose();
    const wrap = document.createElement('div');
    wrap.className = 'interlude';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML =
      '<div class="interlude-card">' +
      (p.breath ? '<p class="kicker"></p><p class="txt"></p><div class="breath" aria-hidden="true"></div><p class="breath-label" aria-live="polite">Inhala</p>' : '<div class="interlude-art" aria-hidden="true"></div><p class="kicker"></p><p class="txt"></p>') +
      '<button class="btn btn-primary" type="button">Siguiente</button></div>';
    wrap.querySelector('.kicker').textContent = p.title;
    wrap.querySelector('.txt').textContent = p.text;
    if (p.art) wrap.querySelector('.interlude-art').textContent = p.art;
    wrap.setAttribute('aria-label', p.title);
    document.body.appendChild(wrap);
    let timer = null;
    if (p.breath) {
      const label = wrap.querySelector('.breath-label');
      let inhale = true;
      timer = setInterval(function () {
        inhale = !inhale;
        label.textContent = inhale ? 'Inhala' : 'Exhala';
      }, 3000);
    }
    const btn = wrap.querySelector('button');
    const close = function () {
      if (timer) clearInterval(timer);
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      onClose();
    };
    const onKey = function (e) {
      if (e.key === 'Escape') close();
    };
    btn.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    btn.focus();
  }

  // XP por responder una pregunta del test (recompensa visual).
  const qForm = document.querySelector('form.q-enter-next');
  if (qForm) {
    const ch = qForm.getAttribute('data-interlude');
    const key = 'du-int-' + location.pathname.split('/')[1] + '-' + ch;
    let seen = true;
    try {
      seen = Boolean(sessionStorage.getItem(key));
      if (ch) sessionStorage.setItem(key, '1');
    } catch (e) {
      seen = true;
    }
    const reward = function () {
      if (motion) pop('+10 XP', document.querySelector('.qf-progress'));
    };
    if (ch && !seen) interlude(Number(ch), reward);
    else setTimeout(reward, 250);
  }

  const user = body.getAttribute('data-user');
  if (!user) return;
  const now = {
    xp: Number(body.getAttribute('data-xp')) || 0,
    level: Number(body.getAttribute('data-level')) || 1,
    name: body.getAttribute('data-level-name') || '',
    ach: (body.getAttribute('data-ach') || '').split(',').filter(Boolean),
  };
  const titles = {};
  (body.getAttribute('data-ach-titles') || '').split('|').forEach(function (p) {
    const i = p.indexOf(':');
    if (i > 0) titles[p.slice(0, i)] = p.slice(i + 1);
  });
  const key = 'du-game-' + user;
  let prev = null;
  try {
    prev = JSON.parse(localStorage.getItem(key) || 'null');
  } catch (e) {
    prev = null;
  }
  try {
    localStorage.setItem(key, JSON.stringify(now));
  } catch (e) {
    /* sin almacenamiento: sin celebraciones */
  }
  if (!prev) return;

  const hud = document.querySelector('.hud');
  if (now.xp > prev.xp) {
    setTimeout(function () {
      pop('+' + (now.xp - prev.xp) + ' XP', hud);
      countHud(prev.xp, now.xp);
    }, 400);
  }
  const fresh = now.ach.filter(function (c) {
    return prev.ach.indexOf(c) < 0;
  });
  fresh.forEach(function (c, i) {
    toast(titles[c] || 'Nuevo logro', 'Logro desbloqueado', 900 + i * 700);
  });
  if (now.level > prev.level) {
    setTimeout(function () {
      levelUp(now.level, now.name);
    }, 700);
  }
})();
