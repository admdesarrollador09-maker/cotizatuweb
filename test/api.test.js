// Pruebas de la API: seguridad, validaciones y conservación de importes emitidos.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3400 + Math.floor(Math.random() * 500);
const URL_ = `http://127.0.0.1:${PORT}`;
let proc;
let cookie = '';

const client = { name: 'Ana Pérez', company: 'Café Ñandú', email: 'ana@cafe.pe', whatsapp: '987654321', hasDomain: 'no', description: 'Web para mi cafetería en Miraflores' };

async function req(p, { method = 'GET', body, admin = false, headers = {} } = {}) {
  const res = await fetch(URL_ + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(admin ? { 'X-Requested-With': 'CotizaTuWeb', Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctw-api-'));
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ADMIN_USER: 'admin', ADMIN_PASSWORD: 'Prueba12345' }, stdio: 'pipe',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(URL_ + '/api/config'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('El servidor no inició');
});
after(() => proc.kill());

test('la configuración pública no expone códigos de descuento', async () => {
  const r = await req('/api/config');
  assert.equal(r.status, 200);
  assert.equal(r.data.config.services.length, 5);
  assert.ok(!JSON.stringify(r.data).includes('BIENVENIDA'));
});

test('criterio 12: el servidor ignora precios enviados desde el navegador', async () => {
  const r = await req('/api/quotes', { method: 'POST', body: {
    channel: 'pdf', consent: true, client, total: 1, price: 1,
    selection: { serviceId: 3, pages: 5, basePrice: 100, features: [] },
  } });
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 120000);
  assert.match(r.data.number, /^CTW-\d{4}-\d{4}$/);
});

test('criterio 6: datos obligatorios y formato de correo se validan en el servidor', async () => {
  const r = await req('/api/quotes', { method: 'POST', body: { channel: 'pdf', consent: false, client: { ...client, email: 'malo@', name: '' }, selection: { serviceId: 1, pages: 1 } } });
  assert.equal(r.status, 422);
  assert.ok(r.data.fields.email && r.data.fields.name && r.data.fields.consent);
});

test('funcionalidad incompatible rechazada', async () => {
  const r = await req('/api/quotes', { method: 'POST', body: { channel: 'pdf', consent: true, client, selection: { serviceId: 1, pages: 1, features: [6] } } });
  assert.equal(r.status, 422);
});

test('criterio 8: el PDF se genera con el número y el total', async () => {
  const q = await req('/api/quotes', { method: 'POST', body: { channel: 'propuesta', consent: true, client: { ...client, email: 'pdf@x.pe' }, selection: { serviceId: 2, pages: 8, features: [4] } } });
  const pdf = await req(q.data.pdfUrl + '?download=1');
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition'), /attachment/);
  assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-');
  const bad = await req('/api/quotes/tokeninventado1234567890/pdf');
  assert.equal(bad.status, 404);
});

test('criterio 9: mensaje de WhatsApp con el resumen', async () => {
  const q = await req('/api/quotes', { method: 'POST', body: { channel: 'whatsapp', consent: true, client: { ...client, email: 'wa@x.pe' }, selection: { serviceId: 4, pages: 5, features: [7] } } });
  assert.match(q.data.whatsappText, /Tienda virtual/);
  assert.match(q.data.whatsappText, /S\/ 2,000\.00/);
  assert.match(q.data.whatsappText, /Pasarela de pagos/);
});

test('misma solicitud repetida reutiliza la cotización', async () => {
  const body = { channel: 'pdf', consent: true, client: { ...client, email: 'dup@x.pe' }, selection: { serviceId: 1, pages: 1 } };
  const a = await req('/api/quotes', { method: 'POST', body });
  const b = await req('/api/quotes', { method: 'POST', body: { ...body, channel: 'whatsapp', previousToken: a.data.token } });
  assert.equal(a.data.number, b.data.number);
  assert.equal(b.data.reused, true);
});

test('el panel exige sesión y protección CSRF', async () => {
  assert.equal((await req('/api/admin/quotes')).status, 401);
  const noHeader = await req('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'Prueba12345' } });
  assert.equal(noHeader.status, 403);
  const wrong = await req('/api/admin/login', { method: 'POST', admin: true, body: { username: 'admin', password: 'incorrecta' } });
  assert.equal(wrong.status, 401);
  const ok = await req('/api/admin/login', { method: 'POST', admin: true, body: { username: 'admin', password: 'Prueba12345' } });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
});

test('criterios 10 y 11: cambiar precios afecta solo a cotizaciones futuras', async () => {
  const old = await req('/api/quotes', { method: 'POST', body: { channel: 'pdf', consent: true, client: { ...client, email: 'old@x.pe' }, selection: { serviceId: 5, pages: 3 } } });
  assert.equal(old.data.total, 250000);
  const cat = await req('/api/admin/catalog', { admin: true });
  const s = cat.data.services.find((x) => x.id === 5);
  const up = await req('/api/admin/services/5', { method: 'PUT', admin: true, body: { ...s, base_price: 280000 } });
  assert.equal(up.status, 200);
  const list = await req('/api/admin/quotes', { admin: true });
  const stored = list.data.quotes.find((q) => q.number === old.data.number);
  assert.equal(stored.total, 250000);
  const fresh = await req('/api/quotes', { method: 'POST', body: { channel: 'pdf', consent: true, client: { ...client, email: 'new@x.pe' }, selection: { serviceId: 5, pages: 3 } } });
  assert.equal(fresh.data.total, 280000);
  // Restaurar
  await req('/api/admin/services/5', { method: 'PUT', admin: true, body: { ...s } });
});

test('ajuste manual recalcula totales y queda en el historial', async () => {
  const list = await req('/api/admin/quotes', { admin: true });
  const id = list.data.quotes[0].id;
  const r = await req(`/api/admin/quotes/${id}/lines`, { method: 'PUT', admin: true, body: { note: 'prueba', lines: [
    { kind: 'base', concept: 'Proyecto', qty: 1, unit_price: 100000 },
    { kind: 'item', concept: 'Hora extra', qty: 3, unit_price: 5000 },
    { kind: 'discount', concept: 'Descuento', qty: 1, unit_price: 10000 },
  ] } });
  assert.equal(r.status, 200);
  const d = await req(`/api/admin/quotes/${id}`, { admin: true });
  assert.equal(d.data.quote.total, 105000);
  assert.equal(d.data.quote.adjusted, 1);
  assert.ok(d.data.history.some((h) => h.action === 'ajuste'));
});

test('validación de datos del panel', async () => {
  const bad = await req('/api/admin/settings', { method: 'PUT', admin: true, body: { whatsapp_number: '123' } });
  assert.equal(bad.status, 422);
  const unknown = await req('/api/admin/settings', { method: 'PUT', admin: true, body: { hack: 1 } });
  assert.equal(unknown.status, 422);
  const neg = await req('/api/admin/services/1', { method: 'PUT', admin: true, body: { name: 'X', description: '', icon: 'rocket', base_price: -5, included_pages: 1, base_days: 3, active: true } });
  assert.equal(neg.status, 422);
});

test('cabeceras de seguridad y rutas protegidas', async () => {
  const r = await req('/');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal((await req('/../server.js')).status, 404);
  assert.equal((await req('/%2e%2e/data/catalog.json')).status, 404);
});

test('cotizaciones simultáneas reciben números distintos', async () => {
  const mk = (i) => req('/api/quotes', { method: 'POST', body: { channel: 'pdf', consent: true, client: { ...client, email: `par${i}@x.pe` }, selection: { serviceId: 1, pages: 1 } } });
  const rs = await Promise.all([0, 1, 2, 3, 4, 5].map(mk));
  const nums = rs.map((r) => r.data.number);
  assert.equal(new Set(nums).size, nums.length);
});

test('respaldo completo descargable', async () => {
  const r = await req('/api/admin/export', { admin: true });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /attachment/);
});
