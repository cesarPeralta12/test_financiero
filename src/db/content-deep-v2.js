'use strict';
// Evaluación profunda v2: misma información que la v1, pero se responde con botones.
// Las respuestas se guardan con la misma forma que en la v1, así que el diagnóstico,
// el plan y los cálculos no cambian. Diferencias:
//  · Sin «gasto total» ni «pago total de deudas»: el sistema los suma.
//  · Gastos y deudas: primero se marca qué hay; solo se pide el monto de lo marcado.
//  · La tasa de interés es opcional («No sé el interés»); sin tipo de tasa.
//  · Porcentaje de caída y dependientes con botones.
//  · Preguntas que pedían «escribe 0»: primero Sí/No.
//  · Metas: tipo con botones, cuánto necesita y plazo con botones.
const { DEEP } = require('./content-v1');

const byCode = Object.fromEntries(DEEP.questions.map((q) => [q.code, q]));
const base = (code, patch = {}) => ({ ...byCode[code], ...patch, config: { ...(byCode[code].config || {}), ...(patch.config || {}) } });

const DEBT_KINDS = [
  { value: 'tarjeta', label: 'Tarjeta de crédito' },
  { value: 'personal', label: 'Préstamo personal' },
  { value: 'auto', label: 'Crédito de auto' },
  { value: 'hipoteca', label: 'Hipoteca' },
  { value: 'estudios', label: 'Crédito educativo' },
  { value: 'familiar', label: 'Préstamo de familiar o amigo' },
  { value: 'otra', label: 'Otra deuda' },
];

const GOAL_KINDS = [
  { value: 'emergencias', label: 'Fondo para emergencias' },
  { value: 'vivienda', label: 'Vivienda' },
  { value: 'estudios', label: 'Estudios' },
  { value: 'negocio', label: 'Negocio propio' },
  { value: 'auto', label: 'Auto o moto' },
  { value: 'viaje', label: 'Viaje' },
  { value: 'retiro', label: 'Retiro' },
  { value: 'otra', label: 'Otra meta' },
];

const HORIZONS = [
  { value: '6', label: '6 meses' },
  { value: '12', label: '1 año' },
  { value: '24', label: '2 años' },
  { value: '36', label: '3 años o más' },
  { value: '0', label: 'Sin plazo' },
];

const DEEP_V2 = {
  title: 'Evaluación profunda',
  notes: 'Versión 2: respuestas con botones; los montos se piden solo cuando aplican.',
  questions: [
    base('moneda_base'),
    base('ingreso_principal'),
    base('ingreso_es_neto'),
    base('ingresos_adicionales', { config: { presence: true, presence_label: '¿Cuánto recibes y cada cuánto?' } }),
    base('caida_ingreso', {
      help: 'Elige la opción más cercana.',
      config: {
        choices: [
          { value: '0', label: 'No baja: mi ingreso es fijo' },
          { value: '10', label: 'Baja un poco (hasta 10 %)' },
          { value: '25', label: 'Baja bastante (de 10 % a 25 %)' },
          { value: '50', label: 'Baja mucho (de 25 % a 50 %)' },
          { value: '75', label: 'Baja más de la mitad' },
        ],
      },
    }),
    base('gastos_desglose', {
      prompt: '¿En qué gastas cada mes?',
      help: 'Marca lo que pagas en un mes normal y escribe cuánto. Sin pagos de deudas: esos van después.',
      config: { pick: true },
    }),
    base('gastos_anuales', {
      prompt: '¿Tienes gastos que pagas una o pocas veces al año?',
      help: 'Seguros anuales, impuestos, matrículas, regalos de temporada. Lo dividiremos entre 12.',
      config: { presence: true, presence_label: '¿Cuánto suman en el año?' },
    }),
    base('deudas', {
      prompt: '¿Qué deudas tienes?',
      help: 'Marca las que tengas. Por cada una te pedimos cuánto debes y cuánto pagas al mes. El interés es opcional: si lo sabes, el plan será más preciso.',
      config: { kinds: DEBT_KINDS, simple: true },
    }),
    base('atraso_actual', { config: { show_if: { code: 'deudas', not_empty: true } } }),
    base('pago_tarjeta', {
      options: byCode.pago_tarjeta.options.filter((o) => o.value !== 'sin_tarjeta'),
      config: { show_if: { code: 'deudas', has_kind: 'tarjeta' } },
    }),
    base('ahorro_mensual', {
      prompt: '¿Apartas dinero para ahorrar?',
      help: 'Lo que separas de forma habitual.',
      config: { presence: true, presence_label: '¿Cuánto apartas y cada cuánto?' },
    }),
    base('ahorro_disponible', { help: 'Cuentas de ahorro o efectivo que puedes usar hoy. Si no tienes, escribe 0.' }),
    base('ahorro_no_disponible', {
      help: 'Depósitos a plazo, fondos de retiro o inversiones.',
      config: { presence: true, presence_label: '¿Cuánto suman, aproximadamente?' },
    }),
    base('dependientes', {
      config: {
        choices: [
          { value: '0', label: 'Ninguna' },
          { value: '1', label: '1' },
          { value: '2', label: '2' },
          { value: '3', label: '3' },
          { value: '4', label: '4 o más' },
        ],
      },
    }),
    base('cobertura_salud'),
    base('respaldo_ingreso'),
    base('gastos_previstos'),
    base('gasto_reducible', {
      prompt: '¿Podrías dejar de gastar algo sin afectar lo esencial?',
      help: 'Una estimación honesta.',
      config: { presence: true, presence_label: '¿Cuánto, aproximadamente, y cada cuánto?' },
    }),
    base('ingreso_extra_posible', {
      prompt: '¿Podrías generar un ingreso extra de forma realista?',
      help: 'Lo usaremos solo en escenarios, nunca como ingreso seguro.',
      config: { presence: true, presence_label: '¿Cuánto, aproximadamente, y cada cuánto?' },
    }),
    base('bienes_vendibles', {
      help: 'Un valor aproximado.',
      config: { presence: true, presence_label: '¿Cuánto valen, aproximadamente?' },
    }),
    base('metas', {
      help: 'Marca tus metas. Por cada una, cuánto necesitas y en cuánto tiempo.',
      config: { simple: true, kinds: GOAL_KINDS, horizons: HORIZONS },
    }),
    base('prioridad'),
    base('ajuste_gasto'),
  ],
};

module.exports = { DEEP_V2, DEBT_KINDS, GOAL_KINDS, HORIZONS };
