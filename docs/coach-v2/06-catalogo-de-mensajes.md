# 06 · Catálogo de mensajes

El Coach responde con **texto fijo de un catálogo**, rellenado con cifras que calcula el backend. Archivo fuente: `json/catalogo-mensajes.json` (versión `MSG_V1_ES`). El contenido completo, legible, está en el apéndice A de `COACH-V2-COMPLETO.md`.

## 1. Tamaño

| Grupo | Intenciones | Variantes | Descripción |
|---|---|---|---|
| `conversacion` | 15 | 36 | Saludos, ayuda, aclaraciones y errores |
| `registro` | 17 | 41 | Registrar, editar, deshacer y recurrentes |
| `resumen` | 10 | 26 | Estado del mes, saldo, totales y proyección |
| `ranking` | 11 | 28 | Mayor, menor, top, por categoría y hábitos |
| `comparacion` | 5 | 16 | Cambios frente a otros meses |
| `accion` | 14 | 33 | Recortar, deudas, metas y presupuesto |
| `plan` | 5 | 11 | Tareas y plan maestro |
| `educativo` | 8 | 17 | Conceptos explicados con las cifras de la persona |
| `calidad_datos` | 5 | 10 | Pocos datos, sin ingresos, sin registro |
| `logro` | 5 | 10 | Logros, rachas, subidas de nivel |
| `configuracion` | 3 | 6 | Sonido, moneda y privacidad |
| `ia` | 4 | 8 | Cuándo y cómo se ofrece la IA opcional |
| **Total** | **102** | **242** | |

Cada intención tiene entre 2 y 4 variantes. Hay 36 botones definidos (`botones` en el JSON), cada uno con su acción.

## 2. Estructura de una intención

```json
{
  "id": "categoria_bajo",
  "grupo": "comparacion",
  "origen": "regla",
  "descripcion": "Categoría que más bajó.",
  "vars": { "categoria": "texto", "delta_pct": "pct_signed", "delta_monto": "moneda", "mes_anterior": "mes" },
  "botones": ["ver_detalle", "ver_ranking"],
  "grafico": "comparativa_meses",
  "variantes": [
    { "id": "categoria_bajo.1", "tono": "motivador", "severidad": "logro",
      "texto": "¡Buena! Tu gasto en {categoria} bajó {delta_pct:abs:pct} frente a {mes_anterior:mes}: {delta_monto:abs:moneda} menos." }
  ]
}
```

| Campo | Significado |
|---|---|
| `origen` | `regla` (depende de datos calculados) o `plantilla` (texto fijo con pocas variables) |
| `vars` | Variables que la plantilla puede usar y su tipo (`moneda`, `pct`, `pct_signed`, `entero`, `fecha`, `mes`, `texto`, `lista`, `bool`, enumeraciones `a\|b\|c`; con `?` si son opcionales) |
| `botones` | Ids de botones (definidos al principio del archivo) que acompañan la respuesta |
| `grafico` | Tipo de gráfico sugerido (`esquemas.json › TipoGrafico`) |
| `variantes[].tono` | `cercano`, `neutral`, `motivador`, `directo` |
| `variantes[].severidad` | `info` (por defecto), `logro`, `atencion`, `alerta` |
| `variantes[].cuando` | Condiciones declarativas `{ var, op, valor }` unidas por «y» |

## 3. Gramática de plantillas

| Elemento | Sintaxis | Ejemplo | Resultado |
|---|---|---|---|
| Variable | `{nombre}` | `{categoria}` | `Ocio` |
| Moneda | `{x:moneda}` | `{monto:moneda}` | `$250,00` (moneda y región de la cuenta) |
| Porcentaje | `{x:pct}` | `31,4` → | `31 %`; `7,5` → `7,5 %` |
| Porcentaje con signo | `{x:pct_signed}` | `-18` | `-18 %`; `+18 %` |
| Valor absoluto | `{x:abs:pct}` | `-18` | `18 %` |
| Entero | `{x:entero}` | `1234` | `1.234` |
| Fecha | `{x:fecha}` | `2026-11-14` | `14 de nov.` |
| Mes | `{x:mes}` | `2026-11` | `noviembre` |
| Plural | `{n:plural=movimiento\|movimientos}` | `n = 1` | `movimiento` |
| Coma opcional | `{nombre:coma}` | `Ana` / vacío | `, Ana` / (nada) |

Formatos desconocidos o variables sin valor **detienen el renderizado** y registran un error (el selector cae a la variante más simple). El validador (`herramientas/validar.js`) renderiza cada variante con valores de muestra para que ningún texto llegue roto a producción. Implementación de referencia: `herramientas/plantillas.js`.

### 3.1 Condiciones

Operadores: `=`, `!=`, `<`, `<=`, `>`, `>=`, `en`, `no_en`, `vacio`, `no_vacio`. Todas las condiciones de una variante deben cumplirse. No hay código ni expresiones: se evalúan con una función fija (`cumple`).

Ejemplo: `proyeccion_cierre` tiene tres variantes con `pct_ingreso < 90`, `90 ≤ pct_ingreso < 100` y `≥ 100`: cada una con su severidad y tono.

## 4. Cómo se elige la variante

1. Candidatas = variantes cuyo `cuando` se cumple (si ninguna, las sin condición).
2. Se prefiere el tono de la persona (`mixto`: se alternan).
3. Se descartan las usadas en las últimas 5 respuestas de esa intención.
4. Desempate determinista por semilla.

Así la misma pregunta no recibe siempre el mismo texto, pero un reintento devuelve lo mismo.

## 5. Tonos y estilo de escritura

| Tono | Cuándo | Reglas |
|---|---|---|
| `cercano` | Por defecto | Tutea, frases cortas, sin jerga; reconoce el esfuerzo |
| `neutral` | Datos puros | Sin adjetivos; formato «etiqueta: valor» |
| `motivador` | Logros | Celebra lo hecho, nunca promete resultados («esto no mide cuánto dinero tienes, sino lo que haces por ordenarlo») |
| `directo` | Preferencia de la persona | Una frase con la cifra y la acción |

Reglas de contenido (aplican a todo el catálogo; el validador revisa las prohibidas):

- **Nunca** culpar («gastaste mal», «deberías avergonzarte»). Frases como «no pasa nada» y «sin presión».
- **Nunca** prometer («vas a ahorrar…», «seguro que…»). Condicional y «estimación», «simulación», «hipótesis».
- **Nunca** recomendar productos financieros, créditos ni inversiones (intención `consejo_especifico_no`).
- **Nunca** sugerir usar la reserva de emergencia.
- Las cifras llevan su contexto («a esta misma altura del mes», «proyección simple»).
- Una idea por mensaje; máximo ≈ 400 caracteres (el validador avisa si se pasa de 420).
- Español neutro con tuteo; sin modismos regionales en el catálogo (los modismos se entienden en el parser, no se usan al responder).

## 6. Cobertura por situación («respuesta para todo»)

| Situación de la persona | Intención(es) que responde(n) |
|---|---|
| Escribe «250 super» | `registro_vista_previa` → `registrar_gasto_ok` |
| Falta un dato | `aclarar_categoria`, `aclarar_tipo`, `aclarar_importe`, `aclarar_fecha` |
| Se equivoca | `registro_editado`, `deshacer_ok`, `registro_eliminado`, `cancelado` |
| Gasto inusual | `registro_importe_alto`, `registro_duplicado_posible`, `registro_fecha_futura` |
| Pregunta cuánto lleva | `resumen_mes`, `saldo_mes`, `gasto_total`, `ingreso_total`, `tasa_ahorro_mes`, `gasto_hoy`, `gasto_semana` |
| Pregunta en qué gasta | `mayor_gasto`, `menor_gasto`, `top3_concentracion`, `gasto_categoria`, `mayor_movimiento`, `menor_movimiento` |
| Quiere comparar | `comparar_mes_anterior`, `categoria_subio`, `categoria_bajo`, `comparar_ingresos`, `tendencia_meses` |
| Quiere ahorrar | `recortar_rapido`, `sin_recorte_obvio`, `gastos_hormiga`, `suscripciones`, `gasto_repetido` |
| Quiere pagar deudas | `deuda_pagar_primero`, `deuda_liquidable`, `deuda_ninguna_liquidable`, `orden_deudas`, `simular_pago_extra` |
| Metas y presupuesto | `meta_avance`, `meta_en_riesgo`, `meta_cumplida`, `presupuesto_estado`, `presupuesto_cerca`, `presupuesto_excedido` |
| Dudas de conceptos | `explicar_saldo`, `explicar_tasa_ahorro`, `explicar_reserva`, `explicar_estrategias_deuda`, `explicar_hormiga`, `explicar_proyeccion`, `explicar_50_30_20`, `explicar_simulacion` |
| Faltan datos | `pocos_datos`, `sin_ingresos_registrados`, `sin_mes_anterior`, `muchos_en_otros`, `sin_registro_hace_dias` |
| Fuera de alcance | `fuera_de_alcance`, `consejo_especifico_no`, `identidad_ia`, `privacidad_info` |
| Sin permiso o error | `sin_permiso`, `error_generico`, `ia_no_disponible`, `ia_limite_alcanzado` |
| No se entiende | `no_entendi`, `ia_ofrecer` |

## 7. Cómo añadir o cambiar un mensaje

1. Editar `catalogo-mensajes.json` (nueva variante con id `intencion.N` siguiente; nunca reutilizar un id).
2. Declarar las variables que use en `vars`; usar solo formatos conocidos.
3. Ejecutar `node docs/coach-v2/herramientas/validar.js` (debe dar 0 errores).
4. Si la intención es nueva: añadir frases al diccionario (`sinonimos_de_intencion`) y casos a `casos-parser.json`, y un manejador en `intenciones.js`.
5. Subir la versión del catálogo si cambia un texto que ya se envió a personas (`MSG_V2_ES`); las conversaciones anteriores conservan su `variant_id` y su `catalog_version`.
6. Revisión editorial: tono, sin culpa, sin promesas, sin términos prohibidos.

## 8. Qué mensajes necesitan IA

Ninguno del catálogo. Solo `ia_respuesta_prefijo` precede a un texto redactado por IA para indicarlo; la IA **nunca** reemplaza una variante del catálogo cuando existe una que aplica.
