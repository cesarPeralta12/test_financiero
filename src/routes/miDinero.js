'use strict';
// «Mi dinero» (Coach v2, S2): pantalla de registro rápido, resumen y lista.
// Acceso: acompañamiento, o cualquier cuenta si la bandera `coach_v2_registro_rapido` está abierta (decisión D1).
const express = require('express');
const tracker = require('../domain/tracker');
const money = require('../lib/money');
const view = require('../views/miDinero');
const atajosView = require('../views/atajos');
const recurrentes = require('../domain/coach/recurrentes');
const plantillas = require('../domain/coach/plantillas');
const recordatorios = require('../domain/coach/recordatorios');
const { requireMoneyAccess, requireEntitlement } = require('./guards');
const entitlements = require('../domain/entitlements');
const insights = require('../domain/coach/insights');
const G = require('../domain/coach/graficos');
const { intParam, notFound } = require('./util');

const router = express.Router();
router.use(['/mi-dinero'], requireMoneyAccess);

const today = () => new Date().toISOString().slice(0, 10);
const page = (res, title, body, extra = {}) => res.active('midinero').page({ title: `${title} | Mi dinero`, wide: true, body, ...extra });

// ───────── Hub ─────────
router.get('/mi-dinero', (req, res) => {
  const userId = req.user.id;
  const month = tracker.validMonth(req.query.mes) || tracker.currentMonth();
  const summary = tracker.summaryDetail(userId, month);
  const recent = tracker.findMovements(userId, { mes: month, limite: 30, orden: 'fecha_desc' }).items;
  // Las observaciones son análisis (acompañamiento); el registro y el resumen son de todos si la bandera está abierta.
  const obs = entitlements.has(userId, 'acompanamiento') ? insights.listar(userId, { mes: month, max: 3 }) : null;
  page(res, 'Resumen', view.hub(res.locals.ctx, { userId, month, today: today(), cur: tracker.baseCurrency(userId), summary, recent, obs }));
});

// ───────── Análisis: gráficos y todas las observaciones ─────────
router.get('/mi-dinero/analisis', requireEntitlement('acompanamiento'), (req, res) => {
  const userId = req.user.id;
  const month = tracker.validMonth(req.query.mes) || tracker.currentMonth();
  const obs = insights.listar(userId, { mes: month, max: 50 });
  const tipos = ['barra_ingreso_gasto', 'barras_categorias', 'cascada_mes', 'tendencia_vs_ritmo', 'mapa_semana', 'mes_a_mes'];
  const graficos = tipos.map((t) => insights.grafico(userId, t, { mes: month }).grafico).filter(Boolean);
  void G;
  page(res, 'Análisis', view.analisisPage(res.locals.ctx, { month, obs, graficos }));
});

router.post('/mi-dinero/observaciones/descartar', requireEntitlement('acompanamiento'), (req, res) => {
  const id = String(req.body.id || '');
  const mes = tracker.validMonth(id.split(':')[1]) || tracker.currentMonth();
  const { insights: todos } = insights.calcular(req.user.id, { mes });
  const i = todos.find((x) => x.id === id);
  if (i && i.descartable) insights.descartar(req.user.id, i.id, i.severidad);
  res.redirect(303, `/mi-dinero?mes=${mes}&aviso=observacion_descartada`);
});

// ───────── Lista completa ─────────
router.get('/mi-dinero/movimientos', (req, res) => {
  const userId = req.user.id;
  const month = tracker.validMonth(req.query.mes) || tracker.currentMonth();
  // De 20 en 20 (los más recientes primero); con «desde/hasta» se busca en ese rango de fechas en vez de en un mes.
  const r = tracker.findMovements(userId, { ...req.query, mes: month, limite: req.query.limite || 20 });
  page(res, 'Movimientos', view.listPage(res.locals.ctx, { month, cur: tracker.baseCurrency(userId), r, query: req.query, today: today() }));
});

// ───────── Registrar sin JavaScript ─────────
function bodyToMovement(body) {
  const [kind, category] = String(body.kindcat || '').split(':');
  return { ...body, kind, category };
}

/** Valida y avisa de importes altos y duplicados; con `confirmar` se guarda igual. */
function check(userId, body) {
  const v = tracker.validateMovement(userId, bodyToMovement(body));
  if (!v.ok) return { v, errors: v.errors };
  if (Date.parse(v.value.date) > Date.now() + 86400000) return { v, errors: { date: 'La fecha está en el futuro. Lo previsto va en tu presupuesto.' } };
  if (body.confirmar !== '1') {
    if (tracker.isLargeExpense(userId, v.value.kind, v.value.amount)) return { v, confirm: 'Es un gasto mucho más grande que lo habitual. ¿Es correcto?' };
    if (tracker.findDuplicate(userId, v.value)) return { v, confirm: 'Acabas de registrar algo igual. ¿Quieres guardarlo otra vez?' };
  }
  return { v };
}

function newForm(req, res, extra = {}) {
  const userId = req.user.id;
  page(res, 'Registrar', view.formPage(res.locals.ctx, { userId, cur: tracker.baseCurrency(userId), action: '/mi-dinero/nuevo', submit: 'Guardar', title: 'Registrar', ...extra }));
}

router.get('/mi-dinero/nuevo', (req, res) => newForm(req, res, { form: {} }));

router.post('/mi-dinero/nuevo', (req, res) => {
  const { v, errors, confirm } = check(req.user.id, req.body);
  if (errors || confirm) return res.status(422), newForm(req, res, { form: req.body, errors: errors || {}, confirm });
  tracker.createMovement(req.user.id, v.value);
  res.redirect(303, `/mi-dinero?mes=${v.value.date.slice(0, 7)}&aviso=guardado`);
});

// ───────── Editar, eliminar, restaurar ─────────
function editForm(req, res, m, extra = {}) {
  const userId = req.user.id;
  page(res, 'Editar', view.formPage(res.locals.ctx, {
    userId,
    cur: tracker.baseCurrency(userId),
    action: `/mi-dinero/movimientos/${m.id}`,
    deleteAction: `/mi-dinero/movimientos/${m.id}/eliminar`,
    submit: 'Guardar cambios',
    title: 'Editar movimiento',
    form: { amount: m.amount, kindcat: `${m.kind}:${m.category}`, date: m.date, note: m.note },
    ...extra,
  }));
}

router.get('/mi-dinero/movimientos/:id', (req, res, next) => {
  const id = intParam(req.params.id);
  const m = id && tracker.getMovement(req.user.id, id);
  if (!m) return next(notFound());
  editForm(req, res, m);
});

router.post('/mi-dinero/movimientos/:id', (req, res, next) => {
  const id = intParam(req.params.id);
  const m = id && tracker.getMovement(req.user.id, id);
  if (!m) return next(notFound());
  const v = tracker.validateMovement(req.user.id, bodyToMovement(req.body));
  if (!v.ok) return res.status(422), editForm(req, res, m, { form: req.body, errors: v.errors });
  tracker.updateMovement(req.user.id, id, v.value);
  res.redirect(303, `/mi-dinero?mes=${v.value.date.slice(0, 7)}&aviso=guardado`);
});

router.post('/mi-dinero/movimientos/:id/eliminar', (req, res, next) => {
  const id = intParam(req.params.id);
  const m = id && tracker.getMovement(req.user.id, id);
  if (!m) return next(notFound());
  tracker.softDeleteMovement(req.user.id, id);
  res.redirect(303, `/mi-dinero?mes=${m.date.slice(0, 7)}&aviso=eliminado&deshacer=${id}`);
});

router.post('/mi-dinero/movimientos/:id/restaurar', (req, res, next) => {
  const id = intParam(req.params.id);
  const r = id ? tracker.restoreMovement(req.user.id, id) : { error: 'NO_ENCONTRADO' };
  if (r.error === 'NO_ENCONTRADO') return next(notFound());
  res.redirect(303, `/mi-dinero?aviso=${r.error === 'PLAZO_VENCIDO' ? 'plazo_vencido' : 'restaurado'}`);
});

// ───────── Repetir el último ─────────
router.post('/mi-dinero/repetir', (req, res) => {
  const last = tracker.lastMovement(req.user.id);
  if (!last) return res.redirect(303, '/mi-dinero?aviso=sin_movimientos');
  const v = tracker.validateMovement(req.user.id, { kind: last.kind, category: last.category, subcategory: last.subcategory, amount: last.amount, date: today(), note: last.note, debt_id: last.debt_id, goal_id: last.goal_id, to_goal_id: last.to_goal_id });
  if (!v.ok) return res.redirect(303, '/mi-dinero/nuevo');
  tracker.createMovement(req.user.id, v.value);
  res.redirect(303, '/mi-dinero?aviso=repetido');
});

// ───────── Recurrentes y atajos (S7) ─────────
function atajosPage(req, res, extra = {}) {
  const userId = req.user.id;
  const hoy = today();
  if (extra.status) res.status(extra.status);
  page(res, 'Recurrentes y atajos', atajosView.page(res.locals.ctx, {
    userId,
    cur: tracker.baseCurrency(userId),
    recurrentes: recurrentes.listar(userId),
    propuestos: recurrentes.detectar(userId, hoy),
    plantillas: plantillas.listar(userId),
    candidatas: plantillas.candidatas(userId, hoy),
    recordatorios: recordatorios.activos(userId),
    ...extra,
  }));
}
const splitKc = (b) => {
  const [kind, category] = String(b.kindcat || '').split(':');
  return { tipo: kind, categoria: category };
};

router.get('/mi-dinero/atajos', (req, res) => atajosPage(req, res));

router.post('/mi-dinero/atajos/recurrentes', (req, res) => {
  const b = req.body || {};
  const r = recurrentes.crear(req.user.id, { ...splitKc(b), monto: b.amount, nota: b.note, dia: b.day }, today());
  if (!r.ok) return atajosPage(req, res, { status: 422, errors: { amount: r.error }, form: b });
  res.redirect(303, '/mi-dinero/atajos?aviso=guardado');
});
router.post('/mi-dinero/atajos/recurrentes/descartar', (req, res) => {
  recurrentes.descartar(req.user.id, req.body.clave);
  res.redirect(303, '/mi-dinero/atajos');
});
for (const accion of ['pausar', 'reanudar', 'eliminar']) {
  router.post(`/mi-dinero/atajos/recurrentes/:id/${accion}`, (req, res, next) => {
    const id = intParam(req.params.id);
    if (!id || !recurrentes.obtener(req.user.id, id)) return next(notFound());
    if (accion === 'eliminar') recurrentes.eliminar(req.user.id, id);
    else recurrentes.pausar(req.user.id, id, accion === 'reanudar');
    res.redirect(303, '/mi-dinero/atajos');
  });
}

router.post('/mi-dinero/atajos/plantillas', (req, res) => {
  const b = req.body || {};
  const r = plantillas.crear(req.user.id, { ...splitKc(b), etiqueta: b.label, monto: b.amount });
  if (!r.ok) return atajosPage(req, res, { status: 422, errorsP: { amount: r.error }, formP: b });
  res.redirect(303, '/mi-dinero/atajos?aviso=guardado');
});
router.post('/mi-dinero/atajos/plantillas/:id/usar', (req, res, next) => {
  const id = intParam(req.params.id);
  if (!id) return next(notFound());
  const r = plantillas.usar(req.user.id, id, today());
  if (!r.ok) return next(notFound());
  res.redirect(303, '/mi-dinero?aviso=guardado');
});
router.post('/mi-dinero/atajos/plantillas/:id/eliminar', (req, res, next) => {
  const id = intParam(req.params.id);
  if (!id || !plantillas.eliminar(req.user.id, id)) return next(notFound());
  res.redirect(303, '/mi-dinero/atajos');
});
router.post('/mi-dinero/atajos/recordatorios', (req, res) => {
  recordatorios.apagar(req.user.id, req.body.activos === '1');
  res.redirect(303, '/mi-dinero/atajos?aviso=guardado');
});

module.exports = router;
