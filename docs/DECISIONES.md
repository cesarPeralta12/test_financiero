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
