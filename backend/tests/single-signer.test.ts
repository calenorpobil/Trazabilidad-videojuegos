/**
 * Invariante de firmante unico (CLAUDE.md, invariante 1; propuesta, 4.2 y 9). Se escribio ANTES
 * que los constructores de `src/transactions.ts` (CLAUDE.md, seccion 4).
 *
 * Toda transaccion que construye el backend tiene exactamente una firma requerida, la de la
 * autoridad del juego, que ademas paga: es la primera cuenta del mensaje. Se comprueba sobre los
 * bytes compilados del mensaje, que es lo que valida la red, y ademas firmando: sale una sola firma.
 *
 * La PDA `Game` y el mint (tambien PDA) firman por CPI dentro del programa; eso no es una firma
 * de la transaccion y no aparece aqui.
 *
 * Cubre las cinco formas que construye el backend del hito: `initialize_game`, `create_item`,
 * `grant`, `create_item` + `grant` juntos y `transfer` (este ultimo se usa en el bloque 4).
 */
import {
  compileTransaction,
  getCompiledTransactionMessageDecoder,
  signTransactionMessageWithSigners,
  type Address,
  type KeyPairSigner,
} from '@solana/kit';
import { beforeAll, describe, expect, it } from 'vitest';
import { deriveAuthority } from '../src/keys.js';
import {
  authoritySigner,
  buildCreateItem,
  buildCreateItemAndGrant,
  buildGrant,
  buildInitializeGame,
  buildTransfer,
  type ItemDefinition,
  type Lifetime,
  type TransactionDraft,
} from '../src/transactions.js';

const GAME_ID = 'test-game';
const SEED = Uint8Array.from(Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex'));

/** Cualquier blockhash sirve: no se envia nada. 32 bytes a cero. */
const LIFETIME: Lifetime = { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 0n };

/** Tenedores: direcciones cualquiera, que no firman. Son claves de los vectores de `keys.test.ts`. */
const ALICE = '9iSwm7eB94k9GL7fEnJCBZa3NvqGiSX7uAv1pzUC2NJp' as Address;
const BOB = 'Ari5iQHz4bmcyRjfGDfEC3mynYiVUbUPxWofuYcMXwN9' as Address;

const SWORD: ItemDefinition = {
  itemId: 'itm_0123456789abcdef',
  collectionId: 'col_7Hs2aaaaaaaaaaaa',
  name: 'Espada de hierro',
  symbol: 'SWORD',
  uri: 'https://ejemplo.test/espada.json',
  qualities: { rarity: 'common', damage: '12' },
};

let authority: KeyPairSigner;

beforeAll(async () => {
  authority = await authoritySigner(deriveAuthority(SEED, GAME_ID));
});

async function expectSingleSigner(draft: TransactionDraft): Promise<void> {
  const compiled = compileTransaction(draft);
  const message = getCompiledTransactionMessageDecoder().decode(compiled.messageBytes);

  // Una sola firma requerida, y ninguna de solo lectura: la autoridad paga, asi que es escribible.
  expect(message.header.numSignerAccounts).toBe(1);
  expect(message.header.numReadonlySignerAccounts).toBe(0);
  // La primera cuenta es la pagadora, y es la autoridad.
  expect(message.staticAccounts[0]).toBe(authority.address);
  expect(Object.keys(compiled.signatures)).toEqual([authority.address]);

  // Firmar con los firmantes del mensaje produce exactamente una firma, la de la autoridad.
  const signed = await signTransactionMessageWithSigners(draft);
  const signatures = Object.entries(signed.signatures);
  expect(signatures).toHaveLength(1);
  expect(signatures[0]?.[0]).toBe(authority.address);
  expect(signatures[0]?.[1]).not.toBeNull();
}

describe('invariante de firmante unico', () => {
  it('initialize_game', async () => {
    await expectSingleSigner(await buildInitializeGame(authority, GAME_ID, LIFETIME));
  });

  it('create_item', async () => {
    await expectSingleSigner(await buildCreateItem(authority, GAME_ID, SWORD, LIFETIME));
  });

  it('grant', async () => {
    await expectSingleSigner(await buildGrant(authority, GAME_ID, SWORD.itemId, ALICE, 3, LIFETIME));
  });

  it('create_item + grant en una transaccion', async () => {
    const draft = await buildCreateItemAndGrant(authority, GAME_ID, SWORD, { holder: ALICE, amount: 1 }, LIFETIME);
    expect(draft.instructions).toHaveLength(2);
    await expectSingleSigner(draft);
  });

  it('transfer: el emisor no firma', async () => {
    const draft = await buildTransfer(authority, GAME_ID, SWORD.itemId, ALICE, BOB, 1, LIFETIME);
    await expectSingleSigner(draft);
    const message = getCompiledTransactionMessageDecoder().decode(compileTransaction(draft).messageBytes);
    // Ni emisor ni receptor estan entre los firmantes (la primera cuenta es la unica que firma).
    expect(message.staticAccounts.indexOf(ALICE)).not.toBe(0);
    expect(message.staticAccounts.indexOf(BOB)).not.toBe(0);
  });
});
