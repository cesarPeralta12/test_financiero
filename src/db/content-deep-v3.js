'use strict';
// Evaluación profunda v3: lo de la v2 más el perfil que necesita el Plan Maestro completo (actividad, negocio,
// bienes, tiempo, habilidades, hábitos, riesgo, objetivo medible y motivo). Los códigos de actividad, horas,
// habilidades y contactos son los del test gratuito, para proponerlos sin volver a preguntar.
const { DEEP_V2 } = require('./content-deep-v2');

const opt = (spec) =>
  spec.split(';').map((x) => {
    const i = x.indexOf('=');
    return { value: x.slice(0, i).trim(), label: x.slice(i + 1).trim() };
  });
const q = (code, type, prompt, help, extra = {}) => ({ code, section: 'objetivos', type, prompt, help, required: true, allowUnknown: false, options: [], config: {}, ...extra });

const NEGOCIO = { show_if: { code: 'negocio_situacion', in: ['EMPEZANDO', 'DEPENDE', 'SOLO'] } };

const NUEVAS = [
  q('actividad', 'single', '¿Cómo trabajas actualmente?', 'Elige la que mejor te describe.', { options: opt('EMPLOYEE = Soy empleado; INDEPENDENT = Trabajo por mi cuenta; BUSINESS = Tengo un negocio; MULTIPLE = Hago varias de estas actividades; NONE = No trabajo actualmente; OTHER = Otra situación') }),
  q('negocio_situacion', 'single', '¿Tienes un negocio?', 'Si lo tienes, dinos cuánto depende de ti.', { options: opt('NO = No tengo negocio; EMPEZANDO = Estoy empezando uno; DEPENDE = Funciona, pero depende de mí; SOLO = Funciona aunque yo no esté') }),
  q('negocio_ventas', 'money', '¿Cuánto vende tu negocio en un mes normal?', 'Todo lo que cobras, antes de descontar gastos. Si aún no vendes, escribe 0.', { allowUnknown: true, config: NEGOCIO }),
  q('negocio_ganancia', 'money', '¿Y cuánto te queda de ganancia al mes?', 'Lo que queda después de pagar los gastos del negocio. Si no queda nada, escribe 0.', { allowUnknown: true, config: NEGOCIO }),
  q('negocio_clientes', 'single', '¿Cuántos clientes atiendes al mes?', 'Un aproximado.', { config: { ...NEGOCIO, ranges: [[0, 'C0'], [9, 'C1_9'], [30, 'C10_30'], [1e9, 'C31']] }, options: opt('C0 = Todavía ninguno; C1_9 = Menos de 10; C10_30 = De 10 a 30; C31 = Más de 30') }),
  q('negocio_recurrencia', 'single', '¿Tus clientes vuelven a comprarte?', null, { config: NEGOCIO, options: opt('NO = Casi nunca; ALGUNOS = Algunos vuelven; MUCHOS = La mayoría vuelve; PLAN = Me pagan cada mes; NUEVO = Todavía no tengo clientes') }),
  q('negocio_equipo', 'single', '¿Quién trabaja en tu negocio?', null, { config: NEGOCIO, options: opt('SOLO = Solo yo; FAMILIA = Yo y mi familia; EQUIPO = Tengo personas a mi cargo') }),
  q('negocio_problema', 'single', '¿Cuál es el principal problema de tu negocio?', 'El que más te frena hoy.', { config: NEGOCIO, options: opt('CLIENTES = Faltan clientes; MARGEN = Queda poca ganancia; TIEMPO = No me alcanza el tiempo; COBROS = Me pagan tarde; ORDEN = Falta orden en las cuentas; CAPITAL = Falta dinero para crecer') }),
  q('capital_invertir', 'money', 'De tus ahorros, ¿cuánto podrías invertir sin afectar tus gastos ni tus emergencias?', 'No es dinero nuevo: es la parte de tus ahorros que podrías usar. Si no tienes, escribe 0.', { allowUnknown: true }),
  q('activos', 'breakdown', '¿Qué bienes tienes a tu nombre?', 'Nombra lo que tengas, por ejemplo «casa y moto». No cuentes tus ahorros: ya los anotamos. Si no tienes, escribe «ninguno».', {
    allowUnknown: true,
    config: {
      pick: true,
      none: 'No tengo bienes',
      ask: '¿Cuánto vale aproximadamente: {campo}?',
      hint: 'Marca lo que tengas. Solo te pediremos un valor aproximado.',
      suffix: '',
      fields: [
        { key: 'inmuebles', label: 'Casa o departamento' },
        { key: 'terrenos', label: 'Terrenos' },
        { key: 'vehiculos', label: 'Auto o moto' },
        { key: 'inversiones', label: 'Inversiones' },
        { key: 'negocio', label: 'Tu parte de un negocio' },
        { key: 'equipos', label: 'Equipos, herramientas o mercadería' },
        { key: 'otros', label: 'Otros bienes de valor' },
      ],
    },
  }),
  q('horas_semana', 'single', '¿Cuánto tiempo a la semana podrías dedicar a ganar más?', 'Tiempo real, después de tu trabajo, tu familia y tu descanso.', { options: opt('H0 = Por ahora, nada; H_LT3 = Menos de 3 horas; H3_7 = De 3 a 7 horas; H8_14 = De 8 a 14 horas; H15_25 = De 15 a 25 horas; H26_40 = De 26 a 40 horas; H41 = Más de 40 horas') }),
  q('habilidades', 'multi', '¿Qué se te da mejor?', 'Empieza por la que mejor haces. Puedes nombrar varias.', { config: { exclusive: ['UNSURE'] }, options: opt('SELL = Vender o atender clientes; ORGANIZE = Organizar tareas, cuentas o documentos; DIGITAL = Usar computadoras y herramientas digitales; MANUAL = Reparar, instalar o hacer trabajos manuales; COOK = Cocinar o elaborar productos; TEACH = Enseñar, explicar o asesorar; CREATE = Diseñar, escribir o crear contenido; DRIVE = Conducir, transportar o hacer entregas; OTHER = Otra habilidad; UNSURE = Todavía no lo tengo claro') }),
  q('a_quien_ofrecer', 'multi', '¿A quién podrías ofrecerle un producto o servicio?', 'Puedes nombrar varios.', { config: { exclusive: ['NOBODY', 'UNSURE'] }, options: opt('PAST_CLIENTS = Clientes que ya tuve; BUSINESS_CLIENTS = Clientes de mi negocio; FRIENDS = Amigos o familiares; BUSINESSES = Negocios que conozco; WORK = Contactos de trabajo; FOLLOWERS = Personas que me siguen en redes; OTHER = Otro grupo; NOBODY = No tengo a quién ofrecerle; UNSURE = No lo tengo claro') }),
  q('habitos', 'multi', '¿Cuáles de estos hábitos tienes con tu dinero?', 'Sé honesto: nadie más lo ve. Puedes nombrar varios.', { config: { exclusive: ['NINGUNO'] }, options: opt('ANOTA = Anoto mis gastos; APARTA = Aparto dinero apenas cobro; COMPARA = Comparo precios antes de comprar; IMPULSO = Compro por impulso; MINIMO = Pago solo el mínimo de mis deudas; PRESTA = Presto dinero que me cuesta recuperar; PIDE = Pido prestado para llegar a fin de mes; NINGUNO = Ninguno de estos') }),
  q('perfil_riesgo', 'single', '¿Qué frase te describe mejor cuando piensas en hacer crecer tu dinero?', null, { options: opt('A = Prefiero cuidarlo aunque crezca despacio; B = Acepto altibajos moderados para que crezca más; C = Tolero pérdidas temporales si puede crecer mucho; D = Asumo riesgos de negocio, pero no quiero especular') }),
  q('reaccion_perdida', 'single', 'La última vez que perdiste dinero, ¿cómo reaccionaste?', 'Una venta que salió mal, una estafa, un negocio o una inversión.', { options: opt('NUNCA = No he tenido una pérdida importante; CALMA = Mantuve la calma y aprendí; VENDI = Me asusté y salí rápido; DOBLE = Arriesgué más para recuperar; EVITO = Desde entonces evito cualquier riesgo') }),
  q('objetivo_ingreso', 'money', '¿Cuánto te gustaría ganar al mes?', 'Una cifra que puedas imaginar, aunque hoy parezca lejana.', { allowUnknown: true }),
  q('objetivo_patrimonio', 'money', '¿Cuánto patrimonio te gustaría tener?', 'Lo que valdrían tus ahorros y bienes, menos tus deudas.', { allowUnknown: true }),
  q('objetivo_plazo', 'single', '¿En cuánto tiempo te gustaría lograrlo?', null, { options: opt('1 = 1 año; 3 = 3 años; 5 = 5 años; 10 = 10 años') }),
  q('motivacion', 'single', '¿Para qué quieres lograrlo?', 'Lo que más pesa para ti.', { options: opt('LIBERTAD = Libertad; SEGURIDAD = Seguridad; FAMILIA = Mi familia; INDEPENDENCIA = Independencia; IMPACTO = Ayudar a otros; JUBILACION = Mi retiro; LEGADO = Dejar un legado') }),
];

const DEEP_V3 = { title: 'Evaluación profunda', notes: 'Versión 3: agrega el perfil para el Plan Maestro completo.', questions: [...DEEP_V2.questions, ...NUEVAS] };

module.exports = { DEEP_V3 };
