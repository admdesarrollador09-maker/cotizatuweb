/**
 * Motor de cálculo de CotizaTuWeb (solo en el servidor).
 *
 * El navegador nunca recibe tarifas: envía las respuestas del cliente y el servidor
 * devuelve el total. Todos los importes se manejan en céntimos.
 *
 * Importe `null` en una opción o funcionalidad = "pendiente de configuración":
 * no suma al total y se informa como un punto que se confirma en la propuesta.
 */
import { GROUPS, featureMode, questionVisible, serviceUsesPages, formatPEN } from '../public/js/questions.js';

export { formatPEN };

const pct = (base, percent) => Math.round((base * Number(percent || 0)) / 100);

function amountOf(priceType, amount, ctx) {
  const a = Number(amount || 0);
  switch (priceType) {
    case 'per_page': return { amount: Math.round(a) * ctx.pages, qty: ctx.pages, unit: Math.round(a) };
    case 'percent_base': { const v = pct(ctx.basePrice, a); return { amount: v, qty: 1, unit: v }; }
    default: return { amount: Math.round(a), qty: 1, unit: Math.round(a) };
  }
}

function discountApplies(d, subtotal, today) {
  if (!d || !d.active) return false;
  if (d.validFrom && today < d.validFrom) return false;
  if (d.validTo && today > d.validTo) return false;
  if (d.minSubtotal && subtotal < d.minSubtotal) return false;
  return true;
}

export function pickOption(config, group, id) {
  const list = config.options[group] || [];
  return list.find((o) => o.id === Number(id)) || list.find((o) => o.isDefault) || list[0] || null;
}

export function defaultPageRange(config, service) {
  return config.pageRanges.find((r) => r.pages >= service.includedPages) || config.pageRanges[0] || null;
}

/** Limpia la selección enviada por el navegador. */
export function cleanSelection(s = {}) {
  const int = (v) => (v === null || v === undefined || v === '' ? null : Number.parseInt(v, 10));
  const ints = (a) => (Array.isArray(a) ? a.slice(0, 80).map(int).filter(Number.isInteger) : []);
  const answers = {};
  if (s.answers && typeof s.answers === 'object') {
    for (const [k, v] of Object.entries(s.answers).slice(0, 60)) {
      if (!/^[a-z_]{1,40}$/.test(k)) continue;
      answers[k] = typeof v === 'string' ? v.slice(0, 1000) : int(v);
    }
  }
  return {
    serviceId: int(s.serviceId), pageRange: int(s.pageRange),
    design: int(s.design), languages: int(s.languages), content: int(s.content), deadline: int(s.deadline),
    answers, features: ints(s.features), recurring: ints(s.recurring),
  };
}

/**
 * Calcula una cotización.
 * @param {object} config  buildConfig(catálogo) — contiene las tarifas.
 * @param {object} sel     cleanSelection(...)
 * @param {object} [opts]  { today:'YYYY-MM-DD', codeDiscount }
 */
export function computeQuote(config, sel, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const errors = [];
  const service = config.services.find((s) => s.id === Number(sel.serviceId));
  if (!service) return { ok: false, errors: ['Selecciona un tipo de proyecto.'], lines: [], surcharges: [], total: 0, pending: [] };

  const rules = config.rules;
  const lines = [];
  const scope = [];
  const pending = [];
  let days = service.baseDays;

  lines.push({ kind: 'base', concept: service.name, detail: 'Precio base del paquete.', qty: 1, unitPrice: service.basePrice, amount: service.basePrice });

  // Páginas (solo páginas web). Cada rango cuenta como su número de páginas configurado.
  let pages = service.includedPages;
  let range = null;
  if (serviceUsesPages(service)) {
    range = config.pageRanges.find((r) => r.id === Number(sel.pageRange)) || defaultPageRange(config, service);
    if (range) {
      pages = range.pages;
      scope.push({ label: 'Páginas', value: range.label });
      const extra = Math.max(0, pages - service.includedPages);
      if (extra > 0 && rules.extraPagePrice > 0) {
        lines.push({ kind: 'pages', concept: 'Páginas adicionales', detail: `${range.label}: ${pages} páginas para el cálculo, ${service.includedPages} incluidas.`,
          qty: extra, unitPrice: rules.extraPagePrice, amount: extra * rules.extraPagePrice });
      }
      days += extra * (rules.extraPageDays || 0);
      if (range.extraPending) pending.push(`Páginas por encima de ${range.pages}`);
    }
  }
  const ctx = { pages, basePrice: service.basePrice };
  const normSel = { serviceId: service.id, pageRange: range?.id ?? null, answers: {}, features: [], recurring: [] };
  const visSel = { ...sel, serviceId: service.id, pageRange: range?.id ?? null };

  // Preguntas del paso 2 y 3 (se evalúan en orden para respetar las condiciones).
  for (const q of config.questions) {
    if (q.type === 'feature' || !questionVisible(q, visSel, config)) continue;
    const v = sel.answers?.[q.key];
    if (q.type === 'text') {
      const t = String(v ?? '').trim().slice(0, 1000);
      if (!t) { if (q.required) errors.push(`Responde: ${q.short}.`); continue; }
      normSel.answers[q.key] = t;
      scope.push({ label: q.short, value: t, long: true });
      continue;
    }
    const opt = q.options.find((x) => x.id === Number(v));
    if (!opt) { if (q.required) errors.push(`Responde: ${q.short}.`); continue; }
    normSel.answers[q.key] = opt.id;
    scope.push({ label: q.short, value: opt.label });
    days += Number(opt.days || 0);
    if (opt.amount === null) pending.push(`${q.short}: ${opt.label}`);
    else {
      const r = amountOf(opt.priceType, opt.amount, ctx);
      if (r.amount > 0) lines.push({ kind: 'question', concept: `${q.short}: ${opt.label}`, detail: '', qty: r.qty, unitPrice: r.unit, amount: r.amount });
    }
  }

  // Diseño, textos, idiomas y plazo (opciones existentes con sus tarifas).
  const chosen = {};
  for (const g of GROUPS) {
    const opt = pickOption(config, g.key, sel[g.key]);
    chosen[g.key] = opt;
    if (!opt) continue;
    normSel[g.key] = opt.id;
    scope.push({ label: g.title, value: opt.label });
    if (g.key === 'deadline') continue;
    days += Number(opt.days || 0);
    const r = amountOf(opt.priceType, opt.amount, ctx);
    if (r.amount > 0) lines.push({ kind: g.key, concept: `${g.title}: ${opt.label}`, detail: '', qty: r.qty, unitPrice: r.unit, amount: r.amount });
  }

  // Funcionalidades: las incluidas no se cobran; las no disponibles se rechazan.
  const included = [];
  const features = [];
  const wanted = new Set(sel.features || []);
  const dropped = [];
  for (const f of config.features) {
    const mode = featureMode(f, service.id);
    if (mode === 'included') { included.push({ id: f.id, name: f.name }); continue; }
    if (!wanted.has(f.id)) continue;
    if (mode !== 'available') { dropped.push(f.name); continue; }
    features.push({ id: f.id, name: f.name });
    normSel.features.push(f.id);
    days += Number(f.days || 0);
    if (f.price === null) pending.push(f.name);
    else if (f.price > 0) lines.push({ kind: 'feature', concept: f.name, detail: f.description || '', qty: 1, unitPrice: f.price, amount: f.price });
  }
  if (dropped.length) errors.push(`No disponible para ${service.name}: ${dropped.join(', ')}.`);

  // Servicios recurrentes: separados del desarrollo y totalizados por periodo.
  const recurring = [];
  const recurringTotals = { mensual: 0, anual: 0, unico: 0 };
  const recurringPending = [];
  for (const r of config.recurring) {
    if (!(sel.recurring || []).includes(r.id)) continue;
    normSel.recurring.push(r.id);
    recurring.push({ id: r.id, name: r.name, period: r.period, priced: r.price !== null });
    if (r.price === null) recurringPending.push(r.name);
    else recurringTotals[r.period] = (recurringTotals[r.period] || 0) + r.price;
  }

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);

  const surcharges = [];
  const dl = chosen.deadline;
  if (dl && Number(dl.amount) > 0) {
    const base = rules.surchargeBase === 'base' ? service.basePrice : subtotal;
    const amount = dl.priceType === 'percent' ? pct(base, dl.amount) : Math.round(dl.amount);
    surcharges.push({ kind: 'surcharge', concept: `Recargo por plazo ${dl.label.toLowerCase()}${dl.priceType === 'percent' ? ` (${dl.amount} %)` : ''}`, detail: '', qty: 1, unitPrice: amount, amount });
  }
  const surchargeTotal = surcharges.reduce((s, l) => s + l.amount, 0);

  const discountBase = subtotal + surchargeTotal;
  const candidates = (config.discounts || []).filter((d) => !d.requiresCode);
  if (opts.codeDiscount) candidates.push(opts.codeDiscount);
  let discount = null;
  for (const d of candidates) {
    if (!discountApplies(d, subtotal, today)) continue;
    const v = Math.max(0, Math.min(d.type === 'percent' ? pct(discountBase, d.value) : Math.round(Number(d.value || 0)), discountBase));
    if (v > 0 && (!discount || v > -discount.amount)) {
      discount = { kind: 'discount', concept: `Descuento: ${d.name}${d.type === 'percent' ? ` (${d.value} %)` : ''}`, detail: '', qty: 1, unitPrice: -v, amount: -v, discountId: d.id, name: d.name };
    }
  }
  const discountTotal = discount ? -discount.amount : 0;
  const net = discountBase - discountTotal;

  let tax = 0;
  let total = net;
  if (rules.taxMode === 'added') { tax = pct(net, rules.taxRate); total = net + tax; }
  else if (rules.taxMode === 'included') tax = net - Math.round(net / (1 + Number(rules.taxRate) / 100));

  days = Math.max(1, Math.ceil(days * Number((dl && dl.daysFactor) || 1)));

  return {
    ok: errors.length === 0, errors,
    service: { id: service.id, name: service.name, basePrice: service.basePrice, kind: service.kind },
    selection: normSel, scope, included, features, recurring, recurringTotals, recurringPending, pending,
    lines, subtotal, surcharges, surchargeTotal, discount, discountTotal, net,
    tax, taxMode: rules.taxMode, taxRate: Number(rules.taxRate || 0), taxLabel: rules.taxLabel || 'IGV',
    total, days,
  };
}

/** Lo que puede ver el cliente: total, alcance y plazos, sin desglose de precios. */
export function clientView(r) {
  return {
    ok: r.ok, errors: r.errors,
    service: r.service ? { id: r.service.id, name: r.service.name } : null,
    scope: r.scope, included: r.included, features: r.features, recurring: r.recurring,
    recurringTotals: r.recurringTotals, recurringPending: r.recurringPending, pending: r.pending,
    discountName: r.discount ? r.discount.name : null,
    taxMode: r.taxMode, taxRate: r.taxRate, taxLabel: r.taxLabel,
    total: r.total, days: r.days,
  };
}
