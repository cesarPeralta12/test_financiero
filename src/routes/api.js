'use strict';
// API JSON (sesión del navegador + cabecera X-CSRF-Token en escrituras).
// Aplica exactamente los mismos permisos y la misma propiedad de registros que la web.
const express = require('express');
const db = require('../db');
const entitlements = require('../domain/entitlements');
const qs = require('../domain/questionnaire');
const tracker = require('../domain/tracker');
const coach = require('../domain/coach');
const { requireUser, requireEntitlement } = require('./guards');
const { intParam, wrap } = require('./util');

const router = express.Router();
router.use(requireUser);

const nf = (res) => res.status(404).json({ error: 'no_encontrado', mensaje: 'No encontrado.' });

router.get('/yo', (req, res) => {
  res.json({ id: req.user.id, correo: req.user.email, moneda: req.user.base_currency, accesos: entitlements.active(req.user.id) });
});

router.get('/evaluacion-profunda', requireEntitlement('evaluacion_profunda'), (req, res) => {
  const ev = qs.findEvaluation('profundo', { userId: req.user.id });
  if (!ev) return res.json({ estado: 'sin_empezar' });
  const qn = qs.load(ev.questionnaire_id);
  const st = qs.status(ev, qn, qs.answers(ev.id));
  res.json({ id: ev.id, estado: ev.status, version: qn.version, respondidas: st.done, total: st.total, faltan: st.missing.length });
});

router.get('/diagnosticos', requireEntitlement('evaluacion_profunda'), (req, res) => {
  res.json(db.all('SELECT id, created_at, calc_version, rule_set_id FROM diagnoses WHERE user_id = ? ORDER BY id DESC', req.user.id));
});

router.get('/diagnosticos/:id', requireUser, (req, res) => {
  const d = db.one('SELECT * FROM diagnoses WHERE id = ? AND user_id = ?', intParam(req.params.id), req.user.id);
  if (!d) return nf(res);
  res.json({ id: d.id, fecha: d.created_at, version_calculo: d.calc_version, resultado: JSON.parse(d.result_json) });
});

router.get('/planes', requireEntitlement('plan_maestro'), (req, res) => {
  res.json(db.all('SELECT id, version_number AS version, status AS estado, start_date AS dia_uno, is_current AS vigente, created_at, completed_at FROM plan_versions WHERE user_id = ? ORDER BY version_number DESC', req.user.id));
});

router.get('/planes/:id', requireEntitlement('plan_maestro'), (req, res) => {
  const p = db.one('SELECT * FROM plan_versions WHERE id = ? AND user_id = ?', intParam(req.params.id), req.user.id);
  if (!p) return nf(res);
  res.json({ id: p.id, version: p.version_number, estado: p.status, dia_uno: p.start_date, contenido: db.parse(p.content_json), explicaciones: db.parse(p.narrative_json) });
});

router.get('/coach/mensajes', requireEntitlement('acompanamiento'), (req, res) => {
  const conv = coach.conversation(req.user.id);
  res.json(coach.messages(conv.id, req.user.id).map((m) => ({ id: m.id, rol: m.role, tipo: m.kind, contenido: m.content, propuesta: db.parse(m.proposal_json), estado_propuesta: m.proposal_status, fecha: m.created_at })));
});

router.post('/coach/mensajes', requireEntitlement('acompanamiento'), wrap(async (req, res) => {
  const r = await coach.send(req.user.id, req.body && req.body.mensaje);
  res.status(r.error && !r.ok ? 202 : 201).json(r);
}));

router.get('/movimientos', requireEntitlement('acompanamiento'), (req, res) => {
  const month = tracker.validMonth(req.query.mes) || tracker.currentMonth();
  res.json({ mes: month, movimientos: tracker.listMovements(req.user.id, month) });
});

router.post('/simulador', requireEntitlement('acompanamiento'), (req, res) => {
  const p = tracker.parseSimInputs(req.user.id, req.body || {});
  if (!p.ok) return res.status(422).json({ error: 'datos_invalidos', errores: p.errors });
  const r = tracker.simulate(req.user.id, p.value);
  if (!r) return res.status(409).json({ error: 'sin_base', mensaje: 'Completa la evaluación profunda o registra un presupuesto.' });
  res.json(r);
});

router.get('/escenarios', requireEntitlement('acompanamiento'), (req, res) => {
  res.json(db.all('SELECT id, name, base_source, inputs_json, results_json, created_at FROM scenarios WHERE user_id = ? ORDER BY id DESC', req.user.id).map((s) => ({ ...s, inputs_json: undefined, results_json: undefined, entradas: JSON.parse(s.inputs_json), resultados: JSON.parse(s.results_json) })));
});

router.use((req, res) => nf(res));

module.exports = router;
