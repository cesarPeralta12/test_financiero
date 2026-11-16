'use strict';
// Implementación de referencia de los sonidos del Coach con la Web Audio API.
// NO es código de la aplicación: se porta a public/js/sfx.js en la fase 4.
// Sin archivos de audio: todo se sintetiza con osciladores y envolventes.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Sfx = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  const PICO_MAESTRO = 0.25; // ganancia máxima absoluta con volumen = 1
  const SEPARACION_MIN_S = 0.06; // evita ráfagas
  const ATAQUE_S = 0.005; // sube rápido pero sin «clic»
  const SILENCIO = 0.0001; // las rampas exponenciales no pueden llegar a 0

  // f = Hz, f2 = Hz final (deslizamiento), t = inicio (s), d = duración (s), w = forma de onda, g = ganancia relativa (0–1)
  const SONIDOS = {
    ingreso: { sensacion: 'moneda, positivo', notas: [{ f: 880, t: 0, d: 0.12, w: 'triangle', g: 0.9 }, { f: 1318.5, t: 0.1, d: 0.18, w: 'triangle', g: 1 }] },
    gasto: { sensacion: 'toque suave, neutro', notas: [{ f: 520, f2: 392, t: 0, d: 0.09, w: 'sine', g: 0.6 }] },
    deshacer: { sensacion: 'retroceso', notas: [{ ruido: true, f: 900, f2: 300, t: 0, d: 0.08, g: 3 }] },
    meta: { sensacion: 'logro', notas: [{ f: 523.25, t: 0, d: 0.14, w: 'triangle', g: 0.8 }, { f: 659.25, t: 0.12, d: 0.14, w: 'triangle', g: 0.85 }, { f: 783.99, t: 0.24, d: 0.14, w: 'triangle', g: 0.9 }, { f: 1046.5, t: 0.36, d: 0.24, w: 'triangle', g: 1 }] },
    racha: { sensacion: 'chispa', notas: [{ f: 1046.5, t: 0, d: 0.1, w: 'sine', g: 0.8 }, { f: 1046.5, t: 0.1, d: 0.1, w: 'sine', g: 0.35 }] },
    nivel: { sensacion: 'fanfarria', notas: [{ f: 523.25, t: 0, d: 0.15, w: 'triangle', g: 0.8 }, { f: 659.25, t: 0.15, d: 0.15, w: 'triangle', g: 0.85 }, { f: 783.99, t: 0.3, d: 0.15, w: 'triangle', g: 0.9 }, { f: 1046.5, t: 0.45, d: 0.25, w: 'triangle', g: 1 }] },
    coach: { sensacion: 'pop', notas: [{ f: 660, t: 0, d: 0.06, w: 'sine', g: 0.7 }] },
    error: { sensacion: 'aviso suave', notas: [{ f: 220, t: 0, d: 0.06, w: 'sine', g: 0.7 }, { f: 220, t: 0.1, d: 0.06, w: 'sine', g: 0.7 }] },
    tick: { sensacion: 'clic casi imperceptible', notas: [{ f: 1200, t: 0, d: 0.02, w: 'sine', g: 0.4 }] },
  };

  function duracion(nombre) {
    return Math.max(...SONIDOS[nombre].notas.map((n) => n.t + n.d));
  }

  /** Programa un sonido en un contexto de audio (en vivo o fuera de línea). Devuelve la duración total. */
  function programar(ctx, destino, nombre, desde) {
    const def = SONIDOS[nombre];
    if (!def) throw new Error(`Sonido desconocido: ${nombre}`);
    for (const n of def.notas) {
      const t0 = desde + n.t;
      const g = ctx.createGain();
      g.gain.setValueAtTime(SILENCIO, t0);
      g.gain.linearRampToValueAtTime(Math.max(SILENCIO, n.g), t0 + ATAQUE_S);
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
        filtro.type = 'bandpass';
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

  const estado = { ctx: null, maestro: null, activo: false, volumen: 0.2, ultimo: -1 };

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
      }
      if (estado.ctx.state === 'suspended') estado.ctx.resume();
      return true;
    } catch (e) {
      return false;
    }
  }

  function configurar({ activo, volumen }) {
    if (typeof activo === 'boolean') estado.activo = activo;
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

  return { SONIDOS, PICO_MAESTRO, iniciar, configurar, sonar, renderizar, duracion, _estado: estado };
});
