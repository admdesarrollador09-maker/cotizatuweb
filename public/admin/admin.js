import { formatPEN } from '/js/pricing.js';
import { STATUSES, CHANNELS, BUDGETS, DOMAIN, DESIRED, labelOf } from '/js/formOptions.js';
import { esc, ICON_NAMES, icon } from '/js/icons.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const STATUS = Object.fromEntries(STATUSES);
const GROUP_TITLE = { design: 'Tipo de diseño', languages: 'Idiomas', content: 'Contenido', deadline: 'Plazo de entrega' };
const PRICE_TYPE = { fixed: 'Monto fijo', per_page: 'Monto por página', percent_base: '% del precio base', percent: '% de recargo' };
const REC_STATUS = { incluido: 'Incluido', opcional: 'Opcional', separado: 'Se cotiza por separado' };
const KIND_LABEL = { base: 'Precio base', pages: 'Páginas', design: 'Diseño', languages: 'Idiomas', content: 'Contenido', feature: 'Funcionalidad', item: 'Otro concepto', surcharge: 'Recargo', discount: 'Descuento' };

const state = { view: 'quotes', catalog: null, quoteFilter: { status: '', q: '' } };

// ---------- API ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'X-Requested-With': 'CotizaTuWeb', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.endsWith('/login')) { showLogin(); throw new Error(data.error || 'Sesión expirada.'); }
  if (!res.ok) throw new Error(data.error || 'No se pudo completar la operación.');
  return data;
}

const soles = (cents) => (Number(cents || 0) / 100).toFixed(2);
const cents = (v) => Math.round(Number(String(v).replace(/,/g, '')) * 100);
const dmy = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const limaDT = (utc) => {
  const d = new Date(utc.replace(' ', 'T') + 'Z');
  return d.toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

function notify(text, kind = 'ok') {
  const el = $('#alert');
  el.className = `status ${kind}`;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(notify.t);
  notify.t = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 7000 : 3500);
}

// ---------- Formularios en ventana modal ----------
// Campo: { name, label, type: text|textarea|money|number|percent|select|checkbox|date, options:[[v,l]], help, value, wide }
function fieldHtml(f) {
  const id = `m-${f.name}`;
  const v = f.value ?? '';
  const help = f.help ? `<small class="help">${esc(f.help)}</small>` : '';
  if (f.type === 'checkbox') return `<label class="check ${f.wide ? 'field-wide' : ''}"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}><span>${esc(f.label)}</span></label>`;
  if (f.type === 'html') return `<div class="field-wide">${f.html}</div>`;
  let input;
  if (f.type === 'textarea') input = `<textarea id="${id}" name="${f.name}" rows="${f.rows || 3}">${esc(v)}</textarea>`;
  else if (f.type === 'select') input = `<select id="${id}" name="${f.name}">${f.options.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else if (f.type === 'money') input = `<div class="affix"><span>S/</span><input id="${id}" name="${f.name}" inputmode="decimal" value="${esc(soles(v))}"></div>`;
  else if (f.type === 'percent') input = `<div class="affix affix-r"><input id="${id}" name="${f.name}" inputmode="decimal" value="${esc(v)}"><span>%</span></div>`;
  else input = `<input id="${id}" name="${f.name}" type="${f.type === 'number' ? 'text' : f.type || 'text'}" ${f.type === 'number' ? 'inputmode="decimal"' : ''} value="${esc(v)}">`;
  return `<label class="field ${f.wide ? 'field-wide' : ''}" for="${id}"><span>${esc(f.label)}</span>${input}${help}</label>`;
}

function readFields(fields, form) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'html') continue;
    const el = form.elements[f.name];
    if (f.type === 'checkbox') out[f.name] = el.checked;
    else if (f.type === 'money') out[f.name] = cents(el.value);
    else if (f.type === 'number' || f.type === 'percent') out[f.name] = el.value === '' ? '' : Number(String(el.value).replace(',', '.'));
    else out[f.name] = el.value;
  }
  return out;
}

/** Abre un formulario modal; onSave recibe los valores y debe lanzar error para mantenerlo abierto. */
function openForm({ title, fields, onSave, okText = 'Guardar', extraRead }) {
  const dlg = $('#modal');
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = `<div class="fields">${fields.map(fieldHtml).join('')}</div>`;
  $('#modal-ok').textContent = okText;
  const err = $('#modal-error'); err.hidden = true;
  const form = $('#modal-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const values = { ...readFields(fields, form), ...(extraRead ? extraRead(form) : {}) };
    $('#modal-ok').disabled = true;
    try { await onSave(values); dlg.close(); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { $('#modal-ok').disabled = false; }
  };
  dlg.showModal();
  form.querySelector('input, select, textarea')?.focus();
}
$('#modal-x').onclick = $('#modal-cancel').onclick = () => $('#modal').close();

// ---------- Sesión ----------
function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-form [name=username]').focus();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const err = $('#login-error');
  err.hidden = true;
  try {
    const d = await api('/api/admin/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
    f.password.value = '';
    startApp(d.username);
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});

$('#logout').addEventListener('click', async () => { try { await api('/api/admin/logout', { method: 'POST' }); } catch {} showLogin(); });

function startApp(username) {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#who').textContent = username;
  show(state.view);
}

$('#nav').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) show(b.dataset.view); });

async function loadCatalog() { state.catalog = await api('/api/admin/catalog'); return state.catalog; }

async function show(view) {
  state.view = view;
  for (const b of $$('#nav [data-view]')) b.classList.toggle('on', b.dataset.view === view);
  $('#view').innerHTML = '<p class="muted">Cargando…</p>';
  try {
    if (view === 'quotes') await viewQuotes();
    else {
      await loadCatalog();
      ({ services: viewServices, features: viewFeatures, pricing: viewPricing, recurring: viewRecurring, settings: viewSettings })[view]();
    }
  } catch (ex) { $('#view').innerHTML = `<p class="status error">${esc(ex.message)}</p>`; }
}

function warnings() {
  const s = state.catalog?.settings;
  if (!s) return '';
  const w = [];
  if (!s.whatsapp_number) w.push('Aún no configuras el número de WhatsApp: los botones de WhatsApp están ocultos en la web.');
  if (!s.contact_email) w.push('Agrega un correo de contacto para mostrarlo en la web y en el PDF.');
  return w.length ? `<div class="status warn">${w.map(esc).join('<br>')} <button class="link" data-goto="settings">Ir a Configuración</button></div>` : '';
}
document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) show(g.dataset.goto); });

// ---------- Cotizaciones ----------
async function viewQuotes() {
  if (!state.catalog) await loadCatalog();
  const { status, q } = state.quoteFilter;
  const d = await api(`/api/admin/quotes?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
  const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
  $('#view').innerHTML = `
    ${warnings()}
    <div class="vhead"><h1>Cotizaciones</h1>
      <form class="search" id="qsearch"><input name="q" placeholder="Buscar por número, cliente o correo" value="${esc(q)}"><button class="btn btn-ghost btn-sm">Buscar</button></form></div>
    <div class="filters" role="tablist">
      <button class="fchip ${!status ? 'on' : ''}" data-st="">Todas <b>${total}</b></button>
      ${STATUSES.map(([k, l]) => `<button class="fchip ${status === k ? 'on' : ''}" data-st="${k}">${l} <b>${d.counts[k] || 0}</b></button>`).join('')}
    </div>
    ${d.quotes.length ? `<div class="table-wrap"><table class="tbl">
      <thead><tr><th>N.º</th><th>Fecha</th><th>Cliente</th><th>Proyecto</th><th class="num">Total</th><th>Estado</th><th>Seguimiento</th></tr></thead>
      <tbody>${d.quotes.map((x) => `<tr data-id="${x.id}" tabindex="0">
        <td><b>${esc(x.number)}</b>${x.adjusted ? ' <span class="pill pill-v">Ajustada</span>' : ''}</td>
        <td>${esc(limaDT(x.created_at))}</td>
        <td>${esc(x.client_name)}<small>${esc(x.client_company || x.client_email)}</small></td>
        <td>${esc(x.service_name)}<small>${esc(x.channels.split(',').map((c) => CHANNELS[c]).join(', '))}</small></td>
        <td class="num"><b>${formatPEN(x.total)}</b></td>
        <td><span class="pill st-${x.status}">${esc(STATUS[x.status] || x.status)}</span></td>
        <td>${x.follow_up_date ? esc(dmy(x.follow_up_date)) : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty"><p>${q || status ? 'No hay cotizaciones con ese filtro.' : 'Aún no recibes cotizaciones. Cuando un cliente use el cotizador, aparecerán aquí.'}</p></div>`}`;
  $('#qsearch').onsubmit = (e) => { e.preventDefault(); state.quoteFilter.q = e.target.q.value.trim(); viewQuotes(); };
  for (const b of $$('.fchip')) b.onclick = () => { state.quoteFilter.status = b.dataset.st; viewQuotes(); };
  for (const tr of $$('tbody tr[data-id]')) {
    tr.onclick = () => viewQuote(Number(tr.dataset.id));
    tr.onkeydown = (e) => { if (e.key === 'Enter') viewQuote(Number(tr.dataset.id)); };
  }
}

async function viewQuote(id) {
  const d = await api(`/api/admin/quotes/${id}`);
  const { quote: q, client: c, lines, history } = d;
  const chars = q.characteristics || [];
  const included = q.included || [];
  const tot = [['Subtotal de desarrollo', q.subtotal]];
  for (const l of lines.filter((x) => x.kind === 'surcharge' || x.kind === 'discount')) tot.push([l.concept, l.amount]);
  if (q.tax_mode === 'added') tot.push([`${q.tax_label} (${q.tax_rate} %)`, q.tax]);
  const waClient = `https://wa.me/${c.whatsapp.length === 9 ? '51' + c.whatsapp : c.whatsapp}`;

  $('#view').innerHTML = `
    <button class="link back" id="back">Volver a cotizaciones</button>
    <div class="vhead"><h1>${esc(q.number)} ${q.adjusted ? '<span class="pill pill-v">Ajustada manualmente</span>' : ''}</h1>
      <div class="actions">
        <a class="btn btn-ghost btn-sm" href="/api/admin/quotes/${q.id}/pdf" target="_blank" rel="noopener">${icon('file')}Ver PDF</a>
        <a class="btn btn-primary btn-sm" href="/api/admin/quotes/${q.id}/pdf?download=1">${icon('download')}Descargar PDF</a>
      </div></div>
    <div class="qgrid">
      <div class="col">
        <section class="card"><h2>Cliente</h2>
          <dl class="dl">
            <dt>Nombre</dt><dd>${esc(c.name)}</dd>
            <dt>Empresa</dt><dd>${esc(c.company || '—')}</dd>
            <dt>Correo</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd>
            <dt>WhatsApp</dt><dd><a href="${esc(waClient)}" target="_blank" rel="noopener">${esc(c.whatsapp)}</a></dd>
            <dt>Dominio propio</dt><dd>${esc(labelOf(DOMAIN, q.has_domain) || '—')}</dd>
            <dt>Presupuesto</dt><dd>${esc(labelOf(BUDGETS, q.budget))}</dd>
            <dt>Plazo deseado</dt><dd>${esc(labelOf(DESIRED, q.desired_deadline))}</dd>
            <dt>Canal</dt><dd>${esc(q.channels.map((x) => CHANNELS[x]).join(', '))}</dd>
            <dt>Consentimiento</dt><dd>${esc(limaDT(q.consent_at))}</dd>
          </dl>
          <h3>Descripción del proyecto</h3><p class="pre">${esc(q.description)}</p>
        </section>

        <section class="card"><div class="card-head"><h2>Detalle del presupuesto</h2><button class="btn btn-ghost btn-sm" id="adjust">Ajustar propuesta</button></div>
          <p class="muted small">${esc(q.service_name)}. ${chars.map((x) => `${esc(x.label)}: ${esc(x.value)}`).join(' · ')}</p>
          <div class="table-wrap"><table class="tbl tbl-lines"><thead><tr><th>Concepto</th><th class="num">Cant.</th><th class="num">P. unit.</th><th class="num">Importe</th></tr></thead>
          <tbody>${lines.filter((l) => l.kind !== 'surcharge' && l.kind !== 'discount').map((l) => `<tr><td>${esc(l.concept)}<small>${esc(l.detail)}</small></td><td class="num">${l.qty}</td><td class="num">${formatPEN(l.unit_price)}</td><td class="num"><b>${formatPEN(l.amount)}</b></td></tr>`).join('')}</tbody></table></div>
          <ul class="totals">${tot.map(([k, v]) => `<li><span>${esc(k)}</span><b>${formatPEN(v)}</b></li>`).join('')}<li class="grand"><span>Total</span><b>${formatPEN(q.total)}</b></li></ul>
          ${included.length ? `<p class="small muted">Incluido sin costo: ${esc(included.map((f) => f.name).join(', '))}.</p>` : ''}
          <p class="small muted">Importes guardados con las tarifas vigentes al emitir la cotización (versión de tarifas ${q.pricing_version}). Los cambios de precios posteriores no la modifican.</p>
        </section>
      </div>

      <div class="col">
        <section class="card"><h2>Seguimiento</h2>
          <form id="qform" class="fields one">
            <label class="field"><span>Estado</span><select name="status">${STATUSES.map(([k, l]) => `<option value="${k}" ${q.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field"><span>Fecha de seguimiento</span><input type="date" name="follow_up_date" value="${esc(q.follow_up_date || '')}"></label>
            <label class="field"><span>Plazo estimado (días hábiles)</span><input name="days" inputmode="numeric" value="${q.days}"></label>
            <label class="field"><span>Vigencia de la oferta</span><input type="date" name="valid_until" value="${esc(q.valid_until)}"></label>
            <label class="field"><span>Observaciones internas</span><textarea name="internal_notes" rows="4" placeholder="Solo las ves tú.">${esc(q.internal_notes)}</textarea></label>
            <button class="btn btn-primary">Guardar cambios</button>
          </form>
        </section>
        <section class="card"><h2>Historial</h2>
          <ol class="history">${history.map((h) => `<li><span class="h-at">${esc(limaDT(h.at))} · ${esc(h.actor)}</span>${esc(h.note || h.action)}</li>`).join('')}</ol>
        </section>
      </div>
    </div>`;
  $('#back').onclick = () => show('quotes');
  $('#qform').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api(`/api/admin/quotes/${q.id}`, { method: 'PATCH', body: {
        status: f.status.value, follow_up_date: f.follow_up_date.value || null, days: Number(f.days.value),
        valid_until: f.valid_until.value, internal_notes: f.internal_notes.value,
      } });
      notify('Cambios guardados.');
      viewQuote(q.id);
    } catch (ex) { notify(ex.message, 'error'); }
  };
  $('#adjust').onclick = () => adjustDialog(q, lines);
}

function adjustDialog(q, lines) {
  const row = (l = { kind: 'item', concept: '', detail: '', qty: 1, unit_price: 0 }) => `<tr>
    <td><select name="kind">${Object.entries(KIND_LABEL).map(([k, v]) => `<option value="${k}" ${l.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
    <td><input name="concept" value="${esc(l.concept)}" aria-label="Concepto"><input name="detail" value="${esc(l.detail)}" placeholder="Detalle (opcional)" aria-label="Detalle" class="sub"></td>
    <td><input name="qty" value="${l.qty}" inputmode="numeric" class="w-s" aria-label="Cantidad"></td>
    <td><div class="affix"><span>S/</span><input name="unit_price" value="${soles(Math.abs(l.unit_price))}" inputmode="decimal" aria-label="Precio unitario"></div></td>
    <td><button type="button" class="icon-btn" data-del aria-label="Quitar">${icon('trash')}</button></td></tr>`;
  openForm({
    title: `Ajustar ${q.number}`,
    okText: 'Guardar ajuste',
    fields: [
      { type: 'html', html: `<p class="small muted">Edita los conceptos de esta cotización. Los descuentos se restan automáticamente. Las tarifas generales no cambian.</p>
        <div class="table-wrap"><table class="tbl tbl-edit"><thead><tr><th>Tipo</th><th>Concepto</th><th>Cant.</th><th>P. unitario</th><th></th></tr></thead>
        <tbody id="adj-rows">${lines.map(row).join('')}</tbody></table></div>
        <button type="button" class="btn btn-ghost btn-sm" id="adj-add">${icon('plus')}Agregar concepto</button>` },
      { name: 'note', label: 'Motivo del ajuste', type: 'textarea', rows: 2, wide: true },
    ],
    extraRead: () => ({
      lines: $$('#adj-rows tr').map((tr) => ({
        kind: tr.querySelector('[name=kind]').value, concept: tr.querySelector('[name=concept]').value, detail: tr.querySelector('[name=detail]').value,
        qty: Number(tr.querySelector('[name=qty]').value), unit_price: cents(tr.querySelector('[name=unit_price]').value),
      })),
    }),
    onSave: async (v) => {
      await api(`/api/admin/quotes/${q.id}/lines`, { method: 'PUT', body: { lines: v.lines, note: v.note } });
      notify('Propuesta ajustada. El PDF ya refleja los nuevos importes.');
      viewQuote(q.id);
    },
  });
  $('#modal').classList.add('wide');
  $('#modal').addEventListener('close', () => $('#modal').classList.remove('wide'), { once: true });
  $('#adj-add').onclick = () => $('#adj-rows').insertAdjacentHTML('beforeend', row());
  $('#adj-rows').onclick = (e) => { if (e.target.closest('[data-del]')) e.target.closest('tr').remove(); };
}

// ---------- Servicios ----------
function viewServices() {
  const { services } = state.catalog;
  $('#view').innerHTML = `
    <div class="vhead"><h1>Servicios</h1><button class="btn btn-primary btn-sm" id="add">${icon('plus')}Nuevo servicio</button></div>
    <p class="muted">Tipos de proyecto que el cliente puede elegir en el paso 1. Cada uno define cuántas páginas incluye su precio base.</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Servicio</th><th class="num">Precio base</th><th class="num">Páginas incluidas</th><th class="num">Días base</th><th>Estado</th><th></th></tr></thead>
    <tbody>${services.map((s) => `<tr><td><span class="ti">${icon(s.icon)}<b>${esc(s.name)}</b></span><small>${esc(s.description)}</small></td>
      <td class="num"><b>${formatPEN(s.base_price)}</b></td><td class="num">${s.included_pages}</td><td class="num">${s.base_days}</td>
      <td>${s.active ? '<span class="pill st-aceptada">Activo</span>' : '<span class="pill">Inactivo</span>'}</td>
      <td><button class="btn btn-ghost btn-sm" data-edit="${s.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`;
  const form = (s = { icon: 'globe', active: 1, base_price: 0, included_pages: 1, base_days: 10, sort: services.length + 1 }) => openForm({
    title: s.id ? `Editar: ${s.name}` : 'Nuevo servicio',
    fields: [
      { name: 'name', label: 'Nombre', value: s.name, wide: true },
      { name: 'description', label: 'Descripción breve', type: 'textarea', value: s.description, wide: true, rows: 2 },
      { name: 'base_price', label: 'Precio base', type: 'money', value: s.base_price },
      { name: 'included_pages', label: 'Páginas incluidas en el precio base', type: 'number', value: s.included_pages },
      { name: 'base_days', label: 'Días hábiles base', type: 'number', value: s.base_days, help: 'Se usa para calcular el plazo estimado.' },
      { name: 'icon', label: 'Icono', type: 'select', options: ICON_NAMES.map((i) => [i, i]), value: s.icon },
      { name: 'sort', label: 'Orden', type: 'number', value: s.sort },
      { name: 'active', label: 'Visible en el cotizador', type: 'checkbox', value: s.active },
    ],
    onSave: async (v) => {
      await api(s.id ? `/api/admin/services/${s.id}` : '/api/admin/services', { method: s.id ? 'PUT' : 'POST', body: v });
      notify('Servicio guardado. Se aplica a las nuevas cotizaciones.');
      show('services');
    },
  });
  $('#add').onclick = () => form();
  for (const b of $$('[data-edit]')) b.onclick = () => form(services.find((s) => s.id === Number(b.dataset.edit)));
}

// ---------- Funcionalidades ----------
function viewFeatures() {
  const { features, services } = state.catalog;
  const modeTxt = { included: 'Incluida', available: 'Disponible' };
  $('#view').innerHTML = `
    <div class="vhead"><h1>Funcionalidades</h1><button class="btn btn-primary btn-sm" id="add">${icon('plus')}Nueva funcionalidad</button></div>
    <p class="muted">Para cada servicio indica si la funcionalidad está incluida (no se cobra), disponible (se cobra su precio) o no disponible.</p>
    <div class="table-wrap"><table class="tbl tbl-matrix"><thead><tr><th>Funcionalidad</th><th class="num">Precio</th>${services.map((s) => `<th class="c" title="${esc(s.name)}">${esc(s.name.replace('Página web para ', '').replace('Página web ', '').replace('Aplicación web ', 'App '))}</th>`).join('')}<th></th></tr></thead>
    <tbody>${features.map((f) => `<tr class="${f.active ? '' : 'off'}"><td><b>${esc(f.name)}</b><small>${esc(f.description)}</small></td><td class="num">${formatPEN(f.price)}</td>
      ${services.map((s) => `<td class="c"><span class="m m-${f.compat[s.id] || 'none'}">${modeTxt[f.compat[s.id]] || '—'}</span></td>`).join('')}
      <td><button class="btn btn-ghost btn-sm" data-edit="${f.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`;
  const form = (f = { price: 0, days: 0, active: 1, compat: {}, sort: features.length + 1 }) => openForm({
    title: f.id ? `Editar: ${f.name}` : 'Nueva funcionalidad',
    fields: [
      { name: 'name', label: 'Nombre', value: f.name, wide: true },
      { name: 'description', label: 'Descripción', type: 'textarea', rows: 2, value: f.description, wide: true },
      { name: 'price', label: 'Precio adicional', type: 'money', value: f.price },
      { name: 'days', label: 'Días hábiles adicionales', type: 'number', value: f.days },
      { name: 'sort', label: 'Orden', type: 'number', value: f.sort },
      { name: 'active', label: 'Visible en el cotizador', type: 'checkbox', value: f.active },
      { type: 'html', html: `<h3 class="sub-h">Compatibilidad por servicio</h3><div class="compat">${services.map((s) => `
        <label class="field"><span>${esc(s.name)}</span><select name="compat-${s.id}">
          <option value="">No disponible</option><option value="available" ${f.compat[s.id] === 'available' ? 'selected' : ''}>Disponible (se cobra)</option>
          <option value="included" ${f.compat[s.id] === 'included' ? 'selected' : ''}>Incluida en el paquete</option></select></label>`).join('')}</div>` },
    ],
    extraRead: (form) => ({ compat: Object.fromEntries(services.map((s) => [s.id, form.elements[`compat-${s.id}`].value]).filter(([, m]) => m)) }),
    onSave: async (v) => {
      await api(f.id ? `/api/admin/features/${f.id}` : '/api/admin/features', { method: f.id ? 'PUT' : 'POST', body: v });
      notify('Funcionalidad guardada.');
      show('features');
    },
  });
  $('#add').onclick = () => form();
  for (const b of $$('[data-edit]')) b.onclick = () => form(features.find((x) => x.id === Number(b.dataset.edit)));
}

// ---------- Precios y reglas ----------
function optAmount(o) {
  return o.price_type === 'fixed' ? formatPEN(o.amount) : o.price_type === 'per_page' ? `${formatPEN(o.amount)} / página` : `${o.amount} %`;
}

function viewPricing() {
  const { options, discounts, settings: s } = state.catalog;
  $('#view').innerHTML = `
    <div class="vhead"><h1>Precios y reglas</h1></div>
    <section class="card"><h2>Reglas generales</h2>
      <form id="rules" class="fields">
        ${fieldHtml({ name: 'extra_page_price', label: 'Precio por página adicional', type: 'money', value: s.extra_page_price })}
        ${fieldHtml({ name: 'extra_page_days', label: 'Días adicionales por página', type: 'number', value: s.extra_page_days })}
        ${fieldHtml({ name: 'page_options', label: 'Opciones de cantidad de páginas', value: s.page_options, help: 'Números separados por comas. La última se muestra como “o más”.' })}
        ${fieldHtml({ name: 'surcharge_base', label: 'Base para calcular recargos por plazo', type: 'select', value: s.surcharge_base, options: [['subtotal', 'Subtotal de desarrollo (base + extras)'], ['base', 'Solo el precio base del proyecto']] })}
        ${fieldHtml({ name: 'tax_mode', label: 'Impuestos', type: 'select', value: s.tax_mode, options: [['none', 'No se muestran (precios sin impuesto)'], ['added', 'Se suman al total'], ['included', 'Ya están incluidos en los precios']] })}
        ${fieldHtml({ name: 'tax_rate', label: 'Tasa del impuesto', type: 'percent', value: s.tax_rate })}
        ${fieldHtml({ name: 'tax_label', label: 'Nombre del impuesto', value: s.tax_label })}
        ${fieldHtml({ name: 'rates_valid_from', label: 'Tarifas vigentes desde', type: 'date', value: s.rates_valid_from })}
        ${fieldHtml({ name: 'rates_valid_to', label: 'Tarifas vigentes hasta', type: 'date', value: s.rates_valid_to, help: 'Opcional. Se muestra al pie de la web.' })}
        <div class="field-wide"><button class="btn btn-primary">Guardar reglas</button></div>
      </form>
    </section>

    <section class="card"><h2>Opciones de características</h2>
      <p class="muted small">Precios de diseño, idiomas, contenido y plazo de entrega (paso 2 del cotizador).</p>
      ${Object.keys(GROUP_TITLE).map((g) => `<h3 class="sub-h">${GROUP_TITLE[g]} <button class="link" data-addopt="${g}">Agregar opción</button></h3>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Opción</th><th>Tipo de precio</th><th class="num">Importe</th><th class="num">Días</th><th class="num">Factor plazo</th><th></th></tr></thead><tbody>
      ${options.filter((o) => o.grp === g).map((o) => `<tr class="${o.active ? '' : 'off'}"><td><b>${esc(o.label)}</b>${o.is_default ? ' <span class="pill">Por defecto</span>' : ''}<small>${esc(o.description)}</small></td>
        <td>${PRICE_TYPE[o.price_type]}</td><td class="num"><b>${optAmount(o)}</b></td><td class="num">${o.days}</td><td class="num">× ${o.days_factor}</td>
        <td><button class="btn btn-ghost btn-sm" data-opt="${o.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`).join('')}
    </section>

    <section class="card"><div class="card-head"><h2>Descuentos</h2><button class="btn btn-primary btn-sm" id="add-disc">${icon('plus')}Nuevo descuento</button></div>
      <p class="muted small">Sin código: se aplica solo cuando se cumplen las condiciones. Con código: el cliente lo escribe en el resumen. Si hay varios, se aplica el mayor (no se acumulan).</p>
      ${discounts.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Descuento</th><th>Código</th><th class="num">Valor</th><th class="num">Subtotal mín.</th><th>Vigencia</th><th>Estado</th><th></th></tr></thead><tbody>
      ${discounts.map((d) => `<tr><td><b>${esc(d.name)}</b></td><td>${d.code ? `<code>${esc(d.code)}</code>` : '<span class="muted">Automático</span>'}</td>
        <td class="num">${d.type === 'percent' ? `${d.value} %` : formatPEN(d.value)}</td><td class="num">${d.min_subtotal ? formatPEN(d.min_subtotal) : '—'}</td>
        <td>${d.valid_from || d.valid_to ? `${dmy(d.valid_from)} – ${dmy(d.valid_to)}` : 'Sin límite'}</td>
        <td>${d.active ? '<span class="pill st-aceptada">Activo</span>' : '<span class="pill">Inactivo</span>'}</td>
        <td class="row-actions"><button class="btn btn-ghost btn-sm" data-disc="${d.id}">Editar</button><button class="icon-btn" data-deldisc="${d.id}" aria-label="Eliminar ${esc(d.name)}">${icon('trash')}</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No hay descuentos.</p>'}
    </section>`;

  $('#rules').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/api/admin/settings', { method: 'PUT', body: {
        extra_page_price: cents(f.extra_page_price.value), extra_page_days: Number(f.extra_page_days.value), page_options: f.page_options.value,
        surcharge_base: f.surcharge_base.value, tax_mode: f.tax_mode.value, tax_rate: Number(f.tax_rate.value), tax_label: f.tax_label.value,
        rates_valid_from: f.rates_valid_from.value, rates_valid_to: f.rates_valid_to.value,
      } });
      notify('Reglas guardadas. Se aplican a las nuevas cotizaciones.');
      show('pricing');
    } catch (ex) { notify(ex.message, 'error'); }
  };

  const optForm = (o) => {
    const types = o.grp === 'deadline' ? [['percent', PRICE_TYPE.percent], ['fixed', PRICE_TYPE.fixed]] : [['fixed', PRICE_TYPE.fixed], ['per_page', PRICE_TYPE.per_page], ['percent_base', PRICE_TYPE.percent_base]];
    const isMoney = (t) => t === 'fixed' || t === 'per_page';
    openForm({
      title: o.id ? `Editar: ${o.label}` : `Nueva opción: ${GROUP_TITLE[o.grp]}`,
      fields: [
        { name: 'label', label: 'Nombre', value: o.label, wide: true },
        { name: 'description', label: 'Descripción', type: 'textarea', rows: 2, value: o.description, wide: true },
        { name: 'price_type', label: 'Tipo de precio', type: 'select', options: types, value: o.price_type },
        { name: 'amount', label: 'Importe (S/ o %, según el tipo)', type: 'number', value: isMoney(o.price_type) ? soles(o.amount) : o.amount, help: 'Para montos escribe soles (ej. 400). Para porcentajes, el número (ej. 20).' },
        { name: 'days', label: 'Días hábiles adicionales', type: 'number', value: o.days },
        { name: 'days_factor', label: 'Multiplicador del plazo', type: 'number', value: o.days_factor, help: 'Ej.: 0.6 reduce el plazo al 60 %; 1.3 lo amplía.' },
        { name: 'sort', label: 'Orden', type: 'number', value: o.sort },
        { name: 'is_default', label: 'Opción seleccionada por defecto', type: 'checkbox', value: o.is_default },
        { name: 'active', label: 'Visible en el cotizador', type: 'checkbox', value: o.active },
      ],
      onSave: async (v) => {
        const amount = isMoney(v.price_type) ? Math.round(Number(v.amount) * 100) : Number(v.amount);
        await api(o.id ? `/api/admin/options/${o.id}` : '/api/admin/options', { method: o.id ? 'PUT' : 'POST', body: { ...v, amount, grp: o.grp } });
        notify('Opción guardada.');
        show('pricing');
      },
    });
  };
  for (const b of $$('[data-opt]')) b.onclick = () => optForm(options.find((o) => o.id === Number(b.dataset.opt)));
  for (const b of $$('[data-addopt]')) b.onclick = () => optForm({ grp: b.dataset.addopt, price_type: b.dataset.addopt === 'deadline' ? 'percent' : 'fixed', amount: 0, days: 0, days_factor: 1, active: 1, sort: 99 });

  const discForm = (d = { type: 'percent', value: 10, min_subtotal: 0, active: 1 }) => openForm({
    title: d.id ? `Editar: ${d.name}` : 'Nuevo descuento',
    fields: [
      { name: 'name', label: 'Nombre', value: d.name, wide: true },
      { name: 'code', label: 'Código (vacío = automático)', value: d.code || '' },
      { name: 'type', label: 'Tipo', type: 'select', options: [['percent', 'Porcentaje'], ['fixed', 'Monto fijo']], value: d.type },
      { name: 'value', label: 'Valor (% o S/)', type: 'number', value: d.type === 'fixed' ? soles(d.value) : d.value },
      { name: 'min_subtotal', label: 'Subtotal mínimo', type: 'money', value: d.min_subtotal },
      { name: 'valid_from', label: 'Válido desde', type: 'date', value: d.valid_from || '' },
      { name: 'valid_to', label: 'Válido hasta', type: 'date', value: d.valid_to || '' },
      { name: 'active', label: 'Activo', type: 'checkbox', value: d.active },
    ],
    onSave: async (v) => {
      const value = v.type === 'fixed' ? Math.round(Number(v.value) * 100) : Number(v.value);
      await api(d.id ? `/api/admin/discounts/${d.id}` : '/api/admin/discounts', { method: d.id ? 'PUT' : 'POST', body: { ...v, value } });
      notify('Descuento guardado.');
      show('pricing');
    },
  });
  $('#add-disc').onclick = () => discForm();
  for (const b of $$('[data-disc]')) b.onclick = () => discForm(discounts.find((d) => d.id === Number(b.dataset.disc)));
  for (const b of $$('[data-deldisc]')) b.onclick = async () => {
    const d = discounts.find((x) => x.id === Number(b.dataset.deldisc));
    if (!confirm(`¿Eliminar el descuento "${d.name}"? Las cotizaciones ya emitidas no cambian.`)) return;
    try { await api(`/api/admin/discounts/${d.id}`, { method: 'DELETE' }); notify('Descuento eliminado.'); show('pricing'); }
    catch (ex) { notify(ex.message, 'error'); }
  };
}

// ---------- Costos aparte ----------
function viewRecurring() {
  const { recurring } = state.catalog;
  $('#view').innerHTML = `
    <div class="vhead"><h1>Costos aparte</h1><button class="btn btn-primary btn-sm" id="add">${icon('plus')}Agregar</button></div>
    <p class="muted">Servicios que pueden generar pagos adicionales o recurrentes. Se muestran separados del precio de desarrollo en la web y en el PDF; nunca se suman al total.</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Servicio</th><th>Condición</th><th>Referencia</th><th>Estado</th><th></th></tr></thead><tbody>
    ${recurring.map((r) => `<tr class="${r.active ? '' : 'off'}"><td><b>${esc(r.name)}</b><small>${esc(r.description)}</small></td><td>${REC_STATUS[r.status]}</td><td>${esc(r.reference)}</td>
      <td>${r.active ? '<span class="pill st-aceptada">Visible</span>' : '<span class="pill">Oculto</span>'}</td><td><button class="btn btn-ghost btn-sm" data-edit="${r.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`;
  const form = (r = { status: 'separado', active: 1, sort: recurring.length + 1 }) => openForm({
    title: r.id ? `Editar: ${r.name}` : 'Nuevo costo aparte',
    fields: [
      { name: 'name', label: 'Nombre', value: r.name, wide: true },
      { name: 'description', label: 'Descripción', type: 'textarea', rows: 2, value: r.description, wide: true },
      { name: 'status', label: 'Condición', type: 'select', options: Object.entries(REC_STATUS), value: r.status },
      { name: 'reference', label: 'Referencia de precio o nota', value: r.reference, help: 'Ej.: “Pago anual al proveedor”.' },
      { name: 'sort', label: 'Orden', type: 'number', value: r.sort },
      { name: 'active', label: 'Visible', type: 'checkbox', value: r.active },
    ],
    onSave: async (v) => {
      await api(r.id ? `/api/admin/recurring/${r.id}` : '/api/admin/recurring', { method: r.id ? 'PUT' : 'POST', body: v });
      notify('Guardado.');
      show('recurring');
    },
  });
  $('#add').onclick = () => form();
  for (const b of $$('[data-edit]')) b.onclick = () => form(recurring.find((x) => x.id === Number(b.dataset.edit)));
}

// ---------- Configuración ----------
function viewSettings() {
  const { settings: s, changeLog } = state.catalog;
  $('#view').innerHTML = `
    <div class="vhead"><h1>Configuración</h1></div>
    <section class="card"><h2>Datos comerciales</h2>
      <form id="biz" class="fields">
        ${fieldHtml({ name: 'business_name', label: 'Nombre comercial', value: s.business_name })}
        ${fieldHtml({ name: 'company_name', label: 'Empresa', value: s.company_name })}
        ${fieldHtml({ name: 'whatsapp_number', label: 'WhatsApp comercial', value: s.whatsapp_number, help: 'Con código de país y sin espacios. Ej.: 51987654321. Vacío oculta los botones de WhatsApp.' })}
        ${fieldHtml({ name: 'contact_email', label: 'Correo de contacto', value: s.contact_email })}
        ${fieldHtml({ name: 'quote_validity_days', label: 'Vigencia de cada cotización (días)', type: 'number', value: s.quote_validity_days })}
        ${fieldHtml({ name: 'conditions', label: 'Condiciones comerciales (una por línea; aparecen en el PDF)', type: 'textarea', rows: 6, value: s.conditions, wide: true })}
        <div class="field-wide"><button class="btn btn-primary">Guardar datos</button></div>
      </form>
    </section>
    <section class="card"><h2>Cambiar contraseña</h2>
      <form id="pw" class="fields">
        <label class="field"><span>Contraseña actual</span><input type="password" name="current" autocomplete="current-password"></label>
        <label class="field"><span>Nueva contraseña</span><input type="password" name="next" autocomplete="new-password"><small class="help">Mínimo 10 caracteres, con letras y números.</small></label>
        <div class="field-wide"><button class="btn btn-ghost">Cambiar contraseña</button></div>
      </form>
    </section>
    <section class="card"><h2>Copia de seguridad</h2>
      <p class="muted small">Descarga en un archivo todas las tarifas, la configuración y las cotizaciones. Guárdalo en un lugar seguro de vez en cuando.</p>
      <a class="btn btn-ghost btn-sm" href="/api/admin/export">${icon('download')}Descargar respaldo</a>
    </section>
    <section class="card"><h2>Historial de cambios de tarifas</h2>
      ${changeLog.length ? `<ol class="history">${changeLog.map((h) => `<li><span class="h-at">${esc(limaDT(h.at))} · ${esc(h.actor)}</span>${esc(h.summary)}</li>`).join('')}</ol>` : '<p class="muted">Sin cambios todavía.</p>'}
    </section>`;
  $('#biz').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/api/admin/settings', { method: 'PUT', body: {
        business_name: f.business_name.value, company_name: f.company_name.value, whatsapp_number: f.whatsapp_number.value,
        contact_email: f.contact_email.value, quote_validity_days: Number(f.quote_validity_days.value), conditions: f.conditions.value,
      } });
      notify('Datos guardados.');
      show('settings');
    } catch (ex) { notify(ex.message, 'error'); }
  };
  $('#pw').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/api/admin/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
      f.reset();
      notify('Contraseña actualizada.');
    } catch (ex) { notify(ex.message, 'error'); }
  };
}

// ---------- Inicio ----------
(async () => {
  try { const me = await api('/api/admin/me'); startApp(me.username); }
  catch { showLogin(); }
})();
