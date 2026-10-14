// Documento PDF de la cotización. Usa solo los datos guardados (copia de precios),
// por lo que regenerar el PDF nunca cambia los importes emitidos.
import { PdfDoc } from './pdfwriter.js';
import { formatPEN } from '../public/js/pricing.js';

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

export function renderQuotePdf({ quote, lines, client, settings }) {
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

  // Cliente y proyecto
  const colW = (CW - 14) / 2;
  const chars = JSON.parse(quote.characteristics_json || '[]');
  const clientRows = [client.name, client.company, client.email, `WhatsApp: ${client.whatsapp}`].filter(Boolean);
  const projRows = chars.map((c) => `${c.label}: ${c.value}`);
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

  // Detalle de servicios
  const cols = { concept: M + 10, qty: M + CW - 200, unit: M + CW - 150, amount: M + CW - 80 };
  const header = () => {
    doc.rect(M, y, CW, 22, { fill: C.dark, radius: 5 });
    doc.text('Detalle de servicios', cols.concept, y + 7, { size: 8.5, bold: true, color: '#FFFFFF' });
    doc.text('Cant.', cols.qty, y + 7, { size: 8.5, bold: true, color: '#FFFFFF', align: 'right', width: 30 });
    doc.text('P. unitario', cols.unit, y + 7, { size: 8.5, bold: true, color: '#FFFFFF', align: 'right', width: 62 });
    doc.text('Importe', cols.amount, y + 7, { size: 8.5, bold: true, color: '#FFFFFF', align: 'right', width: 70 });
    y += 28;
  };
  header();
  const items = lines.filter((l) => l.kind !== 'surcharge' && l.kind !== 'discount');
  const conceptW = cols.qty - cols.concept - 20;
  for (const l of items) {
    const cl = doc.wrap(l.concept, 9.5, conceptW, true);
    const dl = l.detail ? doc.wrap(l.detail, 8, conceptW) : [];
    const h = cl.length * 12 + dl.length * 10 + 10;
    if (ensure(h)) header();
    cl.forEach((t, i) => doc.text(t, cols.concept, y + i * 12, { size: 9.5, bold: true }));
    dl.forEach((t, i) => doc.text(t, cols.concept, y + cl.length * 12 + i * 10, { size: 8, color: C.muted }));
    doc.text(String(l.qty), cols.qty, y, { size: 9.5, align: 'right', width: 30 });
    doc.text(formatPEN(l.unit_price), cols.unit, y, { size: 9.5, align: 'right', width: 62 });
    doc.text(formatPEN(l.amount), cols.amount, y, { size: 9.5, bold: true, align: 'right', width: 70 });
    y += h - 4;
    doc.line(M, y, M + CW, y);
    y += 8;
  }

  // Totales
  const totals = [['Subtotal de desarrollo', quote.subtotal, false]];
  for (const l of lines.filter((x) => x.kind === 'surcharge')) totals.push([l.concept, l.amount, false]);
  for (const l of lines.filter((x) => x.kind === 'discount')) totals.push([l.concept, l.amount, false]);
  if (quote.tax_mode === 'added') totals.push([`${quote.tax_label} (${quote.tax_rate} %)`, quote.tax, false]);
  ensure(totals.length * 16 + 60);
  const tx = M + CW - 260;
  y += 4;
  for (const [k, v] of totals) {
    doc.text(k, tx, y, { size: 9.5, color: C.text });
    doc.text(formatPEN(v), tx, y, { size: 9.5, align: 'right', width: 260, color: v < 0 ? '#16A34A' : C.dark });
    y += 16;
  }
  doc.rect(tx - 12, y, 272, 34, { fill: C.dark, radius: 7 });
  doc.text('TOTAL', tx, y + 11, { size: 10, bold: true, color: '#FFFFFF', spacing: 0.8 });
  doc.text(formatPEN(quote.total), tx, y + 9, { size: 15, bold: true, color: '#FFFFFF', align: 'right', width: 248 });
  y += 40;
  const taxNote = quote.tax_mode === 'included' ? `Precio incluye ${quote.tax_label} (${quote.tax_rate} %): ${formatPEN(quote.tax)}.`
    : quote.tax_mode === 'none' ? `Importes en soles (PEN). No incluye ${quote.tax_label || 'impuestos'}.` : 'Importes en soles (PEN).';
  doc.text(taxNote, tx - 12, y, { size: 7.5, color: C.muted, align: 'right', width: 272 });
  y += 22;

  const block = (title, color) => { ensure(40); doc.text(title.toUpperCase(), M, y, { size: 8, bold: true, color, spacing: 0.6 }); y += 15; };
  const para = (t, size = 8.8, indent = 0, bullet = false) => {
    const ls = doc.wrap(t, size, CW - indent - (bullet ? 10 : 0));
    ls.forEach((l, i) => {
      ensure(12);
      if (bullet && i === 0) doc.text('•', M + indent, y, { size, color: C.blue });
      doc.text(l, M + indent + (bullet ? 10 : 0), y, { size, color: C.text });
      y += size + 3.5;
    });
  };

  const included = JSON.parse(quote.included_json || '[]');
  if (included.length) {
    block('Incluido en el paquete sin costo adicional', C.blue);
    para(included.map((f) => f.name).join(' · '));
    y += 10;
  }

  if (quote.conditions) {
    block('Condiciones comerciales', C.purple);
    for (const c of quote.conditions.split('\n').filter((s) => s.trim())) para(c.trim(), 8.8, 0, true);
    y += 10;
  }

  const recurring = JSON.parse(quote.recurring_json || '[]');
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
