/**
 * Arranque del backend: configuracion (variables de entorno), SQLite, nodo de la red, servidor y
 * bucle de seguimiento (`tracker.ts`).
 *
 *   CHAIN_GAME_ID=... CHAIN_MASTER_SEED_FILE=... CHAIN_WRITE_KEY=... CHAIN_READ_TOKEN=... CHAIN_ADMIN_KEY=... npm start
 *
 * La consola queda en http://127.0.0.1:8787/admin (W1).
 *
 * La autoridad sale de la semilla maestra (`keys.ts`) y debe tener fondos y su juego creado con
 * `initialize_game` antes de la primera escritura.
 */
import { createSolanaRpc } from '@solana/kit';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { deriveAuthority } from './keys.js';
import { buildServer } from './server.js';
import { startTracker } from './tracker.js';
import { authoritySigner } from './transactions.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const authority = await authoritySigner(deriveAuthority(config.masterSeed, config.gameId));
const rpc = createSolanaRpc(config.rpcUrl);
const app = await buildServer({
  db,
  gameId: config.gameId,
  masterSeed: config.masterSeed,
  writeKey: config.writeKey,
  readToken: config.readToken,
  authority,
  rpc,
  logger: true,
  readRateLimit: config.readRateLimit,
  admin: { key: config.adminKey, explorerTxUrl: config.explorerTxUrl },
});
const stopTracker = startTracker({
  db,
  rpc,
  gameId: config.gameId,
  authority,
  log: (message, detail) => app.log.warn(detail ?? {}, message),
});
app.addHook('onClose', async () => stopTracker());
await app.listen({ host: config.host, port: config.port });
