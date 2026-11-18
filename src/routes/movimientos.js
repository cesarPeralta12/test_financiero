'use strict';
// API de movimientos del Coach v2 (docs/coach-v2/04 §4): /api/v1/movimientos.
// Contrato en español, errores con códigos estables, escritura idempotente, borrado suave con «deshacer»
// y avisos de importe alto y duplicado. Todas las consultas filtran por la cuenta de la sesión.
const express = require('express');
const db = require('../db');
const tracker = require('../domain/tracker');
const pistas = require('../domain/coach/pistas');
const parser = require('../domain/coach/parser');
const { normalizar } = require('../domain/coach/normalizar');
const { conTildes } = require('../domain/coach/nota');
const money = require('../lib/money');
const { sha256 } = require('../lib/security');
const { intParam } = require('./util');

const router = express.Router();

const fail = (res, status, codigo, mensaje, extra = {}) => res.status(status).json({ error: { codigo, mensaje, ...extra } });
const today = () => new Date().toISOString().slice(0, 10);
const ORIGENES = ['usuario', 'texto', 'boton', 'coach', 'recurrente', 'plantilla'];

function view(m) {
  return {
    id: m.id,
    fecha: m.date,
    tipo: m.kind,
    categoria: m.category,
    subcategoria: m.subcategory || null,
    importe: m.amount,
    moneda: m.currency,
    nota: m.note || null,
    deuda_id: m.debt_id || null,
    meta_id: m.goal_id || null,
    meta_destino_id: m.to_goal_id || null,
    origen: m.source,
    creado_en: m.created_at,
  };
}

function shortSummary(userId, month) {
  const s = tracker.summaryDetail(userId, month);
  return { mes: s.mes, gasto: s.gasto, ingreso: s.ingreso, saldo: s.saldo };
}

/** Contrato en español → campos del dominio. Los importes viajan como texto, nunca como número flotante. */
function toDomain(body) {
  const amount = body.importe === undefined || body.importe === null ? undefined : String(body.importe);
  return {
    kind: body.tipo,
    category: body.categoria,
    subcategory: body.subcategoria || null,
    amount,
    date: body.fecha,
    note: body.nota,
    currency: body.moneda,
    debt_id: body.deuda_id,
    goal_id: body.meta_id,
    to_goal_id: body.meta_destino_id,
  };
}

const FIELD_CODE = {
  amount: ['IMPORTE_INVALIDO', 'importe'],
  date: ['FECHA_INVALIDA', 'fecha'],
  kind: ['CATEGORIA_INVALIDA', 'tipo'],
  category: ['CATEGORIA_INVALIDA', 'categoria'],
  subcategory: ['CATEGORIA_INVALIDA', 'subcategoria'],
  currency: ['MONEDA_DISTINTA', 'moneda'],
  debt_id: ['DATOS_INVALIDOS', 'deuda_id'],
  goal_id: ['DATOS_INVALIDOS', 'meta_id'],
  to_goal_id: ['DATOS_INVALIDOS', 'meta_destino_id'],
};

function validationError(res, errors) {
  const [field, message] = Object.entries(errors)[0];
  const [codigo, campo] = FIELD_CODE[field] || ['DATOS_INVALIDOS', field];
  return fail(res, 422, codigo, message, { campo });
}

/** La API no admite fechas futuras (lo previsto va en presupuesto y recurrentes). Margen de un día por zona horaria. */
function futureDate(date) {
  return Date.parse(date) > Date.now() + 86400000;
}

function origin(body) {
  return ORIGENES.includes(body.origen) ? body.origen : 'usuario';
}

// ───────── Línea inteligente: vista previa sin IA ─────────
// «250 súper», «cobré 800», «luz 80»: el parser (reglas) entiende el texto; no se llama a ningún modelo.
router.post('/vista-previa', (req, res) => {
  const texto = String((req.body && req.body.texto) || '').slice(0, 200);
  const cur = tracker.baseCurrency(req.user.id);
  const r = parser.parsear(texto, { hoy: today(), moneda: cur });
  const e = r.entidades || {};
  const notaNorm = e.nota;
  if (e.nota) e.nota = conTildes(texto, e.nota); // «café», no «cafe»
  const registro = String(r.intencion || '').startsWith('registrar') || Boolean(e.importe);
  if (!registro || !texto.trim()) return res.json({ registro: false, intencion: r.intencion, mensaje: 'Escribe algo como «250 súper» o «cobré 800».' });
  // Lo que la persona ya corrigió antes tiene prioridad sobre el diccionario: si movió «gasolina» a Otros, se respeta.
  const falta = [...r.falta];
  if (e.tipo && e.nota) {
    const hint = pistas.lookup(req.user.id, normalizar(notaNorm), e.tipo);
    if (hint) {
      e.categoria = hint.category;
      e.subcategoria = hint.subcategory;
      falta.splice(0, falta.length, ...falta.filter((f) => f !== 'categoria'));
    }
  }
  const kind = e.tipo;
  const label = kind && e.categoria ? tracker.CATEGORIES[kind][e.categoria] || null : null;
  res.json({
    registro: true,
    completo: falta.length === 0 && Boolean(kind && e.importe && e.categoria),
    falta,
    vista: {
      tipo: kind || null,
      tipo_etiqueta: kind ? tracker.KINDS[kind] : null,
      importe: e.importe || null,
      importe_formato: e.importe ? money.format(e.importe, cur) : null,
      categoria: e.categoria || null,
      etiqueta: label,
      subcategoria: e.subcategoria || null,
      fecha: e.fecha || null,
      nota: e.nota || null,
    },
    movimiento: { tipo: kind || null, categoria: e.categoria || null, subcategoria: e.subcategoria || null, importe: e.importe || null, fecha: e.fecha || today(), nota: e.nota || null, origen: 'texto' },
  });
});

// ───────── Lista ─────────
router.get('/', (req, res) => {
  const q = req.query;
  const r = tracker.findMovements(req.user.id, q);
  const mes = tracker.validMonth(q.mes) || tracker.currentMonth();
  res.json({
    mes,
    movimientos: r.items, // formato anterior (se mantiene mientras migran las pantallas)
    items: r.items.map(view),
    total: r.total,
    pagina: r.page,
    limite: r.limit,
    orden: r.order,
    resumen: shortSummary(req.user.id, mes),
  });
});

// ───────── Crear (idempotente) ─────────
const KEY = /^[A-Za-z0-9._:-]{8,64}$/;

router.post('/', (req, res) => {
  const body = req.body || {};
  const key = req.get('idempotency-key') || body.idempotency_key || null;
  if (key && !KEY.test(String(key))) return fail(res, 422, 'DATOS_INVALIDOS', 'La clave de idempotencia no es válida.', { campo: 'idempotency_key' });
  const { idempotency_key: _k, ...rest } = body;
  const hash = sha256(JSON.stringify(rest, Object.keys(rest).sort()));
  if (key) {
    const prev = db.one('SELECT request_hash, status, response_json FROM idempotency_keys WHERE user_id = ? AND key = ?', req.user.id, key);
    if (prev) {
      if (prev.request_hash !== hash) return fail(res, 409, 'IDEMPOTENCIA_CONFLICTO', 'Esa clave ya se usó con otro contenido.');
      return res.status(prev.status).set('Idempotent-Replayed', 'true').json(JSON.parse(prev.response_json));
    }
  }
  const d = toDomain(body);
  if (d.date === undefined || d.date === '') d.date = today();
  const v = tracker.validateMovement(req.user.id, d);
  if (!v.ok) return validationError(res, v.errors);
  if (futureDate(v.value.date)) return fail(res, 422, 'FECHA_INVALIDA', 'La fecha está en el futuro. Los pagos previstos van en tu presupuesto o como recurrentes.', { campo: 'fecha' });
  if (tracker.isLargeExpense(req.user.id, v.value.kind, v.value.amount) && body.confirmar_importe_alto !== true) {
    return fail(res, 422, 'IMPORTE_ALTO_REQUIERE_CONFIRMAR', 'Es un gasto mucho más grande que lo habitual. ¿Es correcto?', { campo: 'importe' });
  }
  const dup = tracker.findDuplicate(req.user.id, v.value);
  if (dup && body.confirmar_duplicado !== true) {
    return fail(res, 422, 'DUPLICADO_POSIBLE', 'Acabas de registrar algo igual. ¿Quieres guardarlo otra vez?', { duplicado_id: dup.id });
  }
  const out = db.tx(() => {
    const id = tracker.createMovement(req.user.id, v.value, origin(body));
    const response = {
      movimiento: view(tracker.getMovement(req.user.id, id)),
      resumen: shortSummary(req.user.id, v.value.date.slice(0, 7)),
      deshacer_hasta: new Date(Date.now() + tracker.UNDO_SECONDS * 1000).toISOString(),
    };
    if (key) db.run('INSERT INTO idempotency_keys (user_id, key, request_hash, status, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)', req.user.id, key, hash, 201, JSON.stringify(response), db.now());
    return response;
  });
  res.status(201).json(out);
});

// ───────── Editar ─────────
router.put('/:id', (req, res) => {
  const id = intParam(req.params.id);
  const cur = id ? tracker.getMovement(req.user.id, id) : null;
  if (!cur) return fail(res, 404, 'NO_ENCONTRADO', 'No encontrado.');
  const body = req.body || {};
  const patch = toDomain(body);
  const merged = {
    kind: cur.kind,
    category: cur.category,
    subcategory: cur.subcategory,
    amount: cur.amount,
    date: cur.date,
    note: cur.note,
    currency: cur.currency,
    debt_id: cur.debt_id,
    goal_id: cur.goal_id,
    to_goal_id: cur.to_goal_id,
  };
  for (const [k, val] of Object.entries(patch)) if (val !== undefined && !(k === 'subcategory' && body.subcategoria === undefined)) merged[k] = val;
  // Cambiar el tipo sin elegir categoría de ese tipo es un error de categoría (no se adivina).
  const v = tracker.validateMovement(req.user.id, merged);
  if (!v.ok) return validationError(res, v.errors);
  if (v.value.date !== cur.date && futureDate(v.value.date)) return fail(res, 422, 'FECHA_INVALIDA', 'La fecha está en el futuro.', { campo: 'fecha' });
  db.tx(() => {
    tracker.updateMovement(req.user.id, id, v.value);
    if ((v.value.category !== cur.category || v.value.subcategory !== (cur.subcategory || null)) && v.value.noteNorm) {
      pistas.learn(req.user.id, v.value.noteNorm, v.value.kind, v.value.category, v.value.subcategory);
    }
  });
  res.json({ movimiento: view(tracker.getMovement(req.user.id, id)), resumen: shortSummary(req.user.id, v.value.date.slice(0, 7)) });
});

// ───────── Borrar y restaurar ─────────
router.delete('/:id', (req, res) => {
  const id = intParam(req.params.id);
  const r = id ? tracker.softDeleteMovement(req.user.id, id) : null;
  if (!r) return fail(res, 404, 'NO_ENCONTRADO', 'No encontrado.');
  res.json({ deshacer_hasta: r.undoUntil });
});

router.post('/:id/restaurar', (req, res) => {
  const id = intParam(req.params.id);
  const r = id ? tracker.restoreMovement(req.user.id, id) : { error: 'NO_ENCONTRADO' };
  if (r.error === 'NO_ENCONTRADO') return fail(res, 404, 'NO_ENCONTRADO', 'No encontrado.');
  if (r.error === 'PLAZO_VENCIDO') return fail(res, 409, 'PLAZO_VENCIDO', 'Ya pasó el tiempo para deshacer.');
  const m = tracker.getMovement(req.user.id, id);
  res.json({ movimiento: view(m), resumen: shortSummary(req.user.id, m.date.slice(0, 7)) });
});

module.exports = router;
