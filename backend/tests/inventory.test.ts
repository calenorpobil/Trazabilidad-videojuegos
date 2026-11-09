/**
 * Parseo del mint de un tipo e inventario de un tenedor (bloque 4).
 *
 * El parseo se prueba sobre los bytes de un mint **real** de devnet, creado por `npm run
 * test:devnet` en el bloque 3 (V15) y leido con `getAccountInfo` (V16). Los valores esperados son
 * los que se enviaron al crearlo, no los que devuelve el decodificador.
 *
 * El inventario se prueba con un RPC falso, que solo responde a las dos llamadas que hace, y con
 * SQLite en memoria.
 */
import {
  AccountState,
  getMintEncoder,
  getTokenEncoder,
  TOKEN_2022_PROGRAM_ADDRESS,
  type ExtensionArgs,
} from '@solana-program/token-2022';
import { getBase64Decoder, getBase64Encoder, type Address } from '@solana/kit';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { findGameAddress, findItemMintAddress } from '../src/addresses.js';
import { openDatabase, timestamp, type Db } from '../src/db.js';
import { parseItemMint, readHolderInventory, type InventoryRpc } from '../src/inventory.js';

interface Fixture {
  address: Address;
  gameId: string;
  itemId: string;
  owner: Address;
  space: number;
  data: string;
}
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/devnet-item-mint.json', import.meta.url), 'utf8'),
) as Fixture;
const FIXTURE_BYTES = Uint8Array.from(getBase64Encoder().encode(FIXTURE.data));

/** El `collection_id` que genero aquella ejecucion: esta en los bytes, no en `verificaciones.md`. */
const FIXTURE_COLLECTION = 'col_xR2SNQ2Am7QiZC1a';

const ALICE = '9iSwm7eB94k9GL7fEnJCBZa3NvqGiSX7uAv1pzUC2NJp' as Address;
const BOB = 'Ari5iQHz4bmcyRjfGDfEC3mynYiVUbUPxWofuYcMXwN9' as Address;
/** Direcciones cualquiera para mints de otros, de los vectores de `addresses.test.ts`. */
const OTHER_AUTHORITY = 'DVKimGfAe2H98Y6BVY1wmtbFPZGB4Z5YERGU54ZuVtEQ' as Address;
const FOREIGN_MINT = 'So11111111111111111111111111111111111111112' as Address;

describe('parseItemMint, sobre un mint real de devnet', () => {
  it('la fixture es el mint del tipo en su juego', async () => {
    expect(FIXTURE.owner).toBe(TOKEN_2022_PROGRAM_ADDRESS);
    expect(FIXTURE_BYTES.length).toBe(FIXTURE.space);
    const game = await findGameAddress(FIXTURE.gameId);
    expect(await findItemMintAddress(game, FIXTURE.itemId)).toBe(FIXTURE.address);
  });

  it('lee la autoridad, los metadatos, la coleccion y las cualidades en orden', async () => {
    const parsed = parseItemMint(FIXTURE.address, FIXTURE_BYTES);
    expect(parsed).toEqual({
      authority: await findGameAddress(FIXTURE.gameId),
      name: 'Espada de hierro',
      symbol: 'SWORD',
      uri: 'https://ejemplo.test/espada.json',
      collection: FIXTURE_COLLECTION,
      qualities: { rarity: 'common', damage: '12' },
    });
    expect(Object.keys(parsed?.qualities ?? {})).toEqual(['rarity', 'damage']);
  });

  it('rechaza metadatos que dicen ser de otro mint', () => {
    expect(parseItemMint(FOREIGN_MINT, FIXTURE_BYTES)).toBeNull();
  });

  it('rechaza lo que no es un mint con metadatos', () => {
    expect(parseItemMint(FIXTURE.address, new Uint8Array(0))).toBeNull();
    expect(parseItemMint(FIXTURE.address, FIXTURE_BYTES.slice(0, 200))).toBeNull();
    expect(parseItemMint(FIXTURE.address, tokenAccount(FIXTURE.address, ALICE, 1n))).toBeNull();
    expect(parseItemMint(FIXTURE.address, mintBytes(OTHER_AUTHORITY, []))).toBeNull();
  });
});

describe('readHolderInventory', () => {
  let db: Db;
  let game: Address;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    game = await findGameAddress(FIXTURE.gameId);
    const now = timestamp();
    db.prepare('INSERT INTO collections VALUES (?, ?, ?, ?)').run(FIXTURE_COLLECTION, FIXTURE.gameId, 'Armeria', now);
    db.prepare("INSERT INTO operations VALUES ('opr_1', 'create_item', 'settled', NULL, NULL, NULL, ?, ?)").run(
      now,
      now,
    );
    db.prepare(
      `INSERT INTO items (item_id, collection_id, mint, name, symbol, uri, qualities, operation_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'opr_1', ?)`,
    ).run(
      FIXTURE.itemId,
      FIXTURE_COLLECTION,
      FIXTURE.address,
      'Espada de hierro',
      'SWORD',
      'https://ejemplo.test/espada.json',
      JSON.stringify({ rarity: 'common', damage: '12' }),
      now,
    );
  });

  it('devuelve los tipos del juego con la forma del contrato y suma las cuentas de un mismo tipo', async () => {
    const rpc = fakeRpc(
      [tokenAccount(FIXTURE.address, ALICE, 2n), tokenAccount(FIXTURE.address, ALICE, 3n)],
      { [FIXTURE.address]: FIXTURE_BYTES },
    );
    expect(await readHolderInventory(rpc, db, game, ALICE)).toEqual([
      {
        item_id: FIXTURE.itemId,
        collection_id: FIXTURE_COLLECTION,
        name: 'Espada de hierro',
        symbol: 'SWORD',
        uri: 'https://ejemplo.test/espada.json',
        qualities: { rarity: 'common', damage: '12' },
        amount: 5,
      },
    ]);
    // Inventario liquidado (contrato, 5.2): las dos lecturas, en `finalized`.
    expect(rpc.commitments).toEqual(['finalized', 'finalized']);
  });

  it('sin objetos, lista vacia; las cuentas a cero no cuentan', async () => {
    expect(await readHolderInventory(fakeRpc([], {}), db, game, ALICE)).toEqual([]);
    const rpc = fakeRpc([tokenAccount(FIXTURE.address, ALICE, 0n)], { [FIXTURE.address]: FIXTURE_BYTES });
    expect(await readHolderInventory(rpc, db, game, ALICE)).toEqual([]);
  });

  it('omite los mints de otra autoridad, aunque se llamen igual', async () => {
    const rpc = fakeRpc([tokenAccount(FOREIGN_MINT, ALICE, 1n)], {
      [FOREIGN_MINT]: mintBytes(OTHER_AUTHORITY, [metadata(FOREIGN_MINT)]),
    });
    expect(await readHolderInventory(rpc, db, game, ALICE)).toEqual([]);
  });

  it('omite un mint del juego que no esta en items', async () => {
    db.prepare('DELETE FROM items').run();
    const rpc = fakeRpc([tokenAccount(FIXTURE.address, ALICE, 1n)], { [FIXTURE.address]: FIXTURE_BYTES });
    expect(await readHolderInventory(rpc, db, game, ALICE)).toEqual([]);
  });

  it('omite cuentas de otro propietario', async () => {
    const rpc = fakeRpc([tokenAccount(FIXTURE.address, BOB, 1n)], { [FIXTURE.address]: FIXTURE_BYTES });
    expect(await readHolderInventory(rpc, db, game, ALICE)).toEqual([]);
  });
});

// --- Utilidades ---

function tokenAccount(mint: Address, owner: Address, amount: bigint): Uint8Array {
  return Uint8Array.from(
    getTokenEncoder().encode({
      mint,
      owner,
      amount,
      delegate: null,
      state: AccountState.Initialized,
      isNative: null,
      delegatedAmount: 0,
      closeAuthority: null,
      extensions: null,
    }),
  );
}

function metadata(mint: Address): ExtensionArgs {
  return {
    __kind: 'TokenMetadata',
    updateAuthority: null,
    mint,
    name: 'Espada de hierro',
    symbol: 'SWORD',
    uri: 'https://ejemplo.test/espada.json',
    additionalMetadata: new Map([['collection', FIXTURE_COLLECTION]]),
  };
}

function mintBytes(authority: Address, extensions: ExtensionArgs[]): Uint8Array {
  return Uint8Array.from(
    getMintEncoder().encode({
      mintAuthority: authority,
      supply: 1,
      decimals: 0,
      isInitialized: true,
      freezeAuthority: null,
      extensions: extensions.length > 0 ? extensions : null,
    }),
  );
}

type FakeRpc = InventoryRpc & { commitments: string[] };

/** RPC con las dos llamadas del inventario. `mints` son las cuentas que devuelve `getMultipleAccounts`. */
function fakeRpc(tokenAccounts: Uint8Array[], mints: Record<string, Uint8Array>): FakeRpc {
  const b64 = (bytes: Uint8Array): string => getBase64Decoder().decode(bytes);
  const commitments: string[] = [];
  const rpc = {
    commitments,
    getTokenAccountsByOwner: (_owner: Address, _filter: unknown, config: { commitment: string }) => ({
      send: () => {
        commitments.push(config.commitment);
        return Promise.resolve({
          context: { slot: 0n },
          value: tokenAccounts.map((data, i) => ({
            pubkey: `token-${i}`,
            account: { data: [b64(data), 'base64'], owner: TOKEN_2022_PROGRAM_ADDRESS },
          })),
        });
      },
    }),
    getMultipleAccounts: (addresses: Address[], config: { commitment: string }) => ({
      send: () => {
        commitments.push(config.commitment);
        return Promise.resolve({
          context: { slot: 0n },
          value: addresses.map((a) => {
            const data = mints[a];
            if (data === undefined) return null;
            return {
              data: [b64(data), 'base64'],
              owner: TOKEN_2022_PROGRAM_ADDRESS,
              executable: false,
              lamports: 1n,
              space: BigInt(data.length),
              rentEpoch: 0n,
            };
          }),
        });
      },
    }),
  };
  return rpc as unknown as FakeRpc;
}
