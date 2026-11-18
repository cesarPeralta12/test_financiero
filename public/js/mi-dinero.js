// «Mi dinero»: hoja de registro rápido (3 toques), línea inteligente, editar/eliminar con «Deshacer»,
// monedas que vuelan al total y sonidos. Mejora progresiva: sin este archivo todo funciona con formularios.
(function () {
  'use strict';
  var root = document.querySelector('[data-md][data-config]');
  if (!root) return;
  var cfg;
  try { cfg = JSON.parse(root.getAttribute('data-config')); } catch (e) { return; }
  var motion = document.documentElement.classList.contains('motion');
  var Sfx = window.Sfx;
  var meta = document.querySelector('meta[name=csrf-token]');
  var csrf = meta ? meta.getAttribute('content') : '';

  // ───────── Sonido (misma preferencia que el test) ─────────
  function pref() { try { return window.localStorage.getItem('du-sfx') !== 'off'; } catch (e) { return true; } }
  var soundOn = pref();
  if (Sfx) Sfx.configurar({ activo: soundOn, volumen: 0.3 });
  function play(name) { if (Sfx && soundOn) { Sfx.iniciar(); Sfx.sonar(name); } }
  function chime(i) { if (Sfx && soundOn) { Sfx.iniciar(); Sfx.chispa(i); } }
  var head = root.querySelector('.md-head');
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

  // ───────── Utilidades ─────────
  function api(method, url, body) {
    return window.fetch(url, {
      method: method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: method === 'GET' ? undefined : JSON.stringify(body || {}),
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) { return { status: res.status, body: data }; });
    });
  }
  function uuid() {
    try { if (window.crypto && window.crypto.randomUUID) return 'web-' + window.crypto.randomUUID(); } catch (e) { /* sigue */ }
    return 'web-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  var nf;
  try { nf = new Intl.NumberFormat(cfg.locale, { style: 'currency', currency: cfg.cur, minimumFractionDigits: cfg.dec, maximumFractionDigits: cfg.dec, currencyDisplay: 'narrowSymbol' }); } catch (e) { nf = null; }
  function money(v) { return nf ? nf.format(Number(v)) : cfg.sym + ' ' + Number(v).toFixed(cfg.dec); }
  var group = ',';
  try { var gp = new Intl.NumberFormat(cfg.locale).formatToParts(1000).filter(function (p) { return p.type === 'group'; })[0]; if (gp) group = gp.value; } catch (e) { /* por defecto */ }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  var KIND_LABEL = {};
  cfg.kinds.forEach(function (k) { KIND_LABEL[k[0]] = k[1]; });

  // ───────── Totales: cuentan hasta su valor ─────────
  function countTo(el, from, to, finalText) {
    if (!motion || from === to || !nf) { el.textContent = finalText; return; }
    var t0 = performance.now();
    var ms = 750;
    window.setTimeout(function () { el.textContent = finalText; }, ms + 150); // por si la pestaña estaba en segundo plano
    (function frame(t) {
      var k = Math.min(1, (t - t0) / ms);
      el.textContent = nf.format(from + (to - from) * easeOut(k));
      if (k < 1) window.requestAnimationFrame(frame);
      else el.textContent = finalText; // el texto exacto lo calcula el servidor
    })(t0);
  }
  function runCounters(prev) {
    root.querySelectorAll('[data-card]').forEach(function (card) {
      var el = card.querySelector('[data-count]');
      if (!el) return;
      var to = Number(el.getAttribute('data-count'));
      var key = card.getAttribute('data-card');
      var from = prev && prev[key] !== undefined ? prev[key] : 0;
      var text = el.textContent;
      countTo(el, from, to, text);
      if (prev && prev[key] !== undefined && prev[key] !== to && motion) {
        card.classList.remove('fx-pulse');
        void card.offsetWidth;
        card.classList.add('fx-pulse');
      }
    });
  }
  function readTotals() {
    var out = {};
    root.querySelectorAll('[data-card]').forEach(function (card) {
      var el = card.querySelector('[data-count]');
      if (el) out[card.getAttribute('data-card')] = Number(el.getAttribute('data-count'));
    });
    return out;
  }
  runCounters(null);

  // ───────── Refrescar la pantalla desde el servidor (fuente de verdad) ─────────
  function refresh(newId) {
    var prev = readTotals();
    return window.fetch(location.href, { credentials: 'same-origin', headers: { Accept: 'text/html' } })
      .then(function (r) { return r.text(); })
      .then(function (text) {
        var doc = new DOMParser().parseFromString(text, 'text/html');
        var fresh = doc.querySelector('[data-md-body]');
        var cur = root.querySelector('[data-md-body]');
        if (!fresh || !cur) { location.reload(); return; }
        cur.innerHTML = fresh.innerHTML;
        runCounters(prev);
        if (newId) {
          var row = root.querySelector('[data-mov-id="' + newId + '"]');
          if (row && motion) row.classList.add('fx-new');
        }
        var bal = root.querySelector('[data-card="bal"] [data-count]');
        var live = root.querySelector('[data-live]');
        if (bal && live) live.textContent = 'Saldo del mes: ' + bal.textContent;
      })
      .catch(function () { location.reload(); });
  }

  // ───────── Aviso con «Deshacer» ─────────
  var toastBox = root.querySelector('[data-toast]');
  var toastTimer = null;
  function toast(text, actionLabel, onAction) {
    if (!toastBox) return;
    window.clearTimeout(toastTimer);
    toastBox.innerHTML = '';
    var item = document.createElement('div');
    item.className = 'md-toast-item';
    var span = document.createElement('span');
    span.textContent = text;
    item.appendChild(span);
    var life = 2800;
    if (actionLabel) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = actionLabel;
      b.addEventListener('click', function () { window.clearTimeout(toastTimer); toastBox.innerHTML = ''; onAction(); });
      item.appendChild(b);
      var bar = document.createElement('span');
      bar.className = 'md-toast-time';
      bar.style.setProperty('--undo', cfg.undoSeconds + 's');
      item.appendChild(bar);
      life = cfg.undoSeconds * 1000;
    }
    toastBox.appendChild(item);
    toastTimer = window.setTimeout(function () { toastBox.innerHTML = ''; }, life);
  }

  // ───────── Monedas que vuelan al total ─────────
  var COIN_COUNT = 9;
  function flyCoins(fromRect, targetEl, out) {
    if (!motion || !targetEl || !fromRect) return;
    var tr = targetEl.getBoundingClientRect();
    var tx = tr.left + tr.width / 2;
    var ty = tr.top + tr.height / 2;
    var sx = fromRect.left + fromRect.width / 2;
    var sy = fromRect.top + fromRect.height / 2;
    var arrived = 0;
    for (var i = 0; i < COIN_COUNT; i++) {
      (function (i) {
        var c = document.createElement('span');
        c.className = 'md-coin' + (out ? ' md-coin--out' : '');
        var s = 9 + Math.random() * 7;
        c.style.width = c.style.height = s + 'px';
        c.style.left = sx - s / 2 + 'px';
        c.style.top = sy - s / 2 + 'px';
        document.body.appendChild(c);
        var dx = tx - sx;
        var dy = ty - sy;
        var amp = 30 + Math.random() * 40;
        var phase = Math.random() * Math.PI * 2;
        var lift = 50 + Math.random() * 60;
        var frames = [];
        for (var k = 0; k <= 8; k++) {
          var t = k / 8;
          var e = t * t * (3 - 2 * t);
          var x = dx * e + Math.sin(t * Math.PI * 2 + phase) * amp * (1 - t);
          var y = dy * e - lift * Math.sin(Math.PI * Math.min(1, t * 1.4)) * (1 - e);
          frames.push({ transform: 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(' + (t < 0.2 ? 0.4 + t * 3 : 1 - (t - 0.2) * 0.6).toFixed(2) + ') rotate(' + (t * 360).toFixed(0) + 'deg)', opacity: t === 0 ? 0 : t > 0.92 ? 0.2 : 1, offset: t });
        }
        var a = c.animate(frames, { duration: 650 + Math.random() * 250, delay: i * 45, easing: 'linear', fill: 'both' });
        a.onfinish = function () {
          c.remove();
          arrived++;
          if (!out) chime(arrived - 1);
          if (arrived === COIN_COUNT) {
            targetEl.classList.remove('fx-pulse');
            void targetEl.offsetWidth;
            targetEl.classList.add('fx-pulse');
          }
        };
      })(i);
    }
  }

  // ───────── Hoja de registro ─────────
  var tpl = document.getElementById('md-sheet-tpl');
  var overlay = null;
  var S = null; // estado de la hoja
  var opener = null;
  var saving = false;

  function el(sel) { return overlay.querySelector(sel); }
  function digits() { return S.amount; }
  function fmtAmount(s) {
    if (!s) return '0';
    var p = s.split('.');
    var int = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, group);
    return p.length > 1 ? int + cfg.decSep + p[1] : int;
  }
  function showError(msg) {
    var e = el('[data-error]');
    e.textContent = msg || '';
    e.hidden = !msg;
  }
  function paintAmount() {
    el('[data-amount]').textContent = fmtAmount(S.amount);
    el('[data-amount-box]').setAttribute('data-empty', S.amount ? 'false' : 'true');
  }
  function paintKinds() {
    var box = el('[data-kinds]');
    box.innerHTML = '';
    cfg.kinds.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'md-pill';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', S.kind === k[0] ? 'true' : 'false');
      b.textContent = k[1];
      b.addEventListener('click', function () { setKind(k[0]); play('tick'); });
      box.appendChild(b);
    });
  }
  function paintCats() {
    var box = el('[data-cats]');
    box.innerHTML = '';
    (cfg.cats[S.kind] || []).forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'md-chip';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', S.category === c[0] ? 'true' : 'false');
      b.innerHTML = '<span aria-hidden="true"></span><span></span>';
      b.children[0].textContent = c[2];
      b.children[1].textContent = c[1];
      b.addEventListener('click', function () { pickCategory(c[0], b); });
      box.appendChild(b);
    });
    paintSubs();
  }
  function paintSubs() {
    var sel = el('[data-sub]');
    var list = (cfg.subs[S.kind] && cfg.subs[S.kind][S.category]) || [];
    sel.innerHTML = '<option value="">Ninguna</option>';
    list.forEach(function (s) {
      var o = document.createElement('option');
      o.value = s;
      o.textContent = s.replace(/_/g, ' ');
      if (S.sub === s) o.selected = true;
      sel.appendChild(o);
    });
    sel.closest('.md-more').hidden = !list.length;
  }
  function paintDates() {
    var box = el('[data-dates]');
    box.innerHTML = '';
    [['Hoy', cfg.today], ['Ayer', cfg.yesterday]].forEach(function (d) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'md-pill';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', S.date === d[1] ? 'true' : 'false');
      b.textContent = d[0];
      b.addEventListener('click', function () { S.date = d[1]; paintDates(); play('tick'); });
      box.appendChild(b);
    });
    var di = document.createElement('input');
    di.type = 'date';
    di.className = 'input';
    di.max = cfg.today;
    di.setAttribute('aria-label', 'Elegir otra fecha');
    di.value = S.date !== cfg.today && S.date !== cfg.yesterday ? S.date : '';
    di.addEventListener('change', function () { if (di.value) { S.date = di.value; paintDates(); } });
    box.appendChild(di);
  }
  function setKind(k) {
    if (S.kind === k) return;
    S.kind = k;
    if (!cfg.cats[k] || !cfg.cats[k].some(function (c) { return c[0] === S.category; })) { S.category = null; S.sub = null; }
    paintKinds();
    paintCats();
  }
  function press(k) {
    showError('');
    var a = S.amount;
    if (k === 'back') a = a.slice(0, -1);
    else if (k === 'dot') { if (cfg.dec > 0 && a.indexOf('.') < 0) a = (a || '0') + '.'; }
    else if (/^\d$/.test(k)) {
      var parts = a.split('.');
      if (parts.length > 1 ? parts[1].length >= cfg.dec : parts[0].length >= 9) return;
      a = a === '0' ? k : a + k;
    }
    S.amount = a;
    paintAmount();
  }
  function paintKeypad() {
    var box = el('[data-keypad]');
    box.innerHTML = '';
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', cfg.dec > 0 ? 'dot' : '', '0', 'back'].forEach(function (k) {
      if (!k) { box.appendChild(document.createElement('span')); return; }
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'md-key';
      b.textContent = k === 'dot' ? cfg.decSep : k === 'back' ? '⌫' : k;
      if (k === 'back') b.setAttribute('aria-label', 'Borrar');
      b.addEventListener('click', function () { press(k); play('tick'); });
      box.appendChild(b);
    });
  }

  function pickCategory(code, button) {
    S.category = code;
    S.sub = null;
    paintCats();
    var chip = el('[data-cats]').querySelector('[aria-checked="true"]');
    if (chip && motion) chip.classList.add('fx-picked');
    play('punto');
    if (S.mode === 'new') {
      if (!Number(S.amount)) { // el importe va primero: se avisa sin perder la categoría elegida
        showError('Escribe el importe con el teclado.');
        var box = el('[data-amount-box]');
        box.classList.remove('fx-shake');
        void box.offsetWidth;
        box.classList.add('fx-shake');
        return;
      }
      save({});
    }
  }

  function payload() {
    return {
      tipo: S.kind,
      categoria: S.category,
      subcategoria: S.sub || null,
      importe: S.amount.replace(/\.$/, ''),
      fecha: S.date,
      nota: S.note ? S.note : null,
      origen: S.origin,
    };
  }

  function closeSheet() {
    if (!overlay) return;
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    overlay = null;
    document.documentElement.style.overflow = '';
    if (opener && opener.focus) opener.focus();
  }

  function onKey(e) {
    if (!overlay) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key === 'Tab') { // el foco no se escapa de la hoja
      var f = [].slice.call(overlay.querySelectorAll('button, input, select, summary, [tabindex="0"]')).filter(function (n) { return !n.disabled && n.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0];
      var last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    var t = e.target;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
    if (typing) return;
    if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === ',' || e.key === '.') { e.preventDefault(); press('dot'); }
    else if (e.key === 'Backspace') { e.preventDefault(); press('back'); }
  }

  // Línea inteligente: el servidor entiende el texto con reglas (sin IA) y la hoja se rellena sola.
  var previewSeq = 0;
  var previewTimer = null;
  function previewLine(text) {
    window.clearTimeout(previewTimer);
    var box = el('[data-preview]');
    if (!text.trim()) { box.hidden = true; return; }
    previewTimer = window.setTimeout(function () {
      var seq = ++previewSeq;
      api('POST', '/api/v1/movimientos/vista-previa', { texto: text }).then(function (r) {
        if (seq !== previewSeq || !overlay) return;
        var d = r.body;
        if (!d || r.status !== 200) { box.hidden = true; return; }
        box.hidden = false;
        box.innerHTML = '';
        if (!d.registro) {
          box.setAttribute('data-state', 'hint');
          box.textContent = d.mensaje || 'Escribe algo como «250 súper».';
          return;
        }
        var v = d.vista;
        // Se rellena la hoja con lo entendido; lo que falte se elige con las fichas.
        if (v.tipo && cfg.cats[v.tipo]) { S.kind = v.tipo; }
        if (v.importe) S.amount = String(Number(v.importe)).replace(/\.0+$/, '');
        if (v.categoria && cfg.cats[S.kind] && cfg.cats[S.kind].some(function (c) { return c[0] === v.categoria; })) { S.category = v.categoria; S.sub = v.subcategoria || null; } else if (!d.completo) { S.category = null; }
        if (v.fecha) S.date = v.fecha;
        if (v.nota) { S.note = v.nota; el('[data-note]').value = v.nota; }
        S.origin = 'texto';
        paintKinds(); paintCats(); paintAmount(); paintDates();
        var s = document.createElement('span');
        if (d.completo) {
          box.setAttribute('data-state', 'ok');
          s.textContent = v.tipo_etiqueta + ' · ' + v.importe_formato + ' · ' + v.etiqueta + (v.subcategoria ? ' › ' + v.subcategoria.replace(/_/g, ' ') : '') + ' · ' + (v.fecha === cfg.today ? 'Hoy' : v.fecha === cfg.yesterday ? 'Ayer' : v.fecha);
          box.appendChild(s);
          var go = document.createElement('button');
          go.type = 'button';
          go.className = 'btn btn-primary btn-small';
          go.textContent = 'Guardar';
          go.addEventListener('click', function () { save({}); });
          box.appendChild(go);
        } else {
          box.setAttribute('data-state', 'hint');
          var falta = (d.falta || []).map(function (f) { return f === 'categoria' ? 'la categoría' : f === 'importe' ? 'el importe' : f === 'tipo' ? 'si es gasto o ingreso' : f === 'fecha' ? 'la fecha' : f; });
          s.textContent = 'Falta ' + falta.join(' y ') + (falta.indexOf('la categoría') >= 0 ? ': elige una ficha.' : '.');
          box.appendChild(s);
        }
      }).catch(function () { box.hidden = true; });
    }, 220);
  }

  function openSheet(mov, trigger) {
    if (overlay || !tpl) return;
    opener = trigger || document.activeElement;
    overlay = tpl.content.firstElementChild.cloneNode(true);
    root.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';
    var edit = Boolean(mov);
    S = {
      mode: edit ? 'edit' : 'new',
      id: edit ? mov.id : null,
      kind: edit ? mov.tipo : 'gasto',
      amount: edit ? String(mov.importe).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1') : '',
      date: edit ? mov.fecha : cfg.today,
      note: edit && mov.nota ? mov.nota : '',
      category: edit ? mov.categoria : null,
      sub: edit ? mov.subcategoria : null,
      origin: 'usuario',
      key: uuid(),
    };
    el('[data-cur]').textContent = cfg.sym;
    el('[data-title]').textContent = edit ? 'Editar movimiento' : 'Registrar';
    el('[data-save]').textContent = edit ? 'Guardar cambios' : 'Guardar';
    if (edit) el('[data-delete]').hidden = false;
    el('[data-note]').value = S.note;
    paintKinds(); paintKeypad(); paintCats(); paintDates(); paintAmount();
    if (edit) el('[data-line]').closest('.md-line').hidden = true;

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay || e.target.hasAttribute('data-close')) closeSheet();
    });
    el('[data-line]').addEventListener('input', function (e) { previewLine(e.target.value); });
    el('[data-line]').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (S.category && Number(S.amount)) save({}); }
    });
    el('[data-note]').addEventListener('input', function (e) { S.note = e.target.value; });
    el('[data-note]').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (S.category && Number(S.amount)) save({}); }
    });
    el('[data-sub]').addEventListener('change', function (e) { S.sub = e.target.value || null; });
    el('[data-save]').addEventListener('click', function () { save({}); });
    el('[data-delete]').addEventListener('click', remove);
    el('[data-confirm-no]').addEventListener('click', function () { el('[data-confirm]').hidden = true; });
    document.addEventListener('keydown', onKey, true);
    play('coach');
    var sheetEl = el('.md-sheet');
    if (window.matchMedia && window.matchMedia('(pointer: fine)').matches && !edit) el('[data-line]').focus();
    else sheetEl.focus();
  }

  function save(flags) {
    if (saving || !overlay) return;
    var box = el('[data-amount-box]');
    if (!Number(S.amount)) {
      showError('Escribe el importe con el teclado.');
      box.classList.remove('fx-shake'); void box.offsetWidth; box.classList.add('fx-shake');
      play('error');
      return;
    }
    if (!S.category) {
      showError('Elige una categoría.');
      var chips = el('[data-cats]');
      chips.classList.remove('fx-nudge'); void chips.offsetWidth; chips.classList.add('fx-nudge');
      play('error');
      return;
    }
    showError('');
    el('[data-confirm]').hidden = true;
    saving = true;
    var saveBtn = el('[data-save]');
    saveBtn.disabled = true;
    var body = payload();
    for (var k in flags) body[k] = flags[k];
    var url = '/api/v1/movimientos';
    var method = 'POST';
    if (S.mode === 'edit') { url += '/' + S.id; method = 'PUT'; } else body.idempotency_key = S.key;
    var from = saveBtn.getBoundingClientRect();
    api(method, url, body).then(function (r) {
      saving = false;
      if (!overlay) return;
      saveBtn.disabled = false;
      if (r.status === 201 || r.status === 200) return saved(r.body, from);
      var err = r.body && r.body.error;
      if (err && (err.codigo === 'IMPORTE_ALTO_REQUIERE_CONFIRMAR' || err.codigo === 'DUPLICADO_POSIBLE')) {
        var c = el('[data-confirm]');
        el('[data-confirm-text]').textContent = err.mensaje;
        c.hidden = false;
        var yes = el('[data-confirm-yes]');
        var fresh = yes.cloneNode(true);
        yes.parentNode.replaceChild(fresh, yes);
        fresh.addEventListener('click', function () { var f = {}; f[err.codigo === 'DUPLICADO_POSIBLE' ? 'confirmar_duplicado' : 'confirmar_importe_alto'] = true; save(f); });
        play('error');
        return;
      }
      showError(err ? err.mensaje : 'No pudimos guardar. Inténtalo de nuevo.');
      play('error');
    }).catch(function () {
      saving = false;
      saveBtn.disabled = false;
      showError('Sin conexión. Tu movimiento no se guardó; inténtalo de nuevo cuando vuelva.');
      play('error');
    });
  }

  function saved(data, fromRect) {
    var m = data.movimiento;
    var edit = S.mode === 'edit';
    closeSheet();
    play(edit ? 'punto' : m.tipo === 'ingreso' ? 'ingreso' : 'gasto');
    var target = root.querySelector(m.tipo === 'ingreso' ? '[data-card="in"]' : m.tipo === 'gasto' ? '[data-card="out"]' : '[data-card="bal"]');
    if (!edit) flyCoins(fromRect, target, m.tipo !== 'ingreso');
    refresh(m.id);
    var label = (cfg.cats[m.tipo] || []).filter(function (c) { return c[0] === m.categoria; })[0];
    if (edit) { toast('Cambios guardados.'); return; }
    toast('Anotado: ' + money(m.importe) + (label ? ' en ' + label[1] : ''), 'Deshacer', function () {
      api('DELETE', '/api/v1/movimientos/' + m.id).then(function (r) {
        if (r.status === 200) { play('deshacer'); refresh(); toast('Deshecho.'); }
      });
    });
  }

  function remove() {
    if (saving || !S || S.mode !== 'edit') return;
    var id = S.id;
    saving = true;
    api('DELETE', '/api/v1/movimientos/' + id).then(function (r) {
      saving = false;
      if (r.status !== 200) { showError('No pudimos eliminarlo.'); return; }
      closeSheet();
      play('deshacer');
      refresh();
      toast('Movimiento eliminado.', 'Deshacer', function () {
        api('POST', '/api/v1/movimientos/' + id + '/restaurar').then(function (res) {
          if (res.status === 200) { play('punto'); refresh(id); toast('Listo, lo recuperamos.'); }
          else toast('Ya pasó el tiempo para deshacer.');
        });
      });
    }).catch(function () { saving = false; showError('Sin conexión.'); });
  }

  // ───────── Enlaces que abren la hoja ─────────
  root.addEventListener('click', function (e) {
    var open = e.target.closest('[data-open-register]');
    if (open) { e.preventDefault(); openSheet(null, open); return; }
    var rowEl = e.target.closest('.md-row');
    if (rowEl && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
      var mov;
      try { mov = JSON.parse(rowEl.getAttribute('data-mov')); } catch (x) { return; }
      if (!cfg.cats[mov.tipo]) return; // tipos que la hoja no maneja: se abre la página de edición
      e.preventDefault();
      openSheet(mov, rowEl);
    }
  });
})();
