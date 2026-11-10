# Pruebas: checklist funcional y registro de incidencias

## Cómo ejecutar

```bash
npm test
```

```bash
npm run check:mobile
```

Resultado de la última ejecución (7 de noviembre de 2026): **58 de 58 pruebas automatizadas superadas** y **23 pantallas sin desplazamiento horizontal** a 360 px y a 1280 px, en modo claro.

## Criterios de aceptación del documento (sección 6)

| Caso | Resultado verificable | Prueba automatizada | Comprobación manual |
|---|---|---|---|
| Gratis y continuidad | Completar 25 preguntas sin pago, ver la orientación y retomar las respuestas al crear la cuenta | `flow.test.js`, `free-engine.test.js`, `free-result.test.js`, `free-api.test.js`: recorrido completo, reanudar tras recargar, botón anterior, vincular al registrarse, acceso desde otro dispositivo | Hacer el test en un navegador, cerrarlo a la mitad, volver y continuar; registrarse y entrar desde otro navegador |
| Acceso restringido | Sin permiso no se abre evaluación profunda, plan ni coach, ni por URL ni por API | `access.test.js`: 7 rutas web y 6 de API responden 403; permiso vencido o revocado | Con una cuenta nueva, abrir `/plan` y `/coach` |
| Pago | Éxito, fallo, cancelación, firma inválida y evento duplicado; solo la operación válida activa el acceso, una vez | `payments.test.js` (10 casos, incluidos importe o moneda distintos, retorno sin confirmación, reembolso y entrega por la cola) | Comprar el paquete en la pasarela de pruebas; en el panel, «Reenviar el último evento» y «Simular reembolso» |
| Evaluación | 25 respuestas guardadas, contradicción detectada y diagnóstico con versión y datos usados | `journey.test.js`: contradicción que bloquea, avisos que se confirman, fotografía de respuestas, versión de reglas y de cálculo | Declarar un total de gastos que no coincida con el desglose |
| Plan | Generar y descargar el plan; reintentar un fallo sin duplicar cobro y conservar versiones | `journey.test.js`: PDF válido, fallo simulado de IA, reintento, versión anterior consultable, sin nuevas órdenes | Activar «Simular un fallo del proveedor» en *Límites de IA* y generar una nueva versión |
| Cálculos | Ingresos cero, ahorro negativo, tasa nominal y efectiva, deuda sin amortización, meta sin aporte | `calc.test.js` (15 casos) | Ver `docs/CALCULOS.md` |
| Coach | Retomar contexto propio, proponer una tarea y no guardar cambios sin confirmación | `coach-calc.test.js`: se identifica como IA, contexto y continuidad entre dispositivos, propuesta pendiente hasta confirmar, descartar no cambia nada | Escribir «Gasté 350 en el super» y comprobar que no aparece en movimientos hasta pulsar «Confirmar» |
| Simulación | Comparar un escenario sin alterar cifras reales ni contar dos veces un pago | `coach-calc.test.js`: instantánea de movimientos, metas, deudas, presupuesto y plan idéntica antes y después; el pago extra resta una sola vez | Simular un pago extra y revisar el tablero |
| Privacidad | A no accede a respuestas, planes, archivos ni conversaciones de B | `access.test.js`: 6 lecturas y 5 escrituras sobre registros de B responden 404 y no cambian nada; exportación y eliminación | Intentar abrir `/plan/version/<id de otra cuenta>/pdf` |
| Operación | Límite de IA, error del proveedor, restauración de respaldo y visualización móvil | `coach-calc.test.js` y `admin.test.js`: límite por cuenta y global, fallo del proveedor, respaldo restaurado con conteos iguales; `npm run check:mobile` | *Administración > Respaldos > Crear y verificar*; abrir la app en un teléfono |

## Checklist funcional por pantalla

### Captación y experiencia gratuita
- [x] La portada explica qué es gratis y qué es de pago, con botón principal y acceso para cuentas registradas.
- [x] Los parámetros UTM de la primera visita se conservan y aparecen en el embudo.
- [x] Enlaces a privacidad y condiciones; consentimiento versionado antes de guardar respuestas.
- [x] 25 preguntas, una por pantalla, con progreso, botón anterior y validación por tipo.
- [x] «No lo sé» solo en las preguntas que lo prevén; se guarda como desconocido.
- [x] Revisión con correcciones antes de finalizar; preguntas condicionales marcadas como «No aplica».
- [x] Resultado con fortalezas, riesgos, prioridades, una o dos acciones y datos insuficientes, marcado como orientación preliminar y sin proyecciones del plan.
- [x] Oferta de la evaluación profunda con precio y contenido después del resultado.
- [x] Registro, acceso, recuperación de contraseña de un solo uso, verificación de correo y cierre de sesión.

### Cobro y evaluación profunda
- [x] Permisos separados: evaluación profunda, Plan Maestro y acompañamiento; paquete que concede los tres.
- [x] Pantalla previa al pago con producto, importe, moneda, duración y condiciones.
- [x] Orden con estados pendiente, pagada, fallida, cancelada y reembolsada.
- [x] Reutilizar respuestas anteriores solo con confirmación explícita.
- [x] Contradicciones (desglose frente a total, cuotas frente a total) que impiden generar el diagnóstico; avisos que se confirman.
- [x] Diagnóstico que distingue datos, cálculos y supuestos; oferta del Plan Maestro o «Abrir» si ya está incluido.

### Plan Maestro, coach, calculadora y tablero
- [x] Estado de generación, reintento sin costo y última versión completa conservada.
- [x] Cinco bloques: diagnóstico, presupuesto y deuda, metas y escenarios, 90 días, 12 meses.
- [x] Día Uno elegido por la persona; contador de días en el inicio y el plan.
- [x] Coach: consulta hipotética etiquetada, propuestas con «Confirmar» y «Descartar», límites y avisos de fallo.
- [x] Calculadora: movimientos, presupuesto, deudas con evolución del saldo, metas con plazo posible y aporte necesario, simulador y escenarios guardados a petición.
- [x] Tablero: saldo del mes, ahorro acumulado, deuda, metas, tareas (completar, posponer, reabrir), hitos e historial.
- [x] Avisos dentro de la plataforma sobre tareas y metas.

### Administración y requisitos transversales
- [x] Embudo completo, usuarios, órdenes, fallos con reintento, uso y costo de IA.
- [x] Versiones de cuestionarios, reglas y textos; las anteriores no se alteran.
- [x] Productos editables; activaciones manuales con motivo, administrador y fecha.
- [x] Exportación y eliminación de datos; solicitudes de privacidad desde la cuenta.
- [x] Contraseñas con scrypt, CSRF, cookies HttpOnly y SameSite, cabeceras de seguridad y CSP, límites de frecuencia.
- [x] Respuestas financieras y conversaciones fuera de los eventos analíticos y de los registros operativos.
- [x] Navegación por teclado, etiquetas en todos los campos, resumen de errores enlazado, foco visible y lectura sin desplazamiento horizontal desde 360 px.

## Pendiente de comprobar con servicios reales

- [ ] Coach y redacción del plan con una clave real de Anthropic. Sin clave se probó con el proveedor local, y con una clave inválida se comprobó que el error se registra y se explica (`credencial_invalida`).
- [ ] Pasarela de pago definitiva (por decidir): sustituir el adaptador de pruebas y repetir `payments.test.js` contra su entorno de pruebas.
- [ ] Envío de correo por SMTP real.
- [ ] Restauración de un respaldo en el servidor de pruebas definitivo.
- [ ] Revisión con lector de pantalla (NVDA o VoiceOver) en un teléfono real.

## Registro de incidencias resueltas

| # | Incidencia | Causa | Solución |
|---|---|---|---|
| 1 | Las marcas de progreso se veían como bloques anchos | Cada marca ocupaba una fracción del ancho | Marcas de 3 px (2 px para los 90 días) repartidas con `space-between` |
| 2 | Los webhooks de la pasarela de pruebas iban al puerto equivocado | `APP_URL` fija en `.env` distinta del puerto real | En desarrollo `APP_URL` se deduce de `PORT`; en producción es obligatoria |
| 3 | El PDF fallaba con la fuente variable | PDFKit no puede extraer glifos de una WOFF2 variable | El PDF usa Helvetica estándar, que cubre acentos, ñ y signos del español |
| 4 | El botón «Menú» aparecía en escritorio | Especificidad: `.btn` redefinía `display` | Selector más específico para el botón del menú |
| 5 | La lista de usuarios del panel desbordaba a 360 px | Celdas apiladas sin ajuste de línea y columnas de rejilla con ancho mínimo de contenido | `flex-wrap` en celdas apiladas y `min-width: 0` en las columnas |
| 6 | Un aviso con formulario dentro de un párrafo se partía | HTML inválido (`form` dentro de `p`) | Estructura con contenedores en bloque |
| 7 | Atributos `aria-invalid` aparecían escapados como texto | Interpolación de cadenas en la plantilla con escape automático | Marcado seguro (`raw`) para atributos fijos |
