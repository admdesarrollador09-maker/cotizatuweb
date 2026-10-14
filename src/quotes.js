// Creación, consulta y ajuste de cotizaciones (lado servidor).
import crypto from 'node:crypto';
import { tx, getSettings, buildConfig, mapDiscount, recurringItems } from './db.js';
import { computeQuote, formatPEN } from '../public/js/pricing.js';
import { validateClient, normalizePhone, CHANNELS } from '../public/js/formOptions.js';
import { HttpError } from './http.js';

export function limaToday() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Busca un descuento con código; null si no existe, está inactivo o vencido. */
export function findCodeDiscount(db, code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c || c.length > 40) return null;
  const row = db.prepare('SELECT * FROM discounts WHERE code = ? AND active = 1').get(c);
  if (!row) return null;
  const today = limaToday();
  if ((row.valid_from && today < row.valid_from) || (row.valid_to && today > row.valid_to)) return null;
  return mapDiscount(row);
}

function cleanSelection(s = {}) {
  const int = (v) => (v === null || v === undefined || v === '' ? null : Number.parseInt(v, 10));
  return {
    serviceId: int(s.serviceId), pages: int(s.pages),
    design: int(s.design), languages: int(s.languages), content: int(s.content), deadline: int(s.deadline),
    features: Array.isArray(s.features) ? s.features.slice(0, 50).map((x) => int(x)).filter(Number.isInteger) : [],
  };
}

/**
 * Recalcula la cotización con los precios oficiales de la base de datos y la guarda
 * junto con una copia de todos los conceptos e importes.
 */
export function createQuote(db, body) {
  const channel = CHANNELS[body.channel] ? body.channel : 'propuesta';
  const c = body.client || {};
  const data = {
    name: String(c.name || '').trim(), company: String(c.company || '').trim(), email: String(c.email || '').trim().toLowerCase(),
    whatsapp: String(c.whatsapp || '').trim(), hasDomain: c.hasDomain, budget: c.budget || '', desiredDeadline: c.desiredDeadline || '',
    description: String(c.description || '').trim(), consent: body.consent === true,
  };
  const fieldErrors = validateClient(data);
  if (Object.keys(fieldErrors).length) throw new HttpError(422, 'Revisa los datos del formulario.', { fields: fieldErrors });

  const config = buildConfig(db);
  const selection = cleanSelection(body.selection);
  const codeDiscount = body.discountCode ? findCodeDiscount(db, body.discountCode) : null;
  if (body.discountCode && !codeDiscount) throw new HttpError(422, 'El código de descuento no es válido o ha vencido.', { fields: { discountCode: 'Código no válido.' } });
  const today = limaToday();
  const result = computeQuote(config, selection, { today, codeDiscount });
  if (!result.ok || !result.service) throw new HttpError(422, result.errors.join(' ') || 'Selección no válida.');

  const phone = normalizePhone(data.whatsapp);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify([
    result.selection, codeDiscount?.id || null, data.name, data.company, data.email, phone, data.hasDomain, data.budget, data.desiredDeadline, data.description,
  ])).digest('hex');

  const settings = getSettings(db);

  return tx(db, () => {
    // Si el mismo cliente vuelve a pedir exactamente la misma cotización (por ejemplo, PDF y luego WhatsApp),
    // se reutiliza la existente en lugar de duplicarla.
    const prev = body.previousToken && db.prepare(
      "SELECT * FROM quotes WHERE token = ? AND fingerprint = ? AND adjusted = 0 AND pricing_version = ? AND created_at > datetime('now','-1 day')"
    ).get(String(body.previousToken), fingerprint, Number(settings.pricing_version));
    if (prev) {
      const chans = new Set(prev.channels.split(',').filter(Boolean));
      if (!chans.has(channel)) {
        chans.add(channel);
        db.prepare("UPDATE quotes SET channels = ?, updated_at = datetime('now') WHERE id = ?").run([...chans].join(','), prev.id);
        db.prepare('INSERT INTO quote_history(quote_id, actor, action, note) VALUES (?,?,?,?)')
          .run(prev.id, 'cliente', 'canal', `El cliente usó: ${CHANNELS[channel]}.`);
      }
      return { quote: db.prepare('SELECT * FROM quotes WHERE id = ?').get(prev.id), reused: true };
    }

    let client = db.prepare('SELECT * FROM clients WHERE email = ?').get(data.email);
    if (client) {
      db.prepare('UPDATE clients SET name=?, company=?, whatsapp=? WHERE id=?').run(data.name, data.company, phone, client.id);
    } else {
      const r = db.prepare('INSERT INTO clients(name, company, email, whatsapp) VALUES (?,?,?,?)').run(data.name, data.company, data.email, phone);
      client = { id: Number(r.lastInsertRowid) };
    }

    const year = today.slice(0, 4);
    const seqKey = `quote_seq_${year}`;
    const seq = Number(db.prepare('SELECT value FROM settings WHERE key = ?').get(seqKey)?.value || 0) + 1;
    db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(seqKey, String(seq));
    const number = `CTW-${year}-${String(seq).padStart(4, '0')}`;
    const token = crypto.randomBytes(24).toString('base64url');
    const validUntil = addDays(today, Number(settings.quote_validity_days || 15));

    const r = db.prepare(`INSERT INTO quotes(number, token, client_id, status, channels, service_name, selection_json, characteristics_json,
      included_json, recurring_json, conditions, tax_mode, tax_rate, tax_label, subtotal, surcharge_total, discount_total, tax, total, days,
      budget, has_domain, description, desired_deadline, consent_at, valid_until, pricing_version, fingerprint)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),?,?,?)`).run(
      number, token, client.id, 'nueva', channel, result.service.name, JSON.stringify(result.selection),
      JSON.stringify(result.characteristics), JSON.stringify(result.included), JSON.stringify(recurringItems(db)),
      settings.conditions || '', result.taxMode, result.taxRate, result.taxLabel, result.subtotal, result.surchargeTotal,
      result.discountTotal, result.tax, result.total, result.days, data.budget, data.hasDomain, data.description,
      data.desiredDeadline, validUntil, Number(settings.pricing_version || 1), fingerprint,
    );
    const quoteId = Number(r.lastInsertRowid);
    const insL = db.prepare('INSERT INTO quote_lines(quote_id, sort, kind, concept, detail, qty, unit_price, amount) VALUES (?,?,?,?,?,?,?,?)');
    const all = [...result.lines, ...result.surcharges, ...(result.discount ? [result.discount] : [])];
    all.forEach((l, i) => insL.run(quoteId, i + 1, l.kind, l.concept, l.detail || '', l.qty, l.unitPrice, l.amount));
    db.prepare('INSERT INTO quote_history(quote_id, actor, action, to_status, note) VALUES (?,?,?,?,?)')
      .run(quoteId, 'cliente', 'creada', 'nueva', `Solicitud recibida por: ${CHANNELS[channel]}.`);
    return { quote: db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId), reused: false };
  });
}

export function quoteLines(db, quoteId) {
  return db.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY sort, id').all(quoteId).map((r) => ({ ...r }));
}

export function whatsappText(quote, lines, client, pdfUrl) {
  const chars = JSON.parse(quote.characteristics_json || '[]');
  const included = JSON.parse(quote.included_json || '[]');
  const feats = lines.filter((l) => l.kind === 'feature').map((l) => `${l.concept} (${formatPEN(l.amount)})`);
  const extra = lines.filter((l) => l.kind === 'surcharge' || l.kind === 'discount').map((l) => `${l.concept}: ${formatPEN(l.amount)}`);
  return [
    `Hola, quiero solicitar mi cotización *${quote.number}* de CotizaTuWeb.`,
    '',
    `*Proyecto:* ${quote.service_name}`,
    ...chars.map((c) => `• ${c.label}: ${c.value}`),
    feats.length ? `*Funcionalidades adicionales:* ${feats.join(', ')}` : '',
    included.length ? `*Incluido en el paquete:* ${included.map((f) => f.name).join(', ')}` : '',
    ...extra,
    `*Total estimado:* ${formatPEN(quote.total)}`,
    `*Plazo estimado:* ${quote.days} días hábiles`,
    '',
    `*Nombre:* ${client.name}${client.company ? ` (${client.company})` : ''}`,
    `*Correo:* ${client.email}`,
    pdfUrl ? `*PDF:* ${pdfUrl}` : '',
  ].filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0)).join('\n');
}

/** Ajuste manual del administrador: reemplaza los conceptos y recalcula totales. */
export function adjustQuote(db, quoteId, rawLines, note, actor) {
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId);
  if (!q) throw new HttpError(404, 'Cotización no encontrada.');
  if (!Array.isArray(rawLines) || !rawLines.length || rawLines.length > 100) throw new HttpError(422, 'Agrega al menos un concepto.');
  const KINDS = ['base', 'pages', 'design', 'languages', 'content', 'feature', 'item', 'surcharge', 'discount'];
  const lines = rawLines.map((l, i) => {
    const kind = KINDS.includes(l.kind) ? l.kind : 'item';
    const concept = String(l.concept || '').trim().slice(0, 200);
    const qty = Number.parseInt(l.qty, 10);
    let unit = Math.round(Number(l.unit_price));
    if (!concept) throw new HttpError(422, `El concepto ${i + 1} no tiene descripción.`);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) throw new HttpError(422, `Cantidad no válida en "${concept}".`);
    if (!Number.isFinite(unit) || Math.abs(unit) > 1e10) throw new HttpError(422, `Precio no válido en "${concept}".`);
    if (kind === 'discount') unit = -Math.abs(unit); else unit = Math.abs(unit);
    return { kind, concept, detail: String(l.detail || '').slice(0, 300), qty, unit_price: unit, amount: unit * qty };
  });
  const subtotal = lines.filter((l) => !['surcharge', 'discount'].includes(l.kind)).reduce((s, l) => s + l.amount, 0);
  const surcharge = lines.filter((l) => l.kind === 'surcharge').reduce((s, l) => s + l.amount, 0);
  const discount = -lines.filter((l) => l.kind === 'discount').reduce((s, l) => s + l.amount, 0);
  const net = Math.max(0, subtotal + surcharge - discount);
  let tax = 0; let total = net;
  if (q.tax_mode === 'added') { tax = Math.round((net * q.tax_rate) / 100); total = net + tax; }
  else if (q.tax_mode === 'included') tax = net - Math.round(net / (1 + q.tax_rate / 100));

  const before = { lines: quoteLines(db, quoteId), total: q.total };
  tx(db, () => {
    db.prepare('DELETE FROM quote_lines WHERE quote_id = ?').run(quoteId);
    const ins = db.prepare('INSERT INTO quote_lines(quote_id, sort, kind, concept, detail, qty, unit_price, amount) VALUES (?,?,?,?,?,?,?,?)');
    lines.forEach((l, i) => ins.run(quoteId, i + 1, l.kind, l.concept, l.detail, l.qty, l.unit_price, l.amount));
    db.prepare(`UPDATE quotes SET subtotal=?, surcharge_total=?, discount_total=?, tax=?, total=?, adjusted=1, updated_at=datetime('now') WHERE id=?`)
      .run(subtotal, surcharge, discount, tax, total, quoteId);
    db.prepare('INSERT INTO quote_history(quote_id, actor, action, note, data_json) VALUES (?,?,?,?,?)')
      .run(quoteId, actor, 'ajuste', `Ajuste manual: ${formatPEN(q.total)} → ${formatPEN(total)}. ${String(note || '').slice(0, 500)}`.trim(), JSON.stringify(before));
  });
}
