'use strict';
// Trabajos programados: purga de sesiones anónimas no vinculadas (30 días),
// sesiones vencidas, avisos diarios y respaldo diario verificado.
const db = require('./db');
const config = require('./config');
const queue = require('./lib/queue');
const backup = require('./lib/backup');
const log = require('./lib/log');
const { getSetting, setSetting, audit } = require('./lib/services');
const tasks = require('./domain/tasks');

// Carga los manejadores de cola de cada módulo.
require('./lib/mailer');
require('./domain/plan');
require('./domain/free/narrative');
require('./domain/free/result3');
require('./domain/free/result4');
require('./domain/gateways/sandbox');

function purgeAnonymous(days = config.anonymousRetentionDays) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return db.tx(() => {
    const ids = db.all('SELECT id FROM anonymous_sessions WHERE linked_user_id IS NULL AND last_seen_at < ?', cutoff).map((r) => r.id);
    for (const id of ids) {
      db.run('DELETE FROM sessions WHERE anon_id = ?', id);
      db.run('DELETE FROM evaluations WHERE anon_id = ? AND user_id IS NULL', id);
      db.run('DELETE FROM ft_sessions WHERE anon_id = ? AND user_id IS NULL', id);
      db.run('DELETE FROM consents WHERE anon_id = ?', id);
      db.run('UPDATE analytics_events SET anon_id = NULL WHERE anon_id = ?', id);
      db.run('DELETE FROM anonymous_sessions WHERE id = ?', id);
    }
    db.run('DELETE FROM sessions WHERE expires_at < ?', db.now());
    return ids.length;
  });
}

function runBackup() {
  const file = backup.create();
  const check = backup.verify(file);
  backup.prune();
  setSetting('last_backup_at', { at: db.now(), file: check.file, ok: check.ok });
  audit(null, check.ok ? 'respaldo.creado_y_verificado' : 'respaldo.verificacion_fallida', { meta: { file: check.file, size: check.size } });
  if (!check.ok) throw new Error('La verificación del respaldo falló.');
  return check;
}

queue.register('purgar_anonimas', async () => {
  const n = purgeAnonymous();
  log.info('Sesiones anónimas purgadas', { n });
});
queue.register('avisos_diarios', async () => tasks.dailyNotices());
queue.register('respaldo', async () => runBackup());

/** Se llama periódicamente: encola los trabajos diarios una vez por día. */
function scheduleDaily() {
  const today = new Date().toISOString().slice(0, 10);
  const last = getSetting('last_daily_run');
  if (last !== today) {
    setSetting('last_daily_run', today);
    queue.enqueue('purgar_anonimas', {});
    queue.enqueue('avisos_diarios', {});
  }
  const lb = getSetting('last_backup_at');
  const hour = new Date().getHours();
  if (config.env !== 'testing' && hour >= config.backupHour && (!lb || String(lb.at).slice(0, 10) !== today)) {
    setSetting('last_backup_at', { at: db.now(), file: null, ok: null, pending: true });
    queue.enqueue('respaldo', {}, { maxAttempts: 2 });
  }
}

let lastTick = 0;
async function tick() {
  if (Date.now() - lastTick < 60_000) return;
  lastTick = Date.now();
  scheduleDaily();
}

module.exports = { purgeAnonymous, runBackup, scheduleDaily, tick };
