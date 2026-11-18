'use strict';
// «Atajos» de Mi dinero (CV2-501/502): recurrentes (se sugieren cada mes) y plantillas rápidas (un toque).
// Funciona sin JavaScript: todo son formularios.
const { html, raw } = require('../lib/html');
const money = require('../lib/money');
const tracker = require('../domain/tracker');
const c = require('./components');

const SHEET_KINDS = ['gasto', 'ingreso'];
const fmt = (v, cur) => money.format(String(v), cur);

function opciones(userId, sel) {
  return SHEET_KINDS.map(
    (k) => html`<optgroup label="${tracker.KINDS[k]}">${tracker.categoryUsage(userId, k).map((code) => html`<option value="${k}:${code}" ${sel === `${k}:${code}` ? raw('selected') : ''}>${tracker.KINDS[k]}: ${tracker.CATEGORIES[k][code]}</option>`)}</optgroup>`
  );
}

function recurrentesBloque(ctx, d) {
  const { recurrentes, propuestos, cur, errors = {}, form = {}, userId } = d;
  return html`<section aria-labelledby="at-rec-h" class="md-section">
    <h2 id="at-rec-h">Recurrentes</h2>
    <p class="muted">Lo que se repite cada mes. Te lo sugiero en su día y tú decides si lo anoto: nunca se registra solo.</p>
    ${propuestos.length ? html`<div class="note"><strong>Parece que esto se repite</strong><ul class="plain">${propuestos.slice(0, 5).map((p) => html`<li>
      <form method="post" action="/mi-dinero/atajos/recurrentes" class="md-inline-form">${c.csrfField(ctx)}
        <input type="hidden" name="kindcat" value="${p.tipo}:${p.categoria}" /><input type="hidden" name="note" value="${p.nota}" /><input type="hidden" name="amount" value="${p.monto}" /><input type="hidden" name="day" value="${p.dia}" />
        «${p.nota}» · ${fmt(p.monto, cur)} · ${p.veces} meses · día ${p.dia}
        <button class="btn btn-secondary btn-small" type="submit">Programarlo</button></form>
      <form method="post" action="/mi-dinero/atajos/recurrentes/descartar" class="md-inline-form">${c.csrfField(ctx)}<input type="hidden" name="clave" value="${p.clave}" /><button class="md-link" type="submit">No, gracias</button></form></li>`)}</ul></div>` : ''}
    ${recurrentes.length
      ? html`<ul class="plain">${recurrentes.map((r) => html`<li class="md-row">
          <span>${r.note} · ${fmt(r.amount, cur)} · día ${r.day_of_month} ${r.active ? '' : html`<em>(en pausa)</em>`}</span>
          <form method="post" action="/mi-dinero/atajos/recurrentes/${r.id}/${r.active ? 'pausar' : 'reanudar'}" class="md-inline-form">${c.csrfField(ctx)}<button class="md-link" type="submit">${r.active ? 'Pausar' : 'Reanudar'}</button></form>
          <form method="post" action="/mi-dinero/atajos/recurrentes/${r.id}/eliminar" class="md-inline-form" data-confirm="¿Eliminar este recurrente? Lo ya anotado no cambia.">${c.csrfField(ctx)}<button class="md-link" type="submit">Eliminar</button></form></li>`)}</ul>`
      : html`<p class="faint">Aún no tienes recurrentes.</p>`}
    <form method="post" action="/mi-dinero/atajos/recurrentes" novalidate class="md-form">${c.csrfField(ctx)}
      <h3>Nuevo recurrente</h3>${c.errorSummary(errors)}
      <div class="field"><label for="r-note">Nombre</label><input class="input" id="r-note" name="note" maxlength="60" value="${form.note || ''}" /></div>
      <div class="field"><label for="r-amount">Importe</label>${c.moneyInput({ name: 'amount', id: 'r-amount', value: form.amount, currency: cur, errors })}</div>
      <div class="field"><label for="r-kindcat">Tipo y categoría</label><select class="input" id="r-kindcat" name="kindcat">${opciones(userId, form.kindcat || 'gasto:servicios')}</select></div>
      <div class="field"><label for="r-day">Día del mes</label><input class="input" id="r-day" name="day" inputmode="numeric" maxlength="2" value="${form.day || '1'}" /></div>
      <div class="actions"><button class="btn btn-primary" type="submit">Guardar recurrente</button></div>
    </form>
  </section>`;
}

function plantillasBloque(ctx, d) {
  const { plantillas, candidatas, cur, userId, errorsP = {}, formP = {} } = d;
  return html`<section aria-labelledby="at-pl-h" class="md-section">
    <h2 id="at-pl-h">Atajos de un toque</h2>
    <p class="muted">Lo que anotas seguido, listo para registrar hoy con un toque.</p>
    ${candidatas.length ? html`<div class="note"><strong>Ya lo anotaste varias veces</strong><ul class="plain">${candidatas.slice(0, 4).map((p) => html`<li><form method="post" action="/mi-dinero/atajos/plantillas" class="md-inline-form">${c.csrfField(ctx)}
      <input type="hidden" name="label" value="${p.nota}" /><input type="hidden" name="kindcat" value="${p.tipo}:${p.categoria}" /><input type="hidden" name="amount" value="${p.monto}" />
      «${p.nota}» · ${fmt(p.monto, cur)} · ${p.veces} veces <button class="btn btn-secondary btn-small" type="submit">Guardar como atajo</button></form></li>`)}</ul></div>` : ''}
    ${plantillas.length
      ? html`<ul class="plain">${plantillas.map((t) => html`<li class="md-row"><span>${t.label} · ${fmt(t.amount, cur)}</span>
          <form method="post" action="/mi-dinero/atajos/plantillas/${t.id}/usar" class="md-inline-form">${c.csrfField(ctx)}<button class="btn btn-secondary btn-small" type="submit">Anotar hoy</button></form>
          <form method="post" action="/mi-dinero/atajos/plantillas/${t.id}/eliminar" class="md-inline-form" data-confirm="¿Eliminar este atajo?">${c.csrfField(ctx)}<button class="md-link" type="submit">Eliminar</button></form></li>`)}</ul>`
      : html`<p class="faint">Aún no tienes atajos.</p>`}
    <form method="post" action="/mi-dinero/atajos/plantillas" novalidate class="md-form">${c.csrfField(ctx)}
      <h3>Nuevo atajo</h3>${c.errorSummary(errorsP)}
      <div class="field"><label for="p-label">Nombre</label><input class="input" id="p-label" name="label" maxlength="40" value="${formP.label || ''}" /></div>
      <div class="field"><label for="p-amount">Importe</label>${c.moneyInput({ name: 'amount', id: 'p-amount', value: formP.amount, currency: cur, errors: errorsP })}</div>
      <div class="field"><label for="p-kindcat">Tipo y categoría</label><select class="input" id="p-kindcat" name="kindcat">${opciones(userId, formP.kindcat || 'gasto:alimentacion')}</select></div>
      <div class="actions"><button class="btn btn-primary" type="submit">Guardar atajo</button></div>
    </form>
  </section>`;
}

function page(ctx, d) {
  return html`<div class="md md--form">
    <div class="md-head"><h1><a class="md-back" href="/mi-dinero" aria-label="Volver a Mi dinero">‹</a> Recurrentes y atajos</h1></div>
    ${recurrentesBloque(ctx, d)}
    ${plantillasBloque(ctx, d)}
    <section class="md-section"><h2>Recordatorios</h2>
      <p class="muted">Como mucho dos por semana, solo si llevas unos días sin anotar. Sin presión.</p>
      <form method="post" action="/mi-dinero/atajos/recordatorios" class="md-form">${c.csrfField(ctx)}
        <label class="check"><input type="checkbox" name="activos" value="1" ${d.recordatorios ? raw('checked') : ''} /> Recordarme de forma amable que anote mis movimientos</label>
        <div class="actions"><button class="btn btn-secondary" type="submit">Guardar</button></div></form>
    </section>
  </div>`;
}

module.exports = { page };
