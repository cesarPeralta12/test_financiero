'use strict';
// Pipeline del Coach v2 sin IA (docs/coach-v2/03 §1): texto o botón → parser → manejador → mensaje del
// catálogo → respuesta con botones. El servidor decide y calcula; ningún modelo interviene en este corte.
const db = require('../../db');
const log = require('../../lib/log');
const money = require('../../lib/money');
const tracker = require('../tracker');
const coach = require('../coach');
const parser = require('./parser');
const pistas = require('./pistas');
const { normalizar } = require('./normalizar');
const { conTildes } = require('./nota');
const tasks = require('../tasks');
const iaRouter = require('./ia/router');
const recurrentes = require('./recurrentes');
const plantillas = require('./plantillas');
const mejora = require('./mejora');
const { propuestaTarea } = require('./tareas');
const { catalogo, INTENCIONES, CATALOG_VERSION } = require('./datos');
const { elegirVariante, renderizar } = require('./mensajes');
const I = require('./intenciones');
const conversacion = require('./conversacion');

const { D } = money;
const MAX_TEXTO = 500;
const VENTANA_DESHACER_MS = 10 * 60 * 1000; // «deshacer» por texto alcanza al último registro reciente
const ACCIONES = ['iniciar_registro', 'confirmar', 'cancelar', 'corregir', 'deshacer', 'consulta', 'repetir_ultimo', 'proponer_tarea', 'proponer_completar_tarea', 'pedir_ia', 'pedir_redaccion', 'crear_recurrente', 'descartar_recurrente', 'crear_plantilla'];
const KIND_OK_INTENT = { gasto: 'registrar_gasto_ok', ingreso: 'registrar_ingreso_ok', pago_deuda: 'registrar_pago_deuda_ok', ahorro: 'registrar_ahorro_ok', retiro_ahorro: 'registrar_retiro_ok' };
const CON_MENSAJE = ['confirmar', 'cancelar', 'corregir', 'deshacer', 'editar', 'proponer_tarea', 'proponer_completar_tarea', 'pedir_ia', 'pedir_redaccion', 'crear_recurrente', 'descartar_recurrente', 'crear_plantilla'];

class CoachError extends Error {
  constructor(status, codigo, mensaje) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

// ───────── Persistencia ─────────
function guardar(userId, convId, m) {
  return db.run(
    `INSERT INTO messages (conversation_id, user_id, role, kind, content, created_at, origin, intent, variant_id, confidence, catalog_version, payload_json)
     VALUES (?, ?, ?, 'normal', ?, ?, ?, ?, ?, ?, ?, ?)`,
    convId,
    userId,
    m.rol,
    m.contenido,
    db.now(),
    m.origen || null,
    m.intencion || null,
    m.varianteId || null,
    m.confianza ?? null,
    m.rol === 'coach' ? CATALOG_VERSION : null,
    m.payload ? JSON.stringify(m.payload) : null
  ).lastId;
}

const payloadDe = (id, userId) => {
  const row = db.one('SELECT id, payload_json FROM messages WHERE id = ? AND user_id = ? AND role = ?', id, userId, 'coach');
  return row ? { id: row.id, payload: db.parse(row.payload_json, {}) } : null;
};
const guardarPayload = (id, payload) => db.run('UPDATE messages SET payload_json = ? WHERE id = ?', JSON.stringify(payload), id);

/** Última propuesta de registro pendiente de la conversación (para «confirmar» sin id y correcciones por texto). */
function ultimaPendiente(userId, convId) {
  const rows = db.all("SELECT id, payload_json FROM messages WHERE conversation_id = ? AND user_id = ? AND role = 'coach' AND payload_json LIKE '%\"pendiente\"%' ORDER BY id DESC LIMIT 5", convId, userId);
  for (const r of rows) {
    const p = db.parse(r.payload_json, {});
    if (p.pendiente && p.pendiente.estado === 'pendiente') return { id: r.id, payload: p };
  }
  return null;
}

// ───────── Anotar conversando ─────────
const incompleta = (pd) => Boolean(pd && pd.estado === 'pendiente' && (!pd.tipo || pd.tipo === 'registro') && (!pd.propuesta.tipo || !pd.propuesta.importe || !pd.propuesta.categoria));

/** ¿El Coach preguntó un dato de un registro («¿cuánto fue?») y este texto corto parece contestarlo? */
function esperaDato(userId, texto) {
  if (/\?/.test(texto) || String(texto).trim().split(/\s+/).length > 5) return false;
  const pend = ultimaPendiente(userId, coach.conversation(userId).id);
  return Boolean(pend && incompleta(pend.payload.pendiente));
}

/** Completa el registro a medias con lo que la persona acaba de escribir. Devuelve la propuesta o null. */
function completar(c, r, texto, conv) {
  if (!esperaDato(c.userId, texto)) return null;
  const pd = ultimaPendiente(c.userId, conv.id).payload.pendiente;
  const p = { ...pd.propuesta };
  const e = r.entidades || {};
  if (p.tipo && e.tipo && p.tipo !== e.tipo) return null; // habla de otra cosa: registro nuevo
  if (p.importe && e.importe) return null; // trae otro importe: es un registro nuevo
  let cambio = false;
  const pon = (k, v) => {
    if (!p[k] && v) {
      p[k] = v;
      cambio = true;
    }
  };
  const t = normalizar(texto);
  pon('importe', e.importe);
  pon('tipo', e.tipo || (/^(gasto|gaste|fue gasto|un gasto)\b/.test(t) ? 'gasto' : /^(ingreso|un ingreso|recibi|cobre)\b/.test(t) ? 'ingreso' : null));
  if (p.tipo && !p.categoria) {
    const cats = tracker.CATEGORIES[p.tipo] || {};
    const porNombre = Object.keys(cats).find((k) => t === k || normalizar(cats[k]).split(' ').some((w) => w.length > 3 && t.split(' ').includes(w)));
    pon('categoria', (e.categoria && cats[e.categoria] && e.categoria) || porNombre);
  }
  return cambio ? proponer(c, p, pd.avisos || []) : null;
}

// ───────── Construcción del mensaje ─────────
function tonoDe(userId) {
  const prefs = db.parse(db.value('SELECT coach_prefs_json FROM users WHERE id = ?', userId), {});
  return ['cercano', 'neutral', 'motivador', 'directo', 'mixto'].includes(prefs && prefs.tono) ? prefs.tono : 'cercano';
}

function construir(userId, cur, id, vars, semilla) {
  const recientes = db.all('SELECT variant_id FROM messages WHERE user_id = ? AND intent = ? ORDER BY id DESC LIMIT 5', userId, id).map((r) => r.variant_id);
  const it = INTENCIONES[id];
  const variante = elegirVariante(it, vars, { tono: tonoDe(userId), recientes, semilla });
  // Una variante nunca sale a medias: si falta una variable, se prueba la siguiente y, en último caso, el error genérico.
  const orden = [variante, ...it.variantes.filter((v) => v.id !== variante.id)];
  for (const v of orden) {
    try {
      return { it, v, texto: renderizar(v.texto, vars, { moneda: cur }) };
    } catch (e) {
      log.error('Mensaje del Coach sin renderizar', { variante: v.id, motivo: e.message });
    }
  }
  const g = INTENCIONES.error_generico;
  return { it: g, v: g.variantes[0], texto: renderizar(g.variantes[0].texto, {}, { moneda: cur }) };
}

// Sin IA disponible no se ofrecen los botones «Preguntarle a la IA» ni «Explícamelo mejor».
const ACCIONES_IA = ['pedir_ia', 'pedir_redaccion'];

function botones(it, mensajeId) {
  const ia = iaRouter.disponible();
  return (it.botones || []).filter((b) => ia || !ACCIONES_IA.includes(catalogo.botones[b].accion)).map((b) => {
    const def = catalogo.botones[b];
    const out = { id: b, etiqueta: def.etiqueta, accion: def.accion };
    for (const k of ['params', 'destino', 'intencion', 'campo']) if (def[k] !== undefined) out[k] = def[k];
    if (CON_MENSAJE.includes(def.accion)) out.params = { ...(def.params || {}), mensaje_id: mensajeId };
    return out;
  });
}

// ───────── Registro: propuestas y confirmaciones ─────────
const SIN_NOTA = ['ahorro', 'retiro_ahorro', 'pago_deuda'];

function propuestaDe(c, ent) {
  const tipo = ent.tipo || null;
  let categoria = ent.categoria || null;
  let subcategoria = ent.subcategoria || null;
  const nota = ent.nota && !SIN_NOTA.includes(tipo) ? conTildes(c.texto, ent.nota) : null;
  if (tipo && nota) {
    const hint = pistas.lookup(c.userId, normalizar(nota), tipo); // lo que la persona corrigió antes manda
    if (hint) {
      categoria = hint.category;
      subcategoria = hint.subcategory;
    }
  }
  return { tipo, categoria, subcategoria, importe: ent.importe || null, fecha: ent.fecha || c.hoy, nota };
}

const aDominio = (p) => ({ kind: p.tipo, category: p.categoria, subcategory: p.subcategoria, amount: p.importe, date: p.fecha, note: p.nota });

/** ¿Qué falta o qué aviso corresponde antes de guardar? Devuelve { intencion, vars } o null si está listo. */
function revisar(c, p, avisos) {
  if (!p.tipo) return I.msg('aclarar_tipo', { monto: p.importe || '0' });
  if (!p.importe) return I.msg('aclarar_importe', p.categoria ? { categoria: I.catLabel(p.tipo, p.categoria) } : {});
  if (!p.categoria) return I.msg('aclarar_categoria', { monto: p.importe });
  const v = tracker.validateMovement(c.userId, aDominio(p));
  if (!v.ok) {
    if (v.errors.date) return I.msg('aclarar_fecha', {});
    if (v.errors.amount) return I.msg('aclarar_importe', { categoria: I.catLabel(p.tipo, p.categoria) });
    return I.msg('aclarar_categoria', { monto: p.importe });
  }
  if (!avisos.includes('fecha_futura') && Date.parse(v.value.date) > Date.now() + 86400000) return { ...I.msg('registro_fecha_futura', { fecha: v.value.date }), aviso: 'fecha_futura' };
  if (!avisos.includes('importe_alto') && tracker.isLargeExpense(c.userId, v.value.kind, v.value.amount)) return { ...I.msg('registro_importe_alto', { monto: v.value.amount, veces: 5 }), aviso: 'importe_alto' };
  if (!avisos.includes('duplicado') && tracker.findDuplicate(c.userId, v.value)) return { ...I.msg('registro_duplicado_posible', { monto: v.value.amount, categoria: I.catLabel(p.tipo, p.categoria), minutos: 10 }), aviso: 'duplicado' };
  return null;
}

function resultadoRegistro(c, p, avisos) {
  const falta = revisar(c, p, avisos);
  if (falta) return falta;
  return I.msg('registro_vista_previa', { tipo: I.kindLabel(p.tipo), monto: p.importe, categoria: I.catLabel(p.tipo, p.categoria), fecha: p.fecha });
}

/** Propuesta de registro con su estado: si lo que se muestra es un aviso, el siguiente «Confirmar» lo acepta. */
function proponer(c, p, avisos = []) {
  const res = resultadoRegistro(c, p, avisos);
  return { ...res, pendiente: { propuesta: p, avisos: res.aviso ? [...avisos, res.aviso] : [...avisos], estado: 'pendiente' } };
}

function guardarRegistro(c, p, origen = 'coach') {
  const v = tracker.validateMovement(c.userId, aDominio(p));
  if (!v.ok) throw new CoachError(422, 'DATOS_INVALIDOS', Object.values(v.errors)[0]);
  const primero = !db.value('SELECT 1 FROM movements WHERE user_id = ? AND deleted_at IS NULL LIMIT 1', c.userId);
  const id = db.tx(() => tracker.createMovement(c.userId, v.value, origen));
  const mes = v.value.date.slice(0, 7);
  const s = tracker.monthSummary(c.userId, mes);
  const base = { monto: v.value.amount, categoria: I.catLabel(v.value.kind, v.value.category), fecha: v.value.date };
  let r;
  if (v.value.kind === 'gasto') {
    const vars = { ...base, gasto_mes: s.gasto.toFixed(2) };
    const cat = s.byCategory[`gasto:${v.value.category}`];
    if (cat && s.gasto.gt(0)) vars.pct_categoria = Math.round(cat.div(s.gasto).times(100).toNumber());
    r = I.msg('registrar_gasto_ok', vars);
  } else if (v.value.kind === 'ingreso') r = I.msg('registrar_ingreso_ok', { ...base, ingreso_mes: s.ingreso.toFixed(2), saldo: s.balance.toFixed(2) });
  else if (v.value.kind === 'pago_deuda') r = I.msg('registrar_pago_deuda_ok', { monto: base.monto });
  else if (v.value.kind === 'ahorro') r = I.msg('registrar_ahorro_ok', { monto: base.monto });
  else r = I.msg('registrar_retiro_ok', { monto: base.monto });
  if (primero) r = I.msg('primer_registro');
  return { ...r, movimientoId: id };
}

function movimientoReciente(userId) {
  const m = tracker.lastMovement(userId);
  return m && Date.now() - Date.parse(m.created_at) <= VENTANA_DESHACER_MS ? m : null;
}

// ───────── Acciones (botones) ─────────
function accionar(c, sol, conv) {
  const { accion } = sol;
  if (!ACCIONES.includes(accion)) throw new CoachError(422, 'ACCION_NO_SOPORTADA', 'Esa acción se resuelve en la pantalla, no en el Coach.');
  if (accion === 'consulta') {
    const h = I.HANDLERS[sol.intencion];
    if (!h) throw new CoachError(422, 'ACCION_NO_SOPORTADA', 'No conozco esa consulta.');
    const out = h(c);
    return { ...out, intencion: out.intencion || sol.intencion };
  }
  if (accion === 'iniciar_registro') {
    const tipo = ['gasto', 'ingreso'].includes(sol.valor) ? sol.valor : 'gasto';
    const previa = ultimaPendiente(c.userId, conv.id);
    const pd0 = previa && previa.payload.pendiente;
    // «¿Es un gasto o un ingreso?» → se conserva lo que ya se sabía.
    const p = incompleta(pd0) && !pd0.propuesta.tipo ? { ...pd0.propuesta, tipo, categoria: null, subcategoria: null } : { tipo, categoria: null, subcategoria: null, importe: null, fecha: c.hoy, nota: null };
    return proponer(c, p, []);
  }
  if (accion === 'deshacer') return deshacer(c);
  if (accion === 'repetir_ultimo') {
    const last = tracker.lastMovement(c.userId);
    if (!last) return I.msg('pocos_datos', { n: 0, minimo: 1 });
    return guardarRegistro(c, { tipo: last.kind, categoria: last.category, subcategoria: last.subcategory, importe: last.amount, fecha: c.hoy, nota: last.note });
  }
  if (accion === 'pedir_ia' || accion === 'pedir_redaccion') return resultadoIA(c.ia);
  if (accion === 'proponer_completar_tarea') return proponerCompletar(c);
  if (accion === 'proponer_tarea') return proponerTarea(c, sol);
  const pend = sol.mensaje_id ? payloadDe(Number(sol.mensaje_id), c.userId) : ultimaPendiente(c.userId, conv.id);
  if (!pend || !pend.payload.pendiente || pend.payload.pendiente.estado !== 'pendiente') throw new CoachError(409, 'SIN_PROPUESTA', 'No hay nada pendiente de confirmar.');
  const pd = pend.payload.pendiente;
  if (accion === 'crear_recurrente' || accion === 'descartar_recurrente') {
    if (pd.tipo !== 'crear_recurrente') throw new CoachError(409, 'SIN_PROPUESTA', 'No hay un recurrente por confirmar.');
    if (accion === 'descartar_recurrente') {
      recurrentes.descartar(c.userId, pd.propuesta.clave);
      pd.estado = 'descartada';
      guardarPayload(pend.id, pend.payload);
      return I.msg('cancelado');
    }
    const r = recurrentes.crear(c.userId, { tipo: pd.propuesta.tipo, categoria: pd.propuesta.categoria, subcategoria: pd.propuesta.subcategoria, monto: pd.propuesta.monto, nota: pd.propuesta.nota, dia: pd.propuesta.dia }, c.hoy);
    if (!r.ok) throw new CoachError(422, 'DATOS_INVALIDOS', r.error);
    pd.estado = 'confirmada';
    guardarPayload(pend.id, pend.payload);
    return I.msg('recurrente_creado', { nota: pd.propuesta.nota, dia: pd.propuesta.dia });
  }
  if (accion === 'crear_plantilla') {
    if (pd.tipo !== 'crear_plantilla') throw new CoachError(409, 'SIN_PROPUESTA', 'No hay un atajo por confirmar.');
    const r = plantillas.crear(c.userId, { etiqueta: pd.propuesta.nota, tipo: pd.propuesta.tipo, categoria: pd.propuesta.categoria, subcategoria: pd.propuesta.subcategoria, monto: pd.propuesta.monto });
    if (!r.ok) throw new CoachError(422, 'DATOS_INVALIDOS', r.error);
    pd.estado = 'confirmada';
    guardarPayload(pend.id, pend.payload);
    return I.msg('plantilla_creada', { nota: pd.propuesta.nota });
  }
  if (accion === 'cancelar') {
    pd.estado = 'descartada';
    guardarPayload(pend.id, pend.payload);
    return I.msg('cancelado');
  }
  if (['confirmar', 'corregir'].includes(accion) && ['crear_recurrente', 'crear_plantilla'].includes(pd.tipo)) throw new CoachError(422, 'ACCION_NO_SOPORTADA', 'Usa los botones de esa propuesta.');
  if (accion === 'corregir' && pd.tipo && pd.tipo !== 'registro') throw new CoachError(422, 'ACCION_NO_SOPORTADA', 'Esa propuesta no se corrige: cancélala y pídela de nuevo.');
  if (accion === 'corregir') {
    const campo = String(sol.campo || '');
    const valor = sol.valor === undefined || sol.valor === null ? '' : String(sol.valor);
    if (campo === 'categoria') {
      if (!tracker.CATEGORIES[pd.propuesta.tipo] || !tracker.CATEGORIES[pd.propuesta.tipo][valor]) throw new CoachError(422, 'CATEGORIA_INVALIDA', 'Elige una categoría de la lista.');
      pd.propuesta.categoria = valor;
      pd.propuesta.subcategoria = null;
    } else if (campo === 'importe') {
      const p = money.parseAmount(valor, c.cur);
      if (!p.ok) throw new CoachError(422, 'IMPORTE_INVALIDO', p.error || 'Escribe el importe.');
      pd.propuesta.importe = p.value;
    } else if (campo === 'fecha') {
      if (!tracker.validDate(valor)) throw new CoachError(422, 'FECHA_INVALIDA', 'Escribe una fecha válida.');
      pd.propuesta.fecha = valor;
      pd.avisos = (pd.avisos || []).filter((a) => a !== 'fecha_futura');
    } else if (campo === 'tipo') {
      if (!tracker.CATEGORIES[valor]) throw new CoachError(422, 'CATEGORIA_INVALIDA', 'Elige gasto o ingreso.');
      pd.propuesta.tipo = valor;
      pd.propuesta.categoria = null;
    } else throw new CoachError(422, 'ACCION_NO_SOPORTADA', 'Ese campo no se puede corregir.');
    guardarPayload(pend.id, pend.payload);
    return proponer(c, pd.propuesta, pd.avisos || []);
  }
  if (pd.tipo === 'crear_tarea') {
    tasks.create(c.userId, { title: pd.propuesta.title, reason: pd.propuesta.reason, criteria: pd.propuesta.criteria, source: 'coach' });
    pd.estado = 'confirmada';
    guardarPayload(pend.id, pend.payload);
    return I.msg('tarea_creada', { tarea: pd.propuesta.title });
  }
  if (pd.tipo === 'completar_tarea') {
    const t = tasks.get(c.userId, pd.propuesta.taskId);
    if (!t || t.status === 'completada') throw new CoachError(409, 'SIN_PROPUESTA', 'Esa tarea ya no está pendiente.');
    tasks.complete(c.userId, t.id, 'Confirmada desde el Coach');
    pd.estado = 'confirmada';
    guardarPayload(pend.id, pend.payload);
    return I.msg('tarea_completada_ok', { tarea: t.title });
  }
  // confirmar: lo avisado y aceptado no se vuelve a preguntar
  const falta = revisar(c, pd.propuesta, pd.avisos || []);
  if (falta) {
    if (falta.aviso) pd.avisos = [...(pd.avisos || []), falta.aviso]; // el siguiente «Confirmar» acepta el aviso
    guardarPayload(pend.id, pend.payload);
    return { ...falta, pendiente: pd };
  }
  const r = guardarRegistro(c, pd.propuesta, pd.recurrenteId ? 'recurrente' : 'coach');
  if (pd.recurrenteId) recurrentes.marcarSugerido(c.userId, pd.recurrenteId, c.hoy.slice(0, 7));
  pd.estado = 'confirmada';
  guardarPayload(pend.id, pend.payload);
  return r;
}

/** Resultado de un botón de IA ya resuelto por respuestaIA.js: el texto va después del prefijo del catálogo. */
function resultadoIA(ia) {
  if (ia && ia.ok) return { intencion: 'ia_respuesta_prefijo', vars: {}, textoIA: ia.texto, origenIA: ia.origen, usoIA: { tarea: ia.tarea, origen: ia.origen, run_id: ia.runId || null } };
  if (ia && ['LIMITE_MENSUAL', 'LIMITE_DIARIO'].includes(ia.motivo)) return I.msg('ia_limite_alcanzado', { limite: ia.limite || 0 });
  return I.msg('ia_no_disponible');
}

/** Respuesta a una pregunta abierta: la de la IA o, si no hubo, el consejo calculado por reglas. */
function resultadoConsejo(k) {
  if (k.ok) return { ...I.msg('consejo_ia', { texto: k.texto }), ayudaIA: true, usoIA: { tarea: 'consejo', origen: k.origen, run_id: k.runId || null } };
  const nota = k.motivo === 'LIMITE_MENSUAL' ? ` (Ya usaste tus ${k.limite} respuestas con IA de este mes; sigo ayudándote con tus cifras.)` : '';
  return I.msg('consejo_calculado', { texto: `${k.respaldo}${nota}` });
}

/** Cuando el parser no entendió y la IA barata sí: la intención sale de la IA, pero el cálculo y el texto, de las reglas. */
function aplicarIA(c) {
  const k = c.ia && c.ia.clasificacion;
  if (!k) return null;
  const uso = { tarea: c.ia.extraccion ? 'clasificar+extraer' : 'clasificar', origen: 'ia', run_ids: c.ia.runIds || [] };
  if (String(k.intencion).startsWith('registrar_')) {
    if (!c.ia.extraccion) return null;
    const e = c.ia.extraccion.entidades;
    const p = propuestaDe(c, { tipo: e.tipo, importe: e.importe, categoria: e.categoria, subcategoria: e.subcategoria, fecha: e.fecha, nota: e.nota });
    return { ...proponer(c, p, []), ayudaIA: true, usoIA: uso };
  }
  if (k.intencion === 'tarea_completada') return { ...proponerCompletar(c), ayudaIA: true, usoIA: uso };
  if (k.intencion === 'deshacer') return { ...deshacer(c), ayudaIA: true, usoIA: uso };
  if (I.HANDLERS[k.intencion]) {
    c.ent = { categoria: k.categoria_consultada };
    return { intencion: k.intencion, ...I.HANDLERS[k.intencion](c), ayudaIA: true, usoIA: uso };
  }
  return null;
}

/** Propuesta de marcar como hecha la siguiente tarea pendiente (se confirma antes de tocar nada). */
function proponerCompletar(c) {
  const t = tasks.next(c.userId);
  if (!t) return I.msg('sin_tareas');
  const vars = { tarea: t.title };
  if (t.done_criteria) vars.criterio = t.done_criteria;
  return { ...I.msg('tarea_completada_propuesta', vars), pendiente: { tipo: 'completar_tarea', propuesta: { taskId: t.id, title: t.title }, avisos: [], estado: 'pendiente' } };
}

/** Propuesta de crear una tarea a partir del mensaje que trae el botón (usa las cifras de ese mensaje). */
function proponerTarea(c, sol) {
  const origen = sol.mensaje_id ? db.one("SELECT intent, payload_json FROM messages WHERE id = ? AND user_id = ? AND role = 'coach'", Number(sol.mensaje_id), c.userId) : null;
  const p = origen ? propuestaTarea(origen.intent, (db.parse(origen.payload_json, {}) || {}).vars) : null;
  if (!p) throw new CoachError(422, 'ACCION_NO_SOPORTADA', 'No sé qué tarea proponer a partir de ese mensaje.');
  return { ...I.msg('crear_tarea_propuesta', { tarea: p.title }), pendiente: { tipo: 'crear_tarea', propuesta: p, avisos: [], estado: 'pendiente' } };
}

function deshacer(c) {
  const m = movimientoReciente(c.userId);
  if (!m) return I.msg('cancelado');
  tracker.softDeleteMovement(c.userId, m.id);
  return I.msg('deshacer_ok');
}

// ───────── Texto libre ─────────
function corregirUltimo(c, r, conv) {
  const e = r.entidades;
  const campo = r.intencion === 'corregir_importe' ? 'importe' : r.intencion === 'corregir_categoria' ? 'categoría' : 'fecha';
  const pend = ultimaPendiente(c.userId, conv.id);
  if (pend) {
    const pd = pend.payload.pendiente;
    if (pd.tipo && pd.tipo !== 'registro') return I.msg('no_entendi', { sugerencia: 'resumen del mes' });
    if (e.importe && r.intencion === 'corregir_importe') pd.propuesta.importe = e.importe;
    if (e.categoria && r.intencion === 'corregir_categoria' && tracker.CATEGORIES[pd.propuesta.tipo] && tracker.CATEGORIES[pd.propuesta.tipo][e.categoria]) pd.propuesta.categoria = e.categoria;
    if (e.fecha && r.intencion === 'corregir_fecha') pd.propuesta.fecha = e.fecha;
    guardarPayload(pend.id, pend.payload);
    return proponer(c, pd.propuesta, pd.avisos || []);
  }
  const m = movimientoReciente(c.userId);
  if (!m) return I.msg('no_entendi', { sugerencia: 'resumen del mes' });
  const v = tracker.validateMovement(c.userId, {
    kind: m.kind,
    category: r.intencion === 'corregir_categoria' && e.categoria ? e.categoria : m.category,
    subcategory: r.intencion === 'corregir_categoria' ? null : m.subcategory,
    amount: r.intencion === 'corregir_importe' && e.importe ? e.importe : m.amount,
    date: r.intencion === 'corregir_fecha' && e.fecha ? e.fecha : m.date,
    note: m.note,
  });
  if (!v.ok) return I.msg('no_entendi', { sugerencia: 'resumen del mes' });
  tracker.updateMovement(c.userId, m.id, v.value);
  if (r.intencion === 'corregir_categoria' && v.value.noteNorm) pistas.learn(c.userId, v.value.noteNorm, v.value.kind, v.value.category, null);
  return I.msg('registro_editado', { campo });
}

function porTexto(c, texto, conv) {
  const r = parser.parsear(texto, { hoy: c.hoy, moneda: c.cur });
  const out = { parser: r };
  const seguido = completar(c, r, texto, conv);
  if (seguido) return { ...seguido, ...out };
  if (String(r.intencion || '').startsWith('registrar_') || ['registro_vista_previa', 'aclarar_categoria', 'aclarar_tipo', 'aclarar_importe', 'aclarar_fecha', 'moneda_info'].includes(r.respuesta)) {
    if (r.respuesta === 'moneda_info') return { ...I.msg('moneda_info', { moneda: c.cur }), ...out };
    const p = propuestaDe(c, r.entidades);
    if (!p.tipo && !p.importe) return { ...I.msg('no_entendi', { sugerencia: 'resumen del mes' }), ...out };
    return { ...proponer(c, p, []), ...out };
  }
  if (['corregir_importe', 'corregir_categoria', 'corregir_fecha'].includes(r.intencion)) return { ...corregirUltimo(c, r, conv), ...out };
  if (r.intencion === 'deshacer') return { ...deshacer(c), ...out };
  if (r.respuesta === 'tarea_completada_propuesta') return { ...proponerCompletar(c), ...out };
  const id = r.respuesta;
  if (id === 'no_entendi') {
    const viaIA = aplicarIA(c);
    if (viaIA) return { ...viaIA, ...out };
  }
  if (c.consejo) return { ...resultadoConsejo(c.consejo), ...out };
  if (id && I.HANDLERS[id]) {
    c.ent = r.entidades;
    const h = I.HANDLERS[id](c);
    return { intencion: id, ...h, ...out };
  }
  // Lo que las reglas no entienden: si la IA barata ya lo clasificó (y la salida pasó la validación) se usa; si no, «no entendí».
  const viaIA = aplicarIA(c);
  if (viaIA) return { ...viaIA, ...out };
  return { ...I.msg('no_entendi', { sugerencia: 'resumen del mes' }), ...out };
}

// ───────── Punto de entrada ─────────
/**
 * Responde a un mensaje de texto o a un botón. `sol`: { texto } o { accion, mensaje_id?, campo?, valor?, intencion? }.
 * Devuelve la RespuestaCoach (docs/coach-v2/04 §2.4).
 */
function responder(userId, sol, { hoy, ia = null, consejo = null, iaEstado = null } = {}) {
  const texto = sol.texto === undefined || sol.texto === null ? '' : String(sol.texto).trim().slice(0, MAX_TEXTO);
  if (!sol.accion && !texto) throw new CoachError(422, 'DATOS_INVALIDOS', 'Escribe un mensaje.');
  const conv = coach.conversation(userId);
  const c = I.contexto(userId, { hoy, texto });
  c.ia = ia;
  c.consejo = consejo;
  c.iaEstado = iaEstado || { disponible: false };
  const userMsgId = guardar(userId, conv.id, { rol: 'usuario', contenido: texto || `[${sol.accion}]`, origen: sol.accion ? 'boton' : null });

  let res = sol.accion ? accionar(c, sol, conv) : porTexto(c, texto, conv);
  const id = res.intencion && INTENCIONES[res.intencion] ? res.intencion : 'no_entendi';
  const m = construir(userId, c.cur, id, res.vars || {}, userMsgId);
  let origen = sol.accion ? 'boton' : m.it.origen === 'regla' ? 'regla' : 'plantilla';
  let textoFinal = m.texto;
  if (res.textoIA) {
    textoFinal = `${m.texto} ${res.textoIA}`;
    origen = res.origenIA === 'cache' ? 'cache' : 'ia';
  } else if (res.ayudaIA) origen = res.usoIA && res.usoIA.origen === 'cache' ? 'cache' : 'ia';
  // Si al anotar algo cuenta que le preocupa, se reconoce antes de seguir.
  if (texto && res.pendiente && conversacion.hayEmocion(texto)) textoFinal = `Entiendo que te preocupe; lo vemos juntos. ${textoFinal}`;
  if (!sol.accion && (m.it.id === 'no_entendi' || (res.parser && res.parser.respuesta === 'no_entendi' && !res.pendiente))) mejora.registrar(texto); // mejora continua: frase anonimizada, sin cuenta
  const tarjetas = res.tarjetas || [];
  const graficos = res.grafico ? [res.grafico] : [];
  const payload = { tarjetas, graficos, vars: res.vars || {}, pendiente: res.pendiente || undefined };
  const coachId = guardar(userId, conv.id, { rol: 'coach', contenido: textoFinal, origen, intencion: m.it.id, varianteId: m.v.id, confianza: res.parser ? res.parser.confianza : null, payload });
  // Una propuesta nueva reemplaza a las anteriores sin resolver.
  if (res.pendiente) {
    for (const r of db.all("SELECT id, payload_json FROM messages WHERE conversation_id = ? AND user_id = ? AND role = 'coach' AND id < ? AND payload_json LIKE '%\"pendiente\"%'", conv.id, userId, coachId)) {
      const p = db.parse(r.payload_json, {});
      if (p.pendiente && p.pendiente.estado === 'pendiente') {
        p.pendiente.estado = 'descartada';
        guardarPayload(r.id, p);
      }
    }
  }
  const botonesResp = botones(m.it, coachId);
  guardarPayload(coachId, { ...payload, botones: botonesResp, severidad: m.v.severidad || 'info' });
  return {
    id: coachId,
    origen,
    intencion: m.it.id,
    confianza: res.parser ? res.parser.confianza : null,
    mensaje: { texto: textoFinal, variante_id: m.v.id, tono: m.v.tono, severidad: m.v.severidad || 'info' },
    tarjetas,
    graficos,
    insights: [],
    botones: botonesResp,
    propuesta: res.pendiente ? { mensaje_id: coachId, tipo: res.pendiente.tipo || 'registro', propuesta: res.pendiente.propuesta } : null,
    movimiento_id: res.movimientoId || null,
    uso_ia: res.usoIA || null,
    catalog_version: CATALOG_VERSION,
  };
}

module.exports = { responder, esperaDato, CoachError, ACCIONES };
