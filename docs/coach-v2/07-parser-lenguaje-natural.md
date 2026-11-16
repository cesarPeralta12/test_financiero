# 07 · Parser de lenguaje natural (sin IA)

Implementación de referencia: `herramientas/parser-referencia.js` (≈ 300 líneas, sin dependencias). Datos: `json/diccionario-categorias.json`. Casos de prueba: `json/casos-parser.json` (244). Se ejecutan con `node docs/coach-v2/herramientas/probar-parser.js`.

**Objetivo:** convertir un texto corto en `{ intención, entidades, confianza, faltantes }` con reglas, de forma que la mayoría de los mensajes no necesite un modelo. Salida: `ResultadoParser` (`esquemas.json`).

## 1. Estado de la implementación de referencia

| Prueba | Resultado |
|---|---|
| Banco inicial (214 casos escritos junto con el parser) | 214 de 214 |
| Prueba ciega: 30 frases nuevas, escritas después, sin ajustar antes | ≈ 19 correctas de entrada, 5 con aclaración segura, 2 caían a la oferta de IA, 2 «desconocido», 2 vistas previas equivocadas (nunca se guardan sin confirmar) |
| Banco actual (214 + las 30 frases ciegas ya con sus correcciones) | 244 de 244 |

**Lectura honesta:** el 100 % es del banco con el que se construyó el parser; no es una medida de precisión real. La prueba ciega dio ≈ 63 % de acierto completo y ≈ 17 % de aclaración segura. Los casos que fallaron (verbos como «almorcé», «deposité»; preguntas como «cómo me fue este mes», «cuánto he ahorrado»; modales como «puedo gastar 50…») se corrigieron con reglas generales y quedaron en el banco como `prueba_ciega_v1`. Con usuarios reales habrá más huecos: por eso existen el aprendizaje por cuenta, el respaldo de IA barata y el ciclo de mejora continua (sección 9).

## 2. Orden de decisión

```
texto
 │  0. Quitar etiquetas <...> y texto entre paréntesis (ruido y posible inyección); normalizar
 │  1. Conversación breve (≤ 4 palabras): saludo, despedida, gracias
 │  2. Identidad («eres una IA»)
 │  3. Explicativas (cue «explícame / qué es / cómo calculas» + tema): explicar_*
 │  4. Límites: asesoría específica (acciones, créditos, impuestos…) o fuera de alcance (chistes, clima…), privacidad
 │  5. Correcciones del último registro («no era 250, era 205», «cámbialo a ocio», «era de ayer»), deshacer
 │  6. Fecha e importe (se extraen y se retiran del texto)
 │  7. Simulaciones con importe («qué pasa si pago 500 más»)
 │  8. Tarea hecha / ayuda (sin importe)
 │  9. Consultas por frases del diccionario (sin importe, o con importe pero sin verbo de registro)
 │ 10. Registro: tipo (por verbo), categoría (por sinónimos), importe, fecha, recurrente
 │ 11. Sin coincidencia: consulta abierta (≥ 5 palabras o «?») → ofrecer IA; si no, «no_entendi»
```

El orden importa: por ejemplo, «qué es la tasa de ahorro» (explicativa) debe resolverse antes de que la palabra «ahorro» sugiera registrar un ahorro.

## 3. Normalización

1. Minúsculas.
2. Quitar tildes y diacríticos (NFD, descartar marcas): `súper` → `super`, `ñ` → `n`.
3. Quitar todo salvo letras, números, espacios y `. , $ % - /`.
4. Colapsar espacios.

Por eso **todas** las palabras del diccionario están ya normalizadas (el validador lo comprueba: `salteña` debe escribirse `saltena`). Emojis y signos de exclamación desaparecen.

## 4. Importes

| Regla | Ejemplos |
|---|---|
| Separadores: se usa la misma regla de `parseAmount` (`src/lib/money.js`): con punto y coma, el último separador es el decimal; con un solo separador seguido de exactamente 3 cifras y parte entera distinta de 0, es separador de miles | `1.250,50` y `1,250.50` → `1250.50`; `1.250` → `1250`; `0,75` → `0.75`; `12.345` → `12345` |
| Más de 2 decimales | `12,34567` → inválido, se pregunta |
| Negativos, cero o mayores que 999.999.999,99 | inválidos, se pregunta |
| Símbolo `$` | La moneda de la cuenta |
| Sufijos | `2k` = 2.000; `2 mil` = 2.000 |
| Palabras | «mil quinientos» = 1.500; «doscientos cincuenta» = 250; «veinte» = 20. «un/una/uno» solo cuentan si preceden a mil, luca, lucas o millón (evita «un chicle» = 1) |
| Regionales | «3 lucas» = 3.000 con bandera `regional_confirmar` (se confirma con botones). «lucas» es de uso en Argentina y Chile; fuera de ahí se pide confirmación |
| Moneda distinta | `100 bs`, `50 euros` con cuenta en USD: no se convierte; bandera `moneda_distinta` → mensaje `moneda_info`. Hoy BOB no existe en `money.js` |
| Varios números | Se toma el primero que sea un importe válido; las fechas se retiran antes (`05/11`, «5 de noviembre» no son importes) |
| Números dentro de paréntesis | Se ignoran (`alert(1)` no es un importe) |

## 5. Fechas

Referencia: fecha de hoy en la zona horaria de la cuenta.

| Texto | Resultado |
|---|---|
| hoy, esta mañana, esta tarde, esta noche | hoy |
| ayer, anoche | hoy − 1 |
| anteayer, antier, antes de ayer | hoy − 2 |
| «el viernes» | el viernes más reciente que no sea futuro (si hoy es viernes, hoy) |
| «el lunes pasado» | si hoy es lunes: hoy − 7; si no, el lunes más reciente |
| «5 de noviembre», «el 5 de noviembre de 2026» | esa fecha (año actual si no se dice) |
| `05/11`, `3/11/2026` | día/mes(/año) |
| «mañana» | **futura**: se pregunta (`aclarar_fecha`) |
| Fecha futura o inexistente («31 de febrero») | se pregunta; nunca se guarda |

Sin fecha: hoy.

## 6. Tipo y categoría

**Tipo** por verbo (primer acierto en este orden): retiro de ahorro («saqué de mi ahorro», «usé mi reserva») → ahorro («ahorré», «aparté», «guardé», «deposité en mi ahorro») → ingreso («cobré», «recibí», «me pagaron», «me depositaron», «me llegó», «gané», «vendí», «me dio», «mi sueldo es») → pago de deuda (verbo de pago + tarjeta/préstamo/deuda/cuota/abono) → gasto («gasté», «pagué», «compré», «costó», «me cobraron»; también verbos de comida: «almorcé», «cené»). Si no hay verbo y hay una categoría de gasto inequívoca («250 super»), el tipo es gasto. «anota 45» **no** define el tipo (puede ser ingreso o gasto): se pregunta.

**Categoría y subcategoría:** se buscan los sinónimos del tipo elegido (diccionario). Gana el sinónimo más largo; las subcategorías tienen prioridad sobre la categoría; el nombre de cada categoría cuenta como sinónimo; «otros» solo gana si nada más coincide. Se acepta plural simple (`snacks` → `snack`).

**Nota:** la palabra que coincidió, o el residuo del texto sin verbos, importe ni palabras vacías (máx. 140 caracteres).

**Recurrente:** «cada mes», «mensual», «todos los meses», «suscripción»… → `recurrente: true` (se ofrece crear el recurrente).

### 6.1 Subcategorías y banderas

El diccionario marca cada subcategoría como `discrecional` y/o `hormiga` (y `recurrente_probable` donde aplica). Esas banderas alimentan los insights (`05`). No cambian ningún cálculo actual: son columnas nuevas (`subcategory`).

## 7. Confianza y qué hacer

| Situación | Confianza (referencia) | Acción |
|---|---|---|
| Registro completo, sin banderas | 0,95 | Vista previa y «Guardar» (nunca guarda sin confirmar si es texto libre) |
| Registro con bandera `regional_confirmar` | 0,70 | Vista previa con botones de confirmación |
| Registro con faltantes | 0,55 | Aclaración con botones (`aclarar_*`) |
| Consulta por frase | `min(0,97, 0,70 + largo_de_frase / 40)` | Responder |
| Consulta abierta | 0,30 | Ofrecer IA |
| Sin coincidencia | 0,10 | `no_entendi` |

Umbral global: `confianza_minima_parser` = 0,7 (`umbrales.json`). Por debajo, se intenta la IA barata automática (si hay cupo) y, si sigue baja, se pregunta con botones.

## 8. Aprendizaje por cuenta

- Cuando la persona **corrige** una categoría, se guarda `(término → categoría/subcategoría)` en `category_hints` (término = nota normalizada o palabra clave).
- En adelante, esas pistas tienen prioridad sobre el diccionario global para esa cuenta.
- Tras 3 usos de una pista, se ofrece guardar la plantilla rápida (`plantilla_sugerida`).
- Las pistas se borran con la cuenta y no se comparten entre cuentas.
- Ninguna pista llama a IA.

## 9. Mejora continua (cómo llegar al 95 %)

1. **Registro** de cada mensaje que termina en `no_entendi`, `aclarar_*` o `ia_ofrecer` (solo texto normalizado, sin importes ni datos personales: se sustituyen por `<IMPORTE>`).
2. **Revisión semanal** (30 minutos): agrupar por similitud, decidir si es sinónimo nuevo, intención nueva o pregunta que debe ir a IA.
3. Añadir las frases al diccionario y al banco de casos (con `grupo` y fecha) y ejecutar el probador.
4. **Prueba ciega periódica:** cada trimestre, 100 frases reales nuevas (no vistas) para medir la precisión sin sesgo.
5. Meta de producto: ≥ 95 % de interacciones resueltas sin IA a los 90 días de lanzar; ≥ 90 % de acierto completo en la prueba ciega.

## 10. Seguridad del parser

| Riesgo | Control |
|---|---|
| Inyección de HTML | Se retiran las etiquetas del análisis; la nota se escapa al mostrarse |
| «Instrucciones» dentro del texto | El texto solo es dato; «ignora tus instrucciones…» se trata como consulta abierta |
| ReDoS | Las expresiones usan frases escapadas y longitudes acotadas; el texto se limita a 500 caracteres |
| Registro engañoso | Una vista previa siempre precede al guardado de texto libre; importes altos y duplicados piden confirmación |
| Entradas gigantes | Límite de 500 caracteres y 12 mensajes por minuto |

## 11. Límites conocidos de la referencia

- No entiende cantidades compuestas con decimales en palabras («dos con cincuenta»).
- No distingue modismos regionales fuera del diccionario («plata», «guita» se tratan como palabras sueltas sin efecto).
- Un solo importe y una sola categoría por mensaje: «50 de café y 30 de taxi» se registra como uno solo (el primero válido) y se avisa; en v2.1 se puede dividir.
- Fechas relativas complejas («hace dos semanas», «el fin de semana pasado») no se resuelven y se preguntan.
- Verbos poco frecuentes sin categoría reconocible caen en aclaración (segura).
- Idioma: solo español.

## 12. Cómo se prueba

- `probar-parser.js` imprime el porcentaje por grupo y cada fallo con su motivo (intención, entidades, faltantes, respuesta, bandera).
- En el proyecto: una prueba de `node:test` que cargue `casos-parser.json` y falle si baja del 100 % del banco **conocido**, más una métrica aparte para la prueba ciega.
- Los casos con `nota` documentan decisiones (por qué «anota 45» pregunta el tipo).
