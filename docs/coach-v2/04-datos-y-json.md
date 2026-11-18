# 04 · Datos, JSON y API

Esquemas formales: `json/esquemas.json` (JSON Schema 2020-12). Este documento da ejemplos, la migración SQL (probada) y los endpoints.

## 1. Convenciones

| Tema | Regla |
|---|---|
| Importes | Texto decimal con hasta 2 decimales (`"1250.50"`). Nunca número de coma flotante. Cálculos con `decimal.js` (`money.D`), redondeo solo al mostrar |
| Moneda | Una por cuenta (ISO 4217), sin conversión |
| Fechas | `AAAA-MM-DD`; meses `AAAA-MM`; zona horaria de la cuenta |
| Porcentajes | Número (31.2 = 31,2 %). El formato visible lo decide la plantilla (`pct`) |
| Ids de intención y de variante | `snake_case` y `intencion.N` estables; no se reutilizan |
| Versionado | `catalog_version` (hash de los JSON) en cada respuesta; `version_reglas` en cada insight |
| Errores | `{ "error": { "codigo", "mensaje", "campo?" } }` con códigos estables |

## 2. Ejemplos de contratos

### 2.1 Movimiento (entrada y salida)

```json
{
  "tipo": "gasto",
  "categoria": "alimentacion",
  "subcategoria": "super",
  "importe": "250.00",
  "fecha": "2026-11-15",
  "nota": "super",
  "origen": "texto",
  "idempotency_key": "web-3f9c1b2a-7e01"
}
```

Respuesta de `POST /api/v1/movimientos`:

```json
{
  "movimiento": { "id": 812, "fecha": "2026-11-15", "tipo": "gasto", "categoria": "alimentacion", "subcategoria": "super", "importe": "250.00", "moneda": "USD", "nota": "super", "deuda_id": null, "meta_id": null, "meta_destino_id": null, "origen": "texto", "creado_en": "2026-11-16T14:05:11.000Z" },
  "resumen": { "mes": "2026-11", "gasto": "860.00", "ingreso": "1200.00", "saldo": "340.00" },
  "respuesta": { "intencion": "registrar_gasto_ok", "mensaje": { "texto": "Anotado: $250,00 en alimentacion. Llevas $860,00 gastados este mes.", "variante_id": "registrar_gasto_ok.1", "tono": "cercano", "severidad": "info" } },
  "deshacer_hasta": "2026-11-16T14:05:17.000Z"
}
```

(En la interfaz, el servidor devuelve además la etiqueta legible de la categoría; aquí se omite por brevedad.)

### 2.2 Resumen del mes

```json
{
  "mes": "2026-11",
  "moneda": "USD",
  "ingreso": "1200.00",
  "gasto": "860.00",
  "pago_deuda": "0.00",
  "ahorro_neto": "0.00",
  "saldo": "340.00",
  "saldo_libre": "340.00",
  "n_movimientos": 31,
  "dias_con_registro": 14,
  "dias_transcurridos": 16,
  "dias_del_mes": 30,
  "por_categoria": [
    { "tipo": "gasto", "categoria": "alimentacion", "etiqueta": "Alimentación", "monto": "270.00", "pct_del_total": 31.4, "n": 12, "delta_pct": 8.0, "delta_monto": "20.00" },
    { "tipo": "gasto", "categoria": "vivienda", "etiqueta": "Vivienda", "monto": "215.00", "pct_del_total": 25.0, "n": 1, "delta_pct": 0.0, "delta_monto": "0.00" },
    { "tipo": "gasto", "categoria": "transporte", "etiqueta": "Transporte", "monto": "120.00", "pct_del_total": 14.0, "n": 9, "delta_pct": -12.0, "delta_monto": "-16.00" },
    { "tipo": "gasto", "categoria": "ocio", "etiqueta": "Ocio y suscripciones", "monto": "60.00", "pct_del_total": 7.0, "n": 4, "delta_pct": 18.0, "delta_monto": "9.00" }
  ],
  "previsto": null,
  "mes_anterior": null
}
```

(Los números de ejemplo no están calculados entre sí; el servidor garantiza que `pct_del_total` salga de `monto / gasto`.)

### 2.3 Insight

```json
{
  "id": "INS-CATEGORIA-SUBIO:2026-11",
  "tipo": "INS-CATEGORIA-SUBIO",
  "severidad": "atencion",
  "prioridad": 75,
  "intencion_mensaje": "categoria_subio",
  "variables": { "categoria": "Ocio y suscripciones", "delta_pct": 18, "delta_monto": "9.00", "mes_anterior": "2026-10" },
  "grafico": {
    "tipo": "comparativa_meses",
    "titulo": "Ocio: este mes frente a octubre",
    "moneda": "USD",
    "orden": "cambio_desc",
    "series": [
      { "id": "ocio", "etiqueta": "Ocio y suscripciones", "valor": "60.00", "valor_comparado": "51.00", "delta_pct": 18, "token_color": "serie-2", "patron": "rayas", "destacar": true }
    ],
    "a11y": { "resumen": "Ocio y suscripciones: 60,00 este mes, 51,00 en octubre, 18 % más.", "tabla": [["Categoría", "Este mes", "Octubre", "Cambio"], ["Ocio y suscripciones", "60,00", "51,00", "+18 %"]] }
  },
  "acciones": ["ver_detalle", "simular_recorte"],
  "evidencia": { "formula": "(monto_actual - monto_anterior) / monto_anterior × 100, a la misma altura del mes" },
  "periodo": "2026-11",
  "version_reglas": "INSIGHTS_V1",
  "descartable": true
}
```

### 2.4 Respuesta del Coach

```json
{
  "id": "m_9f12",
  "origen": "regla",
  "intencion": "mayor_gasto",
  "confianza": 0.97,
  "mensaje": { "texto": "Tu mayor gasto en noviembre es Alimentación: $270,00, el 31 % de lo que gastas.", "variante_id": "mayor_gasto.1", "tono": "cercano", "severidad": "info" },
  "tarjetas": [ { "tipo": "ranking", "titulo": "Gastos por categoría", "filas": [["Alimentación", "$270,00", "31 %"], ["Vivienda", "$215,00", "25 %"], ["Transporte", "$120,00", "14 %"]] } ],
  "graficos": [ { "tipo": "barras_categorias", "titulo": "Gastos de noviembre", "moneda": "USD", "orden": "valor_desc", "series": [ { "id": "alimentacion", "etiqueta": "Alimentación", "valor": "270.00", "pct": 31.4, "token_color": "serie-1", "patron": "liso", "destacar": true } ], "a11y": { "resumen": "Alimentación es la categoría más grande, 31 % del gasto.", "tabla": [["Categoría", "Monto", "%"], ["Alimentación", "270,00", "31 %"]] } } ],
  "insights": [],
  "botones": [ { "id": "ver_ranking", "etiqueta": "Ver ranking", "accion": "abrir_ranking" }, { "id": "simular_recorte", "etiqueta": "Simular recorte", "accion": "simular", "params": { "tipo": "recorte" } }, { "id": "mes_anterior", "etiqueta": "Comparar con el mes anterior", "accion": "consulta", "intencion": "comparar_mes_anterior" } ],
  "propuesta": null,
  "uso_ia": null
}
```

### 2.5 Salidas estrictas de la IA

`clasificar` (Haiku 5.5, `max_tokens` 60):

```json
{ "intencion": "gasto_categoria", "confianza": 0.86, "categoria_consultada": "transporte" }
```

`extraer` (Haiku 5.5, `max_tokens` 120):

```json
{
  "entidades": { "tipo": "gasto", "importe": "45.00", "categoria": "transporte", "subcategoria": "combustible", "fecha": "2026-11-13", "nota": "gasolina", "recurrente": false },
  "confianza": 0.9
}
```

Ambas cumplen `additionalProperties: false` y tienen todas las propiedades en `required` (modo estricto de salida estructurada). El `fecha` lo calcula el modelo solo como texto relativo; el backend vuelve a validarlo con las mismas reglas del parser y puede descartarlo.

## 3. Migración SQL propuesta (probada)

Archivo: `herramientas/005_coach_v2.sql`. Se aplicó en una base en memoria sobre las migraciones 001 a 004 reales con `herramientas/probar-migracion.js`: conserva las filas de `ai_runs` al reconstruir la tabla, el `CHECK` de `purpose` sigue rechazando valores ajenos y se crean todas las tablas y columnas.

Resumen de lo que añade:

| Cambio | Para qué |
|---|---|
| `movements.subcategory`, `note_norm`, `deleted_at` + índices | Subcategorías (hormiga, suscripciones), detectar notas repetidas, deshacer sin perder datos |
| `recurring_movements` | Sueldo, renta, suscripciones: se sugieren el día que toca |
| `quick_templates` | Atajos de un toque («Café 3,50») |
| `category_hints` | Aprendizaje por cuenta (palabra → categoría corregida) |
| `coach_response_cache` | Caché de respuestas de IA (24 h) |
| `messages.origin`, `intent`, `variant_id`, `confidence`, `catalog_version`, `payload_json` | Trazabilidad y métrica «% sin IA» |
| `users.coach_prefs_json` | Preferencias de sonido, movimiento, tono, recordatorios |
| `ai_runs` reconstruida: más `purpose`, `task`, `cache_read_tokens`, `cache_write_tokens` | Medir costo por tarea y aciertos de caché |

Nota: `ALTER TABLE ADD COLUMN` no admite `CHECK` con referencias en algunas versiones de SQLite; el `CHECK` de `messages.origin` funcionó con la versión de Node usada (22.23). Verificar con la versión del despliegue.

## 4. API

Todas bajo `/api/v1`. Sesión de navegador + `X-CSRF-Token` en escrituras (como el resto). Todas filtran por la cuenta de la sesión. Coach y movimientos exigen el permiso vigente (ver decisión sobre registro gratuito en `README.md`).

| Método y ruta | Entrada | Salida | Notas |
|---|---|---|---|
| `POST /coach/mensajes` | `SolicitudCoach` | `RespuestaCoach` | Texto o `accion`. `permitir_ia` solo `true` desde el botón de IA |
| `GET /coach/conversacion?desde=<id>&limite=30` | — | `{ mensajes: [...], siguiente }` | Paginación por id descendente |
| `GET /movimientos?mes=&tipo=&categoria=&sub=&q=&orden=&pagina=&limite=` | — | `{ items: Movimiento[], total, pagina, resumen }` | Orden y filtros en `08` |
| `POST /movimientos` | `MovimientoEntrada` | ver 2.1 | Idempotente. 422 con `campo` |
| `PUT /movimientos/:id` | `MovimientoEntrada` (parcial) | movimiento y resumen | Recalcula totales; limpia caché de insights |
| `DELETE /movimientos/:id` | — | `{ deshacer_hasta }` | Borrado suave |
| `POST /movimientos/:id/restaurar` | — | movimiento | Solo antes de `deshacer_hasta` |
| `GET /resumen?mes=AAAA-MM` | — | `ResumenMes` | Con `mes_anterior` a la misma altura |
| `GET /insights?mes=&max=5` | — | `{ insights: Insight[], total }` | Ya ordenados (ver `05`) |
| `GET /graficos/:tipo?mes=` | — | `Grafico` | Tipos en `TipoGrafico` |
| `GET/POST/PUT/DELETE /recurrentes` | `Recurrente` | — | `POST /recurrentes/:id/sugerir` crea la propuesta del mes |
| `GET/POST/DELETE /plantillas` | `Plantilla` | — | Máximo 12 por cuenta |
| `GET/PUT /preferencias` | `Preferencias` | `Preferencias` | Se guarda en `coach_prefs_json` |

Códigos de error: `NO_AUTENTICADO` (401), `SIN_PERMISO` (403), `NO_ENCONTRADO` (404), `IMPORTE_INVALIDO`, `FECHA_INVALIDA`, `CATEGORIA_INVALIDA`, `MONEDA_DISTINTA`, `IMPORTE_ALTO_REQUIERE_CONFIRMAR`, `DUPLICADO_POSIBLE` (422), `IDEMPOTENCIA_CONFLICTO` (409), `LIMITE_IA` (429), `IA_NO_DISPONIBLE` (503, nunca bloquea las reglas).

## 5. Cómo se valida un contrato

- En el arranque: `esquemas.json` es parseable y las tres salidas de IA cumplen las reglas del modo estricto (`herramientas/validar.js` lo comprueba).
- En cada petición: validación con las mismas reglas que `validateMovement` (no se duplican): categorías por tipo, importes con `money.parseAmount`, fecha válida y no futura más de un año.
- En pruebas: cada ejemplo de este documento se usa como fixture de contrato (ver `10`).
