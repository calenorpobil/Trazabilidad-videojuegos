/**
 * Bucle de seguimiento (bloque 5): las operaciones nacen por HTTP, como en produccion, y la cadena
 * falsa dice en que estado esta cada firma y que altura hay finalizada.
 */
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import {
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type KeyPairSigner,
} from '@solana/kit';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db.js';
import { deriveAuthority } from '../src/keys.js';
import { getOperation } from '../src/operations.js';
import { buildServer, type ChainRpc } from '../src/server.js';
import { SYSTEM_PROGRAM_ADDRESS } from '../src/submission.js';
import { trackOnce, type TrackerOptions } from '../src/tracker.js';
import { authoritySigner } from '../src/transactions.js';
import { chainRpc, fakeChain, type FakeChain } from './fake-rpc.js';

const SEED = Uint8Array.from(Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex'));
const GAME_ID = 'test-game';
const WRITE = 'w'.repeat(40);

let db: Db;
let chain: FakeChain;
let app: FastifyInstance;
let authority: KeyPairSigner;
let tracker: TrackerOptions;
let keyCounter = 0;

beforeEach(async () => {
  db = openDatabase(':memory:');
  chain = fakeChain();
  authority = await authoritySigner(deriveAuthority(SEED, GAME_ID));
  const rpc = chainRpc(chain) as ChainRpc;
  app = await buildServer({ db, gameId: GAME_ID, masterSeed: SEED, writeKey: WRITE, readToken: 'r'.repeat(40), authority, rpc });
  tracker = { db, rpc, gameId: GAME_ID, authority };
});

async function post(url: string, body: object): Promise<Record<string, unknown>> {
  const r = await app.inject({
    method: 'POST',
    url,
    headers: { authorization: `Bearer ${WRITE}`, 'idempotency-key': `k-${++keyCounter}` },
    payload: body,
  });
  expect(r.statusCode, r.body).toBeLessThan(300);
  return r.json() as Record<string, unknown>;
}

/** Crea un tipo; con `split`, uno que no cabe junto con su grant (P11). Devuelve la operacion. */
async function newItem(split = false): Promise<{ operationId: string; itemId: string }> {
  const { collection_id } = await post('/v1/collections', { name: 'Armeria' });
  const qualities = split
    ? Object.fromEntries([...Array(7).keys()].map((i) => [`${i}`.padEnd(32, 'k'), 'v'.repeat(64)]))
    : { rarity: 'common' };
  const r = await post('/v1/items', {
    collection_id,
    name: 'Espada',
    symbol: 'SWORD',
    qualities,
    initial_grant: { holder: { external_id: 'player-42' }, amount: 3 },
  });
  return { operationId: r['operation_id'] as string, itemId: r['item_id'] as string };
}

const row = (id: string) =>
  db.prepare('SELECT state, step, payload, signature, last_valid_block_height AS lvbh FROM operations WHERE operation_id = ?').get(id) as {
    state: string;
    step: number;
    payload: string | null;
    signature: string;
    lvbh: number;
  };

const stateOf = (id: string) => getOperation(db, id)?.state;

describe('camino feliz', () => {
  it('confirmed -> applied y finalized -> settled', async () => {
    const { operationId } = await newItem();
    const { signature } = row(operationId);

    await trackOnce(tracker);
    expect(stateOf(operationId)).toBe('pending');

    chain.statuses[signature] = { confirmationStatus: 'processed', err: null };
    await trackOnce(tracker);
    expect(stateOf(operationId)).toBe('pending');

    chain.statuses[signature] = { confirmationStatus: 'confirmed', err: null };
    await trackOnce(tracker);
    expect(stateOf(operationId)).toBe('applied');

    chain.statuses[signature] = { confirmationStatus: 'finalized', err: null };
    await trackOnce(tracker);
    expect(getOperation(db, operationId)).toEqual({ operation_id: operationId, state: 'settled', error: null });
  });

  it('de pending a finalized en una sola vuelta llega a settled', async () => {
    const { operationId } = await newItem();
    chain.statuses[row(operationId).signature] = { confirmationStatus: 'finalized', err: null };
    await trackOnce(tracker);
    expect(stateOf(operationId)).toBe('settled');
  });

  it('sin operaciones abiertas no llama al nodo', async () => {
    chain.rateLimited = true;
    await expect(trackOnce(tracker)).resolves.toBeUndefined();
  });
});

describe('caducidad (P13)', () => {
  it('una firma que no aparece sigue en pending hasta pasar su altura, y entonces es EXPIRED', async () => {
    const { operationId } = await newItem();
    expect(row(operationId).lvbh).toBe(100);

    chain.blockHeight = 100n;
    await trackOnce(tracker);
    expect(stateOf(operationId)).toBe('pending');

    chain.blockHeight = 101n;
    await trackOnce(tracker);
    expect(getOperation(db, operationId)).toEqual({
      operation_id: operationId,
      state: 'failed',
      error: { code: 'EXPIRED', message: expect.any(String), retryable: true },
    });
  });

  it('una applied que desaparece caduca igual: applied -> failed', async () => {
    const { operationId } = await newItem();
    const { signature } = row(operationId);
    chain.statuses[signature] = { confirmationStatus: 'confirmed', err: null };
    await trackOnce(tracker);
    expect(stateOf(operationId)).toBe('applied');

    delete chain.statuses[signature];
    await trackOnce(tracker);
    expect(stateOf(operationId)).toBe('applied');
    chain.blockHeight = 101n;
    await trackOnce(tracker);
    expect(getOperation(db, operationId)?.error?.code).toBe('EXPIRED');
  });

  it('una firma registrada y nunca enviada tambien caduca', async () => {
    const { operationId } = await newItem();
    chain.sent.length = 0; // como si el backend se hubiera reiniciado antes de enviar
    chain.blockHeight = 500n;
    await trackOnce(tracker);
    expect(getOperation(db, operationId)?.error?.code).toBe('EXPIRED');
  });
});

describe('fallos en la cadena', () => {
  const tokenFailure = [
    'Program 4SUNiKmyk4QtXhU2oNGn6uiXiSUevRdmXpZdRFXPeLNz invoke [1]',
    `Program ${TOKEN_2022_PROGRAM_ADDRESS} invoke [2]`,
    `Program ${TOKEN_2022_PROGRAM_ADDRESS} failed: custom program error: 0x1`,
    'Program 4SUNiKmyk4QtXhU2oNGn6uiXiSUevRdmXpZdRFXPeLNz failed: custom program error: 0x1',
  ];

  it('un error solo es final en finalized, y se clasifica con los logs', async () => {
    const { itemId } = await newItem();
    const transfer = await post(`/v1/items/${itemId}/transfer`, {
      from: { external_id: 'player-42' },
      to: { external_id: 'player-77' },
      amount: 1,
    });
    const operationId = transfer['operation_id'] as string;
    const { signature } = row(operationId);
    chain.transactionLogs = tokenFailure;

    chain.statuses[signature] = { confirmationStatus: 'confirmed', err: { InstructionError: [0, { Custom: 1 }] } };
    await trackOnce(tracker);
    expect(stateOf(operationId)).toBe('pending');

    chain.statuses[signature] = { confirmationStatus: 'finalized', err: { InstructionError: [0, { Custom: 1 }] } };
    await trackOnce(tracker);
    expect(getOperation(db, operationId)?.error).toEqual({
      code: 'INSUFFICIENT_BALANCE',
      message: expect.any(String),
      retryable: false,
    });
  });

  it('un fallo del nodo deja las operaciones como estaban', async () => {
    const { operationId } = await newItem();
    chain.rateLimited = true;
    chain.blockHeight = 500n;
    await expect(trackOnce(tracker)).rejects.toThrow();
    expect(stateOf(operationId)).toBe('pending');
  });
});

describe('tipo partido: el grant desde el payload (P11)', () => {
  it('sigue en pending hasta que el paso 1 es final; entonces envia el grant y lo sigue', async () => {
    const { operationId } = await newItem(true);
    const step1 = row(operationId);
    expect(step1).toMatchObject({ state: 'pending', step: 1 });
    expect(step1.payload).not.toBeNull();
    chain.sent.length = 0;

    chain.statuses[step1.signature] = { confirmationStatus: 'confirmed', err: null };
    await trackOnce(tracker);
    expect(stateOf(operationId)).toBe('pending');
    expect(chain.sent).toEqual([]);

    chain.lastValidBlockHeight = 200n;
    chain.statuses[step1.signature] = { confirmationStatus: 'finalized', err: null };
    await trackOnce(tracker);
    const step2 = row(operationId);
    expect(step2).toMatchObject({ state: 'pending', step: 2, payload: null, lvbh: 200 });
    expect(step2.signature).not.toBe(step1.signature);

    // Una transaccion, de una sola firma, la de la autoridad (invariante 1).
    expect(chain.sent).toHaveLength(1);
    const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(chain.sent[0] as string));
    const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    expect(message.header.numSignerAccounts).toBe(1);
    expect(message.staticAccounts[0]).toBe(authority.address);

    // Otra vuelta con el paso 1 aun visible no envia nada mas: ya no es el que se sigue.
    await trackOnce(tracker);
    expect(chain.sent).toHaveLength(1);

    chain.statuses[step2.signature] = { confirmationStatus: 'confirmed', err: null };
    await trackOnce(tracker);
    expect(stateOf(operationId)).toBe('applied');
    chain.statuses[step2.signature] = { confirmationStatus: 'finalized', err: null };
    await trackOnce(tracker);
    expect(stateOf(operationId)).toBe('settled');
  });

  it('si el grant no se puede pagar, la operacion es failed INSUFFICIENT_FUNDS y no se envia', async () => {
    const { operationId } = await newItem(true);
    chain.sent.length = 0;
    chain.simulation = {
      err: { InstructionError: [0, { Custom: 1 }] },
      logs: [`Program ${SYSTEM_PROGRAM_ADDRESS} failed: custom program error: 0x1`],
    };
    chain.statuses[row(operationId).signature] = { confirmationStatus: 'finalized', err: null };
    await trackOnce(tracker);
    expect(getOperation(db, operationId)?.error).toEqual({
      code: 'INSUFFICIENT_FUNDS',
      message: expect.any(String),
      retryable: true,
    });
    expect(chain.sent).toEqual([]);
  });
});
