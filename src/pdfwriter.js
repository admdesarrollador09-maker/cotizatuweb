// Generador de PDF mínimo, sin dependencias externas.
// Soporta texto (Helvetica / Helvetica-Bold, WinAnsi), rectángulos, líneas y trazos.
// Coordenadas con origen en la esquina superior izquierda, en puntos (A4 = 595 x 842).
import zlib from 'node:zlib';
import { WIDTHS } from './fontmetrics.js';

const W = 595.28;
const H = 841.89;

const CP1252_HIGH = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

function toWinAnsi(str) {
  let out = '';
  for (const ch of String(str).normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (c === 0x0a || c === 0x0d || c === 0x09) out += ' ';
    else if (c >= 0x20 && c < 0x7f) out += ch;
    else if (c >= 0xa0 && c <= 0xff) out += String.fromCharCode(c);
    else if (CP1252_HIGH[c]) out += String.fromCharCode(CP1252_HIGH[c]);
    else out += '?';
  }
  return out;
}

function esc(s) {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
}

const n = (v) => (Math.round(v * 100) / 100).toString();

export class PdfDoc {
  constructor() {
    this.pages = [];
    this.width = W;
    this.height = H;
    this.addPage();
  }

  addPage() {
    this.cur = [];
    this.pages.push(this.cur);
    return this;
  }

  textWidth(text, size, bold = false) {
    const table = WIDTHS[bold ? 'Helvetica-Bold' : 'Helvetica'];
    let w = 0;
    for (const ch of toWinAnsi(text)) {
      const c = ch.charCodeAt(0);
      w += c >= 32 ? table[c - 32] || 556 : 0;
    }
    return (w * size) / 1000;
  }

  /** Divide un texto en líneas que quepan en `width`. */
  wrap(text, size, width, bold = false) {
    const lines = [];
    for (const para of String(text ?? '').split(/\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      let line = '';
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (this.textWidth(test, size, bold) <= width || !line) line = test;
        else { lines.push(line); line = w; }
      }
      lines.push(line);
    }
    return lines;
  }

  text(str, x, y, { size = 10, bold = false, color = '#0F172A', align = 'left', width = 0, spacing = 0 } = {}) {
    let tx = x;
    const tw = this.textWidth(str, size, bold) + spacing * Math.max(0, toWinAnsi(str).length - 1);
    if (align === 'right') tx = x + width - tw;
    else if (align === 'center') tx = x + (width - tw) / 2;
    const baseline = H - y - size * 0.8;
    this.cur.push(`BT /${bold ? 'F2' : 'F1'} ${n(size)} Tf ${hexToRgb(color)} rg ${spacing ? n(spacing) + ' Tc ' : ''}${n(tx)} ${n(baseline)} Td (${esc(toWinAnsi(str))}) Tj ${spacing ? '0 Tc ' : ''}ET`);
    return tw;
  }

  rect(x, y, w, h, { fill = null, stroke = null, lineWidth = 1, radius = 0 } = {}) {
    const ops = [];
    if (fill) ops.push(`${hexToRgb(fill)} rg`);
    if (stroke) ops.push(`${hexToRgb(stroke)} RG ${n(lineWidth)} w`);
    const Y = H - y - h;
    if (radius > 0) {
      const r = Math.min(radius, w / 2, h / 2);
      const k = 0.5523 * r;
      ops.push(
        `${n(x + r)} ${n(Y)} m ${n(x + w - r)} ${n(Y)} l ${n(x + w - r + k)} ${n(Y)} ${n(x + w)} ${n(Y + r - k)} ${n(x + w)} ${n(Y + r)} c`,
        `${n(x + w)} ${n(Y + h - r)} l ${n(x + w)} ${n(Y + h - r + k)} ${n(x + w - r + k)} ${n(Y + h)} ${n(x + w - r)} ${n(Y + h)} c`,
        `${n(x + r)} ${n(Y + h)} l ${n(x + r - k)} ${n(Y + h)} ${n(x)} ${n(Y + h - r + k)} ${n(x)} ${n(Y + h - r)} c`,
        `${n(x)} ${n(Y + r)} l ${n(x)} ${n(Y + r - k)} ${n(x + r - k)} ${n(Y)} ${n(x + r)} ${n(Y)} c h`
      );
    } else {
      ops.push(`${n(x)} ${n(Y)} ${n(w)} ${n(h)} re`);
    }
    ops.push(fill && stroke ? 'B' : fill ? 'f' : 'S');
    this.cur.push('q ' + ops.join(' ') + ' Q');
  }

  line(x1, y1, x2, y2, { color = '#E5E7EB', width = 1 } = {}) {
    this.cur.push(`q ${hexToRgb(color)} RG ${n(width)} w ${n(x1)} ${n(H - y1)} m ${n(x2)} ${n(H - y2)} l S Q`);
  }

  /** Trazo abierto con extremos redondeados (para los chevrons del logotipo). */
  polyline(points, { color = '#2563EB', width = 2 } = {}) {
    const p = points.map(([x, y], i) => `${n(x)} ${n(H - y)} ${i ? 'l' : 'm'}`).join(' ');
    this.cur.push(`q ${hexToRgb(color)} RG ${n(width)} w 1 J 1 j ${p} S Q`);
  }

  toBuffer({ title = 'Documento', author = '' } = {}) {
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    const catalogId = add(null);
    const pagesId = add(null);
    const f1 = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
    const f2 = add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));
    const pageIds = [];
    for (const ops of this.pages) {
      const raw = Buffer.from(ops.join('\n'), 'latin1');
      const z = zlib.deflateSync(raw);
      const cid = add(Buffer.concat([
        Buffer.from(`<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n`), z, Buffer.from('\nendstream'),
      ]));
      pageIds.push(add(Buffer.from(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${cid} 0 R >>`
      )));
    }
    objs[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    objs[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
    const infoId = add(Buffer.from(`<< /Title (${esc(toWinAnsi(title))}) /Author (${esc(toWinAnsi(author))}) /Producer (CotizaTuWeb) >>`, 'latin1'));

    const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let offset = chunks[0].length;
    const offsets = [];
    objs.forEach((body, i) => {
      const head = Buffer.from(`${i + 1} 0 obj\n`);
      const tail = Buffer.from('\nendobj\n');
      offsets.push(offset);
      chunks.push(head, body, tail);
      offset += head.length + body.length + tail.length;
    });
    const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    chunks.push(Buffer.from(xref + `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
    return Buffer.concat(chunks);
  }
}
