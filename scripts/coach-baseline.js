'use strict';
// Línea base del Coach actual (fase 0): promedios reales de ai_runs en los últimos 30 días.
// Uso: npm run coach:baseline   (usa la base de APP_ENV; en producción da el costo real por mensaje)
const db = require('../src/db');
db.open();
const row = db.one(
  `SELECT COUNT(*) AS llamadas,
          ROUND(AVG(input_tokens), 1)  AS entrada_media,
          ROUND(AVG(output_tokens), 1) AS salida_media,
          ROUND(AVG(cost_micros) / 1000000.0, 5) AS usd_por_llamada,
          ROUND(SUM(cost_micros) / 1000000.0, 4) AS usd_total
   FROM ai_runs
   WHERE purpose = 'coach' AND status = 'ok' AND created_at >= date('now', '-30 days')`
);
console.log('Coach actual · últimos 30 días');
console.log(row);
if (!row.llamadas) console.log('Sin llamadas del Coach en esta base: ejecútalo contra producción para medir el costo real.');
db.close();
