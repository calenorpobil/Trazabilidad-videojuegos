/**
 * Arranque del servidor de juego de ejemplo, con variables de entorno:
 *
 *   GAME_SERVER_WRITE_KEY     el `write_key` del backend (su CHAIN_WRITE_KEY). Obligatoria
 *   GAME_SERVER_BACKEND_URL   por defecto http://127.0.0.1:8787
 *   GAME_SERVER_PLAYER        el jugador que pide las transferencias; por defecto player-a
 *   GAME_SERVER_DATABASE_PATH por defecto game-server.db
 *   GAME_SERVER_HOST          por defecto 127.0.0.1
 *   GAME_SERVER_PORT          por defecto 8788
 *
 * Ningún mensaje repite el valor del `write_key`.
 */
import { openDatabase } from './db.js';
import { buildServer } from './server.js';

const env = process.env;

function setting(name: string, fallback?: string): string {
  const value = env[name] ?? fallback;
  if (value === undefined || value === '') {
    console.error(`Falta ${name}.`);
    process.exit(1);
  }
  return value;
}

const port = Number(setting('GAME_SERVER_PORT', '8788'));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('GAME_SERVER_PORT debe ser un puerto de 1 a 65535.');
  process.exit(1);
}
const backendUrl = setting('GAME_SERVER_BACKEND_URL', 'http://127.0.0.1:8787');
if (!/^https?:\/\//.test(backendUrl)) {
  console.error('GAME_SERVER_BACKEND_URL debe empezar por http:// o https://.');
  process.exit(1);
}

const app = buildServer({
  db: openDatabase(setting('GAME_SERVER_DATABASE_PATH', 'game-server.db')),
  backendUrl,
  writeKey: setting('GAME_SERVER_WRITE_KEY'),
  player: setting('GAME_SERVER_PLAYER', 'player-a'),
  logger: true,
});
await app.listen({ host: setting('GAME_SERVER_HOST', '127.0.0.1'), port });
