# 05 · Insights y gráficos

Un **insight** es una observación calculada por el backend con severidad, prioridad, variables para una plantilla del catálogo y, si aplica, datos de gráfico. La IA no interviene en ningún cálculo de este documento.

## 1. Definiciones comunes

Todas las sumas se hacen con decimales exactos sobre movimientos **no borrados** (`deleted_at IS NULL`) del mes, excluyendo `transferencia`, como hace hoy `monthSummary`.

| Símbolo | Definición | Fuente actual |
|---|---|---|
| `I` | Suma de `ingreso` del mes | `monthSummary.ingreso` |
| `G` | Suma de `gasto` del mes (sin pagos de deuda) | `monthSummary.gasto` |
| `D` | Suma de `pago_deuda` | `monthSummary.pago_deuda` |
| `S` | Aportes a ahorro menos retiros | `monthSummary.netSaving` |
| `B` | Saldo = `I − G − D` | `monthSummary.balance` |
| `L` | Saldo libre = `B − S` | `monthSummary.free` |
| `C[c]` | Suma de `gasto` en la categoría `c` | `monthSummary.byCategory` |
| `pct[c]` | `C[c] / G × 100` (solo si `G > 0`) | nuevo |
| `d` | Días transcurridos del mes (incluye hoy) | nuevo |
| `N` | Días del mes | nuevo |

### 1.1 «A la misma altura del mes» (comparaciones justas)

Comparar el mes en curso (día 16) contra el mes anterior completo siempre dice «gastaste menos». Por eso toda comparación usa **los mismos días**: movimientos del 1 al `d` del mes actual contra del 1 al `min(d, días del mes anterior)` del mes anterior. Los meses cerrados se comparan completos entre sí.

### 1.2 Filtro de relevancia de un cambio

Un cambio se destaca solo si cumple **las dos** condiciones (umbrales en `umbrales.json › comparacion`):

1. `|delta_pct| ≥ 15 %`.
2. `|delta_monto| ≥ max(1 % de I, 10 unidades)` (si no hay ingresos, solo las 10 unidades).

`delta_pct = (actual − anterior) / anterior × 100`. Si `anterior = 0` no hay porcentaje: se dice «nueva categoría este mes» (sin número).

### 1.3 Mínimos de datos

| Mínimo | Valor | Si no se cumple |
|---|---|---|
| Movimientos del mes para cualquier insight | 5 | Solo `INS-POCOS-DATOS` |
| Días transcurridos para proyectar | 5 | No se proyecta |
| Movimientos en cada mes para comparar | 5 | `sin_mes_anterior` |
| Meses para tendencia | 3 | No hay tendencia |
| Ingresos registrados para porcentajes sobre ingresos | `I > 0` | `sin_ingresos_registrados` y se omiten esos porcentajes |

### 1.4 Redondeo y formato

- Importes: se calculan exactos y se redondean al mostrarlos con la moneda de la cuenta (`money.format`); CLP sin decimales.
- Porcentajes: enteros; un decimal si son menores que 10 (`7,5 %`). Suma de porcentajes mostrados puede no dar exactamente 100: se muestra una nota «los porcentajes se redondean» en la vista completa.
- Signo: `+18 %` / `-12 %` solo en formato `pct_signed`; en frases como «bajó 18 %» se usa el valor absoluto.

## 2. Catálogo de insights

Severidad: `alerta` > `atencion` > `logro` > `info`. **Prioridad** (0–100) desempata dentro de la severidad. Solo se muestran 3 a la vez (resto en «Más observaciones»). «Mensaje» es la intención del catálogo de mensajes.

### 2.1 Estado del mes

| # | Insight | Mensaje | Fórmula y condición | Severidad / prioridad | Gráfico |
|---|---|---|---|---|---|
| 1 | `INS-RESUMEN-MES` | `resumen_mes` | Siempre con ≥ 5 movimientos: `I`, `G`, `B` | info 50 | `barra_ingreso_gasto` |
| 2 | `INS-SALDO-MES` | `saldo_mes` | `B`; `por_dia = B / (N − d)` si quedan días y `B > 0` | info 55; alerta 92 si `B ≤ 0` | `barra_ingreso_gasto` |
| 3 | `INS-GASTO-VS-INGRESO` | `gasto_mayor_ingreso` | `G > I` y `I > 0`; `diferencia = G − I` | alerta 95 | `barra_ingreso_gasto` |
| 4 | `INS-TASA-AHORRO` | `tasa_ahorro_mes` | `S / I × 100`, `I > 0` | logro 45 si `S > 0`; info 30 si no | `medidor_meta` |
| 5 | `INS-SIN-INGRESOS` | `sin_ingresos_registrados` | `G > 0` e `I = 0` | atención 85 | — |
| 6 | `INS-PROYECCION-CIERRE` | `proyeccion_cierre` | `P = G / d × N` (con `d ≥ 5`); `pct_ingreso = P / I × 100` | info 60 si < 90 %; atención 78 si 90–100 %; alerta 88 si ≥ 100 % | `tendencia_vs_ritmo` |

### 2.2 Rankings

| # | Insight | Mensaje | Fórmula y condición | Severidad / prioridad | Gráfico |
|---|---|---|---|---|---|
| 7 | `INS-MAYOR-CATEGORIA` | `mayor_gasto` | `argmax C[c]` con `G > 0` | info 58; atención 66 si `pct ≥ 40 %` | `barras_categorias` |
| 8 | `INS-MENOR-CATEGORIA` | `menor_gasto` | `argmin C[c]` entre las de `C > 0` | info 20 | `barras_categorias` |
| 9 | `INS-MAYOR-MOVIMIENTO` | `mayor_movimiento` | Movimiento `gasto` de mayor importe del mes | info 25 | — |
| 10 | `INS-MENOR-MOVIMIENTO` | `menor_movimiento` | Movimiento `gasto` de menor importe del mes | info 10 | — |
| 11 | `INS-TOP3` | `top3_concentracion` | `pct_top3 = (C1 + C2 + C3) / G × 100` | info 40; atención 65 si `≥ 75 %` | `barras_categorias` |
| 12 | `INS-GASTO-CATEGORIA` | `gasto_categoria` | Solo a pedido: `C[c]`, `pct[c]`, `n`, `delta_pct` vs. mes anterior | info; no aparece en el feed (prioridad 0) | `barras_categorias` |

### 2.3 Comparaciones

| # | Insight | Mensaje | Fórmula y condición | Severidad / prioridad | Gráfico |
|---|---|---|---|---|---|
| 13 | `INS-CAMBIO-GASTO-TOTAL` | `comparar_mes_anterior` | `delta_pct` de `G` a la misma altura; cumple relevancia (1.2) | logro 72 si baja; atención 74 si sube | `comparativa_meses` |
| 14 | `INS-CATEGORIA-SUBIO` | `categoria_subio` | `argmax delta_monto` entre categorías que cumplen 1.2 y `delta > 0` | atención 75 | `comparativa_meses` |
| 15 | `INS-CATEGORIA-BAJO` | `categoria_bajo` | `argmin delta_monto` con `delta < 0` y 1.2 | logro 72 | `comparativa_meses` |
| 16 | `INS-CAMBIO-INGRESO` | `comparar_ingresos` | `delta_pct` de `I` a la misma altura | info 50; atención 62 si baja y cumple 1.2 | `comparativa_meses` |
| 17 | `INS-TENDENCIA-MESES` | `tendencia_meses` | Pendiente de `G` en los últimos 3 a 6 meses cerrados: `direccion = sube` si los 3 últimos meses crecen cada uno ≥ 5 %, `baja` análogo, si no `estable` | logro 45 si baja; atención 63 si sube | `mes_a_mes` |

### 2.4 Hábitos

| # | Insight | Mensaje | Fórmula y condición | Severidad / prioridad | Gráfico |
|---|---|---|---|---|---|
| 18 | `INS-HORMIGA` | `gastos_hormiga` | Ver 3.1 | atención 60 | `barras_categorias` |
| 19 | `INS-SUSCRIPCIONES` | `suscripciones` | Ver 3.2 | info 55 | — |
| 20 | `INS-GASTO-REPETIDO` | `gasto_repetido` | Misma `note_norm` ≥ 3 veces en el mes: `n`, suma | info 35 | — |
| 21 | `INS-DIA-MAS-CARO` | `dia_mas_caro` | Promedio de `G` por día de la semana en las últimas 8 semanas (mínimo 4 semanas con datos); el día con mayor promedio; `pct_sobre_prom` frente al promedio general | info 30 | `mapa_semana` |
| 22 | `INS-FIN-DE-SEMANA` | `gasto_fin_de_semana` | Promedio diario sáb–dom vs. lun–vie en 4 semanas; destaca si `≥ +30 %` | info 32 | `mapa_semana` |
| 23 | `INS-GASTO-SEMANA` | `gasto_semana` | `G` de la semana actual y `delta_pct` frente a la anterior | info 28 | `sparkline` |

### 2.5 Acciones: recortes, deudas, metas, presupuesto

| # | Insight | Mensaje | Fórmula y condición | Severidad / prioridad | Gráfico |
|---|---|---|---|---|---|
| 24 | `INS-RECORTE-RAPIDO` | `recortar_rapido` / `sin_recorte_obvio` | Ver 3.3 | info 50 | `barras_categorias` |
| 25 | `INS-DEUDA-LIQUIDABLE` | `deuda_liquidable` / `deuda_ninguna_liquidable` | Ver 3.4 | logro 80 | — |
| 26 | `INS-DEUDA-PRIMERO` | `deuda_pagar_primero` | Primera de la estrategia vigente (plan, si existe; si no, ver 3.5) | info 62 | — |
| 27 | `INS-ORDEN-DEUDAS` | `orden_deudas` | Lista ordenada por la estrategia | info 48 | — |
| 28 | `INS-META-AVANCE` | `meta_avance` | `goals().progress`: `avance_pct = ahorrado / objetivo × 100`; meses estimados con el aporte medio de los últimos 3 meses cerrados | info 42 | `medidor_meta` |
| 29 | `INS-META-RIESGO` | `meta_en_riesgo` | `meses_con_aporte_actual − meses_deseados ≥ 3` | atención 70 | `medidor_meta` |
| 30 | `INS-PRESUPUESTO-CERCA` | `presupuesto_cerca` | `real / previsto × 100` entre 80 y 100 en una categoría del presupuesto del mes | atención 77 | `medidor_presupuesto` |
| 31 | `INS-PRESUPUESTO-EXCEDIDO` | `presupuesto_excedido` | `real / previsto ≥ 100` | alerta 90 | `medidor_presupuesto` |

### 2.6 Calidad de datos y juego

| # | Insight | Mensaje | Fórmula y condición | Severidad / prioridad | Gráfico |
|---|---|---|---|---|---|
| 32 | `INS-POCOS-DATOS` | `pocos_datos` | Movimientos del mes < 5 | info 99 (sustituye a los demás) | — |
| 33 | `INS-SIN-REGISTRO` | `sin_registro_hace_dias` | Días desde el último movimiento ≥ 3 (máx. 2 avisos por semana) | atención 85 | — |
| 34 | `INS-MUCHOS-EN-OTROS` | `muchos_en_otros` | `pct[otros] ≥ 25 %` | atención 40 | `barras_categorias` |
| 35 | `INS-RACHA` | `racha_registro` | Racha de días con movimiento (ya la calcula `game.streak`) ≥ 3 y múltiplos de 7 | logro 40 | — |

Los cierres de mes (`mes_completo`), logros (`logro_desbloqueado`), `subida_nivel`, `deuda_saldada` y `meta_cumplida` son **eventos**, no insights: los emite el módulo de juego cuando ocurren.

## 3. Reglas detalladas

### 3.1 Gastos hormiga

Un movimiento es candidato si es `gasto` y:

- su importe ≤ `hormiga_tope_pct_ingreso` % de `I` (1,5 %); si `I = 0`, ≤ 3 % de `G`; **o**
- su subcategoría está marcada `hormiga` en el diccionario (café, snacks, recargas, parqueo, comisiones, juegos).

Se agrupa por `subcategoria` (o por `note_norm`). Un grupo es hábito si tiene ≥ 6 movimientos en el mes. `monto_total = Σ` de los grupos hábito; `pct_gasto = monto_total / G`. **Se menciona solo si `pct_gasto ≥ 8 %`.** `monto_anual = monto_total × 12` se dice como «proyección simple, no una meta» y solo si el mes tiene ≥ 20 días transcurridos.

Nota de redacción: nunca se llama «innecesarios» a estos gastos (no sabemos si lo son).

### 3.2 Suscripciones y recurrentes

Una nota normalizada (o subcategoría `recurrente_probable`) con importe parecido (±10 %) en ≥ 3 meses distintos, o marcada recurrente por la persona, es recurrente. `monto_total` = suma mensual de los recurrentes de gasto. Se propone crear el recurrente (`recurrente_propuesto`) la primera vez que se detecta, y se sugiere cada mes (`recurrente_sugerido_mes`) en su día.

### 3.3 Qué recortar rápido

1. Categorías discrecionales: las de `umbrales.recorte.categorias_discrecionales` (`ocio`, `otros`) y las subcategorías marcadas `discrecional` del diccionario (restaurante, delivery, café, snacks, taxi por app, ropa, streaming…).
2. **Nunca** se sugiere recortar `vivienda`, `salud`, `educacion` ni `servicios` (`nunca_recortar`).
3. Se elige la categoría discrecional (o subcategoría) con mayor monto. Escenarios: recorte de 10 % y 20 % (`recorte_ilustrativo_pct`), tope 30 % sobre una categoría.
4. `libera = monto × recorte_pct`. Efecto: nuevo saldo libre `L + libera`; si hay deudas, se usa el simulador existente (`tracker.simulate({ pago_extra_deuda: libera })`) para `meses_deuda` y `interes_menos`.
5. Si el total discrecional es menor que el 10 % de `G`, se responde `sin_recorte_obvio`.
6. Todo se redacta como hipótesis («si recortaras…»), nunca como recomendación («debes…»).

### 3.4 Deuda liquidable «de una»

Para cada deuda activa (`debts()`), con saldo conocido `s`:

- **Liquidable** si `s ≤ L` y `L > 0` (`liquidar_con_saldo_libre_max_pct` = 100 %). `queda = L − s`.
- `interes_ahorro` = intereses que aún pagaría esa deuda con su cuota actual (de `calc.projectDebt`), como estimación.
- Se elige según la estrategia (3.5). Si ninguna cabe: `deuda_ninguna_liquidable` con la más cercana y `falta = s − L`.
- **Nunca** se usa ahorro ni la reserva de emergencia (`L` ya excluye lo apartado). El mensaje lo recuerda.

### 3.5 Estrategia de pago de deudas

1. Si hay un Plan Maestro vigente: se usa su orden (`content.presupuesto.strategy.order`).
2. Si no: **bola de nieve** (menor saldo primero), por la evidencia de motivación; y si la **avalancha** (mayor tasa efectiva primero) ahorra al menos 10 % de intereses totales frente a la bola de nieve (`avalancha_diferencia_interes_pct`), se muestra también esa alternativa con el dato.
3. La tasa se compara en tasa efectiva anual (`calc.effectiveAnnual`); tipos `desconocido` se tratan como no comparables y no se ordenan por tasa.
4. Se explica la diferencia con `explicar_estrategias_deuda`: la evidencia de que la bola de nieve ayuda a la constancia es secundaria (ver `12-referencias.md`), por eso se presenta como una opción, no como regla.

### 3.6 Ritmo y proyección

`P = G / d × N`. Se dice siempre «proyección simple» y se enlaza `explicar_proyeccion`. No se proyecta antes del día 5. Si hay un pago grande conocido (recurrente) pendiente, se suma como línea aparte en el gráfico en lugar de mezclarlo con el ritmo.

### 3.7 Orden y selección de insights

```
1. calcular todos los insights aplicables (cada uno con severidad y prioridad)
2. si hay INS-POCOS-DATOS: devolver solo ese
3. quitar los descartados por la persona en los últimos 7 días (misma id)
4. quitar duplicados por grupo temático (p. ej. solo uno de «cambio de categoría»: el de mayor |delta_monto|)
5. ordenar por severidad (alerta, atención, logro, info), luego prioridad desc, luego id asc
6. devolver los 3 primeros; el resto queda en «Más observaciones» con el mismo orden
```

Un insight descartado vuelve a aparecer si cambia de severidad. Los de severidad `alerta` no se pueden silenciar más de 24 horas.

## 4. Gráficos

Diez tipos, todos renderizados **en el servidor como SVG/HTML sin librerías** (compatible con la política de seguridad del sitio y con navegación sin JavaScript). El JSON es el contrato (`esquemas.json › Grafico`); la vista solo lo dibuja.

| Tipo | Para qué | Datos mínimos | Elementos |
|---|---|---|---|
| `barras_categorias` | Ranking de categorías | `series[]` con `valor`, `pct` | Barras horizontales ordenadas, etiqueta y porcentaje a la derecha |
| `barra_ingreso_gasto` | Ingresos frente a gastos y saldo | 3 series (ingreso, gasto, saldo) | Dos barras y marca del saldo |
| `tendencia_vs_ritmo` | Gasto acumulado por día frente al ritmo ideal | serie diaria acumulada; `referencias`: previsto, ingreso | Línea acumulada, línea punteada de ritmo, marca de hoy |
| `comparativa_meses` | Mes actual frente al anterior por categoría | `valor` y `valor_comparado`, `delta_pct` | Pares de barras y cambio en texto |
| `mes_a_mes` | Evolución de varios meses | un valor por mes | Barras verticales o línea |
| `mapa_semana` | Gasto por día de la semana | 7 valores (promedio) | 7 barras, el día más alto destacado |
| `medidor_meta` | Avance de una meta | `valor` (ahorrado), `referencias[objetivo]` | Barra de progreso con porcentaje |
| `medidor_presupuesto` | Real frente a previsto | `valor` (real), `referencias[previsto]` | Barra con marca del tope; color y patrón cambian al pasar 80 % y 100 % |
| `cascada_mes` | Cómo se va el ingreso: ingresos → gastos → deudas → ahorro → saldo | 5 pasos con signo | Barras flotantes |
| `sparkline` | Tendencia mínima en una tarjeta | ≤ 30 valores | Línea sin ejes |

### 4.1 Geometría (barras horizontales, ejemplo)

Para un contenedor de ancho `W` y `n` series con máximo `M`: ancho de barra `= valor / M × (W − margen_etiqueta − margen_valor)`; alto de barra 18 px, separación 10 px; etiqueta a la izquierda (máx. 22 caracteres con `…`), valor y porcentaje a la derecha. La barra destacada usa un trazo más grueso. Valores cero se dibujan con una línea de 1 px (nunca desaparecen).

### 4.2 Accesibilidad de gráficos (obligatoria)

| Requisito | Cómo | Criterio |
|---|---|---|
| No depender solo del color | Cada serie lleva un `patron` (liso, rayas, puntos, cuadros) además de `token_color`; los valores y porcentajes siempre están como texto | WCAG 1.4.1 (Uso del color, nivel A) |
| Contraste de elementos gráficos | Cada barra o línea ≥ 3:1 contra su fondo y vecinos; borde claro entre barras adyacentes | WCAG 1.4.11 (Contraste no textual, AA) |
| Alternativa textual | `a11y.resumen` como `aria-label`/texto visible; botón «Ver datos» muestra `a11y.tabla` | WCAG 1.1.1 |
| Paleta apta para daltonismo | Tokens `serie-1…serie-8` basados en la paleta Okabe-Ito con variantes por tema claro y oscuro; verificar con simulador | Recomendación |
| Movimiento opcional | Las animaciones de entrada respetan «reducir movimiento» (ver `09`) | WCAG 2.3.3 (AAA, buena práctica) |
| Texto escalable | Etiquetas en unidades `rem`; el gráfico no corta texto a 200 % de zoom | WCAG 1.4.4 |

La paleta Okabe-Ito (naranja, azul cielo, verde azulado, amarillo, azul, bermellón, púrpura rojizo, negro) es de uso común para daltonismo; **no se verificó en esta sesión**: antes de publicar, calcular los contrastes contra los fondos reales del tema y ajustar.

### 4.3 Ejemplos de datos

`barras_categorias`:

```json
{ "tipo": "barras_categorias", "titulo": "Gastos de noviembre", "moneda": "USD", "orden": "valor_desc",
  "series": [
    { "id": "alimentacion", "etiqueta": "Alimentación", "valor": "270.00", "pct": 31.4, "token_color": "serie-1", "patron": "liso", "destacar": true },
    { "id": "vivienda", "etiqueta": "Vivienda", "valor": "215.00", "pct": 25.0, "token_color": "serie-2", "patron": "rayas" } ],
  "a11y": { "resumen": "Alimentación es el 31 % del gasto; Vivienda, el 25 %.", "tabla": [["Categoría","Monto","%"],["Alimentación","270,00","31 %"],["Vivienda","215,00","25 %"]] } }
```

`tendencia_vs_ritmo` (proyección):

```json
{ "tipo": "tendencia_vs_ritmo", "titulo": "Gasto acumulado y ritmo", "moneda": "USD", "orden": "fecha",
  "series": [ { "id": "d01", "etiqueta": "1", "valor": "20.00" }, { "id": "d02", "etiqueta": "2", "valor": "55.00" }, { "id": "d16", "etiqueta": "16", "valor": "860.00" } ],
  "referencias": [ { "etiqueta": "Ingresos del mes", "valor": "1200.00" }, { "etiqueta": "Proyección al cierre", "valor": "1613.00" } ],
  "a11y": { "resumen": "Hasta el día 16 gastaste 860,00; a este ritmo cerrarías en 1.613,00 frente a ingresos de 1.200,00.", "tabla": [["Día","Acumulado"],["16","860,00"]] } }
```

(Cifras ilustrativas; el ejemplo de proyección es consistente: 860 / 16 × 30 = 1.612,50.)

### 4.4 Tarjetas de cifra grande

Cada insight puede renderizar una tarjeta: cifra principal (`monto` o `%`), etiqueta, variación con flecha y texto («+18 %, subió»), y el botón de acción. El signo y la dirección siempre van **también como texto** (no solo flecha o color).

## 5. Ejemplos de texto final (con el catálogo)

| Insight | Texto generado |
|---|---|
| `INS-CATEGORIA-BAJO` | «¡Buena! Tu gasto en Ocio bajó 18 % frente a octubre: $9,00 menos.» |
| `INS-CATEGORIA-SUBIO` | «Transporte subió 25 % frente a octubre: $30,00 más. Es el cambio más grande del mes.» |
| `INS-PROYECCION-CIERRE` | «A este ritmo cerrarías el mes con unos $1.613,00 de gasto, más que tus ingresos ($1.200,00). Es una estimación por ritmo diario.» |
| `INS-HORMIGA` | «Los gastos chicos y repetidos (café y otros) suman $96,00 este mes en 14 movimientos: el 11 % de lo que gastas. Uno solo pesa poco; juntos se notan.» |
| `INS-DEUDA-LIQUIDABLE` | «Con tu saldo libre de este mes ($340,00) podrías liquidar «Tarjeta B» ($300,00) y te quedarían $40,00. Antes revisa que no uses tu reserva de emergencia.» |

Las cifras de esta tabla son ilustrativas; los textos salen de las variantes del catálogo.
