import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const contents = example.replace(/^API_TOKEN=$/m, `API_TOKEN=${randomBytes(32).toString('hex')}`);
try {
  writeFileSync(new URL('../.env', import.meta.url), contents, { flag: 'wx', mode: 0o600 });
  console.log('.env creado con una clave aleatoria. No compartas ni publiques este archivo.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env ya existe; no se ha modificado. Comprueba API_TOKEN antes de arrancar.');
}
