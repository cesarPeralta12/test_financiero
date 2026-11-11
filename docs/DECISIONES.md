# Decisiones, supuestos y alcance

## Decisiones necesarias para cerrar la cotización (sección 7 del documento)

| Decisión | Responsable propuesto | Estado en esta versión |
|---|---|---|
| Aprobar las 25 preguntas gratuitas y las 25 profundas, opciones y textos | Responsable de producto | **Pendiente.** Hay una v1 redactada para desarrollo (`src/db/content-v1.js`) que cubre todas las áreas pedidas. Se edita y publica desde *Administración > Cuestionarios* sin tocar código. |
| Definir evaluación, Plan Maestro y acompañamiento: paquete, precio y duración | Responsable de producto | **Pendiente.** Precios de ejemplo: evaluación 19 USD (12 meses), Plan Maestro 39 USD (12 meses), acompañamiento 29 USD (90 días) y paquete 69 USD. Editables en *Administración > Productos*. |
| Confirmar IA como coach de la primera versión y sus límites de uso | Producto y desarrollador | Implementado como coach de IA. Límites por defecto: 60 respuestas por cuenta y mes, 6 generaciones de plan por mes y 50 USD de gasto global mensual, editables en el panel. |
| Elegir pasarela, moneda de cobro y cuenta comercial | Responsable de producto | **Pendiente.** Hay una pasarela de pruebas con webhooks firmados y un adaptador intercambiable. La moneda de cobro es configurable por producto (USD en los ejemplos). |
| Validar fórmulas, supuestos y umbrales del diagnóstico | Responsable de contenido financiero | **Pendiente.** Fórmulas en `docs/CALCULOS.md`; umbrales en las reglas v1, editables y versionadas. |
| Entregar identidad visual, dominio, condiciones y política de datos | Responsable de producto | **Pendiente.** Identidad provisional sobria; textos legales en borrador marcados como tales y editables en *Administración > Textos*. |
| Confirmar stack, hosting, capacidad esperada y presupuesto operativo | Desarrollador y producto | **Pendiente.** Ver «Stack» abajo. |

## Test gratuito

El test gratuito usa el catálogo `FREE_25_V2_ES` del código (no el panel de cuestionarios), con API JSON y resultado de 12 secciones. La IA es OpenAI y es opcional. Detalle en `docs/TEST-GRATUITO.md`.

## Stack

El documento propone Laravel con MySQL, «pendiente de validación técnica». Esta versión usa **Node.js con SQLite** porque el entorno disponible no tenía PHP ni MySQL. Consecuencias:

- SQLite con WAL atiende con holgura el volumen de una primera versión en un solo servidor. Para varios servidores o mucha concurrencia de escritura conviene MySQL o PostgreSQL.
- El esquema está en migraciones SQL estándar y el acceso a datos se concentra en `src/db/index.js`. Portarlo a MySQL supone adaptar ese módulo y algunos tipos de las migraciones.
- La cola de trabajos usa la propia base de datos (tabla `jobs`) con reintentos y espera exponencial; puede correr dentro del proceso web o aparte (`npm run worker`).

## Proveedor de IA

- SDK oficial `@anthropic-ai/sdk`, modelo por defecto `claude-opus-5-5` (configurable con `AI_MODEL`).
- Se habilitó el **respaldo del lado del servidor ante rechazos** (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`): si el modelo declina una solicitud por política, la API la reintenta con el modelo recomendado. Se puede quitar en `src/domain/ai/provider.js`.
- Esfuerzo: `low` para el coach (conversación) y `medium` para redactar el plan.
- El contexto del coach se envía como mensaje de sistema a mitad de la conversación, función disponible en Claude Opus 5.5. Si se elige otro modelo, hay que confirmar que la admite.
- El plan se redacta con salida estructurada (esquema JSON). Las cifras las calcula el servidor; las instrucciones prohíben inventar o recalcular importes.
- Precios usados para estimar costo: Opus 5.5, 4 USD de entrada y 20 USD de salida por millón de tokens.
- Cada llamada guarda proveedor, modelo, versión de instrucciones (`plan-v1`, `coach-v1`), entrada, tokens, costo estimado y resultado. El panel muestra métricas, nunca el contenido.

## Supuestos de implementación

- **Sesión anónima:** cookie persistente de 30 días. Si no se vincula a una cuenta, se elimina a los 30 días desde la última actividad.
- **Moneda:** una por cuenta, elegida en el test y confirmada en la evaluación profunda. Sin conversiones.
- **Permisos:** cada producto concede uno o varios permisos con su propia duración. Un reembolso revoca los permisos de esa orden.
- **Pagos:** un evento rechazado por datos que no coinciden se responde con 200 para que la pasarela no lo reintente indefinidamente, y queda en *Fallos* para revisión. Una firma inválida responde 400.
- **Actualizar datos:** una nueva evaluación profunda crea un diagnóstico nuevo; el plan vigente no cambia hasta pedir una nueva versión, y las anteriores se conservan.
- **Día Uno:** se elige al generar el plan y puede cambiarse mientras no haya tareas completadas.
- **Eliminación de cuenta:** se borran todos los datos personales y financieros; las órdenes se conservan anonimizadas para fines contables. La política de retención definitiva está por definir.
- **Correos:** verificación y recuperación. Sin SMTP quedan en una bandeja local visible en el panel, solo fuera de producción.

## Fuera de alcance (sin cambios respecto al documento)

Apps nativas; conexión con cuentas bancarias; lectura automática de extractos; ejecución de pagos o inversiones; créditos y scoring crediticio; cotizaciones en tiempo real; atención humana; múltiples monedas con conversión; múltiples pasarelas; suscripciones recurrentes; cupones; afiliados; facturación fiscal; WhatsApp, SMS, notificaciones móviles y campañas de correo; módulos de inventario o ventas. Ramificaciones complejas en los cuestionarios requieren ampliación (solo se admite una condición simple por pregunta).

## Fase 1 · Trazabilidad y paquete de hechos (10-11-2026)

- `src/domain/knowledge/` reúne las versiones vigentes (`BCP_V1_ES`, `RFP_V1_ES`, `POIA_V1_ES`, `FACTS_V1_ES`), su procedencia documental, las 10 palancas, las 7 fases y el registro de prompts. Ningún prompt V2 está activo todavía.
- `src/domain/free/facts.js` convierte las 25 respuestas en hechos con estado (`DECLARADO`, `DESCONOCIDO`, `CONTRADICTORIO`, `NO_APLICA`…), evidencia y naturaleza: Q17, Q18 y Q25 son metas y Q23 es presupuesto de exploración, nunca ingreso real. DK/PNA nunca valen cero.
- Dos reglas de contradicción iniciales (Q02 frente a Q06) bloquean solo los datos implicados y proponen una pregunta.
- La migración `003_trazabilidad_versiones` añade a `ft_results` catálogo, conocimiento, reglas, prompt, modelo, esquema, huella de metodología, huella de entrada y el paquete de hechos. Las columnas son opcionales: los resultados anteriores se leen igual.
- El resultado pasa a `RESULT_FREE_V1_1` (mismo contenido V1 + bloques `traceability` y `evidence`). Las reglas del resultado no cambian.

## Fase 2 · Resultado gratuito V2 de crecimiento patrimonial (10-11-2026)

- `src/domain/free/patrimonial.js` (`RESULT_FREE_V2_ES`) aplica reglas `RFP_V1_ES` sobre el paquete de hechos: protección (RFP-101 a 108), restricciones (RFP-207 y tiempo) y crecimiento por ruta (RFP-201 a 206). Enfoque dual RFP-109: una alerta no borra la búsqueda de ingresos.
- Catálogo de 14 acciones autorizadas, todas sin costo. Precedencia dura: protección urgente → organización → creación de valor → construcción. Bloqueos registrados: crédito nuevo, inversión especulativa, pasos pagados y pasos de más de una hora.
- Un negocio sin retiro personal (ruta B con Q04 = ZERO) activa RFP-107 y no RFP-102: no se trata como desempleo.
- La oportunidad siempre es HIPÓTESIS (o DESCONOCIDO con una pregunta); sin puntajes 1–10 porque el test no da evidencia de mercado.
- La vista muestra seis bloques compactos y deja la lectura V1 plegada en «Ver el análisis detallado». `FREE_RESULT_V2=false` vuelve a la vista V1.
- La redacción con IA (NARR_AI_V1_ES) solo toca perfil y hallazgos V1; el bloque V2 no lo modifica ningún modelo.
- Pendiente de aprobación del ingeniero: textos de las acciones, umbrales de las reglas y la recompensa de XP que sigue en la página del resultado.

## Migración del resultado gratuito a gpt-6-luna (11-11-2026)

- Causa del fallo en producción: `gpt-6-luna` rechaza `temperature: 0.2` (400 `unsupported_value`), por lo que todas las llamadas caían a la plantilla. El cliente ya no envía `temperature` salvo que se configure `OPENAI_TEMPERATURE`.
- Salida estructurada estricta (`json_schema`, `strict: true`) con el esquema de la redacción; `reasoning_effort: none` por defecto en la familia gpt-6 (`OPENAI_REASONING_EFFORT` lo cambia). Modelo por defecto: `gpt-6-luna`.
- Cada resultado guarda en `traceability` el modelo, los tokens, la latencia y, si se usó la plantilla, el motivo (`PROVIDER_ERROR` o el código del validador). El log registra lo mismo, sin contenido del usuario.
- Prueba real (4 perfiles, base temporal): 4/4 redacciones aceptadas por el validador; promedio 504 tokens de entrada + 235 de salida y 4,5 s por test. El bloque V2 (Día Uno) no depende de la IA.

## Paquete V3: test FREE_25_V3_ES y diagnóstico RESULT_FREE_V3_ES (11-11-2026)

- Nuevo catálogo `src/domain/free/catalog3.js` (25 preguntas del documento 07, textos idénticos al JSON del ingeniero). Montos aproximados o rango en la moneda de Q01 (incluye bolivianos); Q12/Q13 se omiten solo si Q10 y Q11 confirman que no hay deudas; Q22 se adapta a la actividad (Q04). «No lo sé» y «Prefiero no responder» en todas; nunca cuentan como cero.
- El motor (`engine.js`) interpreta cada sesión con su propio catálogo: las sesiones V2 siguen igual. Sesiones nuevas según `FREE_CATALOG_VERSION` (V3 por defecto).
- Métricas del servidor (`metrics3.js`, decimal.js): salida mensual, saldo, margen sobre lo básico, meses de reserva, cobertura y brecha con el objetivo. Con un dato desconocido, rango o contradicción, la métrica queda vacía con su motivo. Los 8 fixtures del ingeniero coinciden.
- Diagnóstico (`result3.js`): la IA (`gpt-6-luna`, prompt FREE_PATRIMONIAL_V3_ES) recibe respuestas con estado, métricas, bloqueos y restricciones, y responde con el esquema estricto del ingeniero. El servidor valida forma, evidencia, métricas citadas, cifras (solo declaradas o calculadas), términos prohibidos (las advertencias como «no garantiza» se permiten) y gastos bloqueados. Si algo falla, publica un respaldo determinista y guarda el motivo.
- La oferta OFFER_PM_V1_ES (14 componentes + coach y control financiero) la añade el servidor con precio real; sin XP ni logros en el diagnóstico. La espera del diagnóstico se actualiza sola.
- Prueba real: técnico, docente y persona sin ingresos con atrasos → 3/3 redactados por la IA y aceptados (~4.700 tokens y ~17 s por diagnóstico).
- Pendiente de producto: la oferta promete 14 componentes; el Plan Maestro actual aún no los cubre todos (resolver alcance antes de cobrar, según el documento 00).
