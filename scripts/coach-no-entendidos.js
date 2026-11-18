'use strict';
// Frases que el Coach no entendió (intención `no_entendi`), agrupadas, para ampliar el diccionario.
// Los números se reemplazan por # y no se muestra ninguna cuenta. Úsalo solo en entornos donde las
// personas aceptaron esta revisión y no compartas el resultado sin anonimizar (docs/coach-v2/10).
// Uso: npm run coach:no-entendidos [-- dias]
const db = require('../src/db');
db.open();
const dias = Number(process.argv[2]) || 30;
const since = new Date(Date.now() - dias * 86400000).toISOString();
const rows = db.all(
  `SELECT u.content AS texto
     FROM messages c
     JOIN messages u ON u.id = (SELECT MAX(id) FROM messages WHERE conversation_id = c.conversation_id AND role = 'usuario' AND id < c.id)
    WHERE c.role = 'coach' AND c.intent = 'no_entendi' AND c.created_at >= ?`,
  since
);
const grupos = new Map();
for (const r of rows) {
  const k = String(r.texto).toLowerCase().replace(/\d+([.,]\d+)?/g, '#').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (k) grupos.set(k, (grupos.get(k) || 0) + 1);
}
const lista = [...grupos.entries()].sort((a, b) => b[1] - a[1]);
console.log(`Frases no entendidas en los últimos ${dias} días: ${rows.length} (${lista.length} distintas)`);
for (const [t, n] of lista.slice(0, 100)) console.log(`${String(n).padStart(4)} · ${t}`);
if (!rows.length) console.log('Nada que revisar: el Coach entendió todo lo que recibió.');
db.close();
