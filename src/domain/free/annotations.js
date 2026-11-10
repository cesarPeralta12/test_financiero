'use strict';
// Anotaciones breves del catálogo ANN_V1_ES: textos fijos con condiciones evaluadas
// sin IA. Solo se evalúan al guardar Q06, Q11, Q15, Q21 y Q24; máximo un mensaje por
// punto y tres por sesión (aunque se retiren). Una regla nunca consulta respuestas
// de preguntas posteriores al punto de evaluación.
const { DEBT_VARIANTS } = require('./catalog');

const EVAL_POINTS = ['Q06', 'Q11', 'Q15', 'Q21', 'Q24'];
const MAX_PER_SESSION = 3;

const inList = (v, list) => v !== null && list.includes(v);
const exactSet = (list, expected) => Array.isArray(list) && list.length === expected.length && expected.every((e) => list.includes(e));
const DEPENDENTS = ['D1', 'D2', 'D3', 'D4PLUS'];

// id, puntos de evaluación, prioridad, grupo, condición, texto.
const RULES = [
  { id: 'A01', slots: ['Q06'], priority: 100, group: 'basic_expenses', cond: (c) => c.code('Q02') === 'SHORTFALL', text: 'Cubrir tus gastos básicos será una prioridad en tu orientación inicial.' },
  { id: 'A02', slots: ['Q06'], priority: 90, group: 'income', cond: (c) => c.route === 'N' || c.code('Q04') === 'ZERO', text: 'Tu orientación tendrá en cuenta que ahora no estás recibiendo ingresos personales.' },
  {
    id: 'A03', slots: ['Q06'], priority: 80, group: 'income',
    cond: (c) => {
      const q4 = c.code('Q04');
      return (c.route === 'E' && inList(q4, ['AT_RISK', 'TEMPORARY'])) || (c.route === 'O' && q4 === 'AT_RISK') || (['I', 'B', 'M', 'U'].includes(c.route) && inList(q4, ['VARIABLE', 'SPORADIC']));
    },
    text: 'La incertidumbre de tus ingresos será un punto a considerar al organizar tus finanzas.',
  },
  {
    id: 'A04', slots: ['Q06', 'Q15'], priority: 90, group: 'separation',
    cond: (c) => (c.route === 'B' && c.code('Q05') === 'NO_SEPARATION') || (['B', 'M'].includes(c.route) && c.code('Q12') === 'MIXED'),
    text: 'Separar el dinero personal del de tus actividades te ayudará a ver cuánto te queda realmente.',
  },
  { id: 'A05', slots: ['Q06'], priority: 60, group: 'saving', cond: (c) => c.variantId('Q06') === 'Q06_REGULAR' && c.code('Q06') === 'ZERO', text: 'Identificar qué te impide ahorrar será parte de tu orientación inicial.' },
  {
    id: 'A06', slots: ['Q11'], priority: 95, group: 'debt_inventory',
    cond: (c) => c.code('Q09') === 'YES' && ['unknown', 'declined'].includes(c.status('Q10')),
    text: 'Conocer tus deudas será uno de los primeros pasos para organizar tus finanzas.',
  },
  {
    id: 'A07', slots: ['Q11'], priority: 100, group: 'debt_payment',
    cond: (c) => (c.variantId('Q11') === 'Q11_CARD' && c.code('Q11') === 'LATE') || (DEBT_VARIANTS.filter((x) => x !== 'Q11_CARD').includes(c.variantId('Q11')) && inList(c.code('Q11'), ['OCCASIONAL_DELAY', 'OVERDUE', 'UNABLE'])),
    text: 'Revisar los pagos que te están costando cubrir será una prioridad de tu orientación.',
  },
  { id: 'A08', slots: ['Q11'], priority: 90, group: 'debt_payment', cond: (c) => c.variantId('Q11') === 'Q11_CARD' && c.code('Q11') === 'MINIMUM', text: 'Revisar cómo estás pagando tus tarjetas será parte de tu orientación inicial.' },
  { id: 'A09', slots: ['Q11'], priority: 85, group: 'reserve', cond: (c) => inList(c.code('Q08'), ['ZERO', 'LT1M']), text: 'Tu reserva disponible es limitada; la tendremos en cuenta al definir los primeros pasos.' },
  { id: 'A10', slots: ['Q11'], priority: 45, group: 'opportunity', cond: (c) => c.code('Q07') === 'CLEAR', text: 'Esa oportunidad concreta puede servir como punto de partida para trabajar tus ingresos.' },
  {
    id: 'A11', slots: ['Q11'], priority: 40, group: 'family_debt',
    cond: (c) => c.code('Q09') === 'YES' && c.variantId('Q10') === 'Q10_TYPES' && exactSet(c.list('Q10'), ['INFORMAL']),
    text: 'El dinero que debes a familiares u otras personas también forma parte de tus deudas personales.',
  },
  { id: 'A12', slots: ['Q15'], priority: 85, group: 'protection', cond: (c) => inList(c.code('Q14'), DEPENDENTS) && exactSet(c.list('Q15'), ['NONE']), text: 'Tendremos en cuenta que otras personas dependen de tus recursos y que hoy no identificas un respaldo.' },
  { id: 'A13', slots: ['Q15'], priority: 80, group: 'protection', cond: (c) => c.code('Q14') === 'D0' && exactSet(c.list('Q15'), ['NONE']), text: 'Contar con un respaldo ante imprevistos será un punto a trabajar en tu orientación.' },
  { id: 'A14', slots: ['Q21'], priority: 65, group: 'experience', cond: (c) => c.code('Q19') === 'LOSS', text: 'Tu experiencia con pérdidas será parte del contexto al definir los próximos pasos.' },
  { id: 'A15', slots: ['Q21'], priority: 60, group: 'learning', cond: (c) => c.code('Q21') === 'LEARN_FIRST', text: 'Entender mejor las opciones antes de decidir será parte de tu orientación.' },
  { id: 'A16', slots: ['Q21'], priority: 30, group: 'goal', cond: (c) => c.value('Q18') && c.value('Q18').kind === 'AMOUNT' && c.status('Q18') === 'answered', text: 'Ya definiste una referencia mensual para la vida que quieres sostener.' },
  { id: 'A17', slots: ['Q24'], priority: 90, group: 'action_capacity', cond: (c) => c.code('Q22') === 'H0', text: 'Los primeros pasos tendrán que ajustarse al tiempo que realmente tienes disponible.' },
  { id: 'A18', slots: ['Q24'], priority: 85, group: 'action_capacity', cond: (c) => c.value('Q23') && c.value('Q23').kind === 'CHOICE' && c.value('Q23').code === 'ZERO', text: 'Las primeras acciones deberán poder hacerse sin presupuesto adicional.' },
  { id: 'A19', slots: ['Q24'], priority: 70, group: 'action_capacity', cond: (c) => exactSet(c.list('Q24'), ['NONE']), text: 'Identificar habilidades o recursos aprovechables será uno de tus primeros pasos.' },
  {
    id: 'A20', slots: ['Q24'], priority: 40, group: 'opportunity',
    cond: (c) => {
      const skills = c.list('Q24');
      return Array.isArray(skills) && skills.some((s) => s !== 'NONE') && inList(c.code('Q22'), ['HLT1', 'H1_3', 'H4_7', 'H8_14', 'H15PLUS']);
    },
    text: 'Ya identificaste habilidades o recursos y algo de tiempo para empezar a trabajar en tu objetivo.',
  },
];

const RULE_BY_ID = Object.fromEntries(RULES.map((r) => [r.id, r]));

/** Candidatas para un punto, ya filtradas y ordenadas (prioridad desc, rule_id asc). */
function candidates(ctx, point, { emittedRules = new Set(), emittedGroups = new Set() } = {}) {
  return RULES.filter((r) => r.slots.includes(point) && !emittedRules.has(r.id) && !emittedGroups.has(r.group) && r.cond(ctx)).sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id)
  );
}

module.exports = { RULES, RULE_BY_ID, EVAL_POINTS, MAX_PER_SESSION, candidates };
