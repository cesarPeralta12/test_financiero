'use strict';
// API de insights y gráficos (docs/coach-v2/04 §4): /api/v1/insights y /api/v1/graficos/:tipo.
// Solo cifras y textos calculados por el servidor; la IA no interviene. Acceso: acompañamiento.
const express = require('express');
const tracker = require('../domain/tracker');
const insights = require('../domain/coach/insights');
const G = require('../domain/coach/graficos');

const lista = express.Router();
const graficos = express.Router();
const fail = (res, status, codigo, mensaje) => res.status(status).json({ error: { codigo, mensaje } });
const mes = (req) => tracker.validMonth(req.query.mes) || tracker.currentMonth();
// El contrato público no expone el campo interno `grupo`.
const publica = (i) => {
  const { grupo, ...rest } = i;
  void grupo;
  return rest;
};

lista.get('/', (req, res) => {
  const max = Math.min(10, Math.max(1, Number.parseInt(req.query.max, 10) || 5));
  const r = insights.listar(req.user.id, { mes: mes(req), max });
  res.json({ mes: r.mes, moneda: r.moneda, insights: r.insights.map(publica), mas: r.mas.map(publica), total: r.total, catalog_version: r.catalog_version });
});

lista.post('/:id/descartar', (req, res) => {
  const mesId = tracker.validMonth(String(req.params.id).split(':')[1]) || tracker.currentMonth();
  const { insights: todos } = insights.calcular(req.user.id, { mes: mesId });
  const i = todos.find((x) => x.id === req.params.id);
  if (!i || !i.descartable) return fail(res, 404, 'NO_ENCONTRADO', 'No encontrado.');
  insights.descartar(req.user.id, i.id, i.severidad);
  res.json({ descartado: i.id, vuelve_en: i.severidad === 'alerta' ? '24 horas' : '7 días' });
});

graficos.get('/:tipo', (req, res) => {
  const r = insights.grafico(req.user.id, req.params.tipo, { mes: mes(req) });
  if (r.error === 'TIPO_DESCONOCIDO') return fail(res, 404, 'NO_ENCONTRADO', `Tipos disponibles: ${G.TIPOS.join(', ')}.`);
  if (r.error) return fail(res, 404, 'SIN_DATOS', 'Aún no hay datos suficientes para este gráfico.');
  res.json(r.grafico);
});

module.exports = { insights: lista, graficos };
