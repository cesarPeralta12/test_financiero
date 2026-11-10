# Test gratuito de 25 preguntas y su resultado

Implementa las especificaciones «Test gratuito de Día Uno» (v1.1, catálogo `FREE_25_V2_ES`, anotaciones `ANN_V1_ES`) y «Resultado del test inicial gratuito» (v1.0, `RESULT_FREE_V1_ES`). Reemplaza al test gratuito anterior (v1/v2 de cuestionario genérico); las evaluaciones antiguas quedan en la base pero ya no se muestran ni se migran.

## Dónde está cada cosa

| Pieza | Archivo |
|---|---|
| Catálogo inmutable: 25 slots, variantes, textos y opciones | `src/domain/free/catalog.js` |
| Validación por tipo (`single`, `multi`, `money_or_choice`, `age_or_choice`) | `src/domain/free/values.js` |
| Motor: resolución determinista, guardado, invalidación, finalización | `src/domain/free/engine.js` |
| Anotaciones A01–A20 | `src/domain/free/annotations.js` |
| Resultado (mapa, prioridades P01–P10, primer paso, hoja de ruta) | `src/domain/free/result.js` |
| Cálculos opcionales con cifras reales (adaptador) | `src/domain/free/metrics.js` |
| Redacción con IA y plantillas de respaldo | `src/domain/free/narrative.js`, `src/domain/ai/openai.js` |
| API JSON | `src/routes/freeApi.js` |
| Pantallas web (`/test`, `/resultado`) | `src/routes/test.js`, `src/views/freeTest.js` |
| Tablas | `src/db/migrations/002_test_gratuito_25.sql` |

El catálogo vive en el código (no en el panel) para que cada sesión conserve su versión; cambiar un texto o una regla exige una versión nueva (`catalogueHash()` permite detectar cambios).

## API

Autorización: cabecera `Authorization: Bearer <access_token>` (se devuelve al crear el test) o el propietario por cuenta/sesión de navegador (con `X-CSRF-Token`). Sin autorización, 404. Errores: `{ "error": { "code", "message", ... } }`.

| Operación | Descripción |
|---|---|
| `POST /api/free-tests` | Cuerpo `{ consent: true, currency?, locale?, version_id? }`. Devuelve `session_id`, `access_token`, `revision: 0` y `next_question`. Sin consentimiento: 403 `CONSENT_REQUIRED`. |
| `GET /api/free-tests/{id}` | Estado, progreso `n de 25` y pregunta pendiente. `annotation` siempre `null` al reanudar. |
| `GET /api/free-tests/{id}/questions/{slot}` | Pregunta vigente de un slot y la respuesta activa (para editar). |
| `PUT /api/free-tests/{id}/answers/{slot}` | `{ variant_id, expected_revision, value, resolved_context_hash?, idempotency_key?, change_currency? }`. Devuelve `revision`, `invalidated_slots`, `next_question`, `annotation`, `invalidated_annotation_ids`, `annotation_budget_remaining`. |
| `POST /api/free-tests/{id}/complete` | Exige 25 respuestas válidas; una sola vez por revisión. |
| `GET /api/free-tests/{id}/diagnostic` | `pending`, `ready` (con el resultado) o `failed`. 409 `RESULT_STALE` si se editó tras finalizar. |
| `POST /api/free-tests/{id}/diagnostic/retry` | Reintenta si falló la generación. |
| `POST /api/free-tests/{id}/link` | Con sesión iniciada, vincula el test a la cuenta (idempotente). |

Formato de `value`: `single` → código (`"E"`); `multi` → lista (`["CARD"]`); `money_or_choice` → `{kind:"AMOUNT",amount:"3000.00",currency:"USD"}` o `{kind:"CHOICE",code}`; `age_or_choice` → `{kind:"AGE",value:49,confirmed:true}` o `{kind:"CHOICE",code}`. `DK` (no lo sé) y `PNA` (prefiero no responder) valen en cualquier pregunta y son excluyentes (`"DK"`, `["DK"]` o `{kind:"CHOICE",code:"DK"}`).

Códigos: 422 `INVALID_OPTION`, `INVALID_AMOUNT`, `INVALID_AGE`, `CURRENCY_MISMATCH`, `AGE_BELOW_RANGE`, `CONFIRMATION_REQUIRED`; 409 `STALE_REVISION`, `STALE_VARIANT`, `IDEMPOTENCY_CONFLICT`, `INCOMPLETE`, `RESULT_STALE`.

## IA (OpenAI) y funcionamiento sin ella

El backend calcula todo el contenido con reglas. Si hay `OPENAI_API_KEY`, el resultado queda `pending`, una cola reescribe solo el resumen del perfil y las explicaciones de los hallazgos, y la salida se valida (mismos hallazgos, solo cifras ya autorizadas, sin promesas, 50 a 90 palabras). Ante un fallo, un rechazo de la validación o sin clave, el resultado se publica `ready` con `narrative_source: "template"`. El test nunca depende de la IA.

Variables: `OPENAI_API_KEY`, `OPENAI_MODEL` (por defecto `gpt-4o-mini`), `OPENAI_BASE_URL`, `OPENAI_TIMEOUT_MS`, `FREE_RESULT_AI=false` para apagarla.

## Decisiones tomadas

- El motor es sincrónico y transaccional (SQLite); la API y la web usan el mismo motor.
- Las condiciones del catálogo son funciones de JavaScript, no un DSL almacenado. Equivale a la «condition DSL» de la especificación y se prueba por exhaustividad (cada slot resuelve exactamente una variante).
- Texto distinto sin opciones distintas (por ejemplo Q07/Q08 por ruta) se resuelve en la misma variante con redacción contextual; las variantes con otra lógica u opciones tienen su propio `variant_id`.
- El plazo de conservación mostrado en el resultado sale de `ANON_RETENTION_DAYS`.
- El adaptador de cifras exactas (`metrics.js`) existe y está probado (C02, C03, C09), pero el flujo estándar no lo usa: el catálogo no pide ingresos ni gastos.
- El panel de cuestionarios ya no administra el test gratuito; sigue administrando la evaluación profunda.
