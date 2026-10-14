// CotizaTuWeb — servidor HTTP (Node.js 22+, sin dependencias externas).
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, buildConfig, getSettings, setSetting, bumpPricingVersion, recurringItems, tx } from './src/db.js';
import { HttpError, securityHeaders, sendJson, readJson, parseCookies, setCookie, clientIp, serveStatic } from './src/http.js';
import { hashPassword, verifyPassword, validatePasswordStrength, createSession, getSessionAdmin, destroySession, rateLimiter } from './src/auth.js';
import { createQuote, quoteLines, whatsappText, adjustQuote, findCodeDiscount, limaToday } from './src/quotes.js';
import { renderQuotePdf } from './src/quotePdf.js';
import { STATUSES } from './public/js/formOptions.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'cotizatuweb.db');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const COOKIE = 'ctw_admin';

const db = openDb(DB_PATH);

// Primer administrador: se crea desde variables de entorno solo si aún no existe ninguno.
if (!db.prepare('SELECT COUNT(*) n FROM admins').get().n) {
  const u = process.env.ADMIN_USER;
  const p = process.env.ADMIN_PASSWORD;
  if (u && p) {
    const err = validatePasswordStrength(p);
    if (err) { console.error(`ADMIN_PASSWORD: ${err}`); process.exit(1); }
    db.prepare('INSERT INTO admins(username, pass_hash) VALUES (?,?)').run(u.trim(), hashPassword(p));
    console.log(`Administrador "${u}" creado.`);
  } else {
    console.warn('Aún no hay administrador. Ejecuta: npm run crear-admin');
  }
}

const quoteLimiter = rateLimiter({ windowMs: 60 * 60 * 1000, max: 20 });
const codeLimiter = rateLimiter({ windowMs: 10 * 60 * 1000, max: 15 });
const loginLimiter = rateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });

const STATUS_KEYS = STATUSES.map(([k]) => k);
const STATUS_LABEL = Object.fromEntries(STATUSES);

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
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(422, `${field}: debe ser un número entero entre ${min} y ${max}.`);
    return n;
  },
  num(v, field, { min = 0, max = 1e9 } = {}) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(422, `${field}: debe ser un número entre ${min} y ${max}.`);
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
const ICONS = ['rocket', 'store', 'briefcase', 'bag', 'code', 'globe', 'calendar', 'chart', 'users', 'sparkles'];

function logChange(actor, entity, id, summary) {
  db.prepare('INSERT INTO change_log(actor, entity, entity_id, summary) VALUES (?,?,?,?)').run(actor, entity, id ?? null, summary);
}

function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${proto}://${req.headers.host}`;
}

function publicSettings() {
  const s = getSettings(db);
  return {
    businessName: s.business_name, companyName: s.company_name, whatsapp: s.whatsapp_number || '',
    email: s.contact_email || '', quoteValidityDays: Number(s.quote_validity_days || 15),
    ratesValidFrom: s.rates_valid_from || '', ratesValidTo: s.rates_valid_to || '',
  };
}

function sendPdf(res, quote, download) {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(quote.client_id);
  const pdf = renderQuotePdf({ quote, lines: quoteLines(db, quote.id), client, settings: getSettings(db) });
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Length': pdf.length,
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="Cotizacion-${quote.number}.pdf"`,
    'Cache-Control': 'private, no-store',
  });
  res.end(pdf);
}

// ---------- Rutas ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, ...opts });

// Públicas
route('GET', /^\/api\/config$/, (ctx) => ({ config: buildConfig(db), business: publicSettings(), recurring: recurringItems(db) }));

route('POST', /^\/api\/discounts\/check$/, async (ctx) => {
  if (!codeLimiter.check(ctx.ip)) throw new HttpError(429, 'Demasiados intentos. Prueba más tarde.');
  codeLimiter.hit(ctx.ip);
  const { code } = await readJson(ctx.req, 2048);
  const d = findCodeDiscount(db, code);
  if (!d) throw new HttpError(404, 'El código no es válido o ha vencido.');
  return { discount: d };
});

route('POST', /^\/api\/quotes$/, async (ctx) => {
  const body = await readJson(ctx.req);
  if (body.website) throw new HttpError(400, 'Solicitud no válida.'); // campo trampa anti-spam
  if (!quoteLimiter.check(ctx.ip)) throw new HttpError(429, 'Has enviado muchas solicitudes. Inténtalo más tarde o escríbenos por WhatsApp.');
  const { quote, reused } = createQuote(db, body);
  if (!reused) quoteLimiter.hit(ctx.ip);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(quote.client_id);
  const lines = quoteLines(db, quote.id);
  const pdfUrl = `${baseUrl(ctx.req)}/api/quotes/${quote.token}/pdf`;
  return {
    number: quote.number, token: quote.token, total: quote.total, days: quote.days, validUntil: quote.valid_until,
    pdfUrl: `/api/quotes/${quote.token}/pdf`, whatsappText: whatsappText(quote, lines, client, pdfUrl), reused,
  };
});

route('GET', /^\/api\/quotes\/([A-Za-z0-9_-]{20,64})\/pdf$/, (ctx) => {
  const q = db.prepare('SELECT * FROM quotes WHERE token = ?').get(ctx.params[0]);
  if (!q) throw new HttpError(404, 'Cotización no encontrada.');
  sendPdf(ctx.res, q, ctx.url.searchParams.has('download'));
});

// Autenticación
route('POST', /^\/api\/admin\/login$/, async (ctx) => {
  const key = `login:${ctx.ip}`;
  if (!loginLimiter.check(key)) throw new HttpError(429, 'Demasiados intentos fallidos. Espera 15 minutos.');
  const { username, password } = await readJson(ctx.req, 4096);
  const a = db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username || '').trim());
  if (!a || !verifyPassword(String(password || ''), a.pass_hash)) {
    loginLimiter.hit(key);
    throw new HttpError(401, 'Usuario o contraseña incorrectos.');
  }
  loginLimiter.reset(key);
  const s = createSession(db, a.id);
  setCookie(ctx.res, COOKIE, s.token, { maxAge: s.maxAge, secure: COOKIE_SECURE });
  return { username: a.username };
}, { csrf: true });

route('POST', /^\/api\/admin\/logout$/, (ctx) => {
  destroySession(db, ctx.cookies[COOKIE]);
  setCookie(ctx.res, COOKIE, '', { maxAge: 0, secure: COOKIE_SECURE });
  return { ok: true };
}, { admin: true });

route('GET', /^\/api\/admin\/me$/, (ctx) => ({ username: ctx.admin.username }), { admin: true });

route('POST', /^\/api\/admin\/password$/, async (ctx) => {
  const { current, next } = await readJson(ctx.req, 4096);
  const a = db.prepare('SELECT * FROM admins WHERE id = ?').get(ctx.admin.id);
  if (!verifyPassword(String(current || ''), a.pass_hash)) throw new HttpError(422, 'La contraseña actual no es correcta.');
  const err = validatePasswordStrength(next);
  if (err) throw new HttpError(422, err);
  db.prepare('UPDATE admins SET pass_hash = ? WHERE id = ?').run(hashPassword(next), a.id);
  db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(a.id);
  const s = createSession(db, a.id);
  setCookie(ctx.res, COOKIE, s.token, { maxAge: s.maxAge, secure: COOKIE_SECURE });
  return { ok: true };
}, { admin: true });

// Catálogo y tarifas
route('GET', /^\/api\/admin\/catalog$/, () => {
  const compat = db.prepare('SELECT * FROM feature_services').all();
  return {
    services: db.prepare('SELECT * FROM services ORDER BY sort, id').all(),
    features: db.prepare('SELECT * FROM features ORDER BY sort, id').all().map((f) => ({
      ...f, compat: Object.fromEntries(compat.filter((c) => c.feature_id === f.id).map((c) => [c.service_id, c.mode])),
    })),
    options: db.prepare('SELECT * FROM options ORDER BY grp, sort, id').all(),
    discounts: db.prepare('SELECT * FROM discounts ORDER BY id DESC').all(),
    recurring: db.prepare('SELECT * FROM recurring_items ORDER BY sort, id').all(),
    settings: getSettings(db),
    changeLog: db.prepare('SELECT * FROM change_log ORDER BY id DESC LIMIT 40').all(),
  };
}, { admin: true });

function saveService(b, id) {
  const v = {
    name: V.text(b.name, 'Nombre', { min: 3, max: 80 }),
    description: V.text(b.description, 'Descripción', { max: 300 }),
    icon: V.oneOf(b.icon, 'Icono', ICONS),
    base_price: V.int(b.base_price, 'Precio base', { min: 0, max: 1e9 }),
    included_pages: V.int(b.included_pages, 'Páginas incluidas', { min: 1, max: 200 }),
    base_days: V.int(b.base_days, 'Días base', { min: 1, max: 365 }),
    active: V.bool(b.active),
    sort: V.int(b.sort ?? 0, 'Orden', { min: 0, max: 999 }),
  };
  if (id) {
    const r = db.prepare(`UPDATE services SET name=?, description=?, icon=?, base_price=?, included_pages=?, base_days=?, active=?, sort=?, updated_at=datetime('now') WHERE id=?`)
      .run(v.name, v.description, v.icon, v.base_price, v.included_pages, v.base_days, v.active, v.sort, id);
    if (!r.changes) throw new HttpError(404, 'Servicio no encontrado.');
    return id;
  }
  return Number(db.prepare('INSERT INTO services(name, description, icon, base_price, included_pages, base_days, active, sort) VALUES (?,?,?,?,?,?,?,?)')
    .run(v.name, v.description, v.icon, v.base_price, v.included_pages, v.base_days, v.active, v.sort).lastInsertRowid);
}
route('POST', /^\/api\/admin\/services$/, async (ctx) => {
  const b = await readJson(ctx.req);
  const id = tx(db, () => { const id = saveService(b); bumpPricingVersion(db); logChange(ctx.admin.username, 'servicio', id, `Creó el servicio "${b.name}".`); return id; });
  return { id };
}, { admin: true });
route('PUT', /^\/api\/admin\/services\/(\d+)$/, async (ctx) => {
  const b = await readJson(ctx.req);
  const id = Number(ctx.params[0]);
  tx(db, () => { saveService(b, id); bumpPricingVersion(db); logChange(ctx.admin.username, 'servicio', id, `Actualizó el servicio "${b.name}".`); });
  return { id };
}, { admin: true });

function saveFeature(b, id) {
  const v = {
    name: V.text(b.name, 'Nombre', { min: 3, max: 80 }),
    description: V.text(b.description, 'Descripción', { max: 300 }),
    price: V.int(b.price, 'Precio', { min: 0 }),
    days: V.int(b.days ?? 0, 'Días', { min: 0, max: 365 }),
    active: V.bool(b.active),
    sort: V.int(b.sort ?? 0, 'Orden', { min: 0, max: 999 }),
  };
  if (id) {
    const r = db.prepare(`UPDATE features SET name=?, description=?, price=?, days=?, active=?, sort=?, updated_at=datetime('now') WHERE id=?`)
      .run(v.name, v.description, v.price, v.days, v.active, v.sort, id);
    if (!r.changes) throw new HttpError(404, 'Funcionalidad no encontrada.');
  } else {
    id = Number(db.prepare('INSERT INTO features(name, description, price, days, active, sort) VALUES (?,?,?,?,?,?)')
      .run(v.name, v.description, v.price, v.days, v.active, v.sort).lastInsertRowid);
  }
  const compat = b.compat && typeof b.compat === 'object' ? b.compat : {};
  db.prepare('DELETE FROM feature_services WHERE feature_id = ?').run(id);
  const services = new Set(db.prepare('SELECT id FROM services').all().map((s) => s.id));
  const ins = db.prepare('INSERT INTO feature_services(feature_id, service_id, mode) VALUES (?,?,?)');
  for (const [sid, mode] of Object.entries(compat)) {
    if (services.has(Number(sid)) && ['available', 'included'].includes(mode)) ins.run(id, Number(sid), mode);
  }
  return id;
}
route('POST', /^\/api\/admin\/features$/, async (ctx) => {
  const b = await readJson(ctx.req);
  const id = tx(db, () => { const id = saveFeature(b); bumpPricingVersion(db); logChange(ctx.admin.username, 'funcionalidad', id, `Creó la funcionalidad "${b.name}".`); return id; });
  return { id };
}, { admin: true });
route('PUT', /^\/api\/admin\/features\/(\d+)$/, async (ctx) => {
  const b = await readJson(ctx.req);
  const id = Number(ctx.params[0]);
  tx(db, () => { saveFeature(b, id); bumpPricingVersion(db); logChange(ctx.admin.username, 'funcionalidad', id, `Actualizó la funcionalidad "${b.name}".`); });
  return { id };
}, { admin: true });

const OPTION_TYPES = { design: ['fixed', 'per_page', 'percent_base'], languages: ['fixed', 'per_page', 'percent_base'], content: ['fixed', 'per_page', 'percent_base'], deadline: ['percent', 'fixed'] };
function saveOption(b, id) {
  const grp = V.oneOf(b.grp, 'Grupo', Object.keys(OPTION_TYPES));
  const v = {
    label: V.text(b.label, 'Nombre', { min: 2, max: 80 }),
    description: V.text(b.description, 'Descripción', { max: 300 }),
    price_type: V.oneOf(b.price_type, 'Tipo de precio', OPTION_TYPES[grp]),
    amount: V.num(b.amount, 'Importe', { min: 0, max: 1e9 }),
    days: V.int(b.days ?? 0, 'Días', { min: 0, max: 365 }),
    days_factor: V.num(b.days_factor ?? 1, 'Factor de días', { min: 0.1, max: 5 }),
    is_default: V.bool(b.is_default), active: V.bool(b.active),
    sort: V.int(b.sort ?? 0, 'Orden', { min: 0, max: 999 }),
  };
  if (v.price_type.startsWith('percent') && v.amount > 500) throw new HttpError(422, 'El porcentaje no puede superar 500 %.');
  if (v.is_default) db.prepare('UPDATE options SET is_default = 0 WHERE grp = ?').run(grp);
  if (id) {
    const r = db.prepare('UPDATE options SET grp=?, label=?, description=?, price_type=?, amount=?, days=?, days_factor=?, is_default=?, active=?, sort=? WHERE id=?')
      .run(grp, v.label, v.description, v.price_type, v.amount, v.days, v.days_factor, v.is_default, v.active, v.sort, id);
    if (!r.changes) throw new HttpError(404, 'Opción no encontrada.');
    return id;
  }
  return Number(db.prepare('INSERT INTO options(grp, label, description, price_type, amount, days, days_factor, is_default, active, sort) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(grp, v.label, v.description, v.price_type, v.amount, v.days, v.days_factor, v.is_default, v.active, v.sort).lastInsertRowid);
}
route('POST', /^\/api\/admin\/options$/, async (ctx) => {
  const b = await readJson(ctx.req);
  const id = tx(db, () => { const id = saveOption(b); bumpPricingVersion(db); logChange(ctx.admin.username, 'opción', id, `Creó la opción "${b.label}".`); return id; });
  return { id };
}, { admin: true });
route('PUT', /^\/api\/admin\/options\/(\d+)$/, async (ctx) => {
  const b = await readJson(ctx.req);
  const id = Number(ctx.params[0]);
  tx(db, () => { saveOption(b, id); bumpPricingVersion(db); logChange(ctx.admin.username, 'opción', id, `Actualizó la opción "${b.label}".`); });
  return { id };
}, { admin: true });

function saveDiscount(b, id) {
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
  const dup = v.code && db.prepare('SELECT id FROM discounts WHERE code = ? AND id != ?').get(v.code, id || 0);
  if (dup) throw new HttpError(422, 'Ya existe un descuento con ese código.');
  if (id) {
    const r = db.prepare('UPDATE discounts SET name=?, code=?, type=?, value=?, min_subtotal=?, valid_from=?, valid_to=?, active=? WHERE id=?')
      .run(v.name, v.code, v.type, v.value, v.min_subtotal, v.valid_from, v.valid_to, v.active, id);
    if (!r.changes) throw new HttpError(404, 'Descuento no encontrado.');
    return id;
  }
  return Number(db.prepare('INSERT INTO discounts(name, code, type, value, min_subtotal, valid_from, valid_to, active) VALUES (?,?,?,?,?,?,?,?)')
    .run(v.name, v.code, v.type, v.value, v.min_subtotal, v.valid_from, v.valid_to, v.active).lastInsertRowid);
}
route('POST', /^\/api\/admin\/discounts$/, async (ctx) => {
  const b = await readJson(ctx.req);
  const id = tx(db, () => { const id = saveDiscount(b); bumpPricingVersion(db); logChange(ctx.admin.username, 'descuento', id, `Creó el descuento "${b.name}".`); return id; });
  return { id };
}, { admin: true });
route('PUT', /^\/api\/admin\/discounts\/(\d+)$/, async (ctx) => {
  const b = await readJson(ctx.req);
  const id = Number(ctx.params[0]);
  tx(db, () => { saveDiscount(b, id); bumpPricingVersion(db); logChange(ctx.admin.username, 'descuento', id, `Actualizó el descuento "${b.name}".`); });
  return { id };
}, { admin: true });
route('DELETE', /^\/api\/admin\/discounts\/(\d+)$/, (ctx) => {
  const id = Number(ctx.params[0]);
  tx(db, () => { db.prepare('DELETE FROM discounts WHERE id = ?').run(id); bumpPricingVersion(db); logChange(ctx.admin.username, 'descuento', id, 'Eliminó un descuento.'); });
  return { ok: true };
}, { admin: true });

function saveRecurring(b, id) {
  const v = {
    name: V.text(b.name, 'Nombre', { min: 2, max: 80 }), description: V.text(b.description, 'Descripción', { max: 300 }),
    status: V.oneOf(b.status, 'Condición', ['incluido', 'opcional', 'separado']), reference: V.text(b.reference, 'Referencia', { max: 160 }),
    active: V.bool(b.active), sort: V.int(b.sort ?? 0, 'Orden', { min: 0, max: 999 }),
  };
  if (id) {
    const r = db.prepare('UPDATE recurring_items SET name=?, description=?, status=?, reference=?, active=?, sort=? WHERE id=?')
      .run(v.name, v.description, v.status, v.reference, v.active, v.sort, id);
    if (!r.changes) throw new HttpError(404, 'Elemento no encontrado.');
    return id;
  }
  return Number(db.prepare('INSERT INTO recurring_items(name, description, status, reference, active, sort) VALUES (?,?,?,?,?,?)')
    .run(v.name, v.description, v.status, v.reference, v.active, v.sort).lastInsertRowid);
}
route('POST', /^\/api\/admin\/recurring$/, async (ctx) => {
  const b = await readJson(ctx.req);
  const id = saveRecurring(b); logChange(ctx.admin.username, 'costo recurrente', id, `Creó "${b.name}".`);
  return { id };
}, { admin: true });
route('PUT', /^\/api\/admin\/recurring\/(\d+)$/, async (ctx) => {
  const b = await readJson(ctx.req);
  const id = saveRecurring(b, Number(ctx.params[0])); logChange(ctx.admin.username, 'costo recurrente', id, `Actualizó "${b.name}".`);
  return { id };
}, { admin: true });

const SETTING_RULES = {
  business_name: (v) => V.text(v, 'Nombre comercial', { min: 2, max: 60 }),
  company_name: (v) => V.text(v, 'Empresa', { max: 100 }),
  whatsapp_number: (v) => {
    const d = String(v || '').replace(/[^\d]/g, '');
    if (d && (d.length < 9 || d.length > 15)) throw new HttpError(422, 'WhatsApp: escribe el número con código de país, por ejemplo 51987654321.');
    return d;
  },
  contact_email: (v) => {
    const s = String(v || '').trim();
    if (s && !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(s)) throw new HttpError(422, 'Correo de contacto no válido.');
    return s;
  },
  quote_validity_days: (v) => V.int(v, 'Vigencia de la cotización', { min: 1, max: 365 }),
  extra_page_price: (v) => V.int(v, 'Precio por página adicional', { min: 0 }),
  extra_page_days: (v) => V.num(v, 'Días por página adicional', { min: 0, max: 30 }),
  page_options: (v) => {
    const list = String(v).split(',').map((x) => Number.parseInt(x.trim(), 10));
    if (!list.length || list.some((n) => !Number.isInteger(n) || n < 1 || n > 500)) throw new HttpError(422, 'Opciones de páginas: números separados por comas.');
    return [...new Set(list)].sort((a, b) => a - b).join(',');
  },
  surcharge_base: (v) => V.oneOf(v, 'Base del recargo', ['subtotal', 'base']),
  tax_mode: (v) => V.oneOf(v, 'Impuestos', ['none', 'added', 'included']),
  tax_rate: (v) => V.num(v, 'Tasa de impuesto', { min: 0, max: 100 }),
  tax_label: (v) => V.text(v, 'Nombre del impuesto', { min: 1, max: 20 }),
  rates_valid_from: (v) => V.date(v, 'Tarifas desde') || '',
  rates_valid_to: (v) => V.date(v, 'Tarifas hasta') || '',
  conditions: (v) => V.text(v, 'Condiciones comerciales', { max: 4000 }),
};
const PRICING_KEYS = ['extra_page_price', 'extra_page_days', 'page_options', 'surcharge_base', 'tax_mode', 'tax_rate', 'tax_label', 'conditions'];
route('PUT', /^\/api\/admin\/settings$/, async (ctx) => {
  const b = await readJson(ctx.req);
  const clean = {};
  for (const [k, v] of Object.entries(b)) {
    if (!SETTING_RULES[k]) throw new HttpError(422, `Ajuste desconocido: ${k}`);
    clean[k] = SETTING_RULES[k](v);
  }
  tx(db, () => {
    for (const [k, v] of Object.entries(clean)) setSetting(db, k, v);
    if (Object.keys(clean).some((k) => PRICING_KEYS.includes(k))) bumpPricingVersion(db);
    logChange(ctx.admin.username, 'configuración', null, `Actualizó: ${Object.keys(clean).join(', ')}.`);
  });
  return { settings: getSettings(db) };
}, { admin: true });

// Cotizaciones
route('GET', /^\/api\/admin\/quotes$/, (ctx) => {
  const status = ctx.url.searchParams.get('status') || '';
  const q = (ctx.url.searchParams.get('q') || '').trim().slice(0, 80);
  const where = []; const args = [];
  if (status) { where.push('q.status = ?'); args.push(status); }
  if (q) { where.push('(q.number LIKE ? OR c.name LIKE ? OR c.email LIKE ? OR c.company LIKE ?)'); args.push(...Array(4).fill(`%${q}%`)); }
  const rows = db.prepare(`SELECT q.id, q.number, q.status, q.channels, q.service_name, q.total, q.created_at, q.follow_up_date, q.adjusted,
    c.name AS client_name, c.company AS client_company, c.email AS client_email
    FROM quotes q JOIN clients c ON c.id = q.client_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY q.id DESC LIMIT 500`).all(...args);
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM quotes GROUP BY status').all().map((r) => [r.status, r.n]));
  return { quotes: rows, counts };
}, { admin: true });

route('GET', /^\/api\/admin\/quotes\/(\d+)$/, (ctx) => {
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(Number(ctx.params[0]));
  if (!q) throw new HttpError(404, 'Cotización no encontrada.');
  return {
    quote: q,
    client: db.prepare('SELECT * FROM clients WHERE id = ?').get(q.client_id),
    lines: quoteLines(db, q.id),
    history: db.prepare('SELECT id, at, actor, action, from_status, to_status, note FROM quote_history WHERE quote_id = ? ORDER BY id DESC').all(q.id),
  };
}, { admin: true });

route('PATCH', /^\/api\/admin\/quotes\/(\d+)$/, async (ctx) => {
  const id = Number(ctx.params[0]);
  const b = await readJson(ctx.req);
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  if (!q) throw new HttpError(404, 'Cotización no encontrada.');
  tx(db, () => {
    const actor = ctx.admin.username;
    if (b.status !== undefined && b.status !== q.status) {
      const s = V.oneOf(b.status, 'Estado', STATUS_KEYS);
      db.prepare("UPDATE quotes SET status=?, updated_at=datetime('now') WHERE id=?").run(s, id);
      db.prepare('INSERT INTO quote_history(quote_id, actor, action, from_status, to_status, note) VALUES (?,?,?,?,?,?)')
        .run(id, actor, 'estado', q.status, s, `${STATUS_LABEL[q.status]} → ${STATUS_LABEL[s]}`);
    }
    if (b.internal_notes !== undefined && b.internal_notes !== q.internal_notes) {
      db.prepare("UPDATE quotes SET internal_notes=?, updated_at=datetime('now') WHERE id=?").run(V.text(b.internal_notes, 'Observaciones', { max: 5000 }), id);
      db.prepare('INSERT INTO quote_history(quote_id, actor, action, note) VALUES (?,?,?,?)').run(id, actor, 'nota', 'Actualizó las observaciones internas.');
    }
    if (b.follow_up_date !== undefined && (b.follow_up_date || null) !== q.follow_up_date) {
      const d = V.date(b.follow_up_date, 'Fecha de seguimiento');
      db.prepare("UPDATE quotes SET follow_up_date=?, updated_at=datetime('now') WHERE id=?").run(d, id);
      db.prepare('INSERT INTO quote_history(quote_id, actor, action, note) VALUES (?,?,?,?)').run(id, actor, 'seguimiento', d ? `Seguimiento programado para el ${d.split('-').reverse().join('/')}.` : 'Quitó la fecha de seguimiento.');
    }
    if (b.days !== undefined && Number(b.days) !== q.days) {
      const d = V.int(b.days, 'Plazo', { min: 1, max: 730 });
      db.prepare("UPDATE quotes SET days=?, updated_at=datetime('now') WHERE id=?").run(d, id);
      db.prepare('INSERT INTO quote_history(quote_id, actor, action, note) VALUES (?,?,?,?)').run(id, actor, 'plazo', `Plazo: ${q.days} → ${d} días hábiles.`);
    }
    if (b.valid_until !== undefined && b.valid_until !== q.valid_until) {
      const d = V.date(b.valid_until, 'Vigencia');
      if (!d) throw new HttpError(422, 'Vigencia: indica una fecha.');
      db.prepare("UPDATE quotes SET valid_until=?, updated_at=datetime('now') WHERE id=?").run(d, id);
      db.prepare('INSERT INTO quote_history(quote_id, actor, action, note) VALUES (?,?,?,?)').run(id, actor, 'vigencia', `Vigencia hasta el ${d.split('-').reverse().join('/')}.`);
    }
  });
  return { ok: true };
}, { admin: true });

route('PUT', /^\/api\/admin\/quotes\/(\d+)\/lines$/, async (ctx) => {
  const b = await readJson(ctx.req);
  adjustQuote(db, Number(ctx.params[0]), b.lines, b.note, ctx.admin.username);
  return { ok: true };
}, { admin: true });

route('GET', /^\/api\/admin\/quotes\/(\d+)\/pdf$/, (ctx) => {
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(Number(ctx.params[0]));
  if (!q) throw new HttpError(404, 'Cotización no encontrada.');
  sendPdf(ctx.res, q, ctx.url.searchParams.has('download'));
}, { admin: true });

// ---------- Servidor ----------
const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url, 'http://localhost');
  const ctx = { req, res, url, ip: clientIp(req, TRUST_PROXY), cookies: parseCookies(req) };
  try {
    if (url.pathname.startsWith('/api/')) {
      const candidates = routes.filter((r) => r.pattern.test(url.pathname));
      const r = candidates.find((x) => x.method === req.method);
      if (!r) throw new HttpError(candidates.length ? 405 : 404, candidates.length ? 'Método no permitido.' : 'Ruta no encontrada.');
      ctx.params = url.pathname.match(r.pattern).slice(1);
      const mutating = req.method !== 'GET' && req.method !== 'HEAD';
      if ((r.admin || r.csrf) && mutating) {
        // Protección CSRF: cabecera personalizada + mismo origen.
        if (req.headers['x-requested-with'] !== 'CotizaTuWeb') throw new HttpError(403, 'Solicitud no permitida.');
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Origen no permitido.');
      }
      if (r.admin) {
        ctx.admin = getSessionAdmin(db, ctx.cookies[COOKIE]);
        if (!ctx.admin) throw new HttpError(401, 'Tu sesión expiró. Vuelve a ingresar.');
      }
      const data = await r.handler(ctx);
      if (!res.headersSent) sendJson(res, 200, data ?? { ok: true });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido.');
    let p = url.pathname;
    if (p === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
    if (p === '/privacidad') p = '/privacidad.html';
    if (serveStatic(PUBLIC, req, res, p)) return;
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>No encontrado</title><p>Página no encontrada. <a href="/">Volver al inicio</a></p>');
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Error interno. Inténtalo nuevamente.' : err.message, ...(err.details || {}) });
    else res.end();
  }
});

server.listen(PORT, () => console.log(`CotizaTuWeb en http://localhost:${PORT}  (admin: /admin/)`));

export { server, db };
