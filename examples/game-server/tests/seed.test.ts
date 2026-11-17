/**
 * Los datos de demo contra un backend falso que escucha por HTTP: qué se pide, con qué claves y qué
 * pasa cuando el backend rechaza algo.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_ITEMS, SeedError, seedDemo } from '../src/seed.js';

const WRITE_KEY = 'w'.repeat(40);
const READ_TOKEN = 'r'.repeat(40);

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

let backend: FastifyInstance;
let url: string;
let seen: Seen[];
/** Respuesta a `POST /v1/items`: por defecto, aceptada. */
let itemAnswer: { status: number; body: unknown } | null;
/** Estados que devuelve cada consulta de una operación, en orden. */
let states: string[];

beforeEach(async () => {
  seen = [];
  itemAnswer = null;
  states = ['pending', 'settled'];
  let next = 0;
  backend = Fastify();
  backend.addHook('onRequest', async (request) => {
    seen.push({ method: request.method, url: request.url, headers: request.headers, body: undefined });
  });
  backend.post('/v1/collections', async (request, reply) => {
    seen[seen.length - 1]!.body = request.body;
    return reply.status(201).send({ collection_id: 'col_1' });
  });
  backend.post('/v1/items', async (request, reply) => {
    seen[seen.length - 1]!.body = request.body;
    if (itemAnswer !== null) return reply.status(itemAnswer.status).send(itemAnswer.body);
    next += 1;
    return reply.status(202).send({ operation_id: `opr_${next}`, item_id: `itm_${next}`, holder_id: 'hld_a' });
  });
  const polls = new Map<string, number>();
  backend.get<{ Params: { id: string } }>('/v1/operations/:id', async (request) => {
    const n = polls.get(request.params.id) ?? 0;
    polls.set(request.params.id, n + 1);
    return { operation_id: request.params.id, state: states[Math.min(n, states.length - 1)], error: null };
  });
  url = await backend.listen({ host: '127.0.0.1', port: 0 });
});

afterEach(async () => {
  await backend.close();
});

const options = (extra: object = {}) => ({
  backendUrl: url,
  writeKey: WRITE_KEY,
  tag: 'demo-seed',
  player: 'player-a',
  log: () => undefined,
  pollMs: 1,
  ...extra,
});

describe('datos de demo', () => {
  it('crea la colección y los tres tipos con claves fijas y entrega inicial al jugador', async () => {
    const result = await seedDemo(options());

    const writes = seen.filter((s) => s.method === 'POST');
    expect(writes.map((s) => s.headers['idempotency-key'])).toEqual([
      'demo-seed:collection',
      'demo-seed:sword',
      'demo-seed:shield',
      'demo-seed:potion',
    ]);
    expect(writes.every((s) => s.headers.authorization === `Bearer ${WRITE_KEY}`)).toBe(true);
    expect(writes[0]?.body).toEqual({ name: 'Armería de la demo' });
    expect(writes[1]?.body).toEqual({
      collection_id: 'col_1',
      name: 'Espada de hierro',
      symbol: 'SWORD',
      uri: '',
      qualities: { rarity: 'common', damage: '12' },
      initial_grant: { holder: { external_id: 'player-a' }, amount: 3 },
    });
    expect(result.items.map((i) => i.itemId)).toEqual(['itm_1', 'itm_2', 'itm_3']);
    // Sin read_token no se consulta nada.
    expect(seen.some((s) => s.method === 'GET')).toBe(false);
    expect(result.items.every((i) => i.state === null)).toBe(true);
  });

  it('la etiqueta cambia las claves, y con ellas el juego de datos', async () => {
    await seedDemo(options({ tag: 'otra' }));
    expect(seen.filter((s) => s.method === 'POST').map((s) => s.headers['idempotency-key'])).toEqual(
      ['collection', ...DEMO_ITEMS.map((i) => i.key)].map((k) => `otra:${k}`),
    );
  });

  it('con read_token espera a que cada creación llegue a su estado final', async () => {
    const result = await seedDemo(options({ readToken: READ_TOKEN }));

    expect(result.items.every((i) => i.state === 'settled')).toBe(true);
    const reads = seen.filter((s) => s.method === 'GET');
    expect(reads.every((s) => s.headers.authorization === `Bearer ${READ_TOKEN}`)).toBe(true);
    expect(reads.filter((s) => s.url === '/v1/operations/opr_1')).toHaveLength(2);
  });

  it('informa de una creación que acaba en failed', async () => {
    states = ['pending', 'failed'];
    const result = await seedDemo(options({ readToken: READ_TOKEN }));
    expect(result.items.every((i) => i.state === 'failed')).toBe(true);
  });

  it('un rechazo del backend detiene el resto, con su código y su mensaje', async () => {
    itemAnswer = {
      status: 503,
      body: { error: { code: 'INSUFFICIENT_FUNDS', message: 'sin fondos', retryable: true } },
    };
    await expect(seedDemo(options())).rejects.toThrow(SeedError);
    await expect(seedDemo(options())).rejects.toThrow(/INSUFFICIENT_FUNDS/);
    // Una colección y un intento de tipo por ejecución: no sigue con los demás.
    expect(seen.filter((s) => s.url === '/v1/items')).toHaveLength(2);
  });
});
