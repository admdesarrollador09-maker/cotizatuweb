// Cotizador guiado de CotizaTuWeb.
// El navegador NO recibe tarifas: solo envía las respuestas y el servidor devuelve el total.
import { formatPEN, GROUPS, FEATURE_CATEGORIES, PERIOD_LABEL, featureMode, questionVisible, serviceUsesPages } from './questions.js';
import { BUDGETS, DOMAIN, DESIRED, validateClient } from './formOptions.js';
import { icon, esc } from './icons.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const STEPS = ['Proyecto', 'Alcance', 'Diseño', 'Funciones', 'Resumen'];
const STATUS_TEXT = { incluido: 'Incluido', opcional: 'Opcional', separado: 'Se cotiza aparte' };

const state = {
  config: null, business: null, recurringInfo: [],
  sel: { serviceId: null, pageRange: null, design: null, languages: null, content: null, deadline: null, answers: {}, features: new Set(), recurring: new Set() },
  step: 1,
  estimate: null, estimateSeq: 0,
  codeOk: false, discountCode: '',
  saved: null, savedKey: null, lastToken: null,
  busy: false,
};

// ---------- Datos derivados ----------
const service = () => state.config?.services.find((s) => s.id === state.sel.serviceId) || null;

function selection() {
  return { ...state.sel, answers: { ...state.sel.answers }, features: [...state.sel.features], recurring: [...state.sel.recurring] };
}
const selKey = () => JSON.stringify([selection(), state.codeOk ? state.discountCode : '']);

const visibleQuestions = (step) => state.config.questions.filter((q) => q.step === step && questionVisible(q, state.sel, state.config));

function defaultRange(s) {
  return state.config.pageRanges.find((r) => r.pages >= s.includedPages) || state.config.pageRanges[0];
}

/** Alcance elegido, en texto (sin precios). */
function scopeList() {
  const s = service();
  if (!s) return [];
  const out = [];
  if (serviceUsesPages(s)) {
    const r = state.config.pageRanges.find((x) => x.id === state.sel.pageRange);
    if (r) out.push(['Páginas', r.label]);
  }
  for (const step of [2, 3]) {
    for (const q of visibleQuestions(step)) {
      if (q.type === 'feature') continue;
      const v = state.sel.answers[q.key];
      if (q.type === 'text') { if (String(v || '').trim()) out.push([q.short, String(v).trim()]); continue; }
      const o = q.options.find((x) => x.id === v);
      if (o) out.push([q.short, o.label]);
    }
    if (step === 3) {
      for (const g of GROUPS) {
        const o = state.config.options[g.key].find((x) => x.id === state.sel[g.key]);
        if (o) out.push([g.title, o.label]);
      }
    }
  }
  return out;
}

function chosenFeatures() {
  const s = service();
  if (!s) return { selected: [], included: [] };
  const selected = []; const included = [];
  for (const f of state.config.features) {
    const m = featureMode(f, s.id);
    if (m === 'included') included.push(f);
    else if (m === 'available' && state.sel.features.has(f.id)) selected.push(f);
  }
  return { selected, included };
}

// ---------- Utilidades ----------
function hydrateIcons(root = document) { for (const el of $$('[data-icon]', root)) el.outerHTML = icon(el.dataset.icon); }
function waLink(text) { const n = state.business?.whatsapp; return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null; }
const dmy = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

function flash(text, kind = 'warn') {
  if (state.step !== 5) {
    const note = document.createElement('p');
    note.className = `toast ${kind}`;
    note.textContent = text;
    note.setAttribute('role', 'alert');
    $(`.step[data-step="${state.step}"]`).prepend(note);
    setTimeout(() => note.remove(), 4000);
    return;
  }
  const el = $('#status');
  el.className = `status ${kind}`;
  el.textContent = text;
}

// ---------- Paso 1 ----------
function renderServices() {
  $('#services').innerHTML = state.config.services.map((s) => {
    const on = state.sel.serviceId === s.id;
    return `<button type="button" class="service" role="radio" aria-checked="${on}" data-id="${s.id}">
      <span class="service-ico">${icon(s.icon)}</span>
      <span class="service-name">${esc(s.name)}</span>
      <span class="service-desc">${esc(s.description)}</span>
      ${s.benefits.length ? `<ul class="service-benefits">${s.benefits.map((b) => `<li>${icon('check')}${esc(b)}</li>`).join('')}</ul>` : ''}
      <span class="service-pick" aria-hidden="true">${on ? icon('check') + 'Seleccionado' : 'Elegir'}</span>
    </button>`;
  }).join('');
}

function chooseService(id) {
  const s = state.config.services.find((x) => x.id === id);
  if (!s) return;
  state.sel.serviceId = id;
  if (serviceUsesPages(s) && !state.config.pageRanges.some((r) => r.id === state.sel.pageRange)) state.sel.pageRange = defaultRange(s)?.id ?? null;
  // Quita funciones que no corresponden al nuevo paquete (las respuestas se conservan).
  for (const fid of [...state.sel.features]) {
    const f = state.config.features.find((x) => x.id === fid);
    if (!f || featureMode(f, id) !== 'available') state.sel.features.delete(fid);
  }
  changed();
}

// ---------- Preguntas ----------
function questionHtml(q) {
  const req = q.required ? ' <span class="req" aria-hidden="true">*</span>' : '';
  const help = q.help ? `<p class="q-help">${esc(q.help)}</p>` : '';
  const err = `<small class="err" data-qerr="${q.key}"></small>`;
  if (q.type === 'text') {
    return `<div class="cfg-group"><label class="q-label" for="q-${q.key}">${esc(q.label)}${req}</label>${help}
      <textarea class="q-text" id="q-${q.key}" data-q="${q.key}" rows="2" maxlength="1000">${esc(state.sel.answers[q.key] || '')}</textarea>${err}</div>`;
  }
  if (q.type === 'feature') {
    const f = state.config.features.find((x) => x.id === q.featureId);
    const included = featureMode(f, state.sel.serviceId) === 'included';
    const on = included || state.sel.features.has(f.id);
    return `<div class="cfg-group" role="radiogroup" aria-labelledby="ql-${q.key}"><p class="q-label" id="ql-${q.key}">${esc(q.label)}</p>${help}
      ${included ? `<p class="included-note">${icon('check')}Ya viene incluido en tu paquete.</p>` : `<div class="chips">
        <label class="chip"><input type="radio" name="qf-${q.key}" data-qf="${f.id}" value="1" ${on ? 'checked' : ''}><span><strong>Sí</strong></span></label>
        <label class="chip"><input type="radio" name="qf-${q.key}" data-qf="${f.id}" value="0" ${!on ? 'checked' : ''}><span><strong>No</strong></span></label></div>`}</div>`;
  }
  const v = state.sel.answers[q.key];
  const compact = q.options.length <= 3 && q.options.every((o) => o.label.length < 14);
  return `<div class="cfg-group" role="radiogroup" aria-labelledby="ql-${q.key}"><p class="q-label" id="ql-${q.key}">${esc(q.label)}${req}</p>${help}
    <div class="${compact ? 'chips' : 'opts opts-sm'}">${q.options.map((o) => compact
      ? `<label class="chip"><input type="radio" name="q-${q.key}" data-q="${q.key}" value="${o.id}" ${v === o.id ? 'checked' : ''}><span><strong>${esc(o.label)}</strong></span></label>`
      : `<label class="opt"><input type="radio" name="q-${q.key}" data-q="${q.key}" value="${o.id}" ${v === o.id ? 'checked' : ''}><span class="opt-body"><strong>${esc(o.label)}</strong></span></label>`).join('')}</div>${err}</div>`;
}

function groupHtml(g) {
  const opts = state.config.options[g.key];
  if (!opts.length) return '';
  const cur = opts.find((o) => o.id === state.sel[g.key]) || opts.find((o) => o.isDefault) || opts[0];
  state.sel[g.key] = cur.id;
  return `<div class="cfg-group" role="radiogroup" aria-labelledby="g-${g.key}"><p class="q-label" id="g-${g.key}">${esc(g.question)}</p>
    <div class="opts">${opts.map((o) => `<label class="opt"><input type="radio" name="g-${g.key}" data-g="${g.key}" value="${o.id}" ${cur.id === o.id ? 'checked' : ''}>
      <span class="opt-body"><strong>${esc(o.label)}</strong><span>${esc(o.description)}</span></span></label>`).join('')}</div></div>`;
}

function renderScope() {
  const s = service();
  if (!s) { $('#scope').innerHTML = ''; return; }
  const titles = { web: ['Tamaño y alcance de tu web', 'Elige cuántas páginas tendrá y qué contenido mostrará.'],
    store: ['Tamaño de tu tienda virtual', 'Cuéntanos sobre tus productos y cómo los vas a gestionar.'],
    app: ['Alcance de tu aplicación', 'Describe qué debe hacer la aplicación. Escribe con tus palabras; no necesitas términos técnicos.'] };
  const [t, h] = titles[s.kind] || titles.web;
  $('#scope-title').textContent = t;
  $('#scope-help').textContent = h;
  let html = '';
  if (serviceUsesPages(s)) {
    html += `<div class="cfg-group" role="radiogroup" aria-labelledby="g-pages"><p class="q-label" id="g-pages">¿Cuántas páginas tendrá tu web? <span class="req" aria-hidden="true">*</span></p>
      <p class="q-help">Una página es una dirección independiente (por ejemplo Inicio, Nosotros o Contacto). Las secciones son bloques dentro de una misma página. Tu paquete incluye ${s.includedPages === 1 ? '1 página' : `${s.includedPages} páginas`}.</p>
      <div class="chips">${state.config.pageRanges.map((r) => `<label class="chip"><input type="radio" name="pages" data-pages value="${r.id}" ${state.sel.pageRange === r.id ? 'checked' : ''}>
        <span><strong>${esc(r.label)}</strong>${r.pages <= s.includedPages ? '<small>Incluido en tu paquete</small>' : ''}</span></label>`).join('')}</div></div>`;
  }
  html += visibleQuestions(2).map(questionHtml).join('');
  $('#scope').innerHTML = html;
}

function renderDesign() {
  if (!service()) { $('#design').innerHTML = ''; return; }
  const qs = visibleQuestions(3);
  const byKey = (k) => qs.filter((q) => q.key === k).map(questionHtml).join('');
  const g = (k) => groupHtml(GROUPS.find((x) => x.key === k));
  const used = new Set(['identidad', 'fotos_propias', 'edicion']);
  $('#design').innerHTML = g('design') + byKey('identidad') + g('content') + byKey('fotos_propias') + byKey('edicion') +
    qs.filter((q) => !used.has(q.key)).map(questionHtml).join('') + g('languages') + g('deadline');
}

// ---------- Paso 4 ----------
function renderFeatures() {
  const s = service();
  if (!s) { $('#features').innerHTML = ''; return; }
  // Las funciones "de tienda" o "de aplicación" se muestran como generales en otros tipos de proyecto.
  const catOf = (f) => { const c = f.category || 'general'; return (c === 'tienda' && s.kind !== 'store') || (c === 'app' && s.kind !== 'app') ? 'general' : c; };
  const html = FEATURE_CATEGORIES.map((cat) => {
    const list = state.config.features.filter((f) => catOf(f) === cat.key && featureMode(f, s.id));
    if (!list.length) return '';
    return `<h4 class="feat-head">${cat.title}</h4><div class="features">${list.map((f) => {
      const inc = featureMode(f, s.id) === 'included';
      const on = inc || state.sel.features.has(f.id);
      return `<label class="feat ${inc ? 'is-in' : ''}"><input type="checkbox" data-f="${f.id}" ${on ? 'checked' : ''} ${inc ? 'disabled' : ''}>
        <span class="feat-box" aria-hidden="true">${icon('check')}</span>
        <span class="feat-body"><span class="feat-top"><strong>${esc(f.name)}</strong>${inc ? '<span class="tag tag-in">Incluido en tu paquete</span>' : ''}</span>
        <span class="feat-desc">${esc(f.description)}</span></span></label>`;
    }).join('')}</div>`;
  }).join('');
  const rec = state.config.recurring;
  const recHtml = rec.length ? `<h4 class="feat-head">Servicios recurrentes <span class="muted small">(se pagan aparte del desarrollo)</span></h4>
    <div class="features">${rec.map((r) => `<label class="feat"><input type="checkbox" data-r="${r.id}" ${state.sel.recurring.has(r.id) ? 'checked' : ''}>
      <span class="feat-box" aria-hidden="true">${icon('check')}</span>
      <span class="feat-body"><span class="feat-top"><strong>${esc(r.name)}</strong><span class="tag">${esc(PERIOD_LABEL[r.period] || r.period)}</span></span>
      <span class="feat-desc">${esc(r.description)}</span></span></label>`).join('')}</div>` : '';
  const langNote = '<p class="q-help">¿Necesitas tu web en varios idiomas? Lo eliges en el paso 3, en la pregunta de idiomas.</p>';
  $('#features').innerHTML = html + recHtml + (s.kind !== 'app' ? langNote : '');
}

// ---------- Resumen lateral (sin precios) ----------
function renderSummary() {
  const s = service();
  const body = $('#summary-body');
  if (!s) { body.innerHTML = '<p class="muted">Elige un tipo de proyecto para empezar.</p>'; $('#mbar-total').textContent = 'Tu proyecto'; return; }
  const scope = scopeList();
  const { selected, included } = chosenFeatures();
  const rec = state.config.recurring.filter((r) => state.sel.recurring.has(r.id));
  const est = state.step === 5 && state.estimate && state.estimate.key === selKey() ? state.estimate : null;
  body.innerHTML = `
    <div class="sum-service"><span>${esc(s.name)}</span></div>
    ${scope.length ? `<ul class="sum-chars">${scope.filter(([, v]) => v.length < 60).map(([k, v]) => `<li><span>${esc(k)}</span><span>${esc(v)}</span></li>`).join('')}</ul>` : ''}
    <h5>Funciones</h5>
    ${selected.length || included.length ? `<ul class="sum-list">${selected.map((f) => `<li>${icon('check')}${esc(f.name)}</li>`).join('')}${included.map((f) => `<li class="inc">${icon('check')}${esc(f.name)} <small>incluido</small></li>`).join('')}</ul>` : '<p class="muted small">Aún no eliges funciones.</p>'}
    ${rec.length ? `<h5>Servicios recurrentes</h5><ul class="sum-list">${rec.map((r) => `<li>${icon('check')}${esc(r.name)} <small>${esc(PERIOD_LABEL[r.period])}</small></li>`).join('')}</ul>` : ''}
    ${est && est.ok ? `<div class="sum-total"><span>Total del desarrollo</span><strong>${formatPEN(est.total)}</strong></div><p class="sum-note">Plazo estimado: <b>${est.days} días hábiles</b>.</p>`
      : `<p class="sum-note">${state.step === 5 ? 'Calculando tu total…' : 'Tu total aparece en el último paso, con todo lo que incluye.'}</p>`}
  `;
  $('#mbar-total').textContent = est && est.ok ? formatPEN(est.total) : s.name;
}

// ---------- Paso 5 ----------
let estimateTimer;
function requestEstimate() {
  clearTimeout(estimateTimer);
  estimateTimer = setTimeout(async () => {
    const key = selKey();
    const seq = ++state.estimateSeq;
    try {
      const res = await fetch('/api/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selection: selection(), discountCode: state.codeOk ? state.discountCode : '' }) });
      const data = await res.json().catch(() => ({}));
      if (seq !== state.estimateSeq) return;
      state.estimate = res.ok ? { ...data, key } : { ok: false, errors: [data.error || 'No pudimos calcular el total.'], key };
    } catch {
      if (seq !== state.estimateSeq) return;
      state.estimate = { ok: false, errors: ['No hay conexión con el servidor. Revisa tu internet.'], key };
    }
    renderFinal(); renderSummary();
  }, 250);
}

function renderFinal() {
  const box = $('#final');
  const s = service();
  if (!s) { box.innerHTML = ''; return; }
  const est = state.estimate && state.estimate.key === selKey() ? state.estimate : null;
  const scope = scopeList();
  const { selected, included } = chosenFeatures();
  const saved = state.saved && state.savedKey === selKey() ? state.saved : null;
  const recTotals = est ? Object.entries(est.recurringTotals || {}).filter(([, v]) => v > 0) : [];
  const recSel = state.config.recurring.filter((r) => state.sel.recurring.has(r.id));
  const conditions = (state.config.conditions || '').split('\n').filter((l) => l.trim());
  box.innerHTML = `
    <div class="final-head">
      <div><h3>Resumen de tu cotización</h3>
        <p class="muted small">${saved ? `Cotización <b>${esc(saved.number)}</b> · emitida el ${dmy(saved.createdAt)} · válida hasta el ${dmy(saved.validUntil)}` : 'El número y la fecha se asignan al generar tu cotización.'}</p></div>
      <span class="final-kind">${esc(s.name)}</span>
    </div>
    <div class="final-grid">
      <div>
        <h4>Alcance</h4>
        <dl class="final-dl">${scope.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      </div>
      <div>
        <h4>Funciones incluidas</h4>
        ${selected.length || included.length ? `<ul class="sum-list">${selected.map((f) => `<li>${icon('check')}${esc(f.name)}</li>`).join('')}${included.map((f) => `<li class="inc">${icon('check')}${esc(f.name)} <small>incluido en el paquete</small></li>`).join('')}</ul>` : '<p class="muted small">Sin funciones adicionales.</p>'}
        ${recSel.length ? `<h4>Servicios recurrentes</h4><ul class="sum-list">${recSel.map((r) => `<li>${icon('check')}${esc(r.name)} <small>${esc(PERIOD_LABEL[r.period])}</small></li>`).join('')}</ul>` : ''}
      </div>
    </div>
    ${!est ? '<div class="final-total is-loading"><span>Calculando tu total…</span></div>'
      : !est.ok ? `<div class="status error">${esc(est.errors.join(' '))}</div>`
      : `<div class="final-total">
          <div><span>Total del desarrollo</span><small>${est.taxMode === 'added' ? `Incluye ${esc(est.taxLabel)} (${est.taxRate} %)` : est.taxMode === 'included' ? `Con ${esc(est.taxLabel)} incluido` : `No incluye ${esc(est.taxLabel)}`}${est.discountName ? ` · Descuento "${esc(est.discountName)}" aplicado` : ''}</small></div>
          <strong>${formatPEN(est.total)}</strong>
        </div>
        <p class="final-days">Plazo estimado: <b>${est.days} días hábiles</b></p>
        ${recTotals.length || (est.recurringPending || []).length ? `<div class="final-rec"><b>Pagos recurrentes (aparte del desarrollo):</b>
          ${recTotals.map(([p, v]) => `<span>${formatPEN(v)} ${esc(PERIOD_LABEL[p] || p)}</span>`).join('')}
          ${(est.recurringPending || []).length ? `<span>Por confirmar: ${esc(est.recurringPending.join(', '))}</span>` : ''}</div>` : ''}
        ${(est.pending || []).length ? `<div class="final-pending">${icon('info')}<div><b>Se confirman en la propuesta final</b> y no están sumados en el total: ${esc(est.pending.join(' · '))}.</div></div>` : ''}`}
    ${conditions.length ? `<details class="final-cond"><summary>Condiciones comerciales</summary><ul>${conditions.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
  `;
  $('#pre-actions').hidden = !!saved;
  $('#post-actions').hidden = !saved;
  if (saved) {
    $('#dl-pdf').href = `${saved.pdfUrl}?download=1`;
    $('#dl-xlsx').href = saved.xlsxUrl;
  }
}

// ---------- Pasos y navegación ----------
function renderStepper() {
  $('#stepper').innerHTML = STEPS.map((t, i) => {
    const n = i + 1;
    const can = n === 1 || !!state.sel.serviceId;
    return `<li><button type="button" data-go="${n}" ${can ? '' : 'disabled'} ${state.step === n ? 'aria-current="step"' : ''} class="${n < state.step ? 'done' : ''}">
      <span class="num">${n < state.step ? icon('check') : n}</span><span class="lbl">${t}</span></button></li>`;
  }).join('');
  $('#mbar-step').textContent = `Paso ${state.step} de ${STEPS.length}`;
}

/** Valida las preguntas obligatorias del paso. Devuelve true si se puede avanzar. */
function validateStep(n) {
  for (const el of $$('[data-qerr]')) el.textContent = '';
  if (n === 1 && !state.sel.serviceId) { flash('Elige un tipo de proyecto para continuar.'); return false; }
  if (n === 2 || n === 3) {
    const missing = visibleQuestions(n).filter((q) => q.required && q.type !== 'feature' && !(q.type === 'text' ? String(state.sel.answers[q.key] || '').trim() : state.sel.answers[q.key]));
    if (missing.length) {
      for (const q of missing) { const e = $(`[data-qerr="${q.key}"]`); if (e) e.textContent = 'Esta respuesta es obligatoria.'; }
      flash('Responde las preguntas marcadas con * para continuar.');
      ($(`[data-q="${missing[0].key}"]`) || $(`[data-qerr="${missing[0].key}"]`))?.focus?.();
      return false;
    }
  }
  return true;
}

function goTo(n, focus = true) {
  n = Math.min(STEPS.length, Math.max(1, n));
  if (n > state.step) {
    for (let k = state.step; k < n; k++) { if (!validateStep(k)) { n = k; break; } }
  }
  if (n > 1 && !state.sel.serviceId) n = 1;
  state.step = n;
  for (const fs of $$('.step')) fs.hidden = Number(fs.dataset.step) !== n;
  $('#prev').hidden = n === 1;
  $('#next').hidden = n === STEPS.length;
  $('#next').textContent = n === 4 ? 'Ver mi cotización' : 'Continuar';
  renderStepper();
  renderSummary();
  if (n === 5) { renderFinal(); requestEstimate(); }
  if (focus) {
    const top = $('#quoter-title').getBoundingClientRect().top + window.scrollY - 80;
    if (window.scrollY > top) window.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const lg = $(`.step[data-step="${n}"] legend`);
    lg.setAttribute('tabindex', '-1');
    lg.focus({ preventScroll: true });
  }
}

/** Algo cambió en la configuración: se vuelve a dibujar y la cotización emitida deja de corresponder. */
function changed({ keepFocus } = {}) {
  const active = keepFocus ? document.activeElement : null;
  const sel = active && (active.dataset.q ? `[data-q="${active.dataset.q}"]${active.type === 'radio' ? `[value="${active.value}"]` : ''}` : active.name ? `[name="${active.name}"][value="${active.value}"]` : null);
  renderServices(); renderScope(); renderDesign(); renderFeatures(); renderStepper(); renderSummary();
  if (state.step === 5) { renderFinal(); requestEstimate(); }
  if (sel) $(sel)?.focus();
}

// ---------- Envío ----------
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
  if (Object.keys(errors).some((k) => ['hasDomain', 'budget', 'desiredDeadline', 'description'].includes(k))) $('.more-fields').open = true;
  const first = Object.keys(errors)[0];
  if (first) $(`#quote-form [name="${first}"]`)?.focus();
}

async function submit(channel) {
  if (state.busy) return;
  for (let k = 1; k <= 4; k++) if (!validateStep(k)) { goTo(k); return; }
  const client = readClient();
  const errors = validateClient(client);
  showErrors(errors);
  if (Object.keys(errors).length) { flash('Revisa los campos marcados para generar tu cotización.'); return; }

  let waWin = null;
  if (channel === 'whatsapp') {
    if (!state.business.whatsapp) { flash('WhatsApp no está disponible en este momento.'); return; }
    waWin = window.open('', '_blank');
  }
  state.busy = true;
  for (const b of $$('[data-action]')) b.disabled = true;
  flash(channel === 'web' ? 'Generando tu cotización…' : 'Registrando tu solicitud…', 'info');
  const key = selKey();
  try {
    const res = await fetch('/api/quotes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, consent: client.consent, selection: selection(), discountCode: state.codeOk ? state.discountCode : '',
        client, website: $('#quote-form').website.value, previousToken: state.lastToken }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (waWin) waWin.close();
      if (data.fields) showErrors(data.fields);
      flash(data.error || 'No pudimos registrar tu cotización. Inténtalo de nuevo.', 'error');
      return;
    }
    state.lastToken = data.token;
    state.saved = data;
    state.savedKey = key;
    renderFinal();
    if (channel === 'web') flash(`Listo: tu cotización ${data.number} fue generada. Descárgala o envíala por WhatsApp.`, 'ok');
    else if (channel === 'whatsapp') {
      const url = waLink(data.whatsappText);
      if (waWin) waWin.location.href = url; else window.location.href = url;
      flash(`Se abrió WhatsApp con el resumen de tu cotización ${data.number}, listo para enviar.`, 'ok');
    } else flash(`Recibimos tu solicitud ${data.number}. Te contactaremos por WhatsApp o correo para afinar la propuesta.`, 'ok');
  } catch {
    if (waWin) waWin.close();
    flash('No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.', 'error');
  } finally {
    state.busy = false;
    for (const b of $$('[data-action]')) b.disabled = false;
  }
}

async function applyCode() {
  const code = $('#discount-code').value.trim().toUpperCase();
  const msg = $('#discount-msg');
  state.codeOk = false; state.discountCode = '';
  if (!code) { msg.textContent = ''; requestEstimate(); return; }
  msg.className = ''; msg.textContent = 'Verificando…';
  try {
    const res = await fetch('/api/discounts/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { msg.className = 'warn'; msg.textContent = data.error || 'Código no válido.'; }
    else { state.codeOk = true; state.discountCode = code; msg.className = 'ok'; msg.textContent = `Código ${code} aplicado.`; }
  } catch { msg.className = 'warn'; msg.textContent = 'No pudimos verificar el código.'; }
  renderFinal(); requestEstimate();
}

// ---------- Ejemplo de la portada ----------
async function renderSample() {
  const cfg = state.config;
  const s = cfg.services.find((x) => x.kind === 'web' && x.includedPages > 1) || cfg.services[0];
  if (!s) return;
  const range = cfg.pageRanges.find((r) => r.pages > s.includedPages) || defaultRange(s);
  const feat = cfg.features.find((f) => featureMode(f, s.id) === 'available' && f.name.toLowerCase().includes('blog'));
  const sample = { serviceId: s.id, pageRange: range?.id, answers: { estructura: cfg.questions.find((q) => q.key === 'estructura')?.options[1]?.id }, features: feat ? [feat.id] : [], recurring: [] };
  const included = cfg.features.filter((f) => featureMode(f, s.id) === 'included').slice(0, 3);
  $('#sample-service').textContent = s.name;
  $('#sample-lines').innerHTML = [
    range ? `<li><span>${esc(range.label)}</span><b>${icon('check')}</b></li>` : '',
    feat ? `<li><span>${esc(feat.name)}</span><b>${icon('check')}</b></li>` : '',
    ...included.map((f) => `<li class="inc"><span>${esc(f.name)}</span><b>Incluido</b></li>`),
  ].join('');
  try {
    const res = await fetch('/api/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selection: sample }) });
    const r = await res.json();
    if (res.ok && r.ok) {
      $('#sample-total').textContent = formatPEN(r.total);
      $('#sample-note').textContent = `Ejemplo calculado con las tarifas vigentes. Plazo estimado: ${r.days} días hábiles.`;
    }
  } catch { /* el ejemplo es decorativo; si falla se queda sin total */ }
}

// ---------- Inicio ----------
function fillSelect(sel, list) { sel.innerHTML = list.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(''); }

function bind() {
  $('#services').addEventListener('click', (e) => { const b = e.target.closest('.service'); if (b) chooseService(Number(b.dataset.id)); });
  $('#services').addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
    const items = $$('.service'); const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    items[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  });

  const onChange = (e) => {
    const t = e.target;
    if (t.matches('[data-pages]')) state.sel.pageRange = Number(t.value);
    else if (t.matches('[data-g]')) state.sel[t.dataset.g] = Number(t.value);
    else if (t.matches('[data-qf]')) { const id = Number(t.dataset.qf); if (t.value === '1') state.sel.features.add(id); else state.sel.features.delete(id); }
    else if (t.matches('input[data-q]')) state.sel.answers[t.dataset.q] = Number(t.value);
    else if (t.matches('[data-f]')) { const id = Number(t.dataset.f); if (t.checked) state.sel.features.add(id); else state.sel.features.delete(id); }
    else if (t.matches('[data-r]')) { const id = Number(t.dataset.r); if (t.checked) state.sel.recurring.add(id); else state.sel.recurring.delete(id); }
    else return;
    changed({ keepFocus: true });
  };
  for (const id of ['#scope', '#design', '#features']) $(id).addEventListener('change', onChange);
  // Respuestas de texto: se guardan al escribir, sin volver a dibujar (para no perder el cursor).
  $('#scope').addEventListener('input', (e) => {
    if (!e.target.matches('textarea[data-q]')) return;
    state.sel.answers[e.target.dataset.q] = e.target.value;
    const err = $(`[data-qerr="${e.target.dataset.q}"]`); if (err) err.textContent = '';
    renderSummary();
  });

  $('#stepper').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) goTo(Number(b.dataset.go)); });
  $('#next').addEventListener('click', () => goTo(state.step + 1));
  $('#prev').addEventListener('click', () => goTo(state.step - 1));
  $('#edit-config').addEventListener('click', () => goTo(1));
  $('#quote-form').addEventListener('submit', (e) => e.preventDefault());
  for (const b of $$('[data-action]')) b.addEventListener('click', () => submit(b.dataset.action));
  // Registrar las descargas como canal usado (la descarga ocurre por el enlace).
  $('#dl-pdf').addEventListener('click', () => { if (state.saved) navigator.sendBeacon?.('/api/quotes', new Blob([JSON.stringify({ channel: 'pdf', consent: true, selection: selection(), client: readClient(), previousToken: state.lastToken, discountCode: state.codeOk ? state.discountCode : '' })], { type: 'application/json' })); });
  $('#discount-apply').addEventListener('click', applyCode);
  $('#discount-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCode(); } });
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
  const io = new IntersectionObserver(([en]) => $('#mbar').classList.toggle('show', en.isIntersecting), { threshold: 0 });
  io.observe($('#cotizador'));
}

async function init() {
  hydrateIcons();
  $('#summary-close').innerHTML = icon('x');
  fillSelect($('#f-domain'), DOMAIN);
  fillSelect($('#f-budget'), BUDGETS);
  fillSelect($('#f-desired'), DESIRED);
  bind();
  goTo(1, false);
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error();
    const data = await res.json();
    state.config = data.config; state.business = data.business; state.recurringInfo = data.recurring;
  } catch {
    $('#services').innerHTML = '<p class="toast error">No pudimos cargar el cotizador. Recarga la página en unos segundos.</p>';
    $('#sample-service').textContent = 'Ejemplo no disponible';
    return;
  }
  for (const g of GROUPS) { const d = state.config.options[g.key].find((o) => o.isDefault) || state.config.options[g.key][0]; state.sel[g.key] = d?.id ?? null; }

  const b = state.business;
  const wa = waLink('Hola, quiero información para desarrollar mi página web.');
  for (const el of $$('[data-wa]')) if (wa) { el.href = wa; el.hidden = false; }
  $('[data-action="whatsapp"]').hidden = !b.whatsapp;
  if (b.email) { const e = $('#footer-email'); e.href = `mailto:${b.email}`; e.textContent = b.email; e.hidden = false; }
  if (b.companyName) $('#footer-company').textContent = `Un servicio de ${b.companyName}.`;
  if (b.ratesValidFrom || b.ratesValidTo) {
    $('#rates-note').textContent = `Tarifas vigentes${b.ratesValidFrom ? ` desde el ${dmy(b.ratesValidFrom)}` : ''}${b.ratesValidTo ? ` hasta el ${dmy(b.ratesValidTo)}` : ''}. Precios en soles.`;
  }
  $('#costs').innerHTML = state.recurringInfo.map((x) => `
    <div class="cost cost-${x.status}"><div class="cost-top"><strong>${esc(x.name)}</strong><span class="tag">${STATUS_TEXT[x.status]}</span></div>
    <p>${esc(x.description)}</p><small>${esc(x.reference)}</small></div>`).join('');

  changed();
  renderSample();
}

init();
