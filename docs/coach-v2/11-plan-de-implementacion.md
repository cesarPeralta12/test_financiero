# 11 · Plan de implementación

**Aviso sobre las estimaciones:** son rangos de persona-días que calculo según el tamaño del código existente y de lo especificado; **no están medidas** y dependen de las decisiones de la sección 8. Se ajustan al terminar la fase 0 y la primera tarea de la fase 1.

## 1. Resumen de fases

| Fase | Objetivo | Persona-días (est.) | Depende de |
|---|---|---|---|
| 0 | Línea base y decisiones | 0,5 – 1 | — |
| 1 | Datos, API y registro rápido | 8 – 12 | 0 |
| 2 | Parser, catálogo, insights y gráficos; Coach de tarjetas | 12 – 18 | 1 |
| 3 | IA barata, caché de prompt, límites y panel | 5 – 8 | 2 |
| 4 | Sonido y animación | 4 – 6 | 1 (puede ir en paralelo con 2 y 3) |
| 5 | Recurrentes, plantillas, logros y mejora continua | 5 – 8 | 2 |
| 6 | Endurecimiento, accesibilidad y lanzamiento gradual | 4 – 6 | 1–5 |
| **Total** | | **≈ 38 – 59** | |

## 2. Backlog numerado

Prefijo `CV2-`. Tamaño: S (≤ 0,5 día), M (0,5–1,5), L (1,5–3), XL (> 3). «Archivos» son rutas del proyecto a tocar; las referencias de `docs/coach-v2/` indican qué implementar.

### Fase 0 · Línea base

| Id | Tarea | Tam. | Aceptación |
|---|---|---|---|
| CV2-001 | Medir `ai_runs` (consulta de `01 › 5`) y actualizar `costos.js › ACTUAL` con medias reales | S | Tabla de línea base en `02`; costo real por mensaje |
| CV2-002 | Decidir: registro gratis o de pago; proveedor de IA; sonido por defecto; mercado/moneda (BOB); automatismo de IA barata | S | Decisiones registradas en `docs/DECISIONES.md` |
| CV2-003 | Verificar precios de OpenAI si se evaluará (habilitar dominios o pegar precios) | S | `precios-modelos.json` con OpenAI o descartado |
| CV2-004 | Aprobar umbrales con el responsable financiero | S | `umbrales.json` sin `pendiente_validar` o con cambios aprobados |

### Fase 1 · Datos, API y registro rápido

| Id | Tarea | Tam. | Archivos | Aceptación |
|---|---|---|---|---|
| CV2-101 | Migración `005` (de `herramientas/005_coach_v2.sql`) | S | `src/db/migrations/005_coach_v2.sql` | Aplica en base nueva y existente; pruebas de migración |
| CV2-102 | Columna entera de centavos para ordenar y sumar sin errores (recomendado) | M | migración, `tracker.js` | Orden numérico correcto; totales idénticos a los actuales |
| CV2-103 | Subcategorías y `note_norm` en `validateMovement`/`createMovement` | M | `src/domain/tracker.js` | Pruebas de `tracker` + compatibilidad hacia atrás |
| CV2-104 | Borrado suave y restauración (6 s) | M | `tracker.js`, rutas | Pruebas R9 |
| CV2-105 | API `POST/PUT/DELETE/GET /api/v1/movimientos` con idempotencia y errores | L | `src/routes/api.js` | Pruebas R1–R12 |
| CV2-106 | `GET /api/v1/resumen` (SQL agregado, «a la misma altura») | M | `tracker.js`, `api.js` | Totales idénticos a `monthSummary` |
| CV2-107 | Pantalla «Mi dinero»: resumen, ranking simple, lista | L | `src/routes/` (nuevo), `src/views/` | Móvil y escritorio; sin JS funciona |
| CV2-108 | Registro rápido: hoja de registro, teclado, fichas de categoría, fecha, nota | L | vistas + `public/js/` | 3 toques; accesible |
| CV2-109 | Línea inteligente con vista previa (parser recortado en el navegador + servidor) | M | `public/js/`, `api.js` | Coincide con el servidor en el banco de casos |
| CV2-110 | Editar y eliminar desde la lista; «Repetir el último» | M | vistas | Pruebas |
| CV2-111 | Orden, filtros, búsqueda y agrupación (lista blanca) | L | rutas y vistas | Pruebas O1–O7 |
| CV2-112 | Confirmaciones: importe alto, duplicado, fecha futura | S | `api.js` | Pruebas R4, R6, R7 |
| CV2-113 | Moneda: añadir BOB si aplica; avisos de moneda distinta | S | `src/lib/money.js` | Formato y análisis de BOB |
| CV2-114 | Feature flags y redirecciones desde rutas antiguas | S | `src/lib/services.js`, rutas | Flags por cuenta |

### Fase 2 · Parser, catálogo, insights y Coach de tarjetas

| Id | Tarea | Tam. | Archivos | Aceptación |
|---|---|---|---|---|
| CV2-201 | Cargador y validador de datos (`datos.js`): arranque falla si el JSON es inválido | M | `src/domain/coach/datos.js` | Equivalente a `validar.js` |
| CV2-202 | Copiar y versionar `catalogo`, `diccionario`, `umbrales`, `esquemas` | S | `src/domain/coach/data/` | Hash de versión en respuestas |
| CV2-203 | Normalizador y plantillas (`normalizar.js`, `mensajes.js`) portados desde `plantillas.js` | M | `src/domain/coach/` | Golden de 242 variantes |
| CV2-204 | Parser portado desde `parser-referencia.js` | L | `src/domain/coach/parser.js` | Banco 244/244; prueba ciega ≥ 85 % |
| CV2-205 | Pistas por cuenta (`category_hints`) | M | `pistas.js` | Pruebas de aprendizaje |
| CV2-206 | Registro de intenciones → manejadores | L | `intenciones.js` | Una prueba por fila de `06 › 6` |
| CV2-207 | Insights de estado, ranking y comparación (1–17) | XL | `insights/` | Pruebas I1–I8, I13, I14 |
| CV2-208 | Insights de hábitos (18–23) | L | `insights/habitos.js` | Fórmulas de `05 › 3.1–3.2` |
| CV2-209 | Insights de acción: recorte, deudas, metas, presupuesto (24–31) | L | `insights/acciones.js` | Pruebas I9–I12 |
| CV2-210 | Calidad de datos y racha (32–35) | M | `insights/calidad.js` | Pruebas |
| CV2-211 | Gráficos: JSON + SVG de los 10 tipos con accesibilidad | XL | `graficos.js`, vistas | Contraste y alternativas de `05 › 4.2` |
| CV2-212 | `POST /coach/mensajes` por el pipeline de `03` | L | `api.js`, `respuesta.js` | Pruebas de contrato |
| CV2-213 | Conversación de tarjetas sin recarga; sugerencias contextuales | L | vistas, `public/js/` | Flujos de Playwright |
| CV2-214 | Mantener propuestas con confirmación (crear tarea, completar, actualizar meta) | M | `coach.js` | Pruebas actuales siguen en verde |
| CV2-215 | Migrar `localReply` al nuevo flujo y retirarlo | S | `coach.js` | Sin código muerto |

### Fase 3 · IA barata y control de costo

| Id | Tarea | Tam. | Aceptación |
|---|---|---|---|
| CV2-301 | Interfaz `ai.call({ tarea, prefijo, variable, esquema })` con adaptadores (Anthropic; OpenAI opcional) | L | Una tarea funciona en ambos si se activa OpenAI |
| CV2-302 | Prefijos fijos versionados ≥ 600 tokens para `clasificar`, `extraer`, `redactar`, `consejo` | M | Hash estable; sin datos de personas |
| CV2-303 | Salida estructurada para `clasificar` y `extraer`; validación | M | Pruebas A4 |
| CV2-304 | Caché de prompt (`cache_control` explícito, TTL 1 h) y registro de `cache_*` | M | Prueba A10 con clave real |
| CV2-305 | Validación de salida de `redactar` y `consejo` (cifras, términos, longitud) | M | Pruebas A6, A7 |
| CV2-306 | Caché de respuestas (`coach_response_cache`) | S | TTL 24 h |
| CV2-307 | Límites: mensual por cuenta (solo llamadas reales), tope diario automático, presupuesto global | M | Pruebas A2, A3, A5 |
| CV2-308 | `record()` con precios por caché y por modelo; columnas nuevas | S | Costos exactos |
| CV2-309 | Panel de administración «Coach»: % sin IA, costo, aciertos de caché, `no_entendi` | L | Alarmas de `02 › 6` |
| CV2-310 | Evaluación offline de calidad por tarea (sección 5 de `10`) | M | Informe; decisión Haiku/Sonnet |

### Fase 4 · Sonido y animación

| Id | Tarea | Tam. | Aceptación |
|---|---|---|---|
| CV2-401 | `public/js/sfx.js` desde `sfx-referencia.js` + interruptor y volumen | M | Probar en iOS y Android |
| CV2-402 | Preferencias (`GET/PUT /preferencias`) y sincronización con `localStorage` | S | Pruebas |
| CV2-403 | Animaciones de registro, barras, contadores y aviso de deshacer (CSS bajo `.motion`) | L | Con «reducir movimiento» solo fundidos |
| CV2-404 | Monedas que vuelan, racha, confeti reutilizando `game.js` | M | 60 fps en gama media |
| CV2-405 | Pruebas de accesibilidad de movimiento y sonido | M | `09 › 6` completa |

### Fase 5 · Pulido

| Id | Tarea | Tam. | Aceptación |
|---|---|---|---|
| CV2-501 | Recurrentes (propuesta y sugerencia mensual) | L | Pruebas |
| CV2-502 | Plantillas rápidas | M | Pruebas |
| CV2-503 | Logros y XP del registro con tope diario | M | XP independiente del importe |
| CV2-504 | Recordatorios amables (máx. 2 por semana) | M | Apagables |
| CV2-505 | Ciclo de mejora continua del parser (registro anonimizado, revisión semanal) | M | Primer lote incorporado |
| CV2-506 | Resumen semanal por lote (opcional) | M | Costo y calidad |

### Fase 6 · Endurecimiento y lanzamiento

| Id | Tarea | Tam. | Aceptación |
|---|---|---|---|
| CV2-601 | Pruebas de seguridad (IDOR, XSS, CSRF, límites, privacidad de IA) | M | `test/coach-seguridad.test.js` |
| CV2-602 | Revisión de accesibilidad completa (teclado, lector, contraste, zoom) | M | Lista de comprobación firmada |
| CV2-603 | Rendimiento (carga con 10.000 movimientos por cuenta) | M | Objetivos de `03 › 8` |
| CV2-604 | Documentar API y operación (README del Coach, runbook de alarmas) | S | — |
| CV2-605 | Despliegue gradual con flags: equipo → 10 % → 50 % → 100 % | S | Sin regresiones durante 14 días |
| CV2-606 | Retirar el Coach anterior y el código muerto | S | `localReply`, formulario antiguo |

## 3. Dependencias clave

```
CV2-101 ─┬─ CV2-103 ─ CV2-105 ─ CV2-106 ─ CV2-107 ─ CV2-108 ─ CV2-109
         └─ CV2-104
CV2-201 ─ CV2-202 ─ CV2-203 ─ CV2-204 ─ CV2-206 ─┬─ CV2-207..210 ─ CV2-211
                                                  └─ CV2-212 ─ CV2-213
CV2-212 ─ CV2-301..308 (IA)        CV2-108 ─ CV2-401..405 (sonido y animación)
```

## 4. Definición de terminado (para cada tarea)

1. Código con pruebas nuevas y la suite completa en verde.
2. Sin datos personales en logs ni en payloads de IA (snapshot).
3. Accesibilidad revisada para lo visible (teclado y lector).
4. Documentación actualizada (`docs/` y `README`).
5. Flag de activación y plan de reversa.
6. Revisión de código por otra persona.

## 5. Archivos del proyecto que se tocan (resumen)

| Área | Archivos |
|---|---|
| Datos | `src/db/migrations/005_coach_v2.sql`, `src/domain/tracker.js` |
| Dominio del Coach | `src/domain/coach.js` (se divide), nuevo `src/domain/coach/*`, `src/domain/ai/provider.js` (interfaz por tarea, precios de caché), `src/domain/ai/prompts.js` |
| API y rutas | `src/routes/api.js`, `src/routes/coach.js`, `src/routes/calculator.js`, nuevas rutas de «Mi dinero» |
| Vistas y estáticos | `src/views/*`, `public/js/` (registro, parser recortado, sfx), `public/css/` (movimiento, gráficos) |
| Juego | `src/domain/game.js` (XP y racha de registro), `public/js/game.js` (reutilizar efectos) |
| Administración | `src/routes/admin.js` (pestaña Coach) |
| Configuración | `src/config.js` (modelos por tarea, flags), `.env.example` |
| Pruebas | `test/coach-*.test.js`, `test/fixtures.js` |
| Docs | `docs/DECISIONES.md`, `docs/PRUEBAS.md`, `README.md` |

## 6. Despliegue y reversa

1. Migración 005 en un despliegue previo (es aditiva).
2. Fase 1 detrás de `coach_v2_registro_rapido`.
3. Fase 2 detrás de `coach_v2_enabled`; el Coach anterior sigue disponible.
4. Fase 3 `coach_v2_ia_automatica` apagada al inicio (solo reglas); se enciende con tope diario.
5. Fase 4 `coach_v2_sonido` apagada por defecto hasta validar en teléfonos.
6. Reversa: apagar flags. Las tablas nuevas no afectan al flujo anterior.

## 7. Riesgos

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Precisión del parser menor a la esperada | Media | Alta | Prueba ciega; respaldo de IA barata; mejora continua; botones de aclaración |
| Umbrales financieros equivocados | Media | Media | Validación experta; marcados como pendientes; textos como hipótesis |
| Costo de IA más alto que lo calculado | Baja | Media | Medir en la fase 0; alarmas; tope diario; bajar tareas a reglas |
| Caché de prompt con pocos aciertos | Media | Baja | Prefijos idénticos; TTL 1 h; medir; el costo sigue siendo bajo sin caché |
| Sonido molesto o inaccesible | Media | Baja | Apagado por defecto opcional; control; pruebas con personas |
| Complejidad del cambio | Alta | Alta | Fases y flags; el Coach anterior sigue hasta el final |
| Cambio de precios del proveedor | Baja | Media | `precios-modelos.json`; adaptador de proveedor |
| Brecha de moneda (BOB) | Media | Media | CV2-113 antes de lanzar donde aplique |
| Modismos regionales no cubiertos | Alta | Baja | Diccionario editable; aprendizaje por cuenta |

## 8. Decisiones que necesitan respuesta antes de empezar

| # | Decisión | Mi recomendación | Quién |
|---|---|---|---|
| D1 | ¿El registro básico (movimientos y resumen) es gratuito o sigue en el acompañamiento de pago? | Gratuito el registro y el resumen; de pago el análisis, metas, deudas y la IA | Producto |
| D2 | Proveedor de IA del Coach | Interfaz común; arrancar con Anthropic (precios verificados); evaluar OpenAI cuando se verifiquen sus precios | Producto y desarrollo |
| D3 | ¿IA automática barata (`clasificar`/`extraer`) cuando el parser duda, o solo con botón? | Automática, con tope diario (cuesta ≈ $0,00014 por llamada) | Producto |
| D4 | Sonido por defecto | Encendido y suave tras la primera acción, con interruptor visible; la alternativa segura es apagado | Producto y diseño |
| D5 | Mercado y monedas (¿BOB?) | Confirmar mercado y añadir las monedas necesarias | Producto |
| D6 | Umbrales de `umbrales.json` | Aprobar o ajustar con el responsable financiero | Contenido financiero |
| D7 | ¿Recurrentes con confirmación o automáticos? | Con confirmación de un toque | Producto |
| D8 | ¿Categorías propias por persona? | No al inicio; el aprendizaje por pistas cubre lo esencial | Producto |
| D9 | Retención de mensajes del Coach | Igual que el resto de datos de la cuenta | Legal y producto |

## 9. Cómo mantener esta documentación

- Cualquier cambio de texto o umbral pasa por `validar.js` y el probador del parser.
- Las tablas de costo se regeneran con `costos.js`, no a mano.
- `COACH-V2-COMPLETO.md` se regenera con `herramientas/compilar.js` al cambiar cualquier archivo de `docs/coach-v2/`.
