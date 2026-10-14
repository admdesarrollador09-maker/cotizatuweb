// Crea un administrador o cambia la contraseña de uno existente.
// Uso:  npm run crear-admin
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.js';
import { hashPassword, validatePasswordStrength } from '../src/auth.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = openDb(process.env.DB_PATH || path.join(ROOT, 'data', 'cotizatuweb.db'));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (q, hidden = false) => new Promise((resolve) => {
  if (hidden) {
    rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); else rl.output.write('*'.repeat(s.length ? 1 : 0)); };
  }
  rl.question(q, (a) => { rl._writeToOutput = (s) => rl.output.write(s); if (hidden) rl.output.write('\n'); resolve(a); });
});

const username = (await ask('Usuario administrador: ')).trim();
if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) { console.error('Usuario no válido (3-40 letras, números, punto, guion).'); process.exit(1); }
const pw = await ask('Contraseña (mín. 10 caracteres, letras y números): ', true);
const err = validatePasswordStrength(pw);
if (err) { console.error(err); process.exit(1); }
const pw2 = await ask('Repite la contraseña: ', true);
if (pw !== pw2) { console.error('Las contraseñas no coinciden.'); process.exit(1); }
rl.close();

const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
if (existing) {
  db.prepare('UPDATE admins SET pass_hash = ? WHERE id = ?').run(hashPassword(pw), existing.id);
  db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(existing.id);
  console.log(`Contraseña de "${username}" actualizada.`);
} else {
  db.prepare('INSERT INTO admins(username, pass_hash) VALUES (?,?)').run(username, hashPassword(pw));
  console.log(`Administrador "${username}" creado. Ingresa en /admin/`);
}
