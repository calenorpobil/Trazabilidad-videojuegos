/**
 * Revision de licencias de dependencias (seccion 9 de la propuesta).
 *
 * Recorre `node_modules` y falla si aparece una licencia fuera de la lista permitida.
 * La lista es explicita a proposito: una licencia nueva tiene que revisarse a mano y
 * anotarse aqui, no colarse porque el arbol de dependencias creciera.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const ALLOWED = new Set([
  'MIT',
  'MIT OR Apache-2.0',
  'Apache-2.0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'Python-2.0',
  // Copyleft debil, y solo en dependencias de desarrollo (lightningcss, via vitest).
  // No se enlaza en nada que se distribuya.
  'MPL-2.0',
]);

/** @param {string} dir */
function* packagesIn(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.bin') continue;
    const path = join(dir, entry.name);
    if (entry.name.startsWith('@')) {
      yield* packagesIn(path);
      continue;
    }
    try {
      yield JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
    } catch {
      // Directorio sin manifiesto: no es un paquete.
    }
    yield* packagesIn(join(path, 'node_modules'));
  }
}

const offenders = new Set();
let seen = 0;

for (const pkg of packagesIn(join(process.cwd(), 'node_modules'))) {
  if (!pkg.name) continue;
  seen += 1;
  const license =
    typeof pkg.license === 'string'
      ? pkg.license
      : (pkg.license?.type ?? pkg.licenses?.[0]?.type ?? 'DESCONOCIDA');
  if (!ALLOWED.has(license)) offenders.add(`${pkg.name}@${pkg.version}: ${license}`);
}

if (seen === 0) {
  console.error('No se encontro node_modules. Ejecuta npm ci antes.');
  process.exit(1);
}

if (offenders.size > 0) {
  console.error('Licencias no permitidas:');
  for (const line of [...offenders].sort()) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`Licencias: ${seen} paquetes, todos dentro de la lista permitida.`);
