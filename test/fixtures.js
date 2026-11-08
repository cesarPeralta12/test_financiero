'use strict';
// Respuestas ficticias de prueba y demostración (sin información personal real).

// Respuestas válidas para el test gratuito (25 preguntas).
const FREE_ANSWERS = {
  moneda: { value: 'MXN' },
  fuente_ingreso: { value: 'empleo' },
  ingreso_mensual: { amount: '30000', period: 'mensual' },
  ingreso_neto: { value: 'neto' },
  estabilidad_ingreso: { value: 'fijo' },
  gasto_mensual: { amount: '22000', period: 'mensual' },
  gasto_vivienda: { amount: '9000', period: 'mensual' },
  registro_gastos: { value: 'general' },
  fin_de_mes: { value: 'justo' },
  tiene_deudas: { value: 'si' },
  deuda_total: { amount: '60000' },
  pago_deudas_mensual: { amount: '4500', period: 'mensual' },
  atrasos: { value: 'no' },
  ahorro_mensual: { amount: '1500', period: 'mensual' },
  ahorro_acumulado: { amount: '8000' },
  cobertura: { value: 'menos_1' },
  dependientes: { value: '1' },
  aporte_hogar: { value: 'solo_yo' },
  proteccion: { value: ['salud'] },
  presupuesto: { value: 'a_veces' },
  impulso: { value: 'mensual' },
  revision: { value: 'mensual' },
  objetivo: { value: 'deudas' },
  plazo_objetivo: { value: '12' },
  compromiso: { value: '30' },
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
