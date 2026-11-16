# Coach v2 de Día Uno: especificación completa

**Fecha:** 16 de noviembre de 2026 · **Estado:** especificación lista para implementar · **Alcance de esta entrega:** solo documentación y datos; no se modificó código de la aplicación.

## Qué es esto

Un conjunto de documentos y archivos de datos para rehacer el Coach de Día Uno con tres metas:

1. **Costar casi nada.** Hoy cada mensaje pasa por un modelo grande (Opus 5.5). En v2 el 95 % de las interacciones se resuelven en el backend, y cuando se usa IA es con modelos pequeños, un prompt cacheado y datos en JSON.
2. **Ser útil de verdad.** Registrar ingresos y gastos en 3 toques, y que el Coach sepa en qué gastas más, qué cambió, qué recortar, qué deuda pagar primero, con porcentajes y gráficos calculados por el servidor.
3. **Tener respuesta para todo.** 102 intenciones y 242 mensajes distintos en un catálogo JSON, con ordenamiento y filtros en cada lista.

## Resumen en cifras

| Medida | Hoy | Coach v2 | Fuente |
|---|---|---|---|
| Costo por interacción | ≈ $0,031 (Opus 5.5, mezcla 60/40 con herramienta) | ≈ $0,00004 si la resuelven reglas; ≈ $0,001 por llamada de IA | `herramientas/costos.js`, precios oficiales de Anthropic |
| Costo por usuario y mes, 150 interacciones | ≈ $4,60 | ≈ $0,007 (95 % sin IA) | ídem |
| Costo por 1.000 usuarios y mes, 150 interacciones | ≈ $4.600 | ≈ $7 | ídem |
| Tokens por vuelta de IA | ≈ 2.700 (5.900 con herramienta) | ≤ 2.000 de entrada, y la parte fija se lee de caché | medición del repositorio |
| Preguntas resueltas sin IA | 0 % con clave de IA (todo va al modelo) | meta ≥ 95 % | por medir con `resolved_by` |
| Parser sin IA, banco propio | no existe | 244 de 244 casos (el banco se escribió junto con el parser; ver la salvedad en `10-pruebas-y-calidad.md`) | `herramientas/probar-parser.js` |

> **Salvedad que importa.** Las cifras de costo dependen de supuestos que están escritos y son editables en `herramientas/costos.js` (tokens de salida, proporción de llamadas con herramienta, aciertos de caché). El 95 % sin IA es una **meta**, no un resultado medido: el banco de 244 frases se redactó junto al parser, y en una prueba ciega de 30 frases nuevas el parser acertó de entrada ~63 %, se salvó con una aclaración segura ~17 % y falló o necesitó frases nuevas ~20 %. Por eso la fase de mejora continua con frases reales es parte del plan (ver `10-pruebas-y-calidad.md`).

## Cómo leer este conjunto

| # | Archivo | Para quién | Contenido |
|---|---|---|---|
| 01 | [`01-diagnostico-y-medicion.md`](01-diagnostico-y-medicion.md) | Todos | Cómo funciona hoy, medición real del prompt, correcciones a mi PDF anterior |
| 02 | [`02-costos-y-modelos.md`](02-costos-y-modelos.md) | Producto, finanzas | Precios verificados, modelo por tarea, caché, lotes, escenarios, límites y alarmas |
| 03 | [`03-arquitectura-backend.md`](03-arquitectura-backend.md) | Desarrollo | Pipeline, módulos, contratos, privacidad, observabilidad, feature flags |
| 04 | [`04-datos-y-json.md`](04-datos-y-json.md) | Desarrollo | Esquemas JSON, migración SQL probada, API con ejemplos |
| 05 | [`05-insights-y-graficos.md`](05-insights-y-graficos.md) | Producto, desarrollo | Los 35 insights con fórmulas, umbrales y orden; los 10 gráficos |
| 06 | [`06-catalogo-de-mensajes.md`](06-catalogo-de-mensajes.md) | Contenido, desarrollo | Cómo se eligen los mensajes, gramática, tonos, índice del catálogo |
| 07 | [`07-parser-lenguaje-natural.md`](07-parser-lenguaje-natural.md) | Desarrollo | Algoritmo del parser, importes, fechas, categorías, aprendizaje |
| 08 | [`08-ui-registro-y-ordenamiento.md`](08-ui-registro-y-ordenamiento.md) | Diseño, desarrollo | Pantallas, flujos, ordenar y filtrar todo, textos de interfaz |
| 09 | [`09-sonido-y-animacion.md`](09-sonido-y-animacion.md) | Diseño, desarrollo | Catálogo de sonidos y animaciones, código de referencia, accesibilidad |
| 10 | [`10-pruebas-y-calidad.md`](10-pruebas-y-calidad.md) | QA, desarrollo | Plan de pruebas, métricas, criterios de aceptación |
| 11 | [`11-plan-de-implementacion.md`](11-plan-de-implementacion.md) | Todos | Fases, backlog numerado, estimaciones, riesgos, despliegue |
| 12 | [`12-referencias.md`](12-referencias.md) | Todos | Fuentes con enlace, fecha y nivel de confianza; lo que no se verificó |

Datos (`json/`): `catalogo-mensajes.json`, `diccionario-categorias.json`, `casos-parser.json`, `umbrales.json`, `esquemas.json`, `precios-modelos.json`.
Herramientas ejecutables (`herramientas/`): `validar.js`, `plantillas.js`, `parser-referencia.js`, `probar-parser.js`, `costos.js`, `sfx-referencia.js`, `probar-sfx.js`, `005_coach_v2.sql`, `probar-migracion.js`, `generar-tablas.js`, `compilar.js`.
El archivo `COACH-V2-COMPLETO.md` reúne todo en un solo documento descargable.

## Cómo comprobar que lo escrito se cumple

```bash
node docs/coach-v2/herramientas/validar.js        # JSON válidos, catálogo coherente, 0 errores
node docs/coach-v2/herramientas/probar-parser.js  # 244 casos del parser
node docs/coach-v2/herramientas/costos.js         # tablas de costo reproducibles
node --experimental-sqlite docs/coach-v2/herramientas/probar-migracion.js   # migración SQL sobre el esquema real
node docs/coach-v2/herramientas/probar-sfx.js     # sonidos en Chromium sin pantalla
node docs/coach-v2/herramientas/compilar.js       # regenera COACH-V2-COMPLETO.md
```

## Decisiones tomadas en la especificación (cámbialas si no te gustan)

1. **Reglas primero, IA al final.** Un botón o un texto reconocido nunca llama a un modelo.
2. **Dos usos de IA con costo casi nulo, automáticos:** clasificar la intención y extraer datos de un texto cuando el parser duda (Haiku 5.5, ≈ $0,00014 por llamada). Con un tope diario por cuenta. El consejo abierto (Sonnet 5.5) y la redacción solo salen con un botón explícito.
3. **Todas las cifras las calcula el backend**; la IA nunca calcula ni inventa un número, y su salida se valida contra los hechos que recibió.
4. **Datos en JSON versionados:** catálogo de mensajes, diccionario, umbrales y esquemas se cargan al arrancar, se validan y cada respuesta lleva las versiones que usó.
5. **Proveedor de IA intercambiable.** Hoy solo están verificados los precios de Anthropic; los de OpenAI no se pudieron verificar (ver `12-referencias.md`).
6. **Sin tocar la reserva de emergencia, sin productos de inversión, sin culpa.** Todos los umbrales son reglas de producto que debe validar el responsable financiero (`json/umbrales.json`, marcados `pendiente_validar`).

## Qué NO está resuelto (honestidad)

| Tema | Estado |
|---|---|
| Precios de OpenAI | No verificados (dominio no accesible desde la sesión). Hay que habilitar `developers.openai.com` o confirmarlos a mano. |
| Tokens reales de salida (incluye razonamiento) del Coach actual | Supuestos. La tabla `ai_runs` ya los guarda: medir antes de empezar (fase 0). |
| Precisión del parser con usuarios reales | Solo hay bancos propios. Medir con frases reales desde el primer día. |
| Moneda boliviana (BOB) | `src/lib/money.js` soporta 9 monedas y no incluye BOB. Si el mercado incluye Bolivia, añadirla. |
| Umbrales financieros (recortes, concentración, hormiga) | Propuestos, sin validar por un experto en finanzas. |
| Sonidos | Parámetros de partida; hay que afinarlos de oído y probar en iPhone y Android. |

## Glosario

- **Intención:** lo que la persona quiere (registrar un gasto, ver su mayor gasto…). Hay 102 en el catálogo de mensajes.
- **Variante:** una de las formas de responder una intención (por tono y condición).
- **Insight:** una observación calculada por el backend (por ejemplo «Ocio subió 18 %») con severidad, prioridad y datos de gráfico.
- **Hormiga:** gasto pequeño y repetido que casi no se nota pero suma.
- **Caché de prompt:** el proveedor guarda la parte fija del prompt y cobra mucho menos por releerla.
- **Salida estructurada:** el modelo responde con un JSON que cumple un esquema exacto.
