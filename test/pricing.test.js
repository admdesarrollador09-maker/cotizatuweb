// Pruebas del motor de cálculo con la configuración inicial de la base de datos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDb, buildConfig } from '../src/db.js';
import { computeQuote, formatPEN } from '../public/js/pricing.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctw-'));
const db = openDb(path.join(dir, 'test.db'));
const cfg = buildConfig(db);
const opt = (grp, label) => cfg.options[grp].find((o) => o.label === label).id;
const feat = (name) => cfg.features.find((f) => f.name === name).id;
const sum = (r) => r.lines.reduce((s, l) => s + l.amount, 0) + r.surchargeTotal - r.discountTotal + (r.taxMode === 'added' ? r.tax : 0);

test('formato monetario peruano', () => {
  assert.equal(formatPEN(120000), 'S/ 1,200.00');
  assert.equal(formatPEN(5), 'S/ 0.05');
  assert.equal(formatPEN(123456789), 'S/ 1,234,567.89');
});

test('criterio 1: cinco servicios con los precios base oficiales', () => {
  assert.deepEqual(cfg.services.map((s) => [s.name, s.basePrice]), [
    ['Página web para emprendedores', 50000], ['Página web para negocios', 80000], ['Página web profesional', 120000],
    ['Tienda virtual', 150000], ['Aplicación web personalizada', 250000],
  ]);
});

test('solo el precio base cuando no se elige nada adicional', () => {
  for (const s of cfg.services) {
    const r = computeQuote(cfg, { serviceId: s.id, pages: s.includedPages });
    assert.equal(r.total, s.basePrice, s.name);
    assert.equal(r.lines.length, 1);
  }
});

test('criterio 3: páginas adicionales solo por encima de las incluidas en cada paquete', () => {
  // Negocios incluye 3 páginas → 8 páginas = 5 adicionales × S/ 60
  const r = computeQuote(cfg, { serviceId: 2, pages: 8 });
  const l = r.lines.find((x) => x.kind === 'pages');
  assert.equal(l.qty, 5);
  assert.equal(l.amount, 30000);
  // Profesional incluye 5 → 5 páginas no cobra
  assert.equal(computeQuote(cfg, { serviceId: 3, pages: 5 }).lines.some((x) => x.kind === 'pages'), false);
  // Emprendedores incluye 1 → 3 páginas = 2 adicionales
  assert.equal(computeQuote(cfg, { serviceId: 1, pages: 3 }).lines.find((x) => x.kind === 'pages').qty, 2);
  // Elegir menos páginas que las incluidas no genera saldo negativo
  assert.equal(computeQuote(cfg, { serviceId: 3, pages: 1 }).total, 120000);
});

test('criterio 4: funcionalidades incluidas no se cobran dos veces', () => {
  const wa = feat('Botón de WhatsApp');
  const r = computeQuote(cfg, { serviceId: 2, pages: 3, features: [wa] });
  assert.equal(r.total, 80000);
  assert.ok(r.included.some((f) => f.id === wa));
  const r2 = computeQuote(cfg, { serviceId: 1, pages: 1, features: [wa] });
  assert.equal(r2.total, 55000);
});

test('funcionalidades incompatibles se rechazan', () => {
  const r = computeQuote(cfg, { serviceId: 1, pages: 1, features: [feat('Carrito de compras')] });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Carrito de compras/);
  assert.equal(r.total, 50000);
});

test('recargo por urgencia como línea independiente sobre la base configurada', () => {
  const sel = { serviceId: 2, pages: 8, design: opt('design', 'Diseño personalizado'), deadline: opt('deadline', 'Urgente'), features: [feat('Blog o noticias')] };
  const r = computeQuote(cfg, sel);
  assert.equal(r.subtotal, 80000 + 30000 + 40000 + 35000);
  assert.equal(r.surcharges.length, 1);
  assert.equal(r.surcharges[0].amount, 37000);
  assert.equal(r.total, 222000);
  const base = computeQuote({ ...cfg, rules: { ...cfg.rules, surchargeBase: 'base' } }, sel);
  assert.equal(base.surcharges[0].amount, 16000);
});

test('idiomas y contenido según su tipo de precio', () => {
  const r = computeQuote(cfg, { serviceId: 1, pages: 3, languages: opt('languages', 'Dos idiomas'), content: opt('content', 'Apoyo en la redacción de textos') });
  assert.equal(r.lines.find((l) => l.kind === 'languages').amount, 15000); // 30 % de S/ 500
  assert.equal(r.lines.find((l) => l.kind === 'content').amount, 12000); // 3 páginas × S/ 40
});

test('criterio 5: el total coincide con la suma de conceptos en todas las combinaciones', () => {
  let n = 0;
  for (const s of cfg.services) for (const pages of cfg.pageOptions) for (const d of cfg.options.design) for (const lg of cfg.options.languages)
    for (const c of cfg.options.content) for (const dl of cfg.options.deadline) {
      const features = cfg.features.filter((f) => f.compat[s.id] === 'available').map((f) => f.id).filter((_, i) => (i + pages) % 2);
      const r = computeQuote(cfg, { serviceId: s.id, pages, design: d.id, languages: lg.id, content: c.id, deadline: dl.id, features });
      assert.equal(r.ok, true);
      assert.equal(r.total, sum(r));
      assert.ok(r.days >= 1);
      n++;
    }
  assert.ok(n > 1000);
});

test('descuentos: se aplica el mayor y respeta mínimos y fechas', () => {
  const c = { ...cfg, discounts: [
    { id: 1, name: 'Auto 5', type: 'percent', value: 5, minSubtotal: 0, active: true },
    { id: 2, name: 'Fijo', type: 'fixed', value: 10000, minSubtotal: 200000, active: true },
    { id: 3, name: 'Vencido', type: 'percent', value: 50, minSubtotal: 0, active: true, validTo: '2020-01-01' },
  ] };
  const small = computeQuote(c, { serviceId: 1, pages: 1 }, { today: '2026-10-14' });
  assert.equal(small.discount.amount, -2500);
  assert.equal(small.total, 47500);
  const big = computeQuote(c, { serviceId: 5, pages: 3 }, { today: '2026-10-14' });
  assert.equal(big.discount.amount, -12500); // 5 % de 2,500 = 125 > fijo 100
  const code = computeQuote(c, { serviceId: 5, pages: 3 }, { today: '2026-10-14', codeDiscount: { id: 9, name: 'VIP', type: 'percent', value: 10, active: true, requiresCode: true } });
  assert.equal(code.total, 225000);
});

test('impuestos sumados o incluidos', () => {
  const added = computeQuote({ ...cfg, rules: { ...cfg.rules, taxMode: 'added', taxRate: 18 } }, { serviceId: 3, pages: 5 });
  assert.equal(added.tax, 21600);
  assert.equal(added.total, 141600);
  const inc = computeQuote({ ...cfg, rules: { ...cfg.rules, taxMode: 'included', taxRate: 18 } }, { serviceId: 3, pages: 5 });
  assert.equal(inc.total, 120000);
  assert.equal(inc.tax, 120000 - Math.round(120000 / 1.18));
});
