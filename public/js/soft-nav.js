// Día Uno: navegación sin recargar la página.
// Al tocar un enlace del sitio (o enviar una pregunta del test) se pide la página nueva por detrás y se cambia el contenido,
// de modo que la música y los sonidos no se cortan. Si algo no encaja (descargas, páginas que se refrescan solas, errores de red)
// se navega de la forma normal. Sin este archivo todo funciona igual, con recarga completa.
(function () {
  'use strict';
  if (window.DuNav) return;
  var keep = window.__duKeep;
  window.__duKeep = true; // los oyentes de este archivo sobreviven a los cambios de página

  // Scripts de la página que se vuelven a ejecutar sobre el contenido nuevo (sfx.js y este archivo siguen vivos).
  var PAGE_SCRIPTS = ['/js/app.js', '/js/game.js', '/js/test-fx.js', '/js/mi-dinero.js', '/js/coach-v2.js'];
  var token = 0;

  function runScripts(done) {
    var srcs = PAGE_SCRIPTS.map(function (p) {
      var s = document.querySelector('script[src^="' + p + '"]');
      return s ? s.getAttribute('src') : null;
    }).filter(Boolean);
    var left = srcs.length;
    if (!left) { done(); return; }
    srcs.forEach(function (src) {
      var s = document.createElement('script');
      s.async = false; // conserva el orden
      s.src = src;
      s.onload = s.onerror = function () {
        s.remove();
        if (--left === 0) done();
      };
      document.head.appendChild(s);
    });
  }

  /** Pone el contenido de una página ya descargada. Devuelve false si debe cargarse de forma normal. */
  function apply(text, url, opts) {
    opts = opts || {};
    var doc;
    try { doc = new DOMParser().parseFromString(text, 'text/html'); } catch (e) { return false; }
    if (!doc.body || !doc.getElementById('contenido') || doc.querySelector('meta[http-equiv="refresh"]')) return false;
    if (window.__duListeners) window.__duListeners.clear(); // fuera los oyentes de la página anterior
    if (opts.push) { try { window.history.pushState(null, '', url); } catch (e) { return false; } }
    document.title = doc.title;
    var tok = doc.querySelector('meta[name="csrf-token"]');
    var cur = document.querySelector('meta[name="csrf-token"]');
    if (tok && cur) cur.setAttribute('content', tok.getAttribute('content'));
    Array.prototype.slice.call(document.body.attributes).forEach(function (a) { document.body.removeAttribute(a.name); });
    Array.prototype.slice.call(doc.body.attributes).forEach(function (a) { document.body.setAttribute(a.name, a.value); });
    document.body.innerHTML = doc.body.innerHTML;
    var hash = url && url.indexOf('#') >= 0 ? url.slice(url.indexOf('#')) : '';
    if (!hash) window.scrollTo(0, 0);
    runScripts(function () {
      if (window.Sfx && window.Sfx.montarInterruptor) window.Sfx.montarInterruptor();
      var target = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
      if (target) target.scrollIntoView();
      var main = document.getElementById('contenido');
      if (main && !target && !document.activeElement.closest('[data-autofocus]')) main.focus({ preventScroll: true });
    });
    return true;
  }

  function go(url, push) {
    var mine = ++token;
    window.fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html' } })
      .then(function (r) {
        if (mine !== token) return null;
        var ct = r.headers.get('content-type') || '';
        if (!/text\/html/.test(ct) || r.headers.get('content-disposition')) { window.location.assign(url); return null; }
        return r.text().then(function (t) {
          if (mine !== token) return;
          if (!apply(t, r.url || url, { push: push })) window.location.assign(r.url || url);
        });
      })
      .catch(function () { if (mine === token) window.location.assign(url); });
  }

  function blocked() {
    // Páginas que se refrescan solas o tienen avisos de salida: mejor la carga normal.
    return Boolean(document.querySelector('[data-autorefresh], [data-plan-waiting]'));
  }

  window.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download') || a.hasAttribute('data-hard') || a.getAttribute('rel') === 'external') return;
    var u;
    try { u = new URL(a.href, window.location.href); } catch (err) { return; }
    if (u.origin !== window.location.origin || !/^https?:$/.test(u.protocol)) return;
    if (u.pathname === window.location.pathname && u.search === window.location.search && u.hash) return; // ancla en la misma página
    if (blocked()) return;
    e.preventDefault();
    go(u.href, true);
  });

  window.addEventListener('popstate', function () { go(window.location.href, false); });

  window.DuNav = { apply: apply, go: go };
  window.__duKeep = keep;
})();
