/**
 * El servidor de juego contra un backend falso que escucha de verdad por HTTP: se comprueba lo que le
 * llega (credencial, clave, cuerpo) y en qué momento queda registrada la acción.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db.js';
import { buildServer } from '../src/server.js';

const WRITE_KEY = 'w'.repeat(40);
const KEY = 'a'.repeat(64);

interface Seen {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  /** Lo que había en `actions` para esa clave cuando llegó la petición. */
  registered: unknown;
}

let db: Db;
let backend: FastifyInstance;
let game: FastifyInstance;
let seen: Seen[];
/** Respuesta del backend falso: código, cuerpo y cabeceras. */
let answer: { status: number; body: unknown; headers?: Record<string, string> };

async function start(backendUrl?: string) {
  backend = Fastify();
  backend.post('/*', async (request, reply) => {
    seen.push({
      url: request.url,
      headers: request.headers,
      body: request.body,
      registered: db.prepare('SELECT route, body FROM actions WHERE key = ?').get(request.headers['idempotency-key']),
    });
    for (const [name, value] of Object.entries(answer.headers ?? {})) void reply.header(name, value);
    return reply.status(answer.status).send(answer.body);
  });
  const address = await backend.listen({ host: '127.0.0.1', port: 0 });
  game = buildServer({ db, backendUrl: backendUrl ?? address, writeKey: WRITE_KEY, player: 'player-a', backendTimeoutMs: 2000 });
}

beforeEach(async () => {
  db = openDatabase(':memory:');
  seen = [];
  answer = { status: 202, body: { operation_id: 'opr_1', from_holder_id: 'hld_a', to_holder_id: 'hld_b' } };
  await start();
});

afterEach(async () => {
  await game.close();
  await backend.close();
  db.close();
});

const post = (url: string, payload: object, key: string | null = KEY) =>
  game.inject({
    method: 'POST',
    url,
    headers: key === null ? {} : { 'idempotency-key': key },
    payload,
  });

describe('reenvío', () => {
  it('reenvía con el write_key y la Idempotency-Key sin tocar, y añade el emisor a una transferencia', async () => {
    const response = await post('/v1/items/itm_1/transfer', { to: { external_id: 'player-b' }, amount: 1 });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual(answer.body);
    expect(seen).toHaveLength(1);
    const [request] = seen;
    expect(request?.url).toBe('/v1/items/itm_1/transfer');
    expect(request?.headers.authorization).toBe(`Bearer ${WRITE_KEY}`);
    expect(request?.headers['idempotency-key']).toBe(KEY);
    expect(request?.body).toEqual({ to: { external_id: 'player-b' }, amount: 1, from: { external_id: 'player-a' } });
  });

  it('registra la acción antes de llamar al backend', async () => {
    await post('/v1/items/itm_1/transfer', { to: { holder_id: 'hld_b' }, amount: 2 });

    expect(seen[0]?.registered).toEqual({
      route: '/v1/items/itm_1/transfer',
      body: JSON.stringify({ to: { holder_id: 'hld_b' }, amount: 2, from: { external_id: 'player-a' } }),
    });
  });

  it('devuelve los errores del backend tal cual, con su Retry-After', async () => {
    answer = {
      status: 429,
      body: { error: { code: 'RATE_LIMITED', message: 'despacio', retryable: true } },
      headers: { 'retry-after': '10' },
    };
    const response = await post('/v1/items/itm_1/transfer', { to: { external_id: 'player-b' }, amount: 1 });

    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('10');
    expect(response.json()).toEqual(answer.body);
  });
});

describe('autorización', () => {
  it('rechaza una transferencia en la que el juego elige el emisor, sin registrarla ni llamar', async () => {
    const response = await post('/v1/items/itm_1/transfer', {
      from: { external_id: 'player-b' },
      to: { external_id: 'player-a' },
      amount: 1,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('REJECTED');
    expect(seen).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM actions').get()).toEqual({ n: 0 });
  });

  it('no reenvía la creación de colecciones ni de tipos: el catálogo lo crea el estudio', async () => {
    const collection = await post('/v1/collections', { name: 'Armería' });
    const item = await post('/v1/items', {
      collection_id: 'col_1',
      name: 'Espada',
      symbol: 'SWORD',
      initial_grant: { holder: { external_id: 'player-a' }, amount: 1000 },
    });

    for (const response of [collection, item]) {
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('REJECTED');
    }
    expect(seen).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM actions').get()).toEqual({ n: 0 });
  });

  it('exige Idempotency-Key', async () => {
    const response = await post('/v1/items/itm_1/transfer', { to: { external_id: 'player-b' }, amount: 1 }, null);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('REJECTED');
    expect(seen).toHaveLength(0);
  });

  it('no reenvía nada fuera de las tres escrituras', async () => {
    const grant = await post('/v1/items/itm_1/grants', { holder: { external_id: 'player-a' }, amount: 1 });
    const read = await game.inject({ method: 'GET', url: '/v1/holders/hld_a/items' });

    expect(grant.statusCode).toBe(404);
    expect(read.statusCode).toBe(404);
    expect(seen).toHaveLength(0);
  });
});

describe('misma clave', () => {
  it('una acción ya aceptada se devuelve sin volver a llamar al backend', async () => {
    const first = await post('/v1/items/itm_1/transfer', { to: { external_id: 'player-b' }, amount: 1 });
    const again = await post('/v1/items/itm_1/transfer', { to: { external_id: 'player-b' }, amount: 1 });

    expect(again.statusCode).toBe(202);
    expect(again.json()).toEqual(first.json());
    expect(seen).toHaveLength(1);
  });

  it('una acción sin aceptar se reenvía como se registró, no con los datos nuevos', async () => {
    answer = { status: 503, body: { error: { code: 'INSUFFICIENT_FUNDS', message: 'sin fondos', retryable: true } } };
    await post('/v1/items/itm_1/transfer', { to: { external_id: 'player-b' }, amount: 1 });
    answer = { status: 202, body: { operation_id: 'opr_1' } };
    const retried = await post('/v1/items/itm_1/transfer', { to: { external_id: 'player-c' }, amount: 5 });

    expect(retried.statusCode).toBe(202);
    expect(seen).toHaveLength(2);
    expect(seen[1]?.body).toEqual({ to: { external_id: 'player-b' }, amount: 1, from: { external_id: 'player-a' } });
    expect(seen[1]?.headers['idempotency-key']).toBe(KEY);
  });
});

describe('backend caído', () => {
  it('responde 500 / INTERNAL y la acción queda registrada para el reintento', async () => {
    await game.close();
    await backend.close();
    await start('http://127.0.0.1:9');

    const response = await post('/v1/items/itm_1/transfer', { to: { external_id: 'player-b' }, amount: 1 });

    expect(response.statusCode).toBe(500);
    expect(response.json().error).toEqual({ code: 'INTERNAL', message: 'el backend no responde', retryable: true });
    expect(db.prepare('SELECT route, status_code FROM actions WHERE key = ?').get(KEY)).toEqual({
      route: '/v1/items/itm_1/transfer',
      status_code: null,
    });
  });
});
