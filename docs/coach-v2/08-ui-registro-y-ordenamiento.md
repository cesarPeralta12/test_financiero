# 08 · Pantallas, registro rápido y ordenamiento

Principios: móvil primero; funciona **sin JavaScript** (formularios normales) y mejora con él; cada lista se puede **ordenar, filtrar, agrupar y buscar**; cada acción tiene retroalimentación inmediata y se puede deshacer.

## 1. Mapa de pantallas

| Pantalla | Ruta propuesta | Reemplaza a | Contenido |
|---|---|---|---|
| Mi dinero (hub) | `/mi-dinero` | `/calculadora/movimientos` (redirige) | Resumen del mes, registro rápido, ranking, insights, lista |
| Movimientos | `/mi-dinero/movimientos` | lista actual | Lista completa con orden, filtros, búsqueda y agrupación |
| Análisis | `/mi-dinero/analisis` | — | Gráficos y todos los insights |
| Coach | `/coach` | chat actual | Conversación de tarjetas |
| Recurrentes y atajos | `/mi-dinero/atajos` | — | Recurrentes y plantillas |
| Deudas, Metas, Presupuesto, Simulador | rutas actuales | — | Se mantienen; se añaden orden y filtros |

Las rutas actuales siguen funcionando (redirecciones 301) hasta cerrar la fase 1.

## 2. Registro rápido

### 2.1 Flujo de tres toques

```
[ + ]  (botón fijo abajo a la derecha)
  1. Elegir  [Gasto] [Ingreso]                 → toque 1 (por defecto: gasto)
  2. Teclado numérico grande → importe           → toque 2 (escribir 250)
  3. Ficha de categoría (las más usadas primero) → toque 3 → se guarda
     Fecha: [Hoy] [Ayer] [Elegir]   Nota: opcional   Más opciones ▾
```

En el tercer toque se guarda. El aviso «Anotado: $250,00 en Alimentación» aparece 6 s con **Deshacer**.

### 2.2 Línea inteligente (texto)

```
┌──────────────────────────────────────────────┐
│ Escribe: «250 super», «cobré 800», «luz 80»  │
└──────────────────────────────────────────────┘
       ▼ (al escribir, vista previa en vivo, sin llamar a ningún servidor de IA)
   Gasto · $250,00 · Alimentación › Super · Hoy      [Guardar]  [Cambiar]
```

La vista previa sale del parser (`07`). Si falta algo: fichas para completar (categoría, tipo, fecha) en vez de adivinar. Enter guarda.

### 2.3 Wireframe del hub (móvil)

```
┌────────────────────────────┐
│ Mi dinero      ‹ Nov 2026 ›│
├────────────────────────────┤
│ Ingresos   Gastos    Saldo │
│  1.200      860       340  │
├────────────────────────────┤
│ Gastos por categoría       │
│ Alimentación ██████ 31 %   │
│ Vivienda     █████  25 %   │
│ Transporte   ███    14 %   │
│ Ver todo ›                 │
├────────────────────────────┤
│ ● Ocio subió 18 % vs oct.  │
│ ● Proyección: 1.613 de gasto│
│ ● Más observaciones (3) ›  │
├────────────────────────────┤
│ Hoy                        │
│  Café            −3,50     │
│  Super          −250,00    │
│ Ayer …                     │
└────────────────────────────┘
                         ( + )
```

En escritorio: dos columnas (resumen y gráficos a la izquierda; lista a la derecha).

### 2.4 Validaciones y confirmaciones

| Caso | Comportamiento |
|---|---|
| Importe vacío, 0, negativo, > 999.999.999,99, > 2 decimales | Mensaje en el campo y `aclarar_importe`; no se guarda |
| Fecha futura (> 1 día) | Pregunta; las recurrentes futuras se manejan aparte |
| Importe ≥ 5 × la mediana de gastos de la persona | Confirmación `registro_importe_alto` |
| Mismo importe + categoría + nota en 10 min | Confirmación `registro_duplicado_posible` |
| Moneda distinta de la de la cuenta | `moneda_info`; no se convierte |
| Doble toque en «Guardar» | Idempotencia: un solo movimiento |
| Sin conexión | Se guarda en la cola local y se reenvía con la misma `idempotency_key`; se muestra «Pendiente de enviar» |

### 2.5 Editar, borrar, deshacer

- Tocar un movimiento abre una hoja inferior con los campos editables y «Eliminar».
- Eliminar es **borrado suave** (`deleted_at`) con «Deshacer» 6 s; luego sigue recuperable 7 días desde «Eliminados recientemente» (opcional).
- Editar recalcula totales, vacía la caché de insights del mes y muestra `registro_editado`.
- «Repetir el último» y plantillas: un toque crea el movimiento de hoy con el mismo importe.

### 2.6 Recurrentes y plantillas

- **Recurrentes:** sueldo, renta, suscripciones. Se **sugieren** el día que toca (`recurrente_sugerido_mes`) con un toque para confirmar o ajustar el importe; no se crean solos.
- **Plantillas:** tras el 3.er uso de la misma nota+importe se ofrece guardar el atajo (máx. 12 por cuenta); aparecen como fichas bajo el teclado.

## 3. Ordenar, filtrar, agrupar y buscar (en todo)

### 3.1 Parámetros de URL (servidor, sin JavaScript)

| Parámetro | Valores | Defecto |
|---|---|---|
| `mes` | `AAAA-MM` | mes actual |
| `desde`, `hasta` | `AAAA-MM-DD` | vacío (el mes) |
| `tipo` | `ingreso`, `gasto`, `pago_deuda`, `ahorro`, `retiro_ahorro`, `transferencia` (repetible) | todos |
| `categoria` | código (repetible) | todas |
| `sub` | subcategoría | todas |
| `q` | texto (busca en nota y categoría, normalizado) | vacío |
| `min`, `max` | importes | vacío |
| `origen` | `usuario`, `texto`, `coach`, `recurrente`, `plantilla` | todos |
| `orden` | ver 3.2 | `fecha_desc` |
| `agrupar` | `ninguno`, `dia`, `semana`, `categoria`, `tipo` | `dia` |
| `pagina`, `limite` | enteros (límite máx. 100) | 1 y 30 |

### 3.2 Ordenamientos permitidos (lista blanca)

El servidor **nunca** concatena `orden` en SQL: lo traduce con esta tabla.

| `orden` | SQL (`ORDER BY`) | Desempate estable |
|---|---|---|
| `fecha_desc` | `date DESC` | `, id DESC` |
| `fecha_asc` | `date ASC` | `, id ASC` |
| `importe_desc` | `CAST(amount AS REAL) DESC` | `, date DESC, id DESC` |
| `importe_asc` | `CAST(amount AS REAL) ASC` | `, date DESC, id DESC` |
| `categoria_asc` | `category ASC` | `, date DESC, id DESC` |
| `nota_asc` | `note_norm ASC` | `, date DESC, id DESC` |
| `creado_desc` | `created_at DESC` | `, id DESC` |

(Importes se guardan como texto; el orden numérico usa `CAST` o una columna entera en centavos. Recomendado: añadir `amount_cents INTEGER` generado para ordenar y sumar sin errores.)

Valor desconocido de `orden` → `fecha_desc` (sin error).

### 3.3 Qué se puede ordenar en cada pantalla

| Lista | Ordenar por | Filtrar por | Agrupar por | Buscar |
|---|---|---|---|---|
| Movimientos | fecha, importe, categoría, nota, creado | mes, rango, tipo, categoría, subcategoría, origen, importe mín/máx | día, semana, categoría, tipo | nota y categoría |
| Categorías (ranking) | monto, porcentaje, cambio frente al mes anterior, nombre, número de movimientos | tipo (gasto/ingreso), solo discrecionales, solo hormiga | — | nombre |
| Deudas | saldo, tasa efectiva, cuota, nombre, orden de la estrategia | activas / pagadas | — | nombre |
| Metas | avance %, fecha estimada, objetivo, nombre | activas / cumplidas / archivadas | — | nombre |
| Recurrentes | día del mes, importe, nombre | activos / pausados, tipo | tipo | nombre |
| Plantillas | usos, importe, nombre | tipo | — | nombre |
| Insights | severidad + prioridad (defecto), fecha, categoría | severidad, grupo temático | grupo | — |
| Conversación del Coach | cronológico (fijo) | por intención (solo en el panel de administración) | — | texto |
| Catálogo de mensajes (administración) | grupo, intención, tono, severidad, variantes | grupo, tono, severidad, origen | grupo | texto de la variante |
| Panel: costo de IA | tarea, modelo, día, costo | rango, tarea, modelo | tarea, día | — |

### 3.4 Interfaz del orden

- Encabezados de tabla como botones con `aria-sort` (`ascending` / `descending` / `none`); en móvil, un selector «Ordenar por» y un conmutador de dirección.
- El orden y los filtros viajan en la URL (se pueden compartir y guardar); además se recuerda el último elegido por pantalla en `localStorage` (solo comodidad, con `try/catch`).
- Chips de filtros activos con «Quitar» individual y «Limpiar todo».
- El número de resultados y el total filtrado se anuncian (`aria-live="polite"`) al cambiar.
- Orden estable: una fila nunca «salta» entre páginas por empates (los desempates de 3.2).

## 4. El Coach como conversación de tarjetas

```
┌ Tú ───────────────────────────────┐
│ en qué gasto más                  │
└───────────────────────────────────┘
┌ Coach ────────────────────────────┐
│ Tu mayor gasto en noviembre es    │
│ Alimentación: $270,00, el 31 % de │
│ lo que gastas.                    │
│  ┌ Gastos por categoría ────────┐ │
│  │ Alimentación █████████ 31 %  │ │
│  │ Vivienda     ███████   25 %  │ │
│  └─ Ver datos ──────────────────┘ │
│ [Ver ranking] [Simular recorte]   │
│ [Comparar con el mes anterior]    │
└───────────────────────────────────┘
 Sugerencias: [Resumen] [Recortar] [Deudas]   [Escribir…]
```

- Los botones de la respuesta son acciones, no texto: no pasan por el parser ni por la IA.
- Las sugerencias bajo el campo cambian según el contexto (pocos datos → «Registrar gasto»; deuda liquidable → «Ver deuda»).
- Sin recarga de página: `fetch` a `POST /api/v1/coach/mensajes`; si JavaScript no está disponible, se usa el formulario clásico con redirección.
- El botón «Preguntarle a la IA» solo aparece cuando ninguna regla resolvió; muestra cuántas consultas de IA quedan en el mes.
- Cada respuesta indica el origen en un icono accesible («Respuesta calculada», «Redactada con IA»).

## 5. Estados y casos límite

| Estado | Qué se muestra |
|---|---|
| Cuenta nueva, sin movimientos | Pantalla de bienvenida con «Registrar mi primer gasto»; sin gráficos vacíos |
| Menos de 5 movimientos | `pocos_datos` y progreso «3 de 5 movimientos» |
| Sin ingresos del mes | `sin_ingresos_registrados`; se ocultan porcentajes sobre ingresos |
| Mes anterior sin datos | `sin_mes_anterior`; se oculta la comparación |
| Error del servidor | `error_generico` con «Reintentar»; datos locales intactos |
| IA no disponible | `ia_no_disponible`; todo lo demás funciona |
| Límite de IA alcanzado | `ia_limite_alcanzado`; reglas sin límite |
| Sin permiso | `sin_permiso` con enlace; si se decide registro gratuito, solo el análisis queda restringido |
| Moneda no soportada | `moneda_info`; aviso de configuración |
| Sin conexión | Cola local y «Pendiente de enviar» |

## 6. Textos de interfaz

| Elemento | Texto |
|---|---|
| Botón principal | «Registrar» |
| Pestañas | «Resumen», «Movimientos», «Análisis», «Atajos» |
| Campo de texto | «Escribe: 250 super, cobré 800, luz 80» |
| Guardar | «Guardar» |
| Aviso de guardado | «Anotado: {monto} en {categoría}. Deshacer» |
| Vacío (movimientos) | «Aún no hay movimientos este mes. Registra el primero con el botón +.» |
| Sin resultados de búsqueda | «No hay movimientos con esos filtros. Quita alguno para ver más.» |
| Pocos datos | «Con 5 movimientos empiezo a mostrarte observaciones.» |
| Aviso de proyección | «Proyección simple: asume que seguirás gastando al mismo ritmo.» |
| Aviso de IA | «Respuesta redactada con IA a partir de tus cifras ya calculadas.» |
| Sonido (interruptor) | «Sonidos» · «Suenan solo cuando haces algo, siempre bajitos.» |
| Movimiento (preferencia) | «Animaciones: según el sistema / reducidas / completas» |

## 7. Accesibilidad de la interfaz

| Requisito | Detalle |
|---|---|
| Teclado | Todo operable con Tab, Enter, Espacio y flechas; atajo `+` para registrar; foco visible |
| Lectores de pantalla | Resultados con `aria-live`; gráficos con resumen y tabla; botones con etiquetas claras; `aria-sort` en tablas |
| Objetivos táctiles | Mínimo 44 × 44 px |
| Contraste | Texto 4,5:1 (AA); componentes y gráficos 3:1 |
| Zoom | Usable al 200 % sin scroll horizontal |
| Sin color solo | Estados con texto e icono; series con patrón |
| Movimiento y sonido | Preferencias propias y respeto de `prefers-reduced-motion` (ver `09`) |
| Idioma | `lang="es"`; cifras con formato regional de la cuenta |
| Errores | Resumen de errores con foco y mensajes junto al campo (patrón actual del sitio) |

## 8. Rendimiento de interfaz

La primera pintura del hub no espera a los gráficos (se renderizan en el servidor dentro del HTML); el JavaScript es progresivo y pequeño (< 25 KB comprimido para registro, parser de vista previa y sonido). El parser de vista previa en el navegador es una **versión recortada** del de servidor (solo importe, fecha y categoría); el servidor siempre revalida.
