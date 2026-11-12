'use strict';
// Contenido inicial versionado (v1). BORRADOR pendiente de aprobación del
// responsable de producto y de contenido financiero (ver docs/DECISIONES.md).
// Los textos se editan y publican desde el panel administrativo; las versiones
// nuevas no modifican evaluaciones terminadas.

const yesNo = [
  { value: 'si', label: 'Sí' },
  { value: 'no', label: 'No' },
];

const MONTHLY_FLOW = { periods: ['semanal', 'quincenal', 'catorcenal', 'mensual', 'bimestral', 'trimestral', 'semestral', 'anual'] };

const DEBT_KINDS = [
  { value: 'tarjeta', label: 'Tarjeta de crédito' },
  { value: 'personal', label: 'Préstamo personal' },
  { value: 'auto', label: 'Crédito de auto' },
  { value: 'hipoteca', label: 'Hipoteca' },
  { value: 'estudios', label: 'Crédito educativo' },
  { value: 'familiar', label: 'Préstamo de familiar o amigo' },
  { value: 'otra', label: 'Otra' },
];

const DEEP = {
  title: 'Evaluación profunda',
  notes: 'Versión inicial redactada para desarrollo. Reemplazar por el cuestionario aprobado.',
  questions: [
    {
      code: 'moneda_base',
      section: 'perfil',
      type: 'currency',
      prompt: 'Confirma la moneda de tu cuenta',
      help: 'Todos los importes de esta evaluación se escriben en esta moneda. Si recibes dinero en otra moneda, escríbelo ya convertido: no hacemos conversiones automáticas.',
      config: { prefill: { from: 'gratuito', code: 'moneda' } },
    },
    {
      code: 'ingreso_principal',
      section: 'ingresos',
      type: 'money_flow',
      prompt: '¿Cuánto recibes por tu fuente principal de ingresos?',
      help: 'Lo que llega a tu cuenta. Elige cada cuánto lo recibes.',
      config: { ...MONTHLY_FLOW },
    },
    {
      code: 'ingreso_es_neto',
      section: 'ingresos',
      type: 'single',
      prompt: '¿La cifra anterior es neta, es decir, después de impuestos y descuentos?',
      options: [
        { value: 'neto', label: 'Sí, es neta' },
        { value: 'bruto', label: 'No, es bruta' },
      ],
      config: {},
    },
    {
      code: 'ingresos_adicionales',
      section: 'ingresos',
      type: 'money_flow',
      prompt: '¿Recibes otros ingresos regulares?',
      help: 'Rentas, trabajos extra o apoyos que recibes con regularidad.',
      config: MONTHLY_FLOW,
    },
    {
      code: 'caida_ingreso',
      section: 'riesgos',
      type: 'percent',
      prompt: 'En un mes malo, ¿cuánto baja tu ingreso respecto a un mes normal?',
      help: 'Escribe un porcentaje. Si tu ingreso es fijo, escribe 0.',
      allowUnknown: true,
    },
    {
      code: 'gasto_total',
      section: 'gastos',
      type: 'money_flow',
      prompt: '¿Cuánto gastas en total, sin contar pagos de deudas?',
      help: 'En la siguiente pregunta lo desglosarás. Si no coinciden, te avisaremos para que lo revises.',
      config: { ...MONTHLY_FLOW },
    },
    {
      code: 'gastos_desglose',
      section: 'gastos',
      type: 'breakdown',
      prompt: 'Desglosa tus gastos de un mes normal',
      help: 'Escribe 0 en lo que no aplique. Sin pagos de deudas.',
      config: {
        fields: [
          { key: 'vivienda', label: 'Vivienda (renta, mantenimiento)', essential: true },
          { key: 'alimentacion', label: 'Alimentación y supermercado', essential: true },
          { key: 'transporte', label: 'Transporte', essential: true },
          { key: 'servicios', label: 'Servicios (luz, agua, internet, teléfono)', essential: true },
          { key: 'salud', label: 'Salud', essential: true },
          { key: 'educacion', label: 'Educación y cuidado de dependientes', essential: true },
          { key: 'ocio', label: 'Ocio, salidas y suscripciones', essential: false },
          { key: 'otros', label: 'Otros gastos', essential: false },
        ],
      },
      allowUnknown: true,
    },
    {
      code: 'gastos_anuales',
      section: 'gastos',
      type: 'money',
      prompt: '¿Cuánto pagas al año en gastos que no son mensuales?',
      help: 'Seguros anuales, impuestos, matrículas, regalos de temporada. Lo dividiremos entre 12. Escribe 0 si no tienes.',
      allowUnknown: true,
    },
    {
      code: 'deudas',
      section: 'deudas',
      type: 'debts',
      prompt: 'Registra cada una de tus deudas',
      help: 'Saldo, cuota y tasa de cada deuda. Busca el tipo de tasa en tu contrato o estado de cuenta: si no lo sabes, márcalo y te diremos qué falta.',
      config: { kinds: DEBT_KINDS, maxRows: 10 },
    },
    {
      code: 'pago_deudas_total',
      section: 'deudas',
      type: 'money_flow',
      prompt: '¿Cuánto pagas en total por tus deudas?',
      help: 'Compararemos esta cifra con la suma de tus cuotas.',
      config: { ...MONTHLY_FLOW, show_if: { code: 'deudas', not_empty: true } },
    },
    {
      code: 'atraso_actual',
      section: 'deudas',
      type: 'single',
      prompt: '¿Tienes algún pago atrasado en este momento?',
      options: [
        { value: 'no', label: 'No' },
        { value: 'menos_30', label: 'Sí, de menos de 30 días' },
        { value: 'mas_30', label: 'Sí, de más de 30 días' },
      ],
    },
    {
      code: 'pago_tarjeta',
      section: 'deudas',
      type: 'single',
      prompt: '¿Cómo pagas tus tarjetas de crédito?',
      options: [
        { value: 'total', label: 'Pago el total cada mes' },
        { value: 'mas_minimo', label: 'Pago más del mínimo' },
        { value: 'minimo', label: 'Pago solo el mínimo' },
        { value: 'sin_tarjeta', label: 'No uso tarjetas de crédito' },
      ],
    },
    {
      code: 'ahorro_mensual',
      section: 'ahorro',
      type: 'money_flow',
      prompt: '¿Cuánto apartas para ahorro?',
      help: 'Escribe 0 si hoy no apartas nada.',
      config: { ...MONTHLY_FLOW },
    },
    {
      code: 'ahorro_disponible',
      section: 'ahorro',
      type: 'money',
      prompt: '¿Cuánto ahorro tienes disponible de inmediato?',
      help: 'Cuentas de ahorro o efectivo que puedes usar hoy.',
      config: {},
    },
    {
      code: 'ahorro_no_disponible',
      section: 'ahorro',
      type: 'money',
      prompt: '¿Tienes ahorros o inversiones que no puedes retirar de inmediato?',
      help: 'Depósitos a plazo, fondos de retiro o inversiones. Escribe 0 si no tienes.',
      allowUnknown: true,
    },
    {
      code: 'dependientes',
      section: 'riesgos',
      type: 'integer',
      prompt: '¿Cuántas personas dependen económicamente de ti?',
      config: { min: 0, max: 20, unit: 'personas' },
    },
    {
      code: 'cobertura_salud',
      section: 'riesgos',
      type: 'single',
      prompt: '¿Tienes un seguro o servicio de salud que te cubra a ti y a quienes dependen de ti?',
      options: [
        { value: 'si', label: 'Sí, a todos' },
        { value: 'parcial', label: 'Solo a una parte' },
        { value: 'no', label: 'No' },
      ],
    },
    {
      code: 'respaldo_ingreso',
      section: 'riesgos',
      type: 'single',
      prompt: 'Si tu ingreso se detuviera, ¿alguien más podría cubrir los gastos esenciales del hogar?',
      options: [
        { value: 'total', label: 'Sí, por completo' },
        { value: 'parcial', label: 'Solo una parte' },
        { value: 'no', label: 'No' },
      ],
    },
    {
      code: 'gastos_previstos',
      section: 'riesgos',
      type: 'multi',
      prompt: '¿Esperas algún gasto importante en los próximos 12 meses?',
      options: [
        { value: 'mudanza', label: 'Mudanza' },
        { value: 'familia', label: 'Nacimiento o llegada de un familiar' },
        { value: 'estudios', label: 'Estudios' },
        { value: 'reparacion', label: 'Reparación de auto o vivienda' },
        { value: 'salud', label: 'Tratamiento médico' },
        { value: 'ninguno', label: 'Ninguno' },
      ],
      config: { exclusive: ['ninguno'] },
    },
    {
      code: 'gasto_reducible',
      section: 'oportunidades',
      type: 'money_flow',
      prompt: '¿Cuánto podrías dejar de gastar sin afectar lo esencial?',
      help: 'Una estimación honesta. Escribe 0 si no ves margen.',
      config: MONTHLY_FLOW,
      allowUnknown: true,
    },
    {
      code: 'ingreso_extra_posible',
      section: 'oportunidades',
      type: 'money_flow',
      prompt: '¿Cuánto ingreso extra podrías generar de forma realista?',
      help: 'Lo usaremos solo en escenarios, nunca como ingreso seguro. Escribe 0 si no es posible ahora.',
      config: MONTHLY_FLOW,
      allowUnknown: true,
    },
    {
      code: 'bienes_vendibles',
      section: 'oportunidades',
      type: 'money',
      prompt: '¿Tienes cosas que podrías vender sin afectar tu día a día?',
      help: 'Un valor aproximado. Escribe 0 si no tienes.',
      allowUnknown: true,
    },
    {
      code: 'metas',
      section: 'metas',
      type: 'goals',
      prompt: '¿Qué metas quieres alcanzar?',
      help: 'Nombre, cuánto necesitas, cuánto llevas ahorrado para ella y en cuántos meses te gustaría lograrla.',
      config: { maxRows: 5 },
    },
    {
      code: 'prioridad',
      section: 'metas',
      type: 'single',
      prompt: '¿Qué es lo más importante para ti ahora?',
      options: [
        { value: 'deuda', label: 'Pagar mis deudas más rápido' },
        { value: 'reserva', label: 'Construir mi fondo para emergencias' },
        { value: 'metas', label: 'Avanzar en mis metas' },
        { value: 'equilibrio', label: 'Un equilibrio entre todo' },
      ],
    },
    {
      code: 'ajuste_gasto',
      section: 'metas',
      type: 'single',
      prompt: '¿Cuánto estarías dispuesto a ajustar tus gastos no esenciales?',
      options: [
        { value: 'nada', label: 'Nada por ahora' },
        { value: 'poco', label: 'Un poco' },
        { value: 'moderado', label: 'Bastante' },
        { value: 'bastante', label: 'Todo lo necesario' },
      ],
    },
  ],
};

const RULES = {
  tasa_ahorro: { baja: 0.05, saludable: 0.15 },
  carga_deuda: { moderada: 0.2, alta: 0.35 },
  reserva_meses: { minima: 1, recomendada: 3, solida: 6 },
  vivienda_alta: 0.35,
  tasa_cara_efectiva_anual: 0.2,
  consistencia: { tolerancia_relativa: 0.1, tolerancia_minima: 1 },
  ajuste_gasto: { nada: 0, poco: 0.05, moderado: 0.1, bastante: 0.15 },
  asignacion: {
    sin_reserva: { reserva: 0.5, deuda: 0.3, metas: 0.2 },
    deuda_cara: { reserva: 0.3, deuda: 0.5, metas: 0.2 },
    equilibrio: { reserva: 0.4, deuda: 0.2, metas: 0.4 },
  },
  plan: { dias: 90, revision_meses: 3, variacion_ingreso_revision: 0.1 },
};

const PRODUCTS = [
  {
    code: 'evaluacion',
    name: 'Evaluación profunda',
    summary: 'Veinticinco preguntas con cifras precisas y un diagnóstico detallado de tu situación.',
    includes: [
      'Preguntas sobre ingresos, gastos, deudas, cuotas, tasas, ahorros, riesgos y metas',
      'Aviso de contradicciones antes de calcular',
      'Diagnóstico con ingresos y egresos mensuales, saldo disponible, deudas y capacidad de ahorro',
      'Separación clara entre tus datos, nuestros cálculos y los supuestos',
    ],
    grants: [{ code: 'evaluacion_profunda', days: 365 }],
    price_cents: 1900,
    currency: 'USD',
    sort: 1,
  },
  {
    code: 'plan_maestro',
    name: 'Plan Maestro',
    summary: 'Tu plan de 90 días y la hoja de ruta de 12 meses, calculados con tus datos.',
    includes: [
      'Presupuesto propuesto y estrategia para pagar tus deudas',
      'Metas y escenarios con sus supuestos',
      'Plan de 90 días con acciones, fechas e indicadores',
      'Hoja de ruta de 12 meses',
      'Descarga en PDF y versiones al actualizar tus datos',
    ],
    grants: [{ code: 'plan_maestro', days: 365 }],
    price_cents: 3900,
    currency: 'USD',
    sort: 2,
  },
  {
    code: 'acompanamiento',
    name: 'Acompañamiento',
    summary: 'Coach de IA, calculadora, simulador y tablero para ejecutar tu plan.',
    includes: [
      'Coach de IA que conoce tu diagnóstico y tu plan',
      'Registro de ingresos, gastos, deudas, ahorros y metas',
      'Simulador de escenarios que no altera tus datos reales',
      'Tablero de progreso y avisos de tareas',
    ],
    grants: [{ code: 'acompanamiento', days: 90 }],
    price_cents: 2900,
    currency: 'USD',
    sort: 3,
  },
  {
    code: 'paquete',
    name: 'Paquete completo',
    summary: 'Evaluación profunda, Plan Maestro y 90 días de acompañamiento.',
    includes: ['Evaluación profunda', 'Plan Maestro', 'Acompañamiento durante 90 días'],
    grants: [
      { code: 'evaluacion_profunda', days: 365 },
      { code: 'plan_maestro', days: 365 },
      { code: 'acompanamiento', days: 90 },
    ],
    price_cents: 6900,
    currency: 'USD',
    sort: 0,
  },
];

const CONTENTS = [
  {
    key: 'portada',
    title: 'Ordena tu dinero empezando por saber dónde estás.',
    body: 'Responde 25 preguntas y recibe una orientación sobre tus fortalezas, tus riesgos y por dónde empezar. Es gratis y toma unos diez minutos.',
  },
  {
    key: 'consentimiento',
    title: 'Antes de empezar',
    body: `Para darte una orientación necesitamos guardar tus respuestas, que incluyen información sobre tus ingresos, gastos, deudas y ahorros.

- Las usamos solo para calcular tu resultado y tu plan.
- No las compartimos con anunciantes ni las incluimos en nuestras métricas.
- Si no creas una cuenta, las borramos a los 30 días.
- Puedes pedir una copia o su eliminación en cualquier momento.`,
  },
  {
    key: 'privacidad',
    title: 'Política de privacidad',
    body: `**Borrador pendiente de revisión legal.** El texto definitivo lo entrega el responsable de producto.

## Qué datos guardamos
Tu correo, tus respuestas a los cuestionarios, los registros que añadas en la calculadora, tus conversaciones con el coach y el estado de tus compras. No guardamos datos de tarjetas: los procesa la pasarela de pago.

## Para qué los usamos
Para calcular tu orientación, tu diagnóstico y tu plan, y para darte acceso a lo que adquiriste. Las respuestas financieras y las conversaciones quedan fuera del seguimiento publicitario y de las métricas.

## Cuánto tiempo los conservamos
Las respuestas sin cuenta se eliminan a los 30 días. La política de retención para cuentas está por definir.

## Tus derechos
Puedes pedir una copia de tus datos o su eliminación desde tu cuenta, en Privacidad.`,
  },
  {
    key: 'condiciones',
    title: 'Condiciones de uso',
    body: `**Borrador pendiente de revisión legal.**

## Qué es Día Uno
Una herramienta de orientación y planificación financiera personal. No es asesoría financiera, legal ni fiscal, no concede créditos ni ejecuta pagos o inversiones.

## Resultados
La orientación gratuita es preliminar. El diagnóstico y el plan dependen de los datos que ingresas; si cambian, conviene actualizarlos.

## Pagos
Compras de pago único, sin renovación automática. El acceso dura el tiempo indicado antes de pagar. Los reembolsos se gestionan a través de la pasarela de pago.

## Coach de IA
El coach es un asistente de inteligencia artificial. Puede equivocarse y no sustituye a un profesional.`,
  },
  {
    key: 'oferta_evaluacion',
    title: 'Conoce tu situación con cifras exactas',
    body: 'La evaluación profunda revisa tus ingresos, gastos, deudas, tasas y metas con detalle. Detecta contradicciones antes de calcular y te entrega un diagnóstico que distingue tus datos de nuestros cálculos.',
  },
  {
    key: 'oferta_plan',
    title: 'Convierte tu diagnóstico en un plan',
    body: 'El Plan Maestro ordena tus próximos 90 días en acciones concretas y traza una hoja de ruta de 12 meses, con un presupuesto y una estrategia de deuda calculados con tus cifras.',
  },
];

module.exports = { DEEP, RULES, PRODUCTS, CONTENTS };
