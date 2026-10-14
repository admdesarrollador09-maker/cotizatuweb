// Pruebas del motor de cálculo (servidor) con el catálogo inicial.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedCatalog, buildConfig, publicConfig, migrateCatalog, CATALOG_SCHEMA } from '../src/catalog.js';
import { computeQuote, cleanSelection, clientView, formatPEN } from '../src/pricing.js';
import { questionVisible } from '../public/js/questions.js';

const cat = seedCatalog();
const cfg = buildConfig(cat);
const feat = (name) => cfg.features.find((f) => f.name === name).id;
const opt = (grp, label) => cfg.options[grp].find((o) => o.label === label).id;
const q = (key) => cfg.questions.find((x) => x.key === key);
const ans = (key, label) => q(key).options.find((o) => o.label === label).id;
const calc = (sel, opts) => computeQuote(cfg, cleanSelection(sel), opts);
const sum = (r) => r.lines.reduce((s, l) => s + l.amount, 0) + r.surchargeTotal - r.discountTotal + (r.taxMode === 'added' ? r.tax : 0);
const WEB = { estructura: 1 };

test('formato monetario peruano', () => {
  assert.equal(formatPEN(120000), 'S/ 1,200.00');
  assert.equal(formatPEN(123456789), 'S/ 1,234,567.89');
});

test('los cinco paquetes conservan sus precios base oficiales', () => {
  assert.deepEqual(cfg.services.map((s) => [s.name, s.basePrice]), [
    ['Página web para emprendedores', 50000], ['Página web para negocios', 80000], ['Página web profesional', 120000],
    ['Tienda virtual', 150000], ['Aplicación web personalizada', 250000],
  ]);
});

test('la configuración pública no contiene ningún precio', () => {
  const txt = JSON.stringify(publicConfig(cat));
  for (const k of ['basePrice', '"price"', '"amount"', 'priceType', 'extraPagePrice', 'daysFactor']) assert.ok(!txt.includes(k), k);
});

test('solo el precio base cuando se elige lo mínimo', () => {
  assert.equal(calc({ serviceId: 1, pageRange: 1, answers: WEB }).total, 50000);
  assert.equal(calc({ serviceId: 2, pageRange: 1, answers: WEB }).total, 80000);
  assert.equal(calc({ serviceId: 4, answers: { productos: 1, carga_productos: 1 } }).total, 150000);
  assert.equal(calc({ serviceId: 5, answers: { objetivo: 'Agenda de citas' } }).total, 250000);
});

test('rangos de páginas: se cobra solo lo que supera lo incluido en el paquete', () => {
  // Negocios incluye 3; "De 6 a 10" cuenta 10 → 7 adicionales × S/ 60
  const r = calc({ serviceId: 2, pageRange: 3, answers: WEB });
  assert.equal(r.lines.find((l) => l.kind === 'pages').amount, 7 * 6000);
  // Profesional incluye 5; "De 2 a 5" no genera cargo
  assert.ok(!calc({ serviceId: 3, pageRange: 2, answers: WEB }).lines.some((l) => l.kind === 'pages'));
  // "Más de 20": se cobra hasta 20 y el excedente queda por confirmar
  const big = calc({ serviceId: 2, pageRange: 5, answers: WEB });
  assert.ok(big.pending.some((p) => p.includes('por encima de 20')));
  // Tiendas y aplicaciones no usan rangos de páginas
  assert.ok(!calc({ serviceId: 4, pageRange: 5, answers: { productos: 1, carga_productos: 1 } }).lines.some((l) => l.kind === 'pages'));
});

test('preguntas según el paquete', () => {
  const vis = (sid, key, answers = {}, pageRange = null) => questionVisible(q(key), { serviceId: sid, answers, pageRange }, cfg);
  assert.ok(vis(2, 'fotos'));
  assert.ok(!vis(1, 'fotos'));
  assert.ok(vis(4, 'productos') && !vis(5, 'productos') && !vis(2, 'productos'));
  assert.ok(vis(5, 'objetivo') && !vis(4, 'objetivo'));
  assert.ok(!vis(5, 'variantes'));
  // Secciones solo si eligió landing page
  assert.ok(vis(2, 'secciones', {}, 1) && !vis(2, 'secciones', {}, 2));
  // Estado de fotos/videos solo si tendrá fotos o videos
  assert.ok(!vis(2, 'estado_medios', { fotos: 1, videos: 1 }));
  assert.ok(vis(2, 'estado_medios', { fotos: 3 }));
});

test('las preguntas obligatorias deben responderse', () => {
  assert.equal(calc({ serviceId: 2, pageRange: 2 }).ok, false);
  assert.equal(calc({ serviceId: 4, answers: { productos: 1 } }).ok, false);
  assert.equal(calc({ serviceId: 5, answers: { objetivo: '   ' } }).ok, false);
});

test('conceptos sin tarifa quedan pendientes y no suman', () => {
  const r = calc({ serviceId: 4, answers: { productos: ans('productos', 'De 101 a 300'), carga_productos: ans('carga_productos', 'Ustedes') }, features: [feat('Variantes de productos'), feat('Pasarela de pagos')] });
  assert.equal(r.total, 150000 + 50000); // solo la pasarela tiene tarifa
  assert.deepEqual(r.pending.sort(), ['Carga de productos: Ustedes', 'Productos iniciales: De 101 a 300', 'Variantes de productos'].sort());
});

test('no se cobra dos veces una funcionalidad incluida', () => {
  const r = calc({ serviceId: 2, pageRange: 1, answers: WEB, features: [feat('Botón de WhatsApp'), feat('Formulario de contacto')] });
  assert.equal(r.total, 80000);
  assert.ok(r.included.some((f) => f.name === 'Botón de WhatsApp'));
});

test('funcionalidades de otro tipo de proyecto se rechazan', () => {
  const r = calc({ serviceId: 1, pageRange: 1, answers: WEB, features: [feat('Carrito de compras')] });
  assert.equal(r.ok, false);
});

test('recargo por urgencia como línea interna', () => {
  const r = calc({ serviceId: 2, pageRange: 3, answers: WEB, design: opt('design', 'Diseño personalizado'), deadline: opt('deadline', 'Urgente'), features: [feat('Blog o noticias')] });
  assert.equal(r.subtotal, 80000 + 42000 + 40000 + 35000);
  assert.equal(r.surcharges[0].amount, Math.round(r.subtotal * 0.2));
  assert.equal(r.total, r.subtotal + r.surcharges[0].amount);
});

test('recurrentes separados del desarrollo y por periodo', () => {
  const c2 = structuredClone(cat);
  c2.recurring.find((x) => x.name === 'Dominio').price = 8000;
  c2.recurring.find((x) => x.name === 'Mantenimiento mensual').price = 15000;
  const cf = buildConfig(c2);
  const ids = cf.recurring.filter((x) => ['Dominio', 'Mantenimiento mensual', 'Hosting'].includes(x.name)).map((x) => x.id);
  const r = computeQuote(cf, cleanSelection({ serviceId: 1, pageRange: 1, answers: WEB, recurring: ids }));
  assert.equal(r.total, 50000);
  assert.deepEqual(r.recurringTotals, { mensual: 15000, anual: 8000, unico: 0 });
  assert.deepEqual(r.recurringPending, ['Hosting']);
});

test('la vista del cliente no incluye desglose', () => {
  const v = clientView(calc({ serviceId: 2, pageRange: 3, answers: WEB, features: [feat('Blog o noticias')] }));
  assert.equal(v.lines, undefined);
  assert.equal(v.subtotal, undefined);
  assert.ok(!JSON.stringify(v).includes('35000'));
});

test('el total coincide con la suma de conceptos en todas las combinaciones', () => {
  let n = 0;
  for (const s of cfg.services) {
    const ranges = s.kind === 'web' ? cfg.pageRanges : [null];
    for (const range of ranges) for (const d of cfg.options.design) for (const lg of cfg.options.languages) for (const dl of cfg.options.deadline) {
      const answers = s.kind === 'web' ? WEB : s.kind === 'store' ? { productos: 2, carga_productos: 1 } : { objetivo: 'x' };
      const features = cfg.features.filter((f) => f.compat[s.id] === 'available').map((f) => f.id).filter((_, i) => i % 2);
      const r = calc({ serviceId: s.id, pageRange: range?.id, design: d.id, languages: lg.id, deadline: dl.id, answers, features });
      assert.equal(r.ok, true, r.errors.join());
      assert.equal(r.total, sum(r));
      n++;
    }
  }
  assert.ok(n > 100);
});

test('migración: un catálogo anterior conserva precios y ediciones', () => {
  const old = structuredClone(cat);
  delete old.schema; delete old.questions; delete old.settings.page_ranges;
  old.features = old.features.filter((f) => f.id <= 12).map(({ category, ...f }) => f);
  old.services = old.services.map(({ kind, benefits, ...s }) => s);
  old.services[1].base_price = 85000; // edición del administrador
  old.features[0].price = 7000;
  const m = migrateCatalog(old);
  assert.equal(m.schema, CATALOG_SCHEMA);
  assert.equal(m.services[1].base_price, 85000);
  assert.equal(m.features[0].price, 7000);
  assert.equal(m.services[3].kind, 'store');
  assert.ok(m.questions.length > 10);
  assert.ok(m.features.some((f) => f.name === 'Billeteras digitales' && f.price === null));
});
