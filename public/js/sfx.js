'use strict';
// Sonidos del test y del Coach con la Web Audio API (sintetizados, sin archivos de audio).
// Portado de coach-v2/herramientas/sfx-referencia.js y ampliado: tintineos mágicos, respiración guiada y whoosh.
// Solo suena tras un gesto y si la persona lo activó.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Sfx = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  const PICO_MAESTRO = 0.25; // ganancia máxima absoluta con volumen = 1
  const SEPARACION_MIN_S = 0.06; // evita ráfagas
  const ATAQUE_S = 0.005; // sube rápido pero sin «clic»
  const SILENCIO = 0.0001; // las rampas exponenciales no pueden llegar a 0

  // f = Hz, f2 = Hz final (deslizamiento), t = inicio (s), d = duración (s), w = forma de onda,
  // g = ganancia relativa, a = ataque (s, por defecto 5 ms), ruido = true usa ruido filtrado (filtro, q).
  const SONIDOS = {
    ingreso: { sensacion: 'moneda, positivo', notas: [{ f: 880, t: 0, d: 0.12, w: 'triangle', g: 0.9 }, { f: 1318.5, t: 0.1, d: 0.18, w: 'triangle', g: 1 }] },
    gasto: { sensacion: 'toque suave, neutro', notas: [{ f: 520, f2: 392, t: 0, d: 0.09, w: 'sine', g: 0.6 }] },
    deshacer: { sensacion: 'retroceso', notas: [{ ruido: true, f: 900, f2: 300, t: 0, d: 0.08, g: 3 }] },
    meta: { sensacion: 'logro', notas: [{ f: 523.25, t: 0, d: 0.14, w: 'triangle', g: 0.8 }, { f: 659.25, t: 0.12, d: 0.14, w: 'triangle', g: 0.85 }, { f: 783.99, t: 0.24, d: 0.14, w: 'triangle', g: 0.9 }, { f: 1046.5, t: 0.36, d: 0.24, w: 'triangle', g: 1 }] },
    racha: { sensacion: 'chispa', notas: [{ f: 1046.5, t: 0, d: 0.1, w: 'sine', g: 0.8 }, { f: 1046.5, t: 0.1, d: 0.1, w: 'sine', g: 0.35 }] },
    nivel: { sensacion: 'fanfarria', notas: [{ f: 523.25, t: 0, d: 0.15, w: 'triangle', g: 0.8 }, { f: 659.25, t: 0.15, d: 0.15, w: 'triangle', g: 0.85 }, { f: 783.99, t: 0.3, d: 0.15, w: 'triangle', g: 0.9 }, { f: 1046.5, t: 0.45, d: 0.25, w: 'triangle', g: 1 }] },
    coach: { sensacion: 'pop', notas: [{ f: 660, t: 0, d: 0.06, w: 'sine', g: 0.7 }] },
    error: { sensacion: 'aviso suave', notas: [{ f: 220, t: 0, d: 0.06, w: 'sine', g: 0.7 }, { f: 220, t: 0.1, d: 0.06, w: 'sine', g: 0.7 }] },
    punto: { sensacion: 'punto agradable al elegir', notas: [{ f: 988, t: 0, d: 0.1, w: 'sine', g: 0.8 }, { f: 1318.5, t: 0.07, d: 0.2, w: 'triangle', g: 0.75 }] },
    tick: { sensacion: 'clic casi imperceptible', notas: [{ f: 1200, t: 0, d: 0.02, w: 'sine', g: 0.4 }] },

    // ── Magia ──
    // Despegue de las partículas: soplo de aire que sube.
    whoosh: { sensacion: 'soplo ascendente', notas: [{ ruido: true, filtro: 'bandpass', q: 1.1, f: 380, f2: 2800, t: 0, d: 0.34, a: 0.13, g: 2.6 }, { f: 520, f2: 1040, t: 0, d: 0.22, w: 'sine', g: 0.25, a: 0.08 }] },
    // Todas las partículas llegaron: acorde brillante con polvo de estrellas que se apaga.
    magia: {
      sensacion: 'polvo de estrellas',
      notas: [
        { f: 440, t: 0, d: 1.2, w: 'sine', g: 0.5, a: 0.02 },
        { f: 1760, t: 0, d: 1.1, w: 'sine', g: 0.55 },
        { f: 2217, t: 0.04, d: 1.0, w: 'sine', g: 0.45 },
        { f: 2637, t: 0.08, d: 1.0, w: 'sine', g: 0.4 },
        { f: 3520, t: 0.12, d: 0.9, w: 'triangle', g: 0.3 },
        { f: 3951, t: 0.22, d: 0.35, w: 'sine', g: 0.3 },
        { f: 3520, t: 0.32, d: 0.3, w: 'sine', g: 0.24 },
        { f: 2960, t: 0.42, d: 0.3, w: 'sine', g: 0.2 },
        { f: 2637, t: 0.52, d: 0.3, w: 'sine', g: 0.16 },
        { f: 3951, t: 0.6, d: 0.3, w: 'sine', g: 0.12 },
      ],
    },

    // ── Respiración guiada ──
    // Cuenco tibetano: parciales inarmónicos que se apagan despacio.
    campana: {
      sensacion: 'cuenco',
      notas: [
        { f: 396, t: 0, d: 3.4, w: 'sine', g: 0.9, a: 0.01 },
        { f: 1093, t: 0, d: 2.0, w: 'sine', g: 0.32, a: 0.01 },
        { f: 2138, t: 0, d: 1.0, w: 'sine', g: 0.14, a: 0.01 },
      ],
    },
    // Inhalar: aire que sube y un acorde suave que se abre.
    inhala: {
      sensacion: 'aire entrando',
      notas: [
        { ruido: true, filtro: 'lowpass', q: 0.7, f: 200, f2: 1500, t: 0, d: 4, a: 3.5, g: 2 },
        { f: 261.63, t: 0, d: 4, w: 'sine', g: 0.3, a: 3 },
        { f: 392, t: 0, d: 4, w: 'sine', g: 0.22, a: 3 },
        { f: 523.25, t: 0.4, d: 3.6, w: 'sine', g: 0.12, a: 3 },
      ],
    },
    // Exhalar: aire que baja y el acorde se desvanece.
    exhala: {
      sensacion: 'aire saliendo',
      notas: [
        { ruido: true, filtro: 'lowpass', q: 0.7, f: 1500, f2: 180, t: 0, d: 5, a: 0.6, g: 2 },
        { f: 392, f2: 261.63, t: 0, d: 5, w: 'sine', g: 0.3, a: 0.5 },
        { f: 523.25, f2: 392, t: 0, d: 4.5, w: 'sine', g: 0.14, a: 0.5 },
      ],
    },
    // Fin de la respiración: tres notas ascendentes y un brillo.
    listo: {
      sensacion: 'calma lograda',
      notas: [
        { f: 784, t: 0, d: 0.5, w: 'triangle', g: 0.7 },
        { f: 1046.5, t: 0.14, d: 0.5, w: 'triangle', g: 0.75 },
        { f: 1318.5, t: 0.28, d: 0.6, w: 'triangle', g: 0.8 },
        { f: 2093, t: 0.42, d: 1.1, w: 'sine', g: 0.4 },
        { f: 2637, t: 0.5, d: 0.9, w: 'sine', g: 0.25 },
      ],
    },
  };

  // Escala pentatónica alta (la mayor): cada partícula que llega suena una nota más arriba.
  const PENTA = [880, 987.77, 1108.73, 1318.51, 1479.98, 1760, 1975.53, 2217.46, 2637.02, 2959.96, 3520, 3951.07];

  function defDe(x) {
    return typeof x === 'string' ? SONIDOS[x] : x;
  }

  function duracion(x) {
    const def = defDe(x);
    return Math.max(...def.notas.map((n) => n.t + n.d));
  }

  /** Programa un sonido en un contexto de audio (en vivo o fuera de línea). Devuelve la duración total. */
  function programar(ctx, destino, nombre, desde) {
    const def = defDe(nombre);
    if (!def) throw new Error(`Sonido desconocido: ${nombre}`);
    for (const n of def.notas) {
      const t0 = desde + n.t;
      const ataque = Math.min(n.a || ATAQUE_S, n.d * 0.95);
      const g = ctx.createGain();
      g.gain.setValueAtTime(SILENCIO, t0);
      g.gain.linearRampToValueAtTime(Math.max(SILENCIO, n.g), t0 + ataque);
      g.gain.exponentialRampToValueAtTime(SILENCIO, t0 + n.d);
      let fuente;
      if (n.ruido) {
        const largo = Math.ceil(ctx.sampleRate * n.d);
        const buf = ctx.createBuffer(1, largo, ctx.sampleRate);
        const datos = buf.getChannelData(0);
        for (let i = 0; i < largo; i++) datos[i] = Math.random() * 2 - 1;
        fuente = ctx.createBufferSource();
        fuente.buffer = buf;
        const filtro = ctx.createBiquadFilter();
        filtro.type = n.filtro || 'bandpass';
        if (n.q) filtro.Q.value = n.q;
        filtro.frequency.setValueAtTime(n.f, t0);
        filtro.frequency.exponentialRampToValueAtTime(n.f2, t0 + n.d);
        fuente.connect(filtro);
        filtro.connect(g);
      } else {
        fuente = ctx.createOscillator();
        fuente.type = n.w;
        fuente.frequency.setValueAtTime(n.f, t0);
        if (n.f2) fuente.frequency.exponentialRampToValueAtTime(n.f2, t0 + n.d);
        fuente.connect(g);
      }
      g.connect(destino);
      fuente.start(t0);
      fuente.stop(t0 + n.d + 0.02);
    }
    return duracion(nombre);
  }

  const estado = { ctx: null, maestro: null, activo: false, volumen: 0.2, ultimo: -1, musicaDeseada: false };

  /** Debe llamarse desde un gesto de la persona (clic, toque, tecla). Crea o reanuda el contexto. */
  function iniciar() {
    try {
      const AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
      if (!AC) return false;
      if (!estado.ctx) {
        estado.ctx = new AC();
        estado.maestro = estado.ctx.createGain();
        estado.maestro.gain.value = estado.volumen * PICO_MAESTRO;
        estado.maestro.connect(estado.ctx.destination);
        if (estado.ctx.addEventListener) estado.ctx.addEventListener('statechange', () => { if (estado.ctx.state === 'running' && alArrancar) alArrancar(); });
      }
      if (estado.ctx.state === 'suspended') estado.ctx.resume();
      return true;
    } catch (e) {
      return false;
    }
  }

  function configurar({ activo, volumen }) {
    if (typeof activo === 'boolean') {
      estado.activo = activo;
      estado.musicaDeseada = activo;
      if (!activo) musicaOn(false);
      else if (alArrancar && estado.ctx && estado.ctx.state === 'running') alArrancar();
    }
    if (typeof volumen === 'number') {
      estado.volumen = Math.min(1, Math.max(0, volumen));
      if (estado.maestro) estado.maestro.gain.value = estado.volumen * PICO_MAESTRO;
    }
  }

  /** Reproduce un sonido si está activo, el contexto corre y no hay ráfaga. Nunca lanza. */
  function sonar(nombre) {
    try {
      if (!estado.activo || !estado.ctx || estado.ctx.state !== 'running') return false;
      const ahora = estado.ctx.currentTime;
      if (ahora - estado.ultimo < SEPARACION_MIN_S) return false;
      estado.ultimo = ahora;
      programar(estado.ctx, estado.maestro, nombre, ahora);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Igual que sonar, pero sin límite de ráfaga: para sonidos que deben superponerse (tintineos). */
  function superponer(nombreODef) {
    try {
      if (!estado.activo || !estado.ctx || estado.ctx.state !== 'running') return false;
      programar(estado.ctx, estado.maestro, nombreODef, estado.ctx.currentTime);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Tintineo de campanilla: la nota `i` de la escala (sube con cada partícula que llega). */
  function chispa(i) {
    const f = PENTA[Math.abs(Math.floor(i)) % PENTA.length];
    return superponer({
      notas: [
        { f, t: 0, d: 0.5, w: 'sine', g: 0.55 },
        { f: f * 2, t: 0, d: 0.22, w: 'sine', g: 0.16 },
        { f: f * 3.01, t: 0, d: 0.1, w: 'sine', g: 0.07 },
      ],
    });
  }

  // ── Música ambiental ──
  // Generada en vivo (sin archivos de audio, sin derechos de autor). Cuatro pistas del mismo estilo (pad suave
  // y campanillas pentatónicas) que van rotando: Amanecer (Do), Claridad (Fa), Brisa (Sol) y Calma (Re).
  const PISTAS = [
    { nombre: 'Amanecer', compas: 8, campanillas: 3, acordes: [[130.81, 196, 329.63, 493.88], [110, 164.81, 261.63, 392], [174.61, 261.63, 329.63, 440], [98, 196, 293.66, 329.63]], bells: [523.25, 587.33, 659.25, 783.99, 880, 1046.5] },
    { nombre: 'Claridad', compas: 9, campanillas: 4, acordes: [[174.61, 261.63, 329.63, 440], [146.83, 220, 261.63, 349.23], [116.54, 174.61, 220, 293.66], [130.81, 196, 329.63, 440]], bells: [698.46, 783.99, 880, 1046.5, 1174.66, 1396.91] },
    { nombre: 'Brisa', compas: 7.5, campanillas: 3, acordes: [[196, 293.66, 369.99, 493.88], [164.81, 246.94, 293.66, 392], [130.81, 196, 329.63, 587.33], [146.83, 220, 369.99, 493.88]], bells: [783.99, 880, 987.77, 1174.66, 1318.51, 1567.98] },
    { nombre: 'Calma', compas: 9, campanillas: 2, acordes: [[146.83, 220, 369.99, 554.37], [123.47, 185, 220, 293.66], [196, 293.66, 369.99, 493.88], [110, 164.81, 293.66, 329.63]], bells: [587.33, 659.25, 739.99, 880, 987.77, 1174.66] },
  ];
  const COMPASES_POR_PISTA = 12; // ~1,5 minutos por pista antes de pasar a la siguiente
  const NIVEL_MUSICA = 0.32; // la música queda por debajo de los efectos
  const musica = { nodo: null, timer: null, paso: 0, proximo: 0 };
  const pistaDe = (paso) => PISTAS[Math.floor(paso / COMPASES_POR_PISTA) % PISTAS.length];
  let montarInterruptor = () => {};
  let alArrancar = null; // lo define el arranque del navegador: reintenta la música cuando el audio pasa a «running»

  function programarCompas(t) {
    const p = pistaDe(musica.paso);
    const acorde = p.acordes[musica.paso % p.acordes.length];
    const notas = acorde.map((f, i) => ({ f, t: i * 0.12, d: p.compas + 1.5, w: i % 2 ? 'triangle' : 'sine', g: i === 0 ? 0.55 : 0.32, a: 3 }));
    for (let k = 0; k < p.campanillas; k++) {
      const f = p.bells[Math.floor(Math.random() * p.bells.length)];
      notas.push({ f, t: 1.2 + k * ((p.compas - 2) / p.campanillas) + Math.random() * 0.8, d: 2.2, w: 'sine', g: 0.2, a: 0.02 });
    }
    programar(estado.ctx, musica.nodo, { notas }, t);
    musica.paso += 1;
    return p.compas;
  }

  /** Enciende o apaga la música. Necesita el contexto en marcha (tras un gesto) y el sonido activo. */
  function musicaOn(encender, paso, fade) {
    try {
      if (!encender) {
        if (musica.timer) clearInterval(musica.timer);
        musica.timer = null;
        const nodo = musica.nodo;
        musica.nodo = null;
        if (nodo && estado.ctx) {
          const t = estado.ctx.currentTime;
          nodo.gain.cancelScheduledValues(t);
          nodo.gain.setValueAtTime(nodo.gain.value, t);
          nodo.gain.linearRampToValueAtTime(0, t + 0.5);
          setTimeout(() => { try { nodo.disconnect(); } catch (e) { /* ya desconectado */ } }, 700);
        }
        return false;
      }
      if (musica.timer || !estado.activo || !estado.ctx || estado.ctx.state !== 'running') return false;
      if (typeof paso === 'number') musica.paso = Math.max(0, Math.floor(paso));
      musica.nodo = estado.ctx.createGain();
      musica.nodo.gain.setValueAtTime(0, estado.ctx.currentTime);
      musica.nodo.gain.linearRampToValueAtTime(NIVEL_MUSICA, estado.ctx.currentTime + (fade || 2.5));
      musica.nodo.connect(estado.maestro);
      musica.proximo = estado.ctx.currentTime + 0.05;
      const tic = () => {
        while (musica.proximo < estado.ctx.currentTime + 2) musica.proximo += programarCompas(musica.proximo);
      };
      tic();
      musica.timer = setInterval(tic, 1000);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Renderiza un sonido fuera de línea (para pruebas): devuelve Float32Array y la tasa de muestreo. */
  async function renderizar(nombre, volumen = estado.volumen, OfflineCtx) {
    const O = OfflineCtx || (typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext));
    const dur = duracion(nombre) + 0.1;
    const ctx = new O(1, Math.ceil(44100 * dur), 44100);
    const m = ctx.createGain();
    m.gain.value = volumen * PICO_MAESTRO;
    m.connect(ctx.destination);
    programar(ctx, m, nombre, 0);
    const buf = await ctx.startRendering();
    return { datos: buf.getChannelData(0), tasa: buf.sampleRate, duracion: dur };
  }

  // ── Arranque en el navegador: música en todo el sistema ──
  // Respeta la misma preferencia que los efectos (du-sfx). Empieza con el primer gesto (o antes, si el navegador lo permite)
  // y, al cambiar de página, retoma el mismo compás para que no se note el salto.
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__duMusica) {
    window.__duMusica = true;
    const guardaba = window.__duKeep;
    window.__duKeep = true; // estos oyentes sobreviven a los cambios de página
    const CLAVE = 'du-musica';
    let deseada = true;
    try { deseada = window.localStorage.getItem('du-sfx') !== 'off'; } catch (e) { /* sin almacenamiento */ }
    estado.activo = deseada;
    estado.musicaDeseada = deseada;
    estado.volumen = 0.3;
    let paso0 = 0;
    try { paso0 = parseInt(window.sessionStorage.getItem(CLAVE), 10) || 0; } catch (e) { /* sin almacenamiento */ }
    let yaSono = false;
    alArrancar = () => {
      if (!estado.musicaDeseada || !estado.activo || document.hidden) return;
      if (musicaOn(true, yaSono ? undefined : paso0, 1.2)) yaSono = true;
    };
    const intentar = () => {
      if (!estado.musicaDeseada || !iniciar()) return;
      if (estado.ctx.state === 'running') alArrancar();
      else { try { estado.ctx.resume().then(alArrancar, () => {}); } catch (e) { /* espera al gesto */ } }
    };
    ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, intentar, { passive: true }));
    window.addEventListener('pagehide', () => {
      try { window.sessionStorage.setItem(CLAVE, String(musica.paso)); } catch (e) { /* sin almacenamiento */ }
      musicaOn(false);
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) musicaOn(false); else intentar(); });
    intentar();
    // Interruptor en el encabezado (las pantallas que ya traen el suyo, como el test o Mi dinero, no lo duplican).
    montarInterruptor = () => {
      const barra = document.querySelector('header .bar');
      if (!barra || document.querySelector('.qf-sound')) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'qf-sound sound-head';
      b.setAttribute('aria-pressed', estado.activo ? 'true' : 'false');
      b.setAttribute('aria-label', 'Sonidos y música');
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path class="qf-sound-waves" d="M16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      b.addEventListener('click', () => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        try { window.localStorage.setItem('du-sfx', on ? 'on' : 'off'); } catch (e) { /* sin almacenamiento */ }
        configurar({ activo: on });
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on) { intentar(); setTimeout(() => sonar('punto'), 70); }
      });
      barra.appendChild(b);
    };
    document.addEventListener('DOMContentLoaded', () => montarInterruptor());
    window.__duKeep = guardaba;
  }

  return { SONIDOS, PENTA, PICO_MAESTRO, iniciar, configurar, sonar, superponer, chispa, renderizar, duracion, musica: musicaOn, musicaPaso: () => musica.paso, PISTAS, montarInterruptor: () => montarInterruptor(), _estado: estado };
});
