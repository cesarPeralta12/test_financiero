'use strict';
// Cola de trabajos persistente (tabla jobs) con reintentos y espera exponencial.
// Se usa para generar planes, enviar correos, purgar sesiones y respaldos.
const db = require('../db');
const log = require('./log');

const handlers = new Map();
const BACKOFF_SEC = [5, 30, 120, 600];

function register(type, fn) {
  handlers.set(type, fn);
}

function enqueue(type, payload = {}, { maxAttempts = 3, delaySec = 0 } = {}) {
  const at = new Date(Date.now() + delaySec * 1000).toISOString();
  const r = db.run(
    `INSERT INTO jobs (type, payload_json, status, attempts, max_attempts, run_at, created_at, updated_at)
     VALUES (?, ?, 'pendiente', 0, ?, ?, ?, ?)`,
    type,
    JSON.stringify(payload),
    maxAttempts,
    at,
    db.now(),
    db.now()
  );
  return r.lastId;
}

function claim() {
  return db.tx(() => {
    // Recupera trabajos bloqueados por un proceso caído hace más de 10 minutos.
    db.run(
      "UPDATE jobs SET status = 'pendiente', locked_at = NULL WHERE status = 'procesando' AND locked_at < ?",
      new Date(Date.now() - 10 * 60 * 1000).toISOString()
    );
    const job = db.one("SELECT * FROM jobs WHERE status = 'pendiente' AND run_at <= ? ORDER BY run_at, id LIMIT 1", db.now());
    if (!job) return null;
    db.run("UPDATE jobs SET status = 'procesando', locked_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?", db.now(), db.now(), job.id);
    job.attempts += 1;
    return job;
  });
}

async function runJob(job) {
  const fn = handlers.get(job.type);
  try {
    if (!fn) throw new Error(`Sin manejador para ${job.type}`);
    await fn(db.parse(job.payload_json, {}), job);
    db.run("UPDATE jobs SET status = 'completado', locked_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?", db.now(), job.id);
    return true;
  } catch (err) {
    const message = log.scrub(err && err.message ? err.message : String(err)).slice(0, 500);
    const final = job.attempts >= job.max_attempts || (err && err.permanent);
    if (final) {
      db.run("UPDATE jobs SET status = 'fallido', locked_at = NULL, last_error = ?, updated_at = ? WHERE id = ?", message, db.now(), job.id);
      const onFail = handlers.get(`${job.type}:fallido`);
      if (onFail) {
        try {
          await onFail(db.parse(job.payload_json, {}), job, err);
        } catch (e) {
          log.error('Error en manejador de fallo', { job: job.id, error: e.message });
        }
      }
    } else {
      const wait = BACKOFF_SEC[Math.min(job.attempts - 1, BACKOFF_SEC.length - 1)];
      db.run(
        "UPDATE jobs SET status = 'pendiente', locked_at = NULL, last_error = ?, run_at = ?, updated_at = ? WHERE id = ?",
        message,
        new Date(Date.now() + wait * 1000).toISOString(),
        db.now(),
        job.id
      );
    }
    log.warn('Trabajo con error', { job: job.id, type: job.type, attempt: job.attempts, final: Boolean(final) });
    return false;
  }
}

/** Procesa trabajos pendientes. En pruebas se llama con { ignoreSchedule: true } para no esperar. */
async function drain({ max = 50, ignoreSchedule = false } = {}) {
  let n = 0;
  while (n < max) {
    if (ignoreSchedule) db.run("UPDATE jobs SET run_at = ? WHERE status = 'pendiente'", db.now());
    const job = claim();
    if (!job) break;
    await runJob(job);
    n++;
  }
  return n;
}

function retry(jobId) {
  return db.run(
    "UPDATE jobs SET status = 'pendiente', attempts = 0, run_at = ?, last_error = NULL, updated_at = ? WHERE id = ? AND status = 'fallido'",
    db.now(),
    db.now(),
    jobId
  ).changes;
}

let timer = null;
let busy = false;
function start(intervalMs = 1500, onTick = null) {
  if (timer) return;
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      if (onTick) await onTick();
      await drain({ max: 10 });
    } catch (e) {
      log.error('Error del procesador de cola', { error: e.message });
    } finally {
      busy = false;
    }
  }, intervalMs);
  timer.unref?.();
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { register, enqueue, drain, retry, start, stop };
