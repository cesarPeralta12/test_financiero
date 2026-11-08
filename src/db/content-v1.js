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

const FREE = {
  title: 'Test financiero gratuito',
  notes: 'Versión inicial redactada para desarrollo. Reemplazar por el cuestionario aprobado.',
  questions: [
    {
      code: 'moneda',
      section: 'perfil',
      type: 'currency',
      prompt: '¿En qué moneda manejas tu dinero?',
      help: 'Usaremos esta moneda en todos tus cálculos. No hacemos conversiones entre monedas.',
    },
    {
      code: 'fuente_ingreso',
      section: 'ingresos',
      type: 'single',
      prompt: '¿Cuál describe mejor tu fuente principal de ingresos?',
      options: [
        { value: 'empleo', label: 'Empleo con sueldo fijo' },
        { value: 'independiente', label: 'Trabajo independiente o por proyectos' },
        { value: 'negocio', label: 'Negocio propio' },
        { value: 'pension', label: 'Pensión o jubilación' },
        { value: 'sin_ingresos', label: 'Ahora no tengo ingresos' },
        { value: 'otra', label: 'Otra' },
      ],
    },
    {
      code: 'ingreso_mensual',
      section: 'ingresos',
      type: 'money_flow',
      prompt: '¿Cuánto dinero recibes en total?',
      help: 'Suma todas tus fuentes. Elige cada cuánto lo recibes y lo convertimos a un mes.',
      config: MONTHLY_FLOW,
      allowUnknown: true,
    },
    {
      code: 'ingreso_neto',
      section: 'ingresos',
      type: 'single',
      prompt: '¿Esa cifra es lo que llega a tu cuenta o es antes de impuestos y descuentos?',
      options: [
        { value: 'neto', label: 'Es lo que llega a mi cuenta (neto)' },
        { value: 'bruto', label: 'Es antes de impuestos y descuentos (bruto)' },
      ],
      allowUnknown: true,
    },
    {
      code: 'estabilidad_ingreso',
      section: 'ingresos',
      type: 'single',
      prompt: '¿Qué tan estable es tu ingreso de un mes a otro?',
      options: [
        { value: 'fijo', label: 'Es igual cada mes' },
        { value: 'poco', label: 'Cambia poco' },
        { value: 'mucho', label: 'Cambia mucho' },
        { value: 'impredecible', label: 'Es impredecible' },
      ],
    },
    {
      code: 'gasto_mensual',
      section: 'gastos',
      type: 'money_flow',
      prompt: '¿Cuánto gastas en total, sin contar pagos de deudas?',
      help: 'Incluye vivienda, comida, transporte, servicios y lo demás. Los pagos de tarjetas y préstamos van más adelante.',
      config: MONTHLY_FLOW,
      allowUnknown: true,
    },
    {
      code: 'gasto_vivienda',
      section: 'gastos',
      type: 'money_flow',
      prompt: '¿Cuánto pagas por vivienda?',
      help: 'Renta, mantenimiento o administración. Si pagas una hipoteca, inclúyela en las preguntas de deudas. Escribe 0 si no pagas vivienda.',
      config: MONTHLY_FLOW,
      allowUnknown: true,
    },
    {
      code: 'registro_gastos',
      section: 'habitos',
      type: 'single',
      prompt: '¿Sabes en qué se va tu dinero cada mes?',
      options: [
        { value: 'detallado', label: 'Sí, llevo un registro detallado' },
        { value: 'general', label: 'Tengo una idea general' },
        { value: 'no', label: 'No lo tengo claro' },
      ],
    },
    {
      code: 'fin_de_mes',
      section: 'gastos',
      type: 'single',
      prompt: '¿Cómo llegas a fin de mes?',
      options: [
        { value: 'sobra', label: 'Me sobra dinero' },
        { value: 'justo', label: 'Llego justo' },
        { value: 'credito', label: 'Me falta y uso tarjeta o préstamos' },
        { value: 'atraso', label: 'Me falta y dejo pagos pendientes' },
      ],
    },
    {
      code: 'tiene_deudas',
      section: 'deudas',
      type: 'single',
      prompt: '¿Tienes deudas en este momento?',
      help: 'Tarjetas de crédito con saldo, préstamos, créditos de auto, hipoteca o dinero que debes a familiares.',
      options: yesNo,
    },
    {
      code: 'deuda_total',
      section: 'deudas',
      type: 'money',
      prompt: '¿Cuánto debes en total, sumando todas tus deudas?',
      config: { show_if: { code: 'tiene_deudas', in: ['si'] } },
      allowUnknown: true,
    },
    {
      code: 'pago_deudas_mensual',
      section: 'deudas',
      type: 'money_flow',
      prompt: '¿Cuánto pagas por tus deudas?',
      help: 'Suma las cuotas de todos tus préstamos y tarjetas.',
      config: { ...MONTHLY_FLOW, show_if: { code: 'tiene_deudas', in: ['si'] } },
      allowUnknown: true,
    },
    {
      code: 'atrasos',
      section: 'deudas',
      type: 'single',
      prompt: 'En los últimos 6 meses, ¿te has atrasado en algún pago?',
      options: [
        { value: 'no', label: 'No' },
        { value: 'una', label: 'Una vez' },
        { value: 'varias', label: 'Varias veces' },
      ],
      config: { show_if: { code: 'tiene_deudas', in: ['si'] } },
    },
    {
      code: 'ahorro_mensual',
      section: 'ahorro',
      type: 'money_flow',
      prompt: '¿Cuánto logras ahorrar, en promedio?',
      help: 'Escribe 0 si hoy no ahorras.',
      config: MONTHLY_FLOW,
      allowUnknown: true,
    },
    {
      code: 'ahorro_acumulado',
      section: 'ahorro',
      type: 'money',
      prompt: '¿Cuánto tienes ahorrado hoy que podrías usar si lo necesitaras?',
      help: 'Dinero en cuentas o efectivo que puedes retirar de inmediato.',
      allowUnknown: true,
    },
    {
      code: 'cobertura',
      section: 'ahorro',
      type: 'single',
      prompt: 'Si mañana dejaras de recibir tu ingreso principal, ¿cuánto tiempo podrías cubrir tus gastos?',
      options: [
        { value: 'menos_1', label: 'Menos de un mes' },
        { value: '1_3', label: 'De uno a tres meses' },
        { value: '3_6', label: 'De tres a seis meses' },
        { value: 'mas_6', label: 'Más de seis meses' },
      ],
      allowUnknown: true,
    },
    {
      code: 'dependientes',
      section: 'dependientes',
      type: 'integer',
      prompt: '¿Cuántas personas dependen económicamente de ti?',
      help: 'Escribe 0 si nadie depende de ti.',
      config: { min: 0, max: 20, unit: 'personas' },
    },
    {
      code: 'aporte_hogar',
      section: 'dependientes',
      type: 'single',
      prompt: '¿Quién más aporta dinero a tu hogar?',
      options: [
        { value: 'solo_yo', label: 'Solo yo' },
        { value: 'compartido', label: 'Comparto los gastos con otra persona' },
        { value: 'otro_mayoria', label: 'Otra persona cubre la mayoría' },
      ],
    },
    {
      code: 'proteccion',
      section: 'habitos',
      type: 'multi',
      prompt: '¿Con qué protección cuentas hoy?',
      help: 'Marca todas las que apliquen.',
      options: [
        { value: 'salud', label: 'Seguro de salud o gastos médicos' },
        { value: 'vida', label: 'Seguro de vida' },
        { value: 'bienes', label: 'Seguro de auto o de vivienda' },
        { value: 'ninguno', label: 'Ninguna' },
      ],
      config: { exclusive: ['ninguno'] },
    },
    {
      code: 'presupuesto',
      section: 'habitos',
      type: 'single',
      prompt: '¿Decides en qué vas a gastar antes de que empiece el mes?',
      options: [
        { value: 'siempre', label: 'Siempre' },
        { value: 'a_veces', label: 'A veces' },
        { value: 'nunca', label: 'Nunca' },
      ],
    },
    {
      code: 'impulso',
      section: 'habitos',
      type: 'single',
      prompt: '¿Con qué frecuencia compras algo que luego preferirías no haber comprado?',
      options: [
        { value: 'casi_nunca', label: 'Casi nunca' },
        { value: 'mensual', label: 'Algunas veces al mes' },
        { value: 'semanal', label: 'Cada semana' },
      ],
    },
    {
      code: 'revision',
      section: 'habitos',
      type: 'single',
      prompt: '¿Cada cuánto revisas tus cuentas y saldos?',
      options: [
        { value: 'semanal', label: 'Cada semana' },
        { value: 'mensual', label: 'Cada mes' },
        { value: 'problema', label: 'Solo cuando hay un problema' },
      ],
    },
    {
      code: 'objetivo',
      section: 'objetivos',
      type: 'single',
      prompt: '¿Qué te gustaría lograr primero en los próximos 12 meses?',
      options: [
        { value: 'deudas', label: 'Salir de deudas' },
        { value: 'reserva', label: 'Tener un fondo para emergencias' },
        { value: 'meta', label: 'Ahorrar para algo concreto' },
        { value: 'invertir', label: 'Empezar a invertir' },
        { value: 'orden', label: 'Ordenar mis gastos' },
      ],
    },
    {
      code: 'plazo_objetivo',
      section: 'objetivos',
      type: 'single',
      prompt: '¿En cuánto tiempo te gustaría conseguirlo?',
      options: [
        { value: '3', label: 'En 3 meses' },
        { value: '6', label: 'En 6 meses' },
        { value: '12', label: 'En 12 meses' },
        { value: 'mas_12', label: 'En más de 12 meses' },
      ],
    },
    {
      code: 'compromiso',
      section: 'objetivos',
      type: 'single',
      prompt: '¿Cuánto tiempo a la semana podrías dedicar a ordenar tus finanzas?',
      options: [
        { value: '15', label: 'Unos 15 minutos' },
        { value: '30', label: 'Unos 30 minutos' },
        { value: '60', label: 'Una hora o más' },
      ],
    },
  ],
};

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
      config: { ...MONTHLY_FLOW, prefill: { from: 'gratuito', code: 'ingreso_mensual' } },
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
      config: { prefill: { from: 'gratuito', code: 'ingreso_neto' } },
    },
    {
      code: 'ingresos_adicionales',
      section: 'ingresos',
      type: 'money_flow',
      prompt: '¿Recibes otros ingresos regulares?',
      help: 'Rentas, trabajos extra o apoyos que recibes con regularidad. Escribe 0 si no tienes.',
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
      config: { ...MONTHLY_FLOW, prefill: { from: 'gratuito', code: 'gasto_mensual' } },
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
      config: { ...MONTHLY_FLOW, prefill: { from: 'gratuito', code: 'pago_deudas_mensual' }, show_if: { code: 'deudas', not_empty: true } },
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
      config: { ...MONTHLY_FLOW, prefill: { from: 'gratuito', code: 'ahorro_mensual' } },
    },
    {
      code: 'ahorro_disponible',
      section: 'ahorro',
      type: 'money',
      prompt: '¿Cuánto ahorro tienes disponible de inmediato?',
      help: 'Cuentas de ahorro o efectivo que puedes usar hoy.',
      config: { prefill: { from: 'gratuito', code: 'ahorro_acumulado' } },
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
      config: { min: 0, max: 20, unit: 'personas', prefill: { from: 'gratuito', code: 'dependientes' } },
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

module.exports = { FREE, DEEP, RULES, PRODUCTS, CONTENTS };
