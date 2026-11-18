# 01 · Diagnóstico y medición

Este documento describe cómo funciona hoy el Coach (revisando el código de la rama principal), mide su prompt real y corrige dos cosas de mi PDF anterior (`docs/PLAN-COACH.pdf`).

## 1. Cómo funciona hoy

### 1.1 Flujo de un mensaje

```
Navegador                        Servidor
  │ POST /coach/mensajes            │
  │ (formulario, recarga página)    │
  ├────────────────────────────────►│ routes/coach.js (rate limit 12/min por cuenta)
  │                                 │   └─ coach.send(userId, texto)            domain/coach.js
  │                                 │        ├─ guarda el mensaje del usuario
  │                                 │        ├─ context(userId): arma TODO el contexto
  │                                 │        ├─ si hay proveedor Anthropic y clave:
  │                                 │        │     anthropicReply(): hasta 4 vueltas con herramientas
  │                                 │        │       ai.call(): checkLimits, llamada al modelo, registra en ai_runs
  │                                 │        └─ si no: localReply(): ~6 intenciones por expresiones regulares
  │                                 │   guarda la respuesta (kind: normal|hipotetico|propuesta)
  │◄────────────────────────────────┤ redirect 303 /coach#f-msg (se vuelve a pintar toda la conversación)
```

Archivos y funciones relevantes (rama principal, 16-nov-2026):

| Archivo | Qué hace |
|---|---|
| `src/routes/coach.js` | `GET /coach` pinta el chat y 4 sugerencias fijas; `POST /coach/mensajes`, `/coach/propuesta/:id/confirmar` y `/descartar` |
| `src/domain/coach.js` | `conversation`, `messages`, `send`, `context`, `buildProposal`, `confirm`, `discard`, `TOOLS` (5 herramientas), `anthropicReply`, `localReply` |
| `src/domain/ai/provider.js` | `call` (límites, modelo, registro), `checkLimits`, `usage`, `providerName`; precios de referencia `PRICING` |
| `src/domain/ai/prompts.js` | `COACH_SYSTEM` (≈ 1.400 caracteres) |
| `src/domain/tracker.js` | `KINDS`, `CATEGORIES`, `validateMovement`, `createMovement`, `monthSummary`, `budgetSummary`, `goals`, `debts`, `simulate` |
| `src/routes/calculator.js` | Pantallas de movimientos, presupuesto, deudas, metas y simulador |
| `src/domain/game.js` | XP, racha y logros (ya cuenta movimientos) |

### 1.2 Reglas vigentes que se mantienen

- La IA nunca calcula cifras: las calcula el servidor (`tracker`, `calc`).
- Las propuestas (crear tarea, registrar movimiento, completar tarea, actualizar meta) no se guardan hasta confirmar.
- Distingue consulta hipotética (simulación, no cambia datos) de cambio real.
- Límites: 60 mensajes por cuenta y mes (`ai_coach_monthly_limit`), 50 USD de gasto global (`ai_global_monthly_budget_usd`), cada llamada en `ai_runs`.
- Coach, calculadora y movimientos exigen el permiso `acompanamiento` (de pago).

### 1.3 Parámetros de IA actuales

| Parámetro | Valor | Dónde |
|---|---|---|
| Modelo | `claude-opus-5-5` por defecto (`AI_MODEL`) | `src/config.js` |
| Precio de referencia en el proyecto | 4 USD entrada / 20 USD salida por millón | `provider.js` `PRICING` (coincide con la página oficial) |
| Esfuerzo | `low` | `anthropicReply` |
| `max_tokens` | 16.000 | `anthropicReply` |
| Vueltas con herramientas | hasta 4; desde la 2.ª no se vuelve a comprobar el límite | `anthropicReply` |
| Historial enviado | los últimos 20 mensajes no del sistema | `send` |
| Caché de prompt | **no se usa** (no hay `cache_control`) | — |

## 2. Medición real del prompt

Se midió con un usuario de prueba completo (test gratuito, evaluación profunda, plan generado, 40 movimientos, 5 tareas pendientes), llamando a `coach.context(userId)` y a las constantes del código. Script: ver sección 5.

| Pieza | Caracteres | Tokens aprox. (÷4 a ÷3) | ¿Cambia entre mensajes? |
|---|---|---|---|
| `COACH_SYSTEM` | 1.400 | 350 – 467 | No |
| Definición de las 5 herramientas | 2.733 | 683 – 911 | No |
| **Parte fija (system + herramientas)** | **4.133** | **1.033 – 1.378** | **No** |
| Contexto JSON del usuario | 2.716 | 679 – 905 | Sí, pero poco |
| Historial (20 mensajes, supuesto de 260 caracteres cada uno) | 5.200 | 1.300 – 1.733 | Crece hasta el tope |
| Mensaje de la persona | ~150 | ~40 | Sí |

Desglose del contexto (caracteres): `diagnostico` 614, `plan` 185, `tareas_pendientes` 1.372, `metas` 209, `mes_actual` 168, el resto menos de 20.

**Observación clave:** más del 60 % de lo que se envía en cada turno **no cambia** (system + herramientas + gran parte del contexto). Hoy se paga completo cada vez porque no hay caché.

Los tokens se estimaron con 3 a 4 caracteres por token para texto en español con JSON; no hay un tokenizador oficial en este entorno. La tabla `ai_runs` guarda los tokens reales (`input_tokens`, `output_tokens`), por lo que esta medición se reemplaza por el promedio real en la fase 0.

### 2.1 Entrada por mensaje

| Caso | Cuenta | Tokens de entrada |
|---|---|---|
| Sin herramienta (1 vuelta) | 1.200 fijos + 800 contexto + 650 historial medio + 40 mensaje | ≈ 2.700 |
| Con herramienta (2 vueltas) | 2 × 2.690 + ≈ 500 (llamada y resultado de la herramienta) | ≈ 5.900 |

Con Opus 5.5 (4 USD entrada, 20 USD salida por millón) y 700 a 800 tokens de salida: **$0,0248** y **$0,0395** por mensaje. Con 60 % sin herramienta y 40 % con: **$0,031**.

## 3. Correcciones a mi PDF anterior

| Afirmación del PDF | Corrección |
|---|---|
| «5.000 a 10.000 tokens de entrada por mensaje» | Era una estimación alta. Lo medido es ≈ 2.700 por vuelta y ≈ 5.900 con herramienta. |
| «0,02 a 0,05 USD por mensaje» | Se mantiene como rango, pero el promedio calculado es ≈ 0,031. |
| «60 mensajes ≈ 1,2 a 3 USD por cuenta» | Con 60 interacciones: ≈ 1,84 USD. Con 150: ≈ 4,60. Con 300: ≈ 9,20. |
| «Sin IA el Coach ya funciona» | Cierto, pero solo cuando **no hay clave** (proveedor local); con clave todo mensaje va al modelo. |

## 4. Hallazgos

| # | Hallazgo | Evidencia | Consecuencia |
|---|---|---|---|
| H1 | Todo mensaje con clave va a un modelo grande | `send`: `if (ai.providerName() === 'anthropic') anthropicReply(...)` | Costo ≈ $0,031 por interacción |
| H2 | No hay caché de prompt | No existe `cache_control` en `provider.js` | Se paga completo lo que no cambia |
| H3 | El contexto no incluye categorías de gasto | `context()` envía solo totales y `movimientos` (conteo) | El Coach no puede saber «en qué gastas más» |
| H4 | `monthSummary` ya calcula `byCategory` pero nadie lo muestra | `tracker.js` | Insight gratis que hoy se desperdicia |
| H5 | `localReply` cubre ~6 intenciones con regex | `coach.js` | Base reutilizable, pero muy corta |
| H6 | Categoría por 7 familias de palabras; lo demás cae en «otros» | `CATEGORY_WORDS` | Mala clasificación y no aprende |
| H7 | Chat con recarga de página completa | `res.redirect('/coach#f-msg')` | Sensación lenta y sin interacción |
| H8 | Registro de movimientos: formulario de 8 campos | `movementForm` | Registrar cuesta; menos datos |
| H9 | Ningún sonido; animaciones solo en el juego | `public/js/game.js` | Registrar no se siente |
| H10 | `ai_runs.purpose` solo admite `plan` y `coach` | `CHECK` en `001_esquema_inicial.sql` | Para medir por tarea hay que reconstruir la tabla (ver 04) |
| H11 | `money.js` no soporta BOB | `CURRENCIES` con 9 monedas | Brecha si el mercado incluye Bolivia |
| H12 | El límite de 60/mes cuenta todo mensaje | `userMonthlyCount` | Con v2 debe contar solo llamadas reales a IA |

## 5. Cómo se midió (reproducible)

```js
// Script usado (resumen): crear un usuario completo con las utilidades de test/helpers.js y medir.
const ctx = coach.context(userId);
JSON.stringify(ctx).length;            // 2.716
prompts.COACH_SYSTEM.length;           // 1.400
JSON.stringify(coach.TOOLS).length;    // 2.733
```

Para obtener el promedio **real** del sistema en producción:

```sql
SELECT COUNT(*) AS llamadas,
       AVG(input_tokens)  AS entrada_media,
       AVG(output_tokens) AS salida_media,
       AVG(cost_micros) / 1000000.0 AS usd_por_llamada
FROM ai_runs
WHERE purpose = 'coach' AND status = 'ok' AND created_at >= date('now', '-30 days');
```

Esa consulta es la línea base de la fase 0 y alimenta `herramientas/costos.js` (parámetros `ACTUAL`).

## 6. Lo que se conserva, lo que se reemplaza

| Se conserva | Se reemplaza |
|---|---|
| Propuestas con confirmación y su flujo (`buildProposal`, `confirm`, `discard`) | Chat de recarga completa → respuestas por JSON sin recargar |
| `tracker` (validaciones, resúmenes, simulador) y `calc` | Contexto monolítico → contexto mínimo por tema, solo cuando hay IA |
| `ai_runs` como bitácora | `localReply` por regex → parser + catálogo de intenciones |
| Límites mensuales (con otro conteo) | Un solo modelo grande → modelo por tarea con caché |
| Reglas de producto: no inventar cifras, no asesorar | Registro de 8 campos → registro rápido con vista previa |
