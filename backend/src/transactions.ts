/**
 * Constructores de las transacciones de `chain-assets`, sobre el cliente generado por Codama
 * (`src/generated/`, `npm run codegen`).
 *
 * **Invariante 1 (CLAUDE.md; propuesta, 4.2):** toda transaccion lleva una sola firma requerida, la
 * de la autoridad del juego, que es tambien la pagadora. Por eso todos los constructores pasan por
 * `draft`, que fija a la autoridad como pagadora y no admite otro firmante: el tenedor es una
 * direccion cualquiera que no firma, y la PDA `Game` y el mint firman por CPI. Lo comprueba
 * `tests/single-signer.test.ts`.
 *
 * Las transacciones son `legacy`, como las que midio el programa en Rust (V10, V13): sin tablas de
 * direcciones no hay nada que ganar con `v0`, y asi las cifras de tamano son comparables.
 *
 * De donde sale la direccion del tenedor no es asunto de este modulo: la recibe como `Address`,
 * igual que el programa la recibe como una cuenta cualquiera.
 */
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  getTransactionMessageSize,
  LEGACY_TRANSACTION_SIZE_LIMIT,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type BlockhashLifetimeConstraint,
  type Instruction,
  type KeyPairSigner,
  type TransactionSigner,
} from '@solana/kit';
import { findGameAddress, findHolderTokenAddress, findItemMintAddress, itemSeed } from './addresses.js';
import {
  getCreateItemInstruction,
  getGrantInstruction,
  getInitializeGameInstruction,
  getTransferInstruction,
} from './generated/index.js';
import type { AuthorityKey } from './keys.js';

/** Blockhash reciente y altura hasta la que vale. Cualquiera sirve para medir. */
export type Lifetime = BlockhashLifetimeConstraint;

/** Un tipo de objeto tal como lo crea `POST /v1/items` (contrato, 4.3), ya validado. */
export interface ItemDefinition {
  readonly itemId: string;
  readonly collectionId: string;
  readonly name: string;
  readonly symbol: string;
  readonly uri: string;
  /** El orden de las claves es el de `additional_metadata`, detras de `collection`. */
  readonly qualities: Readonly<Record<string, string>>;
}

/** Primera emision de un tipo, o cualquier otra. */
export interface GrantDefinition {
  readonly holder: Address;
  readonly amount: number | bigint;
}

/** Firmante de la autoridad del juego a partir de su clave derivada (`keys.ts`). */
export async function authoritySigner(key: AuthorityKey): Promise<KeyPairSigner> {
  const signer = await createKeyPairSignerFromPrivateKeyBytes(key.secret);
  if (signer.address !== key.address) {
    throw new Error('la clave de la autoridad no corresponde a su direccion');
  }
  return signer;
}

/** Mensaje de transaccion con la autoridad como unica firmante y pagadora. */
function draft(authority: TransactionSigner, instructions: readonly Instruction[], lifetime: Lifetime) {
  return pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayerSigner(authority, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
}

/** Una transaccion lista para firmar con `signTransactionMessageWithSigners`. */
export type TransactionDraft = ReturnType<typeof draft>;

/** Bytes de la transaccion serializada y firmada, firmas incluidas. */
export function transactionSize(transaction: TransactionDraft): number {
  return getTransactionMessageSize(transaction);
}

function fits(transaction: TransactionDraft): boolean {
  return transactionSize(transaction) <= LEGACY_TRANSACTION_SIZE_LIMIT;
}

function createItemInstruction(authority: TransactionSigner, game: Address, mint: Address, item: ItemDefinition) {
  return getCreateItemInstruction({
    authority,
    game,
    mint,
    itemSeed: itemSeed(item.itemId),
    name: item.name,
    symbol: item.symbol,
    uri: item.uri,
    collection: item.collectionId,
    qualities: Object.entries(item.qualities).map(([key, value]) => ({ key, value })),
  });
}

async function grantInstruction(authority: TransactionSigner, game: Address, mint: Address, grant: GrantDefinition) {
  return getGrantInstruction({
    authority,
    game,
    mint,
    holder: grant.holder,
    holderToken: await findHolderTokenAddress(grant.holder, mint),
    amount: grant.amount,
  });
}

async function addressesOf(gameId: string, itemId: string): Promise<{ game: Address; mint: Address }> {
  const game = await findGameAddress(gameId);
  return { game, mint: await findItemMintAddress(game, itemId) };
}

export async function buildInitializeGame(
  authority: TransactionSigner,
  gameId: string,
  lifetime: Lifetime,
): Promise<TransactionDraft> {
  const game = await findGameAddress(gameId);
  return draft(authority, [getInitializeGameInstruction({ authority, game, gameId })], lifetime);
}

export async function buildCreateItem(
  authority: TransactionSigner,
  gameId: string,
  item: ItemDefinition,
  lifetime: Lifetime,
): Promise<TransactionDraft> {
  const { game, mint } = await addressesOf(gameId, item.itemId);
  return draft(authority, [createItemInstruction(authority, game, mint, item)], lifetime);
}

export async function buildGrant(
  authority: TransactionSigner,
  gameId: string,
  itemId: string,
  holder: Address,
  amount: number | bigint,
  lifetime: Lifetime,
): Promise<TransactionDraft> {
  const { game, mint } = await addressesOf(gameId, itemId);
  return draft(authority, [await grantInstruction(authority, game, mint, { holder, amount })], lifetime);
}

/** `create_item` y `grant` en una sola transaccion, quepan o no: para eso esta `planItemCreation`. */
export async function buildCreateItemAndGrant(
  authority: TransactionSigner,
  gameId: string,
  item: ItemDefinition,
  grant: GrantDefinition,
  lifetime: Lifetime,
): Promise<TransactionDraft> {
  const { game, mint } = await addressesOf(gameId, item.itemId);
  return draft(
    authority,
    [createItemInstruction(authority, game, mint, item), await grantInstruction(authority, game, mint, grant)],
    lifetime,
  );
}

/** Transferencia como delegado permanente: el emisor `from` no firma (propuesta, 4.2). */
export async function buildTransfer(
  authority: TransactionSigner,
  gameId: string,
  itemId: string,
  from: Address,
  to: Address,
  amount: number | bigint,
  lifetime: Lifetime,
): Promise<TransactionDraft> {
  const { game, mint } = await addressesOf(gameId, itemId);
  const instruction = getTransferInstruction({
    authority,
    game,
    mint,
    fromToken: await findHolderTokenAddress(from, mint),
    toHolder: to,
    toToken: await findHolderTokenAddress(to, mint),
    amount,
  });
  return draft(authority, [instruction], lifetime);
}

/**
 * Como se envia un tipo nuevo y su primera emision (propuesta, revision del 8-nov-2026):
 * - `single`: `create_item` + `grant` en una transaccion;
 * - `split`: no caben juntas, pero `create_item` si: dos transacciones, en este orden, dentro de la
 *   misma operacion, que no llega a `settled` hasta que lo estan las dos;
 * - `rejected`: `create_item` no cabe ni solo. `POST /v1/items` responde `400` / `REJECTED` sin
 *   tocar la cadena.
 */
export type ItemCreationPlan =
  | { readonly outcome: 'single'; readonly transactions: readonly [TransactionDraft] }
  | { readonly outcome: 'split'; readonly transactions: readonly [TransactionDraft, TransactionDraft] }
  | { readonly outcome: 'rejected' };

/**
 * Decide midiendo la transaccion **serializada**, no con una formula: la de V13 solo sirve para
 * elegir los casos de test. El tamano no depende del blockhash, asi que se puede decidir antes de
 * pedir uno a la red con cualquier `lifetime`, y construir despues con el bueno.
 */
export async function planItemCreation(
  authority: TransactionSigner,
  gameId: string,
  item: ItemDefinition,
  grant: GrantDefinition,
  lifetime: Lifetime,
): Promise<ItemCreationPlan> {
  const { game, mint } = await addressesOf(gameId, item.itemId);
  const create = createItemInstruction(authority, game, mint, item);
  const emit = await grantInstruction(authority, game, mint, grant);

  const together = draft(authority, [create, emit], lifetime);
  if (fits(together)) return { outcome: 'single', transactions: [together] };

  const alone = draft(authority, [create], lifetime);
  if (fits(alone)) return { outcome: 'split', transactions: [alone, draft(authority, [emit], lifetime)] };

  return { outcome: 'rejected' };
}
