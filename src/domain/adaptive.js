'use strict';
/**
 * Evaluación adaptativa: qué preguntas NO hacen falta según lo que la persona ya respondió.
 * Son reglas fijas (sin IA): mismas respuestas, mismas preguntas. Una regla solo mira preguntas anteriores
 * y, ante la duda (dato desconocido), se pregunta.
 */
const money = require('../lib/money');

const { D } = money;

function context(map) {
  const v = (code) => {
    const a = map[code];
    return a && !a.unknown && !a.skipped ? a.value : null;
  };
  const amount = (code) => {
    const x = v(code);
    if (x === null || x === undefined) return null;
    return new D(typeof x === 'object' ? x.amount : x);
  };
  const zero = (code) => {
    const n = amount(code);
    return n !== null && n.lte(0);
  };
  const positive = (code) => {
    const n = amount(code);
    return n !== null && n.gt(0);
  };
  const figures = () => require('./deep').figures(map);
  const balance = () => figures().balance;
  const late = () => {
    const x = v('atraso_actual');
    return x !== null && x !== 'no';
  };
  const pressure = () => {
    const b = balance();
    return late() || (b !== null && b !== undefined && b.lte(0));
  };
  const total = (code) => (v(code) ? money.sum(Object.values(v(code))) : null);
  return { v, amount, zero, positive, balance, pressure, total };
}

const OWN = ['BUSINESS', 'INDEPENDENT', 'MULTIPLE', 'OTHER'];
const hasBusiness = (c) => ['EMPEZANDO', 'DEPENDE', 'SOLO'].includes(c.v('negocio_situacion'));
const noFlexible = (c) => {
  const g = c.v('gastos_desglose');
  return Boolean(g) && new D(g.ocio || 0).plus(g.otros || 0).lte(0);
};

// código → true si NO hace falta preguntarlo
const SKIP = {
  // «Neta o bruta» solo tiene sentido con un sueldo.
  ingreso_es_neto: (c) => c.v('actividad') !== null && !['EMPLOYEE', 'MULTIPLE'].includes(c.v('actividad')),
  caida_ingreso: (c) => c.v('actividad') === 'NONE' || c.zero('ingreso_principal'),
  negocio_situacion: (c) => c.v('actividad') !== null && !OWN.includes(c.v('actividad')),
  negocio_ganancia: (c) => c.zero('negocio_ventas'),
  negocio_recurrencia: (c) => c.v('negocio_clientes') === 'C0',
  negocio_equipo: (c) => c.v('negocio_situacion') === 'EMPEZANDO',
  // Sin ahorro ni costumbre de apartar, no hay ahorro bloqueado que preguntar.
  ahorro_no_disponible: (c) => c.zero('ahorro_disponible') && c.zero('ahorro_mensual'),
  respaldo_ingreso: (c) => c.v('dependientes') === 0,
  gasto_reducible: noFlexible,
  ajuste_gasto: noFlexible,
  bienes_vendibles: (c) => (c.total('activos') !== null && c.total('activos').lte(0)) || (!c.pressure() && !(c.v('deudas') || []).length),
  ingreso_extra_posible: (c) => c.v('horas_semana') === 'H0' || !c.pressure(),
  a_quien_ofrecer: (c) => c.v('horas_semana') === 'H0' || hasBusiness(c),
  prioridad: (c) => Array.isArray(c.v('deudas')) && !c.v('deudas').length && Array.isArray(c.v('metas')) && !c.v('metas').length,
  // Con el mes en rojo o pagos atrasados, primero se ordena: no se habla de invertir.
  capital_invertir: (c) => c.pressure() || c.zero('ahorro_disponible'),
  perfil_riesgo: (c) => c.pressure(),
  reaccion_perdida: (c) => {
    const inv = c.v('activos') ? new D(c.v('activos').inversiones || 0) : new D(0);
    return c.pressure() || !(c.positive('capital_invertir') || inv.gt(0) || hasBusiness(c));
  },
  objetivo_patrimonio: (c) => c.pressure(),
  objetivo_plazo: (c) => c.asked && c.amount('objetivo_ingreso') === null && c.amount('objetivo_patrimonio') === null,
};

function skip(code, map) {
  const rule = SKIP[code];
  if (!rule) return false;
  const c = context(map);
  c.asked = Boolean(map.objetivo_ingreso);
  return rule(c);
}

/** Comentario corto al empezar un tema, con las cifras de la persona. */
function comment(code, map, currency) {
  const c = context(map);
  const f = (x) => money.format(x.toFixed(2), currency);
  if (code === 'negocio_ventas') return 'Cuéntame un poco de tu negocio.';
  if (code === 'objetivo_ingreso') return c.pressure() ? 'Primero ordenaremos tu mes, pero también quiero saber a dónde vas.' : 'Ahora imaginemos tu futuro.';
  return null;
}

/** Montos sugeridos como botones, a partir de sus cifras. Siempre se puede escribir otro. */
function suggestions(code, map) {
  const round = (x, n) => Math.max(n, Math.round(Number(x) / n) * n);
  const f = require('./deep').figures(map);
  const base = code === 'objetivo_ingreso' ? f.income : code === 'objetivo_patrimonio' && f.expenses !== null ? f.expenses.plus(f.debtPayments) : null;
  if (!base || base.lte(0)) return [];
  const unit = Number(base) >= 1000 ? 100 : 10;
  const list = code === 'objetivo_ingreso' ? [1.25, 1.5, 2].map((k) => round(Number(base) * k, unit)) : [12, 36, 60].map((k) => round(Number(base) * k, unit * 10));
  return [...new Set(list)].map(String);
}

// Temas de la conversación: al pasar de uno a otro hay un respiro con un aviso y un consejo.
const THEMES = [
  ['entra', ['moneda_base', 'actividad', 'ingreso_principal', 'ingreso_es_neto', 'ingresos_adicionales', 'caida_ingreso', 'negocio_situacion', 'negocio_ventas', 'negocio_ganancia', 'negocio_clientes', 'negocio_recurrencia', 'negocio_equipo', 'negocio_problema']],
  ['sale', ['gastos_desglose', 'gastos_anuales', 'deudas', 'atraso_actual', 'pago_tarjeta']],
  ['tienes', ['ahorro_mensual', 'ahorro_disponible', 'ahorro_no_disponible', 'capital_invertir', 'activos', 'bienes_vendibles']],
  ['proteges', ['dependientes', 'cobertura_salud', 'respaldo_ingreso', 'gastos_previstos', 'gasto_reducible', 'ajuste_gasto', 'habitos']],
  ['puedes', ['horas_semana', 'habilidades', 'a_quien_ofrecer', 'ingreso_extra_posible']],
  ['quieres', ['metas', 'prioridad', 'perfil_riesgo', 'reaccion_perdida', 'objetivo_ingreso', 'objetivo_patrimonio', 'objetivo_plazo', 'motivacion']],
];
const themeOf = (code) => THEMES.findIndex(([, codes]) => codes.includes(code));

/** Respiro antes de un tema nuevo: { id, text, help } o null. No es una pregunta; se sigue con «Seguir». */
function pause(code, map, currency) {
  const i = themeOf(code);
  if (i < 1) return null;
  const answered = (x) => map[x] && !map[x].skipped;
  // Solo al entrar al tema y si se conversó en el anterior (lo ya sabido no cuenta).
  if (THEMES[i][1].some((x) => answered(x) && !map[x].known)) return null;
  if (!THEMES[i - 1][1].some((x) => answered(x) && !map[x].known)) return null;
  const c = context(map);
  const f = (x) => money.format(x.toFixed(2), currency);
  const debts = c.v('deudas') || [];
  const late = c.v('atraso_actual') !== null && c.v('atraso_actual') !== 'no';
  const b = c.balance();
  const out = {
    sale: () => [
      '✅ Listo, ya sé cómo entra tu dinero.',
      c.positive('caida_ingreso') ? 'Consejo: como tu ingreso cambia, arma tu mes con el más bajo. Lo que llegue de más será un alivio.' : 'Consejo: aparta algo el mismo día que cobras, aunque sea poco. Es más fácil que guardar lo que sobra.',
      'Respira. Ahora veremos en qué se va; un aproximado está bien.',
    ],
    tienes: () => [
      !b ? '✅ Terminamos con tus gastos y deudas.' : b.gt(0) ? `✅ Ya conozco tu mes: después de gastos y cuotas te quedan ${f(b)}.` : b.lt(0) ? `✅ Ya conozco tu mes: hoy faltan ${f(b.abs())}. Le pasa a mucha gente y se puede ordenar.` : '✅ Ya conozco tu mes: hoy todo lo que entra se va.',
      late ? 'Consejo: llama a quien le debes antes de que te llame y pide un acuerdo por escrito.' : c.v('pago_tarjeta') === 'minimo' ? 'Consejo: paga siempre algo más que el mínimo. Así la deuda sí empieza a bajar.' : debts.some((d) => d.rate === null) ? 'Consejo: busca el interés en tu estado de cuenta. Con ese dato sabrás cuánto te cuesta de verdad tu deuda.' : debts.length ? 'Consejo: anota el día de pago de cada cuota para no pagar recargos.' : 'Consejo: no tener deudas es una ventaja. Ahora ese espacio puede ir a tu reserva.',
      'Tómate un momento: lo más pesado ya pasó.',
    ],
    proteges: () => [
      '✅ Muy bien, ya sé con qué cuentas.',
      c.zero('ahorro_disponible') ? 'Consejo: tu primera meta puede ser pequeña: guardar lo de una semana de gastos.' : 'Consejo: guarda tu reserva en una cuenta aparte. Lo que no se ve, se gasta menos.',
      'Vas muy bien. Ahora veamos qué tan protegido estás.',
    ],
    puedes: () => [
      '✅ Terminamos con tu protección y tus hábitos.',
      (c.v('habitos') || []).includes('IMPULSO') ? 'Consejo: antes de una compra que no tenías planeada, espera 48 horas.' : 'Consejo: anota tus gastos durante una semana. Casi siempre aparece una fuga que no esperabas.',
      'Estira un poco la espalda. Ahora viene lo bueno: cómo podrías ganar más.',
    ],
    quieres: () => [
      '✅ Excelente, ya sé qué sabes hacer.',
      c.v('horas_semana') === 'H0' ? 'Consejo: no necesitas mucho tiempo; empieza por liberar dos horas a la semana.' : 'Consejo: antes de gastar en una idea, comprueba que alguien te pagaría por ella.',
      'Última parte: hablemos de lo que quieres lograr.',
    ],
  }[THEMES[i][0]]();
  return { id: THEMES[i][0], text: out[0], help: `${out[1]} ${out[2]}` };
}

const DONE = '🎉 ¡Terminaste! Ya tengo todo lo que necesito. Respira: lo más difícil ya está hecho. Ahora revisa que tus datos estén bien y prepararé tu diagnóstico.';

module.exports = { skip, comment, suggestions, pause, DONE };
