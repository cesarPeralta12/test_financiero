'use strict';
// Aprendizaje por cuenta: nota normalizada -> categoría que la persona eligió (tabla category_hints).
// Cuando la persona corrige una categoría, la próxima vez la misma nota se clasifica sola.
const db = require('../../db');

function learn(userId, noteNorm, kind, category, subcategory = null) {
  if (!noteNorm || noteNorm.length < 2 || noteNorm.length > 60) return false;
  db.run(
    `INSERT INTO category_hints (user_id, term, kind, category, subcategory, hits, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT (user_id, term, kind) DO UPDATE SET
       hits = CASE WHEN category = excluded.category THEN hits + 1 ELSE 1 END,
       category = excluded.category, subcategory = excluded.subcategory, updated_at = excluded.updated_at`,
    userId,
    noteNorm,
    kind,
    category,
    subcategory,
    db.now()
  );
  return true;
}

function lookup(userId, noteNorm, kind) {
  if (!noteNorm) return null;
  return db.one('SELECT category, subcategory, hits FROM category_hints WHERE user_id = ? AND term = ? AND kind = ?', userId, noteNorm, kind);
}

module.exports = { learn, lookup };
