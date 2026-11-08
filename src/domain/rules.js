'use strict';
// Reglas y umbrales de diagnóstico versionados (tabla rule_sets).
const db = require('../db');

function current() {
  const row = db.one("SELECT * FROM rule_sets WHERE kind = 'diagnostico' AND status = 'publicado' ORDER BY version DESC LIMIT 1");
  if (!row) throw new Error('No hay reglas de diagnóstico publicadas.');
  return { id: row.id, version: row.version, rules: JSON.parse(row.rules_json) };
}

function byId(id) {
  const row = db.one('SELECT * FROM rule_sets WHERE id = ?', id);
  return row ? { id: row.id, version: row.version, rules: JSON.parse(row.rules_json) } : null;
}

// Validación de la estructura al editar reglas desde el panel.
function validate(rules) {
  const errors = [];
  const num = (path, v, min = 0, max = 100) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) errors.push(`${path} debe ser un número entre ${min} y ${max}.`);
  };
  try {
    num('tasa_ahorro.baja', rules.tasa_ahorro.baja, 0, 1);
    num('tasa_ahorro.saludable', rules.tasa_ahorro.saludable, 0, 1);
    num('carga_deuda.moderada', rules.carga_deuda.moderada, 0, 1);
    num('carga_deuda.alta', rules.carga_deuda.alta, 0, 1);
    num('reserva_meses.minima', rules.reserva_meses.minima, 0, 24);
    num('reserva_meses.recomendada', rules.reserva_meses.recomendada, 0, 24);
    num('reserva_meses.solida', rules.reserva_meses.solida, 0, 36);
    num('vivienda_alta', rules.vivienda_alta, 0, 1);
    num('tasa_cara_efectiva_anual', rules.tasa_cara_efectiva_anual, 0, 5);
    num('consistencia.tolerancia_relativa', rules.consistencia.tolerancia_relativa, 0, 1);
    num('consistencia.tolerancia_minima', rules.consistencia.tolerancia_minima, 0, 1e9);
    for (const k of ['nada', 'poco', 'moderado', 'bastante']) num(`ajuste_gasto.${k}`, rules.ajuste_gasto[k], 0, 1);
    for (const k of ['sin_reserva', 'deuda_cara', 'equilibrio']) {
      const a = rules.asignacion[k];
      ['reserva', 'deuda', 'metas'].forEach((p) => num(`asignacion.${k}.${p}`, a[p], 0, 1));
      const total = a.reserva + a.deuda + a.metas;
      if (Math.abs(total - 1) > 0.0001) errors.push(`asignacion.${k} debe sumar 1 (ahora suma ${total}).`);
    }
    num('plan.dias', rules.plan.dias, 30, 180);
    num('plan.revision_meses', rules.plan.revision_meses, 1, 12);
    num('plan.variacion_ingreso_revision', rules.plan.variacion_ingreso_revision, 0, 1);
    if (rules.tasa_ahorro.baja > rules.tasa_ahorro.saludable) errors.push('tasa_ahorro.baja no puede superar a tasa_ahorro.saludable.');
    if (rules.carga_deuda.moderada > rules.carga_deuda.alta) errors.push('carga_deuda.moderada no puede superar a carga_deuda.alta.');
  } catch {
    errors.push('Falta una sección obligatoria. Parte de la versión publicada y cambia solo los valores.');
  }
  return errors;
}

module.exports = { current, byId, validate };
