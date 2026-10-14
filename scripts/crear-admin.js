// Crea un administrador o cambia su contraseña EN TU COMPUTADORA (datos en la carpeta data/).
// En Netlify el primer administrador se crea con las variables ADMIN_USER y ADMIN_PASSWORD.
// Uso:  npm run crear-admin
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileStore } from '../src/store.js';
import { getAdmins, saveAdmin, destroyUserSessions } from '../src/repo.js';
import { hashPassword, validatePasswordStrength } from '../src/auth.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = fileStore(process.env.DATA_DIR || path.join(ROOT, 'data'));

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

const existed = !!(await getAdmins(store)).users[username];
await saveAdmin(store, username, hashPassword(pw));
await destroyUserSessions(store, username);
console.log(existed ? `Contraseña de "${username}" actualizada.` : `Administrador "${username}" creado. Ingresa en /admin/`);
