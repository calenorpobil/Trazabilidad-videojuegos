/**
 * Arranque del backend: configuracion (variables de entorno), SQLite, nodo de la red y servidor.
 *
 *   CHAIN_GAME_ID=... CHAIN_MASTER_SEED_FILE=... CHAIN_WRITE_KEY=... CHAIN_READ_TOKEN=... npm start
 *
 * La autoridad sale de la semilla maestra (`keys.ts`) y debe tener fondos y su juego creado con
 * `initialize_game` antes de la primera escritura.
 */
import { createSolanaRpc } from '@solana/kit';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { deriveAuthority } from './keys.js';
import { buildServer } from './server.js';
import { authoritySigner } from './transactions.js';

const config = loadConfig();
const app = await buildServer({
  db: openDatabase(config.databasePath),
  gameId: config.gameId,
  masterSeed: config.masterSeed,
  writeKey: config.writeKey,
  readToken: config.readToken,
  authority: await authoritySigner(deriveAuthority(config.masterSeed, config.gameId)),
  rpc: createSolanaRpc(config.rpcUrl),
  logger: true,
});
await app.listen({ host: config.host, port: config.port });
