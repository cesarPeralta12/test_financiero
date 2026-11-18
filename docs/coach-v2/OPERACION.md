# Coach v2 · Operación

Guía corta para quien despliega y vigila el Coach v2. Código en `src/domain/coach/`; pantallas en `src/views/coachV2.js` y `src/views/miDinero.js`.

## 1. Cómo funciona (en una página)
1. **Reglas primero.** El texto pasa por el parser (`parser.js`) y el catálogo de mensajes (`data/catalogo-mensajes.json`). Las cifras las calcula siempre el servidor.
2. **IA solo donde ayuda**, siempre opcional y validada (`ia/`):
   `clasificar` y `extraer` (automáticas, solo si el parser duda y la bandera está abierta) · `redactar` («Explícamelo mejor») · `consejo` («Preguntarle a la IA»).
3. Si la IA falla, se agota un límite o la salida no pasa la validación, el Coach responde con reglas. Nunca se rompe.

## 2. Variables de entorno
| Variable | Para qué |
|---|---|
| `OPENAI_API_KEY` | Activa OpenAI para la IA del Coach (proveedor por defecto si existe) |
| `COACH_AI_PROVIDER` | `openai` · `anthropic` · `local` (forzar) |
| `OPENAI_MODEL`, `OPENAI_MODEL_CLASIFICAR/EXTRAER/REDACTAR/CONSEJO` | Modelo general o por tarea (`gpt-6-luna` por defecto) |
| `OPENAI_PRICE_INPUT`, `OPENAI_PRICE_CACHED`, `OPENAI_PRICE_OUTPUT` | **Precios en USD por millón de tokens. No verificados: pónlos tú.** Sin ellos el costo se sobreestima |
| `ANTHROPIC_API_KEY`, `AI_MODEL_*` | Alternativa Anthropic |
| `AI_PROVIDER=local` | Simulador (desarrollo y pruebas) |

## 3. Banderas (Administración → Coach → Despliegue)
| Bandera | Efecto |
|---|---|
| `coach_v2_enabled` | General. Apagada = Coach anterior para todos (salvo el equipo) |
| `coach_v2_rollout_pct` | % de cuentas que ven el v2 (grupo estable por cuenta) |
| `coach_v2_equipo` | Ids de cuenta que siempre ven el v2 |
| `coach_v2_registro_rapido` | Abre Mi dinero y la API de movimientos a cuentas sin acompañamiento |
| `coach_v2_ia_automatica` | IA barata cuando el parser duda (apagada al inicio) |
| `coach_v2_resumen_semanal` | Resumen de la semana cada lunes (apagada) |
| `ai_coach_daily_auto_limit`, `ai_coach_monthly_limit`, `ai_global_monthly_budget_usd`, `ai_coach_budget_guard` | Límites y corte por gasto |

**Reversa:** apagar `coach_v2_enabled` devuelve el Coach anterior al instante; los datos nuevos (movimientos, recurrentes, atajos) se conservan.

## 4. Despliegue gradual (CV2-605)
1. Equipo: `coach_v2_enabled` abierto, `rollout_pct` 0 y los ids del equipo.
2. 10 % → 50 % → 100 %, subiendo solo si no hay alarmas ni regresiones. Cada paso, al menos unos días.
3. 14 días sin regresiones al 100 % → retirar el Coach anterior (ver §7).

## 5. Alarmas (Administración → Coach)
| Alarma | Umbral | Qué hacer |
|---|---|---|
| Costo por interacción | > 0,002 USD en 24 h | Apagar `coach_v2_ia_automatica`; revisar qué tarea cuesta más; bajar el límite diario |
| % resuelto sin IA | < 90 % en 24 h | Ver «Mejora continua»: incorporar las frases más repetidas al diccionario |
| Aciertos de caché | < 70 % en 1 h | Revisar que el prefijo de la tarea no haya cambiado ni lleve datos variables |
| Fallos del proveedor | > 5 % en 15 min | Comprobar clave, cuota y estado del proveedor; el Coach sigue con reglas |

Si el gasto del día supera 3 veces la mediana de 14 días, el corte de seguridad detiene las llamadas automáticas hasta mañana (se puede desactivar con `ai_coach_budget_guard`).

## 6. Mejora continua semanal (CV2-505)
1. Administración → Coach → «Mejora continua del parser»: frases anonimizadas más repetidas.
2. Para cada una: añadir términos a `data/diccionario-categorias.json` o un caso a `data/casos-parser.json` (y a `docs/coach-v2/json/`), marcar «Incorporada» o «Descartar».
3. `npm run coach:parser` debe seguir en verde. `npm run coach:eval` compara reglas e IA.

## 7. Retirar el Coach anterior (CV2-606) — aún NO hecho
Condiciones: v2 al 100 % durante 14 días sin regresiones. Entonces borrar: `localReply` y el formulario antiguo en `src/domain/coach.js` / `src/routes/coach.js`, la bandera `coach_v2_enabled` (queda siempre abierta) y las pruebas del Coach anterior. Mantener `tareas`, `conversation` y el historial.

## 8. Comandos útiles
```
npm test                       # 340+ pruebas
npm run coach:parser           # banco de 329 casos del parser
npm run coach:eval             # reglas + IA simulada; -- --real con clave
npm run coach:baseline         # costo real del Coach anterior (contra producción)
npm run coach:no-entendidos    # frases no entendidas (lectura directa; prefiere el panel anonimizado)
```

## 9. Lo que NO está verificado
- Las llamadas reales a OpenAI/Anthropic y la caché del proveedor (sin clave en desarrollo).
- Los precios de OpenAI.
- Accesibilidad con lector de pantalla, teclado completo, zoom y contraste: solo hay comprobaciones automáticas básicas (`test/coach-accesibilidad.test.js`). Falta una revisión humana con lista firmada.
- Rendimiento: medido con 10.000 movimientos en una máquina de desarrollo (`test/coach-rendimiento.test.js`), no en producción.
