'use strict';
// Restaura un respaldo. Detén el servidor antes: «npm run restore -- backups/archivo.db».
const path = require('node:path');
const backup = require('../src/lib/backup');
const config = require('../src/config');

const arg = process.argv[2];
if (!arg) {
  console.error('Indica el archivo: npm run restore -- backups/dia-uno-....db');
  process.exit(1);
}
const file = path.resolve(arg);
const r = backup.restore(file, config.databasePath);
console.log(`Restaurado ${path.basename(file)} sobre ${config.databasePath}. Integridad: ${r.integrity}.`);
console.log(`Conteos: ${JSON.stringify(r.restored)}`);
console.log('Se guardó una copia de la base anterior junto al archivo original.');
