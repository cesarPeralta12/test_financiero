# Día Uno

Plataforma web en español que lleva a una persona desde un **test financiero gratuito** hasta una **evaluación profunda** de pago, un **Plan Maestro** personalizado y un **acompañamiento** con coach de IA, calculadora y tablero de progreso.

Implementa el documento *Día Uno: alcance de desarrollo de la plataforma* (v1.0, 6 de noviembre de 2026), funciones F01 a F12.

| Etapa | Acceso | Rutas principales |
|---|---|---|
| Presentación y consentimiento | Público | `/`, `/consentimiento`, `/privacidad`, `/condiciones` |
| Test inicial de 25 preguntas con variantes y resultado (ver `docs/TEST-GRATUITO.md`) | Gratis | `/test`, `/resultado`, API `/api/free-tests` |
| Registro, acceso y recuperación | Cuenta | `/registro`, `/entrar`, `/recuperar`, `/inicio`, `/cuenta` |
| Evaluación profunda de 25 preguntas y diagnóstico | De pago | `/evaluacion`, `/diagnostico` |
| Plan Maestro (90 días y 12 meses, PDF) | De pago | `/plan` |
| Coach, calculadora, simulador y tablero | De pago | `/coach`, `/calculadora`, `/tablero`, `/avisos` |
| Panel administrativo | Administración | `/admin` |
| API JSON con los mismos permisos | Cuenta | `/api/v1/...` |

## Stack

- **Node.js 22.5 o superior** (probado con 22.11, 22.23 y 24.12), **Express 5** y **SQLite** integrado en Node (`node:sqlite`). Los scripts arrancan con `--experimental-sqlite`, necesario en Node 22 anterior a la 22.13.
- Interfaz renderizada en el servidor, sin framework de cliente; funciona sin JavaScript. Fuente Hanken Grotesk autoalojada (licencia OFL).
- Importes con precisión decimal (`decimal.js`), PDF con `pdfkit`, correo SMTP con `nodemailer`, IA con el SDK oficial `@anthropic-ai/sdk`.

> **Sobre el stack de referencia.** El documento propone Laravel con MySQL «pendiente de validación técnica». El equipo de desarrollo no tenía PHP ni MySQL instalados, así que esta versión usa Node.js y SQLite. El esquema está en migraciones SQL estándar (`src/db/migrations`) y todo el acceso a datos pasa por `src/db/index.js`, de modo que migrar a MySQL implica adaptar ese módulo y los tipos de las migraciones, no la lógica. Ver `docs/DECISIONES.md`.

## Instalación local

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run setup
```

```bash
npm start
```

La aplicación queda en `http://localhost:3000`. `npm run setup` aplica las migraciones y carga el contenido inicial: los dos cuestionarios v1, las reglas de diagnóstico v1, los cuatro productos con precios de ejemplo, los textos legales en borrador y la cuenta de administración definida en `.env` (`ADMIN_EMAIL` y `ADMIN_PASSWORD`, solo valores de prueba).

En desarrollo:

- **Pagos:** la pasarela de pruebas integrada (`/pasarela-pruebas/...`) simula al proveedor. Permite aprobar, rechazar o cancelar, y envía webhooks firmados a la propia aplicación. Desde el panel se pueden simular reembolsos y eventos duplicados.
- **IA:** sin `ANTHROPIC_API_KEY` se usa un proveedor local determinista, sin red ni costo, que respeta las mismas reglas (identificarse como IA, propuestas con confirmación, consultas hipotéticas).
- **Correos:** sin SMTP, los correos de verificación y recuperación quedan en *Administración > Correos*.

## Entornos

`APP_ENV` puede ser `development`, `testing` o `production`. Cada entorno usa su propia base de datos (`data/<APP_ENV>.db` por defecto) y su propia configuración. En `production`:

- Son obligatorias `APP_URL` y `PAYMENT_WEBHOOK_SECRET`; la aplicación no arranca sin ellas.
- La simulación de fallos de IA y la bandeja local de correos se desactivan. La pasarela de pruebas también, salvo que un servidor de pruebas la habilite con `ALLOW_SANDBOX=true` (aparece el aviso «Versión de prueba: los pagos son simulados»).
- Se redirige a HTTPS, las cookies se marcan `Secure` y `__Host-` y se envía HSTS. Detrás de un proxy la app confía en `X-Forwarded-Proto`. El chequeo de salud y los webhooks no se redirigen.

Las claves y los secretos solo se leen de variables de entorno; `.env` está en `.gitignore`. Todas las variables están documentadas en `.env.example`.

## Despliegue con Docker (Coolify, Dokploy, Easypanel o un VPS)

El repositorio incluye un `Dockerfile` con Node 24. La imagen arranca en modo producción, aplica las migraciones y carga el contenido inicial sola; no hace falta ejecutar `npm run setup`.

En Coolify: *Create a new Application*, el repositorio, rama `main`, *Build Pack* **Dockerfile** y *Base Directory* `/`.

También funciona con *Build Pack* **Nixpacks**: el archivo `nixpacks.toml` fija Node 22 (Nixpacks no ofrece Node 24) y arranca con `--experimental-sqlite`, que necesitan las versiones 22 anteriores a la 22.13 para usar SQLite. Las 58 pruebas pasan con Node 22.11 y 22.23. Ten en cuenta que Nixpacks está en modo mantenimiento y sus autores recomiendan Railpack; por eso Docker sigue siendo la opción preferida.

Con cualquiera de los dos, antes del primer despliegue:

1. **Puerto:** en *Ports Exposes*, `3000`.
2. **Dominio:** asigna uno con HTTPS (Coolify emite el certificado). Escríbelo igual en `APP_URL`.
3. **Almacenamiento persistente** (*Persistent Storage*, tipo volumen): uno montado en `/app/data` (base de datos) y otro en `/app/backups` (respaldos). Sin ellos, cada despliegue borra usuarios, pagos y planes.
4. **Variables de entorno:**

| Variable | Valor |
|---|---|
| `APP_URL` | `https://tu-dominio` (obligatoria) |
| `PAYMENT_WEBHOOK_SECRET` | un secreto largo y aleatorio (obligatoria) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | la cuenta de administración que se crea al arrancar |
| `ALLOW_SANDBOX` | `true` mientras no haya pasarela real: activa los pagos simulados |
| `ANTHROPIC_API_KEY` | opcional; sin ella el coach usa el proveedor local |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | opcionales; sin ellas no salen los correos de verificación y recuperación |

Si de momento usas un dominio sin certificado (http), añade `FORCE_HTTPS=false` y `SECURE_COOKIES=false`; si no, el navegador rechaza la cookie de sesión y ningún formulario funciona. Úsalo solo para pruebas.

Para cargar la cuenta de demostración en ese servidor, ejecuta desde tu equipo `npm run demo -- https://tu-dominio` con `DEMO_EMAIL` y `DEMO_PASSWORD` en tu `.env` local.

## Despliegue sin Docker

1. Servidor con Node.js 22.5 o superior, detrás de un proxy con HTTPS (Nginx, Caddy o el balanceador del hosting).
2. Copia el código, ejecuta `npm ci --omit=dev` y crea `.env` con `APP_ENV=production`, `APP_URL`, `PAYMENT_WEBHOOK_SECRET`, `TRUST_PROXY=true`, `FORCE_HTTPS=true`, las credenciales SMTP, la clave de IA, `ADMIN_EMAIL` y `ADMIN_PASSWORD`.
3. Ejecuta `npm run setup` una vez (y `npm run migrate` en cada actualización).
4. Arranca con un supervisor (systemd, PM2 o el del hosting): `npm start`. Para separar la cola del proceso web, pon `WORKER_INLINE=false` y arranca también `npm run worker`.
5. Configura en la pasarela la URL de webhooks `https://<dominio>/webhooks/pagos/<pasarela>` y el mismo secreto de firma.
6. Comprueba `GET /salud`.

La pasarela definitiva está por decidir. Para integrarla, añade un adaptador en `src/domain/gateways/` con la interfaz de `sandbox.js` (`createCheckout`, `verify`, `parse`) y regístralo en `src/domain/payments.js`. La validación de firma, orden, importe y moneda, la idempotencia y la activación de permisos ya son independientes de la pasarela.

## Respaldo y restauración

- **Automático:** cada día, a partir de `BACKUP_HOUR`, la cola crea un respaldo con `VACUUM INTO`, lo **verifica restaurándolo en un archivo temporal** (integridad y conteos de tablas clave) y conserva los últimos `BACKUP_KEEP`. El resultado aparece en *Administración > Respaldos* y en la auditoría.
- **Manual:** `npm run backup`, o el botón del panel.
- **Verificar un respaldo:** `npm run backup:verify -- backups/archivo.db`.
- **Restaurar:** detén el servidor y ejecuta `npm run restore -- backups/archivo.db`. Antes de reemplazar la base, se verifica el respaldo y se guarda una copia de la base actual (`*.antes-de-restaurar-*`).

Copia la carpeta `backups/` fuera del servidor (almacenamiento externo) con la herramienta del hosting.

## Administración

Entra con la cuenta de administración y abre `/admin`:

- **Resumen:** embudo (visitas, inicio y fin de test, registro, inicio de pago, pago confirmado, evaluación completada, plan generado y primera tarea completada), origen UTM, ventas, costo de IA y fallos.
- **Usuarios:** fecha de registro, avance en los cuestionarios, órdenes, permisos y estado de los planes. Activación manual de permisos (exige motivo y queda auditada), límite de IA por cuenta, **exportación de datos** (JSON) y **eliminación de cuenta**. El panel no muestra respuestas financieras ni conversaciones.
- **Órdenes** y **Fallos y reintentos:** eventos de pago rechazados, pagos fallidos, planes que no se generaron y trabajos fallidos de la cola, con botón de reintento.
- **Uso de IA:** llamadas, tokens y costo estimado por periodo y por día.
- **Cuestionarios, Reglas y Textos:** borrador, edición y publicación de versiones. Las evaluaciones y los diagnósticos ya hechos conservan su versión.
- **Productos:** precio visible, moneda, duración de cada acceso, referencia en la pasarela y disponibilidad.
- **Límites de IA:** respuestas del coach por cuenta y mes, generaciones de plan por mes y gasto global máximo mensual.
- **Privacidad:** solicitudes de exportación o eliminación hechas por las personas desde *Cuenta*.
- **Respaldos, Auditoría y Correos.**

## Pruebas

```bash
npm test
```

58 pruebas automatizadas (`node:test`) cubren cálculos, permisos, eventos de pago, recorridos completos, coach, simulación, privacidad entre cuentas, panel administrativo, límites de IA, fallos del proveedor y respaldo con restauración. Usan una base en memoria y el proveedor local de IA.

```bash
npm run check:mobile
```

Recorre 23 pantallas con Chrome o Edge sin interfaz a 360 px y 1280 px, falla si alguna tiene desplazamiento horizontal y guarda capturas (`-- carpeta --oscuro` para el modo oscuro).

El checklist funcional y el registro de incidencias están en `docs/PRUEBAS.md`; las fórmulas y el método de redondeo, en `docs/CALCULOS.md`.

## Estructura

```
src/
  app.js, server.js, worker.js, jobs.js, config.js
  db/            migraciones, contenido versionado v1, seed
  lib/           seguridad, sesiones, cola, correo, respaldos, registro, plantillas
  domain/        calc (motor de cálculo), questionnaire, free/ (test gratuito: catálogo, motor, anotaciones, resultado), deep, plan, pdf,
                 payments + gateways/, entitlements, tracker, tasks, coach, ai/, privacy
  routes/        una ruta por área (públicas, test, cuentas, cobro, evaluación, plan,
                 coach, calculadora, tablero, admin, api, webhooks)
  views/         layout, componentes, pantalla de pregunta
public/          CSS, JS de mejora progresiva, fuentes
scripts/         respaldo, verificación, restauración, control móvil
test/            pruebas automatizadas
docs/            cálculos, pruebas, decisiones
```
