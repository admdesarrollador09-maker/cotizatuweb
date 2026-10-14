// API de CotizaTuWeb. Recibe un Request estándar y devuelve un Response.
// La usan la Netlify Function (netlify/functions/api.mjs) y el servidor local (server.js).
import { HttpError, json, readJson, parseCookies, cookie, SECURITY_HEADERS } from './http.js';
import { hashPassword, verifyPassword, validatePasswordStrength } from './auth.js';
import { buildConfig, recurringItems, nextId, sortCatalog } from './catalog.js';
import {
  getCatalog, updateCatalog, getChangelog, getQuote, getQuoteByToken, listQuotes, updateQuote,
  getAdmins, saveAdmin, createSession, getSession, destroySession, destroyUserSessions,
  rateCheck, rateHit, rateReset, nowUtc,
} from './repo.js';
import { createQuote, whatsappText, adjustQuote, findCodeDiscount } from './quotes.js';
import { renderQuotePdf } from './quotePdf.js';
import { STATUSES } from '../public/js/formOptions.js';

const COOKIE = 'ctw_admin';
const STATUS_KEYS = STATUSES.map(([k]) => k);
const STATUS_LABEL = Object.fromEntries(STATUSES);
const ICONS = ['rocket', 'store', 'briefcase', 'bag', 'code', 'globe', 'calendar', 'chart', 'users', 'sparkles'];
const LIMITS = {
  quote: { windowMs: 3600e3, max: 20 },
  code: { windowMs: 600e3, max: 15 },
  login: { windowMs: 900e3, max: 5 },
};

// ---------- Validación de entradas del panel ----------
const V = {
  text(v, field, { min = 0, max = 300 } = {}) {
    const s = String(v ?? '').trim();
    if (s.length < min) throw new HttpError(422, `${field}: es obligatorio.`);
    if (s.length > max) throw new HttpError(422, `${field}: máximo ${max} caracteres.`);
    return s;
  },
  int(v, field, { min = 0, max = 1e9 } = {}) {
    const n = Number(v);
    if (v === '' || v === null || !Number.isInteger(n) || n < min || n > max) throw new HttpError(422, `${field}: debe ser un número entero entre ${min} y ${max}.`);
    return n;
  },
  num(v, field, { min = 0, max = 1e9 } = {}) {
    const n = Number(v);
    if (v === '' || v === null || !Number.isFinite(n) || n < min || n > max) throw new HttpError(422, `${field}: debe ser un número entre ${min} y ${max}.`);
    return n;
  },
  oneOf(v, field, list) {
    if (!list.includes(v)) throw new HttpError(422, `${field}: valor no válido.`);
    return v;
  },
  date(v, field) {
    if (v === null || v === undefined || v === '') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new HttpError(422, `${field}: fecha no válida.`);
    return String(v);
  },
  bool: (v) => (v ? 1 : 0),
};

const findOr404 = (list, id, what) => {
  const x = list.find((i) => i.id === id);
  if (!x) throw new HttpError(404, `${what} no encontrado.`);
  return x;
};

// ---------- Normalización de cada entidad ----------
function cleanService(b) {
  return {
    name: V.text(b.name, 'Nombre', { min: 3, max: 80 }),
    description: V.text(b.description, 'Descripción', { max: 300 }),
    icon: V.oneOf(b.icon, 'Icono', ICONS),
    base_price: V.int(b.base_price, 'Precio base', { min: 0 }),
    included_pages: V.int(b.included_pages, 'Páginas incluidas', { min: 1, max: 200 }),
    base_days: V.int(b.base_days, 'Días base', { min: 1, max: 365 }),
    active: V.bool(b.active),
    sort: V.int(b.sort ?? 0, 'Orden', { min: 0, max: 999 }),
  };
}

function cleanFeature(b) {
  const compat = {};
  for (const [sid, mode] of Object.entries(b.compat && typeof b.compat === 'object' ? b.compat : {})) {
    if (/^\d+$/.test(sid) && ['available', 'included'].includes(mode)) compat[sid] = mode;
  }
  return {
    name: V.text(b.name, 'Nombre', { min: 3, max: 80 }),
    description: V.text(b.description, 'Descripción', { max: 300 }),
    price: V.int(b.price, 'Precio', { min: 0 }),
    days: V.int(b.days ?? 0, 'Días', { min: 0, max: 365 }),
    active: V.bool(b.active),
    sort: V.int(b.sort ?? 0, 'Orden', { min: 0, max: 999 }),
    compat,
  };
}

const OPTION_TYPES = { design: ['fixed', 'per_page', 'percent_base'], languages: ['fixed', 'per_page', 'percent_base'], content: ['fixed', 'per_page', 'percent_base'], deadline: ['percent', 'fixed'] };
function cleanOption(b) {
  const grp = V.oneOf(b.grp, 'Grupo', Object.keys(OPTION_TYPES));
  const v = {
    grp,
    label: V.text(b.label, 'Nombre', { min: 2, max: 80 }),
    description: V.text(b.description, 'Descripción', { max: 300 }),
    price_type: V.oneOf(b.price_type, 'Tipo de precio', OPTION_TYPES[grp]),
    amount: V.num(b.amount, 'Importe', { min: 0 }),
    days: V.int(b.days ?? 0, 'Días', { min: 0, max: 365 }),
    days_factor: V.num(b.days_factor ?? 1, 'Multiplicador del plazo', { min: 0.1, max: 5 }),
    is_default: V.bool(b.is_default), active: V.bool(b.active),
    sort: V.int(b.sort ?? 0, 'Orden', { min: 0, max: 999 }),
  };
  if (v.price_type.startsWith('percent') && v.amount > 500) throw new HttpError(422, 'El porcentaje no puede superar 500 %.');
  return v;
}

function cleanDiscount(b) {
  const code = String(b.code || '').trim().toUpperCase();
  if (code && !/^[A-Z0-9_-]{3,40}$/.test(code)) throw new HttpError(422, 'Código: usa de 3 a 40 letras, números, guiones o guiones bajos.');
  const type = V.oneOf(b.type, 'Tipo', ['percent', 'fixed']);
  const v = {
    name: V.text(b.name, 'Nombre', { min: 2, max: 80 }), code: code || null, type,
    value: type === 'percent' ? V.num(b.value, 'Porcentaje', { min: 0.01, max: 100 }) : V.int(b.value, 'Importe', { min: 1 }),
    min_subtotal: V.int(b.min_subtotal ?? 0, 'Subtotal mínimo', { min: 0 }),
    valid_from: V.date(b.valid_from, 'Desde'), valid_to: V.date(b.valid_to, 'Hasta'), active: V.bool(b.active),
  };
  if (v.valid_from && v.valid_to && v.valid_from > v.valid_to) throw new HttpError(422, 'La fecha de inicio es posterior a la de fin.');
  return v;
}

function cleanRecurring(b) {
  return {
    name: V.text(b.name, 'Nombre', { min: 2, max: 80 }), description: V.text(b.description, 'Descripción', { max: 300 }),
    status: V.oneOf(b.status, 'Condición', ['incluido', 'opcional', 'separado']), reference: V.text(b.reference, 'Referencia', { max: 160 }),
    active: V.bool(b.active), sort: V.int(b.sort ?? 0, 'Orden', { min: 0, max: 999 }),
  };
}

const SETTING_RULES = {
  business_name: (v) => V.text(v, 'Nombre comercial', { min: 2, max: 60 }),
  company_name: (v) => V.text(v, 'Empresa', { max: 100 }),
  whatsapp_number: (v) => {
    const d = String(v || '').replace(/[^\d]/g, '');
    if (d && (d.length < 9 || d.length > 15)) throw new HttpError(422, 'WhatsApp: escribe el número con código de país, por ejemplo 51987654321.');
    return d.length === 9 ? '51' + d : d; // número peruano sin código de país
  },
  contact_email: (v) => {
    const s = String(v || '').trim();
    if (s && !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(s)) throw new HttpError(422, 'Correo de contacto no válido.');
    return s;
  },
  quote_validity_days: (v) => String(V.int(v, 'Vigencia de la cotización', { min: 1, max: 365 })),
  extra_page_price: (v) => String(V.int(v, 'Precio por página adicional', { min: 0 })),
  extra_page_days: (v) => String(V.num(v, 'Días por página adicional', { min: 0, max: 30 })),
  page_options: (v) => {
    const list = String(v).split(',').map((x) => Number.parseInt(x.trim(), 10));
    if (!list.length || list.some((n) => !Number.isInteger(n) || n < 1 || n > 500)) throw new HttpError(422, 'Opciones de páginas: números separados por comas.');
    return [...new Set(list)].sort((a, b) => a - b).join(',');
  },
  surcharge_base: (v) => V.oneOf(v, 'Base del recargo', ['subtotal', 'base']),
  tax_mode: (v) => V.oneOf(v, 'Impuestos', ['none', 'added', 'included']),
  tax_rate: (v) => String(V.num(v, 'Tasa de impuesto', { min: 0, max: 100 })),
  tax_label: (v) => V.text(v, 'Nombre del impuesto', { min: 1, max: 20 }),
  rates_valid_from: (v) => V.date(v, 'Tarifas desde') || '',
  rates_valid_to: (v) => V.date(v, 'Tarifas hasta') || '',
  conditions: (v) => V.text(v, 'Condiciones comerciales', { max: 4000 }),
};
const PRICING_KEYS = ['extra_page_price', 'extra_page_days', 'page_options', 'surcharge_base', 'tax_mode', 'tax_rate', 'tax_label', 'conditions'];

function publicSettings(s) {
  return {
    businessName: s.business_name, companyName: s.company_name, whatsapp: s.whatsapp_number || '',
    email: s.contact_email || '', quoteValidityDays: Number(s.quote_validity_days || 15),
    ratesValidFrom: s.rates_valid_from || '', ratesValidTo: s.rates_valid_to || '',
  };
}

export function createApp({ getStore, env = {} }) {
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, ...opts });

  async function ensureFirstAdmin(store) {
    const admins = await getAdmins(store);
    if (Object.keys(admins.users).length) return;
    const u = String(env.ADMIN_USER || '').trim();
    const p = env.ADMIN_PASSWORD || '';
    if (!u || !p) throw new HttpError(503, 'Aún no hay administrador. Define ADMIN_USER y ADMIN_PASSWORD en las variables de entorno de Netlify.');
    const err = validatePasswordStrength(p);
    if (err) throw new HttpError(503, `ADMIN_PASSWORD: ${err}`);
    await saveAdmin(store, u, hashPassword(p));
  }

  function pdfResponse(quote, catalog, download) {
    const pdf = renderQuotePdf({ quote, settings: catalog.settings });
    return new Response(pdf, {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="Cotizacion-${quote.number}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  // ---------- Rutas públicas ----------
  route('GET', /^\/api\/config$/, async ({ store }) => {
    const cat = await getCatalog(store);
    return { config: buildConfig(cat), business: publicSettings(cat.settings), recurring: recurringItems(cat) };
  });

  route('POST', /^\/api\/discounts\/check$/, async ({ store, request, ip }) => {
    if (!(await rateCheck(store, `code:${ip}`, LIMITS.code))) throw new HttpError(429, 'Demasiados intentos. Prueba más tarde.');
    await rateHit(store, `code:${ip}`, LIMITS.code);
    const { code } = await readJson(request, 2048);
    const d = findCodeDiscount(await getCatalog(store), code);
    if (!d) throw new HttpError(404, 'El código no es válido o ha vencido.');
    return { discount: d };
  });

  route('POST', /^\/api\/quotes$/, async ({ store, request, ip, url }) => {
    const body = await readJson(request);
    if (body.website) throw new HttpError(400, 'Solicitud no válida.'); // campo trampa anti-spam
    if (!(await rateCheck(store, `quote:${ip}`, LIMITS.quote))) throw new HttpError(429, 'Has enviado muchas solicitudes. Inténtalo más tarde o escríbenos por WhatsApp.');
    const { quote, reused } = await createQuote(store, body);
    if (!reused) await rateHit(store, `quote:${ip}`, LIMITS.quote);
    const pdfPath = `/api/quotes/${quote.token}/pdf`;
    const origin = (env.PUBLIC_URL || url.origin).replace(/\/$/, '');
    return {
      number: quote.number, token: quote.token, total: quote.total, days: quote.days, validUntil: quote.valid_until,
      pdfUrl: pdfPath, whatsappText: whatsappText(quote, origin + pdfPath), reused,
    };
  });

  route('GET', /^\/api\/quotes\/([A-Za-z0-9_-]{20,64})\/pdf$/, async ({ store, params, url }) => {
    const q = await getQuoteByToken(store, params[0]);
    if (!q) throw new HttpError(404, 'Cotización no encontrada.');
    return pdfResponse(q, await getCatalog(store), url.searchParams.has('download'));
  });

  // ---------- Autenticación ----------
  route('POST', /^\/api\/admin\/login$/, async (ctx) => {
    const { store, request, ip } = ctx;
    const key = `login:${ip}`;
    if (!(await rateCheck(store, key, LIMITS.login))) throw new HttpError(429, 'Demasiados intentos fallidos. Espera 15 minutos.');
    await ensureFirstAdmin(store);
    const { username, password } = await readJson(request, 4096);
    const user = String(username || '').trim();
    const a = (await getAdmins(store)).users[user];
    if (!a || !verifyPassword(String(password || ''), a.pass_hash)) {
      await rateHit(store, key, LIMITS.login);
      throw new HttpError(401, 'Usuario o contraseña incorrectos.');
    }
    await rateReset(store, key);
    const s = await createSession(store, user);
    ctx.setCookie(cookie(COOKIE, s.token, { maxAge: s.maxAge, secure: ctx.secure }));
    return { username: user };
  }, { csrf: true });

  route('POST', /^\/api\/admin\/logout$/, async (ctx) => {
    await destroySession(ctx.store, ctx.cookies[COOKIE]);
    ctx.setCookie(cookie(COOKIE, '', { maxAge: 0, secure: ctx.secure }));
    return { ok: true };
  }, { admin: true });

  route('GET', /^\/api\/admin\/me$/, ({ admin }) => ({ username: admin.username }), { admin: true });

  route('POST', /^\/api\/admin\/password$/, async (ctx) => {
    const { current, next } = await readJson(ctx.request, 4096);
    const a = (await getAdmins(ctx.store)).users[ctx.admin.username];
    if (!a || !verifyPassword(String(current || ''), a.pass_hash)) throw new HttpError(422, 'La contraseña actual no es correcta.');
    const err = validatePasswordStrength(next);
    if (err) throw new HttpError(422, err);
    await saveAdmin(ctx.store, ctx.admin.username, hashPassword(next));
    await destroyUserSessions(ctx.store, ctx.admin.username);
    const s = await createSession(ctx.store, ctx.admin.username);
    ctx.setCookie(cookie(COOKIE, s.token, { maxAge: s.maxAge, secure: ctx.secure }));
    return { ok: true };
  }, { admin: true });

  // ---------- Catálogo y tarifas ----------
  route('GET', /^\/api\/admin\/catalog$/, async ({ store }) => {
    const cat = sortCatalog(await getCatalog(store));
    return { ...cat, changeLog: (await getChangelog(store)).slice(0, 40) };
  }, { admin: true });

  // Crea o actualiza un elemento de una lista del catálogo.
  function crud(listKey, cleaner, label, nameOf, { bump = true, onSave } = {}) {
    const re = new RegExp(`^/api/admin/${listKey}(?:/(\\d+))?$`);
    const save = async (ctx) => {
      const b = await readJson(ctx.request);
      const v = cleaner(b);
      const id = ctx.params[0] ? Number(ctx.params[0]) : null;
      const { result } = await updateCatalog(ctx.store, (cat) => {
        const list = cat[listKey];
        onSave?.(cat, v, id);
        if (id) { Object.assign(findOr404(list, id, label), v); return id; }
        const nid = nextId(list);
        list.push({ id: nid, ...v, created_at: nowUtc() });
        return nid;
      }, { bump, actor: ctx.admin.username, summary: `${ctx.params[0] ? 'Actualizó' : 'Creó'} ${label.toLowerCase()} "${nameOf(v)}".` });
      return { id: result };
    };
    route('POST', re, save, { admin: true });
    route('PUT', re, save, { admin: true });
  }

  crud('services', cleanService, 'Servicio', (v) => v.name);
  crud('features', cleanFeature, 'Funcionalidad', (v) => v.name, {
    onSave: (cat, v) => {
      const ids = new Set(cat.services.map((s) => String(s.id)));
      for (const k of Object.keys(v.compat)) if (!ids.has(k)) delete v.compat[k];
    },
  });
  crud('options', cleanOption, 'Opción', (v) => v.label, {
    onSave: (cat, v, id) => {
      if (v.is_default) for (const o of cat.options) if (o.grp === v.grp && o.id !== id) o.is_default = 0;
    },
  });
  crud('discounts', cleanDiscount, 'Descuento', (v) => v.name, {
    onSave: (cat, v, id) => {
      if (v.code && cat.discounts.some((d) => d.code === v.code && d.id !== id)) throw new HttpError(422, 'Ya existe un descuento con ese código.');
    },
  });
  crud('recurring', cleanRecurring, 'Costo aparte', (v) => v.name, { bump: false });

  route('DELETE', /^\/api\/admin\/discounts\/(\d+)$/, async (ctx) => {
    const id = Number(ctx.params[0]);
    await updateCatalog(ctx.store, (cat) => {
      findOr404(cat.discounts, id, 'Descuento');
      cat.discounts = cat.discounts.filter((d) => d.id !== id);
    }, { bump: true, actor: ctx.admin.username, summary: 'Eliminó un descuento.' });
    return { ok: true };
  }, { admin: true });

  route('PUT', /^\/api\/admin\/settings$/, async (ctx) => {
    const b = await readJson(ctx.request);
    const clean = {};
    for (const [k, v] of Object.entries(b)) {
      if (!SETTING_RULES[k]) throw new HttpError(422, `Ajuste desconocido: ${k}`);
      clean[k] = SETTING_RULES[k](v);
    }
    const { catalog } = await updateCatalog(ctx.store, (cat) => { Object.assign(cat.settings, clean); }, {
      bump: Object.keys(clean).some((k) => PRICING_KEYS.includes(k)),
      actor: ctx.admin.username, summary: `Actualizó: ${Object.keys(clean).join(', ')}.`,
    });
    return { settings: catalog.settings };
  }, { admin: true });

  // ---------- Cotizaciones ----------
  route('GET', /^\/api\/admin\/quotes$/, async ({ store, url }) => {
    const status = url.searchParams.get('status') || '';
    const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 80);
    const all = await listQuotes(store);
    const counts = {};
    for (const x of all) counts[x.status] = (counts[x.status] || 0) + 1;
    const quotes = all.filter((x) => (!status || x.status === status) &&
      (!q || [x.number, x.client_name, x.client_email, x.client_company].some((f) => String(f || '').toLowerCase().includes(q))))
      .sort((a, b) => b.id - a.id).slice(0, 500);
    return { quotes, counts };
  }, { admin: true });

  route('GET', /^\/api\/admin\/quotes\/(\d+)$/, async ({ store, params }) => {
    const q = await getQuote(store, Number(params[0]));
    if (!q) throw new HttpError(404, 'Cotización no encontrada.');
    const { lines, history, client, fingerprint, ...quote } = q;
    return { quote, client, lines, history };
  }, { admin: true });

  route('PATCH', /^\/api\/admin\/quotes\/(\d+)$/, async (ctx) => {
    const id = Number(ctx.params[0]);
    const b = await readJson(ctx.request);
    const actor = ctx.admin.username;
    // Validar antes de escribir.
    const v = {};
    if (b.status !== undefined) v.status = V.oneOf(b.status, 'Estado', STATUS_KEYS);
    if (b.internal_notes !== undefined) v.internal_notes = V.text(b.internal_notes, 'Observaciones', { max: 5000 });
    if (b.follow_up_date !== undefined) v.follow_up_date = V.date(b.follow_up_date, 'Fecha de seguimiento');
    if (b.days !== undefined) v.days = V.int(b.days, 'Plazo', { min: 1, max: 730 });
    if (b.valid_until !== undefined) {
      v.valid_until = V.date(b.valid_until, 'Vigencia');
      if (!v.valid_until) throw new HttpError(422, 'Vigencia: indica una fecha.');
    }
    const dmy = (d) => d.split('-').reverse().join('/');
    const q = await updateQuote(ctx.store, id, (x) => {
      const h = (action, note, extra = {}) => x.history.unshift({ at: nowUtc(), actor, action, note, ...extra });
      if ('status' in v && v.status !== x.status) { h('estado', `${STATUS_LABEL[x.status]} → ${STATUS_LABEL[v.status]}`, { from_status: x.status, to_status: v.status }); x.status = v.status; }
      if ('internal_notes' in v && v.internal_notes !== x.internal_notes) { x.internal_notes = v.internal_notes; h('nota', 'Actualizó las observaciones internas.'); }
      if ('follow_up_date' in v && v.follow_up_date !== (x.follow_up_date || null)) {
        x.follow_up_date = v.follow_up_date;
        h('seguimiento', v.follow_up_date ? `Seguimiento programado para el ${dmy(v.follow_up_date)}.` : 'Quitó la fecha de seguimiento.');
      }
      if ('days' in v && v.days !== x.days) { h('plazo', `Plazo: ${x.days} → ${v.days} días hábiles.`); x.days = v.days; }
      if ('valid_until' in v && v.valid_until !== x.valid_until) { x.valid_until = v.valid_until; h('vigencia', `Vigencia hasta el ${dmy(v.valid_until)}.`); }
    });
    if (!q) throw new HttpError(404, 'Cotización no encontrada.');
    return { ok: true };
  }, { admin: true });

  route('PUT', /^\/api\/admin\/quotes\/(\d+)\/lines$/, async (ctx) => {
    const b = await readJson(ctx.request);
    await adjustQuote(ctx.store, Number(ctx.params[0]), b.lines, b.note, ctx.admin.username);
    return { ok: true };
  }, { admin: true });

  route('GET', /^\/api\/admin\/quotes\/(\d+)\/pdf$/, async ({ store, params, url }) => {
    const q = await getQuote(store, Number(params[0]));
    if (!q) throw new HttpError(404, 'Cotización no encontrada.');
    return pdfResponse(q, await getCatalog(store), url.searchParams.has('download'));
  }, { admin: true });

  // Copia de seguridad completa en JSON.
  route('GET', /^\/api\/admin\/export$/, async ({ store }) => {
    const quotes = [];
    for (const s of await listQuotes(store)) { const q = await getQuote(store, s.id); if (q) quotes.push(q); }
    const data = { exported_at: nowUtc(), catalog: await getCatalog(store), changelog: await getChangelog(store), quotes };
    const stamp = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
    return new Response(JSON.stringify(data, null, 2), {
      headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="cotizatuweb-respaldo-${stamp}.json"` },
    });
  }, { admin: true });

  // ---------- Despachador ----------
  async function handle(request, { ip = 'desconocida' } = {}) {
    const url = new URL(request.url);
    const extraHeaders = [];
    const ctx = {
      request, url, ip, cookies: parseCookies(request.headers.get('cookie')),
      secure: url.protocol === 'https:',
      setCookie: (c) => extraHeaders.push(c),
    };
    try {
      const candidates = routes.filter((r) => r.pattern.test(url.pathname));
      const r = candidates.find((x) => x.method === request.method);
      if (!r) throw new HttpError(candidates.length ? 405 : 404, candidates.length ? 'Método no permitido.' : 'Ruta no encontrada.');
      ctx.params = url.pathname.match(r.pattern).slice(1);
      if ((r.admin || r.csrf) && !['GET', 'HEAD'].includes(request.method)) {
        // Protección CSRF: cabecera propia + mismo origen.
        if (request.headers.get('x-requested-with') !== 'CotizaTuWeb') throw new HttpError(403, 'Solicitud no permitida.');
        const origin = request.headers.get('origin');
        if (origin && new URL(origin).host !== url.host) throw new HttpError(403, 'Origen no permitido.');
      }
      ctx.store = await getStore();
      if (r.admin) {
        ctx.admin = await getSession(ctx.store, ctx.cookies[COOKIE]);
        if (!ctx.admin) throw new HttpError(401, 'Tu sesión expiró. Vuelve a ingresar.');
      }
      const data = await r.handler(ctx);
      if (data instanceof Response) return data;
      const res = json(200, data ?? { ok: true });
      for (const c of extraHeaders) res.headers.append('Set-Cookie', c);
      return res;
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      return json(status, { error: status === 500 ? 'Error interno. Inténtalo nuevamente.' : err.message, ...(err.details || {}) });
    }
  }

  return { handle };
}
