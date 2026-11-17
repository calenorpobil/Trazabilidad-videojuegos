/**
 * Crea los datos de demo en el backend (`src/seed.ts`). Con las variables de `env.sh` cargadas y el backend
 * arrancado:
 *
 *   npm run seed-demo
 *
 *   GAME_SERVER_WRITE_KEY    el `write_key` del backend. Obligatoria
 *   GAME_SERVER_BACKEND_URL  por defecto http://127.0.0.1:8787
 *   GAME_SERVER_PLAYER       quién recibe las entregas; por defecto player-a
 *   CHAIN_READ_TOKEN         si está, espera a que cada creación llegue a su estado final
 *   SEED_TAG                 prefijo de las claves de idempotencia; por defecto demo-seed. Otro valor crea
 *                            otro juego de datos
 *
 * Sin `process.exit`: en Windows corta sockets a medio cerrar y libuv aborta.
 */
import { SeedError, seedDemo } from '../src/seed.js';

async function main(): Promise<number> {
  const env = process.env;
  const writeKey = env['GAME_SERVER_WRITE_KEY'];
  if (writeKey === undefined || writeKey === '') {
    console.error('Falta GAME_SERVER_WRITE_KEY: carga antes tu env.sh.');
    return 1;
  }
  const readToken = env['CHAIN_READ_TOKEN'];
  try {
    const { items } = await seedDemo({
      backendUrl: env['GAME_SERVER_BACKEND_URL'] ?? 'http://127.0.0.1:8787',
      writeKey,
      ...(readToken === undefined || readToken === '' ? {} : { readToken }),
      tag: env['SEED_TAG'] ?? 'demo-seed',
      player: env['GAME_SERVER_PLAYER'] ?? 'player-a',
      log: (line) => console.warn(line),
    });
    if (items.some((item) => item.state === 'failed')) {
      console.error('Alguna creación ha fallado. Para reintentarla, usa otra etiqueta: SEED_TAG=demo-seed-2 npm run seed-demo');
      return 1;
    }
    return 0;
  } catch (error) {
    if (error instanceof SeedError) {
      console.error(`No se pudieron crear los datos: ${error.message}`);
      return 1;
    }
    if (error instanceof TypeError) {
      console.error('El backend no responde. ¿Está arrancado (npm start en backend/)?');
      return 1;
    }
    throw error;
  }
}

process.exitCode = await main();
