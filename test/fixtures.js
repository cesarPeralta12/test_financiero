'use strict';
// Respuestas ficticias de prueba y demostración (sin información personal real).

// Respuestas del test gratuito (25 preguntas), en el formato `value` de la API.
// Es el fixture de aceptación SIM_E_01 de la especificación del resultado.
const FREE_ANSWERS = {
  Q01: 'INCREASE_INCOME',
  Q02: 'JUST_ENOUGH',
  Q03: 'E',
  Q04: 'STABLE',
  Q05: 'SALARY_LIMIT',
  Q06: 'ZERO',
  Q07: 'POSSIBLE',
  Q08: 'LT1M',
  Q09: 'YES',
  Q10: ['CARD'],
  Q11: 'MINIMUM',
  Q12: 'RECORDED',
  Q13: ['NONE'],
  Q14: 'D3',
  Q15: ['DK'],
  Q16: 'A45_54',
  Q17: { kind: 'AGE', value: 49, confirmed: true },
  Q18: { kind: 'AMOUNT', amount: '3000.00', currency: 'USD' },
  Q19: 'LOSS',
  Q20: 'BUSINESS',
  Q21: 'LEARN_FIRST',
  Q22: 'H4_7',
  Q23: { kind: 'CHOICE', code: 'ZERO' },
  Q24: ['ADMIN', 'TEACHING', 'MAKING', 'TECHNICAL'],
  Q25: 'GE100',
};

const DEEP_ANSWERS = {
  moneda_base: { value: 'MXN' },
  ingreso_principal: { amount: '30000', period: 'mensual' },
  ingreso_es_neto: { value: 'neto' },
  ingresos_adicionales: { amount: '0', period: 'mensual' },
  caida_ingreso: { value: '0' },
  gasto_total: { amount: '20000', period: 'mensual' },
  gastos_desglose: { f: { vivienda: '8000', alimentacion: '5000', transporte: '2000', servicios: '1500', salud: '500', educacion: '1000', ocio: '1500', otros: '500' } },
  gastos_anuales: { amount: '6000' },
  deudas: {
    d: [
      { name: 'Tarjeta', kind: 'tarjeta', balance: '40000', payment: '2500', rate: '48', rate_type: 'nominal_anual', fees: '' },
      { name: 'Préstamo', kind: 'personal', balance: '20000', payment: '2000', rate: '18', rate_type: 'efectiva_anual', fees: '' },
    ],
  },
  pago_deudas_total: { amount: '4500', period: 'mensual' },
  atraso_actual: { value: 'no' },
  pago_tarjeta: { value: 'mas_minimo' },
  ahorro_mensual: { amount: '1500', period: 'mensual' },
  ahorro_disponible: { amount: '8000' },
  ahorro_no_disponible: { amount: '0' },
  dependientes: { value: '1' },
  cobertura_salud: { value: 'si' },
  respaldo_ingreso: { value: 'parcial' },
  gastos_previstos: { value: ['ninguno'] },
  gasto_reducible: { amount: '1000', period: 'mensual' },
  ingreso_extra_posible: { amount: '2000', period: 'mensual' },
  bienes_vendibles: { amount: '0' },
  metas: { g: [{ name: 'Fondo de estudios', target: '30000', saved: '2000', months: '24' }] },
  prioridad: { value: 'deuda' },
  ajuste_gasto: { value: 'poco' },
};

module.exports = { FREE_ANSWERS, DEEP_ANSWERS };
