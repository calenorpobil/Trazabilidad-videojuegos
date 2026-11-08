/**
 * Decision de tamano al crear un tipo (propuesta, revision del 8-nov-2026): una transaccion, dos o
 * rechazo, midiendo la transaccion serializada.
 *
 * Los casos salen de V10 y V13 (`verificaciones.md`), con los mismos datos que los tests del
 * programa en Rust (`sword`, `minimal_with_max_pairs` y `max_item`). Los bytes esperados son los
 * que midio Rust: que coincidan comprueba que el cliente generado serializa igual que el programa.
 */
import { blockhash, type Address, type KeyPairSigner } from '@solana/kit';
import { beforeAll, describe, expect, it } from 'vitest';
import { deriveAuthority } from '../src/keys.js';
import {
  authoritySigner,
  buildCreateItem,
  buildCreateItemAndGrant,
  planItemCreation,
  transactionSize,
  type ItemDefinition,
  type Lifetime,
} from '../src/transactions.js';

const GAME_ID = 'test-game';
const SEED = Uint8Array.from(Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex'));
const LIFETIME: Lifetime = { blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 0n };
const HOLDER = '9iSwm7eB94k9GL7fEnJCBZa3NvqGiSX7uAv1pzUC2NJp' as Address;
const FIRST_GRANT = { holder: HOLDER, amount: 1 };

const base = { itemId: 'itm_0123456789abcdef', collectionId: 'col_7Hs2aaaaaaaaaaaa' };

/** El tipo tipico del contrato, 4.3. */
const SWORD: ItemDefinition = {
  ...base,
  name: 'Espada de hierro',
  symbol: 'SWORD',
  uri: 'https://ejemplo.test/espada.json',
  qualities: { rarity: 'common', damage: '12' },
};

/** `n` pares de 32/64 caracteres, sin `uri` y con `name` y `symbol` de 1. */
function minimalWithMaxPairs(n: number): ItemDefinition {
  const qualities: Record<string, string> = {};
  for (let i = 0; i < n; i++) qualities[String(i).repeat(32)] = 'v'.repeat(64);
  return { ...base, name: 'n', symbol: 's', uri: '', qualities };
}

/** Maximo del contrato: 8 pares de 32/64, `uri` de 200, `name` de 32 y `symbol` de 10. */
const MAX: ItemDefinition = {
  ...minimalWithMaxPairs(8),
  name: 'n'.repeat(32),
  symbol: 's'.repeat(10),
  uri: 'u'.repeat(200),
};

let authority: KeyPairSigner;

beforeAll(async () => {
  authority = await authoritySigner(deriveAuthority(SEED, GAME_ID));
});

const together = async (item: ItemDefinition): Promise<number> =>
  transactionSize(await buildCreateItemAndGrant(authority, GAME_ID, item, FIRST_GRANT, LIFETIME));
const alone = async (item: ItemDefinition): Promise<number> =>
  transactionSize(await buildCreateItem(authority, GAME_ID, item, LIFETIME));

describe('tamano serializado, igual que en Rust (V10, V13)', () => {
  it.each([
    ['tipico', SWORD, 595],
    ['sin cualidades y resto minimo', minimalWithMaxPairs(0), 507],
    ['6 pares de 32/64 y resto minimo', minimalWithMaxPairs(6), 1132],
    ['7 pares de 32/64 y resto minimo', minimalWithMaxPairs(7), 1236],
    ['maximo del contrato', MAX, 1580],
  ])('create_item + grant, %s: %i bytes', async (_, item, bytes) => {
    expect(await together(item)).toBe(bytes);
  });

  it.each([
    ['tipico', SWORD, 472],
    ['8 pares de 32/64 y resto minimo', minimalWithMaxPairs(8), 1217],
    ['maximo del contrato', MAX, 1457],
  ])('create_item solo, %s: %i bytes', async (_, item, bytes) => {
    expect(await alone(item)).toBe(bytes);
  });
});

describe('planItemCreation', () => {
  it('caso tipico: una transaccion con create_item + grant', async () => {
    const plan = await planItemCreation(authority, GAME_ID, SWORD, FIRST_GRANT, LIFETIME);
    expect(plan.outcome).toBe('single');
    if (plan.outcome !== 'single') return;
    expect(plan.transactions[0].instructions).toHaveLength(2);
  });

  it('6 pares largos todavia caben juntos', async () => {
    const plan = await planItemCreation(authority, GAME_ID, minimalWithMaxPairs(6), FIRST_GRANT, LIFETIME);
    expect(plan.outcome).toBe('single');
  });

  it('7 pares de 32/64 y resto minimo: dos, primero create_item y despues grant', async () => {
    const plan = await planItemCreation(authority, GAME_ID, minimalWithMaxPairs(7), FIRST_GRANT, LIFETIME);
    expect(plan.outcome).toBe('split');
    if (plan.outcome !== 'split') return;
    const [first, second] = plan.transactions;
    expect(first.instructions).toHaveLength(1);
    expect(second.instructions).toHaveLength(1);
    const create = await buildCreateItem(authority, GAME_ID, minimalWithMaxPairs(7), LIFETIME);
    expect(first.instructions[0]?.data).toEqual(create.instructions[0]?.data);
    for (const t of plan.transactions) expect(transactionSize(t)).toBeLessThanOrEqual(1232);
  });

  it('8 pares de 32/64 y resto minimo: tambien dos', async () => {
    const plan = await planItemCreation(authority, GAME_ID, minimalWithMaxPairs(8), FIRST_GRANT, LIFETIME);
    expect(plan.outcome).toBe('split');
  });

  it('maximo del contrato: rechazo, create_item no cabe ni solo', async () => {
    const plan = await planItemCreation(authority, GAME_ID, MAX, FIRST_GRANT, LIFETIME);
    expect(plan).toEqual({ outcome: 'rejected' });
  });
});
