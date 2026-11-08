'use strict';
// Procesador de cola independiente (generación de planes, correos, purgas y respaldos).
// Úsalo con WORKER_INLINE=false en el servidor web.
const config = require('./config');
const db = require('./db');
const { migrate } = require('./db/migrate');
const queue = require('./lib/queue');
const jobs = require('./jobs');

db.open();
migrate({ quiet: true });
queue.start(config.workerIntervalMs, jobs.tick);
console.log(`Procesador de cola de Día Uno (${config.env}) en marcha.`);

function shutdown() {
  queue.stop();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
