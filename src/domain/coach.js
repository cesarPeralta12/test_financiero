'use strict';
// F09 Coach de IA. Conoce el diagnóstico, el plan vigente y el avance de la
// persona autenticada. Distingue consultas hipotéticas (simulación, sin cambios)
// de modificaciones reales, que quedan como propuestas hasta que la persona
// las confirma. Guarda el historial y respeta los límites de uso.
const db = require('../db');
const money = require('../lib/money');
const ai = require('./ai/provider');
const prompts = require('./ai/prompts');
const tracker = require('./tracker');
const tasks = require('./tasks');
const planDomain = require('./plan');

const { D } = money;

function conversation(userId) {
  let c = db.one('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1', userId);
  if (!c) {
    const r = db.run("INSERT INTO conversations (user_id, title, created_at, updated_at) VALUES (?, 'Conversación con el coach', ?, ?)", userId, db.now(), db.now());
    c = db.one('SELECT * FROM conversations WHERE id = ?', r.lastId);
    addMessage(c, userId, {
      role: 'coach',
      content: 'Hola. Soy el coach de Día Uno, un asistente de inteligencia artificial. Conozco tu diagnóstico, tu plan y tu avance. Puedo explicarte tus cifras, simular escenarios y proponerte la siguiente acción. No guardo ningún cambio sin que lo confirmes.',
    });
  }
  return c;
}

function messages(conversationId, userId) {
  return db.all('SELECT * FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY id', conversationId, userId);
}

function addMessage(conv, userId, { role, content, kind = 'normal', data = null, proposal = null, aiRunId = null }) {
  const r = db.run(
    'INSERT INTO messages (conversation_id, user_id, role, kind, content, data_json, proposal_json, proposal_status, ai_run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    conv.id,
    userId,
    role,
    kind,
    content,
    db.json(data),
    db.json(proposal),
    proposal ? 'pendiente' : null,
    aiRunId,
    db.now()
  );
  db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', db.now(), conv.id);
  return r.lastId;
}

/** Resumen calculado por el servidor que recibe la IA en cada turno. */
function context(userId) {
  const cur = tracker.baseCurrency(userId);
  const f = (v) => (v === null || v === undefined ? null : money.format(v, cur));
  const diagRow = db.one('SELECT result_json, created_at FROM diagnoses WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', userId);
  const diag = diagRow ? JSON.parse(diagRow.result_json) : null;
  const plan = planDomain.current(userId);
  const content = plan ? JSON.parse(plan.content_json) : null;
  const month = tracker.currentMonth();
  const actual = tracker.monthSummary(userId, month);
  const planned = tracker.budgetSummary(userId, month);
  const pending = tasks.list(userId).filter((t) => t.status !== 'completada').slice(0, 5);
  const done = tasks.list(userId).filter((t) => t.status === 'completada').length;
  const lastChange = tracker.lastDataChange(userId);
  return {
    moneda: cur,
    fecha_hoy: new Date().toISOString().slice(0, 10),
    diagnostico: diag && {
      fecha: diagRow.created_at.slice(0, 10),
      ingresos_mes: f(diag.income.total),
      gastos_mes: f(diag.expenses.total),
      pagos_deuda_mes: f(diag.debtPayments),
      saldo_disponible: f(diag.balance),
      tasa_ahorro: diag.savingsRate === null ? null : money.formatPercent(diag.savingsRate, 1),
      reserva_meses: diag.reserve.months,
      deudas: diag.debts.map((d) => ({ nombre: d.name, saldo: f(d.balance), cuota: f(d.payment), estado: d.status, meses: d.months })),
      prioridades: diag.priorities.map((p) => p.title),
      riesgos: diag.risks.map((r) => r.text),
    },
    plan: content && {
      version: plan.version_number,
      dia_uno: content.startDate,
      dia_actual: planDomain.dayNumber(content.startDate),
      reparto_mensual: Object.fromEntries(Object.entries(content.presupuesto.alloc).map(([k, v]) => [k, f(v)])),
      orden_deudas: content.presupuesto.strategy.order,
    },
    tareas_pendientes: pending.map((t) => ({ id: t.id, titulo: t.title, motivo: t.reason, criterio: t.done_criteria, fecha: t.postponed_until || t.due_date, estado: t.status })),
    tareas_completadas: done,
    metas: tracker.goals(userId).map((g) => ({ id: g.id, nombre: g.name, objetivo: f(g.target_amount), ahorrado: f(g.saved), avance: g.progress.valid ? money.formatPercent(g.progress.progress, 0) : null })),
    mes_actual: {
      mes: month,
      real: { ingresos: f(actual.ingreso), gastos: f(actual.gasto), pagos_deuda: f(actual.pago_deuda), saldo: f(actual.balance), ahorro_neto: f(actual.netSaving), movimientos: actual.count },
      previsto: planned && { ingresos: f(planned.ingreso), gastos: f(planned.gasto), pagos_deuda: f(planned.pago_deuda), ahorro: f(planned.ahorro) },
    },
    datos_cambiaron_desde_el_plan: Boolean(plan && ((lastChange && lastChange > plan.completed_at) || planDomain.dataChangedSince(userId, plan))),
  };
}

// ───────── Propuestas (requieren confirmación explícita) ─────────

function describeProposal(p, cur) {
  const f = (v) => money.format(v, cur);
  switch (p.type) {
    case 'crear_tarea':
      return { title: 'Crear tarea', text: `«${p.title}». ${p.reason || ''}${p.criteria ? ` Terminada cuando: ${p.criteria}` : ''}` };
    case 'registrar_movimiento':
      return { title: 'Registrar movimiento', text: `${tracker.KINDS[p.kind]} de ${f(p.amount)} en ${tracker.CATEGORIES[p.kind][p.category]}, con fecha ${p.date}${p.note ? ` (${p.note})` : ''}.` };
    case 'completar_tarea':
      return { title: 'Marcar tarea como completada', text: `«${p.taskTitle}».` };
    case 'actualizar_meta':
      return { title: 'Actualizar meta', text: `«${p.goalName}»: objetivo ${f(p.target)}${p.months ? `, en ${p.months} meses` : ''}.` };
    default:
      return { title: 'Propuesta', text: '' };
  }
}

function buildProposal(userId, type, input) {
  if (type === 'crear_tarea') {
    const title = String(input.titulo || '').trim().slice(0, 120);
    if (!title) return { error: 'La tarea necesita un título.' };
    return { proposal: { type, title, reason: String(input.motivo || '').slice(0, 300), criteria: String(input.criterio || '').slice(0, 300) } };
  }
  if (type === 'registrar_movimiento') {
    const v = tracker.validateMovement(userId, { kind: input.tipo, category: input.categoria, amount: String(input.importe), date: input.fecha, note: input.nota });
    if (!v.ok) return { error: `Datos no válidos: ${Object.values(v.errors).join(' ')}` };
    return { proposal: { type, kind: v.value.kind, category: v.value.category, amount: v.value.amount, date: v.value.date, note: v.value.note } };
  }
  if (type === 'completar_tarea') {
    const t = tasks.get(userId, Number(input.tarea_id));
    if (!t || t.status === 'completada') return { error: 'No encontré esa tarea pendiente.' };
    return { proposal: { type, taskId: t.id, taskTitle: t.title } };
  }
  if (type === 'actualizar_meta') {
    const g = db.one('SELECT * FROM goals WHERE id = ? AND user_id = ?', Number(input.meta_id), userId);
    if (!g) return { error: 'No encontré esa meta.' };
    const t = money.parseAmount(String(input.objetivo), tracker.baseCurrency(userId));
    if (!t.ok || new D(t.value).lte(0)) return { error: 'El objetivo debe ser un importe mayor que 0.' };
    const months = Number(input.meses) > 0 ? Math.min(Math.round(Number(input.meses)), 600) : null;
    return { proposal: { type, goalId: g.id, goalName: g.name, target: t.value, months } };
  }
  return { error: 'Tipo de propuesta desconocido.' };
}

/** Aplica una propuesta pendiente tras la confirmación explícita de la persona. */
function confirm(userId, messageId) {
  const m = db.one("SELECT * FROM messages WHERE id = ? AND user_id = ? AND proposal_status = 'pendiente'", messageId, userId);
  if (!m) return null;
  const p = JSON.parse(m.proposal_json);
  let summary;
  db.tx(() => {
    if (p.type === 'crear_tarea') {
      tasks.create(userId, { title: p.title, reason: p.reason, criteria: p.criteria, source: 'coach' });
      summary = `Creé la tarea «${p.title}».`;
    } else if (p.type === 'registrar_movimiento') {
      tracker.createMovement(userId, { kind: p.kind, category: p.category, date: p.date, amount: p.amount, currency: tracker.baseCurrency(userId), note: p.note, debtId: null, goalId: null, toGoalId: null }, 'coach');
      summary = 'Registré el movimiento.';
    } else if (p.type === 'completar_tarea') {
      tasks.complete(userId, p.taskId, 'Confirmada desde el coach');
      summary = `Marqué «${p.taskTitle}» como completada.`;
    } else if (p.type === 'actualizar_meta') {
      tracker.updateGoal(userId, p.goalId, { target: p.target, months: p.months });
      summary = `Actualicé la meta «${p.goalName}».`;
    }
    db.run("UPDATE messages SET proposal_status = 'confirmada' WHERE id = ?", m.id);
    const conv = db.one('SELECT * FROM conversations WHERE id = ?', m.conversation_id);
    addMessage(conv, userId, { role: 'sistema', kind: 'aviso', content: `Confirmado. ${summary}` });
  });
  return summary;
}

function discard(userId, messageId) {
  const n = db.run("UPDATE messages SET proposal_status = 'descartada' WHERE id = ? AND user_id = ? AND proposal_status = 'pendiente'", messageId, userId).changes;
  if (n) {
    const m = db.one('SELECT conversation_id FROM messages WHERE id = ?', messageId);
    addMessage(db.one('SELECT * FROM conversations WHERE id = ?', m.conversation_id), userId, { role: 'sistema', kind: 'aviso', content: 'Descartaste la propuesta. No se guardó ningún cambio.' });
  }
  return n;
}

// ───────── Herramientas para el modelo ─────────

const TOOLS = [
  {
    name: 'simular_escenario',
    description: 'Consulta hipotética: compara el escenario actual con uno modificado. No cambia ningún dato. Usa 0 en los campos que no cambian. Los importes son mensuales, en la moneda de la cuenta.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        ahorro_extra: { type: 'number', description: 'Cambio en el ahorro mensual (negativo para ahorrar menos).' },
        cambio_gasto: { type: 'number', description: 'Cambio en el gasto mensual (negativo para gastar menos).' },
        pago_extra_deuda: { type: 'number', description: 'Pago extra mensual a deudas (0 o más).' },
        ingreso_extra: { type: 'number', description: 'Ingreso extra mensual supuesto (0 o más).' },
      },
      required: ['ahorro_extra', 'cambio_gasto', 'pago_extra_deuda', 'ingreso_extra'],
      additionalProperties: false,
    },
  },
  {
    name: 'proponer_tarea',
    description: 'Propone crear una tarea concreta. Solo se guarda si la persona la confirma.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { titulo: { type: 'string' }, motivo: { type: 'string' }, criterio: { type: 'string', description: 'Cómo saber que está terminada.' } },
      required: ['titulo', 'motivo', 'criterio'],
      additionalProperties: false,
    },
  },
  {
    name: 'proponer_movimiento',
    description: 'Propone registrar un movimiento real. Solo se guarda si la persona lo confirma.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: Object.keys(tracker.KINDS).filter((k) => k !== 'transferencia') },
        categoria: { type: 'string', description: `Categorías por tipo: ${Object.entries(tracker.CATEGORIES).map(([k, v]) => `${k}: ${Object.keys(v).join(', ')}`).join('; ')}` },
        importe: { type: 'number' },
        fecha: { type: 'string', description: 'AAAA-MM-DD' },
        nota: { type: 'string' },
      },
      required: ['tipo', 'categoria', 'importe', 'fecha', 'nota'],
      additionalProperties: false,
    },
  },
  {
    name: 'proponer_completar_tarea',
    description: 'Propone marcar como completada una tarea pendiente (usa el id del contexto). Solo se guarda si la persona lo confirma.',
    strict: true,
    input_schema: { type: 'object', properties: { tarea_id: { type: 'integer' } }, required: ['tarea_id'], additionalProperties: false },
  },
  {
    name: 'proponer_actualizar_meta',
    description: 'Propone cambiar el objetivo o el plazo de una meta (usa el id del contexto). Solo se guarda si la persona lo confirma.',
    strict: true,
    input_schema: { type: 'object', properties: { meta_id: { type: 'integer' }, objetivo: { type: 'number' }, meses: { type: 'integer', description: '0 si no cambia el plazo.' } }, required: ['meta_id', 'objetivo', 'meses'], additionalProperties: false },
  },
];

const PROPOSAL_TOOLS = { proponer_tarea: 'crear_tarea', proponer_movimiento: 'registrar_movimiento', proponer_completar_tarea: 'completar_tarea', proponer_actualizar_meta: 'actualizar_meta' };

function simulationSummary(sim) {
  if (!sim) return { error: 'No hay datos suficientes para simular: completa la evaluación profunda o registra tu presupuesto.' };
  const cur = sim.currency;
  const f = (v) => (v === null ? null : money.format(v, cur));
  const pick = (x) => ({ saldo_libre_mes: f(x.free), ahorro_mes: f(x.saving), tasa_ahorro: x.savingsRate === null ? null : money.formatPercent(x.savingsRate, 1), meses_para_salir_de_deudas: x.debtMonths, intereses_totales: f(x.debtInterest) });
  return { base_de_calculo: sim.source, actual: pick(sim.base), escenario: pick(sim.scenario), supuestos: sim.assumptions, aviso: 'Simulación hipotética: no cambia los datos reales ni el plan.' };
}

async function anthropicReply(userId, text, ctx, history) {
  const msgs = history.map((m) => ({ role: m.role === 'usuario' ? 'user' : 'assistant', content: m.content }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  msgs.push({ role: 'user', content: text });
  msgs.push({ role: 'system', content: `Contexto calculado por el servidor (JSON):\n${JSON.stringify(ctx)}` });
  let proposal = null;
  let simulation = null;
  let lastRun = null;
  for (let i = 0; i < 4; i++) {
    const res = await ai.call({
      userId,
      purpose: 'coach',
      promptVersion: prompts.COACH_PROMPT_VERSION,
      system: prompts.COACH_SYSTEM,
      messages: msgs,
      tools: TOOLS,
      effort: 'low',
      maxTokens: 16000,
      input: { contexto: ctx, mensaje: text, turnos_previos: history.length },
      skipLimits: i > 0,
      localFn: null,
    });
    lastRun = res;
    const msg = res.message;
    if (msg.stop_reason !== 'tool_use') return { text: res.text, proposal, simulation, runId: res.runId };
    msgs.push({ role: 'assistant', content: msg.content });
    const results = [];
    for (const block of msg.content.filter((b) => b.type === 'tool_use')) {
      let out;
      if (block.name === 'simular_escenario') {
        simulation = tracker.simulate(userId, block.input);
        out = simulationSummary(simulation);
      } else if (PROPOSAL_TOOLS[block.name]) {
        if (proposal) out = { error: 'Ya hay una propuesta en este mensaje. Propón una sola acción a la vez.' };
        else {
          const b = buildProposal(userId, PROPOSAL_TOOLS[block.name], block.input);
          if (b.error) out = { error: b.error };
          else {
            proposal = b.proposal;
            out = { estado: 'propuesta_pendiente_de_confirmacion', aviso: 'No está guardado. La persona debe pulsar «Confirmar».' };
          }
        }
      } else out = { error: 'Herramienta desconocida.' };
      results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out), ...(out.error ? { is_error: true } : {}) });
    }
    msgs.push({ role: 'user', content: results });
  }
  return { text: lastRun ? lastRun.text || 'Preparé la información; revisa la propuesta.' : '', proposal, simulation, runId: lastRun && lastRun.runId };
}

// Proveedor local de desarrollo: reglas simples con las mismas herramientas.
function norm(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function firstAmount(text, cur) {
  const m = String(text).match(/-?\d[\d.,]*/);
  if (!m) return null;
  const p = money.parseAmount(m[0].replace(/^-/, ''), cur);
  return p.ok ? new D(p.value) : null;
}
const CATEGORY_WORDS = [
  [/super|comida|mercado|despensa|restaurante|cafe/, 'gasto', 'alimentacion'],
  [/renta|alquiler|mantenimiento/, 'gasto', 'vivienda'],
  [/gasolina|uber|taxi|transporte|camion|metro|pasaje/, 'gasto', 'transporte'],
  [/luz|agua|internet|telefono|celular|gas\b/, 'gasto', 'servicios'],
  [/medico|farmacia|doctor|salud/, 'gasto', 'salud'],
  [/escuela|colegiatura|curso|libros/, 'gasto', 'educacion'],
  [/cine|netflix|spotify|salida|suscripcion|fiesta/, 'gasto', 'ocio'],
];

function localReply(userId, text, ctx) {
  const t = norm(text);
  const cur = ctx.moneda;
  const f = (v) => money.format(v, cur);
  const amount = firstAmount(text, cur);
  const nextTask = tasks.next(userId);
  const recalc = ctx.datos_cambiaron_desde_el_plan ? ' Por cierto, tus datos cambiaron desde que se generó tu plan: si quieres, actualiza tu evaluación para recalcular antes de pensar en un plan nuevo.' : '';

  if (/eres (una )?(ia|persona|humano|robot|inteligencia)|quien eres|hablo con/.test(t)) {
    return { text: 'Soy un asistente de inteligencia artificial, no una persona ni un asesor certificado. Uso las cifras que calcula Día Uno con tus datos para explicarte tu plan y proponerte acciones.' };
  }
  if (/(que pasa|que pasaria|y si|simula|si (ahorr|pag|gast|reduzc|recort|gan|aument))/.test(t)) {
    if (!amount) return { text: 'Puedo simularlo. Dime una cifra mensual, por ejemplo: «¿qué pasa si pago 500 más a mi tarjeta?».' };
    const inputs = { ahorro_extra: 0, cambio_gasto: 0, pago_extra_deuda: 0, ingreso_extra: 0 };
    let what;
    if (/deuda|tarjeta|prestamo|credito|pago/.test(t) && !/ahorr/.test(t)) {
      inputs.pago_extra_deuda = amount.toFixed(2);
      what = `pagas ${f(amount)} extra al mes a tus deudas`;
    } else if (/gast|recort|reduzc|menos/.test(t)) {
      inputs.cambio_gasto = amount.neg().toFixed(2);
      what = `gastas ${f(amount)} menos al mes`;
    } else if (/gan|ingreso|extra|cobr/.test(t)) {
      inputs.ingreso_extra = amount.toFixed(2);
      what = `ganas ${f(amount)} extra al mes (supuesto)`;
    } else {
      inputs.ahorro_extra = amount.toFixed(2);
      what = `ahorras ${f(amount)} más al mes`;
    }
    const sim = tracker.simulate(userId, inputs);
    if (!sim) return { text: 'Aún no tengo cifras para simular. Completa tu evaluación profunda o registra tu presupuesto del mes.' };
    const b = sim.base;
    const s = sim.scenario;
    let msg = `Es una consulta hipotética: no cambia tus datos. Si ${what}, tu saldo libre del mes pasaría de ${f(b.free)} a ${f(s.free)}`;
    if (b.debtMonths || s.debtMonths) msg += `, y saldrías de deudas en ${s.debtMonths ? `${s.debtMonths} meses` : 'un plazo no alcanzable'} en lugar de ${b.debtMonths ? `${b.debtMonths}` : 'un plazo no alcanzable'}`;
    if (b.debtInterest && s.debtInterest && new D(b.debtInterest).gt(s.debtInterest)) msg += `, pagando ${f(new D(b.debtInterest).minus(s.debtInterest))} menos de intereses`;
    msg += '.';
    if (new D(s.free).lt(0)) msg += ' Ojo: ese escenario deja tu saldo libre en negativo.';
    return { text: msg, simulation: sim };
  }
  if (/(gaste|pague|cobre|recibi|deposite|ahorre|registra|anota|apunta)/.test(t) && amount) {
    let kind = 'gasto';
    let category = 'otros';
    if (/cobre|recibi|me pagaron|ingreso/.test(t)) {
      kind = 'ingreso';
      category = /extra/.test(t) ? 'extra' : 'sueldo';
    } else if (/ahorre|deposite|aparte/.test(t)) {
      kind = 'ahorro';
      category = /reserva|emergencia/.test(t) ? 'reserva' : 'otros';
    } else if (/tarjeta|prestamo|credito|deuda|cuota/.test(t)) {
      kind = 'pago_deuda';
      category = /extra/.test(t) ? 'extra' : 'cuota';
    } else {
      for (const [re, k, cat] of CATEGORY_WORDS) if (re.test(t)) {
        kind = k;
        category = cat;
        break;
      }
    }
    const b = buildProposal(userId, 'registrar_movimiento', { tipo: kind, categoria: category, importe: amount.toFixed(2), fecha: new Date().toISOString().slice(0, 10), nota: String(text).slice(0, 80) });
    if (b.error) return { text: `No pude preparar el registro: ${b.error}` };
    return { text: `Te propongo registrar este movimiento. Revisa los datos y confírmalo si es correcto; si no, descártalo.`, proposal: b.proposal };
  }
  if (/(termine|complete|ya hice|ya lo hice|listo|hecho|ya quedo)/.test(t)) {
    if (!nextTask) return { text: 'No tienes tareas pendientes ahora mismo.' };
    const b = buildProposal(userId, 'completar_tarea', { tarea_id: nextTask.id });
    return { text: `¡Bien! ¿Te refieres a «${nextTask.title}»? Confírmalo si ya cumpliste el criterio: ${nextTask.done_criteria}`, proposal: b.proposal };
  }
  if (/(explica|por que|como se calcula|que significa|saldo|tasa de ahorro)/.test(t) && ctx.diagnostico) {
    const d = ctx.diagnostico;
    return { text: `Tu saldo disponible es lo que queda después de restar a tus ingresos (${d.ingresos_mes}) tus gastos (${d.gastos_mes}) y tus pagos de deuda (${d.pagos_deuda_mes}): ${d.saldo_disponible} al mes. La tasa de ahorro es lo que apartas dividido entre lo que ganas${d.tasa_ahorro ? `: ${d.tasa_ahorro}` : ''}.${recalc}` };
  }
  if (nextTask) {
    return { text: `Tu siguiente paso: ${nextTask.title}. Por qué: ${nextTask.reason || 'es la acción más próxima de tu plan.'} Lo darás por terminado cuando: ${nextTask.done_criteria || 'lo hayas hecho y registrado.'}${recalc}` };
  }
  const b = buildProposal(userId, 'crear_tarea', { titulo: 'Registra tus gastos de esta semana', motivo: 'Comparar lo previsto con lo real muestra dónde ajustar.', criterio: 'Tienes siete días de movimientos registrados.' });
  return { text: `No tienes tareas pendientes. Te propongo una acción concreta para esta semana.${recalc}`, proposal: b.proposal };
}

/** Procesa un mensaje de la persona y guarda la respuesta. Nunca pierde la conversación. */
async function send(userId, text) {
  const conv = conversation(userId);
  const clean = String(text || '').trim().slice(0, 2000);
  if (!clean) return { error: 'Escribe un mensaje.' };
  const history = messages(conv.id, userId).filter((m) => m.role !== 'sistema').slice(-20);
  addMessage(conv, userId, { role: 'usuario', content: clean });
  const ctx = context(userId);
  try {
    let out;
    if (ai.providerName() === 'anthropic') {
      out = await anthropicReply(userId, clean, ctx, history);
    } else {
      const local = localReply(userId, clean, ctx);
      const res = await ai.call({
        userId,
        purpose: 'coach',
        promptVersion: prompts.COACH_PROMPT_VERSION,
        system: prompts.COACH_SYSTEM,
        messages: [{ role: 'user', content: clean }],
        input: { contexto: ctx, mensaje: clean },
        localFn: async () => ({ content: [{ type: 'text', text: local.text }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } }),
      });
      out = { ...local, runId: res.runId };
    }
    const kind = out.proposal ? 'propuesta' : out.simulation ? 'hipotetico' : 'normal';
    addMessage(conv, userId, { role: 'coach', kind, content: out.text || 'Listo.', data: out.simulation ? { simulation: out.simulation } : null, proposal: out.proposal || null, aiRunId: out.runId || null });
    return { ok: true };
  } catch (e) {
    const msg =
      e.code === 'limite_cuenta'
        ? 'Alcanzaste el límite mensual de mensajes con el coach. Tu conversación se conserva; podrás seguir el próximo mes. Mientras tanto, tu plan y tu tablero siguen disponibles.'
        : e.code === 'limite_global'
          ? 'El coach alcanzó su límite de uso de este mes. Tu conversación se conserva y podrás retomarla cuando se restablezca.'
          : e.code === 'rechazo'
            ? 'El coach no pudo responder a este mensaje. Prueba a reformularlo.'
            : 'El coach no está disponible en este momento porque el proveedor de IA no respondió. Tu mensaje quedó guardado; inténtalo de nuevo en unos minutos.';
    addMessage(conv, userId, { role: 'sistema', kind: 'error', content: msg });
    return { ok: false, error: e.code || 'error' };
  }
}

module.exports = { conversation, messages, send, confirm, discard, context, describeProposal, TOOLS, localReply, buildProposal };
