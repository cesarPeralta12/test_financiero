'use strict';
// Recurrentes (CV2-501, decisión D7): se DETECTAN, se PROPONEN y se SUGIEREN cada mes en su día; nunca se crean ni
// se registran solos. Un recurrente es el mismo concepto con importe parecido (±10 %) en ≥ 3 meses distintos.
const db = require('../../db');
const tracker = require('../tracker');
const { normalizar } = require('./normalizar');

const MESES_ATRAS = 6;
const MIN_MESES = 3;
const TOLERANCIA = 0.1;
const TIPOS = ['gasto', 'ingreso'];

const mesDe = (fecha) => fecha.slice(0, 7);
const diasDelMes = (mes) => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
const sumarMeses = (mes, n) => {
  const d = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/** Conceptos que ya se repiten cada mes y todavía no son recurrentes ni fueron rechazados. */
function detectar(userId, hoy = new Date().toISOString().slice(0, 10)) {
  const mesActual = mesDe(hoy);
  const desde = `${sumarMeses(mesActual, -MESES_ATRAS)}-01`;
  const filas = db.all(
    `SELECT date, kind, category, subcategory, amount, note, note_norm FROM movements
      WHERE user_id = ? AND kind IN ('gasto', 'ingreso') AND deleted_at IS NULL AND note_norm IS NOT NULL AND date >= ? AND date <= ? ORDER BY date`,
    userId,
    desde,
    hoy
  );
  const ya = new Set(db.all('SELECT note FROM recurring_movements WHERE user_id = ?', userId).map((r) => normalizar(r.note || '')));
  for (const r of db.all('SELECT term FROM recurring_dismissed WHERE user_id = ?', userId)) ya.add(r.term);
  const grupos = new Map();
  for (const f of filas) {
    const clave = `${f.kind}|${f.note_norm}`;
    const g = grupos.get(clave) || { kind: f.kind, norm: f.note_norm, meses: {} };
    const mes = mesDe(f.date);
    const m = g.meses[mes] || (g.meses[mes] = { total: 0, ultima: f });
    m.total += Number(f.amount);
    m.ultima = f;
    grupos.set(clave, g);
  }
  const out = [];
  for (const g of grupos.values()) {
    if (ya.has(g.norm)) continue;
    const meses = Object.keys(g.meses).sort();
    const montos = meses.map((m) => g.meses[m].total).sort((a, b) => a - b);
    const mediana = montos[Math.floor(montos.length / 2)];
    const parecidos = meses.filter((m) => Math.abs(g.meses[m].total - mediana) <= mediana * TOLERANCIA);
    // Debe seguir vigente: presente este mes o el anterior.
    if (parecidos.length < MIN_MESES || !(parecidos.includes(mesActual) || parecidos.includes(sumarMeses(mesActual, -1)))) continue;
    const ult = g.meses[parecidos[parecidos.length - 1]].ultima;
    out.push({ clave: g.norm, tipo: g.kind, nota: ult.note, categoria: ult.category, subcategoria: ult.subcategory || null, monto: mediana.toFixed(2), dia: Number(ult.date.slice(8, 10)), veces: parecidos.length });
  }
  return out.sort((a, b) => b.veces - a.veces || Number(b.monto) - Number(a.monto));
}

function validar(userId, c, hoy) {
  const dia = Number(c.dia);
  if (!TIPOS.includes(c.tipo)) return { ok: false, error: 'El recurrente puede ser un gasto o un ingreso.' };
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) return { ok: false, error: 'El día debe estar entre 1 y 31.' };
  const v = tracker.validateMovement(userId, { kind: c.tipo, category: c.categoria, subcategory: c.subcategoria || null, amount: c.monto, date: hoy, note: c.nota });
  if (!v.ok) return { ok: false, error: Object.values(v.errors)[0] };
  if (!v.value.note) return { ok: false, error: 'Ponle un nombre al recurrente (por ejemplo «Internet»).' };
  return { ok: true, v: v.value, dia };
}

function crear(userId, c, hoy = new Date().toISOString().slice(0, 10)) {
  const r = validar(userId, c, hoy);
  if (!r.ok) return r;
  if (db.value('SELECT COUNT(*) FROM recurring_movements WHERE user_id = ? AND active = 1', userId) >= 40) return { ok: false, error: 'Tienes demasiados recurrentes activos. Pausa alguno primero.' };
  if (db.value('SELECT 1 FROM recurring_movements WHERE user_id = ? AND kind = ? AND lower(note) = lower(?)', userId, r.v.kind, r.v.note)) return { ok: false, error: 'Ya tienes un recurrente con ese nombre.' };
  const id = db
    .run(
      `INSERT INTO recurring_movements (user_id, kind, category, subcategory, amount, day_of_month, note, active, last_suggested_month, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      userId,
      r.v.kind,
      r.v.category,
      r.v.subcategory,
      r.v.amount,
      r.dia,
      r.v.note,
      // Si ya se anotó este mes, no se vuelve a sugerir hasta el siguiente.
      db.value('SELECT 1 FROM movements WHERE user_id = ? AND deleted_at IS NULL AND note_norm = ? AND substr(date, 1, 7) = ?', userId, r.v.noteNorm, mesDe(hoy)) ? mesDe(hoy) : null,
      db.now(),
      db.now()
    ).lastId;
  db.run('DELETE FROM recurring_dismissed WHERE user_id = ? AND term = ?', userId, r.v.noteNorm);
  return { ok: true, id };
}

const listar = (userId) => db.all('SELECT * FROM recurring_movements WHERE user_id = ? ORDER BY active DESC, day_of_month, id', userId);
const obtener = (userId, id) => db.one('SELECT * FROM recurring_movements WHERE id = ? AND user_id = ?', Number(id), userId) || null;

function pausar(userId, id, activo) {
  return db.run('UPDATE recurring_movements SET active = ?, updated_at = ? WHERE id = ? AND user_id = ?', activo ? 1 : 0, db.now(), Number(id), userId).changes > 0;
}
function eliminar(userId, id) {
  return db.run('DELETE FROM recurring_movements WHERE id = ? AND user_id = ?', Number(id), userId).changes > 0;
}
function descartar(userId, clave) {
  if (!clave) return false;
  db.run('INSERT OR IGNORE INTO recurring_dismissed (user_id, term, created_at) VALUES (?, ?, ?)', userId, String(clave).slice(0, 80), db.now());
  return true;
}
function marcarSugerido(userId, id, mes) {
  db.run('UPDATE recurring_movements SET last_suggested_month = ?, updated_at = ? WHERE id = ? AND user_id = ?', mes, db.now(), Number(id), userId);
}

/** Los recurrentes activos que ya «tocan» este mes (su día ya llegó) y todavía no se anotaron ni se sugirieron. */
function sugeridosDelMes(userId, hoy = new Date().toISOString().slice(0, 10)) {
  const mes = mesDe(hoy);
  const diaHoy = Number(hoy.slice(8, 10));
  const limite = diasDelMes(mes);
  return listar(userId).filter((r) => {
    if (!r.active || r.last_suggested_month === mes) return false;
    if (Math.min(r.day_of_month, limite) > diaHoy) return false; // el día de este mes todavía no llega
    const anotado = db.value('SELECT 1 FROM movements WHERE user_id = ? AND deleted_at IS NULL AND kind = ? AND substr(date, 1, 7) = ? AND note_norm = ?', userId, r.kind, mes, normalizar(r.note || ''));
    return !anotado;
  });
}

module.exports = { detectar, crear, listar, obtener, pausar, eliminar, descartar, marcarSugerido, sugeridosDelMes, MIN_MESES };
