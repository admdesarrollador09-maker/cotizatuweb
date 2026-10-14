// Acceso a datos sobre el almacenamiento clave/valor.
//   catalog            Catálogo y configuración comercial
//   counters           Correlativos de cotizaciones
//   index/quotes       Resumen de todas las cotizaciones (para el listado del panel)
//   quotes/<id>        Cotización completa: cliente, conceptos con sus precios, historial
//   tokens/<token>     Enlace público al PDF → id de cotización
//   changelog          Historial de cambios de tarifas
//   admins             Usuarios administradores (contraseñas cifradas)
//   sessions/<hash>    Sesiones del panel
//   rl/<clave>         Límites de intentos
import crypto from 'node:crypto';
import { update } from './store.js';
import { seedCatalog } from './catalog.js';

export const nowUtc = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
export const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

export async function getCatalog(store) {
  const cur = await store.get('catalog');
  if (cur) return cur.data;
  await store.set('catalog', seedCatalog(), { onlyIfNew: true });
  return (await store.get('catalog')).data;
}

export async function updateCatalog(store, mutate, { bump = false, actor = 'sistema', summary = '' } = {}) {
  const { data, result } = await update(store, 'catalog', (cat) => {
    const r = mutate(cat);
    if (bump) cat.settings.pricing_version = String(Number(cat.settings.pricing_version || 1) + 1);
    return r;
  }, seedCatalog);
  if (summary) await logChange(store, actor, summary);
  return { catalog: data, result };
}

export async function logChange(store, actor, summary) {
  await update(store, 'changelog', (list) => {
    list.unshift({ at: nowUtc(), actor, summary });
    list.length = Math.min(list.length, 200);
  }, []);
}

export async function getChangelog(store) {
  return (await store.get('changelog'))?.data || [];
}

/** Reserva el siguiente id interno y el correlativo anual. */
export async function nextQuoteNumbers(store, year) {
  const { result } = await update(store, 'counters', (c) => {
    c.quoteId = (c.quoteId || 0) + 1;
    c[`y${year}`] = (c[`y${year}`] || 0) + 1;
    return { id: c.quoteId, seq: c[`y${year}`] };
  }, {});
  return result;
}

export function summaryOf(q) {
  return {
    id: q.id, number: q.number, status: q.status, channels: q.channels.join(','), service_name: q.service_name,
    total: q.total, created_at: q.created_at, follow_up_date: q.follow_up_date || null, adjusted: q.adjusted ? 1 : 0,
    client_name: q.client.name, client_company: q.client.company, client_email: q.client.email,
  };
}

export async function getQuote(store, id) {
  return (await store.get(`quotes/${id}`))?.data || null;
}

export async function getQuoteByToken(store, token) {
  const t = (await store.get(`tokens/${token}`))?.data;
  return t ? getQuote(store, t.id) : null;
}

export async function insertQuote(store, q) {
  await store.set(`quotes/${q.id}`, q, { onlyIfNew: true });
  await store.set(`tokens/${q.token}`, { id: q.id });
  await upsertIndex(store, q);
}

/** Modifica una cotización con control de cambios simultáneos y actualiza el índice. */
export async function updateQuote(store, id, mutate) {
  const cur = await store.get(`quotes/${id}`);
  if (!cur) return null;
  const { data } = await update(store, `quotes/${id}`, (q) => { mutate(q); q.updated_at = nowUtc(); }, null);
  await upsertIndex(store, data);
  return data;
}

async function upsertIndex(store, q) {
  const s = summaryOf(q);
  await update(store, 'index/quotes', (list) => {
    const i = list.findIndex((x) => x.id === s.id);
    if (i >= 0) list[i] = s; else list.unshift(s);
  }, []);
}

export async function listQuotes(store) {
  return (await store.get('index/quotes'))?.data || [];
}

// ---------- Administradores y sesiones ----------
export async function getAdmins(store) {
  return (await store.get('admins'))?.data || { users: {} };
}

export async function saveAdmin(store, username, passHash) {
  await update(store, 'admins', (a) => { a.users[username] = { pass_hash: passHash, updated_at: nowUtc() }; }, { users: {} });
}

const SESSION_HOURS = 8;
export async function createSession(store, username) {
  const token = crypto.randomBytes(32).toString('base64url');
  await store.set(`sessions/${sha(token)}`, { username, expires: Date.now() + SESSION_HOURS * 3600e3 });
  return { token, maxAge: SESSION_HOURS * 3600 };
}
export async function getSession(store, token) {
  if (!token) return null;
  const s = (await store.get(`sessions/${sha(token)}`))?.data;
  if (!s || s.expires < Date.now()) return null;
  return { username: s.username };
}
export async function destroySession(store, token) {
  if (token) await store.del(`sessions/${sha(token)}`);
}
export async function destroyUserSessions(store, username) {
  for (const key of await store.list('sessions/')) {
    const s = (await store.get(key))?.data;
    if (!s || s.username === username || s.expires < Date.now()) await store.del(key);
  }
}

// ---------- Límites de intentos (compartidos entre instancias) ----------
export async function rateCheck(store, key, { windowMs, max }) {
  const d = (await store.get(`rl/${sha(key)}`))?.data;
  const hits = (d?.hits || []).filter((t) => Date.now() - t < windowMs);
  return hits.length < max;
}
export async function rateHit(store, key, { windowMs }) {
  const k = `rl/${sha(key)}`;
  const d = (await store.get(k))?.data;
  const hits = (d?.hits || []).filter((t) => Date.now() - t < windowMs);
  hits.push(Date.now());
  await store.set(k, { hits });
}
export async function rateReset(store, key) { await store.del(`rl/${sha(key)}`); }
