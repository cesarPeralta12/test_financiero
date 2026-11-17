'use strict';
/**
 * Consejos del resultado gratuito V4: tabla de reglas («planilla»).
 *
 * Cada fila dice: si se cumple la condición (calculada por el backend con las respuestas),
 * se muestra este consejo. No interviene la IA: el mismo caso da siempre el mismo consejo,
 * y cada consejo lleva el id de su regla para saber de dónde salió.
 *
 * Para cambiar un texto o un umbral basta con editar la fila. Las reglas se revisan en orden
 * (la prioridad la da su posición) y se muestran como máximo MAX_TIPS.
 *
 * Variables disponibles en los textos: las cifras ya formateadas en `v` (ver `vars`).
 */
const D = require('decimal.js');
const catalog = require('./catalog4');

const MAX_TIPS = 3;
// Umbrales en un solo lugar para poder ajustarlos.
const T = {
  DEBT_HEAVY: 0.3, // cuotas ≥ 30 % del ingreso
  OTHER_HIGH: 0.25, // otros gastos ≥ 25 % del ingreso
  SAVE_SHARE: 0.2, // separar el 20 % de lo que queda al mes
  RESERVE_GOAL: 3, // meses de respaldo a los que apuntar
};

const RULES = [
  {
    id: 'R01', area: 'Deudas',
    when: (x) => x.late,
    do: () => 'Llama esta semana a quien le debes y pide un plan de pagos antes del próximo vencimiento.',
    why: () => 'Cada atraso suma cargos e intereses; un acuerdo los detiene.',
  },
  {
    id: 'R02', area: 'Gastos',
    when: (x) => x.bal !== null && x.bal.lt(0),
    do: (v) => `Recorta ${v.faltante} al mes para dejar de cerrar en rojo.`,
    why: (v, x) => (x.other && x.other.gt(0) ? `Empieza por tus otros gastos (${v.otros} al mes): elige dos que puedas bajar este mes.` : 'Revisa tus gastos fijos y los vencimientos para ver qué se puede mover.'),
  },
  {
    id: 'R03', area: 'Gastos',
    when: (x) => x.bal !== null && x.bal.isZero(),
    do: () => 'Libera aunque sea un pequeño monto al mes recortando un gasto que no sea esencial.',
    why: (v, x) => (x.other && x.other.gt(0) ? `Hoy todo lo que entra se gasta; tus otros gastos (${v.otros}) son el primer lugar donde buscar.` : 'Hoy todo lo que entra se gasta; sin margen, cualquier imprevisto se vuelve deuda.'),
  },
  {
    id: 'R04', area: 'Deudas',
    when: (x) => x.dues && x.income && x.income.gt(0) && x.dues.div(x.income).gte(T.DEBT_HEAVY),
    do: () => 'No tomes deudas nuevas y destina cualquier extra a la deuda más cara.',
    why: (v) => `Tus cuotas (${v.cuotas} al mes) se llevan una parte grande de tu ingreso.`,
  },
  {
    id: 'R13', area: 'Deudas',
    when: (x) => x.bal !== null && x.bal.lte(0) && !x.late,
    do: () => 'No uses tarjeta ni préstamos para cubrir lo que falta a fin de mes.',
    why: () => 'Cubrir un faltante con deuda lo hace más grande el mes siguiente.',
  },
  {
    id: 'R14', area: 'Protección',
    when: (x) => x.bal !== null && x.bal.lte(0) && (x.reserve === null || x.reserve.lt(1)) && x.miniFund,
    do: (v) => `Junta un primer fondo de ${v.mini_fondo} con lo que liberes al recortar gastos.`,
    why: () => 'Es una semana de tus gastos básicos: alcanza para un imprevisto pequeño sin pedir prestado.',
  },
  {
    id: 'R05', area: 'Ahorro',
    when: (x) => x.save && x.reserve !== null && x.reserve.lt(1),
    do: (v) => `Separa ${v.separar} cada mes apenas cobres, antes de gastar.`,
    why: (v) => `En 6 meses tendrías ${v.separar6} de respaldo para imprevistos.`,
  },
  {
    id: 'R06', area: 'Ahorro',
    when: (x) => x.save && x.reserve !== null && x.reserve.gte(1) && x.reserve.lt(T.RESERVE_GOAL) && x.reserveGoal,
    do: (v) => `Sigue separando ${v.separar} al mes hasta llegar a 3 meses de gastos (${v.meta_reserva}).`,
    why: () => 'Con 3 meses de respaldo puedes enfrentar un mes difícil sin endeudarte.',
  },
  {
    id: 'R07', area: 'Ingresos',
    when: (x) => ['HIGH', 'DECREASING'].includes(x.variability),
    do: () => 'Planifica tu mes con lo que ganas en un mes flojo y guarda la diferencia en los meses buenos.',
    why: () => 'Tu ingreso cambia de un mes a otro; así no te quedas corto cuando baja.',
  },
  {
    id: 'R08', area: 'Gastos',
    when: (x) => x.bal !== null && x.bal.gt(0) && x.other && x.income && x.income.gt(0) && x.other.div(x.income).gte(T.OTHER_HIGH),
    do: (v) => `Revisa tus otros gastos de ${v.otros}: bajarlos un 10 % te libera ${v.otros10} al mes.`,
    why: () => 'Son gastos que no son básicos; ahí suele estar el dinero más fácil de recuperar.',
  },
  {
    id: 'R09', area: 'Ahorro',
    when: (x) => x.save && x.reserve !== null && x.reserve.gte(T.RESERVE_GOAL),
    do: (v) => `Asigna un destino fijo a tus ${v.saldo} libres al mes: tu objetivo, no el gasto del día.`,
    why: () => 'Ya tienes respaldo; sin un destino claro, ese dinero se gasta sin notarlo.',
  },
  {
    id: 'R10', area: 'Datos',
    when: (x) => x.bal === null,
    do: () => 'Anota durante 7 días todo lo que gastas para conocer tus números reales.',
    why: () => 'Con los datos de este test no pudimos calcular cuánto te queda al mes.',
  },
  {
    id: 'R11', area: 'Ingresos',
    when: (x) => x.wantsIncome && x.hasTime && !x.minor && !x.late && !(x.bal !== null && x.bal.lt(0)),
    do: () => 'Escribe a 3 personas que podrían necesitar lo que sabes hacer y pregúntales qué les resolvería.',
    why: () => 'Antes de invertir tiempo o dinero, comprueba si alguien lo necesita.',
  },
  {
    id: 'R15', area: 'Gastos',
    when: (x) => x.bal !== null && x.bal.gt(0) && x.other && x.other.gt(0),
    do: (v) => `Ponle un tope de ${v.otros} a tus otros gastos y revísalo a fin de cada mes.`,
    why: () => 'Un tope fijo evita que lo que te queda se vaya en gastos pequeños sin notarlo.',
  },
  {
    id: 'R16', area: 'Protección',
    when: (x) => x.bal !== null && x.bal.gt(0) && x.reserve !== null && x.reserve.isZero() && !x.save,
    do: () => 'Abre una cuenta o un sobre aparte solo para emergencias y no lo mezcles con tu gasto diario.',
    why: () => 'Separar el dinero es el primer paso para que el respaldo no se gaste.',
  },
  {
    id: 'R12', area: 'Seguimiento',
    when: () => true,
    do: () => 'Vuelve a hacer este test en 30 días y compara tus cifras.',
    why: () => 'Medir cada mes es la forma más simple de saber si vas por buen camino.',
  },
];

const val = (answers, s) => (answers[s] && answers[s].status === 'answered' ? answers[s].value : null);
const codes = (answers, s) => (val(answers, s) ? val(answers, s).codes || [] : []);
const dec = (v) => (v === null || v === undefined ? null : new D(v));
/** Redondea hacia abajo a un monto «redondo» (10 o 100) para que el consejo sea fácil de seguir. */
function round(v) {
  const step = v.gte(1000) ? 100 : v.gte(50) ? 10 : 1;
  return v.div(step).floor().times(step);
}

/** Situación de la persona: todo lo calcula el backend a partir de sus respuestas y métricas. */
function situation(answers, metrics, currency) {
  const M = Object.fromEntries(metrics.map((m) => [m.id, m]));
  const bal = M.monthly_balance && M.monthly_balance.value !== null ? new D(M.monthly_balance.value) : null;
  const ops = (M.monthly_balance && M.monthly_balance.operands) || {};
  const reserve = M.committed_reserve_months && M.committed_reserve_months.value !== null ? new D(M.committed_reserve_months.value) : null;
  const pay = codes(answers, 'Q12')[0];
  const q10 = val(answers, 'Q10');
  const noDebt = codes(answers, 'Q11').includes('NONE') || Boolean(q10 && q10.status === 'NO');
  const dues = !noDebt && dec(ops.cuotas) && dec(ops.cuotas).gt(0) ? dec(ops.cuotas) : null;
  const save = bal !== null && bal.gt(0) ? round(bal.times(T.SAVE_SHARE)) : null;
  const base = dec(ops.basicos) !== null ? dec(ops.basicos).plus(dues || 0) : null;
  const goal = val(answers, 'Q05');
  const hours = codes(answers, 'Q16')[0];
  return {
    currency,
    bal,
    income: dec(ops.ingreso),
    other: dec(ops.otros),
    dues,
    reserve,
    late: pay === 'LATE' || pay === 'UNABLE',
    save: save && save.gt(0) ? save : null,
    miniFund: dec(ops.basicos) && dec(ops.basicos).gt(0) ? round(dec(ops.basicos).div(4)) : null,
    reserveGoal: base && base.gt(0) ? base.times(T.RESERVE_GOAL) : null,
    variability: codes(answers, 'Q07')[0],
    wantsIncome: Boolean(goal && ['INCOME', 'INDEPENDENCE', 'BUSINESS'].includes(goal.code)),
    hasTime: Boolean(hours && hours !== 'H0'),
    minor: codes(answers, 'Q02').includes('LT18'),
  };
}

function vars(x) {
  const cur = x.currency === 'BOB' ? 'Bs' : x.currency;
  const m = (v) => (v === null || v === undefined ? '' : `${cur} ${catalog.fmtNum(v.toFixed(2).replace(/\.00$/, ''))}`);
  return {
    saldo: m(x.bal),
    faltante: x.bal !== null && x.bal.lt(0) ? m(x.bal.abs()) : '',
    otros: m(x.other),
    otros10: x.other ? m(round(x.other.times(0.1))) : '',
    cuotas: m(x.dues),
    separar: m(x.save),
    separar6: x.save ? m(x.save.times(6)) : '',
    meta_reserva: m(x.reserveGoal),
    mini_fondo: m(x.miniFund),
  };
}

/**
 * Devuelve hasta MAX_TIPS consejos: { rule, area, action, why }.
 * El seguimiento (R12) solo entra si quedan lugares libres.
 */
function tips(answers, metrics, currency) {
  const x = situation(answers, metrics, currency);
  const v = vars(x);
  const out = [];
  for (const r of RULES) {
    if (out.length >= MAX_TIPS) break;
    if (!r.when(x)) continue;
    // Un consejo por área, salvo que no haya otros.
    if (out.some((t) => t.area === r.area) && r.id !== 'R12') continue;
    out.push({ rule: r.id, area: r.area, action: r.do(v, x), why: r.why(v, x) });
  }
  return out;
}

module.exports = { RULES, THRESHOLDS: T, MAX_TIPS, tips, situation };
