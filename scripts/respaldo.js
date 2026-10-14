// Crea una copia de seguridad consistente de la base de datos (funciona con el servidor encendido).
// Uso:  npm run respaldo
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = process.env.DB_PATH || path.join(ROOT, 'data', 'cotizatuweb.db');
const dir = path.join(path.dirname(src), 'respaldos');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 16).replace(/[:T]/g, '-');
const dest = path.join(dir, `cotizatuweb-${stamp}.db`);
const db = new DatabaseSync(src);
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
console.log(`Respaldo creado: ${dest}`);
