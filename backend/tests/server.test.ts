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
import { buildServer, type ChainRpc } from '../src/server.js';
import { authoritySigner } from '../src/transactions.js';
import { chainRpc, type FakeChain } from './fake-rpc.js';

const SEED = Uint8Array.from(Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex'));
const WRITE = 'w'.repeat(40);
const READ = 'r'.repeat(40);
const GAME_ID = 'test-game';

let db: Db;
let chain: FakeChain;
let app: FastifyInstance;
let authority: KeyPairSigner;
let keyCounter = 0;

async function start(gameId = GAME_ID): Promise<void> {
  db = openDatabase(':memory:');
  chain = { senderAccount: true, tokenAccounts: [], mints: {}, sent: [] };
  authority = await authoritySigner(deriveAuthority(SEED, gameId));
  app = await buildServer({
    db,
    gameId,
    masterSeed: SEED,
    writeKey: WRITE,
    readToken: READ,
    authority,
    rpc: chainRpc(chain) as ChainRpc,
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
  db.prepare('SELECT kind, state, step, payload, signature FROM operations WHERE operation_id = ?').get(id) as {
    kind: string;
    state: string;
    step: number;
    payload: string | null;
    signature: string | null;
  };

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
    expect(operation).toMatchObject({ kind: 'create_item', state: 'pending', step: 1, payload: null });
    expect(operation.signature).not.toBeNull();

    const item = db.prepare('SELECT mint, qualities FROM items WHERE item_id = ?').get(r.body['item_id']) as {
      mint: string;
      qualities: string;
    };
    expect(item.mint).toBe(await findItemMintAddress(await findGameAddress(GAME_ID), r.body['item_id'] as string));
    expect(JSON.parse(item.qualities)).toEqual(SWORD.qualities);

    expect(chain.sent).toHaveLength(1);
    expect(signersOf(chain.sent[0] as string)).toEqual({ count: 1, first: authority.address });
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
    chain.senderAccount = false;
    const r = await call({
      url: `/v1/items/${item}/transfer`,
      body: { from: { external_id: 'player-77' }, to: { external_id: 'player-42' }, amount: 1 },
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
    chain.senderAccount = false;
    expect(await call({ url: `/v1/items/${item}/transfer`, body, key: 't1' })).toEqual(first);
    expect(chain.sent).toHaveLength(1);
  });
});

describe('GET /v1/holders/{holder_id}/items', () => {
  it('un holder_id sin registrar es 404', async () => {
    expect((await call({ method: 'GET', url: '/v1/holders/hld_nada/items' })).status).toBe(404);
  });

  it('devuelve el holder_id y sus tipos, con la forma del contrato', async () => {
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
      "INSERT INTO operations (operation_id, kind, state, created_at, updated_at) VALUES ('opr_1', 'create_item', 'settled', 't', 't')",
    ).run();
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
    expect(r.body).toEqual({
      holder_id: player.holderId,
      items: [{ item_id: fixture.itemId, collection_id: collection, ...SWORD, amount: 2 }],
    });
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
