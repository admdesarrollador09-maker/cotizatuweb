// Catálogo comercial: servicios, funcionalidades, opciones, descuentos, costos aparte y configuración.
// Se guarda como un único documento ("catalog") en el almacenamiento.
// Todos los importes en céntimos (S/ 1.00 = 100).

const DEFAULT_CONDITIONS = [
  'Forma de pago: 50 % al aprobar la propuesta y 50 % a la entrega del proyecto.',
  'El plazo de entrega se cuenta en días hábiles desde la recepción del adelanto y del contenido necesario.',
  'Incluye dos rondas de ajustes sobre el diseño aprobado.',
  'Los costos recurrentes (dominio, hosting, licencias y servicios externos) no forman parte del precio de desarrollo, salvo que se indique lo contrario.',
  'Esta cotización es referencial y se confirma con la propuesta final.',
].join('\n');

export function seedCatalog() {
  const today = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
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

  // Precios oficiales iniciales (punto 4 de las especificaciones).
  const services = [
    [1, 'Página web para emprendedores', 'Una página de presentación para dar a conocer tu emprendimiento y recibir contactos.', 'rocket', 50000, 1, 7],
    [2, 'Página web para negocios', 'Sitio de varias secciones para mostrar tus servicios, ubicación y datos de contacto.', 'store', 80000, 3, 12],
    [3, 'Página web profesional', 'Sitio completo con diseño a medida, blog y posicionamiento en buscadores.', 'briefcase', 120000, 5, 18],
    [4, 'Tienda virtual', 'Catálogo de productos con carrito de compras y gestión de pedidos.', 'bag', 150000, 5, 25],
    [5, 'Aplicación web personalizada', 'Sistema a medida con usuarios, panel de gestión y la lógica de tu negocio.', 'code', 250000, 3, 35],
  ].map(([id, name, description, icon, base_price, included_pages, base_days], i) => ({
    id, name, description, icon, base_price, included_pages, base_days, active: 1, sort: i + 1,
  }));

  const M = { a: 'available', i: 'included' };
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
  ].map(([id, name, description, price, days, c], i) => ({
    id, name, description, price, days, active: 1, sort: i + 1,
    compat: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, M[v]])),
  }));

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
  ].map(([grp, label, description, price_type, amount, days, days_factor, is_default], i) => ({
    id: i + 1, grp, label, description, price_type, amount, days, days_factor, is_default, active: 1, sort: i + 1,
  }));

  const discounts = [{ id: 1, name: 'Bienvenida', code: 'BIENVENIDA', type: 'percent', value: 10, min_subtotal: 0, valid_from: null, valid_to: null, active: 0 }];

  const recurring = [
    ['Dominio', 'Dirección web (.com, .pe u otra extensión).', 'separado', 'Pago anual al proveedor del dominio.'],
    ['Hosting', 'Servidor donde se publica el sitio.', 'separado', 'Pago mensual o anual según el plan.'],
    ['Correos corporativos', 'Cuentas de correo con tu dominio.', 'opcional', 'Según cantidad de cuentas.'],
    ['Licencias', 'Plantillas, complementos o tipografías de pago.', 'separado', 'Solo si el proyecto las requiere.'],
    ['Mantenimiento mensual', 'Actualizaciones, copias de seguridad y monitoreo.', 'opcional', 'Plan mensual opcional.'],
    ['Soporte técnico', 'Atención de consultas y correcciones posteriores a la entrega.', 'opcional', 'Según plan de soporte.'],
    ['Comisiones de pasarelas de pago', 'Las cobra el proveedor de pagos por cada transacción.', 'separado', 'Según tarifas del proveedor.'],
    ['Servicios externos de inteligencia artificial', 'Consumo de APIs de IA para chatbots u otras funciones.', 'separado', 'Según uso del proveedor.'],
  ].map(([name, description, status, reference], i) => ({ id: i + 1, name, description, status, reference, active: 1, sort: i + 1 }));

  return migrateCatalog({ services, features, options, discounts, recurring, settings });
}

const bySort = (a, b) => (a.sort - b.sort) || (a.id - b.id);
export const nextId = (list) => list.reduce((m, x) => Math.max(m, x.id), 0) + 1;

// ---------------------------------------------------------------------------
// Versión 2 del catálogo: cotizador guiado en cinco pasos.
// Los importes `null` significan "pendiente de configuración": no se cobran
// hasta que el administrador les asigne una tarifa en el panel.
// ---------------------------------------------------------------------------
export const CATALOG_SCHEMA = 2;

const SERVICE_EXTRAS = {
  1: { kind: 'web', benefits: ['Presencia profesional en internet', 'Botón directo a tu WhatsApp', 'Lista para verse bien en celulares'] },
  2: { kind: 'web', benefits: ['Varias secciones para tus servicios', 'Formulario de contacto y mapa', 'Imagen confiable para tus clientes'] },
  3: { kind: 'web', benefits: ['Diseño a medida de tu marca', 'Blog y posicionamiento en Google', 'Pensada para crecer contigo'] },
  4: { kind: 'store', benefits: ['Catálogo y carrito de compras', 'Recibe pedidos las 24 horas', 'Panel para gestionar productos'] },
  5: { kind: 'app', benefits: ['Hecha a la medida de tus procesos', 'Usuarios, roles y panel de gestión', 'Automatiza tareas repetitivas'] },
};

const FEATURE_CATEGORY = { 1: 'general', 2: 'general', 3: 'general', 4: 'general', 5: 'tienda', 6: 'tienda', 7: 'tienda', 8: 'general', 9: 'app', 10: 'general', 11: 'general', 12: 'general' };

// Funcionalidades nuevas: sin tarifa definida (pendientes de configuración).
const NEW_FEATURES = [
  ['Galería de imágenes', 'Galería de fotos o portafolio de proyectos.', 'general', { 1: 'a', 2: 'a', 3: 'a', 4: 'a' }],
  ['SEO básico', 'Títulos, descripciones y estructura para que Google entienda tu web.', 'general', { 1: 'a', 2: 'a', 3: 'a', 4: 'a' }],
  ['Integración con CRM', 'Envío automático de contactos o clientes a tu CRM.', 'general', { 2: 'a', 3: 'a', 4: 'a', 5: 'a' }],
  ['Integraciones externas', 'Conexión con otras herramientas o servicios que ya usas.', 'general', { 2: 'a', 3: 'a', 4: 'a' }],
  ['Transferencias bancarias', 'Opción de pago por transferencia con confirmación del pedido.', 'tienda', { 4: 'a' }],
  ['Billeteras digitales', 'Pagos con Yape, Plin u otras billeteras.', 'tienda', { 4: 'a' }],
  ['Control de inventario', 'Stock por producto que se descuenta con cada venta.', 'tienda', { 4: 'a' }],
  ['Registro de clientes', 'Cuentas para que tus clientes compren más rápido y vean sus pedidos.', 'tienda', { 4: 'a' }],
  ['Cupones y descuentos', 'Códigos promocionales para tus campañas.', 'tienda', { 4: 'a' }],
  ['Seguimiento de pedidos', 'El cliente consulta el estado de su pedido.', 'tienda', { 4: 'a' }],
  ['Notificaciones de pedidos', 'Avisos por correo cuando entra o cambia un pedido.', 'tienda', { 4: 'a' }],
  ['Variantes de productos', 'Tallas, colores o modelos para un mismo producto.', 'tienda', { 4: 'a' }],
  ['Gestión de usuarios y permisos', 'Roles con accesos distintos dentro de la aplicación.', 'app', { 5: 'a' }],
  ['Base de datos', 'Almacenamiento seguro de la información de tu negocio.', 'app', { 5: 'a' }],
  ['Reportes', 'Reportes y estadísticas para tomar decisiones.', 'app', { 5: 'a' }],
  ['Exportación a Excel o PDF', 'Descarga de listados y reportes.', 'app', { 5: 'a' }],
  ['Automatizaciones', 'Tareas que se ejecutan solas: recordatorios, cálculos, flujos.', 'app', { 5: 'a' }],
  ['Integraciones con API', 'Conexión con sistemas externos mediante API.', 'app', { 5: 'a' }],
  ['Notificaciones', 'Avisos por correo o dentro de la aplicación.', 'app', { 5: 'a' }],
  ['Funciones con inteligencia artificial', 'Clasificación, resúmenes o asistentes con IA dentro de tu sistema.', 'app', { 5: 'a' }],
];

const RECURRING_EXTRAS = {
  'Dominio': { period: 'anual', selectable: 1 },
  'Hosting': { period: 'anual', selectable: 1 },
  'Correos corporativos': { period: 'anual', selectable: 1 },
  'Licencias': { period: 'unico', selectable: 0 },
  'Mantenimiento mensual': { period: 'mensual', selectable: 1 },
  'Soporte técnico': { period: 'mensual', selectable: 1 },
  'Comisiones de pasarelas de pago': { period: 'mensual', selectable: 0 },
  'Servicios externos de inteligencia artificial': { period: 'mensual', selectable: 0 },
};

export const PAGE_RANGES_DEFAULT = [
  { id: 1, label: 'Una página (landing page)', pages: 1, extra_pending: 0 },
  { id: 2, label: 'De 2 a 5 páginas', pages: 5, extra_pending: 0 },
  { id: 3, label: 'De 6 a 10 páginas', pages: 10, extra_pending: 0 },
  { id: 4, label: 'De 11 a 20 páginas', pages: 20, extra_pending: 0 },
  { id: 5, label: 'Más de 20 páginas', pages: 20, extra_pending: 1 },
];

// Opción: [etiqueta, importe] — 0 = sin costo adicional, null = pendiente de configuración.
const o = (list) => list.map(([label, amount], i) => ({ id: i + 1, label, price_type: 'fixed', amount, days: 0 }));
const SI_NO = (si = 0, no = 0) => o([['Sí', si], ['No', no]]);

function seedQuestions(featureId) {
  const q = [];
  const add = (x) => q.push({ id: q.length + 1, help: '', required: 0, options: [], feature_id: null, show_if: null, active: 1, sort: q.length + 1, ...x });
  // Paso 2 — páginas web
  add({ key: 'secciones', step: 2, services: [1, 2, 3], type: 'single', label: '¿Cuántas secciones tendrá tu landing page?',
    help: 'Una landing page es una sola página larga dividida en secciones (presentación, servicios, testimonios, contacto). Una web de varias páginas tiene direcciones separadas, como Inicio, Nosotros y Contacto.',
    options: o([['Hasta 5 secciones', 0], ['De 6 a 10 secciones', null], ['Más de 10 secciones', null]]), show_if: { key: '__pages', values: [1] } });
  add({ key: 'estructura', step: 2, services: [1, 2, 3], type: 'single', required: 1, label: '¿Qué tipo de web necesitas?',
    options: o([['Landing page', 0], ['Web informativa', 0], ['Portafolio', 0], ['Web corporativa', 0], ['Otra', 0]]) });
  add({ key: 'galeria', step: 2, services: [1, 2, 3], type: 'feature', label: '¿Necesitas una galería de fotos o un portafolio de proyectos?', feature_id: featureId('Galería de imágenes') });
  add({ key: 'blog', step: 2, services: [1, 2, 3], type: 'feature', label: '¿Quieres un blog o sección de noticias?', feature_id: featureId('Blog o noticias') });
  add({ key: 'fotos', step: 2, services: [2, 3], type: 'single', label: '¿Cuántas fotografías tendrá aproximadamente?',
    options: o([['No tendrá fotografías', 0], ['De 1 a 10', 0], ['De 11 a 30', null], ['De 31 a 60', null], ['Más de 60', null]]) });
  add({ key: 'videos', step: 2, services: [2, 3], type: 'single', label: '¿Y videos?',
    options: o([['No tendrá videos', 0], ['De 1 a 3', null], ['De 4 a 10', null], ['Más de 10', null]]) });
  add({ key: 'estado_medios', step: 2, services: [2, 3], type: 'single', label: '¿Las fotos y videos ya están listos?',
    options: o([['Sí, listos para publicar', 0], ['Necesitan edición o adaptación', null], ['Hay que crearlos (sesión de fotos o video)', null]]),
    show_if: { key: 'fotos|videos', values: ['not-first'] } });
  // Paso 2 — tienda virtual
  add({ key: 'productos', step: 2, services: [4], type: 'single', required: 1, label: '¿Cuántos productos tendrá tu tienda al inicio?',
    options: o([['De 1 a 20', 0], ['De 21 a 50', null], ['De 51 a 100', null], ['De 101 a 300', null], ['Más de 300', null], ['Todavía no lo sé', 0]]) });
  add({ key: 'fotos_productos', step: 2, services: [4], type: 'single', label: '¿Los productos tendrán fotografías?', options: SI_NO() });
  add({ key: 'descripcion_productos', step: 2, services: [4], type: 'single', label: '¿Cada producto tendrá descripción y precio?', options: SI_NO() });
  add({ key: 'variantes', step: 2, services: [4], type: 'feature', label: '¿Habrá variantes de talla, color o modelo?', feature_id: featureId('Variantes de productos') });
  add({ key: 'carga_productos', step: 2, services: [4], type: 'single', required: 1, label: '¿Quién cargará los productos?',
    options: o([['Yo (el cliente)', 0], ['Ustedes', null], ['Ambos', null]]) });
  add({ key: 'inventario', step: 2, services: [4], type: 'feature', label: '¿Necesitas control de inventario?', feature_id: featureId('Control de inventario') });
  add({ key: 'panel_tienda', step: 2, services: [4], type: 'feature', label: '¿Necesitas un panel para administrar productos y pedidos?', feature_id: featureId('Panel administrativo') });
  // Paso 2 — aplicación web
  add({ key: 'objetivo', step: 2, services: [5], type: 'text', required: 1, label: '¿Cuál es el objetivo principal de la aplicación?', help: 'Por ejemplo: gestionar citas de una clínica, controlar ventas y almacén, administrar alumnos.' });
  add({ key: 'roles', step: 2, services: [5], type: 'text', label: '¿Qué tipos de usuarios la usarán?', help: 'Por ejemplo: administrador, vendedor, cliente.' });
  add({ key: 'procesos', step: 2, services: [5], type: 'text', label: '¿Qué procesos quieres automatizar?' });
  add({ key: 'panel_app', step: 2, services: [5], type: 'feature', label: '¿Necesitas un panel de administración?', feature_id: featureId('Panel administrativo') });
  add({ key: 'formularios', step: 2, services: [5], type: 'single', label: '¿Necesitas formularios y registros de información?', options: SI_NO(null, 0) });
  add({ key: 'reportes', step: 2, services: [5], type: 'feature', label: '¿Necesitas reportes y estadísticas?', feature_id: featureId('Reportes') });
  add({ key: 'integraciones', step: 2, services: [5], type: 'feature', label: '¿Debe conectarse con otros sistemas?', feature_id: featureId('Integraciones con API') });
  add({ key: 'datos', step: 2, services: [5], type: 'feature', label: '¿Necesitas guardar información (clientes, ventas, registros)?', feature_id: featureId('Base de datos') });
  add({ key: 'especiales', step: 2, services: [5], type: 'text', label: '¿Alguna función especial o automatización?', help: 'Opcional. Cuéntanos cualquier detalle que debamos considerar.' });
  // Paso 3 — diseño y contenido
  add({ key: 'identidad', step: 3, services: [1, 2, 3, 4, 5], type: 'single', label: '¿Ya tienes logotipo, colores y tipografías?',
    options: o([['Sí, tengo mi identidad visual', 0], ['Tengo logotipo, pero no colores definidos', 0], ['No, necesito crearla', null]]) });
  add({ key: 'fotos_propias', step: 3, services: [1, 2, 3, 4], type: 'single', label: '¿Tienes fotografías propias?',
    options: o([['Sí', 0], ['No, usar imágenes de banco con licencia libre', 0], ['No, necesito una sesión de fotos', null]]) });
  add({ key: 'edicion', step: 3, services: [1, 4], type: 'single', label: '¿Necesitas edición de imágenes o videos?',
    options: o([['No', 0], ['Sí, edición básica', null], ['Sí, edición y creación de piezas', null]]) });
  const SHORT = {
    secciones: 'Secciones de la landing', estructura: 'Tipo de web', galeria: 'Galería o portafolio', blog: 'Blog',
    fotos: 'Fotografías', videos: 'Videos', estado_medios: 'Estado de fotos y videos', productos: 'Productos iniciales',
    fotos_productos: 'Productos con fotografía', descripcion_productos: 'Productos con descripción y precio', variantes: 'Variantes',
    carga_productos: 'Carga de productos', inventario: 'Control de inventario', panel_tienda: 'Panel de productos y pedidos',
    objetivo: 'Objetivo de la aplicación', roles: 'Usuarios y roles', procesos: 'Procesos a automatizar', panel_app: 'Panel de administración',
    formularios: 'Formularios y registros', reportes: 'Reportes', integraciones: 'Integraciones', datos: 'Almacenamiento de información',
    especiales: 'Funciones especiales', identidad: 'Identidad visual', fotos_propias: 'Fotografías propias', edicion: 'Edición de imágenes o videos',
  };
  for (const x of q) x.short = SHORT[x.key] || x.label.replace(/[¿?]/g, '');
  return q;
}

/** Actualiza un catálogo antiguo a la versión actual sin tocar precios ni ediciones existentes. */
export function migrateCatalog(cat) {
  if ((cat.schema || 1) >= CATALOG_SCHEMA) return cat;
  for (const s of cat.services) {
    const x = SERVICE_EXTRAS[s.id] || { kind: 'web', benefits: [] };
    if (!s.kind) s.kind = x.kind;
    if (!Array.isArray(s.benefits)) s.benefits = x.benefits;
  }
  for (const f of cat.features) if (!f.category) f.category = FEATURE_CATEGORY[f.id] || 'general';
  const M = { a: 'available', i: 'included' };
  for (const [name, description, category, compat] of NEW_FEATURES) {
    if (cat.features.some((f) => f.name.toLowerCase() === name.toLowerCase())) continue;
    cat.features.push({
      id: nextId(cat.features), name, description, price: null, days: 0, active: 1, sort: cat.features.length + 1, category,
      compat: Object.fromEntries(Object.entries(compat).map(([k, v]) => [k, M[v]])),
    });
  }
  const featureId = (name) => cat.features.find((f) => f.name === name)?.id ?? null;
  if (!Array.isArray(cat.questions)) cat.questions = seedQuestions(featureId);
  if (!Array.isArray(cat.settings.page_ranges)) cat.settings.page_ranges = structuredClone(PAGE_RANGES_DEFAULT);
  for (const r of cat.recurring) {
    const x = RECURRING_EXTRAS[r.name] || { period: 'mensual', selectable: 0 };
    if (!('price' in r)) r.price = null;
    if (!r.period) r.period = x.period;
    if (!('selectable' in r)) r.selectable = x.selectable;
  }
  cat.schema = CATALOG_SCHEMA;
  return cat;
}

export function mapDiscount(r) {
  return {
    id: r.id, name: r.name, type: r.type, value: r.value, minSubtotal: r.min_subtotal || 0,
    validFrom: r.valid_from || null, validTo: r.valid_to || null, active: !!r.active, requiresCode: !!r.code,
  };
}

const isPriced = (v) => v !== null && v !== undefined && v !== '';

/** Configuración COMPLETA para el motor de cálculo (solo en el servidor; contiene tarifas). */
export function buildConfig(cat) {
  const s = cat.settings;
  const services = cat.services.filter((x) => x.active).sort(bySort).map((r) => ({
    id: r.id, name: r.name, description: r.description, icon: r.icon, kind: r.kind || 'web', benefits: r.benefits || [],
    basePrice: r.base_price, includedPages: r.included_pages, baseDays: r.base_days,
  }));
  const activeIds = new Set(services.map((x) => String(x.id)));
  const features = cat.features.filter((x) => x.active).sort(bySort).map((r) => ({
    id: r.id, name: r.name, description: r.description, category: r.category || 'general',
    price: isPriced(r.price) ? Number(r.price) : null, days: r.days || 0,
    compat: Object.fromEntries(Object.entries(r.compat || {}).filter(([k]) => activeIds.has(String(k)))),
  }));
  const options = { design: [], languages: [], content: [], deadline: [] };
  for (const r of cat.options.filter((x) => x.active).sort(bySort)) {
    options[r.grp].push({
      id: r.id, label: r.label, description: r.description, priceType: r.price_type,
      amount: r.amount, days: r.days, daysFactor: r.days_factor, isDefault: !!r.is_default,
    });
  }
  const questions = (cat.questions || []).filter((q) => q.active).sort(bySort).map((q) => ({
    id: q.id, key: q.key, step: q.step, services: q.services || [], type: q.type, label: q.label, short: q.short || q.label.replace(/[¿?]/g, ''), help: q.help || '',
    required: !!q.required, featureId: q.feature_id ?? null, showIf: q.show_if || null,
    options: (q.options || []).map((x) => ({ id: x.id, label: x.label, priceType: x.price_type || 'fixed', amount: isPriced(x.amount) ? Number(x.amount) : null, days: x.days || 0 })),
  }));
  const pageRanges = (s.page_ranges || PAGE_RANGES_DEFAULT).map((r) => ({ id: r.id, label: r.label, pages: Number(r.pages), extraPending: !!r.extra_pending }));
  const recurring = cat.recurring.filter((r) => r.active && r.selectable).sort(bySort).map((r) => ({
    id: r.id, name: r.name, description: r.description, period: r.period, price: isPriced(r.price) ? Number(r.price) : null,
  }));
  const discounts = cat.discounts.filter((d) => d.active && !d.code).map(mapDiscount);
  return {
    services, features, options, questions, pageRanges, recurring, discounts,
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

/** Configuración PÚBLICA para el navegador: sin ningún precio ni regla de cálculo. */
export function publicConfig(cat) {
  const c = buildConfig(cat);
  return {
    services: c.services.map(({ id, name, description, icon, kind, benefits, includedPages }) => ({ id, name, description, icon, kind, benefits, includedPages })),
    features: c.features.map(({ id, name, description, category, compat }) => ({ id, name, description, category, compat })),
    options: Object.fromEntries(Object.entries(c.options).map(([g, list]) => [g, list.map(({ id, label, description, isDefault }) => ({ id, label, description, isDefault }))])),
    questions: c.questions.map(({ options, ...q }) => ({ ...q, options: options.map(({ id, label }) => ({ id, label })) })),
    pageRanges: c.pageRanges.map(({ id, label, pages }) => ({ id, label, pages })),
    recurring: c.recurring.map(({ id, name, description, period }) => ({ id, name, description, period })),
    conditions: cat.settings.conditions || '',
  };
}

export function recurringItems(cat) {
  return cat.recurring.filter((r) => r.active).sort(bySort)
    .map(({ id, name, description, status, reference, period }) => ({ id, name, description, status, reference, period }));
}

/** Lista de todo lo que aún no tiene tarifa (para el panel). */
export function pendingPricing(cat) {
  const out = [];
  for (const f of cat.features) if (f.active && !isPriced(f.price)) out.push({ area: 'Funcionalidad', name: f.name });
  for (const q of cat.questions || []) {
    if (!q.active) continue;
    for (const x of q.options || []) if (!isPriced(x.amount)) out.push({ area: 'Pregunta', name: `${q.label} → ${x.label}` });
  }
  for (const r of cat.settings.page_ranges || []) if (r.extra_pending) out.push({ area: 'Páginas', name: `${r.label} (páginas por encima de ${r.pages})` });
  for (const r of cat.recurring) if (r.active && r.selectable && !isPriced(r.price)) out.push({ area: 'Servicio recurrente', name: r.name });
  return out;
}

export function sortCatalog(cat) {
  for (const k of ['services', 'features', 'recurring', 'questions']) (cat[k] || []).sort(bySort);
  cat.options.sort((a, b) => a.grp.localeCompare(b.grp) || bySort(a, b));
  cat.discounts.sort((a, b) => b.id - a.id);
  return cat;
}
