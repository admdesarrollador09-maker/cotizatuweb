// Almacenamiento clave/valor con escrituras condicionales (ETag).
//  - En Netlify: Netlify Blobs (consistencia fuerte).
//  - En tu computadora: archivos JSON en la carpeta data/.
// Interfaz común:
//   get(key)                          -> { data, etag } | null
//   set(key, data, { onlyIfMatch, onlyIfNew }) -> { modified, etag }
//   del(key)
//   list(prefix)                      -> [key, ...]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const etagOf = (text) => crypto.createHash('sha1').update(text).digest('hex');

export function fileStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = (key) => path.join(dir, encodeURIComponent(key) + '.json');
  let chain = Promise.resolve();
  // Serializa las operaciones para que las escrituras condicionales sean atómicas en un mismo proceso.
  const lock = (fn) => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };
  return {
    kind: 'archivo',
    get: (key) => lock(() => {
      try { const t = fs.readFileSync(file(key), 'utf8'); return { data: JSON.parse(t), etag: etagOf(t) }; }
      catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    }),
    set: (key, data, opts = {}) => lock(() => {
      const f = file(key);
      let current = null;
      try { current = fs.readFileSync(f, 'utf8'); } catch {}
      if (opts.onlyIfNew && current !== null) return { modified: false, etag: etagOf(current) };
      if (opts.onlyIfMatch && (current === null || etagOf(current) !== opts.onlyIfMatch)) return { modified: false, etag: current && etagOf(current) };
      const text = JSON.stringify(data);
      const tmp = f + '.tmp';
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, f);
      return { modified: true, etag: etagOf(text) };
    }),
    del: (key) => lock(() => { try { fs.unlinkSync(file(key)); } catch {} }),
    list: (prefix = '') => lock(() => fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
      .map((f) => decodeURIComponent(f.slice(0, -5))).filter((k) => k.startsWith(prefix))),
  };
}

/** Adaptador de Netlify Blobs. `getStoreFn` permite inyectar una implementación en pruebas. */
export async function blobsStore(name = 'cotizatuweb', getStoreFn) {
  const getStore = getStoreFn || (await import('@netlify/blobs')).getStore;
  const s = getStore({ name, consistency: 'strong' });
  return {
    kind: 'netlify-blobs',
    async get(key) {
      const r = await s.getWithMetadata(key, { type: 'json' });
      return r && r.data !== null && r.data !== undefined ? { data: r.data, etag: r.etag } : null;
    },
    async set(key, data, opts = {}) {
      const o = {};
      if (opts.onlyIfMatch) o.onlyIfMatch = opts.onlyIfMatch;
      if (opts.onlyIfNew) o.onlyIfNew = true;
      const r = await s.setJSON(key, data, o);
      return { modified: r?.modified ?? true, etag: r?.etag };
    },
    async del(key) { await s.delete(key); },
    async list(prefix = '') {
      const { blobs } = await s.list({ prefix });
      return blobs.map((b) => b.key);
    },
  };
}

/** Lee, modifica y guarda un documento con reintentos si otro proceso lo cambió a la vez. */
export async function update(store, key, mutate, initial) {
  for (let i = 0; i < 8; i++) {
    const cur = await store.get(key);
    const data = cur ? cur.data : (typeof initial === 'function' ? initial() : structuredClone(initial));
    const result = await mutate(data);
    const w = await store.set(key, data, cur ? { onlyIfMatch: cur.etag } : { onlyIfNew: true });
    if (w.modified) return { data, result };
    await new Promise((r) => setTimeout(r, 30 + Math.random() * 70 * (i + 1)));
  }
  throw new Error('No se pudo guardar por cambios simultáneos. Inténtalo de nuevo.');
}
