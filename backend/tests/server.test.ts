/**
 * Servidor HTTP (bloques 3 y 4): credenciales, idempotencia, validacion estricta y las rutas del
 * hito, con SQLite en memoria y un RPC falso que registra lo que se envia. Lo enviado se decodifica
 * para comprobar el invariante 1 sobre lo que de verdad sale del backend.
 */
import { AccountState, getTokenEncoder } from '@solana-program/token-2022';
import {
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Address,
  type KeyPairSigner,
} from '@solana/kit';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { findGameAddress, findItemMintAddress } from '../src/addresses.js';
import { openDatabase, type Db } from '../src/db.js';
import { resolveHolder } from '../src/holders.js';
import { deriveAuthority, derivePlayer } from '../src/keys.js';
import { transitionOperation } from '../src/operations.js';
import { buildServer, type ChainRpc } from '../src/server.js';
import { authoritySigner } from '../src/transactions.js';
import { chainRpc, fakeChain, type FakeChain } from './fake-rpc.js';
import { SYSTEM_PROGRAM_ADDRESS } from '../src/submission.js';
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';

const SEED = Uint8Array.from(Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex'));
const WRITE = 'w'.repeat(40);
const READ = 'r'.repeat(40);
const GAME_ID = 'test-game';

let db: Db;
let chain: FakeChain;
let app: FastifyInstance;
let authority: KeyPairSigner;
let keyCounter = 0;

async function start(gameId = GAME_ID, readRateLimit?: number): Promise<void> {
  db = openDatabase(':memory:');
  chain = fakeChain();
  authority = await authoritySigner(deriveAuthority(SEED, gameId));
  app = await buildServer({
    db,
    gameId,
    masterSeed: SEED,
    writeKey: WRITE,
    readToken: READ,
    authority,
    rpc: chainRpc(chain) as ChainRpc,
    ...(readRateLimit === undefined ? {} : { readRateLimit }),
  });
}

beforeEach(async () => {
  await start();
});

interface Call {
  method?: 'GET' | 'POST' | 'PATCH';
  url: string;
  body?: unknown;
  token?: string | null;
  key?: string | null;
}

async function call({ method = 'POST', url, body, token, key }: Call) {
  const headers: Record<string, string> = {};
  const credential = token === undefined ? (method === 'GET' ? READ : WRITE) : token;
  if (credential !== null) headers['authorization'] = `Bearer ${credential}`;
  if (method !== 'GET') {
    const k = key === undefined ? `clave-${++keyCounter}` : key;
    if (k !== null) headers['idempotency-key'] = k;
  }
  const response = await app.inject({ method, url, headers, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: response.statusCode, body: response.json() as Record<string, unknown> };
}

const errorOf = (r: { body: Record<string, unknown> }) => (r.body['error'] as { code: string }).code;

async function newCollection(): Promise<string> {
  const r = await call({ url: '/v1/collections', body: { name: 'Armeria' } });
  expect(r.status).toBe(201);
  return r.body['collection_id'] as string;
}

const SWORD = {
  name: 'Espada de hierro',
  symbol: 'SWORD',
  uri: 'https://ejemplo.test/espada.json',
  qualities: { rarity: 'common', damage: '12' },
};

async function newItem(collection: string, holder: object = { external_id: 'player-42' }, amount = 1) {
  return call({ url: '/v1/items', body: { collection_id: collection, ...SWORD, initial_grant: { holder, amount } } });
}

function signersOf(wire: string): { count: number; first: Address | undefined } {
  const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(wire));
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  return { count: message.header.numSignerAccounts, first: message.staticAccounts[0] };
}

const operationRow = (id: string) =>
  db
    .prepare(
      'SELECT kind, state, step, payload, signature, last_valid_block_height AS lvbh FROM operations WHERE operation_id = ?',
    )
    .get(id) as {
    kind: string;
    state: string;
    step: number;
    payload: string | null;
    signature: string | null;
    lvbh: number | null;
  };

/** Logs de una transaccion en la que falla, por dentro, `program` con `Custom: 1`. */
const customOneFrom = (program: string) => ({
  err: { InstructionError: [0, { Custom: 1 }] } as never,
  logs: [
    'Program 4SUNiKmyk4QtXhU2oNGn6uiXiSUevRdmXpZdRFXPeLNz invoke [1]',
    `Program ${program} invoke [2]`,
    `Program ${program} failed: custom program error: 0x1`,
    'Program 4SUNiKmyk4QtXhU2oNGn6uiXiSUevRdmXpZdRFXPeLNz failed: custom program error: 0x1',
  ],
});

describe('credenciales (contrato, 2)', () => {
  it('una escritura sin credencial, o con el read_token, es 401 REJECTED', async () => {
    for (const token of [null, READ, 'otra']) {
      const r = await call({ url: '/v1/collections', body: { name: 'x' }, token });
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: { code: 'REJECTED', message: expect.any(String), retryable: false } });
    }
  });

  it('una lectura con el write_key es 401', async () => {
    const r = await call({ method: 'GET', url: '/v1/operations/opr_x', token: WRITE });
    expect(r.status).toBe(401);
  });
});

describe('idempotencia (contrato, 3)', () => {
  it('sin Idempotency-Key, o con una de mas de 128 caracteres, es 400', async () => {
    expect((await call({ url: '/v1/collections', body: { name: 'x' }, key: null })).status).toBe(400);
    expect((await call({ url: '/v1/collections', body: { name: 'x' }, key: 'k'.repeat(129) })).status).toBe(400);
  });

  it('repetir la clave devuelve el mismo cuerpo, aunque cambie el cuerpo, y no envia nada mas', async () => {
    const collection = await newCollection();
    const body = { collection_id: collection, ...SWORD, initial_grant: { holder: { external_id: 'player-42' }, amount: 1 } };
    const first = await call({ url: '/v1/items', body, key: 'repetida' });
    const again = await call({ url: '/v1/items', body: { ...body, name: 'Otro nombre' }, key: 'repetida' });
    expect(first.status).toBe(202);
    expect(again).toEqual(first);
    expect(chain.sent).toHaveLength(1);
    expect(db.prepare('SELECT count(*) AS n FROM items').get()).toEqual({ n: 1 });
  });

  it('una peticion rechazada no guarda la clave', async () => {
    const body = { collection_id: 'col_nada', ...SWORD, initial_grant: { holder: { external_id: 'p' }, amount: 1 } };
    expect((await call({ url: '/v1/items', body, key: 'k1' })).status).toBe(404);
    const collection = await newCollection();
    expect((await call({ url: '/v1/items', body: { ...body, collection_id: collection }, key: 'k1' })).status).toBe(202);
  });
});

describe('validacion estricta (contrato, 8)', () => {
  it('rechaza campos desconocidos, JSON roto y tipos incorrectos', async () => {
    expect(errorOf(await call({ url: '/v1/collections', body: { name: 'x', extra: 1 } }))).toBe('REJECTED');
    const broken = await app.inject({
      method: 'POST',
      url: '/v1/collections',
      headers: { authorization: `Bearer ${WRITE}`, 'idempotency-key': 'k', 'content-type': 'application/json' },
      payload: '{"name":',
    });
    expect(broken.statusCode).toBe(400);
    expect((broken.json() as { error: { code: string } }).error.code).toBe('REJECTED');
  });

  it('una ruta fuera del hito es 404 NOT_FOUND', async () => {
    const r = await call({ url: '/v1/items/itm_x/grants', body: { holder: { external_id: 'p' }, amount: 1 } });
    expect(r.status).toBe(404);
    expect(errorOf(r)).toBe('NOT_FOUND');
  });
});

describe('POST /v1/collections', () => {
  it('201 con collection_id, sin operation_id, y sin tocar la cadena', async () => {
    const r = await call({ url: '/v1/collections', body: { name: 'Armeria' } });
    expect(r.status).toBe(201);
    expect(Object.keys(r.body)).toEqual(['collection_id']);
    expect(r.body['collection_id']).toMatch(/^col_/);
    expect(chain.sent).toEqual([]);
  });
});

describe('POST /v1/items', () => {
  it('202 con operation_id, item_id y holder_id; registra y envia UNA transaccion de una firma', async () => {
    const r = await newItem(await newCollection());
    expect(r.status).toBe(202);
    const player = derivePlayer(SEED, GAME_ID, 'player-42');
    expect(r.body).toEqual({ operation_id: expect.stringMatching(/^opr_/), item_id: expect.stringMatching(/^itm_/), holder_id: player.holderId });

    const operation = operationRow(r.body['operation_id'] as string);
    expect(operation).toMatchObject({ kind: 'create_item', state: 'pending', step: 1, payload: null, lvbh: 100 });
    expect(operation.signature).not.toBeNull();

    const item = db.prepare('SELECT mint, qualities FROM items WHERE item_id = ?').get(r.body['item_id']) as {
      mint: string;
      qualities: string;
    };
    expect(item.mint).toBe(await findItemMintAddress(await findGameAddress(GAME_ID), r.body['item_id'] as string));
    expect(JSON.parse(item.qualities)).toEqual(SWORD.qualities);

    expect(chain.sent).toHaveLength(1);
    expect(signersOf(chain.sent[0] as string)).toEqual({ count: 1, first: authority.address });
    // Simulada antes de reclamar la clave, y enviada sin volver a simular.
    expect(chain.simulations).toBe(1);
    expect(chain.sendOptions).toEqual([{ encoding: 'base64', skipPreflight: true }]);
  });

  it('si la autoridad no puede pagar es 503 INSUFFICIENT_FUNDS, sin enviar ni guardar la clave', async () => {
    const collection = await newCollection();
    for (const simulation of [
      { err: 'InsufficientFundsForFee' as const, logs: [] },
      customOneFrom(SYSTEM_PROGRAM_ADDRESS),
    ]) {
      chain.simulation = simulation;
      const r = await call({ url: '/v1/items', body: { collection_id: collection, ...SWORD, initial_grant: { holder: { external_id: 'p' }, amount: 1 } }, key: 'sin-fondos' });
      expect(r.status).toBe(503);
      expect(r.body).toEqual({ error: { code: 'INSUFFICIENT_FUNDS', message: expect.any(String), retryable: true } });
    }
    expect(chain.sent).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM idempotency WHERE key = 'sin-fondos'").get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM operations').get()).toEqual({ n: 0 });

    // Recargada la autoridad, la misma clave se acepta.
    chain.simulation = null;
    const r = await call({ url: '/v1/items', body: { collection_id: collection, ...SWORD, initial_grant: { holder: { external_id: 'p' }, amount: 1 } }, key: 'sin-fondos' });
    expect(r.status).toBe(202);
  });

  it('una simulacion fallida sin categoria es 500 INTERNAL', async () => {
    const collection = await newCollection();
    chain.simulation = { err: { InstructionError: [0, { Custom: 6000 }] } as never, logs: [] };
    const r = await newItem(collection);
    expect(r.status).toBe(500);
    expect(errorOf(r)).toBe('INTERNAL');
    expect(chain.sent).toEqual([]);
  });

  it('valida los limites del contrato en caracteres, no en bytes', async () => {
    const collection = await newCollection();
    const base = { collection_id: collection, ...SWORD, initial_grant: { holder: { external_id: 'p' }, amount: 1 } };
    expect((await call({ url: '/v1/items', body: { ...base, name: 'ñ'.repeat(32) } })).status).toBe(202);
    for (const bad of [
      { name: 'a'.repeat(33) },
      { symbol: '' },
      { uri: 'u'.repeat(201) },
      { qualities: { collection: 'x' } },
      { qualities: Object.fromEntries([...Array(9).keys()].map((i) => [`k${i}`, 'v'])) },
      { initial_grant: { holder: { external_id: 'p' }, amount: 0 } },
      { initial_grant: { holder: { external_id: 'p', holder_id: 'hld_x' }, amount: 1 } },
      { initial_grant: { holder: { external_id: 'e'.repeat(65) }, amount: 1 } },
    ]) {
      const r = await call({ url: '/v1/items', body: { ...base, ...bad } });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('un holder_id sin registrar es 404', async () => {
    const r = await newItem(await newCollection(), { holder_id: 'hld_nada' });
    expect(r.status).toBe(404);
  });

  it('un tipo que no cabe junto se parte: envia create_item y guarda el grant en el payload (P11)', async () => {
    const qualities = Object.fromEntries([...Array(7).keys()].map((i) => [`${i}`.padEnd(32, 'k'), 'v'.repeat(64)]));
    const r = await call({
      url: '/v1/items',
      body: { collection_id: await newCollection(), name: 'a', symbol: 'A', qualities, initial_grant: { holder: { external_id: 'player-42' }, amount: 3 } },
    });
    expect(r.status).toBe(202);
    const operation = operationRow(r.body['operation_id'] as string);
    expect(operation.step).toBe(1);
    expect(JSON.parse(operation.payload as string)).toEqual({ holder: derivePlayer(SEED, GAME_ID, 'player-42').address, amount: 3 });
    expect(chain.sent).toHaveLength(1);
    expect(signersOf(chain.sent[0] as string).count).toBe(1);
  });

  it('un tipo que no cabe ni solo es 400 y no toca la cadena ni guarda la clave', async () => {
    const qualities = Object.fromEntries([...Array(8).keys()].map((i) => [`${i}`.padEnd(32, 'k'), 'v'.repeat(64)]));
    const r = await call({
      url: '/v1/items',
      body: {
        collection_id: await newCollection(),
        name: 'n'.repeat(32),
        symbol: 's'.repeat(10),
        uri: 'u'.repeat(200),
        qualities,
        initial_grant: { holder: { external_id: 'p' }, amount: 1 },
      },
      key: 'grande',
    });
    expect(r.status).toBe(400);
    expect(chain.sent).toEqual([]);
    expect(db.prepare("SELECT count(*) AS n FROM idempotency WHERE key = 'grande'").get()).toEqual({ n: 0 });
  });
});

describe('POST /v1/items/{item_id}/transfer', () => {
  async function itemId(): Promise<string> {
    const r = await newItem(await newCollection());
    chain.sent.length = 0;
    return r.body['item_id'] as string;
  }

  it('202 con los dos holder_id; envia una transaccion de una firma', async () => {
    const item = await itemId();
    const r = await call({
      url: `/v1/items/${item}/transfer`,
      body: { from: { external_id: 'player-42' }, to: { external_id: 'player-77' }, amount: 1 },
    });
    expect(r.status).toBe(202);
    expect(r.body).toEqual({
      operation_id: expect.stringMatching(/^opr_/),
      from_holder_id: derivePlayer(SEED, GAME_ID, 'player-42').holderId,
      to_holder_id: derivePlayer(SEED, GAME_ID, 'player-77').holderId,
    });
    expect(operationRow(r.body['operation_id'] as string)).toMatchObject({ kind: 'transfer', state: 'pending' });
    expect(chain.sent).toHaveLength(1);
    expect(signersOf(chain.sent[0] as string)).toEqual({ count: 1, first: authority.address });
  });

  it('el mismo tenedor por las dos vias es 400', async () => {
    const item = await itemId();
    const holderId = derivePlayer(SEED, GAME_ID, 'player-42').holderId;
    const r = await call({
      url: `/v1/items/${item}/transfer`,
      body: { from: { external_id: 'player-42' }, to: { holder_id: holderId }, amount: 1 },
    });
    expect(r.status).toBe(400);
  });

  it('un emisor sin unidades de ese tipo es 409 INSUFFICIENT_BALANCE', async () => {
    const item = await itemId();
    chain.senderAmount = null;
    const r = await call({
      url: `/v1/items/${item}/transfer`,
      body: { from: { external_id: 'player-77' }, to: { external_id: 'player-42' }, amount: 1 },
    });
    expect(r.status).toBe(409);
    expect(errorOf(r)).toBe('INSUFFICIENT_BALANCE');
    expect(chain.sent).toEqual([]);
  });

  it('un emisor con cuenta y saldo insuficiente es 409, sin enviar', async () => {
    const item = await itemId();
    chain.senderAmount = 1n;
    const r = await call({
      url: `/v1/items/${item}/transfer`,
      body: { from: { external_id: 'player-42' }, to: { external_id: 'player-77' }, amount: 2 },
    });
    expect(r.status).toBe(409);
    expect(errorOf(r)).toBe('INSUFFICIENT_BALANCE');
    expect(chain.sent).toEqual([]);
  });

  it('si el saldo cambia y lo rechaza Token-2022 en la simulacion, tambien es 409', async () => {
    const item = await itemId();
    chain.simulation = customOneFrom(TOKEN_2022_PROGRAM_ADDRESS);
    const r = await call({
      url: `/v1/items/${item}/transfer`,
      body: { from: { external_id: 'player-42' }, to: { external_id: 'player-77' }, amount: 1 },
    });
    expect(r.status).toBe(409);
    expect(errorOf(r)).toBe('INSUFFICIENT_BALANCE');
    expect(chain.sent).toEqual([]);
  });

  it('un tipo inexistente es 404', async () => {
    const r = await call({
      url: '/v1/items/itm_nada/transfer',
      body: { from: { external_id: 'a' }, to: { external_id: 'b' }, amount: 1 },
    });
    expect(r.status).toBe(404);
  });

  it('un reintento devuelve el original aunque el emisor ya no tenga cuenta', async () => {
    const item = await itemId();
    const body = { from: { external_id: 'player-42' }, to: { external_id: 'player-77' }, amount: 1 };
    const first = await call({ url: `/v1/items/${item}/transfer`, body, key: 't1' });
    chain.senderAmount = null;
    expect(await call({ url: `/v1/items/${item}/transfer`, body, key: 't1' })).toEqual(first);
    expect(chain.sent).toHaveLength(1);
  });
});

describe('GET /v1/holders/{holder_id}/items', () => {
  it('un holder_id sin registrar es 404', async () => {
    expect((await call({ method: 'GET', url: '/v1/holders/hld_nada/items' })).status).toBe(404);
  });

  /** El tipo de la fixture de devnet en manos de player-42, con su creacion en `state`. */
  async function inventoryWithCreation(state: 'settled' | 'applied' | 'failed') {
    // Juego y tipo de la fixture de devnet, para que la autoridad del mint sea la PDA de este juego.
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/devnet-item-mint.json', import.meta.url), 'utf8')) as {
      address: Address;
      gameId: string;
      itemId: string;
      data: string;
    };
    await start(fixture.gameId);
    const collection = 'col_xR2SNQ2Am7QiZC1a';
    db.prepare("INSERT INTO collections VALUES (?, ?, 'Armeria', 't')").run(collection, fixture.gameId);
    db.prepare(
      "INSERT INTO operations (operation_id, kind, state, error_code, created_at, updated_at) VALUES ('opr_1', 'create_item', ?, ?, 't', 't')",
    ).run(state, state === 'failed' ? 'EXPIRED' : null);
    db.prepare(
      `INSERT INTO items (item_id, collection_id, mint, name, symbol, uri, qualities, operation_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'opr_1', 't')`,
    ).run(fixture.itemId, collection, fixture.address, SWORD.name, SWORD.symbol, SWORD.uri, JSON.stringify(SWORD.qualities));

    const player = derivePlayer(SEED, fixture.gameId, 'player-42');
    // Registrado como lo hace cualquier escritura que lo nombra por su external_id.
    resolveHolder(db, { masterSeed: SEED, gameId: fixture.gameId }, { external_id: 'player-42' });

    chain.mints[fixture.address] = Uint8Array.from(Buffer.from(fixture.data, 'base64'));
    chain.tokenAccounts = [
      Uint8Array.from(
        getTokenEncoder().encode({
          mint: fixture.address,
          owner: player.address as Address,
          amount: 2n,
          delegate: null,
          state: AccountState.Initialized,
          isNative: null,
          delegatedAmount: 0,
          closeAuthority: null,
          extensions: null,
        }),
      ),
    ];
    const r = await call({ method: 'GET', url: `/v1/holders/${player.holderId}/items` });
    expect(r.status).toBe(200);
    return { r, player, fixture, collection };
  }

  it('devuelve el holder_id y sus tipos, con la forma del contrato', async () => {
    const { r, player, fixture, collection } = await inventoryWithCreation('settled');
    expect(r.body).toEqual({
      holder_id: player.holderId,
      items: [{ item_id: fixture.itemId, collection_id: collection, ...SWORD, amount: 2 }],
    });
  });

  it('un tipo cuya creacion no esta en settled no aparece, aunque la cadena tenga saldo (contrato, 5.4)', async () => {
    for (const state of ['applied', 'failed'] as const) {
      const { r, player } = await inventoryWithCreation(state);
      expect(r.body).toEqual({ holder_id: player.holderId, items: [] });
    }
  });
});

describe('GET /v1/collections y GET /v1/items (contrato, 5.3 y 5.4)', () => {
  it('sin catalogo, listas vacias', async () => {
    expect((await call({ method: 'GET', url: '/v1/collections' })).body).toEqual({ collections: [] });
    expect((await call({ method: 'GET', url: '/v1/items' })).body).toEqual({ items: [] });
  });

  it('colecciones, la mas reciente primero, con la forma del contrato', async () => {
    const first = await newCollection();
    const second = (await call({ url: '/v1/collections', body: { name: 'Bestiario' } })).body['collection_id'];
    const r = await call({ method: 'GET', url: '/v1/collections' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      collections: [
        { collection_id: second, name: 'Bestiario', created_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/) },
        { collection_id: first, name: 'Armeria', created_at: expect.any(String) },
      ],
    });
  });

  it('un create_item que caduca sigue en el listado con state failed, y nunca como settled', async () => {
    const collection = await newCollection();
    const expired = await newItem(collection);
    const settled = await newItem(collection);
    // Lo que hace el seguimiento cuando la altura finalizada pasa la cota sin ver la firma (V18).
    transitionOperation(db, expired.body['operation_id'] as string, 'failed', { code: 'EXPIRED', message: 'caducada' });
    transitionOperation(db, settled.body['operation_id'] as string, 'applied');
    transitionOperation(db, settled.body['operation_id'] as string, 'settled');

    const r = await call({ method: 'GET', url: '/v1/items' });
    expect(r.status).toBe(200);
    const items = r.body['items'] as Record<string, unknown>[];
    expect(items.map((i) => [i['item_id'], i['state']])).toEqual([
      [settled.body['item_id'], 'settled'],
      [expired.body['item_id'], 'failed'],
    ]);
    expect(items[0]).toEqual({
      item_id: settled.body['item_id'],
      collection_id: collection,
      ...SWORD,
      operation_id: settled.body['operation_id'],
      state: 'settled',
      revision: 0,
      edit: null,
      created_at: expect.any(String),
    });
  });

  it('filtra por collection_id; una coleccion inexistente es 404 y un parametro desconocido, 400', async () => {
    const armeria = await newCollection();
    const bestiario = (await call({ url: '/v1/collections', body: { name: 'Bestiario' } })).body['collection_id'] as string;
    const sword = await newItem(armeria);
    await newItem(bestiario);

    const r = await call({ method: 'GET', url: `/v1/items?collection_id=${armeria}` });
    expect((r.body['items'] as { item_id: string }[]).map((i) => i.item_id)).toEqual([sword.body['item_id']]);
    expect((await call({ method: 'GET', url: '/v1/items?collection_id=col_nada' })).status).toBe(404);
    const unknown = await call({ method: 'GET', url: '/v1/items?coleccion=x' });
    expect(unknown.status).toBe(400);
    expect(errorOf(unknown)).toBe('REJECTED');
  });

  it('son lecturas: exigen el read_token y rechazan el write_key', async () => {
    for (const url of ['/v1/collections', '/v1/items']) {
      expect((await call({ method: 'GET', url, token: WRITE })).status).toBe(401);
      expect((await call({ method: 'GET', url, token: null })).status).toBe(401);
    }
  });
});

describe('limite de tasa de las lecturas (P14)', () => {
  it('pasado el limite por IP, 429 RATE_LIMITED con Retry-After, tambien con credencial invalida', async () => {
    await start(GAME_ID, 3);
    for (let i = 0; i < 2; i++) expect((await call({ method: 'GET', url: '/v1/collections' })).status).toBe(200);
    // Una credencial invalida tambien cuenta: el limite va antes, para que no sirva para probar tokens.
    expect((await call({ method: 'GET', url: '/v1/items', token: 'x'.repeat(40) })).status).toBe(401);

    const limited = await app.inject({ method: 'GET', url: '/v1/operations/opr_x', headers: { authorization: `Bearer ${READ}` } });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(limited.json()).toEqual({ error: { code: 'RATE_LIMITED', message: expect.any(String), retryable: true } });
  });

  it('las escrituras no cuentan', async () => {
    await start(GAME_ID, 1);
    for (let i = 0; i < 3; i++) await newCollection();
    expect((await call({ method: 'GET', url: '/v1/collections' })).status).toBe(200);
    expect((await call({ method: 'GET', url: '/v1/collections' })).status).toBe(429);
  });
});

describe('limite de tasa del nodo (contrato, 6)', () => {
  it('un HTTP 429 del nodo es 429 RATE_LIMITED con su Retry-After, en escrituras y lecturas', async () => {
    const collection = await newCollection();
    const holder = derivePlayer(SEED, GAME_ID, 'player-42');
    resolveHolder(db, { masterSeed: SEED, gameId: GAME_ID }, { external_id: 'player-42' });
    chain.rateLimited = true;

    const write = await app.inject({
      method: 'POST',
      url: '/v1/items',
      headers: { authorization: `Bearer ${WRITE}`, 'idempotency-key': 'limitada' },
      payload: { collection_id: collection, ...SWORD, initial_grant: { holder: { external_id: 'player-42' }, amount: 1 } },
    });
    expect(write.statusCode).toBe(429);
    expect(write.headers['retry-after']).toBe('3');
    expect(write.json()).toEqual({ error: { code: 'RATE_LIMITED', message: expect.any(String), retryable: true } });
    expect(db.prepare("SELECT count(*) AS n FROM idempotency WHERE key = 'limitada'").get()).toEqual({ n: 0 });

    const read = await call({ method: 'GET', url: `/v1/holders/${holder.holderId}/items` });
    expect(read.status).toBe(429);
    expect(errorOf(read)).toBe('RATE_LIMITED');
  });
});

describe('GET /v1/operations/{operation_id}', () => {
  it('devuelve el estado sin firma ni datos de red; una inexistente es 404', async () => {
    const created = await newItem(await newCollection());
    const r = await call({ method: 'GET', url: `/v1/operations/${created.body['operation_id'] as string}` });
    expect(r.body).toEqual({ operation_id: created.body['operation_id'], state: 'pending', error: null });
    expect((await call({ method: 'GET', url: '/v1/operations/opr_nada' })).status).toBe(404);
  });
});
