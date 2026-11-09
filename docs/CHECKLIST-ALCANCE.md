# Checklist contra el alcance

## Resultado esperado

- ✅ Aplicación con URL propia: https://test-financiero.proshop.lat
- ✅ Cuentas individuales
- ✅ Respuestas guardadas
- ✅ Cálculos reproducibles (motor versionado y fotografía de datos)
- ✅ Acceso a funciones según lo adquirido

## Recorrido comercial

- ✅ Anuncio y página de presentación (pública)
- ✅ Test inicial de 25 preguntas (gratis)
- ✅ Registro y evaluación profunda de 25 preguntas (de pago)
- ✅ Plan Maestro: plan de 90 días y hoja de ruta de 12 meses (de pago)
- ✅ Coach y calculadora: acciones, simulaciones y seguimiento (de pago)

## Base de implementación

- ✅ Web adaptable a celular y computadora
- ✅ Dos roles: usuario y administrador
- 🟡 Coach de IA: funciona con reglas locales; con `ANTHROPIC_API_KEY`o otra api_IA usa IA real (Claude o otra api)

## 1. Captación y experiencia gratuita

### F01 Página de presentación
- ✅ Explica qué incluye el test gratuito y qué requiere pago
- ✅ Botón principal para comenzar y acceso para usuarios registrados
- ✅ Origen de la visita con parámetros UTM
- ✅ Enlaces a privacidad y condiciones
- ✅ Consentimiento antes de guardar información financiera

### F02 Test inicial
- ✅ 25 preguntas, una por pantalla
- ✅ Progreso, botón anterior y validación por tipo de respuesta
- ✅ Cuestionario versionado (no se inventan preguntas por sesión)
- ✅ Cubre ingresos, gastos, deudas, ahorro, dependientes, hábitos y objetivos
- ⬜ Textos y opciones definitivos: hay una v1 de borrador; falta la aprobada por producto (se carga desde el panel)
- ✅ Guarda cada respuesta y permite continuar tras recargar o cerrar el navegador
- ✅ Sesión anónima hasta crear la cuenta, conservada 30 días y eliminada si no se vincula
- ✅ Permite corregir respuestas antes de finalizar
- ✅ No marca como respondida una pregunta con datos obligatorios faltantes
- ✅ «No lo sé» solo donde está previsto

### F03 Resultado gratuito
- ✅ Fortalezas, riesgos, prioridades y una o dos acciones iniciales
- ✅ Identificado como orientación preliminar
- ✅ Señala los datos insuficientes
- ✅ Consultable sin pagar
- ✅ Después, la oferta de la evaluación profunda con precio y contenido
- ✅ No muestra proyecciones del plan completo

### F04 Registro y continuidad
- ✅ Registro e inicio de sesión con correo y contraseña
- 🟡 Recuperación de contraseña: funciona; el envío real necesita SMTP (Resend) en Coolify
- ✅ Cierre de sesión
- ✅ Vincula el test anónimo a la cuenta sin perder respuestas
- ✅ Recupera el avance desde otro dispositivo

### Pantallas mínimas
- ✅ Presentación, consentimiento, test gratuito, resultado gratuito, registro, acceso, recuperación de contraseña e inicio del usuario

### Aceptación de esta etapa
- ✅ Completar las 25 preguntas sin pagar, ver la orientación, crear cuenta y conservar el resultado
- ✅ Al volver atrás, recargar o iniciar sesión se mantienen las respuestas
- ✅ Ninguna ruta pública permite ver resultados de otra persona

## 2. Cobro y evaluación profunda

### F05 Accesos de pago
- ✅ Permisos separados: evaluación profunda, Plan Maestro y acompañamiento (más un paquete)
- ✅ Una sola pasarela y sin constructor de planes comerciales
- 🟡 Pasarela «por definir»: integrada la de pruebas con adaptador intercambiable; falta elegir y conectar la real
- ✅ Antes de pagar: producto, importe, moneda, duración y condiciones
- ✅ Orden con estados pendiente, pagada, fallida, cancelada (y reembolsada)
- ✅ Registra devoluciones y revoca el acceso afectado
- ✅ Activa permisos solo con confirmación del servidor de pagos (el retorno del navegador no basta)
- ✅ Valida firma, orden, importe y moneda
- ✅ Procesa cada evento una sola vez
- ✅ Guarda referencia y estado sin datos de tarjeta
- ✅ Recargar o repetir el webhook no duplica compras ni permisos

### F06 Evaluación profunda
- ✅ 25 preguntas habilitadas al acreditar el acceso
- ✅ Cifras precisas de ingresos, gastos, deudas, cuotas, tasas, ahorros, riesgos, oportunidades y metas
- ✅ Guarda el avance y permite correcciones
- ✅ Reutiliza respuestas anteriores solo si la persona las confirma
- ✅ Valida importes, periodicidad, moneda y consistencia
- ✅ Cero y dato desconocido no son equivalentes
- ✅ Muestra contradicciones para corregirlas antes del diagnóstico

### F07 Diagnóstico detallado
- ✅ Ingresos y egresos mensuales, saldo disponible, deudas y capacidad de ahorro
- ✅ Riesgos y oportunidades
- ✅ Distingue datos ingresados, cálculos y supuestos
- ✅ Reglas y umbrales versionados
- ✅ Sin puntuación crediticia asignada por la IA
- ✅ Guarda la fotografía de las respuestas y la versión de cálculo
- ✅ Muestra la oferta del Plan Maestro, o «Abrir» sin cobrar si ya está incluido

### Límite comercial
- ✅ Compra única con duración de acceso configurable
- ✅ Sin suscripciones, cupones, afiliados ni facturación fiscal
- ⬜ Modalidad comercial final por acordar

## 3. Plan Maestro y motor de cálculo

### F08 Generación del Plan Maestro
- ✅ Se genera desde la evaluación profunda finalizada y con el permiso adquirido
- ✅ Muestra el estado de generación y permite reintentar un fallo
- ✅ Conserva la última versión completa
- ✅ Un fallo de IA no produce otro cobro
- ✅ Bloque Diagnóstico: situación, prioridades y datos faltantes
- ✅ Bloque Presupuesto y deuda: distribución y estrategia de pagos
- ✅ Bloque Metas y escenarios: ahorro, reserva y alternativas con supuestos
- ✅ Bloque Plan de 90 días: acciones ordenadas, fechas relativas e indicadores
- ✅ Bloque Hoja de ruta de 12 meses: hitos y condiciones para revisar
- ✅ Consulta en pantalla
- ✅ Descarga en PDF
- ✅ Fecha de inicio elegida por la persona como su Día Uno
- ✅ Cambiar datos no sobrescribe el plan: se pide una actualización y se conserva la versión anterior

### Reglas de cálculo
- ✅ Normaliza todos los flujos a periodicidad mensual
- ✅ Registra si los ingresos son netos y separa gastos de pagos de deuda
- ✅ Saldo disponible = ingresos netos − gastos − pagos de deuda
- ✅ Tasa de ahorro solo con ingresos mayores que cero
- ✅ Avance de meta = ahorro asignado ÷ objetivo
- ✅ Plazo = pendiente ÷ aporte; sin aporte, «no existe un plazo alcanzable»
- ✅ Registra el tipo de tasa y la periodicidad de la deuda
- ✅ Nominal anual ÷ 12; efectiva anual (1 + tasa)^(1/12) − 1
- ✅ Tipo de tasa desconocido: se pide o la simulación queda incompleta
- ✅ Proyección por periodos con saldo, interés y pago
- ✅ Si el pago no cubre el interés: alerta y sin fecha ficticia
- ✅ Comisiones y seguros solo cuando se conocen
- ✅ Una moneda base por cuenta, sin conversiones automáticas
- ✅ Precisión decimal y redondeo a dos decimales documentado
- ⬜ Validación de fórmulas, supuestos y umbrales por el responsable de contenido financiero

### Separación entre números e IA
- ✅ El servidor calcula; la IA explica y propone usando esos resultados
- ✅ Guarda modelo, versión de instrucciones y entrada de cada generación
- ✅ No convierte ingresos estimados en garantizados
- ✅ No reutiliza cifras del caso de joyería

## 4. Coach, calculadora y seguimiento

### F09 Coach de IA
- ✅ Chat dentro de la cuenta con diagnóstico, plan vigente y avance
- ✅ Se identifica como IA
- ✅ Explica las cifras con lenguaje sencillo
- ✅ Una acción concreta a la vez, con motivo y criterio para darla por terminada
- ✅ Guarda el historial y permite retomar la conversación
- ✅ Si cambian los datos, ofrece recalcular antes de proponer un plan nuevo
- ✅ Distingue una consulta hipotética de una modificación real
- ✅ No registra movimientos, cambia metas ni marca tareas sin confirmación explícita
- ✅ Límites de uso por cuenta y límite global de gasto, configurables
- ✅ Si el proveedor falla o se alcanza el límite, lo explica y conserva la conversación
- 🟡 Respuestas con IA real: requieren `ANTHROPIC_API_KEY` en Coolify (hoy responde por reglas)

### F10 Calculadora financiera
- ✅ Registrar y actualizar ingresos, gastos, saldos de deuda, pagos, ahorros y metas
- ✅ Conserva fecha, categoría, importe y moneda
- ✅ Editar o eliminar registros propios y recalcular sin duplicar
- ✅ Presupuesto previsto y movimientos reales por separado, sin sumarlos
- ✅ Las transferencias entre ahorros propios no cuentan como ingreso
- ✅ Simular cambios de ahorro, gastos o pago de deuda frente al escenario actual
- ✅ Monto pendiente, aporte necesario y plazo posible por meta; avisa si no es viable
- ✅ Guarda un escenario solo cuando se pide
- ✅ La simulación no altera datos reales ni el plan vigente

### F11 Tablero de progreso
- ✅ Saldo mensual, ahorro acumulado, evolución de deuda, metas y tareas
- ✅ Registra el inicio del plan, hitos y cambios de estado
- ✅ Completar, posponer y reabrir tareas
- ✅ Siguiente paso en el inicio de la cuenta

### Notificaciones
- ✅ Avisos dentro de la plataforma sobre tareas y metas
- ✅ WhatsApp, SMS, notificaciones móviles y campañas quedan fuera (respetado)
- 🟡 Correos de verificación y recuperación: se generan; el envío real necesita SMTP (Resend)

## 5. Administración y estructura técnica

### F12 Panel administrativo
- ✅ Usuarios, fecha de registro, avance en cuestionarios, órdenes, permisos y estado de los planes
- ✅ Editar y publicar versiones de preguntas, textos y reglas de diagnóstico
- ✅ Las versiones nuevas no modifican evaluaciones terminadas
- ✅ Sin ramificaciones complejas (respetado: una condición simple por pregunta)
- ✅ Precio visible y referencias de productos
- ✅ Configurar permisos y límites de IA
- ✅ Activación manual con motivo, administrador y fecha
- ✅ Revisar fallos de pagos o IA y reintentar procesos
- ✅ Consumo y costo estimado de IA por periodo
- ✅ Sin claves ni respuestas financieras en registros operativos
- ✅ Embudo: visitas, inicio y fin de test, registro, inicio de pago, pago confirmado, evaluación completada, plan generado y primera tarea completada

### Arquitectura
- 🟡 Laravel con MySQL propuesto «pendiente de validación»: se usó Node.js con SQLite (documentado en `docs/DECISIONES.md`)
- ✅ Web adaptable y un proveedor de IA mediante API
- ✅ Claves, cálculos, cobros y permisos en el servidor
- ✅ Cola para generación de planes, correos y procesos con reintento

### Datos principales
- ✅ Identidad: usuario, sesión anónima, consentimiento y rol
- ✅ Evaluación: cuestionario versionado, pregunta, evaluación y respuesta
- ✅ Comercial: producto, orden, evento de pago y permiso de acceso
- ✅ Planificación: diagnóstico, versión del plan, tarea y meta
- ✅ Seguimiento: movimiento, saldo de deuda y escenario
- ✅ Operación: conversación, mensaje, ejecución de IA y auditoría

### Requisitos transversales
- 🟡 Separar desarrollo, pruebas y producción: soportado por `APP_ENV`; hoy hay un solo servidor publicado (versión de prueba)
- ✅ HTTPS
- ✅ Contraseñas cifradas mediante hash
- ✅ Permisos por propietario del registro y por administrador
- ✅ Protección contra abuso (límites de frecuencia, CSRF, cabeceras de seguridad)
- 🟡 Copias de seguridad diarias con restauración comprobada: funcionan; falta copiarlas fuera del servidor
- ✅ Respuestas financieras y conversaciones fuera de la analítica
- ✅ Versión y fecha del consentimiento registradas
- ✅ Mecanismo administrativo para exportar y eliminar los datos de una cuenta
- ⬜ Política de retención por definir
- ✅ Navegación por teclado, etiquetas de formularios y mensajes de error
- ✅ Lectura sin desplazamiento horizontal desde 360 px

## 6. Criterios de aceptación

- ✅ Gratis y continuidad
- ✅ Acceso restringido (también por URL y API)
- ✅ Pago: éxito, fallo, cancelación, firma inválida y evento duplicado
- ✅ Evaluación: 25 respuestas, contradicción y diagnóstico con versión
- ✅ Plan: generar, descargar, reintentar sin cobrar y conservar versiones
- ✅ Cálculos: ingresos cero, ahorro negativo, tasas nominal y efectiva, deuda sin amortización, meta sin aporte
- ✅ Coach: contexto propio, propone una tarea y no guarda sin confirmación
- ✅ Simulación sin alterar cifras reales ni contar dos veces un pago
- ✅ Privacidad: A no accede a datos de B
- ✅ Operación: límite de IA, error del proveedor, restauración de respaldo y visualización móvil

## Entregables del desarrollador

- ✅ Código fuente en el repositorio acordado (github.com/cesarPeralta12/test_financiero)
- ✅ Migraciones de base de datos
- ✅ Datos de prueba sin información personal real
- 🟡 Aplicación de pruebas y producción: publicada una instancia en modo prueba; falta separar la de producción definitiva
- ✅ Configuración documentada sin secretos en el código y `.env.example`
- ✅ Cuestionarios y reglas versionados
- 🟡 Integración de una pasarela (la de pruebas) y de un proveedor de IA (sin clave cargada)
- ✅ Permisos de acceso y panel administrativo
- ✅ Pruebas automatizadas de cálculos, permisos y eventos de pago
- ✅ Checklist de pruebas funcionales y registro de incidencias resueltas (`docs/PRUEBAS.md`, `docs/REGISTRO-PRUEBAS.md`)
- ✅ Guía de instalación, despliegue, respaldo, restauración y administración (`README.md`)
- ⬜ Entrega de accesos y sesión de transferencia de conocimiento

## Condición de cierre

- ✅ Sin fallos críticos conocidos de acceso, cobro, pérdida de datos o cálculo
- ✅ Código y documentación entregados


