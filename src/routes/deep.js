'use strict';
// F06 Evaluación profunda y F07 Diagnóstico detallado.
const express = require('express');
const db = require('../db');
const { html, raw } = require('../lib/html');
const money = require('../lib/money');
const qs = require('../domain/questionnaire');
const deep = require('../domain/deep');
const rulesRepo = require('../domain/rules');
const calc = require('../domain/calc');
const entitlements = require('../domain/entitlements');
const { track, content } = require('../lib/services');
const c = require('../views/components');
const { createFlow } = require('./flow');
const { requireEntitlement, requireUser } = require('./guards');
const { intParam, notFound } = require('./util');

const router = express.Router();
const guard = requireEntitlement('evaluacion_profunda');

function currencyFor(req, ev, map) {
  const a = map.moneda_base;
  if (a && !a.unknown && a.value) return a.value;
  return (req.user && req.user.base_currency) || 'USD';
}

function previousFor(req, q, ev, currency) {
  const userId = req.user.id;
  let source = null;
  const prevDeep = db.one(
    "SELECT id FROM evaluations WHERE user_id = ? AND kind = 'profundo' AND status = 'finalizada' AND id <> ? ORDER BY completed_at DESC LIMIT 1",
    userId,
    ev.id
  );
  if (prevDeep) {
    const a = qs.answers(prevDeep.id)[q.code];
    if (a && !a.unknown && !a.skipped && a.value !== null) source = a;
  }
  if (!source && q.config.prefill && q.config.prefill.from === 'gratuito' && q.config.prefill.code === 'moneda') {
    const cur = db.value('SELECT currency FROM ft_sessions WHERE user_id = ? AND completed_revision IS NOT NULL AND currency IS NOT NULL ORDER BY completed_at DESC LIMIT 1', userId);
    if (cur) source = { value: cur };
  }
  if (!source) return null;
  const current = qs.answers(ev.id)[q.code];
  if (current && !current.unknown && JSON.stringify(current.value) === JSON.stringify(source.value)) return null;
  return { value: source.value, text: qs.display(q, { value: source.value }, currency) };
}

function checksFor(ev, qn, map) {
  return deep.checks(map, rulesRepo.current().rules, qn);
}

router.use(
  createFlow({
    kind: 'profundo',
    base: '/evaluacion',
    title: 'Evaluación profunda',
    finishLabel: 'Generar mi diagnóstico',
    finishVerb: 'generar tu diagnóstico',
    doneRedirect: '/diagnostico',
    guards: [guard],
    currency: currencyFor,
    previous: previousFor,
    savedNote: 'Cada respuesta se guarda al avanzar. Puedes continuar desde cualquier dispositivo con tu cuenta.',
    reviewExtra(req, ev, qn, map) {
      const list = checksFor(ev, qn, map);
      const blocking = list.filter((x) => x.level === 'bloqueo');
      const warnings = list.filter((x) => x.level === 'aviso');
      return {
        blocking: blocking.length > 0,
        html: html`${blocking.length
          ? html`<section class="section" aria-labelledby="h-contra">
              <h2 id="h-contra">Contradicciones por corregir</h2>
              ${blocking.map(
                (b) => html`<div class="note note--risk"><p><strong>No coincide.</strong> ${b.text}</p>
                  <p class="small links">${b.links.map(([p, l]) => html`<a href="/evaluacion/pregunta/${p}?volver=revision">${l}</a>`)}</p></div>`
              )}
            </section>`
          : ''}
        ${warnings.length
          ? html`<section class="section" aria-labelledby="h-avisos">
              <h2 id="h-avisos">Avisos para confirmar</h2>
              <p class="small muted">Corrige la respuesta o confirma que es correcta antes de generar el diagnóstico.</p>
              ${warnings.map(
                (w) => html`<div class="note note--warn"><p><strong>Revisa.</strong> ${w.text}</p>
                  <p class="small links">${w.links.map(([p, l]) => html`<a href="/evaluacion/pregunta/${p}?volver=revision">${l}</a>`)}</p></div>`
              )}
            </section>`
          : ''}`,
        ackFields: warnings.length
          ? html`<fieldset class="section"><legend class="label">Confirmaciones</legend>
              ${warnings.map(
                (w) => html`<label class="check field"><input type="checkbox" name="ack" value="${w.code}" /> <span>Confirmo que es correcto: ${w.text.split('.')[0]}.</span></label>`
              )}</fieldset>`
          : '',
      };
    },
    validateFinish(req, ev, qn, map) {
      const list = checksFor(ev, qn, map);
      const errs = [];
      const acks = [].concat(req.body.ack || []);
      for (const x of list) {
        if (x.level === 'bloqueo') errs.push(x.text);
        else if (!acks.includes(x.code)) errs.push(`Confirma o corrige: ${x.text}`);
      }
      return errs;
    },
    async finish(req, res, ev) {
      const d = deep.createDiagnosis(ev, req.user.id);
      const hasMovements = db.value('SELECT 1 FROM movements WHERE user_id = ? LIMIT 1', req.user.id);
      if (!hasMovements && ev.base_currency) db.run('UPDATE users SET base_currency = ?, updated_at = ? WHERE id = ?', ev.base_currency, db.now(), req.user.id);
      track('evaluacion_completada', { userId: req.user.id, dedupe: `evaluacion_completada:${ev.id}` });
      res.redirect(303, `/diagnostico/${d.id}`);
    },
  })
);

router.post('/evaluacion/nueva', guard, (req, res) => {
  const open = qs.findEvaluation('profundo', { userId: req.user.id }, 'en_curso');
  if (!open) qs.startEvaluation('profundo', { userId: req.user.id });
  res.redirect(303, '/evaluacion');
});

// ───────── Diagnóstico ─────────
function figureRow(label, value, src, { cls = '', currency, neg = false } = {}) {
  return html`<li class="${cls}"><span class="k">${label}${src ? c.src(src) : ''}</span><span class="v num ${neg ? 'neg' : ''}">${value}</span></li>`;
}

const BREAKDOWN_LABELS = Object.fromEntries(require('../db/content-v1').DEEP.questions.find((q) => q.code === 'gastos_desglose').config.fields.map((f) => [f.key, f.label]));

function diagnosisView(ctx, user, d, r) {
  const cur = r.currency;
  const f = (v) => (v === null || v === undefined ? 'Sin dato' : c.fmt(v, cur));
  const ents = entitlements.active(user.id);
  const plan = db.one("SELECT id, status FROM plan_versions WHERE user_id = ? AND is_current = 1", user.id);
  const offer = content('oferta_plan');
  const product = db.one("SELECT * FROM products WHERE code = 'plan_maestro' AND active = 1");
  const rs = rulesRepo.byId(d.rule_set_id);
  const qn = db.one('SELECT version FROM questionnaires WHERE id = ?', d.questionnaire_id);
  const bal = money.dec(r.balance);
  const RT = calc.RATE_TYPES;

  return html`<div class="label-line"><span class="status-pill">Diagnóstico detallado</span><span class="small faint">${c.dateEs(d.created_at)}</span></div>
    <h1 class="section">Tu diagnóstico</h1>
    <p class="lead">Tus cifras convertidas a un mes. Cada número indica si es un dato tuyo, un cálculo nuestro o un supuesto.</p>
    ${c.legend()}

    <section class="section" aria-labelledby="h-flujo">
      <h2 id="h-flujo">Flujo mensual</h2>
      <ul class="figures">
        ${r.income.items.map((i) => figureRow(i.label, f(i.value), 'dato', { cls: 'sub' }))}
        ${figureRow(r.income.net ? 'Ingresos netos' : 'Ingresos (declarados brutos)', f(r.income.total), 'calculo')}
        ${r.expenses.items.map((i) => figureRow(BREAKDOWN_LABELS[i.key] || 'Gasto total declarado', f(i.value), 'dato', { cls: 'sub' }))}
        ${r.expenses.annualMonthly !== null && money.dec(r.expenses.annualMonthly).gt(0) ? figureRow('Gastos anuales repartidos por mes', f(r.expenses.annualMonthly), 'supuesto', { cls: 'sub' }) : ''}
        ${figureRow('Gastos', f(r.expenses.total), 'calculo')}
        ${figureRow('Pagos de deuda', f(r.debtPayments), 'calculo')}
        <li class="total"><span class="k">Saldo disponible ${c.src('calculo')}<span class="small faint">Ingresos − gastos − pagos de deuda</span></span><span class="v num ${bal && bal.lt(0) ? 'neg' : ''}">${r.balance !== null ? f(r.balance) : 'No calculable'}</span></li>
        ${figureRow('Ahorro que apartas', f(r.saving), 'dato')}
        ${figureRow('Tasa de ahorro', r.savingsRate !== null ? money.formatPercent(r.savingsRate, 1) : r.savingsRateReason === 'ingresos_cero' ? 'No aplica sin ingresos' : 'Sin dato', 'calculo')}
        ${figureRow('Capacidad de ahorro', f(r.capacity), 'calculo')}
      </ul>
    </section>

    <section class="section" aria-labelledby="h-deudas">
      <h2 id="h-deudas">Deudas</h2>
      ${r.debts.length
        ? html`<p class="muted">Debes ${f(r.debtTotal)} en total. ${r.debtLoad !== null ? `Tus cuotas equivalen al ${money.formatPercent(r.debtLoad, 0)} de tu ingreso.` : ''}</p>
            <table class="data stack-sm">
              <thead><tr><th>Deuda</th><th class="r">Saldo</th><th class="r">Cuota</th><th>Tasa</th><th class="r">Interés del mes</th><th>Plazo estimado</th></tr></thead>
              <tbody>
                ${r.debts.map(
                  (x) => html`<tr>
                    <td data-label="Deuda"><strong>${x.name}</strong><br /><span class="small faint">${x.kindLabel}</span></td>
                    <td data-label="Saldo" class="r">${f(x.balance)}</td>
                    <td data-label="Cuota" class="r">${f(x.payment)}</td>
                    <td data-label="Tasa">${x.rate !== null ? `${String(x.rate).replace('.', ',')} %` : 'Sin dato'}<br /><span class="small faint">${RT[x.rateType] || ''}${x.monthlyRate !== null ? `, ${money.formatPercent(x.monthlyRate, 2)} mensual` : ''}</span></td>
                    <td data-label="Interés del mes" class="r">${x.firstInterest !== null ? f(x.firstInterest) : '—'}</td>
                    <td data-label="Plazo estimado">${x.status === 'proyectada'
                      ? html`${c.monthsText(x.months)}<br /><span class="small faint">Intereses: ${f(x.totalInterest)}</span>`
                      : x.status === 'pago_no_cubre_interes'
                        ? html`<span class="neg">La cuota no cubre el interés</span>`
                        : x.status === 'tasa_desconocida'
                          ? html`<span class="faint">Incompleta: falta la tasa</span>`
                          : x.status === 'plazo_excesivo'
                            ? html`<span class="neg">Más de 50 años</span>`
                            : x.status === 'pagada'
                              ? 'Pagada'
                              : html`<span class="faint">Sin datos suficientes</span>`}</td>
                  </tr>`
                )}
              </tbody>
            </table>
            <p class="small faint">${c.src('calculo')} Plazos e intereses proyectados mes a mes con la cuota actual. Tasa nominal anual ÷ 12; tasa efectiva anual convertida como (1 + tasa)^(1/12) − 1.</p>`
        : html`<p class="muted">No registraste deudas.</p>`}
    </section>

    <section class="section" aria-labelledby="h-reserva">
      <h2 id="h-reserva">Reserva para emergencias</h2>
      <ul class="figures">
        ${figureRow('Ahorro disponible', f(r.reserve.available), 'dato')}
        ${r.reserve.locked !== null ? figureRow('Ahorros no disponibles de inmediato', f(r.reserve.locked), 'dato', { cls: 'sub' }) : ''}
        ${figureRow('Meses de egresos que cubre', r.reserve.months !== null ? money.formatNumber(r.reserve.months, cur, 1) : 'Sin dato', 'calculo')}
        ${figureRow(`Reserva de referencia (${r.reserve.targetMonths} meses de egresos esenciales)`, f(r.reserve.target), 'supuesto')}
        ${figureRow('Te falta para la referencia', f(r.reserve.gap), 'calculo')}
      </ul>
    </section>

    ${r.goals.length
      ? html`<section class="section" aria-labelledby="h-metas">
          <h2 id="h-metas">Metas</h2>
          ${r.goals.map(
            (g) => html`<div class="goal">
              <div class="label-line"><strong>${g.name}</strong><span class="num">${f(g.saved)} de ${f(g.target)}</span></div>
              <div class="meter" role="img" aria-label="Avance ${money.formatPercent(g.progress, 0)}"><span style="width:${Math.round(Number(g.progress || 0) * 100)}%"></span></div>
              <div class="goal-line"><span>Avance ${money.formatPercent(g.progress, 0)} ${c.src('calculo')}</span><span>${g.needed !== null ? `Necesitas ${f(g.needed)} al mes para lograrla en ${g.desiredMonths} meses` : 'Sin plazo definido'}</span></div>
            </div>`
          )}
        </section>`
      : ''}

    <section class="section" aria-labelledby="h-riesgos">
      <h2 id="h-riesgos">Riesgos</h2>
      ${r.risks.length ? html`<ul class="findings findings--risk">${r.risks.map((x) => html`<li class="${x.level}"><span class="visually-hidden">Riesgo ${x.level}: </span>${x.text}</li>`)}</ul>` : html`<p class="muted">No detectamos riesgos importantes con tus datos.</p>`}
    </section>

    <section class="section" aria-labelledby="h-oport">
      <h2 id="h-oport">Oportunidades</h2>
      ${r.opportunities.length ? html`<ul class="findings">${r.opportunities.map((o) => html`<li>${o.text} ${c.src(o.src)}</li>`)}</ul>` : html`<p class="muted">Con tus respuestas no identificamos oportunidades adicionales.</p>`}
    </section>

    <section class="section" aria-labelledby="h-prio">
      <h2 id="h-prio">Prioridades</h2>
      <ol class="priority-list">${r.priorities.map((p) => html`<li>${p.title}</li>`)}</ol>
    </section>

    ${r.missing.length
      ? html`<section class="section" aria-labelledby="h-faltan"><h2 id="h-faltan">Datos faltantes</h2><ul class="findings findings--missing">${r.missing.map((m) => html`<li>${m}</li>`)}</ul></section>`
      : ''}

    <details class="more section">
      <summary>Supuestos y versiones usadas</summary>
      <ul class="small muted">${r.assumptions.map((a) => html`<li>${a}</li>`)}</ul>
      <p class="small faint">Cuestionario versión ${qn ? qn.version : '?'}, reglas de diagnóstico versión ${rs ? rs.version : '?'}, motor de cálculo ${d.calc_version}. Importes redondeados a dos decimales (redondeo comercial). Este diagnóstico no es una calificación crediticia.</p>
    </details>

    <hr class="rule" />
    <section aria-labelledby="h-plan">
      <h2 id="h-plan">${offer ? offer.title : 'Plan Maestro'}</h2>
      ${ents.plan_maestro
        ? html`<p class="muted">${plan ? 'Tu Plan Maestro ya está en marcha.' : 'El Plan Maestro está incluido en lo que adquiriste. No hay nada más que pagar.'}</p>
            <div class="actions"><a class="btn btn-primary" href="/plan">${plan ? 'Abrir mi Plan Maestro' : 'Crear mi Plan Maestro'}</a></div>`
        : html`<p class="muted">${offer ? offer.body : ''}</p>${product ? c.offerCard(ctx, product, { featured: true, cta: 'Comprar el Plan Maestro' }) : ''}`}
    </section>
    ${entitlements.has(user.id, 'evaluacion_profunda')
      ? html`<div class="actions actions--center section"><form class="inline-form" method="post" action="/evaluacion/nueva">${c.csrfField(ctx)}<button class="btn btn-quiet" type="submit">Actualizar mis datos con una nueva evaluación</button></form></div>`
      : ''}`;
}

router.get('/diagnostico', requireUser, (req, res) => {
  const d = deep.latestDiagnosis(req.user.id);
  if (!d) return res.redirect(303, entitlements.has(req.user.id, 'evaluacion_profunda') ? '/evaluacion' : '/comprar/evaluacion');
  res.redirect(303, `/diagnostico/${d.id}`);
});

router.get('/diagnostico/:id', requireUser, (req, res, next) => {
  const id = intParam(req.params.id);
  const d = id && db.one('SELECT * FROM diagnoses WHERE id = ? AND user_id = ?', id, req.user.id);
  if (!d) return next(notFound());
  res.page({ title: 'Diagnóstico', body: diagnosisView(res.locals.ctx, req.user, d, JSON.parse(d.result_json)) });
});

module.exports = router;
void raw;
