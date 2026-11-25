'use strict';
// Resumen «Mi contexto financiero actual»: lo que se entendió de la evaluación, para revisarlo antes del
// diagnóstico. Solo resume respuestas ya dadas; lo desconocido se dice y no se rellena.
const db = require('../db');
const money = require('../lib/money');
const calc = require('./calc');
const qs = require('./questionnaire');
const deep = require('./deep');
const cat4 = require('./free/catalog4');
const maestro = require('./maestro');

const { D } = money;
const ZERO = new D(0);
const TEST = 'FREE_24_V4_ES';

/** Solo la evaluación con perfil completo (v3 en adelante) muestra el resumen. */
const applies = (qn) => qn.questions.some((q) => q.code === 'motivacion');

/** País y edad, si los dijo en el test gratuito. */
function personal(userId) {
  const s = db.one(`SELECT id FROM ft_sessions WHERE user_id = ? AND version_id = '${TEST}' AND completed_revision IS NOT NULL ORDER BY completed_at DESC LIMIT 1`, userId);
  if (!s) return [];
  const get = (slot) => {
    const r = db.one("SELECT value_json FROM ft_answers WHERE session_id = ? AND slot_id = ? AND active = 1 AND response_status = 'answered'", s.id, slot);
    return r ? db.parse(r.value_json, null) : null;
  };
  const label = (list, code) => ((list || []).find((o) => o.code === code) || {}).label;
  const q1 = get('Q01');
  const q2 = get('Q02');
  const country = q1 && label(cat4.OPTIONS.COUNTRIES, q1.country);
  const age = q2 && q2.codes && label(cat4.VARIANT_BY_ID.V4_Q02.options, q2.codes[0]);
  return [country && ['País', country], age && ['Edad', age]].filter(Boolean);
}

/** → { groups: [{ title, rows: [[k, v, posición|null]] }], notes: [texto] } */
function build(userId, qn, map, currency) {
  const f = deep.figures(map);
  const p = maestro.profile(map);
  const byCode = Object.fromEntries(qn.questions.map((q) => [q.code, q]));
  const fmt = (x) => (x === null || x === undefined ? 'Sin dato' : money.format(new D(x).toFixed(2), currency));
  const row = (k, code) => {
    const q = byCode[code];
    const a = map[code];
    if (!q || !a || !qs.isApplicable(q, map)) return null;
    return [k, a.unknown ? 'No lo sé' : qs.display(q, a, currency), q.position];
  };
  const at = (code) => (byCode[code] ? byCode[code].position : null);
  const liquid = (f.savingsAvailable || ZERO).plus(f.savingsLocked || ZERO);
  const assets = p.assets ? Object.values(p.assets).reduce((a, x) => a.plus(x), ZERO) : null;
  const debt = money.sum(f.debts.map((d) => d.balance));
  const outflow = f.expenses === null ? null : f.expenses.plus(f.debtPayments);
  const reserve = calc.reserveMonths(f.savingsAvailable, outflow);
  const groups = [
    { title: 'Tú', rows: [...personal(userId).map(([k, v]) => [k, v, null]), row('Actividad', 'actividad'), row('Personas a tu cargo', 'dependientes'), row('Tiempo a la semana', 'horas_semana'), row('Lo que se te da mejor', 'habilidades'), row('A quién ofrecerle', 'a_quien_ofrecer'), row('Hábitos', 'habitos')] },
    {
      title: 'Tu mes',
      rows: [
        ['Ingresos', fmt(f.income), at('ingreso_principal')],
        ['Gastos', fmt(f.expenses), at('gastos_desglose')],
        ['Cuotas de deuda', fmt(f.debtPayments), at('deudas')],
        ['Te queda al mes', fmt(f.balance), null],
      ],
    },
    {
      title: 'Lo que tienes y lo que debes',
      rows: [
        ['Ahorros', fmt(liquid), at('ahorro_disponible')],
        ['Meses que cubre tu ahorro disponible', reserve === null || reserve === undefined ? 'Sin dato' : String(Number(new D(reserve).toFixed(1))).replace('.', ','), null],
        ['Bienes', fmt(assets), at('activos')],
        row('Deudas', 'deudas'),
        ['Patrimonio neto', assets === null ? 'Sin dato: no sabemos el valor de tus bienes' : fmt(liquid.plus(assets).minus(debt)), null],
        row('Capital para invertir', 'capital_invertir'),
      ],
    },
    { title: 'Tu negocio', rows: [row('Situación', 'negocio_situacion'), row('Ventas al mes', 'negocio_ventas'), row('Ganancia al mes', 'negocio_ganancia'), row('Clientes al mes', 'negocio_clientes'), row('¿Vuelven?', 'negocio_recurrencia'), row('Quién trabaja', 'negocio_equipo'), row('Principal problema', 'negocio_problema')] },
    { title: 'Riesgo y objetivo', rows: [row('Cómo ves el riesgo', 'perfil_riesgo'), row('Ante una pérdida', 'reaccion_perdida'), row('Quieres ganar al mes', 'objetivo_ingreso'), row('Patrimonio que quieres', 'objetivo_patrimonio'), row('En cuánto tiempo', 'objetivo_plazo'), row('Para qué', 'motivacion')] },
  ].map((g) => ({ ...g, rows: g.rows.filter(Boolean) }));
  const notes = [];
  if (p.capital !== null && new D(p.capital).gt(liquid)) notes.push('El capital para invertir es mayor que tus ahorros. Revisa cuál de las dos cifras es la correcta.');
  if (p.biz && p.biz.sales !== null && p.biz.profit !== null && new D(p.biz.profit).gt(p.biz.sales)) notes.push('La ganancia de tu negocio es mayor que sus ventas. Revisa esas cifras.');
  return { groups: groups.filter((g) => g.rows.length), notes };
}

module.exports = { applies, build };
