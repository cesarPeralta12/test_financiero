'use strict';
// Sugerencias bajo el campo de texto (docs/coach-v2/08 §4): cambian según el contexto de la cuenta.
// Son acciones, no texto: no pasan por el parser ni por la IA.
const db = require('../../db');
const tracker = require('../tracker');
const tasks = require('../tasks');
const base = require('./insights/base');
const acciones = require('./insights/acciones');
const estado = require('./insights/estado');
const recurrentes = require('./recurrentes');
const plantillas = require('./plantillas');

const consulta = (intencion, etiqueta) => ({ etiqueta, accion: 'consulta', intencion });
const ir = (destino, etiqueta) => ({ etiqueta, accion: 'ir', destino });

function sugerencias(userId, { hoy } = {}) {
  const hayMovs = db.value("SELECT 1 FROM movements WHERE user_id = ? AND deleted_at IS NULL LIMIT 1", userId);
  if (!hayMovs) return [ir('/mi-dinero/nuevo', 'Registrar mi primer gasto'), ir('/mi-dinero/nuevo', 'Registrar un ingreso'), consulta('ayuda_menu', '¿Qué puedes hacer?')];
  const ctx = base.contexto(userId, { hoy });
  if (ctx.n < base.U.minMovs) return [ir('/mi-dinero/nuevo', 'Registrar un gasto'), consulta('ayuda_menu', '¿Qué puedes hacer?'), consulta('resumen_mes', 'Resumen del mes')];
  const out = [];
  // Pulido (S7): lo que toca este mes y lo que ya se repite, antes que lo genérico.
  const toca = recurrentes.sugeridosDelMes(userId, hoy)[0];
  if (toca) out.push(consulta('recurrente_sugerido_mes', `Toca: ${toca.note}`));
  if (!toca && recurrentes.detectar(userId, hoy).length) out.push(consulta('recurrente_propuesto', 'Programar un recurrente'));
  else if (!toca && plantillas.candidatas(userId, hoy).length) out.push(consulta('plantilla_sugerida', 'Crear un atajo'));
  if (estado.sinRegistro(ctx)) out.push(ir('/mi-dinero/nuevo', 'Registrar un gasto'));
  out.push(consulta('resumen_mes', 'Resumen del mes'), consulta('mayor_gasto', 'En qué gasto más'), consulta('recortar_rapido', 'Qué puedo recortar'));
  const deuda = acciones.deudaLiquidable(ctx);
  if (deuda) out.push(deuda.intencion_mensaje === 'deuda_liquidable' ? consulta('deuda_liquidable', 'Puedo liquidar una deuda') : consulta('deuda_pagar_primero', 'Qué deuda pago primero'));
  else out.push(consulta('comparar_mes_anterior', 'Comparar con el mes pasado'));
  if (tracker.goals(userId).length) out.push(consulta('meta_avance', 'Mi meta'));
  if (tasks.next(userId)) out.push(consulta('siguiente_paso', 'Mi siguiente paso'));
  return out.slice(0, 5);
}

module.exports = { sugerencias };
