# Plan de trabajo: Coach v2

**Fecha:** 17 de noviembre de 2026 · **Estado:** propuesta para aprobar · **Base:** `docs/coach-v2/` (especificación del zip, ya copiada al repositorio) y el plan del test (`PLAN-TEST-INTERACTIVO-Y-COACH-V2.md`).

## 1. Resumen

Hoy cada mensaje del Coach pasa por un modelo grande (Opus 5.5): ≈ US$ 0,031 por interacción, sin caché, sin categorías de gasto, con recarga de página completa y registro de movimientos de 8 campos. La v2 invierte el orden: **el servidor calcula y responde con reglas (meta ≥ 95 % sin IA)**; la IA entra solo para entender un texto dudoso (Haiku) o dar un consejo abierto (Sonnet, con botón). Ver `docs/coach-v2/01`.

Qué ve la persona: registrar un gasto en 3 toques o escribiendo «café 3,50», un resumen claro del mes (en qué gasta más, qué cambió, qué recortar, qué deuda pagar primero), gráficos calculados por el servidor y un Coach en tarjetas sin recargar. Y se **siente** como el test: onda y brillo al elegir, partículas, sonidos, pausas. Todo el movimiento y el sonido ya existe (`public/js/sfx.js`, `test-fx.js`, `motion.css`), así que la Fase 4 del zip se reduce a reutilizar.

## 2. Lo que ya está comprobado

| Qué | Resultado (17-nov-2026) |
|---|---|
| `docs/coach-v2/herramientas/validar.js` | 6 JSON válidos; 102 intenciones, 242 variantes, 36 botones; 244 casos del parser · «Todo en orden» |
| `probar-parser.js` | 244 de 244 casos |
| `costos.js` | Reproduce las tablas del zip: actual ≈ $0,031; propuesto ≈ $0,001 por llamada de IA |
| Brecha BOB (H11 del zip) | **Ya no existe**: `src/lib/money.js` soporta BOB |

Salvedad que se mantiene: el banco de 244 frases se escribió junto con el parser; en una prueba ciega de 30 frases nuevas acertó ~63 % de entrada. Por eso la mejora continua con frases reales va en el plan (S7). El 95 % sin IA es una **meta**, no un hecho.

## 3. Decisiones que necesito (con mi recomendación)

| # | Decisión | Mi recomendación |
|---|---|---|
| D1 | ¿Registro y resumen gratis, o todo en el acompañamiento de pago? Hoy exige el permiso `acompanamiento` | Registro y resumen **gratis**; de pago análisis, metas, deudas e IA |
| D2 | Proveedor de IA | Interfaz común; empezar con Anthropic (precios verificados). El repo ya trae OpenAI para el test gratuito: evaluarlo después |
| D3 | IA barata automática cuando el parser duda | Sí, con tope diario por cuenta (≈ $0,00014 por llamada) |
| D4 | Sonido por defecto | Encendido y suave, con interruptor (ya es así en el test) |
| D6 | Umbrales financieros (`umbrales.json`, marcados `pendiente_validar`) | Los valida quien responda por el contenido financiero antes de lanzar; mientras, los textos van como hipótesis |
| D7 | Recurrentes | Con confirmación de un toque |
| D8 | Categorías propias por persona | No al inicio; el aprendizaje por pistas basta |
| D9 | Retención de mensajes del Coach | Igual que el resto de datos de la cuenta (confirmar con legal) |

D5 (moneda/BOB) queda resuelta.

## 4. Orden de trabajo (cortes verticales)

Cada corte termina en algo usable detrás de una bandera (`coach_v2_*`) y con las pruebas existentes en verde. Estimaciones mías en persona-días, **sin medir**; se ajustan al terminar S1.

| Corte | Qué se entrega | Tareas del zip | Días |
|---|---|---|---|
| **S0** Línea base y decisiones | Docs en el repo; medir `ai_runs` real; decisiones D1–D9; scripts `npm run coach:validar` y `coach:parser` | CV2-001…004 | 0,5–1 |
| **S1** Datos y API | Migración 005 aditiva; importes en centavos; subcategorías; borrado suave (deshacer 6 s); `POST/PUT/DELETE/GET /api/v1/movimientos` e `/resumen` con idempotencia y errores | CV2-101…106, 112, 114 | 4–6 |
| **S2** «Mi dinero» y registro rápido | Pantalla con resumen y ranking; registro en 3 toques con fichas, teclado y fecha; línea inteligente con vista previa; editar/eliminar/repetir; orden y filtros. **Con los efectos del test** (sonido `ingreso`/`gasto`/`deshacer`, partículas al saldo, contadores) | CV2-107…111, 113; 401–405 | 6–8 |
| **S3** Cerebro por reglas | Cargador y validador de datos (la app no arranca si el JSON es inválido); parser portado; pistas por cuenta; intenciones; `POST /coach/mensajes` sin IA | CV2-201…206, 212 | 6–8 |
| **S4** Insights y gráficos | Los 35 insights en tres tandas (estado y ranking; hábitos; acciones y calidad); 10 gráficos SVG accesibles | CV2-207…211 | 8–12 |
| **S5** Coach de tarjetas | Conversación sin recargar, sugerencias contextuales, propuestas con confirmación intactas; retirar `localReply` | CV2-213…215 | 4–6 |
| **S6** IA barata y costo | Interfaz `ai.call` por tarea; prefijos con caché; salida estructurada y validación de cifras; límites; pestaña «Coach» del panel | CV2-301…310 | 5–8 |
| **S7** Pulido | Recurrentes, plantillas, logros sin premiar el monto, recordatorios amables, mejora continua del parser | CV2-501…506 | 5–8 |
| **S8** Lanzamiento | Pruebas de seguridad y accesibilidad, rendimiento con 10.000 movimientos, despliegue gradual por bandera, retirar el Coach anterior | CV2-601…606 | 4–6 |
| | **Total** | | **≈ 43–65** |

Dependencias: S1 → S2 → S3 → S4 → S5 → S6. S2 puede avanzar en paralelo con S3 una vez hecha la API de S1.

## 5. Primer corte propuesto (S0 + arranque de S1)

1. Medir la línea base (`ai_runs`) y registrar decisiones en `docs/DECISIONES.md`.
2. Añadir scripts npm para validar el catálogo y el parser (ya corren hoy).
3. Migración `005_coach_v2.sql` (de `docs/coach-v2/herramientas/`), con prueba de migración sobre el esquema real.
4. `tracker.js`: centavos enteros, `note_norm`, subcategorías y borrado suave, con compatibilidad hacia atrás.
5. API `movimientos` y `resumen` con las pruebas R1–R12 del plan de calidad (`docs/coach-v2/10`).

## 6. Reglas que no se rompen

- La IA nunca calcula ni inventa un número: el servidor calcula y la salida se valida contra los hechos enviados.
- Nada de datos personales a la IA (ni correo, nombre ni notas completas).
- Propuestas con confirmación; consulta hipotética no cambia datos.
- Sin tocar la reserva de emergencia, sin productos de inversión, sin culpa.
- Cada paso con bandera y plan de reversa; las tablas nuevas son aditivas.
- Accesibilidad: nada solo por sonido o solo por movimiento; respeta «reducir movimiento».
- **Nada se publica ni se hace `push` hasta que lo indiques.**

## 7. Riesgos principales

| Riesgo | Mitigación |
|---|---|
| Parser con menos precisión real que la medida | Prueba ciega con frases nuevas; respaldo de IA barata; botones de aclaración; mejora continua |
| Umbrales financieros equivocados | Validación experta y textos como hipótesis |
| Costo de IA mayor al calculado | Medir en S0; alarmas; tope diario; bajar tareas a reglas |
| Complejidad del cambio | Cortes pequeños con banderas; el Coach anterior sigue hasta S8 |
| Sonido molesto o inaccesible | Interruptor visible, volumen bajo, probar en iPhone y Android |

## 8. Avance

- **S0 hecho (17-nov-2026):** decisiones registradas en `docs/DECISIONES.md`; scripts `npm run coach:validar`, `coach:parser`, `coach:costos`, `coach:baseline`; docs del zip copiadas a `docs/coach-v2/` y datos a `src/domain/coach/data/`. Falta correr `coach:baseline` contra producción.
- **S1 hecho en lo esencial:** migraciones 005 y 006, borrado suave, API de movimientos y resumen con pruebas R1–R12 y de orden, avisos de importe alto y duplicado, trabajo de purga. 261 pruebas en verde.
- **S1 pendiente:** banderas `coach_v2_*` y redirecciones desde rutas antiguas (CV2-114); aplicar D1 al permiso de acceso; subir el límite por minuto (12 → 20); el mensaje del catálogo en la respuesta de `POST` llega con S3.
- **S2 hecho en lo esencial (17-nov-2026):** pantalla `/mi-dinero` (totales que cuentan, ranking por categoría con barras, lista por día), `/mi-dinero/movimientos` (orden, filtros, búsqueda, chips y paginación en el servidor), hoja de registro en 3 toques con teclado, fichas por uso, fecha y nota, **línea inteligente** con el parser portado (`src/domain/coach/parser.js`, 244/244 casos), editar/eliminar/deshacer (6 s), «Repetir el último», monedas que vuelan al total y sonidos. Funciona sin JavaScript con formularios normales. Acceso por bandera `coach_v2_registro_rapido` (D1): con ella cualquier cuenta usa Mi dinero y la API de movimientos; sin ella, solo el acompañamiento. 271 pruebas en verde.
- **S2 pendiente:** plantillas rápidas como fichas bajo el teclado (CV2-502 va en S7); cola sin conexión con reenvío; agrupar por semana/categoría/tipo; insights y gráficos (S4); redirigir `/calculadora/movimientos` a Mi dinero; probar en iPhone/Android y con lector de pantalla; afinar sonidos de oído.
- **S3 hecho en lo esencial (17-nov-2026):** `src/domain/coach/` con `datos.js` (carga y valida los JSON al arrancar; si el catálogo está roto la app no arranca; versión con huella), `mensajes.js` (plantillas, condiciones y selector con rotación), `intenciones.js` (manejadores con cifras del servidor), `respuesta.js` (texto o botón → parser → mensaje → botones; registro con vista previa y confirmación, avisos de importe alto, duplicado y fecha futura, deshacer, corregir). `POST /api/v1/coach/mensajes` y `GET /api/v1/coach/conversacion` detrás de la bandera `coach_v2_enabled` (apagada = Coach anterior). Todo sin IA: `origin` en `messages`. Se añadieron al diccionario las frases «compara con el mes pasado/anterior» y 2 casos al banco (246). 284 pruebas en verde.
- **S3 pendiente:** el Coach web (`/coach`) sigue siendo el anterior (la conversación de tarjetas es S5); intenciones de recortes, deudas, metas, tareas y simulaciones responden «no entendí» hasta S4; plantilla de tono por persona (`coach_prefs_json.tono`) sin pantalla; mejora continua con frases reales (S7).
- **Corrección del registro y diccionario ampliado (17-nov-2026):** el chat web anterior guardaba como nota la frase completa («registro un gasto de un café a 8.50»). Ahora `src/domain/coach/nota.js` deja solo lo gastado («café», con tildes) tanto en el chat anterior como en la línea inteligente y en el Coach v2; el parser usa los verbos del diccionario para decidir el tipo (antes eran reglas fijas; «me pagó un cliente 800» ya no es un gasto) y tolera errores de tecleo en palabras de 6 letras o más («supermecado»). El diccionario creció de ~250 a ~1.800 términos (categorías y subcategorías con vocabulario de Bolivia y Latinoamérica, verbos, ~700 frases de consulta) y el banco de casos de 246 a 329. `npm run coach:no-entendidos` lista las frases que el Coach no entendió para seguir ampliando.
- **S4 hecho en lo esencial (17-nov-2026):** motor de insights en `src/domain/coach/insights/` (32 reglas de las 35 del documento 05: estado, rankings, comparaciones «a la misma altura» con filtro de relevancia, hábitos, recortes, deudas, metas, presupuesto y calidad de datos), selección por severidad/prioridad/id con descartes (migración 007), 10 tipos de gráfico en SVG accesible (`graficos.js`), `GET /api/v1/insights`, `POST /api/v1/insights/:id/descartar`, `GET /api/v1/graficos/:tipo`, observaciones en «Mi dinero» y la pantalla `/mi-dinero/analisis`. El Coach responde recortes, deudas, metas, pagos extra y siguiente paso con el mismo motor. 299 pruebas en verde.
- **S4 pendiente:** comparar avalancha frente a bola de nieve con el dato del 10 % de intereses y usar el orden del Plan Maestro; recurrentes con sugerencia mensual (S7); `meta_cumplida` y `deuda_saldada` como eventos del juego; verificar contrastes de la paleta de gráficos (Okabe-Ito adaptada, no verificada); revisión con lector de pantalla.
- **S5 hecho en lo esencial (17-nov-2026):** con la bandera `coach_v2_enabled`, `/coach` es una conversación de tarjetas (`src/views/coachV2.js`, `public/js/coach-v2.js`, `public/css/coach-v2.css`): cada respuesta indica su origen con texto («Respuesta calculada») y su severidad, trae tablas y gráficos del servidor y botones; cada botón y sugerencia es un formulario que funciona sin JavaScript y con JavaScript se agrega sin recargar (indicador «escribiendo», entrada escalonada y sonido). Sugerencias contextuales (`sugerencias.js`: cuenta nueva, pocos datos, deuda liquidable, meta, tarea). Propuestas con confirmación: registrar (con corrección de categoría, importe y fecha), crear tarea a partir de una observación y completar la siguiente tarea; 3 mensajes nuevos en el catálogo (105 intenciones, 251 variantes). Ruta `POST /coach/enviar` (CSRF, límite de 20 por minuto, permiso de acompañamiento). 305 pruebas en verde.
- **S5 pendiente:** `localReply` y el Coach anterior siguen para la bandera apagada y se retiran en S8 tras 14 días estables con la bandera abierta; `actualizar_meta` no tiene disparador en el Coach v2 (queda la ruta del Coach anterior); lector de pantalla y teclado sin probar con personas; la bandera `coach_v2_enabled` sigue apagada por defecto.
- **S6 hecho en lo esencial (18-nov-2026):** IA barata con control de costo en `src/domain/coach/ia/`. Cuatro tareas: `clasificar` y `extraer` (Haiku, automáticas solo si el parser duda y la bandera `coach_v2_ia_automatica` está abierta; apagada por defecto), `redactar` (Haiku, botón «Explícamelo mejor») y `consejo` (Sonnet, botón «Preguntarle a la IA»). Prefijos fijos de ≥ 600 tokens con `cache_control` (TTL 1 h) y la parte variable al final; costo exacto con precios de caché (`precios.js`, `ai_runs` guarda tarea, tokens de caché y costo); caché de respuestas 24 h que se consulta antes de los límites (lo ya respondido no gasta cupo); validación de toda salida (esquema, cifras solo de los hechos, términos prohibidos, longitud, sin enlaces/HTML) y privacidad A9 (sin correos/teléfonos/nombre/notas al modelo). Límites: mensual por cuenta (solo llamadas reales explícitas), diario de automáticas, presupuesto global y corte por alza de gasto. Si la IA falla, se agota un límite o la salida no pasa, el Coach responde con reglas. El pipeline sigue siendo síncrono: `respuestaIA.js` resuelve la IA primero y entrega el resultado. Panel `/admin/coach` (% sin IA, «no entendí», costo/tokens/caché/latencia por tarea, alarmas, interruptores) y purga diaria de la caché. `npm run coach:eval` (simulado; `--real` con clave). 320 pruebas en verde.
- **S6 límites honestos:** el adaptador de Anthropic y la caché de prompt **no se han probado contra la API real** (no hay clave en este entorno); el adaptador local es un simulador (su precisión no vale como medida: en el banco, 324 de 329 casos los resuelven las reglas y los 5 dudosos son preguntas abiertas o ruido). El costo real por interacción y la tasa real de aciertos de caché hay que medirlos con `npm run coach:eval -- --real` y mirando `/admin/coach` en producción. Los precios y los ids de modelo vienen de `precios-modelos.json` y `config.ai.coachModels` (sobrescribibles con `AI_MODEL_*`). Falta: llevar el consejo a los hechos de metas/deudas con más detalle, y el botón de IA en más intenciones tras ver el uso real.
- **Proveedor de IA: OpenAI (18-nov-2026).** Por decisión del usuario, la IA del Coach usa OpenAI (`gpt-6-luna` por defecto) en lugar de Anthropic. `config.ai.coachProvider` (`COACH_AI_PROVIDER`; sin indicar: OpenAI si hay `OPENAI_API_KEY`, luego Anthropic, luego el simulador; `AI_PROVIDER=local` fuerza el simulador). Modelos por tarea con `OPENAI_MODEL_CLASIFICAR/EXTRAER/REDACTAR/CONSEJO`. Salida estructurada estricta (`json_schema`), tope `max_completion_tokens` por tarea, mismos prefijos, validación, límites y caché de respuestas. El adaptador de Anthropic queda como alternativa. **Pendiente de verificar con clave real:** la forma exacta de la respuesta y la caché automática de OpenAI (exige prefijo idéntico ≥ 1.024 tokens: `clasificar` y `extraer` lo cumplen, `redactar` y `consejo` —≈ 770 tokens— no se beneficiarían hasta alargar su prefijo). **Los precios de OpenAI no están verificados:** se configuran con `OPENAI_PRICE_INPUT`, `OPENAI_PRICE_CACHED` y `OPENAI_PRICE_OUTPUT` (USD por millón); sin ellos el costo se sobreestima con el precio más alto conocido y `/admin/coach` lo avisa.
- **S7 hecho en lo esencial (18-nov-2026):** migración 008. **Recurrentes (CV2-501):** detección (mismo concepto, ±10 %, ≥ 3 meses, vigente), propuesta con confirmación, «No, solo esta vez» (no se vuelve a proponer), sugerencia del mes en su día (día 31 → último del mes) que se anota solo con «Confirmar» y con origen `recurrente`. **Atajos (CV2-502):** se proponen con ≥ 3 usos del mismo concepto e importe en 60 días, hasta 12 por cuenta, «Anotar hoy» en un toque. Pantalla `/mi-dinero/atajos` sin JavaScript (recurrentes, atajos y recordatorios) y fichas contextuales en el Coach. **XP (CV2-503):** como mucho 5 movimientos por día suman y el importe no pesa. **Recordatorios (CV2-504):** como mucho 2 por semana, nunca seguidos, solo a quien ya registra, apagables. **Resumen semanal (CV2-506):** cada lunes con cifras del servidor, tras la bandera `coach_v2_resumen_semanal` (apagada); es por plantilla, sin IA. **Mejora continua (CV2-505):** cada «no entendí» guarda la frase anonimizada (sin cuenta, sin números ni correos) y `/admin/coach` lista el lote semanal para incorporarlo o descartarlo. 330 pruebas en verde.
- **S7 pendiente:** el redactado del resumen semanal «por lote» con IA (hoy es plantilla); las fichas de atajos bajo el teclado de la hoja de registro (hoy están en `/mi-dinero/atajos` y en el Coach); el primer lote real de frases (necesita tráfico real); recordatorios por correo o push (hoy solo la campana de notificaciones); revisar si 5 movimientos/día es el tope adecuado con personas reales.
- **S8 hecho en lo posible hoy (18-nov-2026):** **Seguridad (CV2-601):** `test/coach-seguridad.test.js` (IDOR en API, botones, recurrentes y atajos; CSRF; XSS; límites por minuto; privacidad de la IA y paneles sin contenido; exportación y eliminación de datos). La exportación ahora incluye subcategoría, origen, recurrentes, atajos, pistas y preferencias del Coach. **Rendimiento (CV2-603):** con 10.000 movimientos, p95 en máquina de desarrollo: registrar 0,3 ms, respuesta por reglas ≈ 80 ms, insights ≈ 190 ms, lista ≈ 36 ms (objetivos: 150/300/500 ms). **Despliegue gradual (CV2-605):** `rollout.js` con equipo, porcentaje estable por cuenta y bandera general, controlable desde Administración → Coach; reversa instantánea. **Documentación (CV2-604):** `docs/coach-v2/OPERACION.md` (variables, banderas, alarmas, runbook, mejora semanal). **Accesibilidad (CV2-602), solo la parte automática:** comprobaciones básicas en 6 pantallas; encontró y corrigió ids duplicados en la pantalla de atajos. 341 pruebas en verde.
- **S8 pendiente / no se hizo a propósito:** **CV2-606 (retirar el Coach anterior) no se ejecutó**: exige 14 días con el v2 al 100 % sin regresiones; el procedimiento está en OPERACION.md §7. **CV2-602 completo** necesita una persona con lector de pantalla, teclado, zoom y contraste (lista sin firmar). El despliegue real (equipo → 10 % → 50 % → 100 %) y la medición de costo con OpenAI y precios reales dependen de ti y de una clave.
