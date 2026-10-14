/**
 * Motor de cálculo de CotizaTuWeb.
 *
 * Este archivo es el ÚNICO lugar donde vive la lógica de cálculo. Lo usan:
 *   - el navegador, para mostrar el precio en tiempo real;
 *   - el servidor, que vuelve a calcular todo con los precios de la base de datos
 *     antes de guardar una cotización (el navegador nunca envía importes).
 *
 * Aquí NO hay precios: todos los importes llegan en `config`, que se arma desde la
 * base de datos y se edita en el panel administrativo.
 *
 * Todos los importes se manejan en céntimos (enteros) para evitar errores de redondeo.
 */

export const GROUPS = [
  { key: 'design', title: 'Tipo de diseño' },
  { key: 'languages', title: 'Idiomas' },
  { key: 'content', title: 'Contenido' },
  { key: 'deadline', title: 'Plazo de entrega' },
];

/** S/ 1,200.00 */
export function formatPEN(cents) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const soles = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cts = String(abs % 100).padStart(2, '0');
  return `${neg ? '- ' : ''}S/ ${soles}.${cts}`;
}

export function pagesLabel(n, max) {
  if (n >= max) return `${n} páginas o más`;
  return n === 1 ? '1 página' : `${n} páginas`;
}

function pct(base, percent) {
  return Math.round((base * Number(percent || 0)) / 100);
}

function optionAmount(opt, ctx) {
  const a = Number(opt.amount || 0);
  switch (opt.priceType) {
    case 'fixed': return { amount: Math.round(a), qty: 1, unit: Math.round(a) };
    case 'per_page': return { amount: Math.round(a) * ctx.pages, qty: ctx.pages, unit: Math.round(a) };
    case 'percent_base': { const v = pct(ctx.basePrice, a); return { amount: v, qty: 1, unit: v }; }
    default: return { amount: 0, qty: 1, unit: 0 };
  }
}

function discountApplies(d, subtotal, today) {
  if (!d || !d.active) return false;
  if (d.validFrom && today < d.validFrom) return false;
  if (d.validTo && today > d.validTo) return false;
  if (d.minSubtotal && subtotal < d.minSubtotal) return false;
  return true;
}

function discountAmount(d, base) {
  const v = d.type === 'percent' ? pct(base, d.value) : Math.round(Number(d.value || 0));
  return Math.max(0, Math.min(v, base));
}

/** Devuelve la opción elegida del grupo o la opción por defecto. */
export function pickOption(config, group, id) {
  const list = config.options[group] || [];
  return list.find((o) => o.id === Number(id)) || list.find((o) => o.isDefault) || list[0] || null;
}

/** Estado de una funcionalidad para un servicio: 'included' | 'available' | null (no disponible). */
export function featureMode(feature, serviceId) {
  return (feature.compat && feature.compat[serviceId]) || null;
}

/**
 * Calcula una cotización.
 * @param {object} config  Configuración comercial (servicios, opciones, reglas, descuentos).
 * @param {object} sel     Selección del cliente: { serviceId, pages, design, languages, content, deadline, features:[], }
 * @param {object} [opts]  { today:'YYYY-MM-DD', codeDiscount: objeto de descuento validado por el servidor }
 */
export function computeQuote(config, sel, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const errors = [];
  const service = config.services.find((s) => s.id === Number(sel.serviceId));
  if (!service) {
    return { ok: false, errors: ['Selecciona un tipo de proyecto.'], lines: [], surcharges: [], total: 0 };
  }

  const pageOptions = config.pageOptions;
  const maxPages = Math.max(...pageOptions);
  let pages = Number(sel.pages);
  if (!pageOptions.includes(pages)) pages = pageOptions.find((p) => p >= service.includedPages) || pageOptions[0];

  const rules = config.rules;
  const lines = [];
  const characteristics = [];

  // 1. Precio base
  lines.push({
    kind: 'base',
    concept: service.name,
    detail: `Precio base del proyecto. Incluye ${pagesLabel(service.includedPages, Infinity)}.`,
    qty: 1, unitPrice: service.basePrice, amount: service.basePrice,
  });

  // 2. Páginas adicionales (solo por encima de las incluidas en el paquete)
  const extraPages = Math.max(0, pages - service.includedPages);
  characteristics.push({ label: 'Páginas', value: pagesLabel(pages, maxPages) + (extraPages === 0 ? ' (incluidas)' : '') });
  if (extraPages > 0 && rules.extraPagePrice > 0) {
    lines.push({
      kind: 'pages',
      concept: 'Páginas adicionales',
      detail: `${pages} páginas solicitadas, ${service.includedPages} incluidas en el paquete.` +
        (pages >= maxPages ? ` Más de ${maxPages} páginas se ajustan en la propuesta.` : ''),
      qty: extraPages, unitPrice: rules.extraPagePrice, amount: extraPages * rules.extraPagePrice,
    });
  }

  // 3. Diseño, idiomas y contenido
  const chosen = {};
  for (const g of GROUPS) {
    const opt = pickOption(config, g.key, sel[g.key]);
    chosen[g.key] = opt;
    if (!opt) continue;
    characteristics.push({ label: g.title, value: opt.label });
    if (g.key === 'deadline') continue;
    const r = optionAmount(opt, { pages, basePrice: service.basePrice });
    if (r.amount > 0) {
      lines.push({
        kind: g.key,
        concept: `${g.title}: ${opt.label}`,
        detail: opt.priceType === 'per_page' ? `${r.qty} página(s) × ${formatPEN(r.unit)}` :
          opt.priceType === 'percent_base' ? `${opt.amount} % del precio base` : (opt.description || ''),
        qty: r.qty, unitPrice: r.unit, amount: r.amount,
      });
    }
  }

  // 4. Funcionalidades
  const included = [];
  const selectedFeatures = [];
  const dropped = [];
  const wanted = new Set((sel.features || []).map(Number));
  for (const f of config.features) {
    const mode = featureMode(f, service.id);
    if (mode === 'included') { included.push({ id: f.id, name: f.name }); continue; }
    if (!wanted.has(f.id)) continue;
    if (mode !== 'available') { dropped.push(f.name); continue; }
    selectedFeatures.push({ id: f.id, name: f.name });
    if (f.price > 0) {
      lines.push({ kind: 'feature', concept: f.name, detail: f.description || '', qty: 1, unitPrice: f.price, amount: f.price });
    }
  }
  if (dropped.length) errors.push(`No disponible para ${service.name}: ${dropped.join(', ')}.`);

  const subtotal = lines.reduce((s, l) => s + l.amount, 0);

  // 5. Recargos (plazo de entrega)
  const surcharges = [];
  const dl = chosen.deadline;
  if (dl && Number(dl.amount) > 0) {
    if (dl.priceType === 'percent') {
      const base = rules.surchargeBase === 'base' ? service.basePrice : subtotal;
      const amount = pct(base, dl.amount);
      surcharges.push({
        kind: 'surcharge',
        concept: `Recargo por plazo ${dl.label.toLowerCase()} (${dl.amount} %)`,
        detail: rules.surchargeBase === 'base' ? 'Calculado sobre el precio base del proyecto.' : 'Calculado sobre el subtotal de desarrollo.',
        qty: 1, unitPrice: amount, amount,
      });
    } else if (dl.priceType === 'fixed') {
      const amount = Math.round(dl.amount);
      surcharges.push({ kind: 'surcharge', concept: `Recargo por plazo ${dl.label.toLowerCase()}`, detail: '', qty: 1, unitPrice: amount, amount });
    }
  }
  const surchargeTotal = surcharges.reduce((s, l) => s + l.amount, 0);

  // 6. Descuento (se aplica el mayor de los autorizados; nunca se acumulan)
  const discountBase = subtotal + surchargeTotal;
  const candidates = (config.discounts || []).filter((d) => !d.requiresCode);
  if (opts.codeDiscount) candidates.push(opts.codeDiscount);
  let discount = null;
  for (const d of candidates) {
    if (!discountApplies(d, subtotal, today)) continue;
    const amount = discountAmount(d, discountBase);
    if (amount > 0 && (!discount || amount > -discount.amount)) {
      discount = {
        kind: 'discount',
        concept: `Descuento: ${d.name}` + (d.type === 'percent' ? ` (${d.value} %)` : ''),
        detail: d.requiresCode ? 'Código promocional aplicado.' : '',
        qty: 1, unitPrice: -amount, amount: -amount, discountId: d.id,
      };
    }
  }
  const discountTotal = discount ? -discount.amount : 0;
  const net = discountBase - discountTotal;

  // 7. Impuestos
  let tax = 0;
  let total = net;
  if (rules.taxMode === 'added') { tax = pct(net, rules.taxRate); total = net + tax; }
  else if (rules.taxMode === 'included') { tax = net - Math.round(net / (1 + Number(rules.taxRate) / 100)); }

  // 8. Plazo estimado (días hábiles)
  let days = service.baseDays + extraPages * (rules.extraPageDays || 0);
  for (const g of GROUPS) if (chosen[g.key] && g.key !== 'deadline') days += Number(chosen[g.key].days || 0);
  for (const f of config.features) if (selectedFeatures.some((s) => s.id === f.id)) days += Number(f.days || 0);
  days = Math.max(1, Math.ceil(days * Number((dl && dl.daysFactor) || 1)));

  return {
    ok: errors.length === 0,
    errors,
    service: { id: service.id, name: service.name, basePrice: service.basePrice, includedPages: service.includedPages },
    selection: {
      serviceId: service.id, pages,
      design: chosen.design?.id ?? null, languages: chosen.languages?.id ?? null,
      content: chosen.content?.id ?? null, deadline: chosen.deadline?.id ?? null,
      features: selectedFeatures.map((f) => f.id),
    },
    characteristics,
    included,
    selectedFeatures,
    lines,
    subtotal,
    surcharges,
    surchargeTotal,
    discount,
    discountTotal,
    net,
    tax,
    taxMode: rules.taxMode,
    taxRate: Number(rules.taxRate || 0),
    taxLabel: rules.taxLabel || 'IGV',
    total,
    days,
  };
}
