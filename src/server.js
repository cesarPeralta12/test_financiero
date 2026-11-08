'use strict';
// Arranque del servidor web. Por defecto procesa la cola en el mismo proceso
// (WORKER_INLINE=true); en producción puede separarse con «npm run worker».
const config = require('./config');
const db = require('./db');
const { migrate } = require('./db/migrate');
const { seed } = require('./db/seed');
const { createApp } = require('./app');
const queue = require('./lib/queue');
const jobs = require('./jobs');
const log = require('./lib/log');

db.open();
migrate({ quiet: true });
if (!config.isProd) seed({ quiet: true });

const app = createApp();
const server = app.listen(config.port, () => {
  log.info(`Día Uno escuchando en ${config.appUrl}`, { env: config.env });
  if (!config.isTest) console.log(`\n  Día Uno (${config.env}) en ${config.appUrl}\n`);
});

if (config.workerInline) queue.start(config.workerIntervalMs, jobs.tick);

function shutdown() {
  queue.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
