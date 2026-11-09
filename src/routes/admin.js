'use strict';
// F12 Panel administrativo. Ninguna vista muestra respuestas financieras,
// conversaciones ni claves; solo avances, estados, métricas y auditoría.
const express = require('express');
const db = require('../db');
const config = require('../config');
const { html, raw } = require('../lib/html');
const money = require('../lib/money');
const entitlements = require('../domain/entitlements');
const qs = require('../domain/questionnaire');
const rulesRepo = require('../domain/rules');
const privacy = require('../domain/privacy');
const queue = require('../lib/queue');
const backup = require('../lib/backup');
const ai = require('../domain/ai/provider');
const sandbox = require('../domain/gateways/sandbox');
const planDomain = require('../domain/plan');
const { audit, getSetting, setSetting, FUNNEL } = require('../lib/services');
const c = require('../views/components');
const { requireAdmin } = require('./guards');
const { intParam, notFound, wrap } = require('./util');

const router = express.Router();
router.use(requireAdmin);

const NAV = [
  ['', 'Resumen'],
  ['usuarios', 'Usuarios'],
  ['ordenes', 'Órdenes'],
  ['fallos', 'Fallos y reintentos'],
  ['ia', 'Uso de IA'],
  ['cuestionarios', 'Cuestionarios'],
  ['reglas', 'Reglas'],
  ['textos', 'Textos'],
  ['productos', 'Productos'],
  ['ajustes', 'Límites de IA'],
  ['privacidad', 'Privacidad'],
  ['respaldos', 'Respaldos'],
  ['auditoria', 'Auditoría'],
  ['correos', 'Correos'],
];

function page(res, key, title, body) {
  return res.active('admin').page({
    title: `${title} | Administración`,
    wide: true,
    body: html`<div class="admin-grid">
      <nav class="admin-nav" aria-label="Administración">${NAV.map(([k, l]) => html`<a href="/admin/${k}" ${k === key ? raw('aria-current="page"') : ''}>${l}</a>`)}</nav>
      <div><h1>${title}</h1>${body}</div>
    </div>`,
  });
}

function since(period) {
  const days = { 7: 7, 30: 30, 90: 90 }[period];
  return days ? new Date(Date.now() - days * 86400000).toISOString() : '0000';
}

function periodPicker(base, period) {
  return html`<p class="small links">${[
    ['7', '7 días'],
    ['30', '30 días'],
    ['90', '90 días'],
    ['todo', 'Todo'],
  ].map(([v, l], i) => html`${period === v ? html`<strong>${l}</strong>` : html`<a href="${base}?periodo=${v}">${l}</a>`}`)}</p>`;
}

const usd = (micros) => `${(micros / 1e6).toLocaleString('es', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

// ───────── Resumen y embudo ─────────
router.get('/', (req, res) => {
  const period = ['7', '30', '90', 'todo'].includes(req.query.periodo) ? req.query.periodo : '30';
  const from = since(period);
  const counts = FUNNEL.map(([name, label]) => ({ name, label, n: db.value('SELECT COUNT(DISTINCT COALESCE(dedupe_key, id)) FROM analytics_events WHERE name = ? AND created_at >= ?', name, from) || 0 }));
  const top = Math.max(counts[0].n, 1);
  const aiCost = db.value("SELECT COALESCE(SUM(cost_micros), 0) FROM ai_runs WHERE created_at >= ? AND status = 'ok'", from);
  const failures = {
    pagos: db.value("SELECT COUNT(*) FROM payment_events WHERE status = 'rechazado' AND received_at >= ?", from),
    trabajos: db.value("SELECT COUNT(*) FROM jobs WHERE status = 'fallido'"),
    ia: db.value("SELECT COUNT(*) FROM ai_runs WHERE status <> 'ok' AND created_at >= ?", from),
    planes: db.value("SELECT COUNT(*) FROM plan_versions WHERE status = 'fallido'"),
  };
  page(res, '', 'Resumen', html`${periodPicker('/admin/', period)}
    <div class="stats">
      <div class="stat"><span class="k">Usuarios</span><span class="v">${db.value('SELECT COUNT(*) FROM users')}</span><span class="s">${db.value('SELECT COUNT(*) FROM users WHERE created_at >= ?', from)} nuevos en el periodo</span></div>
      <div class="stat"><span class="k">Ventas confirmadas</span><span class="v">${db.value("SELECT COUNT(*) FROM orders WHERE status = 'pagada' AND paid_at >= ?", from)}</span><span class="s">${db.all("SELECT currency, SUM(amount_cents) AS t FROM orders WHERE status = 'pagada' AND paid_at >= ? GROUP BY currency", from).map((r) => money.formatCents(r.t, r.currency)).join(', ') || 'Sin ventas'}</span></div>
      <div class="stat"><span class="k">Costo estimado de IA</span><span class="v">${usd(aiCost)}</span><span class="s">Límite mensual ${usd(Number(getSetting('ai_global_monthly_budget_usd')) * 1e6)}</span></div>
      <div class="stat"><span class="k">Fallos por revisar</span><span class="v">${failures.pagos + failures.trabajos + failures.planes}</span><span class="s"><a href="/admin/fallos">Ver fallos</a></span></div>
    </div>
    <h2>Embudo</h2>
    <p class="small muted">Eventos sin importes, respuestas ni conversaciones. Cada etapa cuenta una vez por persona o por operación.</p>
    <ol class="funnel">
      ${counts.map((s) => html`<li><span>${s.label}</span><span class="bar-track"><span class="bar-fill" style="display:block;width:${Math.max((s.n / top) * 100, 0.5).toFixed(1)}%"></span></span><span class="n">${s.n}</span><span class="p">${counts[0].n ? money.formatPercent(s.n / counts[0].n, 0) : '—'}</span></li>`)}
    </ol>
    <h2 class="section">Origen de las visitas</h2>
    <table class="data"><thead><tr><th>utm_source</th><th>utm_campaign</th><th class="r">Visitas</th><th class="r">Registros</th></tr></thead><tbody>
      ${db.all(
        "SELECT COALESCE(utm_source, '(directo)') AS src, COALESCE(utm_campaign, '—') AS camp, SUM(name = 'visita') AS v, SUM(name = 'registro') AS r FROM analytics_events WHERE created_at >= ? GROUP BY src, camp ORDER BY v DESC LIMIT 15",
        from
      ).map((r) => html`<tr><td>${r.src}</td><td>${r.camp}</td><td class="r">${r.v}</td><td class="r">${r.r}</td></tr>`)}
    </tbody></table>`);
});

// ───────── Usuarios ─────────
function userRow(u) {
  const free = db.one("SELECT id, questionnaire_id, status FROM evaluations WHERE user_id = ? AND kind = 'gratuito' ORDER BY updated_at DESC LIMIT 1", u.id);
  const deepEv = db.one("SELECT id, questionnaire_id, status FROM evaluations WHERE user_id = ? AND kind = 'profundo' ORDER BY updated_at DESC LIMIT 1", u.id);
  const prog = (ev) => {
    if (!ev) return '—';
    if (ev.status === 'finalizada') return 'Terminado';
    const n = db.value('SELECT COUNT(*) FROM answers WHERE evaluation_id = ?', ev.id);
    const total = db.value('SELECT COUNT(*) FROM questions WHERE questionnaire_id = ?', ev.questionnaire_id);
    return `${n} de ${total}`;
  };
  const ents = entitlements.active(u.id);
  const plan = db.one('SELECT status, version_number FROM plan_versions WHERE user_id = ? ORDER BY id DESC LIMIT 1', u.id);
  return { free: prog(free), deep: prog(deepEv), ents, plan, orders: db.value("SELECT COUNT(*) FROM orders WHERE user_id = ? AND status = 'pagada'", u.id) };
}

router.get('/usuarios', (req, res) => {
  const q = String(req.query.q || '').trim();
  const users = q
    ? db.all('SELECT * FROM users WHERE email LIKE ? ORDER BY created_at DESC LIMIT 100', `%${q}%`)
    : db.all('SELECT * FROM users ORDER BY created_at DESC LIMIT 100');
  page(res, 'usuarios', 'Usuarios', html`<form method="get" action="/admin/usuarios" class="pair"><div class="field"><label for="f-q" class="visually-hidden">Buscar por correo</label><input class="input" id="f-q" name="q" value="${q}" placeholder="Buscar por correo" /></div><div><button class="btn btn-secondary" type="submit">Buscar</button></div></form>
    <table class="data stack-sm"><thead><tr><th>Correo</th><th>Registro</th><th>Test</th><th>Evaluación</th><th>Accesos</th><th>Plan</th></tr></thead><tbody>
    ${users.map((u) => {
      const r = userRow(u);
      return html`<tr><td data-label="Correo"><a href="/admin/usuarios/${u.id}">${u.email}</a>${u.role === 'admin' ? html` ${c.badge('admin')}` : ''}</td><td data-label="Registro">${c.dateShort(u.created_at)}</td><td data-label="Test">${r.free}</td><td data-label="Evaluación">${r.deep}</td>
        <td data-label="Accesos">${Object.entries(r.ents).filter(([, v]) => v).map(([k]) => c.badge(c.GRANT_LABELS[k], 'ok'))}</td><td data-label="Plan">${r.plan ? `v${r.plan.version_number} ${{ completo: 'completo', fallido: 'fallido', en_cola: 'en cola', generando: 'generando' }[r.plan.status]}` : '—'}</td></tr>`;
    })}
    </tbody></table>`);
});

router.get('/usuarios/:id', (req, res, next) => {
  const id = intParam(req.params.id);
  const u = id && db.one('SELECT * FROM users WHERE id = ?', id);
  if (!u) return next(notFound());
  const r = userRow(u);
  const ctx = res.locals.ctx;
  const ents = entitlements.list(u.id);
  const orders = db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', u.id);
  const plans = db.all('SELECT id, version_number, status, error_message, created_at, completed_at FROM plan_versions WHERE user_id = ? ORDER BY id DESC', u.id);
  const usage = ai.usage(u.id, 'coach');
  page(res, 'usuarios', u.email, html`
    <ul class="figures">
      <li><span class="k">Registro</span><span class="v">${c.dateEs(u.created_at, { time: true })}</span></li>
      <li><span class="k">Correo verificado</span><span class="v">${u.email_verified_at ? 'Sí' : 'No'}</span></li>
      <li><span class="k">Avance del test gratuito</span><span class="v">${r.free}</span></li>
      <li><span class="k">Avance de la evaluación profunda</span><span class="v">${r.deep}</span></li>
      <li><span class="k">Mensajes del coach este mes</span><span class="v">${usage.used} de ${usage.limit}</span></li>
    </ul>
    <p class="small faint">Por privacidad, el panel no muestra respuestas financieras ni conversaciones. Para entregarlas al titular, usa la exportación.</p>

    <h2 class="section">Permisos</h2>
    <table class="data stack-sm"><thead><tr><th>Permiso</th><th>Origen</th><th>Vence</th><th>Estado</th><th></th></tr></thead><tbody>
      ${ents.map((e) => {
        const active = !e.revoked_at && (!e.expires_at || e.expires_at > db.now());
        return html`<tr><td data-label="Permiso">${c.GRANT_LABELS[e.code]}</td><td data-label="Origen">${e.source}${e.reason ? html`<br /><span class="small faint">${e.reason}</span>` : ''}</td><td data-label="Vence">${e.expires_at ? c.dateShort(e.expires_at) : '—'}</td><td data-label="Estado">${active ? c.badge('Activo', 'ok') : e.revoked_at ? c.badge(`Revocado: ${e.revoke_reason}`) : c.badge('Vencido')}</td>
          <td>${active ? html`<form method="post" action="/admin/usuarios/${u.id}/permisos/${e.id}/revocar" class="stack">${c.csrfField(ctx)}<label class="visually-hidden" for="rv-${e.id}">Motivo</label><input class="input" id="rv-${e.id}" name="reason" placeholder="Motivo" required /><button class="btn btn-quiet btn-small" type="submit">Revocar</button></form>` : ''}</td></tr>`;
      })}
    </tbody></table>
    <form method="post" action="/admin/usuarios/${u.id}/permisos" class="section" novalidate>
      ${c.csrfField(ctx)}
      <h3>Activación manual</h3>
      <div class="grid-3">
        <div class="field"><label for="f-code">Permiso</label><select class="input" id="f-code" name="code">${entitlements.CODES.map((k) => html`<option value="${k}">${c.GRANT_LABELS[k]}</option>`)}</select></div>
        <div class="field"><label for="f-days">Duración en días (vacío: sin vencimiento)</label><input class="input" id="f-days" name="days" inputmode="numeric" /></div>
        <div class="field"><label for="f-reason">Motivo (obligatorio)</label><input class="input" id="f-reason" name="reason" required /></div>
      </div>
      <p class="small muted">Queda registrado con tu usuario, la fecha y el motivo.</p>
      <button class="btn btn-secondary" type="submit">Activar permiso</button>
    </form>

    <h2 class="section">Límite de IA de esta cuenta</h2>
    <form method="post" action="/admin/usuarios/${u.id}/limite" class="pair" novalidate>${c.csrfField(ctx)}
      <div class="field"><label for="f-limit">Mensajes al coach por mes (vacío: valor general, ${getSetting('ai_coach_monthly_limit')})</label><input class="input" id="f-limit" name="limit" inputmode="numeric" value="${u.ai_monthly_limit ?? ''}" /></div>
      <div class="actions"><button class="btn btn-secondary btn-small" type="submit">Guardar límite</button></div></form>

    <h2 class="section">Órdenes</h2>
    ${orders.length ? html`<table class="data"><tbody>${orders.map((o) => html`<tr><td><a href="/admin/ordenes/${o.id}">${o.ref}</a></td><td>${o.product_name}</td><td class="r">${money.formatCents(o.amount_cents, o.currency)}</td><td>${c.badge(...c.ORDER_STATUS[o.status])}</td></tr>`)}</tbody></table>` : html`<p class="muted">Sin órdenes.</p>`}

    <h2 class="section">Generación de planes</h2>
    ${plans.length ? html`<table class="data"><tbody>${plans.map((p) => html`<tr><td>v${p.version_number}</td><td>${p.status}</td><td>${p.error_message || ''}</td><td>${c.dateShort(p.completed_at || p.created_at)}</td><td>${p.status === 'fallido' ? html`<form method="post" action="/admin/planes/${p.id}/reintentar">${c.csrfField(ctx)}<button class="btn btn-quiet btn-small" type="submit">Reintentar</button></form>` : ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">Sin planes.</p>`}

    <h2 class="section">Datos de la cuenta</h2>
    <div class="actions">
      <a class="btn btn-secondary" href="/admin/usuarios/${u.id}/exportar">Exportar datos (JSON)</a>
    </div>
    ${u.role !== 'admin'
      ? html`<form method="post" action="/admin/usuarios/${u.id}/eliminar" class="section" data-confirm="Esta acción elimina la cuenta y sus datos de forma permanente." novalidate>
          ${c.csrfField(ctx)}
          <h3>Eliminar cuenta</h3>
          <div class="grid-2">
            <div class="field"><label for="f-del-reason">Motivo</label><input class="input" id="f-del-reason" name="reason" required /></div>
            <div class="field"><label for="f-del-email">Escribe el correo para confirmar</label><input class="input" id="f-del-email" name="confirm_email" required /></div>
          </div>
          <button class="btn btn-danger" type="submit">Eliminar cuenta y datos</button>
        </form>`
      : ''}`);
});

router.post('/usuarios/:id/permisos', (req, res, next) => {
  const id = intParam(req.params.id);
  if (!id || !db.one('SELECT id FROM users WHERE id = ?', id)) return next(notFound());
  const days = intParam(String(req.body.days || '').trim());
  try {
    entitlements.grantManual({ userId: id, code: req.body.code, days, adminId: req.user.id, reason: String(req.body.reason || '') });
  } catch (e) {
    const err = new Error(e.message);
    err.status = 422;
    err.publicMessage = e.message;
    return next(err);
  }
  res.redirect(303, `/admin/usuarios/${id}?aviso=guardado`);
});

router.post('/usuarios/:id/permisos/:eid/revocar', (req, res, next) => {
  const id = intParam(req.params.id);
  const eid = intParam(req.params.eid);
  try {
    if (!id || !eid || !entitlements.revokeManual({ entitlementId: eid, userId: id, adminId: req.user.id, reason: String(req.body.reason || '') })) return next(notFound());
  } catch (e) {
    const err = new Error(e.message);
    err.status = 422;
    err.publicMessage = e.message;
    return next(err);
  }
  res.redirect(303, `/admin/usuarios/${id}?aviso=guardado`);
});

router.post('/usuarios/:id/limite', (req, res, next) => {
  const id = intParam(req.params.id);
  if (!id) return next(notFound());
  const raw = String(req.body.limit || '').trim();
  const limit = raw === '' ? null : Math.max(0, Math.min(Number.parseInt(raw, 10) || 0, 10000));
  db.run('UPDATE users SET ai_monthly_limit = ?, updated_at = ? WHERE id = ?', limit, db.now(), id);
  audit(req.user.id, 'ia.limite_cuenta', { targetType: 'usuario', targetId: id, meta: { limit } });
  res.redirect(303, `/admin/usuarios/${id}?aviso=guardado`);
});

router.get('/usuarios/:id/exportar', (req, res, next) => {
  const id = intParam(req.params.id);
  const data = id && privacy.exportUser(id);
  if (!data) return next(notFound());
  audit(req.user.id, 'privacidad.exportacion', { targetType: 'usuario', targetId: id });
  db.run("UPDATE privacy_requests SET status = 'completada', resolved_at = ?, resolved_by = ? WHERE user_id = ? AND kind = 'exportar' AND status = 'pendiente'", db.now(), req.user.id, id);
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="dia-uno-usuario-${id}.json"`, 'Cache-Control': 'no-store' });
  res.send(JSON.stringify(data, null, 2));
});

router.post('/usuarios/:id/eliminar', (req, res, next) => {
  const id = intParam(req.params.id);
  const u = id && db.one('SELECT * FROM users WHERE id = ?', id);
  if (!u) return next(notFound());
  if (String(req.body.confirm_email || '').trim().toLowerCase() !== u.email.toLowerCase()) {
    const err = new Error('confirmación');
    err.status = 422;
    err.publicMessage = 'El correo de confirmación no coincide. No se eliminó nada.';
    return next(err);
  }
  try {
    privacy.deleteUser(id, req.user.id, String(req.body.reason || ''));
  } catch (e) {
    const err = new Error(e.message);
    err.status = 422;
    err.publicMessage = e.message;
    return next(err);
  }
  res.redirect(303, '/admin/usuarios?aviso=eliminado');
});

// ───────── Órdenes ─────────
router.get('/ordenes', (req, res) => {
  const st = Object.keys(c.ORDER_STATUS).includes(req.query.estado) ? req.query.estado : null;
  const orders = st ? db.all('SELECT o.*, u.email FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.status = ? ORDER BY o.created_at DESC LIMIT 200', st) : db.all('SELECT o.*, u.email FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 200');
  page(res, 'ordenes', 'Órdenes', html`<p class="small links">${[['', 'Todas'], ...Object.entries(c.ORDER_STATUS).map(([k, v]) => [k, v[0]])].map(([k, l], i) => html`${(st || '') === k ? html`<strong>${l}</strong>` : html`<a href="/admin/ordenes${k ? `?estado=${k}` : ''}">${l}</a>`}`)}</p>
    <table class="data stack-sm"><thead><tr><th>Referencia</th><th>Cuenta</th><th>Producto</th><th class="r">Importe</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>
    ${orders.map((o) => html`<tr><td data-label="Referencia"><a href="/admin/ordenes/${o.id}">${o.ref}</a></td><td data-label="Cuenta">${o.email || 'Cuenta eliminada'}</td><td data-label="Producto">${o.product_name}</td><td data-label="Importe" class="r">${money.formatCents(o.amount_cents, o.currency)}</td><td data-label="Estado">${c.badge(...c.ORDER_STATUS[o.status])}</td><td data-label="Fecha">${c.dateShort(o.created_at)}</td></tr>`)}
    </tbody></table>`);
});

router.get('/ordenes/:id', (req, res, next) => {
  const id = intParam(req.params.id);
  const o = id && db.one('SELECT o.*, u.email FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = ?', id);
  if (!o) return next(notFound());
  const events = db.all('SELECT * FROM payment_events WHERE order_ref = ? ORDER BY id', o.ref);
  const ents = db.all('SELECT * FROM entitlements WHERE order_id = ?', o.id);
  const deliveries = o.gateway === 'sandbox' ? db.all("SELECT d.* FROM sandbox_deliveries d WHERE d.payload LIKE ? ORDER BY d.id", `%${o.ref}%`) : [];
  const ctx = res.locals.ctx;
  page(res, 'ordenes', `Orden ${o.ref}`, html`
    <ul class="figures">
      <li><span class="k">Cuenta</span><span class="v">${o.email || 'Cuenta eliminada'}</span></li>
      <li><span class="k">Producto</span><span class="v">${o.product_name}</span></li>
      <li><span class="k">Importe</span><span class="v">${money.formatCents(o.amount_cents, o.currency)} ${o.currency}</span></li>
      <li><span class="k">Estado</span><span class="v">${c.badge(...c.ORDER_STATUS[o.status])}</span></li>
      <li><span class="k">Pasarela y referencia</span><span class="v">${o.gateway}: ${o.gateway_payment_id || o.gateway_session_id || '—'}</span></li>
      ${o.failure_reason ? html`<li><span class="k">Motivo del fallo</span><span class="v">${o.failure_reason}</span></li>` : ''}
    </ul>
    <p class="small faint">No se guardan datos de tarjeta. Los reembolsos se hacen en la pasarela; su confirmación revoca los permisos de esta orden.</p>
    <h2 class="section">Eventos de pago</h2>
    <table class="data stack-sm"><thead><tr><th>Recibido</th><th>Evento</th><th>Tipo</th><th>Resultado</th></tr></thead><tbody>${events.map((e) => html`<tr><td data-label="Recibido">${c.dateEs(e.received_at, { time: true })}</td><td data-label="Evento" class="small">${e.event_id || '—'}</td><td data-label="Tipo">${e.type || '—'}</td><td data-label="Resultado">${c.badge(e.status, e.status === 'procesado' ? 'ok' : e.status === 'rechazado' ? 'bad' : '')} ${e.reason || ''}</td></tr>`)}</tbody></table>
    <h2 class="section">Permisos concedidos</h2>
    ${ents.length ? html`<ul>${ents.map((e) => html`<li>${c.GRANT_LABELS[e.code]}${e.revoked_at ? `: revocado (${e.revoke_reason})` : ''}</li>`)}</ul>` : html`<p class="muted">Ninguno.</p>`}
    ${config.payments.sandboxEnabled && o.gateway === 'sandbox'
      ? html`<h2 class="section">Herramientas de la pasarela de pruebas</h2>
          <div class="actions">
            ${o.status === 'pagada' ? html`<form method="post" action="/admin/ordenes/${o.id}/reembolsar">${c.csrfField(ctx)}<button class="btn btn-secondary" type="submit">Simular reembolso en la pasarela</button></form>` : ''}
            ${deliveries.length ? html`<form method="post" action="/admin/ordenes/${o.id}/reenviar">${c.csrfField(ctx)}<button class="btn btn-secondary" type="submit">Reenviar el último evento (duplicado)</button></form>` : ''}
          </div>
          <table class="data section"><thead><tr><th>Entrega</th><th>Estado</th><th>Intentos</th><th>Respuesta</th></tr></thead><tbody>${deliveries.map((d) => html`<tr><td class="small">${d.event_id}</td><td>${d.status}</td><td>${d.attempts}</td><td>${d.last_response || ''}</td></tr>`)}</tbody></table>`
      : ''}`);
});

router.post('/ordenes/:id/reembolsar', (req, res, next) => {
  if (!config.payments.sandboxEnabled) return next(notFound());
  const o = db.one('SELECT * FROM orders WHERE id = ?', intParam(req.params.id));
  if (!o) return next(notFound());
  sandbox.refund(o.ref);
  audit(req.user.id, 'pasarela_pruebas.reembolso_simulado', { targetType: 'orden', targetId: o.ref });
  res.redirect(303, `/admin/ordenes/${o.id}?aviso=guardado`);
});

router.post('/ordenes/:id/reenviar', (req, res, next) => {
  if (!config.payments.sandboxEnabled) return next(notFound());
  const o = db.one('SELECT * FROM orders WHERE id = ?', intParam(req.params.id));
  if (!o) return next(notFound());
  const last = db.one('SELECT id FROM sandbox_deliveries WHERE payload LIKE ? ORDER BY id DESC LIMIT 1', `%${o.ref}%`);
  if (last) sandbox.redeliver(last.id);
  res.redirect(303, `/admin/ordenes/${o.id}?aviso=guardado`);
});

// ───────── Fallos y reintentos ─────────
router.get('/fallos', (req, res) => {
  const ctx = res.locals.ctx;
  const pe = db.all("SELECT * FROM payment_events WHERE status = 'rechazado' ORDER BY id DESC LIMIT 50");
  const jobs = db.all("SELECT id, type, attempts, last_error, updated_at FROM jobs WHERE status = 'fallido' ORDER BY id DESC LIMIT 50");
  const plans = db.all("SELECT p.id, p.version_number, p.error_message, p.created_at, u.email FROM plan_versions p JOIN users u ON u.id = p.user_id WHERE p.status = 'fallido' ORDER BY p.id DESC");
  const runs = db.all("SELECT id, purpose, provider, model, status, error_code, created_at FROM ai_runs WHERE status <> 'ok' ORDER BY id DESC LIMIT 50");
  const failedOrders = db.all("SELECT * FROM orders WHERE status = 'fallida' ORDER BY updated_at DESC LIMIT 30");
  page(res, 'fallos', 'Fallos y reintentos', html`
    <h2>Eventos de pago rechazados</h2>
    ${pe.length ? html`<table class="data stack-sm"><thead><tr><th>Fecha</th><th>Orden</th><th>Tipo</th><th>Motivo</th></tr></thead><tbody>${pe.map((e) => html`<tr><td data-label="Fecha">${c.dateEs(e.received_at, { time: true })}</td><td data-label="Orden">${e.order_ref || '—'}</td><td data-label="Tipo">${e.type || '—'}</td><td data-label="Motivo">${e.reason}</td></tr>`)}</tbody></table>` : html`<p class="muted">Ninguno.</p>`}
    <h2 class="section">Pagos fallidos</h2>
    ${failedOrders.length ? html`<table class="data"><tbody>${failedOrders.map((o) => html`<tr><td><a href="/admin/ordenes/${o.id}">${o.ref}</a></td><td>${o.product_name}</td><td>${o.failure_reason || ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">Ninguno.</p>`}
    <h2 class="section">Planes que no se generaron</h2>
    ${plans.length ? html`<table class="data"><tbody>${plans.map((p) => html`<tr><td>${p.email}</td><td>v${p.version_number}</td><td>${p.error_message || ''}</td><td><form method="post" action="/admin/planes/${p.id}/reintentar">${c.csrfField(ctx)}<button class="btn btn-quiet btn-small" type="submit">Reintentar</button></form></td></tr>`)}</tbody></table>` : html`<p class="muted">Ninguno.</p>`}
    <h2 class="section">Trabajos fallidos en la cola</h2>
    ${jobs.length ? html`<table class="data stack-sm"><thead><tr><th>Trabajo</th><th>Intentos</th><th>Error</th><th></th></tr></thead><tbody>${jobs.map((j) => html`<tr><td data-label="Trabajo">${j.type} #${j.id}</td><td data-label="Intentos">${j.attempts}</td><td data-label="Error" class="small">${j.last_error}</td><td><form method="post" action="/admin/trabajos/${j.id}/reintentar">${c.csrfField(ctx)}<button class="btn btn-quiet btn-small" type="submit">Reintentar</button></form></td></tr>`)}</tbody></table>` : html`<p class="muted">Ninguno.</p>`}
    <h2 class="section">Llamadas de IA con error o límite</h2>
    ${runs.length ? html`<table class="data stack-sm"><thead><tr><th>Fecha</th><th>Uso</th><th>Proveedor</th><th>Resultado</th></tr></thead><tbody>${runs.map((r) => html`<tr><td data-label="Fecha">${c.dateEs(r.created_at, { time: true })}</td><td data-label="Uso">${r.purpose}</td><td data-label="Proveedor">${r.provider} (${r.model})</td><td data-label="Resultado">${c.badge(r.status, r.status === 'limite' ? 'warn' : 'bad')} ${r.error_code || ''}</td></tr>`)}</tbody></table>` : html`<p class="muted">Ninguna.</p>`}`);
});

router.post('/trabajos/:id/reintentar', (req, res) => {
  const id = intParam(req.params.id);
  if (id && queue.retry(id)) audit(req.user.id, 'cola.reintento', { targetType: 'trabajo', targetId: id });
  res.redirect(303, '/admin/fallos?aviso=guardado');
});

router.post('/planes/:id/reintentar', (req, res, next) => {
  const p = db.one("SELECT * FROM plan_versions WHERE id = ? AND status = 'fallido'", intParam(req.params.id));
  if (!p) return next(notFound());
  planDomain.retry(p.user_id, p.id);
  audit(req.user.id, 'plan.reintento', { targetType: 'plan', targetId: p.id });
  res.redirect(303, '/admin/fallos?aviso=guardado');
});

// ───────── Uso de IA ─────────
router.get('/ia', (req, res) => {
  const period = ['7', '30', '90', 'todo'].includes(req.query.periodo) ? req.query.periodo : '30';
  const from = since(period);
  const rows = db.all(
    "SELECT purpose, provider, model, status, COUNT(*) AS n, SUM(input_tokens) AS inp, SUM(output_tokens) AS outp, SUM(cost_micros) AS cost FROM ai_runs WHERE created_at >= ? GROUP BY purpose, provider, model, status ORDER BY purpose, status",
    from
  );
  const daily = db.all("SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS n, SUM(cost_micros) AS cost FROM ai_runs WHERE created_at >= ? GROUP BY d ORDER BY d DESC LIMIT 31", from);
  page(res, 'ia', 'Uso de IA', html`${periodPicker('/admin/ia', period)}
    <p class="muted">Proveedor activo: ${ai.providerName() === 'anthropic' ? `Anthropic (${config.ai.model})` : 'local de desarrollo (sin red, sin costo)'}. Gasto del mes en curso: ${usd(ai.monthlySpendMicros())} de ${usd(Number(getSetting('ai_global_monthly_budget_usd')) * 1e6)}.</p>
    <table class="data stack-sm"><thead><tr><th>Uso</th><th>Modelo</th><th>Resultado</th><th class="r">Llamadas</th><th class="r">Tokens entrada / salida</th><th class="r">Costo estimado</th></tr></thead><tbody>
      ${rows.map((r) => html`<tr><td data-label="Uso">${r.purpose}</td><td data-label="Modelo">${r.model}</td><td data-label="Resultado">${r.status}</td><td data-label="Llamadas" class="r">${r.n}</td><td data-label="Tokens" class="r">${(r.inp || 0).toLocaleString('es')} / ${(r.outp || 0).toLocaleString('es')}</td><td data-label="Costo" class="r">${usd(r.cost || 0)}</td></tr>`)}
    </tbody></table>
    <h2 class="section">Por día</h2>
    <table class="data"><thead><tr><th>Día</th><th class="r">Llamadas</th><th class="r">Costo estimado</th></tr></thead><tbody>${daily.map((d) => html`<tr><td>${d.d}</td><td class="r">${d.n}</td><td class="r">${usd(d.cost || 0)}</td></tr>`)}</tbody></table>
    <p class="small faint">Precios de referencia por millón de tokens: ${Object.entries(ai.PRICING).filter(([k]) => k !== 'local').map(([k, [i, o]]) => `${k} $${i} / $${o}`).join('; ')}. Se guarda el modelo, la versión de instrucciones y la entrada de cada generación; este panel no muestra su contenido.</p>`);
});

// ───────── Cuestionarios versionados ─────────
router.get('/cuestionarios', (req, res) => {
  const list = db.all('SELECT q.*, (SELECT COUNT(*) FROM evaluations e WHERE e.questionnaire_id = q.id) AS evals FROM questionnaires q ORDER BY kind, version DESC');
  const ctx = res.locals.ctx;
  page(res, 'cuestionarios', 'Cuestionarios', html`<p class="muted">Edita un borrador y publícalo. Las evaluaciones ya empezadas o terminadas conservan la versión con la que se hicieron. Cambiar el tipo o el código de una pregunta, o añadir ramificaciones complejas, requiere una ampliación del desarrollo.</p>
    ${['gratuito', 'profundo'].map(
      (kind) => html`<h2 class="section">${kind === 'gratuito' ? 'Test gratuito' : 'Evaluación profunda'}</h2>
        <table class="data"><thead><tr><th>Versión</th><th>Estado</th><th class="r">Evaluaciones</th><th>Publicada</th><th></th></tr></thead><tbody>
        ${list.filter((q) => q.kind === kind).map((q) => html`<tr><td>v${q.version}</td><td>${c.badge(q.status, q.status === 'publicado' ? 'ok' : q.status === 'borrador' ? 'warn' : '')}</td><td class="r">${q.evals}</td><td>${q.published_at ? c.dateShort(q.published_at) : '—'}</td><td><a href="/admin/cuestionarios/${q.id}">${q.status === 'borrador' ? 'Editar' : 'Ver'}</a></td></tr>`)}
        </tbody></table>
        ${!list.some((q) => q.kind === kind && q.status === 'borrador') ? html`<form method="post" action="/admin/cuestionarios/${kind}/borrador" class="section">${c.csrfField(ctx)}<button class="btn btn-secondary btn-small" type="submit">Crear borrador desde la versión publicada</button></form>` : ''}`
    )}`);
});

router.post('/cuestionarios/:kind/borrador', (req, res, next) => {
  const kind = req.params.kind;
  if (!['gratuito', 'profundo'].includes(kind)) return next(notFound());
  const pub = qs.published(kind);
  if (db.one("SELECT id FROM questionnaires WHERE kind = ? AND status = 'borrador'", kind)) return res.redirect(303, '/admin/cuestionarios');
  db.tx(() => {
    const v = db.value('SELECT MAX(version) FROM questionnaires WHERE kind = ?', kind) + 1;
    const r = db.run("INSERT INTO questionnaires (kind, version, status, title, notes, created_by, created_at) VALUES (?, ?, 'borrador', ?, ?, ?, ?)", kind, v, pub.title, `Basado en la versión ${pub.version}.`, req.user.id, db.now());
    for (const q of pub.questions) {
      db.run(
        'INSERT INTO questions (questionnaire_id, position, code, section, type, prompt, help, options_json, config_json, required, allow_unknown) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        r.lastId, q.position, q.code, q.section, q.type, q.prompt, q.help, q.options_json, q.config_json, q.required ? 1 : 0, q.allowUnknown ? 1 : 0
      );
    }
    audit(req.user.id, 'cuestionario.borrador', { targetType: 'cuestionario', targetId: r.lastId, meta: { kind, version: v } });
  });
  res.redirect(303, '/admin/cuestionarios?aviso=borrador_creado');
});

router.get('/cuestionarios/:id', (req, res, next) => {
  const qn = qs.load(intParam(req.params.id));
  if (!qn) return next(notFound());
  const editable = qn.status === 'borrador';
  const ctx = res.locals.ctx;
  page(res, 'cuestionarios', `${qn.kind === 'gratuito' ? 'Test gratuito' : 'Evaluación profunda'} v${qn.version}`, html`
    <p>${c.badge(qn.status, qn.status === 'publicado' ? 'ok' : 'warn')} ${qn.notes || ''}</p>
    ${editable ? html`<form method="post" action="/admin/cuestionarios/${qn.id}/publicar" data-confirm="Al publicar, las nuevas evaluaciones usarán esta versión. Las anteriores no cambian.">${c.csrfField(ctx)}<button class="btn btn-primary" type="submit">Publicar esta versión</button></form>` : ''}
    ${qn.questions.map(
      (q) => html`<details class="row-card section" ${editable ? '' : ''}><summary><strong>${q.position}.</strong> ${q.prompt} <span class="small faint">(${q.code}, ${q.type})</span></summary>
        ${editable
          ? html`<form method="post" action="/admin/cuestionarios/${qn.id}/preguntas/${q.id}" novalidate class="section">${c.csrfField(ctx)}
              <div class="field"><label for="p-${q.id}">Pregunta</label><input class="input" id="p-${q.id}" name="prompt" value="${q.prompt}" maxlength="240" /></div>
              <div class="field"><label for="h-${q.id}">Ayuda</label><textarea class="input" id="h-${q.id}" name="help" maxlength="600">${q.help || ''}</textarea></div>
              ${q.options.length ? html`<div class="field"><label for="o-${q.id}">Opciones (una por línea: valor|texto). No cambies los valores: los usa el motor de cálculo.</label><textarea class="input code" id="o-${q.id}" name="options">${q.options.map((o) => `${o.value}|${o.label}`).join('\n')}</textarea></div>` : ''}
              <label class="check field"><input type="checkbox" name="required" value="1" ${q.required ? raw('checked') : ''} /> <span>Obligatoria</span></label>
              <label class="check field"><input type="checkbox" name="allow_unknown" value="1" ${q.allowUnknown ? raw('checked') : ''} /> <span>Permitir «No lo sé»</span></label>
              <button class="btn btn-secondary btn-small" type="submit">Guardar pregunta</button></form>`
          : html`<p class="small muted">${q.help || ''}</p>${q.options.length ? html`<ul class="small">${q.options.map((o) => html`<li>${o.label}</li>`)}</ul>` : ''}`}
      </details>`
    )}`);
});

router.post('/cuestionarios/:id/preguntas/:qid', (req, res, next) => {
  const qn = db.one("SELECT * FROM questionnaires WHERE id = ? AND status = 'borrador'", intParam(req.params.id));
  const q = qn && db.one('SELECT * FROM questions WHERE id = ? AND questionnaire_id = ?', intParam(req.params.qid), qn.id);
  if (!q) return next(notFound());
  const prompt = String(req.body.prompt || '').trim().slice(0, 240) || q.prompt;
  const help = String(req.body.help || '').trim().slice(0, 600) || null;
  let options = q.options_json;
  if (q.options_json && typeof req.body.options === 'string') {
    const old = JSON.parse(q.options_json);
    const parsed = req.body.options.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [value, ...rest] = l.split('|');
      return { value: value.trim(), label: rest.join('|').trim() };
    });
    const sameValues = parsed.length === old.length && parsed.every((o, i) => o.value === old[i].value && o.label);
    if (!sameValues) {
      const err = new Error('opciones');
      err.status = 422;
      err.publicMessage = 'Las opciones deben conservar los mismos valores y el mismo orden; solo puedes cambiar sus textos.';
      return next(err);
    }
    options = JSON.stringify(parsed.map((o, i) => ({ ...old[i], label: o.label })));
  }
  db.run('UPDATE questions SET prompt = ?, help = ?, options_json = ?, required = ?, allow_unknown = ? WHERE id = ?', prompt, help, options, req.body.required === '1' ? 1 : 0, req.body.allow_unknown === '1' ? 1 : 0, q.id);
  res.redirect(303, `/admin/cuestionarios/${qn.id}?aviso=guardado`);
});

router.post('/cuestionarios/:id/publicar', (req, res, next) => {
  const qn = db.one("SELECT * FROM questionnaires WHERE id = ? AND status = 'borrador'", intParam(req.params.id));
  if (!qn) return next(notFound());
  db.tx(() => {
    db.run("UPDATE questionnaires SET status = 'retirado' WHERE kind = ? AND status = 'publicado'", qn.kind);
    db.run("UPDATE questionnaires SET status = 'publicado', published_at = ? WHERE id = ?", db.now(), qn.id);
    audit(req.user.id, 'cuestionario.publicado', { targetType: 'cuestionario', targetId: qn.id, meta: { kind: qn.kind, version: qn.version } });
  });
  res.redirect(303, '/admin/cuestionarios?aviso=publicado');
});

// ───────── Reglas de diagnóstico ─────────
router.get('/reglas', (req, res) => {
  const list = db.all("SELECT * FROM rule_sets WHERE kind = 'diagnostico' ORDER BY version DESC");
  const ctx = res.locals.ctx;
  page(res, 'reglas', 'Reglas de diagnóstico', html`<p class="muted">Umbrales y pesos que usa el motor de cálculo. Cada diagnóstico guarda la versión con la que se calculó.</p>
    <table class="data"><thead><tr><th>Versión</th><th>Estado</th><th>Notas</th><th></th></tr></thead><tbody>${list.map((r) => html`<tr><td>v${r.version}</td><td>${c.badge(r.status, r.status === 'publicado' ? 'ok' : r.status === 'borrador' ? 'warn' : '')}</td><td class="small">${r.notes || ''}</td><td><a href="/admin/reglas/${r.id}">${r.status === 'borrador' ? 'Editar' : 'Ver'}</a></td></tr>`)}</tbody></table>
    ${!list.some((r) => r.status === 'borrador') ? html`<form method="post" action="/admin/reglas/borrador" class="section">${c.csrfField(ctx)}<button class="btn btn-secondary btn-small" type="submit">Crear borrador desde la versión publicada</button></form>` : ''}`);
});

router.post('/reglas/borrador', (req, res) => {
  if (!db.one("SELECT id FROM rule_sets WHERE kind = 'diagnostico' AND status = 'borrador'")) {
    const cur = rulesRepo.current();
    const v = db.value("SELECT MAX(version) FROM rule_sets WHERE kind = 'diagnostico'") + 1;
    db.run("INSERT INTO rule_sets (kind, version, status, rules_json, notes, created_by, created_at) VALUES ('diagnostico', ?, 'borrador', ?, ?, ?, ?)", v, JSON.stringify(cur.rules, null, 2), `Basado en la versión ${cur.version}.`, req.user.id, db.now());
  }
  res.redirect(303, '/admin/reglas?aviso=borrador_creado');
});

function rulesPage(res, r, { error = null, body = null } = {}) {
  const ctx = res.locals.ctx;
  const editable = r.status === 'borrador';
  return page(res, 'reglas', `Reglas v${r.version}`, html`<p>${c.badge(r.status, r.status === 'publicado' ? 'ok' : 'warn')}</p>
    ${error ? html`<div class="error-summary" role="alert"><h2>Revisa las reglas</h2><ul>${[].concat(error).map((e) => html`<li>${e}</li>`)}</ul></div>` : ''}
    <form method="post" action="/admin/reglas/${r.id}" novalidate>${c.csrfField(ctx)}
      <div class="field"><label for="f-rules">Reglas (JSON)</label><textarea class="input code" id="f-rules" name="rules" ${editable ? '' : raw('readonly')}>${body ?? r.rules_json}</textarea></div>
      <div class="field"><label for="f-notes">Notas</label><input class="input" id="f-notes" name="notes" value="${r.notes || ''}" ${editable ? '' : raw('readonly')} /></div>
      ${editable ? html`<div class="actions"><button class="btn btn-secondary" type="submit">Guardar borrador</button></div>` : ''}
    </form>
    ${editable ? html`<form method="post" action="/admin/reglas/${r.id}/publicar" class="section" data-confirm="Los nuevos diagnósticos usarán estas reglas. Los anteriores conservan su versión.">${c.csrfField(ctx)}<button class="btn btn-primary" type="submit">Publicar reglas</button></form>` : ''}`);
}

router.get('/reglas/:id', (req, res, next) => {
  const r = db.one('SELECT * FROM rule_sets WHERE id = ?', intParam(req.params.id));
  if (!r) return next(notFound());
  rulesPage(res, r);
});

router.post('/reglas/:id', (req, res, next) => {
  const r = db.one("SELECT * FROM rule_sets WHERE id = ? AND status = 'borrador'", intParam(req.params.id));
  if (!r) return next(notFound());
  let parsed;
  try {
    parsed = JSON.parse(String(req.body.rules || ''));
  } catch (e) {
    return rulesPage(res.status(422), r, { error: `JSON no válido: ${e.message}`, body: req.body.rules });
  }
  const errors = rulesRepo.validate(parsed);
  if (errors.length) return rulesPage(res.status(422), r, { error: errors, body: req.body.rules });
  db.run('UPDATE rule_sets SET rules_json = ?, notes = ? WHERE id = ?', JSON.stringify(parsed, null, 2), String(req.body.notes || '').slice(0, 300), r.id);
  res.redirect(303, `/admin/reglas/${r.id}?aviso=guardado`);
});

router.post('/reglas/:id/publicar', (req, res, next) => {
  const r = db.one("SELECT * FROM rule_sets WHERE id = ? AND status = 'borrador'", intParam(req.params.id));
  if (!r) return next(notFound());
  if (rulesRepo.validate(JSON.parse(r.rules_json)).length) return rulesPage(res.status(422), r, { error: 'Las reglas guardadas no son válidas.' });
  db.tx(() => {
    db.run("UPDATE rule_sets SET status = 'retirado' WHERE kind = 'diagnostico' AND status = 'publicado'");
    db.run("UPDATE rule_sets SET status = 'publicado', published_at = ? WHERE id = ?", db.now(), r.id);
    audit(req.user.id, 'reglas.publicadas', { targetType: 'reglas', targetId: r.id, meta: { version: r.version } });
  });
  res.redirect(303, '/admin/reglas?aviso=publicado');
});

// ───────── Textos versionados ─────────
const CONTENT_KEYS = { portada: 'Portada', consentimiento: 'Consentimiento', privacidad: 'Política de privacidad', condiciones: 'Condiciones de uso', oferta_evaluacion: 'Oferta de evaluación', oferta_plan: 'Oferta de Plan Maestro' };

router.get('/textos', (req, res) => {
  page(res, 'textos', 'Textos', html`<p class="muted">Cada cambio crea una versión nueva. Al publicar una versión del consentimiento, se pedirá de nuevo a quien empiece un test.</p>
    <table class="data"><thead><tr><th>Texto</th><th>Versión publicada</th><th>Borrador</th><th></th></tr></thead><tbody>
    ${Object.entries(CONTENT_KEYS).map(([k, l]) => {
      const pub = db.one("SELECT version, published_at FROM contents WHERE key = ? AND status = 'publicado' ORDER BY version DESC LIMIT 1", k);
      const draft = db.one("SELECT version FROM contents WHERE key = ? AND status = 'borrador' ORDER BY version DESC LIMIT 1", k);
      return html`<tr><td>${l}</td><td>${pub ? `v${pub.version}, ${c.dateShort(pub.published_at)}` : '—'}</td><td>${draft ? `v${draft.version}` : '—'}</td><td><a href="/admin/textos/${k}">Editar</a></td></tr>`;
    })}
    </tbody></table>`);
});

router.get('/textos/:key', (req, res, next) => {
  const key = req.params.key;
  if (!CONTENT_KEYS[key]) return next(notFound());
  const draft = db.one("SELECT * FROM contents WHERE key = ? AND status = 'borrador' ORDER BY version DESC LIMIT 1", key);
  const pub = db.one("SELECT * FROM contents WHERE key = ? AND status = 'publicado' ORDER BY version DESC LIMIT 1", key);
  const cur = draft || pub;
  const ctx = res.locals.ctx;
  page(res, 'textos', CONTENT_KEYS[key], html`<p class="small muted">${draft ? `Editando el borrador v${draft.version}.` : `Al guardar se creará un borrador basado en la versión publicada v${pub ? pub.version : 0}.`} Formato: párrafos separados por una línea en blanco, listas con «- » y títulos con «## ».</p>
    <form method="post" action="/admin/textos/${key}" novalidate>${c.csrfField(ctx)}
      <div class="field"><label for="f-title">Título</label><input class="input" id="f-title" name="title" value="${cur ? cur.title : ''}" maxlength="160" /></div>
      <div class="field"><label for="f-body">Contenido</label><textarea class="input code" id="f-body" name="body">${cur ? cur.body : ''}</textarea></div>
      <div class="actions"><button class="btn btn-secondary" type="submit">Guardar borrador</button></div>
    </form>
    ${draft ? html`<form method="post" action="/admin/textos/${key}/publicar" class="section">${c.csrfField(ctx)}<button class="btn btn-primary" type="submit">Publicar v${draft.version}</button></form>` : ''}`);
});

router.post('/textos/:key', (req, res, next) => {
  const key = req.params.key;
  if (!CONTENT_KEYS[key]) return next(notFound());
  const title = String(req.body.title || '').trim().slice(0, 160);
  const body = String(req.body.body || '').trim().slice(0, 20000);
  if (!title || !body) return res.redirect(303, `/admin/textos/${key}?aviso=sin_cambios`);
  const draft = db.one("SELECT * FROM contents WHERE key = ? AND status = 'borrador'", key);
  if (draft) db.run('UPDATE contents SET title = ?, body = ? WHERE id = ?', title, body, draft.id);
  else {
    const v = (db.value('SELECT MAX(version) FROM contents WHERE key = ?', key) || 0) + 1;
    db.run("INSERT INTO contents (key, version, status, title, body, created_by, created_at) VALUES (?, ?, 'borrador', ?, ?, ?, ?)", key, v, title, body, req.user.id, db.now());
  }
  res.redirect(303, `/admin/textos/${key}?aviso=guardado`);
});

router.post('/textos/:key/publicar', (req, res, next) => {
  const key = req.params.key;
  const draft = CONTENT_KEYS[key] && db.one("SELECT * FROM contents WHERE key = ? AND status = 'borrador'", key);
  if (!draft) return next(notFound());
  db.tx(() => {
    db.run("UPDATE contents SET status = 'retirado' WHERE key = ? AND status = 'publicado'", key);
    db.run("UPDATE contents SET status = 'publicado', published_at = ? WHERE id = ?", db.now(), draft.id);
    audit(req.user.id, 'texto.publicado', { targetType: 'texto', targetId: key, meta: { version: draft.version } });
  });
  res.redirect(303, '/admin/textos?aviso=publicado');
});

// ───────── Productos ─────────
router.get('/productos', (req, res) => {
  const ctx = res.locals.ctx;
  const products = db.all('SELECT * FROM products ORDER BY sort');
  page(res, 'productos', 'Productos', html`<p class="muted">Precio visible, moneda de cobro, duración de cada acceso y referencia en la pasarela. Los precios iniciales son de ejemplo y no están aprobados.</p>
    ${products.map((p) => {
      const grants = JSON.parse(p.grants_json);
      return html`<form method="post" action="/admin/productos/${p.id}" class="row-card section" novalidate>${c.csrfField(ctx)}
        <div class="label-line"><h2>${p.name}</h2>${p.active ? c.badge('Activo', 'ok') : c.badge('Inactivo')}</div>
        <div class="grid-3">
          <div class="field"><label for="n-${p.id}">Nombre</label><input class="input" id="n-${p.id}" name="name" value="${p.name}" maxlength="80" /></div>
          <div class="field"><label for="pr-${p.id}">Precio</label><input class="input" id="pr-${p.id}" name="price" inputmode="decimal" value="${(p.price_cents / 100).toFixed(2)}" /></div>
          <div class="field"><label for="cu-${p.id}">Moneda de cobro</label><select class="input" id="cu-${p.id}" name="currency">${Object.keys(money.CURRENCIES).map((k) => html`<option ${k === p.currency ? raw('selected') : ''}>${k}</option>`)}</select></div>
          ${grants.map((g, i) => html`<div class="field"><label for="d-${p.id}-${i}">Días de acceso: ${c.GRANT_LABELS[g.code]}</label><input class="input" id="d-${p.id}-${i}" name="days_${g.code}" inputmode="numeric" value="${g.days || ''}" /></div>`)}
          <div class="field"><label for="g-${p.id}">Referencia en la pasarela</label><input class="input" id="g-${p.id}" name="gateway_ref" value="${p.gateway_ref || ''}" maxlength="120" /></div>
        </div>
        <div class="field"><label for="s-${p.id}">Resumen</label><input class="input" id="s-${p.id}" name="summary" value="${p.summary}" maxlength="240" /></div>
        <div class="field"><label for="co-${p.id}">Condiciones</label><textarea class="input" id="co-${p.id}" name="conditions" maxlength="1000">${p.conditions}</textarea></div>
        <label class="check field"><input type="checkbox" name="active" value="1" ${p.active ? raw('checked') : ''} /> <span>Disponible para la venta</span></label>
        <button class="btn btn-secondary btn-small" type="submit">Guardar producto</button>
      </form>`;
    })}`);
});

router.post('/productos/:id', (req, res, next) => {
  const p = db.one('SELECT * FROM products WHERE id = ?', intParam(req.params.id));
  if (!p) return next(notFound());
  const price = money.parseAmount(req.body.price, req.body.currency);
  if (!price.ok || !money.CURRENCIES[req.body.currency]) {
    const err = new Error('precio');
    err.status = 422;
    err.publicMessage = 'Revisa el precio y la moneda.';
    return next(err);
  }
  const grants = JSON.parse(p.grants_json).map((g) => {
    const d = Number.parseInt(req.body[`days_${g.code}`], 10);
    return { code: g.code, days: Number.isFinite(d) && d > 0 ? Math.min(d, 3650) : null };
  });
  const cents = Math.round(Number(price.value) * 100);
  db.run(
    'UPDATE products SET name = ?, summary = ?, price_cents = ?, currency = ?, grants_json = ?, access_days = ?, gateway_ref = ?, conditions = ?, active = ?, updated_at = ? WHERE id = ?',
    String(req.body.name || p.name).trim().slice(0, 80),
    String(req.body.summary || p.summary).trim().slice(0, 240),
    cents,
    req.body.currency,
    JSON.stringify(grants),
    Math.max(...grants.map((g) => g.days || 0)) || null,
    String(req.body.gateway_ref || '').trim().slice(0, 120) || null,
    String(req.body.conditions || p.conditions).trim().slice(0, 1000),
    req.body.active === '1' ? 1 : 0,
    db.now(),
    p.id
  );
  audit(req.user.id, 'producto.actualizado', { targetType: 'producto', targetId: p.code, meta: { price_cents: cents, currency: req.body.currency, grants } });
  res.redirect(303, '/admin/productos?aviso=guardado');
});

// ───────── Ajustes de IA ─────────
router.get('/ajustes', (req, res) => {
  const ctx = res.locals.ctx;
  page(res, 'ajustes', 'Límites de IA', html`<form method="post" action="/admin/ajustes" novalidate>${c.csrfField(ctx)}
    <div class="grid-3">
      <div class="field"><label for="f-coach">Respuestas del coach por cuenta y mes</label><input class="input" id="f-coach" name="coach" inputmode="numeric" value="${getSetting('ai_coach_monthly_limit')}" /></div>
      <div class="field"><label for="f-plan">Generaciones de plan por cuenta y mes</label><input class="input" id="f-plan" name="plan" inputmode="numeric" value="${getSetting('ai_plan_monthly_limit')}" /></div>
      <div class="field"><label for="f-budget">Gasto global máximo al mes (USD)</label><input class="input" id="f-budget" name="budget" inputmode="decimal" value="${getSetting('ai_global_monthly_budget_usd')}" /></div>
    </div>
    ${!config.isProd ? html`<label class="check field"><input type="checkbox" name="simulate_failure" value="1" ${getSetting('ai_simulate_failure') ? raw('checked') : ''} /> <span>Simular un fallo del proveedor de IA (solo desarrollo y pruebas)</span></label>` : ''}
    <button class="btn btn-primary" type="submit">Guardar límites</button>
  </form>
  <p class="small faint section">Cuando se alcanza un límite, el coach lo explica y conserva la conversación; la generación de planes queda marcada como fallida y puede reintentarse sin costo.</p>`);
});

router.post('/ajustes', (req, res) => {
  const n = (v, d, max) => {
    const x = Number(String(v).replace(',', '.'));
    return Number.isFinite(x) && x >= 0 ? Math.min(x, max) : d;
  };
  const coach = Math.round(n(req.body.coach, getSetting('ai_coach_monthly_limit'), 100000));
  const plan = Math.round(n(req.body.plan, getSetting('ai_plan_monthly_limit'), 1000));
  const budget = n(req.body.budget, getSetting('ai_global_monthly_budget_usd'), 1e6);
  setSetting('ai_coach_monthly_limit', coach, req.user.id);
  setSetting('ai_plan_monthly_limit', plan, req.user.id);
  setSetting('ai_global_monthly_budget_usd', budget, req.user.id);
  if (!config.isProd) setSetting('ai_simulate_failure', req.body.simulate_failure === '1', req.user.id);
  audit(req.user.id, 'ia.limites', { meta: { coach, plan, budget, simulate: !config.isProd && req.body.simulate_failure === '1' } });
  res.redirect(303, '/admin/ajustes?aviso=guardado');
});

// ───────── Privacidad ─────────
router.get('/privacidad', (req, res) => {
  const list = db.all('SELECT * FROM privacy_requests ORDER BY status = \'pendiente\' DESC, created_at DESC LIMIT 100');
  const ctx = res.locals.ctx;
  page(res, 'privacidad', 'Solicitudes de privacidad', html`<p class="muted">Exportación y eliminación de datos a solicitud del titular. La política de retención está por definir.</p>
    ${list.length
      ? html`<table class="data stack-sm"><thead><tr><th>Fecha</th><th>Cuenta</th><th>Solicitud</th><th>Estado</th><th></th></tr></thead><tbody>
          ${list.map((r) => html`<tr><td data-label="Fecha">${c.dateShort(r.created_at)}</td><td data-label="Cuenta">${r.user_id ? html`<a href="/admin/usuarios/${r.user_id}">${r.user_email}</a>` : r.user_email}</td><td data-label="Solicitud">${r.kind === 'exportar' ? 'Copia de datos' : 'Eliminación'}</td><td data-label="Estado">${c.badge(r.status, r.status === 'pendiente' ? 'warn' : 'ok')}</td>
            <td>${r.status === 'pendiente' ? html`<form method="post" action="/admin/privacidad/${r.id}/rechazar">${c.csrfField(ctx)}<button class="btn btn-quiet btn-small" type="submit">Marcar como rechazada</button></form>` : ''}</td></tr>`)}
        </tbody></table>`
      : html`<p class="muted">Sin solicitudes.</p>`}
    <p class="small faint">Para atender una solicitud, abre la cuenta: allí puedes exportar los datos (se marca como completada) o eliminar la cuenta.</p>`);
});

router.post('/privacidad/:id/rechazar', (req, res, next) => {
  const id = intParam(req.params.id);
  if (!id || !db.run("UPDATE privacy_requests SET status = 'rechazada', resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'pendiente'", db.now(), req.user.id, id).changes) return next(notFound());
  audit(req.user.id, 'privacidad.solicitud_rechazada', { targetType: 'solicitud', targetId: id });
  res.redirect(303, '/admin/privacidad?aviso=guardado');
});

// ───────── Respaldos ─────────
router.get('/respaldos', (req, res) => {
  const ctx = res.locals.ctx;
  const last = getSetting('last_backup_at');
  const files = backup.list();
  page(res, 'respaldos', 'Respaldos', html`<p class="muted">Se crea un respaldo diario a partir de las ${config.backupHour}:00 y se verifica restaurándolo en un archivo temporal. Se conservan los últimos ${config.backupKeep}.</p>
    ${last && last.at ? html`<p>Último respaldo: ${c.dateEs(last.at, { time: true })} ${last.ok === true ? c.badge('Verificado', 'ok') : last.ok === false ? c.badge('Falló la verificación', 'bad') : c.badge('En proceso', 'warn')}</p>` : ''}
    ${req.query.verificacion ? html`<div class="note ${req.query.verificacion === 'ok' ? 'note--ok' : 'note--risk'}">${req.query.verificacion === 'ok' ? 'Respaldo creado y restauración comprobada: integridad correcta y mismos conteos que la base activa.' : 'La verificación del respaldo falló. Revisa el registro.'}</div>` : ''}
    <form method="post" action="/admin/respaldos" class="section">${c.csrfField(ctx)}<button class="btn btn-secondary" type="submit">Crear y verificar un respaldo ahora</button></form>
    <table class="data section"><thead><tr><th>Archivo</th><th class="r">Tamaño</th><th>Fecha</th></tr></thead><tbody>${files.map((f) => html`<tr><td class="small">${f.name}</td><td class="r">${(f.size / 1024).toFixed(0)} KB</td><td>${c.dateEs(f.mtime, { time: true })}</td></tr>`)}</tbody></table>
    <p class="small faint">Restauración: detén el servidor y ejecuta «npm run restore -- archivo.db». Ver README, sección Respaldo y restauración.</p>`);
});

router.post('/respaldos', wrap(async (req, res) => {
  const { runBackup } = require('../jobs');
  let ok = false;
  try {
    ok = runBackup().ok;
  } catch {
    ok = false;
  }
  audit(req.user.id, 'respaldo.manual', { meta: { ok } });
  res.redirect(303, `/admin/respaldos?verificacion=${ok ? 'ok' : 'error'}`);
}));

// ───────── Auditoría y correos ─────────
router.get('/auditoria', (req, res) => {
  const list = db.all('SELECT a.*, u.email FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id ORDER BY a.id DESC LIMIT 200');
  page(res, 'auditoria', 'Auditoría', html`<table class="data stack-sm"><thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Objeto</th><th>Motivo</th></tr></thead><tbody>
    ${list.map((a) => html`<tr><td data-label="Fecha">${c.dateEs(a.created_at, { time: true })}</td><td data-label="Quién">${a.email || (a.actor_user_id ? `#${a.actor_user_id}` : 'Sistema')}</td><td data-label="Acción">${a.action}</td><td data-label="Objeto">${a.target_type ? `${a.target_type} ${a.target_id}` : ''}</td><td data-label="Motivo">${a.reason || ''}</td></tr>`)}
  </tbody></table>`);
});

router.get('/correos', (req, res) => {
  const list = db.all('SELECT * FROM emails ORDER BY id DESC LIMIT 100');
  page(res, 'correos', 'Correos del sistema', html`<p class="muted">Verificación de correo y recuperación de acceso. ${config.mail.smtpHost ? 'Se envían por SMTP.' : 'Sin SMTP configurado: quedan en esta bandeja local.'}</p>
    ${list.map((m) => html`<details class="row-card section"><summary>${c.dateEs(m.created_at, { time: true })}: ${m.subject} para ${m.to_email} ${c.badge(m.status, m.status === 'enviado' ? 'ok' : m.status === 'fallido' ? 'bad' : 'warn')}</summary>
      ${config.isProd ? html`<p class="small muted">El contenido no se muestra en producción porque contiene enlaces de acceso.</p>` : html`<pre class="code small">${m.body_text}</pre>`}</details>`)}`);
});

module.exports = router;
