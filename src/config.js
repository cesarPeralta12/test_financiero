'use strict';
// Configuración por entorno. Los secretos llegan solo por variables de entorno
// (archivo .env fuera del repositorio); nunca se escriben en el código.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function loadDotEnv() {
  const file = process.env.DOTENV_PATH || path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

if (process.env.APP_ENV !== 'testing') loadDotEnv();

const env = process.env;
const APP_ENV = env.APP_ENV || 'development';
if (!['development', 'testing', 'production'].includes(APP_ENV)) {
  throw new Error(`APP_ENV no válido: ${APP_ENV}. Usa development, testing o production.`);
}
const isProd = APP_ENV === 'production';

function bool(v, d = false) {
  if (v === undefined || v === '') return d;
  return ['1', 'true', 'yes', 'si', 'sí'].includes(String(v).toLowerCase());
}
function int(v, d) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
}

const port = int(env.PORT, 3000);

const config = {
  root: ROOT,
  env: APP_ENV,
  isProd,
  isTest: APP_ENV === 'testing',
  port,
  appUrl: (env.APP_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  trustProxy: bool(env.TRUST_PROXY, isProd),
  forceHttps: bool(env.FORCE_HTTPS, isProd),
  // Cookies «Secure»: solo funcionan con HTTPS. Desactívalas únicamente en un despliegue
  // de pruebas servido por http (por ejemplo, un dominio temporal sin certificado).
  secureCookies: bool(env.SECURE_COOKIES, bool(env.FORCE_HTTPS, isProd)),
  databasePath: env.DATABASE_PATH || path.join(ROOT, 'data', `${APP_ENV}.db`),
  backupDir: env.BACKUP_DIR || path.join(ROOT, 'backups'),
  backupKeep: int(env.BACKUP_KEEP, 14),
  backupHour: int(env.BACKUP_HOUR, 3),
  sessionDays: int(env.SESSION_DAYS, 30),
  anonymousRetentionDays: int(env.ANON_RETENTION_DAYS, 30),
  workerInline: bool(env.WORKER_INLINE, true),
  workerIntervalMs: int(env.WORKER_INTERVAL_MS, 1500),

  payments: {
    gateway: env.PAYMENT_GATEWAY || 'sandbox',
    webhookSecret: env.PAYMENT_WEBHOOK_SECRET || (isProd ? '' : 'whsec_desarrollo_no_usar_en_produccion'),
    webhookToleranceSec: int(env.PAYMENT_WEBHOOK_TOLERANCE_SEC, 300),
    // La pasarela de pruebas envía sus eventos a esta URL (en producción la configura el proveedor).
    sandboxWebhookUrl: env.SANDBOX_WEBHOOK_URL || '',
    sandboxAutoDeliver: bool(env.SANDBOX_AUTO_DELIVER, APP_ENV !== 'testing'),
    // La pasarela de pruebas está activa fuera de producción, o en un servidor de
    // pruebas que la habilite explícitamente con ALLOW_SANDBOX=true.
    sandboxEnabled: !isProd || bool(env.ALLOW_SANDBOX, false),
  },

  ai: {
    provider: env.AI_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : 'local'),
    apiKey: env.ANTHROPIC_API_KEY || '',
    model: env.AI_MODEL || 'claude-opus-5-5',
    timeoutMs: int(env.AI_TIMEOUT_MS, 60000),
  },

  mail: {
    from: env.MAIL_FROM || 'Día Uno <no-responder@diauno.local>',
    smtpHost: env.SMTP_HOST || '',
    smtpPort: int(env.SMTP_PORT, 587),
    smtpUser: env.SMTP_USER || '',
    smtpPass: env.SMTP_PASS || '',
    smtpSecure: bool(env.SMTP_SECURE, false),
  },

  admin: {
    email: env.ADMIN_EMAIL || '',
    password: env.ADMIN_PASSWORD || '',
  },
};

if (isProd) {
  const missing = [];
  if (!config.payments.webhookSecret) missing.push('PAYMENT_WEBHOOK_SECRET');
  if (!env.APP_URL) missing.push('APP_URL');
  if (missing.length) {
    throw new Error(`Faltan variables obligatorias en producción: ${missing.join(', ')}`);
  }
}

module.exports = config;
