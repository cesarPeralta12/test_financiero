# Registro de pruebas

## Ronda 2: versión gamificada (9 de noviembre de 2026, local, sin desplegar)

| Bloque | Resultado |
|---|---|
| Pruebas automatizadas | **64 de 64** superadas (58 anteriores y 6 nuevas del juego), en 7,8 s |
| Recorrido completo en modo producción (local) | **53 de 53** comprobaciones correctas (47 anteriores y 6 del juego) |
| Pantallas a 360 px y 1280 px | **48 de 48** sin desplazamiento horizontal en modo claro y **48 de 48** en modo oscuro (24 pantallas, incluida la nueva de Logros) |

Pruebas nuevas del juego (`test/game.test.js`):
- ✔ Niveles: umbrales y progreso
- ✔ Una cuenta nueva empieza en nivel 1 con el logro de registro
- ✔ El XP crece con las acciones del recorrido y desbloquea logros; reabrir y volver a completar una tarea no suma dos veces
- ✔ El XP no depende del dinero: dos cuentas con ingresos distintos y las mismas acciones suman lo mismo
- ✔ La página de logros exige sesión y muestra niveles y logros
- ✔ La portada muestra el mapa de mundos y el test muestra la etapa y el XP

Comprobaciones nuevas del recorrido: panel del jugador en la cabecera, tarjeta del jugador y mapa en el inicio, XP coherente con el recorrido (709 XP en la cuenta de demostración), recompensa visible en cada misión, página de logros y portada con mapa y «Cómo se juega».

Incidencia encontrada y resuelta en esta ronda:

| # | Incidencia | Causa | Solución |
|---|---|---|---|
| 8 | En móvil, la medalla de nivel del inicio se veía como un óvalo estirado | Una regla de ancho completo para el contenido de la tarjeta también se aplicaba a la medalla | La regla excluye la medalla; verificado en captura a 360 px |

Las cifras financieras, los pagos, los permisos y la base de datos no cambiaron en esta versión.

## Ronda 1: versión publicada (8 de noviembre de 2026)

**Fecha:** 8 de noviembre de 2026
**Versión probada:** commit `66c5c73` (rama `main`)
**Sitio publicado:** https://test-financiero.proshop.lat (Coolify, Docker, Node 24, modo producción con pagos simulados)

## Resumen

| Bloque | Resultado |
|---|---|
| Pruebas automatizadas | **58 de 58** superadas, en 6,7 s |
| Recorrido completo en modo producción (local) | **47 de 47** comprobaciones correctas |
| Pantallas a 360 px y 1280 px | **46 de 46** sin desplazamiento horizontal |
| Sitio publicado (solo lectura) | **17 de 17** comprobaciones correctas |
| Despliegue en Coolify | Imagen construida, chequeo de salud superado al primer intento |

No quedan incidencias abiertas de funcionamiento. Lo pendiente depende de servicios o decisiones externas y está al final del documento.

## 1. Pruebas automatizadas

Comando: `npm test`. Base de datos en memoria y proveedor de IA local.

### Cálculos (15)
- ✔ Normaliza flujos a periodicidad mensual
- ✔ Saldo disponible = ingresos − gastos − pagos de deuda
- ✔ Ahorro negativo: el saldo puede ser negativo y se informa así
- ✔ Ingresos cero: no se calcula la tasa de ahorro
- ✔ Tasa nominal anual se mensualiza como tasa ÷ 12
- ✔ Tasa efectiva anual se convierte como (1 + tasa)^(1/12) − 1
- ✔ Tasa de tipo desconocido deja la simulación incompleta
- ✔ Deuda sin amortización: el pago no cubre el interés y no hay fecha ficticia
- ✔ Comisiones conocidas se suman; desconocidas no
- ✔ Proyección de deuda amortizable
- ✔ Meta sin aporte: no existe un plazo alcanzable
- ✔ Meta con aporte: plazo = pendiente ÷ aporte (redondeado hacia arriba)
- ✔ Avalancha: el pago extra reduce plazo e intereses sin contarse dos veces
- ✔ Lectura de importes escritos por personas
- ✔ Redondeo de presentación ROUND_HALF_UP a dos decimales

### Test gratuito y cuentas (7)
- ✔ El test exige consentimiento antes de guardar datos financieros
- ✔ Valida el tipo de respuesta y no marca como respondida una pregunta incompleta
- ✔ Recorrido gratuito completo, continuidad y vinculación a la cuenta
- ✔ Las preguntas condicionales se omiten y no cuentan
- ✔ Ninguna ruta pública permite ver resultados de otra persona
- ✔ Recuperación de contraseña de un solo uso
- ✔ Las sesiones anónimas no vinculadas se eliminan a los 30 días

### Pagos (10)
- ✔ Antes de pagar se muestran producto, importe, moneda, duración y condiciones
- ✔ Pago aprobado: la confirmación firmada del servidor activa el acceso una sola vez
- ✔ Un segundo evento aprobado distinto para la misma orden no duplica permisos
- ✔ Pago rechazado: la orden queda fallida y no se activa nada
- ✔ Pago cancelado: la orden queda cancelada y no se activa nada
- ✔ Firma inválida, caducada o ausente: se rechaza y no cambia nada
- ✔ Importe o moneda que no coinciden con la orden: se rechaza
- ✔ Recargar el pago no crea otra orden
- ✔ Reembolso: se registra y se revoca el acceso de esa compra
- ✔ La pasarela de pruebas entrega el webhook por HTTP mediante la cola

### Evaluación profunda, diagnóstico y plan (5)
- ✔ Compra del paquete y evaluación profunda con contradicción
- ✔ El cero y el dato desconocido no son equivalentes
- ✔ Generar el plan, descargarlo en PDF y fijar el Día Uno
- ✔ Un fallo de IA no cobra: se reintenta y se conservan las versiones
- ✔ Tablero: completar, posponer y reabrir tareas, con historial

### Coach, calculadora y operación (10)
- ✔ Preparación: cuenta con paquete, diagnóstico y plan
- ✔ El coach se identifica como IA, conoce el contexto propio y retoma la conversación
- ✔ Una consulta hipotética no cambia datos; un registro solo se guarda al confirmar
- ✔ El coach propone una tarea cuando no hay pendientes
- ✔ Calculadora: registrar, editar y eliminar sin duplicar; previsto y real por separado
- ✔ Simulación: compara sin alterar datos reales ni contar dos veces un pago
- ✔ Límite de IA por cuenta: el coach lo explica y conserva la conversación
- ✔ Error del proveedor de IA: se explica y la conversación se conserva
- ✔ Respaldo y restauración comprobada
- ✔ Los registros operativos no exponen claves ni datos financieros

### Permisos y privacidad (4)
- ✔ Una cuenta sin permiso no abre evaluación, plan ni coach por URL ni por API
- ✔ Un permiso vencido o revocado deja de dar acceso
- ✔ La persona A no accede a respuestas, planes, archivos ni conversaciones de B
- ✔ Exportación y eliminación de datos de una cuenta por administración

### Panel administrativo (7)
- ✔ Preparación
- ✔ Todas las pantallas del panel renderizan y muestran el embudo
- ✔ Una versión nueva del cuestionario no modifica evaluaciones terminadas
- ✔ Reglas: se validan, se versionan y los diagnósticos guardan su versión
- ✔ Productos: cambiar precio y duración se refleja antes de pagar y queda auditado
- ✔ Textos: publicar un consentimiento nuevo pide consentir otra vez
- ✔ Respaldo manual desde el panel con verificación

## 2. Recorrido completo en modo producción

La app se arrancó en local con las mismas variables que el contenedor de Coolify (`APP_ENV=production`, `ALLOW_SANDBOX=true`, base de datos vacía). Primero se creó una cuenta con `npm run demo`: test gratuito, registro, **compra del Paquete completo (69 USD, simulado)** confirmada por webhook, evaluación profunda, Plan Maestro, presupuesto, movimientos, dos tareas completadas y conversación con el coach. Después se recorrió todo como usuario, como administrador y sin sesión.

| Área | Comprobación | Resultado |
|---|---|---|
| Operación | Chequeo de salud `/salud` | ✔ |
| Pantallas públicas | Portada, privacidad, condiciones, consentimiento, acceso, registro, recuperar contraseña | ✔ 7 de 7 |
| Pantallas públicas | Página 404 propia | ✔ |
| Seguridad | Sin sesión, `/plan` redirige a entrar | ✔ |
| Seguridad | Sin sesión, la API responde 401 | ✔ |
| Seguridad | Formulario con CSRF inválido se rechaza (403) | ✔ |
| Cuenta | Acceso con la cuenta de demostración | ✔ |
| Con todo comprado | Inicio con contador de días | ✔ |
| Con todo comprado | Resultado gratuito | ✔ |
| Con todo comprado | Diagnóstico detallado | ✔ |
| Con todo comprado | Plan Maestro con sus 5 bloques | ✔ |
| Con todo comprado | Descarga del Plan Maestro en PDF | ✔ |
| Con todo comprado | Tablero en recuadros | ✔ |
| Con todo comprado | Coach y respuesta a una consulta hipotética | ✔ |
| Con todo comprado | Calculadora: movimientos, presupuesto, deudas, metas y simulador | ✔ 5 de 5 |
| Con todo comprado | Simulación sin guardar | ✔ |
| Con todo comprado | Cuenta: accesos y compras (Paquete completo) | ✔ |
| Con todo comprado | Avisos | ✔ |
| Seguridad | Una cuenta normal no entra al panel (404) | ✔ |
| Administración | Acceso de administración | ✔ |
| Administración | Resumen, usuarios, órdenes, fallos, uso de IA, cuestionarios, reglas, textos, productos, límites de IA, privacidad, respaldos, auditoría y correos | ✔ 14 de 14 |
| Administración | El embudo registra el pago confirmado | ✔ |
| Operación | Respaldo creado y restauración verificada | ✔ |

## 3. Pantallas en móvil y escritorio

Comando: `npm run check:mobile`. Chrome sin interfaz recorre 23 pantallas (portada, test, resultado, inicio, compra, evaluación, diagnóstico, plan, tablero, coach, calculadora, cuenta y panel) a **360 px** y **1280 px**. Resultado: 46 de 46 sin desplazamiento horizontal. También se revisaron en modo oscuro.

## 4. Sitio publicado (solo lectura)

| Comprobación | Resultado |
|---|---|
| `/salud` responde en modo producción | ✔ |
| Portada, privacidad, condiciones, acceso, registro, recuperar y consentimiento (HTTP 200) | ✔ 7 de 7 |
| Página inexistente (HTTP 404) | ✔ |
| Hojas de estilo y JavaScript | ✔ 3 de 3 |
| `http://` redirige a `https://` | ✔ |
| `/plan` sin sesión redirige a entrar | ✔ |
| API sin sesión responde 401 | ✔ |
| Cabeceras: Content-Security-Policy, HSTS y X-Frame-Options | ✔ |
| Aviso «Versión de prueba: los pagos son simulados» | ✔ |

En el sitio publicado no se crearon cuentas ni compras durante esta revisión.

## 5. Pendiente de comprobar

| Tema | Estado |
|---|---|
| Coach y textos del plan con IA real | Falta `ANTHROPIC_API_KEY` en Coolify. Probado con el proveedor local; con una clave inválida el error se registra y se explica. |
| Envío real de correos | Falta configurar Resend por SMTP en Coolify. |
| Pasarela de pago definitiva | Por decidir; hoy funciona la pasarela de pruebas. |
| Copia de respaldos fuera del servidor | Los respaldos diarios se guardan en el volumen `/app/backups`; falta copiarlos a un almacenamiento externo. |
| Lector de pantalla en un teléfono real | No probado. |
| Aprobación del recorrido por el responsable de producto | Pendiente (condición de cierre del documento). |
