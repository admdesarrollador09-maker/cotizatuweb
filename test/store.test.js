// Pruebas del adaptador de Netlify Blobs con un almacén simulado que respeta escrituras condicionales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blobsStore, update } from '../src/store.js';

function fakeGetStore() {
  const m = new Map(); let n = 0;
  const api = {
    async getWithMetadata(key) { const v = m.get(key); return v ? { data: JSON.parse(v.body), etag: v.etag, metadata: {} } : null; },
    async setJSON(key, value, opts = {}) {
      const cur = m.get(key);
      if (opts.onlyIfNew && cur) return { modified: false };
      if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
      const etag = `"${++n}"`;
      m.set(key, { body: JSON.stringify(value), etag });
      return { modified: true, etag };
    },
    async delete(key) { m.delete(key); },
    async list({ prefix = '' } = {}) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, etag: m.get(key).etag })), directories: [] }; },
  };
  return (opts) => { assert.equal(opts.consistency, 'strong'); return api; };
}

test('adaptador de Blobs: lectura, escritura condicional y listado', async () => {
  const s = await blobsStore('x', fakeGetStore());
  assert.equal(await s.get('a'), null);
  const w1 = await s.set('a', { v: 1 }, { onlyIfNew: true });
  assert.equal(w1.modified, true);
  assert.equal((await s.set('a', { v: 2 }, { onlyIfNew: true })).modified, false);
  assert.equal((await s.set('a', { v: 3 }, { onlyIfMatch: 'otro' })).modified, false);
  assert.equal((await s.set('a', { v: 4 }, { onlyIfMatch: w1.etag })).modified, true);
  assert.deepEqual((await s.get('a')).data, { v: 4 });
  await s.set('p/1', {}); await s.set('p/2', {});
  assert.deepEqual((await s.list('p/')).sort(), ['p/1', 'p/2']);
  await s.del('p/1');
  assert.deepEqual(await s.list('p/'), ['p/2']);
});

test('actualizaciones simultáneas no se pisan', async () => {
  const s = await blobsStore('x', fakeGetStore());
  await Promise.all(Array.from({ length: 10 }, () => update(s, 'c', (d) => { d.n = (d.n || 0) + 1; }, {})));
  assert.equal((await s.get('c')).data.n, 10);
});
