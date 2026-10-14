// Base de datos SQLite (módulo node:sqlite incluido en Node.js 22+; no requiere instalar nada).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'globe',
  base_price INTEGER NOT NULL,            -- céntimos
  included_pages INTEGER NOT NULL,        -- páginas incluidas en el precio base
  base_days INTEGER NOT NULL DEFAULT 10,  -- días hábiles estimados
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS features (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,       -- céntimos
  days INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Compatibilidad: sin fila = no disponible para ese servicio.
CREATE TABLE IF NOT EXISTS feature_services (
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('available','included')),
  PRIMARY KEY (feature_id, service_id)
);

-- Opciones de configuración del paso 2 (diseño, idiomas, contenido, plazo).
CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY,
  grp TEXT NOT NULL CHECK (grp IN ('design','languages','content','deadline')),
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_type TEXT NOT NULL DEFAULT 'fixed', -- fixed | per_page | percent_base | percent (solo plazo)
  amount REAL NOT NULL DEFAULT 0,          -- céntimos o porcentaje según price_type
  days INTEGER NOT NULL DEFAULT 0,
  days_factor REAL NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS discounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE,                         -- NULL = descuento automático
  type TEXT NOT NULL CHECK (type IN ('percent','fixed')),
  value REAL NOT NULL,                      -- porcentaje o céntimos
  min_subtotal INTEGER NOT NULL DEFAULT 0,
  valid_from TEXT,
  valid_to TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recurring_items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('incluido','opcional','separado')),
  reference TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  status TEXT NOT NULL DEFAULT 'nueva',
  channels TEXT NOT NULL DEFAULT '',
  service_name TEXT NOT NULL,
  selection_json TEXT NOT NULL,
  characteristics_json TEXT NOT NULL,
  included_json TEXT NOT NULL,
  recurring_json TEXT NOT NULL,
  conditions TEXT NOT NULL DEFAULT '',
  tax_mode TEXT NOT NULL,
  tax_rate REAL NOT NULL,
  tax_label TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  surcharge_total INTEGER NOT NULL,
  discount_total INTEGER NOT NULL,
  tax INTEGER NOT NULL,
  total INTEGER NOT NULL,
  days INTEGER NOT NULL,
  budget TEXT NOT NULL DEFAULT '',
  has_domain TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  desired_deadline TEXT NOT NULL DEFAULT '',
  consent_at TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  internal_notes TEXT NOT NULL DEFAULT '',
  follow_up_date TEXT,
  adjusted INTEGER NOT NULL DEFAULT 0,
  pricing_version INTEGER NOT NULL,
  fingerprint TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Copia de cada concepto con su precio al momento de emitir la cotización.
CREATE TABLE IF NOT EXISTS quote_lines (
  id INTEGER PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL,
  kind TEXT NOT NULL,
  concept TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL,
  amount INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quote_history (
  id INTEGER PRIMARY KEY,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT NOT NULL DEFAULT '',
  data_json TEXT
);

-- Historial de cambios de tarifas y configuración.
CREATE TABLE IF NOT EXISTS change_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  summary TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_quote_lines ON quote_lines(quote_id);
`;

const DEFAULT_CONDITIONS = [
  'Forma de pago: 50 % al aprobar la propuesta y 50 % a la entrega del proyecto.',
  'El plazo de entrega se cuenta en días hábiles desde la recepción del adelanto y del contenido necesario.',
  'Incluye dos rondas de ajustes sobre el diseño aprobado.',
  'Los costos recurrentes (dominio, hosting, licencias y servicios externos) no forman parte del precio de desarrollo, salvo que se indique lo contrario.',
  'Esta cotización es referencial y se confirma con la propuesta final.',
].join('\n');

function seed(db) {
  const today = new Date().toISOString().slice(0, 10);
  const settings = {
    business_name: 'CotizaTuWeb',
    company_name: 'Codigo RM Desarrolladores',
    whatsapp_number: '51956354120',
    contact_email: 'admdesarrollador09@gmail.com',
    quote_validity_days: '15',
    extra_page_price: '6000',
    extra_page_days: '1',
    page_options: '1,3,5,8,10,15',
    surcharge_base: 'subtotal',
    tax_mode: 'none',
    tax_rate: '18',
    tax_label: 'IGV',
    rates_valid_from: today,
    rates_valid_to: '',
    conditions: DEFAULT_CONDITIONS,
    pricing_version: '1',
  };
  const ins = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(settings)) ins.run(k, v);

  // Precios oficiales iniciales (punto 4 de las especificaciones). Importes en céntimos.
  const services = [
    [1, 'Página web para emprendedores', 'Una página de presentación para dar a conocer tu emprendimiento y recibir contactos.', 'rocket', 50000, 1, 7],
    [2, 'Página web para negocios', 'Sitio de varias secciones para mostrar tus servicios, ubicación y datos de contacto.', 'store', 80000, 3, 12],
    [3, 'Página web profesional', 'Sitio completo con diseño a medida, blog y posicionamiento en buscadores.', 'briefcase', 120000, 5, 18],
    [4, 'Tienda virtual', 'Catálogo de productos con carrito de compras y gestión de pedidos.', 'bag', 150000, 5, 25],
    [5, 'Aplicación web personalizada', 'Sistema a medida con usuarios, panel de gestión y la lógica de tu negocio.', 'code', 250000, 3, 35],
  ];
  const insS = db.prepare('INSERT INTO services(id,name,description,icon,base_price,included_pages,base_days,sort) VALUES (?,?,?,?,?,?,?,?)');
  services.forEach((s, i) => insS.run(...s, i + 1));

  // [id, nombre, descripción, precio céntimos, días, {servicio: 'a'|'i'}]
  const features = [
    [1, 'Botón de WhatsApp', 'Botón flotante para que tus clientes te escriban al instante.', 5000, 0, { 1: 'a', 2: 'i', 3: 'i', 4: 'i', 5: 'i' }],
    [2, 'Formulario de contacto', 'Formulario que te envía las consultas a tu correo.', 12000, 1, { 1: 'a', 2: 'i', 3: 'i', 4: 'i', 5: 'i' }],
    [3, 'Mapa de ubicación', 'Mapa interactivo con la dirección de tu negocio.', 6000, 0, { 1: 'a', 2: 'i', 3: 'i', 4: 'a', 5: 'a' }],
    [4, 'Blog o noticias', 'Sección para publicar artículos y novedades.', 35000, 3, { 2: 'a', 3: 'i', 4: 'a', 5: 'a' }],
    [5, 'Catálogo de productos', 'Listado de productos o servicios con fotos, precios y categorías.', 45000, 4, { 2: 'a', 3: 'a', 4: 'i', 5: 'a' }],
    [6, 'Carrito de compras', 'Permite agregar productos y generar pedidos en línea.', 60000, 5, { 4: 'i', 5: 'a' }],
    [7, 'Pasarela de pagos', 'Cobros en línea con tarjeta mediante un proveedor de pagos.', 50000, 3, { 4: 'a', 5: 'a' }],
    [8, 'Sistema de reservas o citas', 'Calendario para que tus clientes agenden citas o reservas.', 70000, 5, { 2: 'a', 3: 'a', 5: 'a' }],
    [9, 'Inicio de sesión de usuarios', 'Registro e ingreso de usuarios con cuenta propia.', 50000, 4, { 3: 'a', 4: 'a', 5: 'i' }],
    [10, 'Panel administrativo', 'Panel para que gestiones tu contenido sin depender de un programador.', 80000, 6, { 2: 'a', 3: 'a', 4: 'i', 5: 'i' }],
    [11, 'SEO avanzado', 'Optimización técnica y de contenidos para aparecer en Google.', 40000, 2, { 1: 'a', 2: 'a', 3: 'i', 4: 'a', 5: 'a' }],
    [12, 'Chatbot con inteligencia artificial', 'Asistente que responde preguntas frecuentes de tus clientes.', 90000, 5, { 1: 'a', 2: 'a', 3: 'a', 4: 'a', 5: 'a' }],
  ];
  const insF = db.prepare('INSERT INTO features(id,name,description,price,days,sort) VALUES (?,?,?,?,?,?)');
  const insC = db.prepare('INSERT INTO feature_services(feature_id,service_id,mode) VALUES (?,?,?)');
  features.forEach(([id, n, d, p, days, compat], i) => {
    insF.run(id, n, d, p, days, i + 1);
    for (const [sid, m] of Object.entries(compat)) insC.run(id, Number(sid), m === 'i' ? 'included' : 'available');
  });

  // [grupo, etiqueta, descripción, tipo, importe, días, factor días, por defecto]
  const options = [
    ['design', 'Plantilla adaptada', 'Plantilla profesional adaptada a tu marca.', 'fixed', 0, 0, 1, 1],
    ['design', 'Diseño personalizado', 'Diseño propio a partir de tu identidad visual.', 'fixed', 40000, 4, 1, 0],
    ['design', 'Diseño premium', 'Diseño exclusivo con animaciones y piezas gráficas a medida.', 'fixed', 90000, 8, 1, 0],
    ['languages', 'Un idioma', 'Sitio en un solo idioma.', 'fixed', 0, 0, 1, 1],
    ['languages', 'Dos idiomas', 'Versión completa del sitio en dos idiomas.', 'percent_base', 30, 3, 1, 0],
    ['languages', 'Tres idiomas', 'Versión completa del sitio en tres idiomas.', 'percent_base', 50, 5, 1, 0],
    ['content', 'El cliente entrega textos e imágenes', 'Tú nos envías el contenido listo para publicar.', 'fixed', 0, 0, 1, 1],
    ['content', 'Apoyo en la redacción de textos', 'Corregimos y mejoramos tus textos.', 'per_page', 4000, 2, 1, 0],
    ['content', 'Redacción de textos y selección de imágenes', 'Escribimos los textos y elegimos imágenes con licencia libre.', 'per_page', 7000, 4, 1, 0],
    ['deadline', 'Flexible', 'Sin apuro: más días de entrega, sin recargo.', 'percent', 0, 0, 1.3, 0],
    ['deadline', 'Estándar', 'Plazo normal de trabajo.', 'percent', 0, 0, 1, 1],
    ['deadline', 'Urgente', 'Priorizamos tu proyecto y reducimos el plazo.', 'percent', 20, 0, 0.6, 0],
  ];
  const insO = db.prepare('INSERT INTO options(grp,label,description,price_type,amount,days,days_factor,is_default,sort) VALUES (?,?,?,?,?,?,?,?,?)');
  options.forEach((o, i) => insO.run(...o, i + 1));

  db.prepare("INSERT INTO discounts(name,code,type,value,min_subtotal,active) VALUES ('Bienvenida','BIENVENIDA','percent',10,0,0)").run();

  const recurring = [
    ['Dominio', 'Dirección web (.com, .pe u otra extensión).', 'separado', 'Pago anual al proveedor del dominio.'],
    ['Hosting', 'Servidor donde se publica el sitio.', 'separado', 'Pago mensual o anual según el plan.'],
    ['Correos corporativos', 'Cuentas de correo con tu dominio.', 'opcional', 'Según cantidad de cuentas.'],
    ['Licencias', 'Plantillas, complementos o tipografías de pago.', 'separado', 'Solo si el proyecto las requiere.'],
    ['Mantenimiento mensual', 'Actualizaciones, copias de seguridad y monitoreo.', 'opcional', 'Plan mensual opcional.'],
    ['Soporte técnico', 'Atención de consultas y correcciones posteriores a la entrega.', 'opcional', 'Según plan de soporte.'],
    ['Comisiones de pasarelas de pago', 'Las cobra el proveedor de pagos por cada transacción.', 'separado', 'Según tarifas del proveedor.'],
    ['Servicios externos de inteligencia artificial', 'Consumo de APIs de IA para chatbots u otras funciones.', 'separado', 'Según uso del proveedor.'],
  ];
  const insR = db.prepare('INSERT INTO recurring_items(name,description,status,reference,sort) VALUES (?,?,?,?,?)');
  recurring.forEach((r, i) => insR.run(...r, i + 1));
}

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  const has = db.prepare('SELECT COUNT(*) AS n FROM services').get().n;
  if (!has) tx(db, () => seed(db));
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function getSettings(db) {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

export function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

export function bumpPricingVersion(db) {
  const v = Number(getSettings(db).pricing_version || 1) + 1;
  setSetting(db, 'pricing_version', v);
  return v;
}

/** Configuración comercial para el motor de cálculo (solo elementos activos). */
export function buildConfig(db) {
  const s = getSettings(db);
  const services = db.prepare('SELECT * FROM services WHERE active=1 ORDER BY sort, id').all().map((r) => ({
    id: r.id, name: r.name, description: r.description, icon: r.icon,
    basePrice: r.base_price, includedPages: r.included_pages, baseDays: r.base_days,
  }));
  const activeIds = new Set(services.map((x) => x.id));
  const compat = db.prepare('SELECT * FROM feature_services').all();
  const features = db.prepare('SELECT * FROM features WHERE active=1 ORDER BY sort, id').all().map((r) => {
    const c = {};
    for (const x of compat) if (x.feature_id === r.id && activeIds.has(x.service_id)) c[x.service_id] = x.mode;
    return { id: r.id, name: r.name, description: r.description, price: r.price, days: r.days, compat: c };
  });
  const options = { design: [], languages: [], content: [], deadline: [] };
  for (const r of db.prepare('SELECT * FROM options WHERE active=1 ORDER BY sort, id').all()) {
    options[r.grp].push({
      id: r.id, label: r.label, description: r.description, priceType: r.price_type,
      amount: r.amount, days: r.days, daysFactor: r.days_factor, isDefault: !!r.is_default,
    });
  }
  const discounts = db.prepare('SELECT * FROM discounts WHERE active=1 AND code IS NULL').all().map(mapDiscount);
  const pageOptions = String(s.page_options || '1').split(',').map((x) => parseInt(x, 10)).filter((n) => n > 0).sort((a, b) => a - b);
  return {
    services, features, options, discounts, pageOptions,
    rules: {
      extraPagePrice: Number(s.extra_page_price || 0),
      extraPageDays: Number(s.extra_page_days || 0),
      surchargeBase: s.surcharge_base === 'base' ? 'base' : 'subtotal',
      taxMode: ['added', 'included'].includes(s.tax_mode) ? s.tax_mode : 'none',
      taxRate: Number(s.tax_rate || 0),
      taxLabel: s.tax_label || 'IGV',
    },
  };
}

export function mapDiscount(r) {
  return {
    id: r.id, name: r.name, type: r.type, value: r.value, minSubtotal: r.min_subtotal,
    validFrom: r.valid_from || null, validTo: r.valid_to || null, active: !!r.active, requiresCode: !!r.code,
  };
}

export function recurringItems(db) {
  return db.prepare('SELECT id,name,description,status,reference FROM recurring_items WHERE active=1 ORDER BY sort, id').all()
    .map((r) => ({ ...r }));
}
