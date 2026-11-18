# 10 · Pruebas y calidad

Convenciones del proyecto: `node:test`, base en memoria y `test/helpers.js` (cliente HTTP con cookies y CSRF, `answerFree`, `registerUser`, `payViaWebhook`). Las pruebas nuevas siguen ese estilo; hoy hay 239 pruebas en verde (la suite debe seguir en verde en cada fase).

## 1. Lo que ya está comprobado en esta especificación

| Comprobación | Herramienta | Resultado |
|---|---|---|
| JSON válidos; catálogo coherente (variables declaradas, botones existentes, ≥ 2 variantes por intención, plantillas que renderizan con valores de muestra); diccionario normalizado; categorías base existentes en `tracker.js`; salidas de IA en modo estricto | `validar.js` | 0 errores; 102 intenciones, 242 variantes, 36 botones |
| Parser de referencia contra el banco | `probar-parser.js` | 244 de 244 (con la salvedad de la sección 3) |
| Migración SQL sobre el esquema real | `probar-migracion.js` | Aplica sobre 001–004, conserva `ai_runs`, `CHECK` vigente |
| Sonidos: suenan, terminan en silencio, pico ≤ 0,25, `sonar()` sin gesto no lanza | `probar-sfx.js` | Todo en orden |
| Costos reproducibles | `costos.js` | Tablas en `02` |

## 2. Pirámide de pruebas para la implementación

| Nivel | Qué | Cantidad aprox. | Dónde |
|---|---|---|---|
| Unitarias | Plantillas (formatos, plurales, condiciones), selector de variantes, parser (importes, fechas, categorías, tipos), cálculos de cada insight, ordenamiento, caché | 150+ | `test/coach-*.test.js` |
| Contrato | Cada ejemplo de `04` contra `esquemas.json`; salidas de IA contra su esquema | 20+ | `test/coach-contratos.test.js` |
| Integración HTTP | Endpoints de `04` con sesión, CSRF, permisos y filtros por cuenta | 60+ | `test/coach-api.test.js` |
| Dorado (golden) | Renderizar **todas** las variantes con datos fijos y comparar con un archivo guardado | 1 por variante (242) | `test/coach-mensajes.test.js` |
| Seguridad | IDOR, XSS, inyección en el texto, CSRF, límites, privacidad de la IA | 25+ | `test/coach-seguridad.test.js` |
| Navegador (Playwright) | Registro rápido, vista previa, deshacer, orden y filtros, sonido y animación con y sin «reducir movimiento», móvil y escritorio | 15 flujos | `scripts/` o `test-e2e/` |
| Accesibilidad | Teclado, lector de pantalla (manual), contraste (script), zoom 200 % | revisión por fase | manual + script |
| Calidad de IA (offline) | 100 casos etiquetados por tarea comparando Haiku y Sonnet | por demanda | `herramientas/` (con clave real) |

## 3. Parser: cómo medirlo sin engañarse

| Medida | Cómo | Meta |
|---|---|---|
| Banco conocido | `casos-parser.json` (244). Falla la CI si baja del 100 % | 100 % |
| **Prueba ciega** | Cada trimestre, 100 frases reales nuevas que el parser nunca vio (sacadas de `no_entendi`, `aclarar_*` y de personas reales) | ≥ 90 % acierto completo; ≥ 98 % «acierto o aclaración segura» |
| Falsos guardados | Movimientos mal interpretados que la persona **guardó** sin corregir (se mide por correcciones posteriores en 24 h) | < 1 % |
| Cobertura de intenciones | Cada fila de `06 › 6` tiene ≥ 3 casos | 100 % |

Resultado actual de la prueba ciega (30 frases): ≈ 63 % acierto completo, ≈ 17 % aclaración segura, ≈ 7 % vista previa equivocada (nunca se guarda sin confirmar), ≈ 13 % sin reconocer o a la oferta de IA. Esas frases ya están en el banco como `prueba_ciega_v1`; **la precisión real con usuarios hay que medirla**.

## 4. Casos de prueba clave (matriz)

### 4.1 Registro

| # | Caso | Esperado |
|---|---|---|
| R1 | «250 super» | Vista previa gasto 250,00 Alimentación › Super hoy; guardar crea 1 movimiento |
| R2 | Doble clic en «Guardar» | 1 solo movimiento (idempotencia) |
| R3 | Importe 0, negativo, 12,34567, 1.234.567.890 | 422 `IMPORTE_INVALIDO`; no se guarda |
| R4 | Fecha futura, 31 de febrero | Aclaración; no se guarda |
| R5 | Moneda distinta | `moneda_info`; no se guarda |
| R6 | Importe ≥ 5 × mediana | Confirmación; con `confirmar_importe_alto` se guarda |
| R7 | Mismo importe+categoría+nota en 10 min | Confirmación de duplicado |
| R8 | Editar categoría | Totales recalculados; `category_hints` actualizado; mensaje `registro_editado` |
| R9 | Eliminar y deshacer dentro de 6 s | Movimiento restaurado; después de 6 s, `restaurar` falla |
| R10 | Cuenta A intenta editar movimiento de B | 404 (no revela existencia) |
| R11 | Texto con `<script>` | No se ejecuta; la nota se escapa |
| R12 | Sin conexión → reintento | Una sola vez gracias a `idempotency_key` |

### 4.2 Insights

| # | Caso | Esperado |
|---|---|---|
| I1 | 4 movimientos | Solo `pocos_datos` |
| I2 | Mes con `I = 0` | `sin_ingresos_registrados`; sin porcentajes sobre ingresos |
| I3 | Comparación a mitad de mes | Se compara «a la misma altura», no contra el mes completo |
| I4 | Categoría nueva (mes anterior 0) | «Nueva categoría», sin porcentaje |
| I5 | Cambio de 14 % | No se destaca (umbral 15 %) |
| I6 | Cambio de 20 % pero de 2 unidades | No se destaca (mínimo absoluto) |
| I7 | `d = 3` | No hay proyección |
| I8 | Proyección ≥ 100 % de ingresos | Severidad alerta, texto `proyeccion_cierre.3` |
| I9 | Recorte | Nunca propone vivienda, salud, educación ni servicios; tope 30 % |
| I10 | Deuda liquidable | Usa `L`, nunca ahorro; `queda` correcto |
| I11 | Estrategia | Con plan: orden del plan; sin plan: bola de nieve; avalancha si ahorra ≥ 10 % |
| I12 | Descartar insight | No reaparece 7 días salvo cambio de severidad; `alerta` no se silencia > 24 h |
| I13 | Orden | severidad, prioridad, id; 3 visibles |
| I14 | Importes con decimales | Sumas exactas (sin errores de coma flotante) |

### 4.3 Mensajes y plantillas

| # | Caso | Esperado |
|---|---|---|
| M1 | Todas las variantes | Renderizan con datos de muestra (ya lo hace `validar.js`) |
| M2 | Golden | Cada variante coincide con su texto guardado para un conjunto fijo de variables |
| M3 | Plural | `1 día` / `2 días` |
| M4 | Negativos | `{x:abs:pct}` correcto |
| M5 | Variable faltante | Cae a variante simple y registra error; no envía texto roto |
| M6 | Rotación | 5 respuestas seguidas no repiten variante cuando hay alternativas |
| M7 | Reintento idempotente | Misma variante |
| M8 | Palabras prohibidas | Ninguna variante contiene «garantizado», «seguro que», «inversión recomendada», «debes»… (lista en la prueba) |

### 4.4 IA

| # | Caso | Esperado |
|---|---|---|
| A1 | Parser con confianza alta | **0 llamadas** a IA |
| A2 | Parser duda y hay cupo | 1 llamada `clasificar` (Haiku) con `max_tokens` ≤ 60 |
| A3 | Tope diario superado | No llama; responde `no_entendi` con botones |
| A4 | IA devuelve JSON inválido o intención desconocida | Se descarta; `no_entendi` |
| A5 | `consejo` | Solo con `permitir_ia: true`; cuenta contra el límite mensual |
| A6 | Salida con una cifra que no estaba en los hechos | Se descarta y se usa plantilla (`validar.js` de IA) |
| A7 | Salida con término prohibido | Se descarta |
| A8 | Proveedor caído | `ia_no_disponible`; reglas siguen funcionando |
| A9 | Payload a IA | **Instantánea:** no contiene correo, nombre, teléfono ni notas completas; solo campos permitidos |
| A10 | Caché de prompt | Segunda llamada con el mismo prefijo: `cache_read_input_tokens > 0` (prueba con clave real, fuera de CI) |
| A11 | Presupuesto de tokens | El prompt de cada tarea ≤ 2.000 tokens de entrada (estimación por caracteres en CI; real en la prueba con clave) |
| A12 | Registro | Cada llamada deja una fila en `ai_runs` con `task`, tokens y costo |

### 4.5 Ordenamiento y filtros

| # | Caso | Esperado |
|---|---|---|
| O1 | Cada `orden` de la lista blanca | Orden correcto y estable entre páginas |
| O2 | `orden` desconocido o con `; DROP TABLE` | Cae a `fecha_desc`; sin error ni inyección |
| O3 | Combinación de filtros | Resultado, total y paginación coherentes |
| O4 | Importes como texto | El orden numérico es correcto (`9` antes de `10`) |
| O5 | `q` con tildes y mayúsculas | Normalizado; encuentra «café» al buscar «cafe» |
| O6 | Parámetros repetidos | `tipo=gasto&tipo=ingreso` funciona |
| O7 | Cuenta B | Nunca ve movimientos de A en ningún filtro |

### 4.6 Seguridad y privacidad

IDOR en todos los endpoints; CSRF en escrituras con cookie; XSS en notas y nombres de categoría de pistas; límites por minuto, día y mes; el panel nunca muestra contenido de `ai_runs`; eliminar la cuenta borra `messages`, pistas, plantillas, recurrentes y caché; la exportación de datos incluye lo nuevo.

## 5. Evaluación de calidad de IA (offline)

Antes de decidir modelos por tarea, un conjunto etiquetado de ≥ 100 casos por tarea (`clasificar`, `extraer`) y 30 por `consejo`/`redactar`:

| Tarea | Métrica | Meta para Haiku 5.5 |
|---|---|---|
| `clasificar` | Exactitud de intención | ≥ 92 % |
| `extraer` | Exactitud campo a campo (importe, categoría, fecha) | ≥ 95 % en importe; ≥ 90 % en categoría |
| `redactar` | 0 cifras no autorizadas; revisión editorial 4 de 5 | 100 % sin cifras ajenas |
| `consejo` | Revisión humana a ciegas (utilidad, ausencia de promesas, tono) frente a Opus 5.5 | Sonnet ≥ 90 % de las valoraciones de Opus |

Si Haiku no cumple, esa tarea sube a Sonnet y se recalcula el costo (`02 › 4.6`). Estos umbrales son **metas de producto**, no resultados.

## 6. Criterios de aceptación por fase

| Fase | Criterio |
|---|---|
| 1 Registro | Registrar un gasto en ≤ 3 toques o ≤ 5 s; deshacer 6 s; sin duplicados; 0 fallos de seguridad; la suite sigue verde |
| 2 Parser, insights, catálogo | Banco 100 %; prueba ciega ≥ 85 %; los 35 insights con pruebas; golden de 242 variantes; resueltos sin IA ≥ 90 % en pruebas internas |
| 3 IA barata | Tareas con esquema estricto; caché de prompt con aciertos > 70 % medidos; costo medio por interacción < $0,002; límites y alarmas activos |
| 4 Sonido y animación | Pruebas de `09 › 6` completas; sin regresiones de accesibilidad |
| 5 Pulido | Recurrentes, plantillas y logros con pruebas; mejora continua operando |
| Lanzamiento | ≥ 95 % sin IA sostenido 14 días; prueba ciega ≥ 90 %; sin incidentes de datos |

## 7. Métricas de producto (después del lanzamiento)

| Métrica | Fuente | Meta |
|---|---|---|
| % resuelto sin IA | `messages.origin` | ≥ 95 % |
| Costo por usuario activo y mes | `ai_runs` | < $0,05 |
| Tiempo para registrar un gasto (mediana) | Eventos del cliente | ≤ 5 s |
| Registros por usuario activo y semana | `movements` | Referencia por definir con datos reales |
| Mensajes `no_entendi` por 100 | `messages` | < 3 |
| Tasa de corrección de categoría | `category_hints` | Bajar mes a mes |
| Insights descartados / mostrados | tabla de descartes | Si > 50 % de un insight se descarta, revisar su texto o umbral |
| Satisfacción (pulgar arriba/abajo en respuestas) | Evento | ≥ 80 % positivos |

## 8. Riesgos de calidad y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Sobreajuste del parser al banco propio | Prueba ciega trimestral con frases nuevas; mejora continua |
| Insights que parecen consejos | Revisión editorial; siempre hipótesis; sin términos prohibidos (prueba M8) |
| Umbrales mal calibrados | Marcados `pendiente_validar`; validar con el responsable financiero y con datos reales antes de publicar |
| Regresión de costo | Prueba A11 y alarmas de costo medio |
| Deriva del catálogo | Golden y validador en la CI |
