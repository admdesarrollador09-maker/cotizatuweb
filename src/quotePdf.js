// Documento PDF de la cotización. Usa solo los datos guardados (copia de precios),
// por lo que regenerar el PDF nunca cambia los importes emitidos.
import { PdfDoc } from './pdfwriter.js';
import { formatPEN, PERIOD_LABEL } from '../public/js/questions.js';

const C = { blue: '#2563EB', purple: '#8B5CF6', dark: '#0F172A', gray: '#E5E7EB', bg: '#F8FAFC', muted: '#64748B', text: '#334155' };
const STATUS_LABEL = { incluido: 'Incluido', opcional: 'Opcional', separado: 'Se cotiza por separado' };
const M = 48;

export function limaDate(utc) {
  const d = new Date(String(utc).replace(' ', 'T') + (String(utc).endsWith('Z') ? '' : 'Z'));
  const l = new Date(d.getTime() - 5 * 3600 * 1000);
  return l.toISOString().slice(0, 10);
}
export const dmy = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

function drawLogo(doc, x, y, s = 34) {
  doc.rect(x, y, s, s, { fill: C.dark, radius: s * 0.24 });
  const k = s / 34;
  doc.polyline([[x + 13 * k, y + 10 * k], [x + 7 * k, y + 17 * k], [x + 13 * k, y + 24 * k]], { color: C.blue, width: 3.2 * k });
  doc.polyline([[x + 21 * k, y + 10 * k], [x + 27 * k, y + 17 * k], [x + 21 * k, y + 24 * k]], { color: C.purple, width: 3.2 * k });
  doc.polyline([[x + 18.5 * k, y + 9 * k], [x + 15.5 * k, y + 25 * k]], { color: '#FFFFFF', width: 2.2 * k });
}

export function renderQuotePdf({ quote, settings }) {
  const client = quote.client;
  const doc = new PdfDoc();
  const PW = doc.width;
  const CW = PW - M * 2;
  const bottom = doc.height - 64;
  let y = 40;

  const ensure = (h) => { if (y + h > bottom) { doc.addPage(); y = 48; return true; } return false; };

  // Encabezado
  drawLogo(doc, M, y);
  doc.text('Cotiza', M + 44, y + 3, { size: 18, bold: true });
  doc.text('TuWeb', M + 44 + doc.textWidth('Cotiza', 18, true), y + 3, { size: 18, bold: true, color: C.blue });
  doc.text(settings.company_name || '', M + 44, y + 24, { size: 8.5, color: C.muted });

  doc.text('COTIZACIÓN', M, y, { size: 15, bold: true, color: C.purple, align: 'right', width: CW, spacing: 1 });
  doc.text(`N.º ${quote.number}`, M, y + 20, { size: 10, bold: true, align: 'right', width: CW });
  y += 52;
  doc.rect(M, y, CW / 2, 3, { fill: C.blue });
  doc.rect(M + CW / 2, y, CW / 2, 3, { fill: C.purple });
  y += 14;

  const issued = limaDate(quote.created_at);
  const meta = [['Fecha de emisión', dmy(issued)], ['Vigencia de la oferta', `Hasta el ${dmy(quote.valid_until)}`], ['Plazo estimado', `${quote.days} días hábiles`]];
  const mw = CW / 3;
  meta.forEach(([k, v], i) => {
    doc.text(k.toUpperCase(), M + i * mw, y, { size: 7, color: C.muted, spacing: 0.4 });
    doc.text(v, M + i * mw, y + 11, { size: 10, bold: true });
  });
  y += 36;

  const block = (title, color) => { ensure(40); doc.text(title.toUpperCase(), M, y, { size: 8, bold: true, color, spacing: 0.6 }); y += 15; };
  const para = (t, size = 8.8, indent = 0, bullet = false, color = C.text) => {
    const ls = doc.wrap(t, size, CW - indent - (bullet ? 10 : 0));
    ls.forEach((l, i) => {
      ensure(12);
      if (bullet && i === 0) doc.text('•', M + indent, y, { size, color: C.blue });
      doc.text(l, M + indent + (bullet ? 10 : 0), y, { size, color });
      y += size + 3.5;
    });
  };

  // Cliente y proyecto
  const colW = (CW - 14) / 2;
  const features = quote.features || (quote.lines || []).filter((l) => l.kind === 'feature').map((l) => ({ name: l.concept }));
  const included = quote.included || [];
  const clientRows = [client.name, client.company, client.email, `WhatsApp: ${client.whatsapp}`].filter(Boolean);
  const projRows = [`${features.length + included.length} funciones incluidas`, `Plazo estimado: ${quote.days} días hábiles`];
  const boxH = Math.max(clientRows.length, projRows.length + 1) * 13 + 34;
  doc.rect(M, y, colW, boxH, { fill: C.bg, radius: 8 });
  doc.rect(M + colW + 14, y, colW, boxH, { fill: C.bg, radius: 8 });
  doc.text('CLIENTE', M + 14, y + 12, { size: 7, bold: true, color: C.blue, spacing: 0.6 });
  clientRows.forEach((r, i) => doc.text(r, M + 14, y + 26 + i * 13, { size: 9.5, bold: i === 0, color: i === 0 ? C.dark : C.text }));
  const px = M + colW + 28;
  doc.text('PROYECTO', px, y + 12, { size: 7, bold: true, color: C.purple, spacing: 0.6 });
  doc.text(quote.service_name, px, y + 26, { size: 9.5, bold: true });
  projRows.forEach((r, i) => doc.text(r, px, y + 39 + i * 13, { size: 9, color: C.text }));
  y += boxH + 22;

  // Alcance del proyecto (sin precios individuales)
  const scope = quote.characteristics || [];
  if (scope.length) {
    block('Alcance del proyecto', C.blue);
    const lw = 170;
    for (const s of scope) {
      const vl = doc.wrap(String(s.value), 9, CW - lw - 10);
      ensure(vl.length * 12 + 6);
      doc.text(s.label, M, y, { size: 9, color: C.muted });
      vl.forEach((t, i) => doc.text(t, M + lw, y + i * 12, { size: 9, bold: !s.long, color: C.dark }));
      y += vl.length * 12 + 4;
      doc.line(M, y - 1, M + CW, y - 1, { color: '#EEF0F3', width: 0.6 });
      y += 3;
    }
    y += 10;
  }

  if (features.length || included.length) {
    block('Funciones incluidas', C.purple);
    for (const f of features) para(f.name, 9, 0, true, C.dark);
    for (const f of included) para(`${f.name} (incluido en el paquete)`, 9, 0, true, C.dark);
    y += 8;
  }

  const recSel = quote.recurring_selected || [];
  if (recSel.length) {
    block('Servicios recurrentes solicitados', C.blue);
    for (const r of recSel) para(`${r.name} (${PERIOD_LABEL[r.period] || r.period})`, 9, 0, true, C.dark);
    y += 8;
  }

  if ((quote.pending || []).length) {
    block('Por confirmar en la propuesta', C.purple);
    para('Estos puntos de tu proyecto se cotizan en la propuesta final y no están incluidos en el total:', 8.5);
    for (const p of quote.pending) para(p, 8.8, 0, true);
    y += 8;
  }

  // Total (único precio visible)
  const recTotals = Object.entries(quote.recurring_totals || {}).filter(([, v]) => v > 0);
  ensure(90 + recTotals.length * 16);
  y += 4;
  doc.rect(M, y, CW, 46, { fill: C.dark, radius: 9 });
  doc.text('TOTAL DEL DESARROLLO', M + 18, y + 18, { size: 10, bold: true, color: '#FFFFFF', spacing: 0.8 });
  doc.text(formatPEN(quote.total), M, y + 13, { size: 20, bold: true, color: '#FFFFFF', align: 'right', width: CW - 18 });
  y += 54;
  const notes = [];
  if (quote.tax_mode === 'added') notes.push(`Incluye ${quote.tax_label} (${quote.tax_rate} %).`);
  else if (quote.tax_mode === 'included') notes.push(`Precio con ${quote.tax_label} incluido.`);
  else notes.push(`Importes en soles (PEN). No incluye ${quote.tax_label || 'impuestos'}.`);
  if (quote.discount_name) notes.push(`Incluye el descuento "${quote.discount_name}".`);
  doc.text(notes.join(' '), M, y, { size: 8, color: C.muted, align: 'right', width: CW });
  y += 16;
  for (const [p, v] of recTotals) {
    doc.text(`Pago recurrente ${PERIOD_LABEL[p] || p}`, M, y, { size: 9.5, color: C.text });
    doc.text(formatPEN(v), M, y, { size: 9.5, bold: true, align: 'right', width: CW });
    y += 16;
  }
  if ((quote.recurring_pending || []).length) {
    para(`Pagos recurrentes por confirmar: ${quote.recurring_pending.join(', ')}.`, 8.5);
  }
  y += 14;

  if (quote.conditions) {
    block('Condiciones comerciales', C.purple);
    for (const c of quote.conditions.split('\n').filter((s) => s.trim())) para(c.trim(), 8.8, 0, true);
    y += 10;
  }

  const recurring = (quote.recurring || []).filter((r) => !recSel.some((x) => x.id === r.id));
  if (recurring.length) {
    ensure(recurring.length * 14 + 50); // mantener la tabla completa en una sola página
    block('Servicios no incluidos en el precio de desarrollo', C.blue);
    para('Estos servicios pueden generar pagos adicionales o recurrentes y se gestionan aparte del desarrollo:', 8.5);
    y += 4;
    for (const r of recurring) {
      ensure(16);
      doc.text(r.name, M, y, { size: 8.8, bold: true });
      doc.text(STATUS_LABEL[r.status] || r.status, M + 210, y, { size: 8.5, color: r.status === 'incluido' ? '#16A34A' : C.purple, bold: true });
      doc.text(r.reference || '', M + 330, y, { size: 8.2, color: C.muted, width: CW - 330 });
      y += 14;
    }
  }

  // Pie de página en todas las páginas
  const total = doc.pages.length;
  const contact = [settings.business_name || 'CotizaTuWeb', settings.contact_email, settings.whatsapp_number ? `WhatsApp +${settings.whatsapp_number}` : ''].filter(Boolean).join('  ·  ');
  doc.pages.forEach((page, i) => {
    doc.cur = page;
    doc.line(M, doc.height - 44, M + CW, doc.height - 44);
    doc.text(contact, M, doc.height - 36, { size: 7.5, color: C.muted });
    doc.text(`Cotización ${quote.number}  ·  Página ${i + 1} de ${total}`, M, doc.height - 36, { size: 7.5, color: C.muted, align: 'right', width: CW });
  });

  return doc.toBuffer({ title: `Cotización ${quote.number}`, author: settings.business_name || 'CotizaTuWeb' });
}
