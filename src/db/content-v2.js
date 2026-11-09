'use strict';
// Cuestionario gratuito v2: mismo orden, códigos, tipos y valores que la v1 (el
// motor de cálculo no cambia), con preguntas en tono de juego y opciones con
// imagen. BORRADOR pendiente de aprobación del responsable de producto.

const FREE_V2 = {
  title: 'Test financiero gratuito (versión de juego)',
  notes: 'Versión 2: tono de juego y opciones con imagen. Mismos valores que la v1.',
  questions: {
    moneda: {
      prompt: 'Elige tu moneda de juego',
      help: 'Todas tus cifras se calcularán en esta moneda. No hacemos conversiones.',
    },
    fuente_ingreso: {
      prompt: '¿De dónde sale tu dinero?',
      options: [
        { value: 'empleo', label: 'Un empleo con sueldo fijo', icon: '💼' },
        { value: 'independiente', label: 'Proyectos o trabajo independiente', icon: '🧑‍💻' },
        { value: 'negocio', label: 'Mi propio negocio', icon: '🏪' },
        { value: 'pension', label: 'Pensión o jubilación', icon: '🧓' },
        { value: 'sin_ingresos', label: 'Ahora no tengo ingresos', icon: '🌱' },
        { value: 'otra', label: 'Otra cosa', icon: '✨' },
      ],
    },
    ingreso_mensual: {
      prompt: '¿Cuánto dinero entra a tu bolsillo?',
      help: 'Suma todo lo que recibes. Elige cada cuánto llega y nosotros lo convertimos a un mes.',
    },
    ingreso_neto: {
      prompt: 'Esa cifra, ¿es lo que de verdad te llega?',
      options: [
        { value: 'neto', label: 'Sí, es lo que llega a mi cuenta', icon: '💵' },
        { value: 'bruto', label: 'No, es antes de impuestos y descuentos', icon: '🧾' },
      ],
    },
    estabilidad_ingreso: {
      prompt: 'Tu ingreso se parece más a…',
      options: [
        { value: 'fijo', label: 'Una roca: igual cada mes', icon: '🪨' },
        { value: 'poco', label: 'Olas suaves: cambia poco', icon: '🌊' },
        { value: 'mucho', label: 'Una montaña rusa: cambia mucho', icon: '🎢' },
        { value: 'impredecible', label: 'Unos dados: nunca sé cuánto', icon: '🎲' },
      ],
    },
    gasto_mensual: {
      prompt: '¿Cuánto sale de tu bolsillo cada mes?',
      help: 'Vivienda, comida, transporte, servicios y todo lo demás. Sin contar pagos de deudas: esos van después.',
    },
    gasto_vivienda: {
      prompt: '¿Cuánto te cuesta tu techo?',
      help: 'Renta, mantenimiento o administración. Si pagas hipoteca, va en las preguntas de deudas. Escribe 0 si no pagas vivienda.',
    },
    registro_gastos: {
      prompt: 'Si tu dinero dejara huellas, tú…',
      options: [
        { value: 'detallado', label: 'Las sigo todas: llevo un registro', icon: '🔍' },
        { value: 'general', label: 'Más o menos sé por dónde va', icon: '🗺️' },
        { value: 'no', label: 'Se me pierden en la niebla', icon: '🌫️' },
      ],
    },
    fin_de_mes: {
      prompt: '¿Cómo llegas a fin de mes?',
      options: [
        { value: 'sobra', label: 'Sobrado: me queda dinero', icon: '🏖️' },
        { value: 'justo', label: 'Justo, en equilibrio', icon: '🧘' },
        { value: 'credito', label: 'Con ayuda de la tarjeta o préstamos', icon: '💳' },
        { value: 'atraso', label: 'Dejando pagos pendientes', icon: '😰' },
      ],
    },
    tiene_deudas: {
      prompt: '¿Llevas alguna deuda en la mochila?',
      help: 'Tarjetas con saldo, préstamos, créditos de auto, hipoteca o dinero que debes a alguien.',
      options: [
        { value: 'si', label: 'Sí, cargo alguna', icon: '🎒' },
        { value: 'no', label: 'No, voy ligero', icon: '🪶' },
      ],
    },
    deuda_total: {
      prompt: '¿Cuánto pesa tu mochila en total?',
      help: 'Suma lo que debes en todas tus deudas.',
    },
    pago_deudas_mensual: {
      prompt: '¿Cuánto pagas por tus deudas?',
      help: 'Suma las cuotas de todos tus préstamos y tarjetas.',
    },
    atrasos: {
      prompt: 'En los últimos 6 meses, ¿se te pasó algún pago?',
      options: [
        { value: 'no', label: 'Nunca, todo a tiempo', icon: '✅' },
        { value: 'una', label: 'Una vez', icon: '⚠️' },
        { value: 'varias', label: 'Varias veces', icon: '🚨' },
      ],
    },
    ahorro_mensual: {
      prompt: '¿Cuánto metes en tu alcancía cada mes?',
      help: 'En promedio. Escribe 0 si hoy no ahorras: también vale.',
    },
    ahorro_acumulado: {
      prompt: '¿Cuánto tienes ya guardado en tu cofre?',
      help: 'Dinero que podrías usar hoy mismo si lo necesitaras.',
    },
    cobertura: {
      prompt: 'Si mañana se apagara tu ingreso, ¿cuánto aguantarías?',
      options: [
        { value: 'menos_1', label: 'Menos de un mes', icon: '🕯️' },
        { value: '1_3', label: 'De uno a tres meses', icon: '🔦' },
        { value: '3_6', label: 'De tres a seis meses', icon: '💡' },
        { value: 'mas_6', label: 'Más de seis meses', icon: '☀️' },
      ],
    },
    dependientes: {
      prompt: '¿Cuántas personas viajan contigo en este barco?',
      help: 'Personas que dependen económicamente de ti. Escribe 0 si nadie depende de ti.',
    },
    aporte_hogar: {
      prompt: '¿Quién más rema en tu hogar?',
      options: [
        { value: 'solo_yo', label: 'Solo yo', icon: '🦸' },
        { value: 'compartido', label: 'Compartimos los gastos', icon: '🤝' },
        { value: 'otro_mayoria', label: 'Otra persona cubre la mayoría', icon: '🫶' },
      ],
    },
    proteccion: {
      prompt: '¿Con qué escudos cuentas hoy?',
      help: 'Elige todos los que tengas.',
      options: [
        { value: 'salud', label: 'Seguro de salud o gastos médicos', icon: '🩺' },
        { value: 'vida', label: 'Seguro de vida', icon: '🛡️' },
        { value: 'bienes', label: 'Seguro de auto o de vivienda', icon: '🚗' },
        { value: 'ninguno', label: 'Ninguno por ahora', icon: '🚫' },
      ],
    },
    presupuesto: {
      prompt: '¿Planeas en qué gastarás antes de que empiece el mes?',
      options: [
        { value: 'siempre', label: 'Siempre, tengo un plan', icon: '🗓️' },
        { value: 'a_veces', label: 'A veces', icon: '🎯' },
        { value: 'nunca', label: 'Nunca, improviso', icon: '🎲' },
      ],
    },
    impulso: {
      prompt: '¿Cada cuánto te gana un antojo que luego lamentas?',
      options: [
        { value: 'casi_nunca', label: 'Casi nunca', icon: '😇' },
        { value: 'mensual', label: 'Algunas veces al mes', icon: '😅' },
        { value: 'semanal', label: 'Cada semana', icon: '🛍️' },
      ],
    },
    revision: {
      prompt: '¿Cada cuánto miras tus cuentas?',
      options: [
        { value: 'semanal', label: 'Cada semana', icon: '👀' },
        { value: 'mensual', label: 'Cada mes', icon: '📅' },
        { value: 'problema', label: 'Solo cuando hay un problema', icon: '🙈' },
      ],
    },
    objetivo: {
      prompt: 'Elige tu próxima misión',
      options: [
        { value: 'deudas', label: 'Liberarme de las deudas', icon: '⛓️' },
        { value: 'reserva', label: 'Armar un fondo para emergencias', icon: '🛟' },
        { value: 'meta', label: 'Ahorrar para algo concreto', icon: '🎯' },
        { value: 'invertir', label: 'Empezar a invertir', icon: '📈' },
        { value: 'orden', label: 'Ordenar mis gastos', icon: '🧹' },
      ],
    },
    plazo_objetivo: {
      prompt: '¿En cuánto tiempo quieres lograrla?',
      options: [
        { value: '3', label: 'En 3 meses', icon: '⚡' },
        { value: '6', label: 'En 6 meses', icon: '🚀' },
        { value: '12', label: 'En 12 meses', icon: '🧭' },
        { value: 'mas_12', label: 'En más de un año', icon: '🏔️' },
      ],
    },
    compromiso: {
      prompt: '¿Cuánto tiempo a la semana le darás a tu misión?',
      options: [
        { value: '15', label: 'Unos 15 minutos', icon: '☕' },
        { value: '30', label: 'Unos 30 minutos', icon: '🎧' },
        { value: '60', label: 'Una hora o más', icon: '🏋️' },
      ],
    },
  },
};

// Banderas para elegir la moneda con tarjetas.
const CURRENCY_ICONS = { MXN: '🇲🇽', COP: '🇨🇴', USD: '🇺🇸', EUR: '🇪🇺', PEN: '🇵🇪', CLP: '🇨🇱', ARS: '🇦🇷', GTQ: '🇬🇹', DOP: '🇩🇴' };

module.exports = { FREE_V2, CURRENCY_ICONS };
