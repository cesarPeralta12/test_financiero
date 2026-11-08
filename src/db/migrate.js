'use strict';
const fs = require('node:fs');
const path = require('node:path');
const db = require('./index');

const DIR = path.join(__dirname, 'migrations');

function migrate({ quiet = false } = {}) {
  const d = db.get();
  d.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(db.all('SELECT version FROM schema_migrations').map((r) => r.version));
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const done = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
    db.tx(() => {
      d.exec(sql);
      db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', version, db.now());
    });
    done.push(version);
  }
  if (!quiet) {
    console.log(done.length ? `Migraciones aplicadas: ${done.join(', ')}` : 'Base de datos al día.');
  }
  return done;
}

module.exports = { migrate };

if (require.main === module) {
  migrate();
  db.close();
}
