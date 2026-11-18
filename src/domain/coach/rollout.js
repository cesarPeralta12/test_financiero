'use strict';
// Despliegue gradual del Coach v2 (CV2-605): equipo → 10 % → 50 % → 100 %, todo con banderas y reversible al instante.
//  · `coach_v2_equipo`: ids de cuenta que siempre ven el Coach v2 (aunque la bandera general esté apagada).
//  · `coach_v2_enabled`: bandera general; apagada = Coach anterior para todos, salvo el equipo.
//  · `coach_v2_rollout_pct`: porcentaje de cuentas (0–100) que ven el Coach v2 cuando la bandera general está abierta.
// La cuenta cae siempre en el mismo grupo (hash estable del id), así nadie salta entre versiones al recargar.
const { getSetting } = require('../../lib/services');

const cubeta = (userId) => {
  let h = 2166136261; // FNV-1a
  for (const ch of `coach-v2:${userId}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h % 100;
};

function equipo() {
  const v = getSetting('coach_v2_equipo');
  return Array.isArray(v) ? v.map(Number) : [];
}

function pct() {
  const n = Number(getSetting('coach_v2_rollout_pct'));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 100;
}

/** ¿Esta cuenta usa el Coach v2? */
function activoPara(userId) {
  if (userId && equipo().includes(Number(userId))) return true;
  if (getSetting('coach_v2_enabled') !== true) return false;
  const p = pct();
  return p >= 100 || (p > 0 && cubeta(userId) < p);
}

module.exports = { activoPara, cubeta, pct, equipo };
