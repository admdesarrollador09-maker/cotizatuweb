// Creación, consulta y ajuste de cotizaciones (lado servidor).
import crypto from 'node:crypto';
import { buildConfig, mapDiscount, recurringItems } from './catalog.js';
import { getCatalog, nextQuoteNumbers, insertQuote, getQuoteByToken, updateQuote, getQuote, nowUtc } from './repo.js';
import { computeQuote, cleanSelection, formatPEN } from './pricing.js';
import { PERIOD_LABEL } from '../public/js/questions.js';
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
export function findCodeDiscount(catalog, code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c || c.length > 40) return null;
  const row = catalog.discounts.find((d) => d.code === c && d.active);
  if (!row) return null;
  const today = limaToday();
  if ((row.valid_from && today < row.valid_from) || (row.valid_to && today > row.valid_to)) return null;
  return mapDiscount(row);
}

const hist = (actor, action, note, extra = {}) => ({ at: nowUtc(), actor, action, note, ...extra });

/**
 * Recalcula la cotización con los precios oficiales guardados y la registra
 * junto con una copia de todos los conceptos e importes.
 */
export async function createQuote(store, body) {
  const channel = CHANNELS[body.channel] ? body.channel : 'propuesta';
  const c = body.client || {};
  const data = {
    name: String(c.name || '').trim(), company: String(c.company || '').trim(), email: String(c.email || '').trim().toLowerCase(),
    whatsapp: String(c.whatsapp || '').trim(), hasDomain: c.hasDomain || '', budget: c.budget || '', desiredDeadline: c.desiredDeadline || '',
    description: String(c.description || '').trim(), consent: body.consent === true,
  };
  const fieldErrors = validateClient(data);
  if (Object.keys(fieldErrors).length) throw new HttpError(422, 'Revisa los datos del formulario.', { fields: fieldErrors });

  const catalog = await getCatalog(store);
  const config = buildConfig(catalog);
  const selection = cleanSelection(body.selection);
  const codeDiscount = body.discountCode ? findCodeDiscount(catalog, body.discountCode) : null;
  if (body.discountCode && !codeDiscount) throw new HttpError(422, 'El código de descuento no es válido o ha vencido.', { fields: { discountCode: 'Código no válido.' } });
  const today = limaToday();
  const result = computeQuote(config, selection, { today, codeDiscount });
  if (!result.ok || !result.service) throw new HttpError(422, result.errors.join(' ') || 'Selección no válida.');

  const phone = normalizePhone(data.whatsapp);
  const settings = catalog.settings;
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify([
    result.selection, codeDiscount?.id || null, data.name, data.company, data.email, phone, data.hasDomain, data.budget, data.desiredDeadline,
    data.description, settings.pricing_version,
  ])).digest('hex');

  // Si el mismo cliente vuelve a pedir exactamente la misma cotización (por ejemplo, PDF y luego WhatsApp),
  // se reutiliza la existente en lugar de duplicarla.
  if (body.previousToken && /^[A-Za-z0-9_-]{20,64}$/.test(String(body.previousToken))) {
    const prev = await getQuoteByToken(store, String(body.previousToken));
    const fresh = prev && Date.now() - new Date(prev.created_at.replace(' ', 'T') + 'Z').getTime() < 86400e3;
    if (prev && fresh && prev.fingerprint === fingerprint && !prev.adjusted) {
      const q = prev.channels.includes(channel) ? prev : await updateQuote(store, prev.id, (x) => {
        if (!x.channels.includes(channel)) {
          x.channels.push(channel);
          x.history.unshift(hist('cliente', 'canal', `El cliente usó: ${CHANNELS[channel]}.`));
        }
      });
      return { quote: q, reused: true };
    }
  }

  const year = today.slice(0, 4);
  const { id, seq } = await nextQuoteNumbers(store, year);
  const all = [...result.lines, ...result.surcharges, ...(result.discount ? [result.discount] : [])];
  const now = nowUtc();
  const quote = {
    id,
    number: `CTW-${year}-${String(seq).padStart(4, '0')}`,
    token: crypto.randomBytes(24).toString('base64url'),
    status: 'nueva',
    channels: [channel],
    client: { name: data.name, company: data.company, email: data.email, whatsapp: phone },
    service_name: result.service.name,
    selection: result.selection,
    characteristics: result.scope,
    included: result.included,
    features: result.features,
    pending: result.pending,
    recurring_selected: result.recurring,
    recurring_totals: result.recurringTotals,
    recurring_pending: result.recurringPending,
    discount_name: result.discount ? result.discount.name : null,
    recurring: recurringItems(catalog),
    conditions: settings.conditions || '',
    tax_mode: result.taxMode, tax_rate: result.taxRate, tax_label: result.taxLabel,
    subtotal: result.subtotal, surcharge_total: result.surchargeTotal, discount_total: result.discountTotal,
    tax: result.tax, total: result.total, days: result.days,
    budget: data.budget, has_domain: data.hasDomain, description: data.description, desired_deadline: data.desiredDeadline,
    consent_at: now,
    valid_until: addDays(today, Number(settings.quote_validity_days || 15)),
    internal_notes: '', follow_up_date: null, adjusted: 0,
    pricing_version: Number(settings.pricing_version || 1),
    fingerprint,
    created_at: now, updated_at: now,
    lines: all.map((l, i) => ({ sort: i + 1, kind: l.kind, concept: l.concept, detail: l.detail || '', qty: l.qty, unit_price: l.unitPrice, amount: l.amount })),
    history: [hist('cliente', 'creada', `Solicitud recibida por: ${CHANNELS[channel]}.`, { to_status: 'nueva' })],
  };
  await insertQuote(store, quote);
  return { quote, reused: false };
}

export function recurringSummary(totals = {}, pendingNames = []) {
  const parts = Object.entries(totals).filter(([, v]) => v > 0).map(([p, v]) => `${formatPEN(v)} ${PERIOD_LABEL[p] || p}`);
  if (pendingNames.length) parts.push(`por confirmar: ${pendingNames.join(', ')}`);
  return parts.join(' + ');
}

/** Mensaje para WhatsApp: alcance y total, sin precios individuales. */
export function whatsappText(quote, pdfUrl) {
  const { client } = quote;
  const feats = [...(quote.features || []).map((f) => f.name), ...(quote.included || []).map((f) => f.name)];
  const recurring = (quote.recurring_selected || []).map((r) => r.name);
  return [
    `Hola, quiero solicitar mi cotización *${quote.number}* de CotizaTuWeb.`,
    '',
    `*Proyecto:* ${quote.service_name}`,
    ...(quote.characteristics || []).filter((c) => !c.long).map((c) => `• ${c.label}: ${c.value}`),
    feats.length ? `*Funciones incluidas:* ${feats.join(', ')}` : '',
    recurring.length ? `*Servicios recurrentes solicitados:* ${recurring.join(', ')}` : '',
    '',
    `*Total del desarrollo:* ${formatPEN(quote.total)}`,
    recurring.length ? `*Pagos recurrentes:* ${recurringSummary(quote.recurring_totals, quote.recurring_pending)}` : '',
    (quote.pending || []).length ? `*Por confirmar en la propuesta:* ${quote.pending.join(', ')}` : '',
    `*Plazo estimado:* ${quote.days} días hábiles`,
    '',
    `*Nombre:* ${client.name}${client.company ? ` (${client.company})` : ''}`,
    `*Correo:* ${client.email}`,
    pdfUrl ? `*PDF:* ${pdfUrl}` : '',
  ].filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0)).join('\n');
}

/** Ajuste manual del administrador: reemplaza los conceptos y recalcula totales. */
export async function adjustQuote(store, quoteId, rawLines, note, actor) {
  const q = await getQuote(store, quoteId);
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
    unit = kind === 'discount' ? -Math.abs(unit) : Math.abs(unit);
    return { sort: i + 1, kind, concept, detail: String(l.detail || '').slice(0, 300), qty, unit_price: unit, amount: unit * qty };
  });
  const subtotal = lines.filter((l) => !['surcharge', 'discount'].includes(l.kind)).reduce((s, l) => s + l.amount, 0);
  const surcharge = lines.filter((l) => l.kind === 'surcharge').reduce((s, l) => s + l.amount, 0);
  const discount = -lines.filter((l) => l.kind === 'discount').reduce((s, l) => s + l.amount, 0);
  const net = Math.max(0, subtotal + surcharge - discount);
  let tax = 0; let total = net;
  if (q.tax_mode === 'added') { tax = Math.round((net * q.tax_rate) / 100); total = net + tax; }
  else if (q.tax_mode === 'included') tax = net - Math.round(net / (1 + q.tax_rate / 100));

  return updateQuote(store, quoteId, (x) => {
    const before = { lines: x.lines, total: x.total };
    x.lines = lines;
    Object.assign(x, { subtotal, surcharge_total: surcharge, discount_total: discount, tax, total, adjusted: 1 });
    x.history.unshift(hist(actor, 'ajuste', `Ajuste manual: ${formatPEN(before.total)} → ${formatPEN(total)}. ${String(note || '').slice(0, 500)}`.trim(), { data: before }));
  });
}
