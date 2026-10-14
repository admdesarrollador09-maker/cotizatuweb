// Autenticación del panel administrativo: contraseñas con scrypt y sesiones en base de datos.
import crypto from 'node:crypto';

const SESSION_HOURS = 8;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export function validatePasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'La contraseña debe combinar letras y números.';
  return null;
}

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

export function createSession(db, adminId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_HOURS * 3600 * 1000;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions(token_hash, admin_id, expires_at) VALUES (?,?,?)').run(sha(token), adminId, expires);
  return { token, maxAge: SESSION_HOURS * 3600 };
}

export function getSessionAdmin(db, token) {
  if (!token) return null;
  const row = db.prepare(
    'SELECT a.id, a.username, s.expires_at FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ?'
  ).get(sha(token));
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, username: row.username };
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

/** Limitador simple en memoria (por IP y clave). */
export function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return {
    check(key) {
      const now = Date.now();
      const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
      hits.set(key, arr);
      return arr.length < max;
    },
    hit(key) {
      const arr = hits.get(key) || [];
      arr.push(Date.now());
      hits.set(key, arr);
    },
    reset(key) { hits.delete(key); },
  };
}
