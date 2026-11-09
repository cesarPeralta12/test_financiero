// Día Uno: mejoras progresivas y movimiento. Todo funciona sin JavaScript.
(function () {
  'use strict';
  const root = document.documentElement;
  root.classList.add('js');
  const motion = root.classList.contains('motion');
  const store = {
    get(k) {
      try {
        return sessionStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        sessionStorage.setItem(k, v);
      } catch (e) {
        /* sin almacenamiento: sin efecto */
      }
    },
    del(k) {
      try {
        sessionStorage.removeItem(k);
      } catch (e) {
        /* sin almacenamiento: sin efecto */
      }
    },
  };

  // ───────── Comportamiento básico ─────────

  // Menú en pantallas pequeñas
  const toggle = document.querySelector('[data-nav-toggle]');
  const nav = document.getElementById('menu');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      const open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Lleva el foco al resumen de errores
  const summary = document.querySelector('[data-autofocus]');
  if (summary) summary.focus();

  // Confirmación de acciones irreversibles
  document.addEventListener('submit', function (e) {
    const form = e.target;
    const msg = form.getAttribute && form.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // «No lo sé» desactiva los campos de la pregunta
  const unknown = document.querySelector('[data-unknown]');
  if (unknown) {
    const body = unknown.closest('form');
    const sync = function () {
      body.querySelectorAll('.q-body input:not([data-unknown]):not([type=hidden]), .q-body select, .q-body textarea').forEach(function (el) {
        el.disabled = unknown.checked;
      });
    };
    unknown.addEventListener('change', sync);
    sync();
  }

  // Opción exclusiva en preguntas de varias respuestas («Ninguna»)
  document.querySelectorAll('.options input[type=checkbox]').forEach(function (box) {
    box.addEventListener('change', function () {
      if (!box.checked) return;
      const all = box.closest('.options').querySelectorAll('input[type=checkbox]');
      const exclusive = ['ninguno'];
      all.forEach(function (other) {
        if (other === box) return;
        if (exclusive.includes(box.value) || exclusive.includes(other.value)) other.checked = false;
      });
    });
  });

  // Tarjetas de una sola respuesta: al tocarlas, el test avanza solo (como un quiz).
  document.querySelectorAll('form[data-code] .options--tiles:not(.options--multi) .option').forEach(function (tile) {
    tile.addEventListener('click', function (e) {
      if (!e.detail) return; // con teclado no se avanza automáticamente
      const form = tile.closest('form');
      const next = form && form.querySelector('button[value=next]');
      if (!next || form.dataset.advancing) return;
      form.dataset.advancing = '1';
      setTimeout(function () {
        form.requestSubmit(next);
      }, 420);
    });
  });

  // Coach: sugerencias, envío con Enter, mensaje inmediato e indicador de «escribiendo»
  const chatForm = document.querySelector('[data-chat]');
  const chat = document.getElementById('chat');
  if (chatForm) {
    const ta = chatForm.querySelector('textarea');
    document.querySelectorAll('[data-suggest]').forEach(function (b) {
      b.addEventListener('click', function () {
        ta.value = b.getAttribute('data-suggest');
        ta.focus();
      });
    });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (ta.value.trim()) chatForm.requestSubmit();
      }
    });
    chatForm.addEventListener('submit', function () {
      const text = ta.value.trim();
      const btn = chatForm.querySelector('button[type=submit]');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Pensando…';
      }
      store.set('du-chat', '1');
      if (chat && text) {
        const mine = document.createElement('div');
        mine.className = 'msg msg--usuario msg-new';
        mine.setAttribute('role', 'listitem');
        mine.textContent = text;
        const typing = document.createElement('div');
        typing.className = 'msg msg--coach typing msg-new';
        typing.setAttribute('role', 'listitem');
        typing.setAttribute('aria-label', 'El coach está escribiendo');
        typing.innerHTML = '<p class="who">Coach de IA</p><div class="bubble"><i></i><i></i><i></i></div>';
        chat.appendChild(mine);
        chat.appendChild(typing);
        typing.scrollIntoView({ block: 'end', behavior: motion ? 'smooth' : 'auto' });
      }
    });
    if (chat && chat.lastElementChild) {
      if (store.get('du-chat')) {
        store.del('du-chat');
        const msgs = chat.querySelectorAll('.msg');
        Array.prototype.slice.call(msgs, -2).forEach(function (m) {
          m.classList.add('msg-new');
        });
      }
      chat.lastElementChild.scrollIntoView({ block: 'end' });
    }
  }

  // ───────── Movimiento ─────────
  if (!motion) return;

  const easeOut = function (t) {
    return 1 - Math.pow(1 - t, 3);
  };

  // Índices para escalonar marcas, segmentos y barras.
  document.querySelectorAll('.ticks').forEach(function (list) {
    list.querySelectorAll('li').forEach(function (li, i) {
      li.style.setProperty('--i', i);
    });
  });
  document.querySelectorAll('.alloc span').forEach(function (s, i) {
    s.style.setProperty('--i', i);
  });
  document.querySelectorAll('.chart .bar-mark').forEach(function (g, i) {
    g.style.setProperty('--i', i);
  });
  document.querySelectorAll('.funnel li').forEach(function (li, i) {
    const bar = li.querySelector('.bar-fill');
    if (bar) bar.style.setProperty('--i', i);
  });

  // Regla de la portada: brota después del titular y la recorre un destello.
  const heroTicks = document.querySelector('.hero .ticks');
  if (heroTicks) {
    heroTicks.style.setProperty('--base', '950ms');
    heroTicks.style.setProperty('--step', '32ms');
    heroTicks.style.setProperty('--sweep-delay', '1.9s');
    heroTicks.classList.add('anim', 'sweep');
  }

  // Preguntas: entran desde el lado hacia el que se avanza.
  const qForm = document.querySelector('form[data-code]');
  const dir = store.get('du-dir');
  const qTicks = document.querySelector('.q-head .ticks');
  if (qForm) {
    if (dir) {
      qForm.classList.add(dir === 'prev' ? 'q-enter-prev' : 'q-enter-next');
      store.del('du-dir');
    } else if (qTicks) {
      qTicks.style.setProperty('--step', '18ms');
      qTicks.classList.add('anim');
    }
    qForm.addEventListener('submit', function (e) {
      const action = e.submitter && e.submitter.value;
      if (action === 'next' || action === 'use_previous') store.set('du-dir', 'next');
      else if (action === 'prev') store.set('du-dir', 'prev');
    });
  }

  // Animación de cifras: cuentan desde 0 respetando su formato.
  function parseNumber(text) {
    const m = text.match(/\d[\d.,   ]*\d|\d/);
    if (!m) return null;
    const raw = m[0];
    const dec = /[.,]\d{1,2}$/.test(raw) ? raw.charAt(raw.search(/[.,]\d{1,2}$/)) : null;
    const decimals = dec ? raw.length - raw.lastIndexOf(dec) - 1 : 0;
    const group = (raw.match(/[.,   ]/g) || []).find(function (c) {
      return c !== dec;
    });
    const clean = raw.split(group || '\u0000').join('').replace(dec || '\u0000', '.');
    const value = parseFloat(clean);
    if (!isFinite(value)) return null;
    return { raw: raw, index: m.index, value: value, decimals: decimals, dec: dec, group: group };
  }
  function formatLike(n, p) {
    const fixed = n.toFixed(p.decimals);
    const parts = fixed.split('.');
    let int = parts[0];
    if (p.group) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, p.group);
    return parts[1] ? int + p.dec + parts[1] : int;
  }
  function countUp(el, opts) {
    opts = opts || {};
    if (el.dataset.counted) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !/\d/.test(node.nodeValue)) node = walker.nextNode();
    if (!node) return;
    const original = node.nodeValue;
    const p = parseNumber(original);
    if (!p || p.value < 2) return;
    const rest = original.slice(0, p.index) + original.slice(p.index + p.raw.length);
    if ((rest.match(/[A-Za-zÁÉÍÓÚáéíóúñÑ]/g) || []).length > 4) return;
    el.dataset.counted = '1';
    const from = opts.from || 0;
    const duration = opts.duration || 1000;
    const start = performance.now() + (opts.delay || 0);
    function frame(t) {
      const k = Math.min(Math.max((t - start) / duration, 0), 1);
      const v = from + (p.value - from) * easeOut(k);
      node.nodeValue = original.slice(0, p.index) + formatLike(p.decimals ? v : Math.round(v), p) + original.slice(p.index + p.raw.length);
      if (k < 1) requestAnimationFrame(frame);
      else {
        node.nodeValue = original;
        if (opts.done) opts.done();
      }
    }
    node.nodeValue = original.slice(0, p.index) + formatLike(from, p) + original.slice(p.index + p.raw.length);
    requestAnimationFrame(frame);
  }

  // Contadores de días (inicio y plan).
  document.querySelectorAll('.day').forEach(function (day) {
    const num = day.querySelector('.day-number');
    const ticks = day.querySelector('.ticks');
    if (ticks) {
      ticks.style.setProperty('--step', '9ms');
      ticks.style.setProperty('--base', '150ms');
      ticks.classList.add('anim');
    }
    if (num)
      countUp(num, {
        from: 1,
        duration: 1100,
        delay: 150,
        done: function () {
          num.classList.add('bump');
        },
      });
  });

  // Demostración «Día 1 → Día 90» de la portada.
  const demo = document.querySelector('[data-day-demo]');
  function runDemo() {
    const value = demo.querySelector('[data-day-value]');
    const num = demo.querySelector('.day-number');
    const items = demo.querySelectorAll('.ticks li');
    const total = items.length;
    const duration = 3400;
    const start = performance.now();
    let last = 0;
    function frame(t) {
      const k = Math.min((t - start) / duration, 1);
      const d = Math.max(1, Math.round(1 + (total - 1) * easeOut(k)));
      if (d !== last) {
        value.textContent = String(d);
        for (let i = last ? last - 1 : 0; i < d; i++) {
          if (items[i]) {
            items[i].classList.remove('now');
            items[i].classList.add('done');
          }
        }
        if (items[d - 1]) {
          items[d - 1].classList.remove('done');
          items[d - 1].classList.add('now');
        }
        last = d;
      }
      if (k < 1) requestAnimationFrame(frame);
      else {
        num.classList.add('bump');
        items[total - 1].classList.add('glow');
      }
    }
    requestAnimationFrame(frame);
  }

  // Revelado progresivo al desplazarse.
  const candidates = [
    'main h2:not(.visually-hidden)',
    'main h3',
    '.narrative',
    '.journey li',
    '.journey-list li',
    '.offer',
    '.action-card',
    '.goal',
    '.task',
    '.timeline li',
    '.findings li',
    '.priority-list li',
    '.figures li',
    '.review li',
    '.row-card',
    '.stat',
    '.split > div',
    '.next-step',
    '.note:not(.flash)',
    '.alloc',
    'table.data tbody tr',
    '.empty',
    '.legend',
    '.day-demo > p',
    '.day-demo > .ticks',
    'details.more',
  ].join(',');
  const viewH = window.innerHeight;
  const siblingCount = new Map();
  const observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        const el = en.target;
        observer.unobserve(el);
        el.classList.add('is-in');
        el.querySelectorAll('.meter, .alloc, .chart').forEach(function (g) {
          g.classList.add('grow');
        });
        if (el.matches('.meter, .alloc, .chart')) el.classList.add('grow');
        el.querySelectorAll('.figures .v, .stat .v, .price, .price-tag, .funnel .n, td.num, td.r').forEach(function (v) {
          countUp(v, { duration: 900, delay: 120 });
        });
        if (el.matches('.figures .v, .stat .v, .price, .price-tag')) countUp(el, { duration: 900, delay: 120 });
        if (el === demo) runDemo();
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -6% 0px' }
  );
  document.querySelectorAll(candidates).forEach(function (el) {
    if (el.closest('header, footer, .chat, .q-head, .composer, .sandbox')) return;
    if (el.parentElement && el.parentElement.closest('.reveal')) return;
    const top = el.getBoundingClientRect().top;
    if (top < viewH * 0.9) return;
    const parent = el.parentElement;
    const n = siblingCount.get(parent) || 0;
    siblingCount.set(parent, n + 1);
    el.style.setProperty('--d', Math.min(n, 6));
    el.classList.add('reveal');
    observer.observe(el);
  });
  // Lo que ya está a la vista también cuenta y crece.
  document.querySelectorAll('.meter, .alloc, .chart').forEach(function (g) {
    if (!g.closest('.reveal')) observer.observe(g);
  });
  document.querySelectorAll('.figures .v, .stat .v, .price, .price-tag, .funnel .n').forEach(function (v) {
    if (!v.closest('.reveal')) observer.observe(v);
  });
  if (demo) observer.observe(demo);

  // Tareas: se tachan antes de enviarse.
  document.addEventListener('submit', function (e) {
    const form = e.target;
    if (e.defaultPrevented || !/\/tareas\/\d+\/completar$/.test(form.getAttribute('action') || '')) return;
    e.preventDefault();
    const card = form.closest('.task, .next-step');
    const btn = form.querySelector('button');
    if (card) card.classList.add('completing');
    if (btn) btn.textContent = '✓ Hecha';
    setTimeout(function () {
      form.submit();
    }, 520);
  });

  // Indicador de trabajo en botones que tardan.
  document.addEventListener('submit', function (e) {
    const btn = e.submitter;
    if (!btn || e.defaultPrevented) return;
    setTimeout(function () {
      if (!e.defaultPrevented && btn.isConnected) btn.classList.add('is-busy');
    }, 250);
  });

  // Al volver con «Atrás», los botones no quedan bloqueados.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) document.querySelectorAll('.is-busy').forEach(function (b) {
      b.classList.remove('is-busy');
    });
  });

  // ───────── Celebración ─────────
  function confetti(origin, count) {
    const canvas = document.createElement('canvas');
    canvas.className = 'confetti';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const c = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    c.scale(dpr, dpr);
    const cs = getComputedStyle(root);
    const colors = ['--pine', '--ink', '--amber', '--pine', '--line-2'].map(function (v) {
      return cs.getPropertyValue(v).trim() || '#265b4d';
    });
    const ox = origin ? origin.x : W / 2;
    const oy = origin ? origin.y : H * 0.3;
    const parts = [];
    for (let i = 0; i < (count || 110); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 4 + Math.random() * 9;
      parts.push({
        x: ox,
        y: oy,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 6,
        w: 5 + Math.random() * 6,
        h: 3 + Math.random() * 4,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        color: colors[i % colors.length],
      });
    }
    const start = performance.now();
    const life = 2100;
    function frame(t) {
      const el = t - start;
      c.clearRect(0, 0, W, H);
      c.globalAlpha = Math.max(0, 1 - Math.pow(el / life, 3));
      parts.forEach(function (p) {
        p.vy += 0.32;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.r);
        c.fillStyle = p.color;
        c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        c.restore();
      });
      if (el < life) requestAnimationFrame(frame);
      else canvas.remove();
    }
    requestAnimationFrame(frame);
  }
  window.DiaUnoConfetti = confetti;
  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: Math.max(r.top + r.height / 2, 60) };
  }

  if (document.querySelector('[data-plan-waiting]')) store.set('du-plan-wait', '1');
  const celebrateFlash = ['cuenta_creada', 'tarea_completada', 'correo_verificado', 'escenario_guardado'];
  const flash = document.body.getAttribute('data-flash');
  const celebrateEl = document.querySelector('[data-celebrate]');
  setTimeout(function () {
    if (celebrateEl) confetti(centerOf(celebrateEl), 140);
    else if (celebrateFlash.indexOf(flash) >= 0) {
      const f = document.querySelector('.flash');
      confetti(f ? centerOf(f) : null, flash === 'tarea_completada' ? 70 : 120);
    } else if (store.get('du-plan-wait') && !document.querySelector('[data-plan-waiting]') && document.querySelector('.day')) {
      store.del('du-plan-wait');
      confetti(centerOf(document.querySelector('.day')), 150);
    }
  }, 350);
})();
