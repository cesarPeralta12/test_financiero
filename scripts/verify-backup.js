'use strict';
// Verifica un respaldo restaurándolo en un archivo temporal: «npm run backup:verify -- [archivo]».
const path = require('node:path');
const db = require('../src/db');
const backup = require('../src/lib/backup');
const config = require('../src/config');

const arg = process.argv[2];
const file = arg ? path.resolve(arg) : (backup.list()[0] && path.join(config.backupDir, backup.list()[0].name));
if (!file) {
  console.error('No hay respaldos. Crea uno con «npm run backup».');
  process.exit(1);
}
db.open();
const r = backup.verify(file);
console.log(JSON.stringify(r, null, 2));
db.close();
process.exit(r.ok ? 0 : 1);
