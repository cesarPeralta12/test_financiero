'use strict';
// Evaluación profunda v4 (adaptativa): las mismas preguntas de la v3, en un orden que permite saltar las que no
// hacen falta (src/domain/adaptive.js) y con textos más cercanos.
const { DEEP_V3 } = require('./content-deep-v3');

const ORDEN = [
  'moneda_base', 'actividad', 'ingreso_principal', 'ingreso_es_neto', 'ingresos_adicionales', 'caida_ingreso',
  'negocio_situacion', 'negocio_ventas', 'negocio_ganancia', 'negocio_clientes', 'negocio_recurrencia', 'negocio_equipo', 'negocio_problema',
  'gastos_desglose', 'gastos_anuales', 'deudas', 'atraso_actual', 'pago_tarjeta',
  'ahorro_mensual', 'ahorro_disponible', 'ahorro_no_disponible', 'capital_invertir', 'activos', 'bienes_vendibles',
  'dependientes', 'cobertura_salud', 'respaldo_ingreso', 'gastos_previstos', 'gasto_reducible', 'ajuste_gasto', 'habitos',
  'horas_semana', 'habilidades', 'a_quien_ofrecer', 'ingreso_extra_posible',
  'metas', 'prioridad', 'perfil_riesgo', 'reaccion_perdida', 'objetivo_ingreso', 'objetivo_patrimonio', 'objetivo_plazo', 'motivacion',
];
const TEXTOS = {
  ingreso_es_neto: { prompt: '¿Eso es lo que recibes en la mano?', help: 'Neto es lo que te queda después de impuestos y descuentos; bruto es antes de descontar.' },
  habitos: { prompt: '¿Con cuáles de estas te identificas?', help: 'Sé honesto: nadie más lo ve. Puedes nombrar varias.' },
  perfil_riesgo: { prompt: 'Si tuvieras dinero para hacerlo crecer, ¿qué harías?', help: 'No hay respuesta correcta.' },
  objetivo_ingreso: { prompt: 'Si todo sale bien, ¿cuánto te gustaría ganar al mes?', help: 'Toca una cifra o escribe la tuya.' },
  objetivo_patrimonio: { prompt: 'Imagina que ya vives tranquilo con tu dinero. ¿Cuánto tendrías reunido?', help: 'Entre ahorros y bienes, sin deudas. Toca una cifra, escribe la tuya o di «no lo sé».' },
  objetivo_plazo: { prompt: '¿Cuándo te gustaría llegar ahí?' },
  motivacion: { prompt: '¿Qué cambiaría en tu vida si lo logras?', help: 'Lo que más pesa para ti.' },
};

const by = Object.fromEntries(DEEP_V3.questions.map((q) => [q.code, q]));
const questions = ORDEN.map((code) => ({ ...by[code], ...(TEXTOS[code] || {}), config: { ...(by[code].config || {}), adaptive: true } }));

const DEEP_V4 = { title: 'Evaluación profunda', notes: 'Versión 4: adaptativa, pregunta solo lo necesario según las respuestas.', questions };

module.exports = { DEEP_V4 };
