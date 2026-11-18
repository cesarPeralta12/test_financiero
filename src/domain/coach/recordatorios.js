'use strict';
// Recordatorios amables (CV2-504) y resumen semanal (CV2-506). Reglas fijas, sin IA y sin culpa:
//  · máximo 2 recordatorios por semana y cuenta; nunca dos en 3 días;
//  · solo a quien ya usa el registro (algún movimiento en los últimos 60 días) y no los apagó;
//  · apagables: coach_prefs_json.recordatorios = false;
//  · el resumen semanal (lunes) solo si la bandera `coach_v2_resumen_semanal` está abierta.
// El texto sale de plantillas con cifras del servidor, nunca de un modelo (el «lote» de IA queda como mejora futura).
const db = require('../../db');
const money = require('../../lib/money');
const tracker = require('../tracker');
const { getSetting, notify } = require('../../lib/services');

const MAX_SEMANA = 2;
const sumarDias = (fecha, n) => new Date(Date.parse(`${fecha}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const semanaIso = (fecha) => {
  const d = new Date(`${fecha}T00:00:00Z`);
  const dia = (d.getUTCDay() + 6) % 7;
  return sumarDias(fecha, -dia); // lunes de esa semana
};

const prefs = (userId) => db.parse(db.value('SELECT coach_prefs_json FROM users WHERE id = ?', userId), {}) || {};
const activos = (userId) => prefs(userId).recordatorios !== false;

function permitido(userId, hoy) {
  const desde = `${sumarDias(hoy, -7)}T00:00:00.000Z`;
  const ultimos = db.all('SELECT created_at FROM coach_reminders WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC', userId, desde);
  if (ultimos.length >= MAX_SEMANA) return false;
  if (ultimos[0] && Date.parse(ultimos[0].created_at) > Date.parse(`${sumarDias(hoy, -3)}T00:00:00.000Z`)) return false;
  return true;
}

function sinRegistroReciente(userId, hoy) {
  const ult = db.value('SELECT MAX(date) FROM movements WHERE user_id = ? AND deleted_at IS NULL', userId);
  if (!ult) return false;
  const dias = Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${ult}T00:00:00Z`)) / 86400000);
  return dias >= 3 && dias <= 60;
}

function recordarRegistro(userId, hoy) {
  if (!activos(userId) || !permitido(userId, hoy) || !sinRegistroReciente(userId, hoy)) return false;
  db.run('INSERT INTO coach_reminders (user_id, kind, created_at) VALUES (?, ?, ?)', userId, 'registro', db.now());
  notify(userId, { kind: 'coach', title: '¿Anotamos lo de estos días?', body: 'Llevas unos días sin registrar. Con un minuto basta para que tu resumen siga siendo real. Sin presión.', link: '/mi-dinero/nuevo', dedupe: `recordatorio:${userId}:${hoy}` });
  return true;
}

/** Resumen de la semana anterior (lunes a domingo) con cifras exactas del servidor. */
function resumenSemana(userId, lunes) {
  const desde = sumarDias(lunes, -7);
  const hasta = sumarDias(lunes, -1);
  const cur = tracker.baseCurrency(userId);
  const f = (v) => money.format(String(v), cur);
  const g = db.one("SELECT COUNT(*) AS n, COALESCE(SUM(CAST(amount AS REAL)), 0) AS total FROM movements WHERE user_id = ? AND kind = 'gasto' AND deleted_at IS NULL AND date BETWEEN ? AND ?", userId, desde, hasta);
  if (!g.n) return null;
  const top = db.one("SELECT category, SUM(CAST(amount AS REAL)) AS total FROM movements WHERE user_id = ? AND kind = 'gasto' AND deleted_at IS NULL AND date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC LIMIT 1", userId, desde, hasta);
  const etiqueta = (tracker.CATEGORIES.gasto && tracker.CATEGORIES.gasto[top.category]) || top.category;
  return { titulo: 'Tu semana en una mirada', cuerpo: `Del ${desde} al ${hasta} anotaste ${g.n} ${g.n === 1 ? 'gasto' : 'gastos'} por ${f(g.total.toFixed(2))}. Lo que más pesó: ${etiqueta} (${f(top.total.toFixed(2))}).` };
}

function enviarResumen(userId, hoy) {
  const lunes = semanaIso(hoy);
  if (hoy !== lunes || !activos(userId)) return false;
  const r = resumenSemana(userId, lunes);
  if (!r) return false;
  notify(userId, { kind: 'coach', title: r.titulo, body: r.cuerpo, link: '/mi-dinero', dedupe: `resumen_semanal:${userId}:${lunes}` });
  return true;
}

/** Trabajo diario. Devuelve cuántos avisos salieron. */
function diario(hoy = new Date().toISOString().slice(0, 10)) {
  const usuarios = db.all("SELECT DISTINCT user_id FROM movements WHERE deleted_at IS NULL AND date >= ?", sumarDias(hoy, -60)).map((r) => r.user_id);
  const resumen = getSetting('coach_v2_resumen_semanal') === true;
  let n = 0;
  for (const id of usuarios) {
    if (recordarRegistro(id, hoy)) n++;
    if (resumen && enviarResumen(id, hoy)) n++;
  }
  return n;
}

function apagar(userId, activo) {
  const p = prefs(userId);
  p.recordatorios = Boolean(activo);
  db.run('UPDATE users SET coach_prefs_json = ? WHERE id = ?', JSON.stringify(p), userId);
}

module.exports = { diario, recordarRegistro, enviarResumen, resumenSemana, permitido, apagar, activos, semanaIso, MAX_SEMANA };
