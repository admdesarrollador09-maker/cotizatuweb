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

  return { services, features, options, discounts, recurring, settings };
}

const bySort = (a, b) => (a.sort - b.sort) || (a.id - b.id);
export const nextId = (list) => list.reduce((m, x) => Math.max(m, x.id), 0) + 1;

export function mapDiscount(r) {
  return {
    id: r.id, name: r.name, type: r.type, value: r.value, minSubtotal: r.min_subtotal || 0,
    validFrom: r.valid_from || null, validTo: r.valid_to || null, active: !!r.active, requiresCode: !!r.code,
  };
}

/** Configuración comercial para el motor de cálculo (solo elementos activos). */
export function buildConfig(cat) {
  const s = cat.settings;
  const services = cat.services.filter((x) => x.active).sort(bySort).map((r) => ({
    id: r.id, name: r.name, description: r.description, icon: r.icon,
    basePrice: r.base_price, includedPages: r.included_pages, baseDays: r.base_days,
  }));
  const activeIds = new Set(services.map((x) => String(x.id)));
  const features = cat.features.filter((x) => x.active).sort(bySort).map((r) => ({
    id: r.id, name: r.name, description: r.description, price: r.price, days: r.days,
    compat: Object.fromEntries(Object.entries(r.compat || {}).filter(([k]) => activeIds.has(String(k)))),
  }));
  const options = { design: [], languages: [], content: [], deadline: [] };
  for (const r of cat.options.filter((x) => x.active).sort(bySort)) {
    options[r.grp].push({
      id: r.id, label: r.label, description: r.description, priceType: r.price_type,
      amount: r.amount, days: r.days, daysFactor: r.days_factor, isDefault: !!r.is_default,
    });
  }
  const discounts = cat.discounts.filter((d) => d.active && !d.code).map(mapDiscount);
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

export function recurringItems(cat) {
  return cat.recurring.filter((r) => r.active).sort(bySort)
    .map(({ id, name, description, status, reference }) => ({ id, name, description, status, reference }));
}

export function sortCatalog(cat) {
  for (const k of ['services', 'features', 'recurring']) cat[k].sort(bySort);
  cat.options.sort((a, b) => a.grp.localeCompare(b.grp) || bySort(a, b));
  cat.discounts.sort((a, b) => b.id - a.id);
  return cat;
}
