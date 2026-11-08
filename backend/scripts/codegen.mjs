/**
 * Genera el cliente TypeScript de `chain-assets` a partir de su IDL (P3 y P10, verificaciones.md).
 *
 * El IDL sale de `anchor build`, que sólo funciona en WSL (V5). Se copia a mano a
 * `backend/idl/chain_assets.json` y se versiona, igual que el cliente generado en
 * `src/generated/`: así la CI no necesita Anchor. Tras cambiar el programa:
 *
 *   1. `anchor build` en WSL y copiar `target/idl/chain_assets.json` a `backend/idl/`.
 *   2. `npm run codegen`.
 *   3. Revisar el diff de `src/generated/` y hacer commit de los dos.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootNodeFromAnchor } from '@codama/nodes-from-anchor';
import { renderVisitor } from '@codama/renderers-js';
import { createFromRoot } from 'codama';

const backend = join(dirname(fileURLToPath(import.meta.url)), '..');
const idl = JSON.parse(readFileSync(join(backend, 'idl', 'chain_assets.json'), 'utf8'));

const codama = createFromRoot(rootNodeFromAnchor(idl));
await codama.accept(
  renderVisitor(backend, {
    generatedFolder: 'src/generated',
    // Las versiones se fijan a mano y exactas en package.json (CLAUDE.md, sección 2).
    syncPackageJson: false,
    // `moduleResolution: nodenext` exige la extensión en los imports relativos.
    importExtension: 'js',
    // Todo sale de `@solana/kit` (y de sus subrutas): es la única dependencia directa.
    kitImportStrategy: 'rootOnly',
  }),
);

// El *plugin* de cliente de Kit (`chainAssetsProgram()`) no compila con
// `exactOptionalPropertyTypes`: pasa `programAddress: undefined` a un campo opcional. El backend
// no lo usa (construye las instrucciones con `get*Instruction` y firma él), pero las instrucciones
// importan el fichero por la dirección del programa. Se desactiva la comprobación sólo ahí, en
// vez de relajar el `tsconfig` de todo el backend.
const plugin = join(backend, 'src', 'generated', 'programs', 'chainAssets.ts');
const source = readFileSync(plugin, 'utf8');
if (!source.includes('export function chainAssetsProgram(')) {
  throw new Error('codegen: el plugin ya no está donde se esperaba; revisa este parche');
}
writeFileSync(
  plugin,
  '// @ts-nocheck -- añadido por scripts/codegen.mjs: plugin sin usar, ver el comentario allí.\n' + source,
);
