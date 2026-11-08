'use strict';
// Descarga del Plan Maestro en PDF (PDFKit, fuente Helvetica estándar).
const PDFDocument = require('pdfkit');
const money = require('../lib/money');

const INK = '#16202a';
const INK2 = '#4a5661';
const INK3 = '#75808a';
const PINE = '#265b4d';
const LINE = '#dde2dc';

function clean(t) {
  return String(t ?? '')
    .replace(/−/g, '-')
    .replace(/[  ]/g, ' ')
    .replace(/[^\x00-\xFF€–—‘’“”•…]/g, '');
}

function dateEs(iso) {
  const d = iso.length === 10 ? new Date(iso + 'T12:00:00Z') : new Date(iso);
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}

function planPdf({ user, plan, content, narrative }) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 64, right: 64 }, bufferPages: true, info: { Title: `Plan Maestro v${plan.version_number}`, Author: 'Día Uno' } });
  const cur = content.currency;
  const f = (v) => clean(v === null || v === undefined ? '—' : money.format(v, cur));
  const W = doc.page.width - 128;

  const h1 = (t) => doc.font('Helvetica-Bold').fontSize(24).fillColor(INK).text(clean(t));
  const h2 = (t) => {
    if (doc.y > doc.page.height - 160) doc.addPage();
    doc.moveDown(1.2);
    doc.font('Helvetica-Bold').fontSize(14).fillColor(INK).text(clean(t));
    const y = doc.y + 4;
    doc.moveTo(64, y).lineTo(64 + W, y).lineWidth(1.2).strokeColor(INK).stroke();
    doc.moveDown(0.8);
  };
  const p = (t, color = INK2, size = 10.5) => doc.font('Helvetica').fontSize(size).fillColor(color).text(clean(t), { lineGap: 3 });
  const row = (label, value, { bold = false } = {}) => {
    if (doc.y > doc.page.height - 90) doc.addPage();
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10.5).fillColor(INK).text(clean(label), 64, y, { width: W * 0.65 });
    const yEnd = doc.y;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(clean(value), 64 + W * 0.65, y, { width: W * 0.35, align: 'right' });
    doc.y = Math.max(yEnd, doc.y) + 4;
    doc.moveTo(64, doc.y).lineTo(64 + W, doc.y).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.y += 5;
    doc.x = 64;
  };

  doc.font('Helvetica').fontSize(10).fillColor(PINE).text('Día Uno');
  doc.moveDown(0.6);
  h1('Plan Maestro');
  doc.moveDown(0.3);
  p(`${user.name ? user.name + ', ' : ''}versión ${plan.version_number}. Tu Día Uno: ${dateEs(content.startDate)}. Generado el ${dateEs(plan.completed_at || plan.created_at)}.`, INK3, 10);

  h2('Diagnóstico');
  if (narrative) p(narrative.diagnostico);
  doc.moveDown(0.6);
  for (const x of content.diagnostico.situacion) row(x.label, f(x.value));
  doc.moveDown(0.4);
  p('Prioridades', INK, 11);
  content.diagnostico.prioridades.forEach((pr, i) => p(`${i + 1}. ${pr.title}`));
  if (content.diagnostico.faltantes.length) {
    doc.moveDown(0.4);
    p('Datos faltantes', INK, 11);
    content.diagnostico.faltantes.forEach((m) => p(`• ${m}`));
  }

  h2('Presupuesto y deuda');
  if (narrative) p(narrative.presupuesto);
  doc.moveDown(0.6);
  for (const l of content.presupuesto.lines) row(l.label, f(l.value));
  row('Disponible para el plan cada mes', f(content.presupuesto.available), { bold: true });
  const st = content.presupuesto.strategy;
  if (st.order.length) {
    doc.moveDown(0.4);
    p(`Orden de pago (método avalancha): ${st.order.join(', ')}.`);
    if (st.baseMonths && st.planMonths) p(`Sin pago extra terminas en ${st.baseMonths} meses; con el plan, en ${st.planMonths}. Intereses: ${f(st.baseInterest)} frente a ${f(st.planInterest)}.`);
  }
  if (st.alerts.length) p(`Atención: la cuota de ${st.alerts.join(', ')} no cubre los intereses del mes.`, '#9e3527');
  if (st.incomplete.length) p(`Simulación incompleta (falta la tasa): ${st.incomplete.join(', ')}.`, INK3);

  h2('Metas y escenarios');
  if (narrative) p(narrative.metas);
  doc.moveDown(0.6);
  if (content.metas.reserve) row(`Reserva para emergencias (objetivo ${f(content.metas.reserve.target)})`, content.metas.reserve.months ? `${content.metas.reserve.months} meses` : 'Sin plazo con el aporte actual');
  for (const g of content.metas.goals) row(`${g.name}: ${f(g.monthly)} al mes`, g.reachable ? `${g.months} meses` : 'Sin plazo alcanzable');
  doc.moveDown(0.4);
  for (const sc of content.metas.scenarios) {
    p(`${sc.name}${sc.kind === 'supuesto' ? ' (supuesto)' : ''}: reserva en 12 meses ${f(sc.reserveIn12)}${sc.debtMonths ? `; sin deudas en ${sc.debtMonths} meses` : ''}. ${sc.note}`);
  }

  h2('Plan de 90 días');
  if (narrative) p(narrative.plan90);
  doc.moveDown(0.6);
  for (const a of content.plan90) {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(PINE).text(`Día ${a.day}`, { continued: true }).fillColor(INK).text(clean(`   ${a.title}`));
    p(a.reason, INK2, 9.5);
    p(`Terminada cuando: ${a.criteria}`, INK3, 9.5);
    doc.moveDown(0.5);
  }

  h2('Hoja de ruta de 12 meses');
  if (narrative) p(narrative.hoja12);
  doc.moveDown(0.6);
  for (const m of content.hoja12) {
    if (doc.y > doc.page.height - 100) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(PINE).text(`Mes ${m.month}`, { continued: true }).fillColor(INK).text(clean(`   ${m.title}`));
    p(m.condition, INK3, 9.5);
    doc.moveDown(0.4);
  }
  doc.moveDown(0.4);
  p('Revisa el plan:', INK, 11);
  content.review.forEach((r) => p(`• ${r}`));

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(INK3).text(
      clean(`Día Uno. Cifras calculadas con tus datos; las explicaciones las redacta una IA. No es asesoría financiera profesional.   ${i + 1} / ${range.count}`),
      64,
      doc.page.height - 44,
      { width: W, align: 'center', lineBreak: false }
    );
  }
  doc.end();
  return doc;
}

module.exports = { planPdf };
