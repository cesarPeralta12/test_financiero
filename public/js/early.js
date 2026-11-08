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
