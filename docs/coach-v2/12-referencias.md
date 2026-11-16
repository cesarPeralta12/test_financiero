# 12 · Referencias y nivel de confianza

Fecha de consulta: 16 de noviembre de 2026. **Confianza:** *Alta* = leí el texto de la página; *Media* = apareció en resultados de búsqueda con un extracto, no leí la página completa; *Baja* = fuente secundaria o conocimiento previo no contrastado en esta sesión. Nada de confianza baja se usa como cifra de decisión.

## 1. Precios, caché y salida estructurada

| Fuente | Qué se tomó | Confianza |
|---|---|---|
| Anthropic, «Pricing» · https://platform.claude.com/docs/en/about-claude/pricing | Precios por millón de tokens de Haiku 5.5, Sonnet 5.5, Opus 5.5 (entrada, escritura de caché 5 min y 1 h, lectura, salida); factor 0,05 de lectura en Opus 5.5 y Sonnet 5.5; descuento de 50 % de Batch acumulable con caché; regla de Haiku 5.5 con prompts de más de 100.000 tokens | **Alta** (leída la tabla completa; los precios están en `json/precios-modelos.json`) |
| Anthropic, «Prompt caching» · https://platform.claude.com/docs/en/build-with-claude/prompt-caching | Mínimo cacheable (512 tokens en Haiku 5.5, Sonnet 5.5 y Opus 5.5); TTL de 5 min y 1 h con `"ttl": "1h"`; hasta 4 puntos de corte; caché automática con `cache_control` de nivel superior; orden herramientas → system → mensajes; ventana de 20 bloques; comprobar `cache_creation_input_tokens` y `cache_read_input_tokens`; un prompt menor al mínimo no se cachea y no da error | **Alta** (primeros ≈ 40.000 caracteres de 167.000; lo no leído no se usó) |
| OpenAI, página de precios y guía de caché | **No se pudieron abrir** (dominios no permitidos desde la sesión). Resultados de búsqueda de terceros (portales y blogs) hablan de descuentos de entrada en caché de hasta 90 % y de duración de caché de 24 h en modelos recientes, con cifras que se contradicen entre sí | **No verificado.** No se usa ninguna cifra de OpenAI. Hay que habilitar `developers.openai.com` y `platform.openai.com` o pegar los precios a mano |
| OpenAI, Structured Outputs (`json_schema` con `strict: true`) y Batch API · foro oficial de la comunidad y notas de terceros | Existe salida con esquema estricto y un descuento de 50 % en Batch según publicaciones de la comunidad de OpenAI | **Media**; el repositorio ya usa `json_schema` estricto en `src/domain/ai/openai.js` |
| Repositorio: `src/domain/ai/provider.js` | La tabla `PRICING` del proyecto coincide con la página oficial de Anthropic para los tres modelos | **Alta** |

## 2. Audio y animación en la web

| Fuente | Qué se tomó | Confianza |
|---|---|---|
| Chrome for Developers, «Autoplay policy in Chrome» · https://developer.chrome.com/blog/autoplay | El audio de Web Audio queda sujeto a la política de autoplay desde Chrome 71; un `AudioContext` creado sin gesto empieza suspendido; `resume()` dentro de un gesto lo activa | **Media** (extractos de resultados) |
| MDN, «Web Audio API best practices» · https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices | Patrón de reanudar el contexto en un clic; usar un solo contexto por aplicación | **Media** |
| MDN, «Autoplay guide for media and Web Audio APIs» · https://developer.mozilla.org/en-US/Web/Media/Autoplay_guide | Política cambiante tras la interacción; `getAutoplayPolicy()` | **Media** |
| W3C, WCAG «Understanding SC 1.4.2 Audio Control» (versión 2.1 en producción y borrador del editor) · https://www.w3.org/WAI/WCAG21/Understanding/audio-control.html y https://w3c.github.io/wcag/understanding/audio-control.html | Si el audio se reproduce solo más de 3 segundos debe poder pausarse, detenerse o controlarse su volumen de forma independiente del volumen del sistema | **Media** |
| W3C, «Understanding SC 2.3.3 Animation from Interactions (AAA)» · https://w3c.github.io/wcag/understanding/animation-from-interactions.html | El movimiento animado provocado por una interacción puede desactivarse salvo que sea esencial; técnica C39 con `prefers-reduced-motion` | **Media** (borrador del editor) |
| W3C, «Understanding SC 1.4.11 Non-text Contrast (AA)» · https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast | Elementos gráficos necesarios para entender el contenido: contraste de 3:1 contra los colores adyacentes | **Media** |
| W3C, WCAG SC 1.4.1 «Use of Color» (A) | El color no puede ser el único medio de transmitir información | **Baja** (conocimiento previo; la página no se abrió) |
| MDN, `@media (prefers-reduced-motion)` y `AudioParam.exponentialRampToValueAtTime` | Uso de la preferencia del sistema; la rampa exponencial no puede alcanzar 0 y necesita un valor inicial definido | **Baja** (la búsqueda solo trajo fuentes secundarias; el comportamiento se **verificó** con la prueba `probar-sfx.js`, que renderiza sin errores) |

## 3. Contenido financiero

| Fuente | Qué se tomó | Confianza |
|---|---|---|
| Economipedia, «Gastos hormiga» · https://economipedia.com/definiciones/gastos-hormiga.html | Definición: pequeños gastos reiterados y casi inconscientes. Ejemplos: café, snacks, almuerzo fuera, propinas | **Media** (resultado de búsqueda; definición ampliamente coincidente entre Bancolombia, BBVA y otros) |
| BBVA / Bancolombia / Mercado Pago (artículos de educación financiera sobre gastos hormiga) | Recomendar registrar los gastos y fijar un tope mensual en lugar de eliminarlos; ejemplo de un desayuno de 3,5 euros al día ≈ 77 euros al mes | **Media/Baja** (artículos divulgativos) |
| Warren y Tyagi, *All Your Worth* (2005): regla 50/30/20 | Necesidades 50 %, deseos 30 %, ahorro y deudas 20 % de los ingresos netos; se señala que es una guía, difícil con ingresos variables o costos altos. La atribución de origen se discute según algunas fuentes | **Media** (varias fuentes secundarias coinciden; el libro no se consultó). En el producto es solo una explicación opcional (`explicar_50_30_20`), no una regla de cálculo |
| Bola de nieve frente a avalancha: estudios citados por divulgación (Harvard Business Review, *Journal of Marketing Research*, Kellogg) | La avalancha minimiza intereses; la bola de nieve podría favorecer la constancia al cerrar cuentas pequeñas. Los porcentajes que circulan (14 % o 15 % más de probabilidad de saldar todo) **no se verificaron** y las atribuciones de las revistas se contradicen entre blogs | **Baja.** Por eso el producto presenta ambas estrategias como opciones y no recomienda una como única. Para citar cifras habría que leer los originales (por ejemplo Gal y McShane, 2012, y Amar y otros, 2011, según recuerdo; no abiertos en esta sesión) |

## 4. Estándares de datos y diseño

| Fuente | Qué se usó | Confianza |
|---|---|---|
| JSON Schema 2020-12 · https://json-schema.org/draft/2020-12 | Formato de `esquemas.json` | **Baja** (conocimiento previo; no hay validador completo en el proyecto: `validar.js` hace comprobaciones propias) |
| Modo estricto de salida estructurada (propiedades en `required`, `additionalProperties: false`) | Diseño de las tres salidas de IA | **Media** (coincide con lo que ya hace el proyecto con el Plan Maestro y el resultado gratuito) |
| Paleta Okabe-Ito (Okabe e Ito, 2008, «Color Universal Design») | Punto de partida para series de colores aptas para daltonismo | **Baja** (no verificada; hay que medir contrastes reales) |
| MDN `Intl.NumberFormat` | Formato de importes y porcentajes por región | **Baja** (el comportamiento se **verificó** en `plantillas.js` ejecutándolo en Node 22) |

## 5. Lo que se midió o ejecutó en esta sesión (verdad de primera mano)

| Hecho | Cómo |
|---|---|
| Tamaño del prompt actual del Coach | Script de medición con un usuario completo de las utilidades de prueba (`01 › 2`) |
| 102 intenciones, 242 variantes, 36 botones, 244 casos; JSON válidos y catálogo coherente | `herramientas/validar.js` |
| 244/244 casos del parser | `herramientas/probar-parser.js` |
| Prueba ciega de 30 frases nuevas | Ejecución manual del parser de referencia antes de ajustarlo (resultados en `07` y `10`) |
| Migración SQL aplicable al esquema real | `herramientas/probar-migracion.js` |
| Sonidos: pico, silencio, sin errores en Chromium | `herramientas/probar-sfx.js` |
| Costos | `herramientas/costos.js` |

## 6. Lo que NO se pudo verificar

| Tema | Por qué | Cómo cerrarlo |
|---|---|---|
| Precios y reglas de caché de OpenAI | Dominios no permitidos desde la sesión | Habilitarlos o confirmarlos a mano |
| Tokens reales de salida y de razonamiento del Coach actual | `ai_runs` de producción no accesible | Consulta de `01 › 5` en producción |
| Comportamiento del audio en iPhone/Safari y Android | Sin dispositivos | Pruebas manuales (`09 › 6`) |
| Contrastes reales de la paleta de gráficos | Sin los colores finales del tema | Script de contraste con los tokens reales |
| Estudios originales de bola de nieve y avalancha | Solo fuentes secundarias | Leer los originales antes de citar cifras |
| Precisión del parser con usuarios reales | Solo bancos propios | Prueba ciega con frases reales |
| Umbrales financieros | Son reglas de producto sin validar | Revisión con el responsable de contenido financiero |
| Vocabulario regional (por ejemplo bolivianismos) | Sin hablantes locales para validar | Revisión del diccionario por personas del mercado objetivo |

## 7. Código del proyecto revisado

`src/domain/coach.js`, `src/routes/coach.js`, `src/domain/ai/provider.js`, `src/domain/ai/prompts.js`, `src/domain/ai/openai.js`, `src/domain/tracker.js`, `src/routes/calculator.js`, `src/routes/dashboard.js`, `src/domain/game.js`, `src/lib/money.js`, `src/lib/queue.js`, `src/db/migrations/001–004`, `public/js/early.js`, `public/js/game.js`, `public/css/motion.css`, `test/helpers.js`.
