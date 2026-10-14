import { computeQuote, formatPEN, pagesLabel, featureMode, pickOption, GROUPS } from './pricing.js';
import { BUDGETS, DOMAIN, DESIRED, validateClient } from './formOptions.js';
import { icon, esc } from './icons.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  config: null, business: null, recurring: [],
  sel: { serviceId: null, pages: null, design: null, languages: null, content: null, deadline: null, features: new Set() },
  pagesTouched: false,
  step: 1, maxStep: 1,
  codeDiscount: null, discountCode: '',
  lastToken: null,
  busy: false,
};

const STEPS = ['Proyecto', 'Características', 'Funcionalidades', 'Tus datos'];
const STATUS_TEXT = { incluido: 'Incluido', opcional: 'Opcional', separado: 'Se cotiza aparte' };

// ---------- Utilidades ----------
function hydrateIcons(root = document) {
  for (const el of $$('[data-icon]', root)) { el.outerHTML = icon(el.dataset.icon); }
}

function waLink(text) {
  const n = state.business?.whatsapp;
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}

function selection() {
  return { ...state.sel, features: [...state.sel.features] };
}

function current() {
  if (!state.config || !state.sel.serviceId) return null;
  return computeQuote(state.config, selection(), { codeDiscount: state.codeDiscount });
}

function priceHint(opt, service) {
  const a = Number(opt.amount || 0);
  if (opt.priceType === 'fixed') return a > 0 ? `+ ${formatPEN(a)}` : 'Sin costo adicional';
  if (opt.priceType === 'per_page') return a > 0 ? `+ ${formatPEN(a)} por página` : 'Sin costo adicional';
  if (opt.priceType === 'percent_base') {
    if (!a) return 'Sin costo adicional';
    return service ? `+ ${formatPEN(Math.round(service.basePrice * a / 100))} (${a} % del precio base)` : `+ ${a} % del precio base`;
  }
  if (opt.priceType === 'percent') return a > 0 ? `Recargo de ${a} %` : 'Sin recargo';
  return '';
}

// ---------- Paso 1: servicios ----------
function renderServices() {
  const box = $('#services');
  box.innerHTML = state.config.services.map((s) => `
    <button type="button" class="service" role="radio" aria-checked="${state.sel.serviceId === s.id}" data-id="${s.id}">
      <span class="service-ico">${icon(s.icon)}</span>
      <span class="service-name">${esc(s.name)}</span>
      <span class="service-desc">${esc(s.description)}</span>
      <span class="service-foot">
        <span class="service-price">${formatPEN(s.basePrice)}</span>
        <span class="service-pages">Incluye ${pagesLabel(s.includedPages, Infinity)}</span>
      </span>
      <span class="service-pick" aria-hidden="true">${state.sel.serviceId === s.id ? icon('check') + 'Seleccionado' : 'Elegir'}</span>
    </button>`).join('');
}

function chooseService(id) {
  const s = state.config.services.find((x) => x.id === id);
  if (!s) return;
  state.sel.serviceId = id;
  if (!state.pagesTouched || !state.config.pageOptions.includes(state.sel.pages)) {
    state.sel.pages = state.config.pageOptions.find((p) => p >= s.includedPages) ?? state.config.pageOptions.at(-1);
  }
  // Quita funcionalidades que dejan de estar disponibles o pasan a estar incluidas.
  for (const fid of [...state.sel.features]) {
    const f = state.config.features.find((x) => x.id === fid);
    if (!f || featureMode(f, id) !== 'available') state.sel.features.delete(fid);
  }
  renderAll();
}

// ---------- Paso 2: características ----------
function renderConfig() {
  const service = state.config.services.find((s) => s.id === state.sel.serviceId);
  const { pageOptions, rules } = state.config;
  const max = Math.max(...pageOptions);
  $('#pages-help').textContent = service
    ? `${service.name} incluye ${pagesLabel(service.includedPages, Infinity)}. Cada página adicional cuesta ${formatPEN(rules.extraPagePrice)}.`
    : 'Primero elige un tipo de proyecto.';

  const pagesHtml = pageOptions.map((p) => {
    const extra = service ? Math.max(0, p - service.includedPages) : 0;
    const hint = !service ? '' : extra ? `+ ${formatPEN(extra * rules.extraPagePrice)}` : 'Incluido';
    return `<label class="chip"><input type="radio" name="pages" value="${p}" ${state.sel.pages === p ? 'checked' : ''}>
      <span><strong>${pagesLabel(p, max)}</strong><small>${hint}</small></span></label>`;
  }).join('');

  const groups = GROUPS.map((g) => {
    const opts = state.config.options[g.key];
    if (!opts.length) return '';
    const chosen = pickOption(state.config, g.key, state.sel[g.key]);
    return `<div class="cfg-group" role="radiogroup" aria-labelledby="g-${g.key}">
      <h4 id="g-${g.key}">${g.title}</h4>
      <div class="opts">${opts.map((o) => `
        <label class="opt"><input type="radio" name="${g.key}" value="${o.id}" ${chosen && chosen.id === o.id ? 'checked' : ''}>
          <span class="opt-body"><strong>${esc(o.label)}</strong><span>${esc(o.description)}</span><em>${esc(priceHint(o, service))}</em></span>
        </label>`).join('')}</div></div>`;
  }).join('');

  $('#config').innerHTML = `<div class="cfg-group" role="radiogroup" aria-labelledby="g-pages"><h4 id="g-pages">Cantidad de páginas</h4><div class="chips">${pagesHtml}</div></div>${groups}`;
}

// ---------- Paso 3: funcionalidades ----------
function renderFeatures() {
  const sid = state.sel.serviceId;
  const names = Object.fromEntries(state.config.services.map((s) => [s.id, s.name]));
  $('#features').innerHTML = state.config.features.map((f) => {
    const mode = sid ? featureMode(f, sid) : 'available';
    const checked = mode === 'included' || state.sel.features.has(f.id);
    const where = Object.keys(f.compat).map((k) => names[k]).filter(Boolean);
    const tag = mode === 'included' ? '<span class="tag tag-in">Incluido en tu paquete</span>'
      : mode === 'available' ? `<span class="tag">${f.price > 0 ? '+ ' + formatPEN(f.price) : 'Sin costo'}</span>`
      : '<span class="tag tag-off">No disponible</span>';
    const reason = mode === null && sid
      ? `<span class="feat-why">${icon('info')}${where.length ? `Disponible en: ${esc(where.join(', '))}.` : 'No disponible por ahora.'}</span>` : '';
    return `<label class="feat ${mode === 'included' ? 'is-in' : ''} ${mode === null && sid ? 'is-off' : ''}">
      <input type="checkbox" value="${f.id}" ${checked ? 'checked' : ''} ${mode !== 'available' ? 'disabled' : ''}>
      <span class="feat-box" aria-hidden="true">${icon('check')}</span>
      <span class="feat-body"><span class="feat-top"><strong>${esc(f.name)}</strong>${tag}</span><span class="feat-desc">${esc(f.description)}</span>${reason}</span>
    </label>`;
  }).join('');
}

// ---------- Resumen ----------
function renderSummary() {
  const r = current();
  const body = $('#summary-body');
  if (!r || !r.service) {
    body.innerHTML = '<p class="muted">Elige un tipo de proyecto para ver el precio.</p>';
    $('#mbar-total').textContent = formatPEN(0);
    return;
  }
  const extras = r.lines.filter((l) => l.kind !== 'base' && l.kind !== 'feature');
  const feats = r.lines.filter((l) => l.kind === 'feature');
  const notIncluded = state.recurring.filter((x) => x.status !== 'incluido');
  const row = (label, value, cls = '') => `<li class="${cls}"><span>${esc(label)}</span><b>${value}</b></li>`;
  body.innerHTML = `
    <div class="sum-service"><span>${esc(r.service.name)}</span><b>${formatPEN(r.service.basePrice)}</b></div>
    <ul class="sum-chars">${r.characteristics.map((c) => `<li><span>${esc(c.label)}</span><span>${esc(c.value)}</span></li>`).join('')}</ul>
    ${extras.length ? `<h5>Características con costo</h5><ul class="sum-lines">${extras.map((l) => row(l.concept, formatPEN(l.amount))).join('')}</ul>` : ''}
    <h5>Funcionalidades adicionales</h5>
    ${feats.length ? `<ul class="sum-lines">${feats.map((l) => row(l.concept, formatPEN(l.amount))).join('')}</ul>` : '<p class="muted small">Ninguna seleccionada.</p>'}
    ${r.included.length ? `<p class="sum-included">${icon('check')}<span>Incluido sin costo: ${esc(r.included.map((f) => f.name).join(', '))}.</span></p>` : ''}
    <ul class="sum-lines sum-totals">
      ${row('Subtotal de desarrollo', formatPEN(r.subtotal))}
      ${r.surcharges.map((s) => row(s.concept, formatPEN(s.amount), 'is-sur')).join('')}
      ${r.discount ? row(r.discount.concept, formatPEN(r.discount.amount), 'is-disc') : ''}
      ${r.taxMode === 'added' ? row(`${r.taxLabel} (${r.taxRate} %)`, formatPEN(r.tax)) : ''}
    </ul>
    <div class="sum-total"><span>Total estimado</span><strong>${formatPEN(r.total)}</strong></div>
    <p class="sum-note">${r.taxMode === 'none' ? `No incluye ${esc(r.taxLabel)}.` : r.taxMode === 'included' ? `Incluye ${esc(r.taxLabel)} (${formatPEN(r.tax)}).` : ''} Plazo estimado: <b>${r.days} días hábiles</b>.</p>
    ${notIncluded.length ? `<details class="sum-excl"><summary>No incluye (${notIncluded.length})</summary><ul>${notIncluded.map((x) => `<li>${esc(x.name)} <small>${STATUS_TEXT[x.status]}</small></li>`).join('')}</ul></details>` : ''}
  `;
  $('#mbar-total').textContent = formatPEN(r.total);

  const msg = $('#discount-msg');
  if (state.codeDiscount) {
    const applied = r.discount && r.discount.discountId === state.codeDiscount.id;
    msg.className = applied ? 'ok' : 'warn';
    msg.textContent = applied ? `Código ${state.discountCode} aplicado.`
      : state.codeDiscount.minSubtotal > r.subtotal ? `El código aplica desde ${formatPEN(state.codeDiscount.minSubtotal)} de subtotal.`
      : 'Ya se aplica un descuento mayor.';
  }
}

// ---------- Ejemplo de la portada (calculado con las tarifas reales) ----------
function renderSample() {
  const cfg = state.config;
  const s = cfg.services[1] || cfg.services[0];
  if (!s) return;
  const feats = cfg.features.filter((f) => featureMode(f, s.id) === 'available' && f.price > 0).slice(0, 1).map((f) => f.id);
  const pages = cfg.pageOptions.find((p) => p > s.includedPages) ?? s.includedPages;
  const r = computeQuote(cfg, { serviceId: s.id, pages, features: feats });
  $('#sample-service').textContent = r.service.name;
  $('#sample-lines').innerHTML = [
    ...r.lines.map((l) => `<li><span>${esc(l.kind === 'base' ? 'Precio base' : l.concept)}${l.qty > 1 ? ` <small>× ${l.qty}</small>` : ''}</span><b>${formatPEN(l.amount)}</b></li>`),
    ...r.included.slice(0, 3).map((f) => `<li class="inc"><span>${esc(f.name)}</span><b>Incluido</b></li>`),
  ].join('');
  $('#sample-total').textContent = formatPEN(r.total);
  $('#sample-note').textContent = `Ejemplo calculado con las tarifas vigentes. Plazo estimado: ${r.days} días hábiles.`;
}

// ---------- Pasos ----------
function renderStepper() {
  $('#stepper').innerHTML = STEPS.map((t, i) => {
    const n = i + 1;
    const can = n === 1 || !!state.sel.serviceId;
    return `<li><button type="button" data-go="${n}" ${can ? '' : 'disabled'} ${state.step === n ? 'aria-current="step"' : ''} class="${n < state.step ? 'done' : ''}">
      <span class="num">${n < state.step ? icon('check') : n}</span><span class="lbl">${t}</span></button></li>`;
  }).join('');
}

function goTo(n, focus = true) {
  if (n > 1 && !state.sel.serviceId) { flash('Primero elige un tipo de proyecto.'); n = 1; }
  state.step = Math.min(4, Math.max(1, n));
  for (const fs of $$('.step')) fs.hidden = Number(fs.dataset.step) !== state.step;
  $('#prev').hidden = state.step === 1;
  $('#next').hidden = state.step === 4;
  $('#next').textContent = state.step === 3 ? 'Continuar con mis datos' : 'Siguiente';
  renderStepper();
  if (focus) {
    const top = $('#quoter-title').getBoundingClientRect().top + window.scrollY - 80;
    if (window.scrollY > top) window.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    $(`.step[data-step="${state.step}"] legend`).setAttribute('tabindex', '-1');
    $(`.step[data-step="${state.step}"] legend`).focus({ preventScroll: true });
  }
}

function flash(text, kind = 'warn') {
  const el = $('#status');
  if (state.step !== 4) {
    const note = document.createElement('p');
    note.className = `toast ${kind}`;
    note.textContent = text;
    note.setAttribute('role', 'alert');
    $(`.step[data-step="${state.step}"]`).prepend(note);
    setTimeout(() => note.remove(), 3500);
    return;
  }
  el.className = `status ${kind}`;
  el.textContent = text;
}

function renderAll() {
  renderServices();
  renderConfig();
  renderFeatures();
  renderSummary();
  renderStepper();
}

// ---------- Paso 4: envío ----------
function readClient() {
  const f = $('#quote-form');
  return {
    name: f.name.value.trim(), company: f.company.value.trim(), email: f.email.value.trim(), whatsapp: f.whatsapp.value.trim(),
    hasDomain: f.hasDomain.value, budget: f.budget.value, desiredDeadline: f.desiredDeadline.value,
    description: f.description.value.trim(), consent: f.consent.checked,
  };
}

function showErrors(errors) {
  for (const el of $$('[data-err]')) {
    const msg = errors[el.dataset.err] || '';
    el.textContent = msg;
    const input = $(`#quote-form [name="${el.dataset.err}"]`);
    if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  const first = Object.keys(errors)[0];
  if (first) $(`#quote-form [name="${first}"]`)?.focus();
}

function setBusy(b) {
  state.busy = b;
  for (const btn of $$('[data-action]')) btn.disabled = b;
}

async function submit(channel) {
  if (state.busy) return;
  if (!state.sel.serviceId) { goTo(1); return; }
  const client = readClient();
  const errors = validateClient(client);
  showErrors(errors);
  if (Object.keys(errors).length) { flash('Revisa los campos marcados para continuar.'); return; }
  const r = current();
  if (!r.ok) { flash(r.errors.join(' ')); return; }

  // La ventana de WhatsApp se abre antes de la petición para que el navegador no la bloquee.
  let waWin = null;
  if (channel === 'whatsapp') {
    if (!state.business.whatsapp) { flash('WhatsApp no está disponible en este momento.'); return; }
    waWin = window.open('', '_blank');
  }

  setBusy(true);
  flash(channel === 'pdf' ? 'Generando tu cotización…' : 'Registrando tu solicitud…', 'info');
  try {
    const res = await fetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel, consent: client.consent, selection: selection(), discountCode: state.codeDiscount ? state.discountCode : '',
        client, website: $('#quote-form').website.value, previousToken: state.lastToken,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (waWin) waWin.close();
      if (data.fields) showErrors(data.fields);
      flash(data.error || 'No pudimos registrar tu solicitud. Inténtalo de nuevo.', 'error');
      return;
    }
    state.lastToken = data.token;
    const diff = data.total !== r.total ? ` El total confirmado es ${formatPEN(data.total)} (las tarifas se actualizaron).` : '';
    if (channel === 'pdf') {
      const a = document.createElement('a');
      a.href = `${data.pdfUrl}?download=1`;
      a.download = `Cotizacion-${data.number}.pdf`;
      document.body.append(a); a.click(); a.remove();
      flash(`Cotización ${data.number} lista. La descarga del PDF empezó; también puedes abrirlo aquí: `, 'ok');
      const link = document.createElement('a');
      link.href = data.pdfUrl; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'ver PDF';
      $('#status').append(link, document.createTextNode('.' + diff));
    } else if (channel === 'whatsapp') {
      const url = waLink(data.whatsappText);
      if (waWin) waWin.location.href = url; else window.location.href = url;
      flash(`Cotización ${data.number} registrada. Se abrió WhatsApp con el resumen listo para enviar.${diff}`, 'ok');
    } else {
      flash(`Recibimos tu solicitud ${data.number}. Te contactaremos por WhatsApp o correo para afinar la propuesta.${diff}`, 'ok');
    }
  } catch {
    if (waWin) waWin.close();
    flash('No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.', 'error');
  } finally {
    setBusy(false);
  }
}

// ---------- Descuentos ----------
async function applyCode() {
  const input = $('#discount-code');
  const code = input.value.trim().toUpperCase();
  const msg = $('#discount-msg');
  if (!code) { state.codeDiscount = null; state.discountCode = ''; msg.textContent = ''; renderSummary(); return; }
  msg.className = ''; msg.textContent = 'Verificando…';
  try {
    const res = await fetch('/api/discounts/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { state.codeDiscount = null; state.discountCode = ''; msg.className = 'warn'; msg.textContent = data.error || 'Código no válido.'; renderSummary(); return; }
    state.codeDiscount = data.discount; state.discountCode = code;
    renderSummary();
  } catch { msg.className = 'warn'; msg.textContent = 'No pudimos verificar el código.'; }
}

// ---------- Inicio ----------
function fillSelect(sel, list) {
  sel.innerHTML = list.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
}

function bind() {
  $('#services').addEventListener('click', (e) => {
    const b = e.target.closest('.service');
    if (b) chooseService(Number(b.dataset.id));
  });
  $('#services').addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
    const items = $$('.service'); const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    items[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  });
  $('#config').addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'pages') { state.sel.pages = Number(t.value); state.pagesTouched = true; }
    else if (GROUPS.some((g) => g.key === t.name)) state.sel[t.name] = Number(t.value);
    renderConfig(); renderSummary();
    $(`#config input[name="${t.name}"][value="${t.value}"]`)?.focus();
  });
  $('#features').addEventListener('change', (e) => {
    const id = Number(e.target.value);
    if (e.target.checked) state.sel.features.add(id); else state.sel.features.delete(id);
    renderSummary();
  });
  $('#stepper').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) goTo(Number(b.dataset.go)); });
  $('#next').addEventListener('click', () => goTo(state.step + 1));
  $('#prev').addEventListener('click', () => goTo(state.step - 1));
  $('#quote-form').addEventListener('submit', (e) => e.preventDefault());
  for (const b of $$('[data-action]')) b.addEventListener('click', () => submit(b.dataset.action));
  $('#discount-apply').addEventListener('click', applyCode);
  $('#discount-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCode(); } });

  // Limpia el error de un campo cuando se corrige.
  $('#quote-form').addEventListener('input', (e) => {
    const err = $(`[data-err="${e.target.name}"]`);
    if (err && err.textContent) { err.textContent = ''; e.target.setAttribute('aria-invalid', 'false'); }
  });

  // Resumen en celulares
  const aside = $('#summary');
  const open = (v) => {
    aside.classList.toggle('open', v);
    document.body.classList.toggle('sheet-open', v);
    $('#mbar-open').setAttribute('aria-expanded', String(v));
    if (v) $('#summary-close').focus();
  };
  $('#mbar-open').addEventListener('click', () => open(true));
  $('#summary-close').addEventListener('click', () => { open(false); $('#mbar-open').focus(); });
  aside.addEventListener('click', (e) => { if (e.target === aside) open(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && aside.classList.contains('open')) open(false); });

  // La barra móvil solo aparece mientras el cotizador está en pantalla.
  const io = new IntersectionObserver(([en]) => $('#mbar').classList.toggle('show', en.isIntersecting), { threshold: 0 });
  io.observe($('#cotizador'));
}

async function init() {
  hydrateIcons();
  $('#summary-close').innerHTML = icon('x');
  fillSelect($('#f-domain'), [['', 'Selecciona una opción'], ...DOMAIN]);
  fillSelect($('#f-budget'), BUDGETS);
  fillSelect($('#f-desired'), DESIRED);
  bind();
  goTo(1, false);
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error();
    const data = await res.json();
    state.config = data.config; state.business = data.business; state.recurring = data.recurring;
  } catch {
    $('#services').innerHTML = '<p class="toast error">No pudimos cargar las tarifas. Recarga la página en unos segundos.</p>';
    $('#sample-service').textContent = 'Tarifas no disponibles';
    return;
  }

  const b = state.business;
  const wa = waLink('Hola, quiero información para desarrollar mi página web.');
  for (const el of $$('[data-wa]')) { if (wa) { el.href = wa; el.hidden = false; } }
  $('[data-action="whatsapp"]').hidden = !b.whatsapp;
  if (b.email) { const e = $('#footer-email'); e.href = `mailto:${b.email}`; e.textContent = b.email; e.hidden = false; }
  if (b.companyName) $('#footer-company').textContent = `Un servicio de ${b.companyName}.`;
  if (b.ratesValidFrom || b.ratesValidTo) {
    const d = (x) => x.split('-').reverse().join('/');
    $('#rates-note').textContent = `Tarifas vigentes${b.ratesValidFrom ? ` desde el ${d(b.ratesValidFrom)}` : ''}${b.ratesValidTo ? ` hasta el ${d(b.ratesValidTo)}` : ''}. Precios en soles.`;
  }

  $('#costs').innerHTML = state.recurring.map((x) => `
    <div class="cost cost-${x.status}"><div class="cost-top"><strong>${esc(x.name)}</strong><span class="tag">${STATUS_TEXT[x.status]}</span></div>
    <p>${esc(x.description)}</p><small>${esc(x.reference)}</small></div>`).join('');

  renderSample();
  renderAll();
}

init();
