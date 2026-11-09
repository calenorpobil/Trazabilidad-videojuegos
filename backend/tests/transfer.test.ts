/**
 * Lo que rodea a `buildTransfer` (bloque 4): cantidad, emisor y receptor distintos, y cuenta del
 * emisor existente. El saldo insuficiente y las categorias de error son del bloque 5.
 *
 * Que la transferencia planificada lleva una sola firma lo cubre `single-signer.test.ts`.
 */
import { blockhash, type Address, type KeyPairSigner } from '@solana/kit';
import { beforeAll, describe, expect, it } from 'vitest';
import { findGameAddress, findHolderTokenAddress, findItemMintAddress } from '../src/addresses.js';
import { deriveAuthority } from '../src/keys.js';
import { authoritySigner, isValidAmount, planTransfer, type Lifetime } from '../src/transactions.js';
import { senderAccountRpc } from './fake-rpc.js';

const GAME_ID = 'test-game';
const ITEM_ID = 'itm_0123456789abcdef';
const SEED = Uint8Array.from(Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex'));
const LIFETIME: Lifetime = { blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 0n };
const ALICE = '9iSwm7eB94k9GL7fEnJCBZa3NvqGiSX7uAv1pzUC2NJp' as Address;
const BOB = 'Ari5iQHz4bmcyRjfGDfEC3mynYiVUbUPxWofuYcMXwN9' as Address;

let authority: KeyPairSigner;
beforeAll(async () => {
  authority = await authoritySigner(deriveAuthority(SEED, GAME_ID));
});

describe('isValidAmount', () => {
  it('acepta enteros de 1 al maximo de u64', () => {
    for (const ok of [1, 3, Number.MAX_SAFE_INTEGER, 1n, 2n ** 64n - 1n]) expect(isValidAmount(ok)).toBe(true);
  });

  it('rechaza cero, negativos, fracciones, no finitos y lo que no cabe en u64', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 0n, -1n, 2n ** 64n]) {
      expect(isValidAmount(bad)).toBe(false);
    }
  });
});

describe('planTransfer', () => {
  it('lista: lee la cuenta asociada del emisor en confirmed', async () => {
    const rpc = senderAccountRpc(true);
    const plan = await planTransfer(rpc, authority, GAME_ID, ITEM_ID, ALICE, BOB, 2, LIFETIME);
    expect(plan.outcome).toBe('ready');
    const mint = await findItemMintAddress(await findGameAddress(GAME_ID), ITEM_ID);
    expect(rpc.requested).toEqual([await findHolderTokenAddress(ALICE, mint)]);
    expect(rpc.commitments).toEqual(['confirmed']);
  });

  it('rechaza una cantidad invalida sin tocar la cadena', async () => {
    const rpc = senderAccountRpc(true);
    expect(await planTransfer(rpc, authority, GAME_ID, ITEM_ID, ALICE, BOB, 0, LIFETIME)).toEqual({
      outcome: 'rejected',
      reason: 'invalid_amount',
    });
    expect(rpc.requested).toEqual([]);
  });

  it('rechaza emisor y receptor iguales sin tocar la cadena', async () => {
    const rpc = senderAccountRpc(true);
    expect(await planTransfer(rpc, authority, GAME_ID, ITEM_ID, ALICE, ALICE, 1, LIFETIME)).toEqual({
      outcome: 'rejected',
      reason: 'same_holder',
    });
    expect(rpc.requested).toEqual([]);
  });

  it('rechaza si el emisor no tiene cuenta de ese tipo', async () => {
    expect(await planTransfer(senderAccountRpc(false), authority, GAME_ID, ITEM_ID, ALICE, BOB, 1, LIFETIME)).toEqual({
      outcome: 'rejected',
      reason: 'no_sender_account',
    });
  });
});
