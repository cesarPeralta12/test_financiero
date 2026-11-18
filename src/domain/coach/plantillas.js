'use strict';
// Plantillas rápidas (CV2-502): atajos de un toque para lo que la persona anota seguido. Se proponen cuando el mismo
// concepto con el mismo importe aparece ≥ 3 veces en 60 días; se guardan solo si la persona acepta.
const db = require('../../db');
const tracker = require('../tracker');
const { normalizar } = require('./normalizar');

const MAX = 12;
const VENTANA_DIAS = 60;
const MIN_USOS = 3;

const sumarDias = (fecha, n) => new Date(Date.parse(`${fecha}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function candidatas(userId, hoy = new Date().toISOString().slice(0, 10)) {
  const filas = db.all(
    `SELECT kind, category, subcategory, amount, note, note_norm, COUNT(*) AS veces FROM movements
      WHERE user_id = ? AND kind IN ('gasto', 'ingreso') AND deleted_at IS NULL AND note_norm IS NOT NULL AND date >= ? AND date <= ?
      GROUP BY kind, note_norm, amount HAVING COUNT(*) >= ? ORDER BY veces DESC LIMIT 20`,
    userId,
    sumarDias(hoy, -VENTANA_DIAS),
    hoy,
    MIN_USOS
  );
  const existentes = new Set(db.all('SELECT label FROM quick_templates WHERE user_id = ?', userId).map((r) => normalizar(r.label)));
  return filas.filter((f) => !existentes.has(f.note_norm)).map((f) => ({ tipo: f.kind, categoria: f.category, subcategoria: f.subcategory || null, monto: f.amount, nota: f.note, veces: f.veces }));
}

function crear(userId, { etiqueta, tipo, categoria, subcategoria = null, monto }) {
  const label = String(etiqueta || '').trim().slice(0, 40);
  if (!label) return { ok: false, error: 'Ponle un nombre al atajo.' };
  const v = tracker.validateMovement(userId, { kind: tipo, category: categoria, subcategory: subcategoria, amount: monto, date: new Date().toISOString().slice(0, 10), note: label });
  if (!v.ok) return { ok: false, error: Object.values(v.errors)[0] };
  if (!['gasto', 'ingreso'].includes(v.value.kind)) return { ok: false, error: 'Los atajos son para gastos o ingresos.' };
  if (db.value('SELECT COUNT(*) FROM quick_templates WHERE user_id = ?', userId) >= MAX) return { ok: false, error: `Puedes tener hasta ${MAX} atajos. Elimina alguno primero.` };
  if (db.value('SELECT 1 FROM quick_templates WHERE user_id = ? AND lower(label) = lower(?)', userId, label)) return { ok: false, error: 'Ya tienes un atajo con ese nombre.' };
  const id = db.run('INSERT INTO quick_templates (user_id, label, kind, category, subcategory, amount, uses, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)', userId, label, v.value.kind, v.value.category, v.value.subcategory, v.value.amount, db.now()).lastId;
  return { ok: true, id };
}

const listar = (userId) => db.all('SELECT * FROM quick_templates WHERE user_id = ? ORDER BY uses DESC, id', userId);
const eliminar = (userId, id) => db.run('DELETE FROM quick_templates WHERE id = ? AND user_id = ?', Number(id), userId).changes > 0;

/** Un toque: registra hoy el movimiento del atajo (origen «plantilla»). */
function usar(userId, id, hoy = new Date().toISOString().slice(0, 10)) {
  const t = db.one('SELECT * FROM quick_templates WHERE id = ? AND user_id = ?', Number(id), userId);
  if (!t) return { ok: false, error: 'Ese atajo no existe.' };
  const v = tracker.validateMovement(userId, { kind: t.kind, category: t.category, subcategory: t.subcategory, amount: t.amount, date: hoy, note: t.label });
  if (!v.ok) return { ok: false, error: Object.values(v.errors)[0] };
  const movId = db.tx(() => {
    const m = tracker.createMovement(userId, v.value, 'plantilla');
    db.run('UPDATE quick_templates SET uses = uses + 1 WHERE id = ?', t.id);
    return m;
  });
  return { ok: true, id: movId };
}

module.exports = { candidatas, crear, listar, eliminar, usar, MAX };
