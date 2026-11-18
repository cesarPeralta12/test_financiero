# Plan: test gratuito interactivo (animación y sonido) y Coach v2

**Fecha:** 17 de noviembre de 2026 · **Estado:** borrador para validar · **Alcance de este documento:** solo planificación; no se tocó código.

## 1. Qué se revisó

| Fuente | Qué es | Hallazgo principal |
|---|---|---|
| Repositorio `cesarPeralta12/test_financiero` (clonado en `repo/`) | «Día Uno»: Node 22 + Express 5 + SQLite, HTML renderizado en servidor, sin framework de cliente, 58 pruebas | Ya hay base de movimiento (`public/css/motion.css`, 567 líneas, bajo la clase `.motion` que pone `early.js` salvo `prefers-reduced-motion`), vistas de juego (`game.css/js`) y test de 25 preguntas con variantes (`src/domain/free/`). **No existe nada de sonido.** |
| Ejemplo Breeze (`try-breeze.com/funnel/childhood`) | Embudo de test (Next.js) | Ver sección 2. Se recorrieron 12 pantallas hasta antes del cierre; **no se llegó** al resultado ni al muro de pago, así que esa parte no se describe. |
| `coach-v2.zip` (extraído en `coach-v2-extracted/`) | Especificación completa del Coach v2: 12 documentos, JSON de datos, herramientas | Plan de 7 fases y 58 tareas `CV2-xxx` (≈ 38–59 persona-días). El doc `09-sonido-y-animacion.md` ya trae catálogo de sonidos (Web Audio sintetizado) y de animaciones. Solo leí README, 09 y 11; el resto está pendiente de revisar a fondo. |
| `Dia_Uno_*.docx` (2 archivos en la raíz) | Especificaciones del test gratuito y su resultado | No revisados en esta pasada. |

## 2. Qué hace bien el ejemplo (mecánicas a copiar, no el tema)

Breeze trata salud mental; nosotros tomamos **solo la mecánica**, no el contenido.

1. **Una pregunta por pantalla, URL por paso** (`/funnel/<flujo>/<paso>/?stepId=...`): permite métricas de abandono por paso y retomar.
2. **Opciones grandes tipo tarjeta** a ancho completo, pensadas para el pulgar; avanzar al tocar (selección única) o con botón «Siguiente» (selección múltiple).
3. **Variedad de tipos de pantalla** para romper la monotonía: pregunta simple, múltiple, «¿qué es lo primero que ves?» con imagen, escala de identificación («me identifico completamente… no me identifico»), **pausa de respiración**, **«¿Sabías?»** (dato entre bloques) y un encabezado de sección («Tu historia» + indicador 2·3·4).
4. **Progreso por bloques** con nombre, no una barra de 25 pasos.
5. **Botón «¿Por qué preguntamos?»** que da confianza antes de pedir datos sensibles.
6. **Micro-animaciones** en cada pantalla (5–8 elementos con animación/transición por paso) e ilustración que cambia (una planta que crece en la primera).
7. **Sin sonido**: la página no tiene `<audio>`. Si queremos sonido, es un diferencial propio, no una copia.
8. Stack: Next.js y mucho seguimiento publicitario (Meta, TikTok, Pinterest, Snap, Bing, Reddit). **No copiar el seguimiento:** Día Uno ya tiene analítica con consentimiento (commit `248f682`).

## 3. Propuesta para el test gratuito de Día Uno

Mantener el motor (`engine.js`, catálogo de 25 slots) y **cambiar solo la capa de presentación**.

### 3.1 Tipos de pantalla nuevos

| Tipo | Uso financiero | Notas |
|---|---|---|
| Tarjetas de opción grandes | Todas las preguntas `single` | Avance automático con 250 ms de confirmación; `multi` con «Siguiente» |
| Escala de 4 pasos | «¿Qué tanto te identificas con…?» (hábitos de gasto, deuda, ahorro) | Reutiliza `single`; sin cambio de catálogo |
| Control de importe | `money_or_choice`: teclado numérico propio, contador animado | Mantener «No lo sé» y «Prefiero no responder» |
| Escena «Dato curioso» | Entre bloques, 1 dato financiero validado | Contenido nuevo y **fuente citada**; lo aprueba el responsable financiero |
| Pausa | Antes de las preguntas sensibles (deudas, atrasos) | Opcional, saltable, no cuenta como pregunta |
| Cabecera de bloque | 4–5 bloques con nombre | Sustituye «n de 25» como indicador principal; el contador sigue en texto accesible |
| «¿Por qué preguntamos?» | En toda pregunta de ingresos, deudas o edad | Textos nuevos en catálogo (versión nueva, no editar la vigente) |

### 3.2 Animación (empezar por lo que ya existe)

Reusar `motion.css` (`pop`, `bump`, `slide-next/prev`, `tick-in`, `grow-x`, `shake`, `msg-in`) y la lista de `coach-v2/09 › 4`. Cada animación solo usa `transform` y `opacity`, ≤ 700 ms, bajo `.motion`.

- Transición entre preguntas: `slide-next`/`slide-prev` ya existe; conectarla al paso del test.
- Selección de tarjeta: pulso + marca (`tick-in`).
- Ilustración de progreso que evoluciona por bloque (equivalente a la planta de Breeze; propuesta: una pila de monedas/brote que crece).
- Contador del importe y barras (`grow-x`) en el resultado.
- Gran momento: revelado del resultado (barrido `sweep`, ya existe) + confeti de `game.js`.
- **Decisión de librería:** el proyecto es JS plano sin build. Recomiendo **CSS + Web Animations API** (cero dependencias, cabe en `script-src 'self'`). GSAP solo si se necesita línea de tiempo compleja o animación por scroll en el resultado; hoy no hace falta.

### 3.3 Sonido

Adoptar `coach-v2/herramientas/sfx-referencia.js` como `public/js/sfx.js` (Web Audio sintetizado, 0 KB de audio, sin licencias). Reglas ya definidas en `09`: solo tras un gesto, volumen por defecto 20 %, interruptor visible, <1 s, nada solo por sonido. Eventos para el test:

| Evento | Sonido |
|---|---|
| Seleccionar tarjeta | `tick` |
| Pregunta respondida / avanzar | `coach` (pop) |
| Fin de bloque | `racha` |
| Error de validación | `error` (siempre con mensaje visible) |
| Resultado listo | `meta` / `nivel` |

Pendiente (según el propio documento): probar en iPhone/Safari y Android; afinar de oído.

### 3.4 Accesibilidad y rendimiento (no negociables)

`prefers-reduced-motion` ya se respeta. Preferencia propia para sonido y movimiento, `aria-live` para cambios, foco nunca robado, 360 px sin scroll horizontal (`npm run check:mobile` ya lo comprueba en 23 pantallas: ampliarlo a las nuevas).

## 4. Coach v2: qué se adopta y en qué orden

Del plan del zip (fases 0–6). **Propuesta de secuencia** pensando en que el test es lo urgente y el Coach es de pago:

| Orden | Bloque | Fuente | Resultado |
|---|---|---|---|
| A | Test interactivo (sección 3) | este documento | Mejor conversión del test |
| B | Fase 0 del Coach: medir `ai_runs`, decidir D1–D9 | `11 › 8` | Línea base real de costo |
| C | Fase 4 del Coach (sonido/animación) | `09`, CV2-401…405 | Se **adelanta** y se comparte con A |
| D | Fases 1–2 (registro rápido, parser, insights) | `11` | Núcleo del Coach barato |
| E | Fases 3, 5, 6 (IA barata, pulido, lanzamiento) | `11` | Control de costo y salida |

Observación: A y C comparten `sfx.js` y CSS, así que **se hacen una vez**. La Fase 4 del Coach pasa a ser la base de ambos.

## 5. Plan de trabajo (propuesta)

Estimaciones mías, sin medir; se ajustan al terminar T1.

| # | Tarea | Tam. | Aceptación |
|---|---|---|---|
| T0 | Decidir: tema visual/ilustración, ¿sonido encendido por defecto?, mercado/moneda (BOB), librería de animación | S | Registrado en `docs/DECISIONES.md` |
| T1 | Prototipo de **una pantalla** (tarjetas + transición + sonido) sobre `/test` con flag | M | Se ve y suena bien en móvil; comparar con Breeze |
| T2 | `public/js/sfx.js` + interruptor + preferencia | M | Probar `probar-sfx.js`; iOS/Android manual |
| T3 | Componentes: tarjeta, escala, control de importe, cabecera de bloque | L | Pruebas de vistas existentes verdes |
| T4 | Escenas «Dato curioso» y «Pausa» + textos «¿Por qué preguntamos?» (contenido y fuentes) | M | Revisión del responsable financiero |
| T5 | Ilustración de progreso y revelado del resultado | M | 60 fps en gama media; con reducir movimiento solo fundidos |
| T6 | Accesibilidad y `check:mobile` ampliado | M | Teclado, lector de pantalla, 360 px |
| T7 | Despliegue gradual con flag y métricas de abandono por paso | S | Comparar conversión antes/después |
| T8 | Empezar Coach v2 por su Fase 0 y 1 | — | Ver sección 4 |

## 6. Riesgos y dudas abiertas

- **El ejemplo no se vio completo** (resultado y paywall). Para copiar esas partes hay que recorrerlo a mano o dar capturas.
- Breeze usa seguimiento publicitario masivo; **no replicarlo**.
- El tema del ejemplo es sensible; adaptar tono: financiero, sin culpa (ya es principio del Coach v2).
- Las cifras de costo del Coach son supuestos (el propio zip lo advierte); medir antes de comprometer.
- Los sonidos son punto de partida, requieren oído humano y prueba en teléfonos.
- Umbrales financieros del Coach están `pendiente_validar` (D6).
- Al volver a la raíz, `coach-v2-extracted/` y los `.docx` están fuera de `repo/`; decidir si el zip se copia a `docs/coach-v2/` (los comandos del README del zip asumen esa ruta).

## 7. Preguntas para ti

1. ¿Priorizo el **test gratuito** (sección 3) y dejo el Coach para después? Es mi recomendación.
2. ¿Sonido encendido o apagado por defecto?
3. ¿Mercado: ¿incluye Bolivia (BOB)?
4. ¿Tienes ilustración/marca propia o la propongo yo?
5. ¿Puedes pasar capturas o grabación de las pantallas finales de Breeze (resultado, oferta)?

## 8. Avance (17-nov-2026)

- **T1/T2 prototipo:** avance al tocar, entrada lateral, barra animada, pulso y sonido opcional (`public/js/sfx.js`, `public/js/test-fx.js`). Sonido apagado por defecto.
- **T4 parcial, escenas entre bloques:** cuatro escenas tras las preguntas 5, 9, 14 y 20 (`src/domain/free/scenes.js`, `src/views/scene.js`, ruta `GET /test/escena/:n`). La de la 9 es una pausa con círculo que respira antes de las deudas. Solo catálogo V4; no se guardan y no cambian el resultado.
- **Pendiente:** el texto de las escenas no lleva cifras y debe validarlo el responsable de contenido financiero; los «¿Por qué preguntamos?» y datos con fuente aún no se hicieron.
- **Magia y respiración (17-nov-2026, 2.ª pasada):** partículas en espiral (estrellas y chispas) que viajan del botón a la barra; cada llegada suena una nota más arriba de una escala pentatónica (tintineo) y deja un destello; al llenarse suena «polvo de estrellas». Sonidos nuevos en `sfx.js`: `whoosh`, `magia`, `campana`, `inhala`, `exhala`, `listo`. La pausa tiene ahora un orbe animado (ondas, chispas orbitando) y una respiración guiada de tres respiros con sonido.
