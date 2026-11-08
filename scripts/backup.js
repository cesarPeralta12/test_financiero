'use strict';
// Crea un respaldo verificado de la base de datos del entorno actual.
const db = require('../src/db');
const { migrate } = require('../src/db/migrate');
const backup = require('../src/lib/backup');

db.open();
migrate({ quiet: true });
const file = backup.create();
const check = backup.verify(file);
const pruned = backup.prune();
console.log(`Respaldo: ${file}`);
console.log(`Integridad: ${check.integrity}. Conteos restaurados: ${JSON.stringify(check.restored)}`);
if (pruned) console.log(`Respaldos antiguos eliminados: ${pruned}`);
db.close();
process.exit(check.ok ? 0 : 1);
