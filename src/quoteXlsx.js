// Exportación de la cotización a Excel (.xlsx) sin dependencias externas.
// Muestra el mismo alcance y total que la página: sin precios individuales.
import zlib from 'node:zlib';
import { PERIOD_LABEL } from '../public/js/questions.js';
import { limaDate, dmy } from './quotePdf.js';

// ---------- ZIP mínimo ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---------- Hoja de cálculo ----------
const x = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const col = (i) => String.fromCharCode(65 + i);

export function renderQuoteXlsx({ quote, settings }) {
  const rows = []; // cada fila: [{v, s, n}] s=estilo (1 negrita, 2 moneda, 3 título), n=número
  const add = (...cells) => rows.push(cells.map((c) => (typeof c === 'object' && c !== null ? c : { v: c })));
  const b = (v) => ({ v, s: 1 });
  const c = quote.client;

  add({ v: `${settings.business_name || 'CotizaTuWeb'} — Cotización ${quote.number}`, s: 3 });
  add(settings.company_name || '');
  add('');
  add(b('Fecha de emisión'), dmy(limaDate(quote.created_at)));
  add(b('Vigente hasta'), dmy(quote.valid_until));
  add(b('Cliente'), c.name);
  add(b('Proyecto o empresa'), c.company || '');
  add(b('Correo'), c.email);
  add(b('WhatsApp'), c.whatsapp);
  add('');
  add(b('Tipo de proyecto'), quote.service_name);
  for (const s of quote.characteristics || []) add(b(s.label), s.value);
  add('');
  const feats = [...(quote.features || []).map((f) => f.name), ...(quote.included || []).map((f) => `${f.name} (incluido en el paquete)`)];
  if (feats.length) { add(b('Funciones incluidas')); for (const f of feats) add('', f); add(''); }
  const rec = quote.recurring_selected || [];
  if (rec.length) { add(b('Servicios recurrentes solicitados')); for (const r of rec) add('', `${r.name} (${PERIOD_LABEL[r.period] || r.period})`); add(''); }
  if ((quote.pending || []).length) { add(b('Por confirmar en la propuesta')); for (const p of quote.pending) add('', p); add(''); }
  add(b('Plazo estimado'), `${quote.days} días hábiles`);
  add(b('Total del desarrollo'), { n: quote.total / 100, s: 2 });
  if (quote.tax_mode === 'added') add('', `Incluye ${quote.tax_label} (${quote.tax_rate} %)`);
  else if (quote.tax_mode === 'none') add('', `No incluye ${quote.tax_label || 'impuestos'}`);
  for (const [p, v] of Object.entries(quote.recurring_totals || {})) if (v > 0) add(b(`Pago recurrente ${PERIOD_LABEL[p] || p}`), { n: v / 100, s: 2 });
  if ((quote.recurring_pending || []).length) add(b('Recurrentes por confirmar'), quote.recurring_pending.join(', '));
  add('');
  if (quote.conditions) { add(b('Condiciones comerciales')); for (const l of quote.conditions.split('\n').filter((t) => t.trim())) add('', l.trim()); }

  const sheetRows = rows.map((cells, r) => `<row r="${r + 1}">${cells.map((cell, i) => {
    const ref = `${col(i)}${r + 1}`;
    const st = cell.s ? ` s="${cell.s}"` : '';
    if (typeof cell.n === 'number') return `<c r="${ref}"${st}><v>${cell.n.toFixed(2)}</v></c>`;
    if (cell.v === '' || cell.v === undefined) return '';
    return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${x(cell.v)}</t></is></c>`;
  }).join('')}</row>`).join('');

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="34" customWidth="1"/><col min="2" max="2" width="70" customWidth="1"/></cols><sheetData>${sheetRows}</sheetData></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;S/ &quot;#,##0.00"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF2563EB"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Cotización" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/styles.xml', styles],
  ]);
}
