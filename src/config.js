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
    // Coach v2: modelo por tarea (docs/coach-v2/02 §2). Haiku para clasificar, extraer y redactar; Sonnet para el consejo abierto.
    coachModels: {
      clasificar: env.AI_MODEL_CLASIFICAR || 'claude-haiku-5-5',
      extraer: env.AI_MODEL_EXTRAER || 'claude-haiku-5-5',
      redactar: env.AI_MODEL_REDACTAR || 'claude-haiku-5-5',
      consejo: env.AI_MODEL_CONSEJO || 'claude-sonnet-5-5',
    },
    cacheTtl: env.AI_CACHE_TTL === '5m' ? '5m' : '1h',
    // Proveedor de la IA del Coach: COACH_AI_PROVIDER=openai|anthropic|local. Sin indicarlo: OpenAI si hay
    // OPENAI_API_KEY, si no Anthropic si hay clave, si no el simulador local. AI_PROVIDER=local fuerza el simulador.
    coachProvider: env.COACH_AI_PROVIDER || (env.AI_PROVIDER === 'local' ? 'local' : env.OPENAI_API_KEY ? 'openai' : env.ANTHROPIC_API_KEY ? 'anthropic' : 'local'),
    // Modelos de OpenAI por tarea (el consejo puede usar uno mayor).
    coachOpenaiModels: {
      clasificar: env.OPENAI_MODEL_CLASIFICAR || env.OPENAI_MODEL || 'gpt-6-luna',
      extraer: env.OPENAI_MODEL_EXTRAER || env.OPENAI_MODEL || 'gpt-6-luna',
      redactar: env.OPENAI_MODEL_REDACTAR || env.OPENAI_MODEL || 'gpt-6-luna',
      consejo: env.OPENAI_MODEL_CONSEJO || env.OPENAI_MODEL || 'gpt-6-luna',
    },
    // Precios de OpenAI en USD por millón de tokens. NO están verificados: se configuran a mano. Sin ellos el costo se
    // estima con el precio más alto conocido (nunca se subestima el gasto).
    openaiPrices: env.OPENAI_PRICE_INPUT && env.OPENAI_PRICE_OUTPUT ? { entrada: Number(env.OPENAI_PRICE_INPUT), cacheada: Number(env.OPENAI_PRICE_CACHED || env.OPENAI_PRICE_INPUT), salida: Number(env.OPENAI_PRICE_OUTPUT) } : null,
    // Redacción del resultado gratuito con OpenAI. Sin clave (o con FREE_RESULT_AI=false)
    // el resultado se genera con plantillas deterministas: el test nunca depende de la IA.
    openai: {
      apiKey: env.OPENAI_API_KEY || '',
      // gpt-4o-mini se retira el 14-01-2027; gpt-6-luna es el reemplazo probado.
      model: env.OPENAI_MODEL || 'gpt-6-luna',
      baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      enabled: bool(env.FREE_RESULT_AI, true) && Boolean(env.OPENAI_API_KEY),
      timeoutMs: int(env.OPENAI_TIMEOUT_MS, 20000),
      // gpt-6-luna solo admite temperature = 1: no se envía salvo que se configure.
      temperature: env.OPENAI_TEMPERATURE ? Number(env.OPENAI_TEMPERATURE) : null,
      // Redacción corta: sin razonamiento extra en la familia gpt-6 (menos costo y latencia).
      reasoningEffort: env.OPENAI_REASONING_EFFORT || (/^gpt-6/.test(env.OPENAI_MODEL || 'gpt-6-luna') ? 'none' : null),
    },
  },

  // Resultado gratuito V2 (crecimiento patrimonial, Fase 2). Con FREE_RESULT_V2=false se
  // muestra solo la lectura V1; el cálculo V2 se guarda igual para auditoría.
  freeResultV2: bool(env.FREE_RESULT_V2, true),
  // Catálogo de las sesiones nuevas del test gratuito. Las sesiones existentes siguen con el suyo.
  // Evaluación profunda: 2 = respuestas con botones (vigente); 1 = versión original (pruebas históricas).
  deepQuestionnaireVersion: ['1', '2'].includes(env.DEEP_QUESTIONNAIRE_VERSION) ? Number(env.DEEP_QUESTIONNAIRE_VERSION) : 3,
  // Evaluación profunda en forma de conversación (DEEP_CHAT=0 vuelve a las pantallas de una pregunta).
  deepChat: env.DEEP_CHAT !== '0',
  // El análisis gratuito se entrega a quien tiene cuenta (RESULT_REQUIRES_ACCOUNT=0 lo desactiva).
  resultRequiresAccount: env.RESULT_REQUIRES_ACCOUNT !== '0',
  freeCatalogVersion: ['FREE_25_V2_ES', 'FREE_25_V3_ES', 'FREE_24_V4_ES'].includes(env.FREE_CATALOG_VERSION) ? env.FREE_CATALOG_VERSION : 'FREE_24_V4_ES',

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
