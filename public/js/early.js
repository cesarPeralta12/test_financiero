// Se carga antes de pintar la página: evita parpadeos en las animaciones de entrada.
(function () {
  var d = document.documentElement;
  d.classList.add('js');
  try {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) d.classList.add('motion');
  } catch (e) {
    /* sin matchMedia: sin animaciones */
  }
})();

// Registro de los oyentes que las páginas ponen en document y window: la navegación sin recarga los quita antes de volver
// a ejecutar los scripts. Lo que se registra con window.__duKeep = true (música, navegación) permanece.
(function () {
  var reg = [];
  window.__duListeners = {
    clear: function () {
      reg.forEach(function (r) { r.t.removeEventListener(r.type, r.fn, r.opts); });
      reg.length = 0;
    },
  };
  [document, window].forEach(function (t) {
    var orig = t.addEventListener;
    t.addEventListener = function (type, fn, opts) {
      if (!window.__duKeep) reg.push({ t: t, type: type, fn: fn, opts: opts });
      return orig.call(t, type, fn, opts);
    };
  });
})();
