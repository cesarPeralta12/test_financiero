'use strict';
// Límites y controles de costo de la IA del Coach (docs/coach-v2/02 §6).
//  · Mensual por cuenta: solo cuenta llamadas REALES de las tareas explícitas (consejo y redactar); lo resuelto
//    por reglas o por caché no consume nada.
//  · Diario por cuenta: llamadas automáticas (clasificar y extraer).
//  · Presupuesto global mensual (el de siempre) y corte de seguridad si el gasto del día se dispara.
// Si algo se alcanza, todo lo que se resuelve por reglas sigue funcionando sin límite.
const db = require('../../../db');
const { getSetting } = require('../../../lib/services');
const ai = require('../../ai/provider');

const EXPLICITAS = ['coach_consejo', 'coach_redactar'];
const AUTOMATICAS = ['coach_clasificar', 'coach_extraer'];
const placeholders = (l) => l.map(() => '?').join(',');
const diaInicio = () => `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;

function usadasMes(userId) {
  return db.value(`SELECT COUNT(*) FROM ai_runs WHERE user_id = ? AND purpose IN (${placeholders(EXPLICITAS)}) AND status = 'ok' AND created_at >= ?`, userId, ...EXPLICITAS, ai.monthStart()) || 0;
}
function usadasHoy(userId) {
  return db.value(`SELECT COUNT(*) FROM ai_runs WHERE user_id = ? AND purpose IN (${placeholders(AUTOMATICAS)}) AND status = 'ok' AND created_at >= ?`, userId, ...AUTOMATICAS, diaInicio()) || 0;
}
const limiteMes = (userId) => {
  const propio = db.value('SELECT ai_monthly_limit FROM users WHERE id = ?', userId);
  return propio ?? getSetting('ai_coach_monthly_limit');
};
const limiteDia = () => getSetting('ai_coach_daily_auto_limit');

function gastoGlobalAgotado() {
  return ai.monthlySpendMicros() >= Math.round(Number(getSetting('ai_global_monthly_budget_usd')) * 1e6);
}

/** Corte de seguridad: gasto de hoy > 3 × la mediana de los últimos 14 días (con un piso de 1 USD para no cortar por ruido). */
function cortePorGasto() {
  if (getSetting('ai_coach_budget_guard') === false) return false;
  const hoy = db.value('SELECT COALESCE(SUM(cost_micros), 0) FROM ai_runs WHERE created_at >= ?', diaInicio()) || 0;
  if (hoy < 1_000_000) return false;
  const desde = new Date(Date.now() - 14 * 86400000).toISOString();
  const dias = db.all('SELECT substr(created_at, 1, 10) AS d, SUM(cost_micros) AS c FROM ai_runs WHERE created_at >= ? AND created_at < ? GROUP BY d ORDER BY c', desde, diaInicio()).map((r) => r.c);
  if (dias.length < 3) return false; // sin historia suficiente no hay mediana confiable
  const med = dias[Math.floor(dias.length / 2)];
  return hoy > 3 * med;
}

/** ¿Puede esta cuenta hacer una llamada explícita (consejo o redactar)? */
function permiteExplicita(userId) {
  if (gastoGlobalAgotado()) return { ok: false, motivo: 'LIMITE_GLOBAL' };
  const limite = limiteMes(userId);
  if (usadasMes(userId) >= limite) return { ok: false, motivo: 'LIMITE_MENSUAL', limite };
  return { ok: true };
}

/** ¿Puede hacer una llamada automática (clasificar o extraer)? */
function permiteAutomatica(userId) {
  if (gastoGlobalAgotado()) return { ok: false, motivo: 'LIMITE_GLOBAL' };
  if (cortePorGasto()) return { ok: false, motivo: 'CORTE_GASTO' };
  if (usadasHoy(userId) >= limiteDia()) return { ok: false, motivo: 'LIMITE_DIARIO', limite: limiteDia() };
  return { ok: true };
}

function estado(userId) {
  return { consultas_usadas: usadasMes(userId), consultas_limite: limiteMes(userId), automaticas_hoy: usadasHoy(userId), automaticas_limite: limiteDia() };
}

module.exports = { permiteExplicita, permiteAutomatica, estado, usadasMes, usadasHoy, cortePorGasto, gastoGlobalAgotado, EXPLICITAS, AUTOMATICAS };
