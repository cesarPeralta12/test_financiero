# 09 · Sonido y animación

Código de referencia **probado**: `herramientas/sfx-referencia.js` (se ejecutó en Chromium sin pantalla con `herramientas/probar-sfx.js`: todos los sonidos suenan, terminan en silencio, y con volumen 1 no pasan de 0,25 de pico). Lo que **no** se pudo probar en esta sesión: iPhone/Safari, Android y el oído humano; por eso los parámetros son un punto de partida a afinar.

## 1. Principios

| # | Principio | Motivo |
|---|---|---|
| 1 | El sonido es **opcional y visible**: interruptor en la cabecera del Coach y en la cuenta; se recuerda | Control de la persona; accesibilidad |
| 2 | Solo suena **como respuesta a una acción** de la persona, nunca al cargar la página | Los navegadores bloquean el audio automático y molesta |
| 3 | Volumen bajo: pico absoluto ≤ 0,25 con el volumen al máximo; por defecto 20 % (pico ≈ 0,05) | Discreción |
| 4 | Un sonido a la vez y separación mínima de 60 ms entre sonidos | Evitar ráfagas |
| 5 | **Nada se comunica solo por sonido o solo por movimiento** | Accesibilidad; sin sonido la interfaz es completa |
| 6 | Con «reducir movimiento» del sistema, solo fundidos breves | Preferencia del usuario; WCAG 2.3.3 |
| 7 | Sonidos cortos (< 1 s) y ninguno automático de más de 3 s | WCAG 1.4.2 (control de audio): el audio automático de más de 3 s exige poder pausarlo; nuestros sonidos son siempre < 1 s y por acción |
| 8 | Fallar en silencio: cualquier error de audio se ignora | Nunca romper la página por un sonido |

## 2. Técnica de sonido

**Web Audio API sintetizada**, sin archivos: osciladores (seno, triángulo), ruido filtrado y envolventes de ganancia. Ventajas: 0 KB de audio, sin licencias, carga inmediata, latencia mínima, y cabe en la política de seguridad actual del sitio (`script-src 'self'`).

| Aspecto | Decisión |
|---|---|
| Contexto | Un solo `AudioContext` por página, creado o reanudado **dentro de un gesto** (clic, toque o tecla). Antes de eso queda suspendido y `sonar()` no hace nada |
| Autoplay | Política de navegadores: el contexto empieza suspendido sin gesto y `resume()` solo funciona dentro de uno. Referencia: guía de Chrome sobre autoplay y MDN «Web Audio API best practices» |
| Sin clics | Cada nota sube de `0,0001` a su nivel en 5 ms (rampa lineal) y cae con rampa exponencial a `0,0001` (las rampas exponenciales no pueden llegar a 0): evita el «clic» de cortes bruscos |
| Volumen | Ganancia maestra = volumen (0 a 1) × 0,25 |
| Preferencia | `Preferencias.sonido` y `volumen` (cuenta) y copia en `localStorage` para pintar sin esperar |
| Plan B | Si algún día se quieren timbres reales: un único archivo de audio (sprite) de 30 a 60 KB con todos los sonidos |
| Vibración | Opcional en Android: `navigator.vibrate(10)` al guardar; no existe en iOS Safari |

### 2.1 Interfaz de `sfx-referencia.js`

```js
Sfx.iniciar();                       // llamar desde un gesto; crea/reanuda el contexto
Sfx.configurar({ activo: true, volumen: 0.2 });
Sfx.sonar('ingreso');                // devuelve false (sin lanzar) si está apagado, suspendido o en ráfaga
await Sfx.renderizar('meta', 1);     // para pruebas: renderiza fuera de línea
```

## 3. Catálogo de sonidos

Frecuencias en Hz. «Pico (vol. 20 %)» y «pico (vol. 100 %)» son lo medido en la prueba (valor absoluto de la señal).

| Evento | Sensación | Diseño (partida) | Duración sonora | Pico 20 % | Pico 100 % |
|---|---|---|---|---|---|
| `ingreso` | Moneda, positivo | Dos notas ascendentes: 880 → 1318,5 Hz, onda triangular, caída exponencial | 0,28 s | 0,048 | 0,239 |
| `gasto` | Toque suave, neutro; no castiga | Una nota que baja ligeramente 520 → 392 Hz, seno, nivel bajo | 0,09 s | 0,029 | 0,145 |
| `deshacer` | Retroceso | Ráfaga corta de ruido con filtro de paso de banda que baja de 900 a 300 Hz | 0,08 s | ≈ 0,04 | ≈ 0,22 |
| `meta` (meta o deuda saldada) | Logro | Arpegio mayor ascendente do-mi-sol-do (523,25; 659,25; 783,99; 1046,5), triangular | 0,60 s | 0,048 | 0,240 |
| `racha` | Chispa | 1046,5 Hz con eco corto al 35 % | 0,20 s | 0,040 | 0,200 |
| `nivel` | Fanfarria | Arpegio de 4 notas más lento, sincronizado con la animación existente | 0,70 s | 0,049 | 0,243 |
| `coach` | Pop | 660 Hz, ataque rápido | 0,06 s | 0,035 | 0,173 |
| `error` | Aviso suave | Dos pulsos graves de 220 Hz; **siempre** con mensaje visible | 0,16 s | 0,032 | 0,158 |
| `tick` | Clic casi imperceptible | 1200 Hz, 20 ms | 0,02 s | 0,019 | 0,096 |

### 3.1 Cuándo suena cada uno

| Acción | Sonido |
|---|---|
| Guardar un ingreso | `ingreso` |
| Guardar un gasto, pago de deuda o aporte a ahorro | `gasto` (los aportes a ahorro usan `racha` si es el primero del día) |
| Deshacer o eliminar | `deshacer` |
| Meta cumplida, deuda saldada | `meta` |
| Racha de 3 días o múltiplos de 7 | `racha` |
| Subida de nivel | `nivel` |
| Llega la respuesta del Coach | `coach` |
| Error de validación | `error` |
| Tocar fichas o botones | `tick` (solo si el sonido está activo; puede desactivarse aparte) |
| Al cargar la página, al hacer scroll, en notificaciones automáticas | **Nunca** |

### 3.2 Cómo afinar

1. Escuchar con auriculares, altavoz de laptop y altavoz de teléfono.
2. Comparar cada sonido con el de la acción contraria (ingreso vs. gasto deben distinguirse sin mirar).
3. Probar en un lugar silencioso y en uno con ruido; el nivel por defecto (20 %) debe oírse sin sobresaltar.
4. Dejar la decisión a una persona de diseño sonoro o de UX; esta tabla es un punto de partida.

## 4. Catálogo de animaciones

Todas con `transform` y `opacity` (se aceleran por GPU). Máximo 700 ms. Nunca bloquean la interacción. Escritas bajo la clase `.motion` del elemento `<html>`: `public/js/early.js` ya añade `motion` salvo que el sistema pida reducir movimiento, así que **sin esa clase no hay movimiento**.

| Evento | Animación | Tiempo / easing | Técnica |
|---|---|---|---|
| Guardar un movimiento | La fila entra deslizándose desde arriba con fundido | 220 ms, `ease-out` | `@keyframes` de `translateY(-8px)` y `opacity` |
| Totales del hub | La cifra cuenta hasta el nuevo valor | 400 ms, `easeOutCubic` | `requestAnimationFrame`; el valor final se anuncia una sola vez en `aria-live` |
| Barra de categoría | Crece hasta su porcentaje | 500 ms | `transform: scaleX()` con `transform-origin: left` |
| Ingreso | 3 a 5 «monedas» pequeñas vuelan hacia el saldo y el saldo late (escala 1,04) | 700 ms | Técnica FLIP: medir origen y destino, animar `translate` y `opacity`; elementos efímeros que se eliminan |
| Gasto grande | Pulso suave de color en el total (sin sacudida, sin rojo agresivo) | 400 ms | `box-shadow`/fondo con opacidad |
| Eliminar y deshacer | La fila colapsa; el aviso muestra una barra de tiempo de 6 s | 200 ms | `grid-template-rows`/altura con transición; `transform: scaleX` en la barra de tiempo |
| Meta o deuda | Barra de progreso que se llena con un brillo que la recorre; confeti reutilizando el de `game.js` | 800 ms | Se reutilizan `pop`, `toast` y `levelUp` de `public/js/game.js` |
| Respuesta del Coach | Indicador «escribiendo» y tarjetas que aparecen escalonadas | 250 a 400 ms; 60 ms entre tarjetas | Retraso artificial de 250 ms solo para dar ritmo (opcional) |
| Racha | Llama que crece y se enciende al sumar el día | 600 ms | `@keyframes` de `scale` y brillo |
| Gráficos | Entrada con `opacity` y `scale` suave | 300 ms | Idéntico a las barras |
| Cargando | Esqueleto de tarjetas con brillo lento | 1,2 s en bucle, pausable | `@keyframes` con degradado; se detiene si la pestaña no está visible |

### 4.1 CSS de referencia

```css
/* Todo el movimiento vive bajo .motion; sin esa clase no hay animaciones */
.motion .mov-nuevo { animation: mov-entra 220ms ease-out both; }
@keyframes mov-entra {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: none; }
}

.motion .barra-categoria > span { transform-origin: left; animation: barra-crece 500ms ease-out both; }
@keyframes barra-crece { from { transform: scaleX(0); } to { transform: scaleX(1); } }

.motion .saldo-late { animation: late 400ms ease-out; }
@keyframes late { 40% { transform: scale(1.04); } 100% { transform: none; } }

/* Aviso con tiempo para deshacer: barra que se vacía en 6 s */
.motion .deshacer-tiempo { transform-origin: left; animation: tiempo 6s linear forwards; }
@keyframes tiempo { from { transform: scaleX(1); } to { transform: scaleX(0); } }

/* Sin movimiento: el cambio es inmediato y la barra de tiempo se muestra llena sin animar */
html:not(.motion) .deshacer-tiempo { transform: none; }
```

### 4.2 Contador animado (JavaScript de referencia)

```js
// Cuenta de a hasta b en 400 ms; escribe el valor final una sola vez para lectores de pantalla.
function contar(el, a, b, formato, ms = 400) {
  if (!document.documentElement.classList.contains('motion')) { el.textContent = formato(b); return; }
  const t0 = performance.now();
  const f = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
    el.textContent = formato(a + (b - a) * e);
    if (k < 1) requestAnimationFrame(f);
    else el.setAttribute('data-final', formato(b));
  };
  requestAnimationFrame(f);
}
```

El elemento con `aria-live="off"` durante la cuenta; al final se actualiza una región `aria-live="polite"` aparte con «Saldo: $340,00».

### 4.3 Monedas que vuelan (FLIP, esquema)

1. Medir el rectángulo del botón «Guardar» (origen) y de la cifra del saldo (destino).
2. Crear N elementos `.moneda` en `position: fixed` en el origen.
3. Animar con la API Web Animations: `translate` hacia el destino con ligera dispersión, `opacity` a 0 al final.
4. Al terminar (`finished`), eliminar los elementos y disparar `saldo-late`.
5. Si no hay `.motion`, no se crean elementos y solo se actualiza la cifra.

## 5. Accesibilidad

| Tema | Regla | Referencia |
|---|---|---|
| Movimiento | Respetar `prefers-reduced-motion`; además, preferencia propia (`sistema`, `reducido`, `completo`) | WCAG 2.3.3 «Animación a partir de interacciones» (AAA, buena práctica); técnica C39 |
| Audio | Todo sonido nace de una acción y dura menos de 1 s; hay interruptor y control de volumen | WCAG 1.4.2 «Control del audio» (A) |
| Color | Los cambios de estado no dependen solo del color | WCAG 1.4.1 |
| Anuncios | Cambios de totales y resultados en `aria-live="polite"`; sin repetir cada paso de la animación | — |
| Destellos | Nada parpadea más de 3 veces por segundo | WCAG 2.3.1 |
| Foco | Las animaciones nunca mueven ni roban el foco | — |
| Pausa | La animación en bucle (esqueletos) se detiene al ocultarse la pestaña y con «reducir movimiento» | WCAG 2.2.2 |

WCAG 1.4.2 exige un mecanismo para pausar o controlar el volumen **si** el audio se reproduce solo más de 3 segundos; aquí nunca ocurre, pero se ofrece el interruptor igualmente.

## 6. Pruebas

| Prueba | Cómo | Estado |
|---|---|---|
| Los sonidos suenan, terminan en silencio y no exceden 0,25 | `herramientas/probar-sfx.js` (Chromium sin pantalla, renderizado fuera de línea) | Hecha |
| `sonar()` sin gesto no lanza y devuelve `false`; con clic el contexto queda `running` | ídem | Hecha |
| Sin errores de página | ídem | Hecha |
| iPhone/Safari y Android/Chrome | Prueba manual: primer toque desbloquea el audio; interruptor funciona; sin clics audibles | Pendiente |
| Oído humano (volumen, claridad, no molestar) | 5 personas, 3 entornos | Pendiente |
| Con «reducir movimiento» activado | Sin animaciones salvo fundidos de 120 ms; barra de deshacer visible sin movimiento | Pendiente |
| Rendimiento | 60 cuadros por segundo en un teléfono de gama media; sin `layout thrashing` | Pendiente |
| Lector de pantalla | VoiceOver y NVDA: el total se anuncia una vez | Pendiente |
| Compatibilidad con la política de seguridad | Ningún script ni estilo en línea; `script-src 'self'` | Por verificar al implementar |

## 7. Referencias

Ver `12-referencias.md`: guía de autoplay de Chrome, MDN Web Audio y autoplay, WCAG 1.4.1, 1.4.2, 1.4.11, 2.3.3.
