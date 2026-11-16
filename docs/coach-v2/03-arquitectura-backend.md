# 03 · Arquitectura del backend

Principio: **el backend calcula y decide; la IA, si entra, solo entiende un texto dudoso o redacta hechos ya calculados.** Todo el contenido (mensajes, diccionario, umbrales, esquemas) vive en JSON versionado.

## 1. Pipeline de una solicitud

```
                      POST /api/v1/coach/mensajes  (SolicitudCoach)
                                   │
        ┌──────────────────────────▼──────────────────────────┐
   [A]  │ Sesión + permiso + límite por minuto + idempotencia │  (si ya existe la clave: devuelve la misma respuesta)
        └──────────────────────────┬──────────────────────────┘
                 ┌─────────────────┴──────────────────┐
         accion (botón)                         texto libre
                 │                                     │
                 │                      [B] Parser (normalizar → intención + entidades + confianza)
                 │                                     │
                 │              confianza ≥ 0,7 y sin faltantes ──┐
                 │              con faltantes → [D] aclaración ───┤ (plantilla con botones)
                 │              confianza < 0,7 ─► [C] IA barata (si hay cupo): clasificar / extraer
                 │                                     │         └─ sigue < 0,7 → [D] «no_entendi» + botón «Preguntarle a la IA»
                 └─────────────────┬───────────────────┘
                                   ▼
                  [E] Ejecutor de intención (registro, consulta, insight, acción)
                       lee: ResumenMes, movimientos, deudas, metas, plan, tareas
                                   ▼
                  [F] Insights y gráficos (JSON calculado en el servidor)
                                   ▼
                  [G] Selector de mensaje (catálogo: tono, severidad, condiciones, rotación)
                                   ▼
                  [H] Ensamblado RespuestaCoach (mensaje + tarjetas + gráficos + botones) → guarda → responde JSON
```

La IA entra en tres puntos y solo en estos:

| Punto | Tarea | Disparo |
|---|---|---|
| [C] | `clasificar` / `extraer` (Haiku 5.5) | Automático cuando el parser duda; tope diario por cuenta |
| Botón «Explícamelo mejor» | `redactar` (Haiku 5.5) | Explícito |
| Botón «Preguntarle a la IA» | `consejo` (Sonnet 5.5) | Explícito; cuenta contra el límite mensual |

Si la IA no está disponible o se agotó el cupo, el pipeline termina en [D] con un mensaje del catálogo. Nada deja de funcionar.

## 2. Módulos propuestos (`src/domain/coach/`)

| Módulo | Responsabilidad | Entradas | Salidas |
|---|---|---|---|
| `datos.js` | Carga y valida al arrancar los JSON (`catalogo-mensajes`, `diccionario`, `umbrales`, `esquemas`); calcula `catalogo_version` (hash) | archivos | objetos congelados |
| `normalizar.js` | Normalización de texto (`plantillas.js` de referencia) | texto | texto normalizado |
| `parser.js` | Intención y entidades (`parser-referencia.js` de referencia) | texto, fecha, moneda, pistas del usuario | `ResultadoParser` |
| `pistas.js` | Aprendizaje por cuenta (`category_hints`) | nota, categoría elegida | actualiza pistas |
| `intenciones.js` | Registro `intención → manejador`; un manejador por intención o familia | `ResultadoParser`, cuenta | hechos y variables |
| `insights/` | Un archivo por familia de insight (ranking, comparación, ritmo, hábitos, deudas, metas, presupuesto, calidad) | `ResumenMes`, histórico | `Insight[]` |
| `graficos.js` | Construye el JSON de cada gráfico a partir de los hechos | hechos | `Grafico` |
| `mensajes.js` | Selecciona variante y renderiza la plantilla (`plantillas.js` de referencia) | intención, variables, tono, recientes | texto |
| `respuesta.js` | Ensambla `RespuestaCoach` y la guarda en `messages` | todo lo anterior | JSON |
| `ia/router.js` | Define las tareas de IA: modelo, prefijo, esquema, tope de tokens, validación | tarea, hechos | resultado validado o `null` |
| `ia/prefijos.js` | Prefijos fijos versionados (generados desde los JSON) | datos | texto + hash |
| `ia/validar.js` | Valida salida de IA: esquema, cifras autorizadas, términos prohibidos, longitud | salida, hechos | ok / motivo |
| `cache.js` | Caché de respuestas de IA por clave normalizada | tarea, texto, hechos | respuesta guardada |
| `recurrentes.js` | Sugiere recurrentes en su día y detecta patrones | movimientos | propuestas |
| `preferencias.js` | Lee y valida `Preferencias` | cuenta | objeto |

Reutiliza sin cambios: `tracker` (`validateMovement`, `createMovement`, `monthSummary`, `budgetSummary`, `goals`, `debts`, `simulate`), `calc` (proyección de deudas, ratios), `tasks`, `plan`, `game`, `money` (formatos y `parseAmount`).

## 3. Datos en JSON: contrato y carga

- Archivos fuente en `src/domain/coach/data/` (copiados de `docs/coach-v2/json/`).
- Al arrancar: parsear, validar con `esquemas.json` y con un validador equivalente a `herramientas/validar.js` (catálogo coherente: variables declaradas, botones existentes, ≥ 2 variantes por intención). **Si falla, la aplicación no arranca** (mejor que responder mal).
- Cada respuesta guarda `catalog_version` (hash de los JSON) y `variant_id`; así un mensaje antiguo se reproduce con la versión con que se generó.
- Cambiar un texto = nueva versión del catálogo (`MSG_V2_ES`). Las conversaciones existentes no se reescriben.
- `umbrales.json` se puede sobrescribir desde `settings` para ajustes sin despliegue (con auditoría), pero el valor por defecto vive en el repositorio.

## 4. Selector de mensajes

1. Entrada: intención, variables ya calculadas, tono preferido, `recientes` (ids de variantes usadas en las últimas 5 respuestas de esa intención).
2. Filtra variantes cuyo `cuando` se cumple; si ninguna, las que no tienen `cuando`.
3. Prefiere el tono del usuario (`mixto` = alterna los tonos del catálogo).
4. Descarta las variantes recientes, salvo que sea la única.
5. Desempata con una semilla determinista (id de mensaje) para que reintentos devuelvan lo mismo.
6. Renderiza (`{variable:formato}`); si falta una variable obligatoria, **no** se envía el mensaje a medias: cae a la variante más simple y se registra el error.

Implementación de referencia: `herramientas/plantillas.js` (`elegirVariante`, `renderizar`, `cumple`).

## 5. Persistencia de conversación

`messages` (existente) con columnas nuevas (ver `04`): `origin` (`boton|regla|plantilla|cache|ia`), `intent`, `variant_id`, `confidence`, `catalog_version`, `payload_json` (tarjetas, gráficos, botones). El texto renderizado queda en `content`. La métrica «% sin IA» sale de `origin`.

## 6. Caché de respuestas

- Solo para tareas de IA (`consejo`, `redactar`). Clave: hash de (`tarea`, texto normalizado, hechos serializados con claves ordenadas, versión de prefijo).
- TTL 24 h (`umbrales.ia.cache_respuesta_ia_horas`). Cualquier movimiento nuevo cambia los hechos y por tanto la clave.
- Una respuesta de caché se marca `origin = 'cache'` y no cuenta contra el límite mensual.
- Las respuestas por reglas no necesitan caché de respuestas: son rápidas; si hace falta, caché en memoria por `(cuenta, mes, intención)` con invalidación al registrar un movimiento.

## 7. Seguridad y privacidad

| Riesgo | Control |
|---|---|
| Acceso entre cuentas (IDOR) | Todas las consultas filtran por `user_id` de la sesión; pruebas dedicadas (como las de `access.test.js`) |
| CSRF | Se mantiene el token en cabecera `X-CSRF-Token` para las escrituras con sesión de navegador |
| Inyección en el texto del usuario | El texto solo se usa como **dato**: nunca se concatena en SQL ni en plantillas; la nota se escapa al mostrar (`html` helper) |
| Inyección de instrucciones («ignora tus reglas…») | El parser no ejecuta instrucciones; a la IA el texto llega dentro de un campo de datos, y el prefijo dice que es dato no instrucción; la salida se valida contra esquema |
| Datos personales a la IA | Nunca se envían correo, nombre, teléfono ni notas completas. Para `clasificar`/`extraer`: solo el texto escrito en el Coach (≤ 500 caracteres) y la lista de categorías. Para `redactar`/`consejo`: solo hechos agregados del tema (importes como texto, porcentajes, nombres de categoría) |
| Cifras inventadas por la IA | Validación posterior (`ia/validar.js`): cada número del texto debe estar en los hechos enviados; si no, se descarta y se usa la plantilla |
| Consejos prohibidos | Lista de términos y patrones rechazados (productos de inversión, promesas, «garantizado»…); si aparece, se descarta |
| Abuso de costo | Límite por minuto (12 → 20 ahora que es barato), tope diario de tareas automáticas, límite mensual de IA, presupuesto global y alarmas (ver `02`) |
| Registro de datos sensibles | Los logs no incluyen texto del usuario ni importes; `ai_runs.input_json` guarda hechos y texto, y ya es de acceso restringido (el panel no muestra su contenido) |
| Retención | Mensajes y `ai_runs` se eliminan con la cuenta (`ON DELETE CASCADE`); exportación incluye `messages`; ver `privacy.js` |

## 6b. Idempotencia y concurrencia

- Toda escritura lleva `idempotency_key`; la misma clave con el mismo contenido devuelve el mismo resultado (tabla de claves por cuenta, retención 24 h).
- Registrar un movimiento: transacción única (`db.tx`) que valida, guarda y recalcula; no hay estados intermedios.
- «Deshacer»: borrado suave (`deleted_at`) dentro de la ventana de 6 s; un trabajo diario elimina definitivamente lo borrado hace más de 7 días.
- Dos pestañas: el servidor es la fuente de verdad; las respuestas incluyen el total vigente para que la interfaz se reconcilie.

## 8. Rendimiento

| Operación | Objetivo p95 | Cómo |
|---|---|---|
| Registrar un movimiento | < 150 ms | Una transacción, índices por `(user_id, date)` |
| Respuesta por reglas | < 300 ms | Consultas agregadas por mes; ResumenMes con SQL `GROUP BY` |
| Insights completos del mes | < 500 ms | Una consulta por mes anterior y actual; resultado en memoria por `(cuenta, mes)` hasta el siguiente movimiento |
| Respuesta con IA (Haiku) | < 2 s | Salida corta, caché de prompt |
| Respuesta con IA (Sonnet) | < 6 s | Contexto mínimo |

Los agregados salen de SQL (`SUM`, `GROUP BY categoria`), no de cargar movimientos en memoria. Para cuentas con miles de movimientos se añade el índice parcial `idx_movements_user_alive`.

## 9. Observabilidad

| Métrica | Fuente | Uso |
|---|---|---|
| % resuelto sin IA (`origin`) | `messages` | Meta ≥ 95 % |
| Distribución por intención | `messages.intent` | Qué se pide más → qué mejorar |
| Mensajes que terminan en «no_entendi» | `messages` | Frases nuevas para el parser |
| Costo por tarea y por usuario | `ai_runs` | Alarmas |
| Aciertos de caché | `ai_runs.cache_read_tokens` | Alarma < 70 % |
| Latencia p50/p95 por origen | middleware | SLO |
| Correcciones de categoría del usuario | `category_hints` | Calidad del parser |

Panel de administración: nueva pestaña «Coach» con estas métricas (solo agregados; sin contenido).

## 10. Despliegue gradual (feature flags)

Banderas en `settings`: `coach_v2_enabled`, `coach_v2_registro_rapido`, `coach_v2_ia_automatica`, `coach_v2_sonido`, `coach_v2_graficos`. Cada fase se activa por cuenta (lista), luego por porcentaje, luego para todos. El Coach actual permanece disponible hasta el final de la fase 3. Plan de reversa: desactivar la bandera devuelve al flujo anterior; las tablas nuevas son aditivas.
