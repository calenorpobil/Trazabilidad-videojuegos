/**
 * Inventario de un tenedor (contrato, 5.2), sin `holder_id`: el tenedor entra como `Address`
 * porque resolver el `holder_id` espera a la Q12.
 *
 * De donde sale cada dato (decidido el 9-nov-2026, bloque 4):
 * - **Saldos, de la cadena**, con compromiso `finalized`: el inventario refleja el estado liquidado
 *   (contrato, 5.2). La cadena es la fuente de verdad de la propiedad (propuesta, 4.4).
 * - **Que el tipo es del juego, de la cadena**: la autoridad de acunacion del mint es la PDA `Game`.
 *   Es el mismo criterio que usa el programa (`mint::authority = game`, V11).
 * - **`item_id` y datos del tipo, de la tabla `items`**: la cadena solo guarda SHA-256(item_id),
 *   que no se invierte, asi que el `item_id` no se puede recuperar del mint. Y la propuesta (4.4)
 *   fija que `name`, `uri` y `qualities` se sirven de SQLite, sin leer la cadena en cada consulta.
 *   Un mint del juego que no esta en `items` no aparece.
 *
 * `parseItemMint` es el unico sitio que interpreta los bytes de un mint. Su test usa los bytes de
 * un mint real de devnet (`tests/fixtures/devnet-item-mint.json`).
 */
import {
  fetchEncodedAccounts,
  getBase64Encoder,
  isSome,
  type Address,
  type Commitment,
  type GetMultipleAccountsApi,
  type GetTokenAccountsByOwnerApi,
  type Rpc,
} from '@solana/kit';
import { getMintDecoder, getTokenDecoder, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import type { Db } from './db.js';

/** Clave reservada de `additional_metadata` donde `create_item` guarda el `collection_id`. */
export const COLLECTION_KEY = 'collection';

/** Lo que dice la cadena de un tipo de objeto. */
export interface ItemMint {
  /** Autoridad de acunacion. En un tipo del juego, la PDA `Game`. */
  readonly authority: Address | null;
  readonly name: string;
  readonly symbol: string;
  readonly uri: string;
  /** El `collection_id`, o `null` si el mint no lo lleva (no es de `chain-assets`). */
  readonly collection: string | null;
  /** Cualidades en el orden de `additional_metadata`, sin la clave reservada. */
  readonly qualities: Readonly<Record<string, string>>;
}

/**
 * Interpreta la cuenta de un mint de Token-2022 con sus metadatos dentro (extension `TokenMetadata`,
 * a la que apunta `MetadataPointer`). Devuelve `null` si los bytes no son un mint inicializado con
 * metadatos propios: una cuenta cualquiera, un mint sin extensiones, o metadatos que dicen ser de
 * otro mint (el campo `mint` de `TokenMetadata` existe para evitar esa suplantacion).
 *
 * Formato, leido en la interfaz `token-metadata` y en `@solana-program/token-2022` 0.16.1 (V16):
 * 82 bytes del mint base, relleno hasta el byte 165 con el tipo de cuenta (1 = mint) y despues
 * entradas TLV (`u16` tipo, `u16` longitud). `TokenMetadata` va en Borsh.
 */
export function parseItemMint(address: Address, data: Uint8Array): ItemMint | null {
  let mint;
  try {
    mint = getMintDecoder().decode(data);
  } catch {
    return null;
  }
  if (!mint.isInitialized || !isSome(mint.extensions)) return null;

  const metadata = mint.extensions.value.find((e) => e.__kind === 'TokenMetadata');
  if (metadata?.__kind !== 'TokenMetadata' || metadata.mint !== address) return null;

  const qualities: Record<string, string> = {};
  for (const [key, value] of metadata.additionalMetadata) {
    if (key !== COLLECTION_KEY) qualities[key] = value;
  }
  return {
    authority: isSome(mint.mintAuthority) ? mint.mintAuthority.value : null,
    name: metadata.name,
    symbol: metadata.symbol,
    uri: metadata.uri,
    collection: metadata.additionalMetadata.get(COLLECTION_KEY) ?? null,
    qualities,
  };
}

/** Una entrada del inventario, con la forma del contrato (5.2). */
export interface InventoryItem {
  readonly item_id: string;
  readonly collection_id: string;
  readonly name: string;
  readonly symbol: string;
  readonly uri: string;
  readonly qualities: Readonly<Record<string, string>>;
  readonly amount: number;
}

export type InventoryRpc = Rpc<GetTokenAccountsByOwnerApi & GetMultipleAccountsApi>;

/** Inventario liquidado: el contrato (5.2) pide el estado de `settled`. */
const COMMITMENT: Commitment = 'finalized';

/** Maximo de cuentas por llamada a `getMultipleAccounts`. */
const MULTIPLE_ACCOUNTS_LIMIT = 100;

interface ItemRow {
  item_id: string;
  collection_id: string;
  name: string;
  symbol: string;
  uri: string;
  qualities: string;
}

/**
 * Unidades que tiene `holder` de los tipos del juego cuya PDA es `game`. Sin objetos, lista vacia.
 * Las cuentas a cero (por ejemplo, tras transferirlo todo) no aparecen.
 */
export async function readHolderInventory(
  rpc: InventoryRpc,
  db: Db,
  game: Address,
  holder: Address,
): Promise<InventoryItem[]> {
  const { value: accounts } = await rpc
    .getTokenAccountsByOwner(
      holder,
      { programId: TOKEN_2022_PROGRAM_ADDRESS },
      { encoding: 'base64', commitment: COMMITMENT },
    )
    .send();

  // Suma por mint: un tenedor puede tener mas de una cuenta del mismo tipo, aunque el backend
  // solo use la asociada.
  const amounts = new Map<Address, bigint>();
  for (const { account } of accounts) {
    const token = getTokenDecoder().decode(getBase64Encoder().encode(account.data[0]));
    if (token.owner !== holder || token.amount === 0n) continue;
    amounts.set(token.mint, (amounts.get(token.mint) ?? 0n) + token.amount);
  }

  const mints = [...amounts.keys()];
  const ours = new Set<Address>();
  for (let i = 0; i < mints.length; i += MULTIPLE_ACCOUNTS_LIMIT) {
    const chunk = mints.slice(i, i + MULTIPLE_ACCOUNTS_LIMIT);
    const fetched = await fetchEncodedAccounts(rpc, chunk, { commitment: COMMITMENT });
    for (const account of fetched) {
      if (!account.exists || account.programAddress !== TOKEN_2022_PROGRAM_ADDRESS) continue;
      if (parseItemMint(account.address, account.data)?.authority === game) ours.add(account.address);
    }
  }

  const byMint = db.prepare<[string], ItemRow>(
    'SELECT item_id, collection_id, name, symbol, uri, qualities FROM items WHERE mint = ?',
  );
  const items: InventoryItem[] = [];
  for (const [mint, amount] of amounts) {
    if (!ours.has(mint)) continue;
    const row = byMint.get(mint);
    if (row === undefined) continue;
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`saldo de ${row.item_id} fuera del rango de un numero JSON: ${amount}`);
    }
    items.push({
      item_id: row.item_id,
      collection_id: row.collection_id,
      name: row.name,
      symbol: row.symbol,
      uri: row.uri,
      qualities: JSON.parse(row.qualities) as Record<string, string>,
      amount: Number(amount),
    });
  }
  return items;
}
