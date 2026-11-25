'use strict';
/**
 * Plan Maestro completo: los 14 puntos de la oferta (PM01 a PM14), calculados con reglas a partir del
 * diagnóstico y del perfil. No interviene la IA: mismos datos, mismo plan. No promete ingresos ni
 * recomienda productos financieros; lo que no se sabe se dice y no se rellena con cifras.
 *
 * Cada punto es { id, title, intro, blocks } con bloques genéricos que pintan la pantalla y el PDF:
 *   figures [{k, v}] · list [texto] · table {head, rows} · cards [{title, tag, lines:[[k, v]]}] · text
 */
const money = require('../../lib/money');
const calc = require('../calc');
const { IDEAS } = require('./ideas');

const { D } = money;
const ZERO = new D(0);
const dec = (v) => (v === null || v === undefined || v === '' ? null : new D(v));
const RULES_VERSION = 'PLAN_MAESTRO_V1_ES';

const SKILL = { SELL: 'vender y atender clientes', ORGANIZE: 'organizar', DIGITAL: 'herramientas digitales', MANUAL: 'trabajos manuales', COOK: 'cocinar o elaborar productos', TEACH: 'enseñar', CREATE: 'diseñar o crear contenido', DRIVE: 'conducir y entregar', OTHER: 'otra habilidad' };
const ASSET = { inmuebles: 'Casa o departamento', terrenos: 'Terrenos', vehiculos: 'Auto o moto', inversiones: 'Inversiones', negocio: 'Tu parte de un negocio', equipos: 'Equipos y mercadería', otros: 'Otros bienes' };
const HOURS = { H0: 0, H_LT3: 2, H3_7: 5, H8_14: 10, H15_25: 20, H26_40: 32, H41: 45 };
const RISK = { A: 'Prefieres cuidar lo que tienes aunque crezca despacio', B: 'Aceptas altibajos moderados para crecer más', C: 'Toleras pérdidas temporales si puede crecer mucho', D: 'Asumes riesgos de negocio, pero no quieres especular' };
const MOTIVE = { LIBERTAD: 'libertad', SEGURIDAD: 'seguridad', FAMILIA: 'tu familia', INDEPENDENCIA: 'independencia', IMPACTO: 'ayudar a otros', JUBILACION: 'tu retiro', LEGADO: 'dejar un legado' };
const GOOD = { ANOTA: 'anotas tus gastos', APARTA: 'apartas dinero apenas cobras', COMPARA: 'comparas precios antes de comprar' };
const BAD = { IMPULSO: 'compras por impulso', MINIMO: 'pagas solo el mínimo', PRESTA: 'prestas dinero que te cuesta recuperar', PIDE: 'pides prestado para llegar a fin de mes' };
const ACT = { EMPLOYEE: 'Empleado', INDEPENDENT: 'Por cuenta propia', BUSINESS: 'Con negocio', MULTIPLE: 'Varias actividades', NONE: 'Sin trabajo actual', OTHER: 'Otra situación' };

/** Perfil a partir de las respuestas de la evaluación (map = respuestas por código). */
function profile(map) {
  const v = (c) => (map[c] && !map[c].unknown && !map[c].skipped ? map[c].value : null);
  const arr = (c) => (Array.isArray(v(c)) ? v(c) : []);
  return {
    activity: v('actividad'),
    business: v('negocio_situacion'),
    biz: v('negocio_situacion') && v('negocio_situacion') !== 'NO' ? { sales: v('negocio_ventas'), profit: v('negocio_ganancia'), clients: v('negocio_clientes'), repeat: v('negocio_recurrencia'), team: v('negocio_equipo'), problem: v('negocio_problema') } : null,
    capital: v('capital_invertir'),
    assets: v('activos'),
    hours: v('horas_semana'),
    skills: arr('habilidades').filter((x) => x !== 'UNSURE'),
    audience: arr('a_quien_ofrecer').filter((x) => !['NOBODY', 'UNSURE'].includes(x)),
    habits: arr('habitos').filter((x) => x !== 'NINGUNO'),
    risk: v('perfil_riesgo'),
    loss: v('reaccion_perdida'),
    targetIncome: v('objetivo_ingreso'),
    targetWealth: v('objetivo_patrimonio'),
    years: v('objetivo_plazo') ? Number(v('objetivo_plazo')) : null,
    motive: v('motivacion'),
  };
}

const CLIENTS = { C0: 'Todavía ninguno', C1_9: 'Menos de 10', C10_30: 'De 10 a 30', C31: 'Más de 30' };
const REPEAT = { NO: 'Casi nunca vuelven', ALGUNOS: 'Algunos vuelven', MUCHOS: 'La mayoría vuelve', PLAN: 'Te pagan cada mes', NUEVO: 'Todavía no tienes clientes' };
const TEAM = { SOLO: 'Solo tú', FAMILIA: 'Tú y tu familia', EQUIPO: 'Personas a tu cargo' };
// Problema del negocio → [cómo se nombra, meta de 90 días, indicador]
const PROBLEM = {
  CLIENTES: ['faltan clientes', 'Hablar cada semana con diez posibles clientes y pedir una recomendación a quienes ya te compraron', 'Personas contactadas y ventas nuevas'],
  MARGEN: ['queda poca ganancia', 'Calcular cuánto te queda por cada producto y dejar o subir de precio lo que no conviene', 'Ganancia por cada venta'],
  TIEMPO: ['no alcanza el tiempo', 'Escribir una tarea repetida y enseñársela a otra persona o simplificarla', 'Horas liberadas por semana'],
  COBROS: ['te pagan tarde', 'Pedir un adelanto y fijar por escrito el día de pago', 'Dinero por cobrar al cierre de cada mes'],
  ORDEN: ['falta orden en las cuentas', 'Separar el dinero del negocio del tuyo y anotar cada venta y gasto', 'Días del mes con todo anotado'],
  CAPITAL: ['falta dinero para crecer', 'Crecer con adelantos de clientes y reinvirtiendo una parte de la ganancia, antes de pedir prestado', 'Ganancia reinvertida cada mes'],
};

function build(diag, content, rules) {
  const p = diag.profile || {};
  const cur = diag.currency;
  const f = (x) => (x === null || x === undefined ? 'Sin dato' : money.format(new D(x).toFixed(2), cur));
  const months = (n) => (n === null || n === undefined ? 'sin plazo con el aporte actual' : n <= 0 ? 'ya lo tienes' : n < 24 ? `${n} ${n === 1 ? 'mes' : 'meses'}` : `${(n / 12).toFixed(1).replace('.0', '').replace('.', ',')} años`);
  const skills = p.skills || [];
  const habits = p.habits || [];
  const missing = [];
  const need = (cond, text) => cond && missing.push(text);

  // ───────── Cifras de base ─────────
  const income = dec(diag.income.total);
  const expenses = dec(diag.expenses.total);
  const debtPay = dec(diag.debtPayments) || ZERO;
  const outflow = expenses === null ? null : expenses.plus(debtPay);
  const balance = dec(diag.balance);
  const debt = dec(diag.debtTotal) || ZERO;
  const liquid = (dec(diag.reserve.available) || ZERO).plus(dec(diag.reserve.locked) || ZERO);
  const assetRows = p.assets ? Object.entries(p.assets).filter(([, x]) => new D(x).gt(0)) : [];
  const assetsKnown = Boolean(p.assets);
  const assets = assetRows.reduce((a, [, x]) => a.plus(x), ZERO).plus(liquid);
  const net = assetsKnown ? assets.minus(debt) : null;
  const alloc = content.presupuesto.alloc;
  const monthlySave = new D(alloc.reserva).plus(alloc.metas);
  const extraDebt = new D(alloc.deuda);
  const available = new D(content.presupuesto.available);
  const target = dec(p.targetIncome);
  const wealth = dec(p.targetWealth);
  const years = p.years || null;
  const hours = p.hours ? HOURS[p.hours] ?? null : null;
  const tight = balance !== null && balance.lte(0);
  const late = diag.risks.some((r) => r.code === 'atraso');
  const reserveMonths = diag.reserve.months === null ? null : Number(diag.reserve.months);
  const capital = dec(p.capital);
  // Tope para probar ideas: 10 % de lo disponible; nunca más que el capital declarado ni con pagos atrasados.
  const trialBase = available.gt(0) && !late ? available.times('0.1').floor() : ZERO;
  const trial = capital !== null ? D.min(trialBase, capital) : trialBase;
  const capitalFree = capital !== null && capital.gt(0) && !tight && !late;
  const capitalTest = capitalFree ? capital.times('0.1').floor() : ZERO;
  const reserveShort = reserveMonths !== null && reserveMonths < rules.reserva_meses.recomendada;
  const biz = p.biz || null;
  const sales = biz ? dec(biz.sales) : null;
  const profit = biz ? dec(biz.profit) : null;
  const margin = sales && sales.gt(0) && profit !== null && profit.lte(sales) ? profit.div(sales).times(100).toDecimalPlaces(0) : null;
  const problem = biz && PROBLEM[biz.problem] ? PROBLEM[biz.problem] : null;

  need(!p.activity, 'Tu actividad principal.');
  need(!assetsKnown, 'Tus bienes: sin ellos no calculamos tu patrimonio neto.');
  need(hours === null, 'Cuántas horas a la semana puedes dedicar.');
  need(!skills.length, 'Tus habilidades: sin ellas las ideas de ingreso son pocas.');
  need(!p.risk, 'Tu perfil de riesgo.');
  need(biz && sales === null, 'Cuánto vende tu negocio al mes.');
  need(biz && profit === null, 'Cuánto te queda de ganancia en tu negocio.');
  need(diag.debts.some((d) => d.rate === null), 'El interés de alguna de tus deudas.');
  need(capital === null, 'Cuánto capital podrías invertir.');
  need(!target, 'Cuánto quieres ganar al mes.');
  need(!wealth, 'Cuánto patrimonio quieres alcanzar.');
  need(!years, 'En cuántos años quieres lograrlo.');

  // ───────── Oportunidades ─────────
  const scored = IDEAS.filter((i) => (i.skill ? skills.includes(i.skill) : (i.para || []).includes(p.activity)))
    .map((i) => {
      let fit = i.skill ? 8 : 9;
      if (i.skill && skills[0] === i.skill) fit += 1;
      if (hours !== null && hours === 0 && i.tipo !== 'ingreso principal') fit -= 5;
      else if (hours !== null && hours < 5 && i.tipo === 'activo escalable') fit -= 2;
      if (i.skill && p.audience && p.audience.length) fit += 1;
      if (p.risk === 'A' && i.base[5] < 7) fit -= 2;
      if ((tight || late) && i.base[2] < 7) fit -= 2; // sin margen: nada que exija poner dinero
      const s = [...i.base, Math.max(1, Math.min(10, fit))];
      return { ...i, s, total: Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10 };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
  const best = scored[0] || null;

  // ───────── Trayectoria ─────────
  const step = (m) => (target && income !== null && years ? income.plus(target.minus(income).times(Math.min(1, m / (years * 12)))) : null);
  const debtInput = diag.debts.filter((d) => new D(d.balance).gt(0)).map((d) => ({ name: d.name, balance: d.balance, payment: d.payment, rate: d.rate, rateType: d.rateType, fees: d.fees }));
  const proj = debtInput.length ? calc.projectDebts(debtInput, { extra: extraDebt }) : null;
  const debtComplete = Boolean(proj && !proj.incomplete.length && !proj.unresolved.length);
  const debtAt = (m) => {
    if (!debtInput.length) return ZERO;
    if (!debtComplete) return null; // sin tasa no se inventa cuánto bajará
    if (proj.months && m >= proj.months) return ZERO;
    const t = proj.timeline.find((x) => x.month === m);
    return t ? new D(t.total) : null;
  };
  const wealthAt = (m) => {
    if (net === null) return null;
    const d = debtAt(m);
    return net.plus(monthlySave.times(m)).plus(d === null ? ZERO : debt.minus(d)); // sin rendimientos ni aumentos de valor
  };
  const wealthNote = 'Suma tus aportes y lo que baja tu deuda cuando se conoce la tasa. No supone rendimientos, aumentos de valor ni ingresos extra.';

  const S = [];
  const add = (id, title, intro, blocks) => S.push({ id, title, intro, blocks: blocks.filter(Boolean) });
  const list = (title, items) => (items.filter(Boolean).length ? { type: 'list', title, items: items.filter(Boolean) } : null);

  // PM01
  const strengths = [
    balance !== null && balance.gt(0) && `Te quedan ${f(balance)} al mes.`,
    !debt.gt(0) && 'No tienes deudas registradas.',
    reserveMonths !== null && reserveMonths >= 3 && 'Tu ahorro disponible cubre varios meses de gastos.',
    skills.length && `Sabes ${skills.map((x) => SKILL[x]).filter(Boolean).join(', ')}.`,
    p.audience && p.audience.length && 'Conoces a personas o negocios a quienes podrías ofrecer algo.',
    ...habits.filter((h) => GOOD[h]).map((h) => `Un hábito a tu favor: ${GOOD[h]}.`),
  ];
  const brakes = [...diag.risks.slice(0, 4).map((r) => r.text), ...habits.filter((h) => BAD[h]).map((h) => `Un hábito que te frena: ${BAD[h]}.`), hours === 0 && 'Por ahora no tienes tiempo libre para un ingreso nuevo.'];
  add('PM01', 'Diagnóstico financiero y patrimonial', 'Tu punto de partida, con lo que declaraste.', [
    { type: 'figures', title: 'Tu contexto financiero actual', items: [
      p.activity && { k: 'Actividad', v: ACT[p.activity] || p.activity },
      { k: 'Ingresos al mes', v: f(income) },
      { k: 'Gastos al mes', v: f(expenses) },
      { k: 'Cuotas de deuda al mes', v: f(debtPay) },
      { k: 'Te queda al mes', v: f(balance) },
      { k: 'Meses de reserva', v: reserveMonths === null ? 'Sin dato' : String(Math.round(reserveMonths * 10) / 10).replace('.', ',') },
      capital !== null && { k: 'Capital que podrías invertir', v: f(capital) },
      p.risk && { k: 'Perfil de riesgo', v: RISK[p.risk] },
      p.motive && { k: 'Tu motivo', v: MOTIVE[p.motive] || p.motive },
    ].filter(Boolean) },
    diag.debts.length && { type: 'table', title: 'Tus deudas', head: ['Deuda', 'Saldo', 'Cuota al mes', 'Interés', 'Te falta'], rows: diag.debts.map((d) => [d.name, f(d.balance), f(d.payment), d.rate === null ? 'No lo sabemos' : `${String(Number(d.rate)).replace('.', ',')} % ${d.rateType === 'mensual' ? 'al mes' : 'al año'}`, d.term ? months(d.term) : 'No lo sabemos']) },
    biz && { type: 'figures', title: 'Tu negocio', items: [
      { k: 'Ventas al mes', v: f(sales) },
      { k: 'Ganancia al mes', v: f(profit) },
      margin !== null && { k: 'Te queda de cada 100 vendidos', v: String(margin) },
      biz.clients && { k: 'Clientes al mes', v: CLIENTS[biz.clients] || biz.clients },
      biz.repeat && { k: '¿Vuelven?', v: REPEAT[biz.repeat] || biz.repeat },
      biz.team && { k: 'Quién trabaja', v: TEAM[biz.team] || biz.team },
      problem && { k: 'Lo que más lo frena', v: problem[0] },
    ].filter(Boolean) },
    sales !== null && profit !== null && profit.gt(sales) && { type: 'text', text: 'Anotaste una ganancia mayor que tus ventas. Revisa esas dos cifras: no calculamos tu margen con ellas.' },
    assetsKnown && { type: 'figures', title: 'Tu patrimonio neto', items: [{ k: 'Ahorros', v: f(liquid) }, ...assetRows.map(([k, x]) => ({ k: ASSET[k] || k, v: f(x) })), { k: 'Deudas', v: `− ${f(debt)}` }, { k: 'Patrimonio neto', v: f(net), total: true }] },
    list('Tus fortalezas', strengths),
    list('Lo que te frena', brakes),
    list('Datos que faltan', missing),
  ]);

  // PM02
  const META = {
    equilibrar: ['Muy alto', 'Media', '1 a 2 meses', 'Ninguno', 'Recortar algo esencial'],
    atrasos: ['Muy alto', 'Media', '2 a 4 semanas', 'El pago atrasado', 'Comprometer un pago que no puedas cumplir'],
    deuda_no_amortiza: ['Muy alto', 'Media', '1 mes', 'La diferencia de la cuota', 'Refinanciar a más plazo y pagar más'],
    reserva_minima: ['Alto', 'Media', '2 a 6 meses', 'El aporte del plan', 'Usarla para gastos que no son emergencias'],
    reserva: ['Alto', 'Media', '6 a 18 meses', 'El aporte del plan', 'Dejar de aportar a mitad de camino'],
    deuda_cara: ['Alto', 'Media', '3 a 24 meses', 'El pago extra del plan', 'Volver a usar el crédito'],
    metas: ['Medio', 'Baja', '6 a 36 meses', 'El aporte del plan', 'Repartir entre demasiadas metas'],
    optimizar: ['Medio', 'Baja', '1 mes', 'Ninguno', 'Que lo que sobra se gaste sin notarlo'],
  };
  const actions = diag.priorities.map((x) => ({ title: x.title, m: META[x.code] || ['Medio', 'Media', '1 a 3 meses', 'Según el paso', 'No medir el avance'], why: 'Es una de tus prioridades según tus cifras.' }));
  if (best && !late) actions.push({ title: best.titulo, m: ['Alto', best.s[0] >= 8 ? 'Baja' : 'Media', best.tiempo, best.s[2] >= 9 ? 'Casi ninguno' : 'Poco, solo tras comprobar demanda', best.riesgo], why: `Es la oportunidad con mejor puntuación para ti (${String(best.total).replace('.', ',')} de 10).` });
  if (habits.some((h) => BAD[h])) actions.push({ title: `Cambiar un hábito: ${BAD[habits.find((h) => BAD[h])]}`, m: ['Medio', 'Media', '30 días', 'Ninguno', 'Querer cambiar todo a la vez'], why: 'Es un hábito que declaraste y que frena tu avance.' });
  for (const x of [{ title: 'Anotar tus gastos e ingresos durante 30 días', m: ['Medio', 'Baja', '30 días', 'Ninguno', 'Abandonar la primera semana'], why: 'Con datos reales el plan se vuelve exacto.' }, { title: 'Separar el dinero de tus metas en una cuenta aparte', m: ['Medio', 'Baja', '1 semana', 'Ninguno', 'Mezclarlo con el gasto diario'], why: 'Evita gastarlo sin darte cuenta.' }, { title: 'Revisar el plan una vez al mes', m: ['Medio', 'Baja', '1 hora al mes', 'Ninguno', 'No ajustar a tiempo'], why: 'Corregir pronto cuesta menos.' }]) if (actions.length < 3) actions.push(x);
  const top = actions.slice(0, 7);
  add('PM02', 'Tus acciones de mayor impacto', 'Pocas acciones, en orden. Empieza por la primera.', [{ type: 'cards', items: top.map((x, i) => ({ title: `${i + 1}. ${x.title}`, lines: [['Por qué', x.why], ['Impacto esperado', x.m[0]], ['Dificultad', x.m[1]], ['Tiempo', x.m[2]], ['Dinero necesario', x.m[3]], ['Riesgo', x.m[4]]] })) }]);

  // PM03
  const noIdeas = 'Todavía no hay datos para proponerte oportunidades: completa tu actividad y tus habilidades en la evaluación.';
  add('PM03', 'Mapa de oportunidades', 'Puntuadas del 1 al 10 (10 es mejor: más fácil, más rápido, menos dinero, menos riesgo). Son valoraciones orientativas, no predicciones.', scored.length
    ? [{ type: 'table', head: ['Oportunidad', 'Fácil', 'Rápida', 'Poco dinero', 'Rentable', 'Crece', 'Bajo riesgo', 'Va contigo', 'Total'], rows: scored.map((i) => [i.titulo, ...i.s.map(String), String(i.total).replace('.', ',')]) }, list('En qué orden', scored.map((i, n) => `${n + 1}. ${i.titulo} (${i.tipo}).`))]
    : [{ type: 'text', text: noIdeas }]);

  // PM04
  add('PM04', 'Máquina de ingresos', 'Cómo probar las mejores ideas. Comprueba que alguien pagaría antes de poner dinero o dejar lo que hoy te da ingresos.', scored.length
    ? [{ type: 'cards', items: scored.slice(0, 3).map((i) => ({ title: i.titulo, tag: i.tipo, lines: [['Cliente', i.cliente], ['Problema', i.problema], ['Qué ofreces', i.oferta], ['Cómo cobras', i.cobro], ['Precio por explorar', i.precio], ['Inversión', i.s[2] >= 9 ? 'Casi ninguna para empezar' : trial.gt(0) ? `Poca: como máximo ${f(trial)} para probar` : 'Ninguna por ahora: prueba sin gastar'], ['Primeros ingresos', `Entre ${i.tiempo}, si hay demanda`], ['Riesgo', i.riesgo], ['Primer paso', i.paso]] })) }]
    : [{ type: 'text', text: noIdeas }]);

  // PM05
  add('PM05', 'Ingresos recurrentes y que crecen', 'Para depender cada vez menos de tus horas.', [
    scored.length ? { type: 'table', head: ['Idea', 'Cómo volverla recurrente', 'Cómo hacerla crecer'], rows: scored.slice(0, 4).map((i) => [i.titulo, i.recurrente, i.escala]) } : { type: 'text', text: noIdeas },
    list('El orden', ['Primero vende a pocas personas y cumple.', 'Después convierte a quienes repiten en clientes mensuales.', 'Escribe cómo lo haces, paso a paso.', 'Recién entonces delega o automatiza una parte.']),
    biz && ['NO', 'ALGUNOS'].includes(biz.repeat) && { type: 'text', text: 'En tu negocio pocos clientes vuelven. Escríbeles a los que ya te compraron y ofréceles un pedido fijo o un paquete mensual: cuesta menos que buscar clientes nuevos.' },
    biz && biz.repeat === 'MUCHOS' && { type: 'text', text: 'La mayoría de tus clientes vuelve: proponles a cinco de ellos un pago mensual fijo. Ya confían en ti.' },
    biz && biz.repeat === 'PLAN' && { type: 'text', text: 'Ya te pagan cada mes. Cuida a esos clientes y pregunta por qué se fue cada uno que se va.' },
    p.business === 'DEPENDE' && { type: 'text', text: 'Tu negocio depende de ti: elige una tarea que hagas cada semana, escríbela y enséñasela a alguien. Es el primer paso para que funcione sin ti.' },
  ]);

  // PM06
  const tiers = [];
  if (outflow !== null && outflow.gt(0)) {
    const year = outflow.times(12);
    const raw = [
      ['Fondo de seguridad', outflow, 'un mes de tus gastos', 'Separa el aporte apenas cobres.', 'Usarlo para compras.', 'En ordenar tu mes.', 'En una cuenta aparte y disponible.', 'Anotar y presupuestar.', 'De gastar primero a separar primero.'],
      ['Primer capital', outflow.times(6), 'seis meses de tus gastos', 'Completa tu reserva y baja tus deudas caras.', 'Endeudarte para crecer.', 'En tu mejor oportunidad de ingreso.', 'En reserva y en pagar deuda cara.', 'Vender y cobrar bien.', 'De sobrevivir al mes a planear el año.'],
      ['Patrimonio inicial', year, 'un año de tus gastos', 'Suma un ingreso adicional estable.', 'Subir tus gastos al mismo ritmo.', 'En clientes que repiten.', 'En formación y herramientas que se paguen solas.', 'Negociar y delegar.', 'De trabajar más horas a trabajar mejor.'],
      ['Patrimonio intermedio', year.times(3), 'tres años de tus gastos', 'Construye un activo que genere sin ti.', 'Poner todo en un solo lugar.', 'En procesos y equipo.', 'En activos que entiendas, con asesoría.', 'Dirigir y medir.', 'De hacerlo tú a que funcione sin ti.'],
      ['Patrimonio considerable', year.times(10), 'diez años de tus gastos', 'Diversifica y protege lo logrado.', 'Arriesgar lo que no puedes reponer.', 'En decisiones, no en tareas.', 'En varias fuentes distintas.', 'Evaluar riesgos y asesorarte.', 'De acumular a proteger.'],
      ['Independencia financiera', year.times(25), 'referencia común: 25 años de gastos; no es una garantía', 'Que tus activos cubran tus gastos.', 'Dejar de revisar tus números.', 'En lo que te importa.', 'En conservar y repartir.', 'Cuidar y transmitir.', 'De trabajar por dinero a elegir.'],
    ];
    for (const t of raw) {
      const gap = t[1].minus(liquid);
      const m = gap.lte(0) ? 0 : monthlySave.gt(0) ? gap.div(monthlySave).ceil().toNumber() : null;
      tiers.push({ t, gap, m });
    }
    if (wealth && wealth.gt(0)) tiers.push({ t: ['Tu objetivo', wealth, 'el que tú definiste', 'Revisa cada año si el aporte alcanza.', 'Perseguir atajos.', 'En aumentar tu ingreso.', 'En lo que ya comprobaste que funciona.', 'Las del escalón en que estés.', 'De desearlo a medirlo.'], gap: wealth.minus(net || liquid), m: wealth.minus(net || liquid).lte(0) ? 0 : monthlySave.gt(0) ? wealth.minus(net || liquid).div(monthlySave).ceil().toNumber() : null });
    tiers.sort((a, b) => a.t[1].cmp(b.t[1]));
  }
  const next = tiers.find((x) => x.m !== 0) || null;
  const far = (m) => (m !== null && m > 600 ? 'más de 50 años: hace falta aumentar el aporte' : months(m));
  add('PM06', 'Ruta de acumulación patrimonial', 'Escalones hechos a tu medida. El plazo supone solo el aporte de hoy, sin rendimientos.', tiers.length
    ? [{ type: 'table', head: ['Escalón', 'Monto', 'Equivale a', 'Con tu aporte de hoy'], rows: tiers.map((x) => [x.t[0], f(x.t[1]), x.t[2], far(x.m)]) },
        next && { type: 'cards', items: [{ title: `Tu próximo escalón: ${next.t[0]}`, tag: f(next.t[1]), lines: [['Qué hacer', next.t[3]], ['Qué evitar', next.t[4]], ['Dónde poner tu tiempo', next.t[5]], ['Dónde poner tu dinero', next.t[6]], ['Qué aprender', next.t[7]], ['Qué cambia', next.t[8]]] }] }]
    : [{ type: 'text', text: 'Falta saber cuánto gastas al mes para armar tus escalones.' }]);

  // PM07
  const buildable = scored.slice(0, 3).map((i) => `${i.activo}: nace de «${i.titulo.toLowerCase()}».`);
  add('PM07', 'Activos para crear o adquirir', 'Un activo te da ingresos, te ahorra gastos o vale más con el tiempo.', [
    list('Los que puedes crear', buildable.length ? buildable : ['Una habilidad que se pague mejor: es el activo más accesible para empezar.']),
    list('Antes de comprar uno', [`Tu reserva cubre al menos ${rules.reserva_meses.recomendada} meses.`, 'No tienes pagos atrasados ni deudas cuya cuota no baja.', 'Sabes cuánto genera, cuánto cuesta mantenerlo y en cuánto lo venderías.', 'Lo entiendes y lo revisaste con alguien que sabe y no gana por venderte.', p.risk === 'A' && 'Encaja con tu forma de ser: prefieres cuidar antes que crecer rápido.']),
    list('Dónde poner tus recursos ahora', [capital !== null && capital.gt(0) && (capitalFree ? reserveShort ? `Capital: de tus ${f(capital)}, primero completa tu reserva. Prueba una idea con ${f(capitalTest)} como máximo en total.` : `Capital: de tus ${f(capital)}, prueba primero con ${f(capitalTest)} como máximo y suma más solo si hay ventas.` : `Capital: guarda tus ${f(capital)} hasta ordenar tu mes y tus pagos.`), hours ? `Tiempo: unas ${hours} horas a la semana en tu primera oportunidad.` : 'Tiempo: primero libera unas horas a la semana.', trial.gt(0) && !tight && !late ? `Dinero: como máximo ${f(trial)} al mes para probar ideas.` : 'Dinero: por ahora ninguno; prueba sin gastar.', `Aprende: ${best ? `lo que más ayude a «${best.titulo.toLowerCase()}»` : 'a vender lo que sabes hacer'}.`]),
  ]);

  // PM08
  const ideaWeek = best && !late ? [best.paso, 'Habla con cinco posibles clientes y anota qué te dicen.', 'Haz una primera prueba pequeña y cóbrala, aunque sea poco.', 'Decide con datos: seguir, ajustar o probar la segunda idea.'] : [];
  const weeks = [1, 2, 3, 4].map((w) => {
    const from = (w - 1) * 7 + 1;
    const to = w === 4 ? 30 : w * 7;
    return [`Semana ${w}`, [...content.plan90.filter((a) => a.day >= from && a.day <= to).map((a) => a.title), ideaWeek[w - 1]].filter(Boolean)];
  });
  add('PM08', 'Plan de 30 días', 'Semana por semana. Una cosa a la vez.', [
    { type: 'figures', title: 'Metas del mes', items: [{ k: 'Ahorro', v: f(new D(alloc.reserva).plus(alloc.metas)) }, { k: 'Pago extra a deudas', v: f(alloc.deuda) }, { k: 'Ajuste de gastos', v: f(content.presupuesto.adjustment) }, { k: 'Ventas', v: best && !late ? 'Una primera venta de prueba' : 'Ninguna por ahora' }, { k: 'Activos', v: best && !late ? 'Una lista con los contactos de tu prueba' : 'Tus números anotados' }] },
    { type: 'cards', items: weeks.map(([t, items]) => ({ title: t, lines: (items.length ? items : ['Sigue con lo de la semana anterior y anota tus gastos.']).map((x) => ['', x]) })) },
  ]);

  // PM09
  add('PM09', 'Plan de 90 días', 'Tres objetivos y cómo saber si avanzas.', [
    { type: 'cards', items: [
      { title: 'Objetivo financiero', lines: [['Meta', tight ? 'Que tus gastos no superen tus ingresos' : `Haber separado ${f(monthlySave.times(3))}${extraDebt.gt(0) ? ` y pagado ${f(extraDebt.times(3))} extra de deuda` : ''}`], ['Indicador', 'Tu saldo y tus aportes de cada mes']] },
      { title: 'Objetivo profesional', lines: [['Meta', best ? `Haber probado «${best.titulo}» con clientes reales` : 'Definir una habilidad para ofrecer'], ['Indicador', 'Personas contactadas, interesadas y que pagaron']] },
      ['BUSINESS', 'INDEPENDENT', 'MULTIPLE'].includes(p.activity) || (p.business && p.business !== 'NO') ? { title: 'Objetivo de tu negocio', lines: [['Meta', problem ? problem[1] : 'Saber cuánto te queda por cada venta y tener un proceso escrito'], ['Indicador', problem ? problem[2] : 'Ganancia por venta y clientes que repiten']] } : { title: 'Activo por crear', lines: [['Meta', best ? best.activo : 'Un registro completo de tus números'], ['Indicador', 'Que exista y lo uses']] },
    ] },
    list('Revisa a los 30, 60 y 90 días', ['Cuánto te quedó de verdad frente a lo previsto.', 'Si tu deuda bajó.', 'Qué idea funcionó y cuál conviene abandonar.']),
  ]);

  // PM10
  const yr = (m) => [f(step(m)), f(wealthAt(m)), debtAt(m) === null ? 'Falta la tasa' : f(debtAt(m)), f(liquid.plus(monthlySave.times(m)))];
  add('PM10', 'Un año y visión a tres años', 'El ingreso es la meta que tú definiste; lo demás sale de mantener el plan.', [
    { type: 'table', head: ['Plazo', 'Ingreso al que apuntas', 'Patrimonio estimado', 'Deuda', 'Ahorros'], rows: [['Hoy', f(income), f(net), f(debt), f(liquid)], ['1 año', ...yr(12)], ['3 años', ...yr(36)]] },
    list('A un año', ['Reserva en marcha y aportes automáticos.', best && `«${best.titulo}» probada y, si funcionó, con clientes que repiten.`, 'Un proceso escrito o una herramienta que te ahorre tiempo.']),
    list('A tres años', ['Más de una fuente de ingreso, para no depender de una sola.', 'Al menos un activo que genere sin ocupar todo tu tiempo.', 'Tu patrimonio repartido y protegido.']),
    { type: 'text', text: wealthNote },
  ]);

  // PM11
  const errors = [];
  const err = (c, t, why, sign, rule) => c && errors.push({ title: t, lines: [['Por qué es peligroso', why], ['Cómo detectarlo', sign], ['Tu regla', rule]] });
  err(tight, 'Cubrir el mes con deuda', 'El faltante crece con intereses.', 'Usas tarjeta o préstamos para gastos de cada día.', 'Primero se recorta; no se pide prestado para gastar.');
  err(late, 'Dejar crecer un atraso', 'Suma cargos cada mes.', 'No contestas a quien le debes.', 'Se llama antes del vencimiento y se acuerda por escrito.');
  err(diag.risks.some((r) => r.code === 'minimo') || habits.includes('MINIMO'), 'Pagar solo el mínimo', 'La deuda casi no baja.', 'El saldo es parecido cada mes.', 'Siempre algo más que el mínimo.');
  err(reserveMonths !== null && reserveMonths < 1, 'Vivir sin reserva', 'Cualquier imprevisto se vuelve deuda.', 'Un gasto inesperado te desordena el mes.', 'Primero el aporte, después lo demás.');
  err(habits.includes('IMPULSO'), 'Comprar por impulso', 'Se va el dinero de tus metas.', 'Compras que no recuerdas haber planeado.', 'Esperar 48 horas antes de una compra no prevista.');
  err(habits.includes('PRESTA'), 'Prestar sin acuerdo', 'Pierdes dinero y relaciones.', 'Te cuesta cobrar.', 'Prestar solo lo que podrías regalar, o con fecha escrita.');
  err(habits.includes('PIDE'), 'Pedir para llegar a fin de mes', 'Empiezas el siguiente mes debiendo.', 'Cada mes falta lo mismo.', 'Ajustar el gasto antes de volver a pedir.');
  err(p.loss === 'VENDI', 'Decidir con miedo', 'Vendes en el peor momento.', 'Cambias de plan por una mala noticia.', 'Esperar una semana y pedir otra opinión antes de vender.');
  err(p.loss === 'DOBLE', 'Arriesgar más para recuperar', 'Una pérdida pequeña se vuelve grande.', 'Sientes urgencia por recuperar.', 'Definir antes de empezar cuánto puedes perder.');
  err(true, 'Subir tus gastos cuando ganas más', 'Ganas más y te queda lo mismo.', 'Tu saldo no crece aunque subió tu ingreso.', 'De cada aumento, la mitad va a tus metas.');
  err(true, 'Confiar en ganancias seguras', 'Quien las promete suele estafar.', 'Te apuran, te piden dinero antes o que traigas a otros.', 'Si no entiendes cómo gana dinero, no entras.');
  add('PM11', 'Errores que evitar y protección', 'Los que más te pueden costar según tus datos.', [{ type: 'cards', items: errors.slice(0, 7) }, list('Protege lo que tienes', [diag.risks.some((r) => r.code === 'salud') && 'Compara opciones de cobertura de salud para tu hogar.', diag.risks.some((r) => r.code === 'respaldo') && 'Acuerda quién cubriría los gastos si tu ingreso se detiene.', assetsKnown && assetRows.length > 0 && 'Ten al día los papeles de tus bienes.', 'Guarda copia de tus documentos y claves en un lugar seguro.'])]);

  // PM12
  add('PM12', 'Principios para decidir', 'Reglas simples para no dudar cada vez.', [
    { type: 'table', head: ['Cuando tengas que…', 'Tu regla'], rows: [
      ['Elegir una oportunidad', 'La que resuelve un problema que alguien ya paga por resolver y puedes probar en dos semanas.'],
      ['Poner dinero en una idea', trial.gt(0) && !tight && !late ? `Como máximo ${f(trial)} al mes, y solo después de una primera venta.` : 'Nada por ahora: prueba sin gastar hasta tener margen.'],
      capital !== null && capital.gt(0) && ['Usar tu capital', capitalFree ? `Empieza con ${f(capitalTest)} como máximo (la décima parte) y nunca con dinero de tu reserva.` : 'No se toca hasta tener margen y estar al día.'],
      ['Distinguir invertir de especular', 'Invertir es entender de dónde sale la ganancia. Si solo esperas que suba, es especular.'],
      ['Reinvertir lo ganado', `Primero reserva de ${rules.reserva_meses.recomendada} meses; después, la mitad de lo extra a lo que ya funciona.`],
      ['Guardar efectivo', 'Si tu reserva está incompleta o tu ingreso cambia mucho.'],
      ['Eliminar un gasto', 'Si no lo extrañarías en un mes, se va.'],
      ['Abandonar un proyecto', 'Si tras 90 días nadie pagó, se cierra sin culpa.'],
      ['Decir que no', 'Si compromete tu reserva, tu salud o tu familia, la respuesta es no.'],
    ].filter(Boolean) },
    list('Cómo se construye riqueza, en tu caso', [`Ingresar: hoy recibes ${f(income)} al mes.`, `Ahorrar: el plan separa ${f(monthlySave)} al mes.`, 'Reinvertir: en lo que ya comprobaste que funciona.', 'Crear activos: lo que puedas vender muchas veces o funcione sin ti.', 'Proteger: reserva, papeles y cobertura.']),
  ]);

  // PM13
  const row = (label, m, asset, action) => [label, f(step(m)), f(wealthAt(m)), asset, action];
  add('PM13', 'Tabla de objetivos', 'Todo tu plan en una tabla.', [
    { type: 'table', head: ['Horizonte', 'Ingreso objetivo', 'Patrimonio objetivo', 'Activos por construir', 'Acción principal'], rows: [
      row('30 días', 1, 'Tus números anotados', top[0] ? top[0].title : 'Ordenar tu mes'),
      row('90 días', 3, best ? 'Lista de clientes de prueba' : 'Presupuesto que se cumple', best && !late ? best.titulo : (top[1] || top[0] || {}).title || 'Mantener el presupuesto'),
      row('1 año', 12, best ? best.activo : 'Reserva en marcha', (top[1] || top[0] || {}).title || 'Completar tu reserva'),
      row('3 años', 36, 'Una fuente que no dependa de tus horas', 'Repartir y proteger tu patrimonio'),
    ] },
    { type: 'text', text: target && years ? `El ingreso avanza de forma pareja hasta tu meta de ${f(target)} en ${years} ${years === 1 ? 'año' : 'años'}; es un objetivo, no un pronóstico. ${wealthNote}` : `Falta tu meta de ingreso y el plazo para completar esa columna. ${wealthNote}` },
  ]);

  // PM14
  const decs = [];
  const dc = (c, t, why, yes, no) => c && decs.push({ title: t, lines: [['Por qué importa', why], ['Si la tomas', yes], ['Si la postergas', no]] });
  dc(late, '¿Cómo y cuándo te pones al día?', 'El atraso es lo que más rápido encarece tu situación.', 'Detienes los cargos y recuperas orden.', 'La deuda sigue creciendo.');
  dc(tight, '¿Qué gasto recortas este mes?', `Hoy ${balance !== null && balance.lt(0) ? `faltan ${f(balance.abs())} al mes` : 'todo lo que entra se va'}.`, 'Vuelves a tener margen para decidir.', 'Cada mes empiezas más abajo.');
  dc(!tight && available.gt(0), `¿A dónde van tus ${f(available)} disponibles al mes?`, 'Sin destino, ese dinero se gasta sin notarlo.', `Separas ${f(monthlySave)} y avanzas cada mes.`, 'Es probable que en un año sigas en el mismo lugar.');
  dc(extraDebt.gt(0), '¿Pagas extra a tu deuda más cara?', 'Es un ahorro que sí depende de ti.', 'Pagas menos intereses y terminas antes.', 'Los intereses se llevan parte de tu esfuerzo.');
  dc(reserveMonths !== null && reserveMonths < rules.reserva_meses.recomendada, '¿Abres hoy una cuenta solo para tu reserva?', 'Tu reserva todavía no cubre varios meses.', 'Un imprevisto deja de ser una crisis.', 'Cualquier imprevisto te obliga a endeudarte.');
  dc(best, best && `¿Pruebas «${best.titulo}» en las próximas dos semanas?`, 'Es la opción que mejor encaja contigo.', 'Sabrás con hechos si alguien paga.', 'Seguirás con la duda y el mismo ingreso.');
  dc(hours === 0, '¿Qué dejas para liberar tres horas a la semana?', 'Sin tiempo no hay ingreso nuevo.', 'Abres espacio para probar.', 'Tu ingreso seguirá igual.');
  dc(!target || !years, '¿Cuánto quieres ganar y en cuánto tiempo?', 'Sin una meta medible no se puede saber si avanzas.', 'El plan se calcula hacia tu meta.', 'Trabajarás sin saber si alcanza.');
  dc(true, '¿Qué día del mes revisas tu plan?', 'Corregir pronto cuesta menos.', 'Ajustas con datos y no con sensaciones.', 'Te enteras tarde de los problemas.');
  dc(true, '¿Con quién compartes tu plan?', 'Cumplimos mejor lo que alguien más sabe.', 'Tienes apoyo en los meses difíciles.', 'Es más fácil abandonarlo.');
  dc(true, '¿Qué gasto te prometes no subir aunque ganes más?', 'Cuida el efecto de ganar más.', 'Lo nuevo se convierte en patrimonio.', 'Lo nuevo se convierte en gasto.');
  add('PM14', 'Las cinco decisiones más importantes ahora', 'Si solo haces cinco cosas, que sean estas.', [{ type: 'cards', items: decs.slice(0, 5).map((x, i) => ({ ...x, title: `${i + 1}. ${x.title}` })) }]);

  return { version: RULES_VERSION, sections: S, netWorth: net === null ? null : net.toFixed(2), missing, best: best ? { id: best.id, title: best.titulo, step: best.paso } : null };
}

module.exports = { profile, build, RULES_VERSION, ASSET };
