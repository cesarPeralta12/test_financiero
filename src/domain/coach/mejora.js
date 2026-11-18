'use strict';
// Ciclo de mejora continua del parser (CV2-505). Cuando el Coach no entiende un texto se guarda la FRASE anonimizada
// (sin cuenta, sin números, sin correos ni teléfonos) con un contador. Cada semana se revisan las más repetidas en
// /admin/coach: se incorporan al diccionario o se descartan. Nunca se guarda quién la escribió.
const db = require('../../db');

const CORREO = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

function anonimizar(texto) {
  const t = String(texto || '')
    .toLowerCase()
    .replace(CORREO, ' ')
    .replace(/\+?\d[\d\s().,-]*\d|\d/g, '#')
    .replace(/[<>"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 3 || t.length > 120 || !/[a-záéíóúñ]{2,}/.test(t)) return null;
  return t;
}

function registrar(texto) {
  const frase = anonimizar(texto);
  if (!frase) return false;
  const ahora = db.now();
  db.run(
    `INSERT INTO parser_feedback (phrase, hits, status, first_seen, last_seen) VALUES (?, 1, 'nuevo', ?, ?)
     ON CONFLICT (phrase) DO UPDATE SET hits = hits + 1, last_seen = excluded.last_seen`,
    frase,
    ahora,
    ahora
  );
  return true;
}

function listar({ estado = 'nuevo', limite = 50 } = {}) {
  return db.all('SELECT * FROM parser_feedback WHERE status = ? ORDER BY hits DESC, last_seen DESC LIMIT ?', estado, Math.min(Number(limite) || 50, 200));
}

function marcar(id, estado, nota = null) {
  if (!['revisado', 'incorporado', 'descartado', 'nuevo'].includes(estado)) return false;
  return db.run('UPDATE parser_feedback SET status = ?, review_note = ? WHERE id = ?', estado, nota ? String(nota).slice(0, 200) : null, Number(id)).changes > 0;
}

function resumen() {
  const por = Object.fromEntries(db.all('SELECT status, COUNT(*) AS n FROM parser_feedback GROUP BY status').map((r) => [r.status, r.n]));
  return { nuevo: por.nuevo || 0, revisado: por.revisado || 0, incorporado: por.incorporado || 0, descartado: por.descartado || 0 };
}

/** Lote de revisión semanal: lo más repetido sin revisar, listo para pasarlo a casos del banco. */
const loteSemanal = (n = 25) => listar({ estado: 'nuevo', limite: n });

module.exports = { anonimizar, registrar, listar, marcar, resumen, loteSemanal };
