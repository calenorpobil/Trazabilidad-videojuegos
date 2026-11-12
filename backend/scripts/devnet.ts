/**
 * Prueba manual contra devnet (propuesta, 9): FUERA de la CI, porque depende de una red externa.
 *
 *   CHAIN_DEVNET_KEYPAIR=<fichero de clave de la CLI de Solana, con fondos> npm run test:devnet
 *
 * Desde TypeScript y con los constructores del backend: crea un juego, un tipo tipico y su primera
 * emision (3 unidades) a un tenedor con clave aleatoria, y transfiere 2 a un segundo tenedor
 * aleatorio. Ninguno de los dos firma. Comprueba con `getTransaction` que cada transaccion lleva UNA
 * firma (invariante 1), que los metadatos del mint son los enviados (`parseItemMint`) y, cuando la
 * transferencia es `finalized`, que el inventario de los dos es 1 y 2 (`readHolderInventory`, con
 * el tipo registrado en un SQLite en memoria). Imprime las firmas para `verificaciones.md`.
 *
 * El fichero de clave hace de autoridad del juego. En el backend la autoridad sale de la semilla
 * maestra (`keys.ts`, con sus vectores); aqui se usa un monedero con fondos para no tener que
 * financiar una clave nueva en cada ejecucion.
 */
import { readFileSync } from 'node:fs';
import {
  assertIsSendableTransaction,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  fetchEncodedAccount,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
  signTransactionMessageWithSigners,
  type Signature,
} from '@solana/kit';
import { findGameAddress, findItemMintAddress } from '../src/addresses.js';
import { openDatabase, timestamp } from '../src/db.js';
import { newId } from '../src/ids.js';
import { parseItemMint, readHolderInventory } from '../src/inventory.js';
import {
  buildInitializeGame,
  planItemCreation,
  planTransfer,
  type ItemDefinition,
  type TransactionDraft,
} from '../src/transactions.js';

const RPC_URL = 'https://api.devnet.solana.com';
const WS_URL = 'wss://api.devnet.solana.com';

const keypairPath = process.env['CHAIN_DEVNET_KEYPAIR'];
if (keypairPath === undefined) {
  console.error('Define CHAIN_DEVNET_KEYPAIR con la ruta de un fichero de clave con fondos en devnet.');
  process.exit(1);
}

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

const authority = await createKeyPairSignerFromBytes(
  Uint8Array.from(JSON.parse(readFileSync(keypairPath, 'utf8')) as number[]),
);
const holder = (await generateKeyPairSigner()).address;
const recipient = (await generateKeyPairSigner()).address;
const gameId = `b4-${Math.floor(Date.now() / 1000)}`;
const itemId = newId('item');

async function send(label: string, transaction: TransactionDraft): Promise<Signature> {
  const signed = await signTransactionMessageWithSigners(transaction);
  assertIsSendableTransaction(signed);
  assertIsTransactionWithBlockhashLifetime(signed);
  await sendAndConfirm(signed, { commitment: 'confirmed' });
  const signature = getSignatureFromTransaction(signed);

  const sent = await rpc
    .getTransaction(signature, { commitment: 'confirmed', encoding: 'json', maxSupportedTransactionVersion: 0 })
    .send();
  if (sent === null) throw new Error(`${label}: getTransaction no encuentra ${signature}`);
  const signatures = sent.transaction.signatures.length;
  if (signatures !== 1) throw new Error(`${label}: ${signatures} firmas, se esperaba una (invariante 1)`);
  if (sent.meta?.err) throw new Error(`${label}: fallo en la cadena: ${JSON.stringify(sent.meta.err)}`);
  console.warn(`${label}: 1 firma, ${sent.meta?.computeUnitsConsumed ?? '?'} CU, ${signature}`);
  return signature;
}

console.warn(`autoridad ${authority.address}, juego ${gameId}, tipo ${itemId}`);
console.warn(`tenedores: ${holder} (emisor), ${recipient} (receptor)`);
const latest = async () => (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;

await send('initialize_game', await buildInitializeGame(authority, gameId, await latest()));

const item: ItemDefinition = {
  itemId,
  collectionId: newId('collection'),
  name: 'Espada de hierro',
  symbol: 'SWORD',
  uri: 'https://ejemplo.test/espada.json',
  qualities: { rarity: 'common', damage: '12' },
};
const plan = await planItemCreation(authority, gameId, item, { holder, amount: 3 }, await latest());
if (plan.outcome !== 'single') throw new Error(`el tipo tipico deberia ir en una transaccion: ${plan.outcome}`);
await send('create_item + grant 3', plan.transactions[0]);

const game = await findGameAddress(gameId);
const mint = await findItemMintAddress(game, itemId);
const mintAccount = await fetchEncodedAccount(rpc, mint, { commitment: 'confirmed' });
if (!mintAccount.exists) throw new Error(`no existe el mint ${mint}`);
const onChain = parseItemMint(mint, mintAccount.data);
const expected = {
  authority: game,
  name: item.name,
  symbol: item.symbol,
  uri: item.uri,
  collection: item.collectionId,
  qualities: item.qualities,
};
if (JSON.stringify(onChain) !== JSON.stringify(expected)) {
  throw new Error(`metadatos del mint distintos de los enviados: ${JSON.stringify(onChain)}`);
}
console.warn(`mint ${mint}: metadatos y autoridad (PDA Game) correctos`);

const transfer = await planTransfer(rpc, authority, gameId, itemId, holder, recipient, 2, await latest());
if (transfer.outcome !== 'ready') throw new Error(`transferencia rechazada: ${transfer.reason}`);
const transferSignature = await send('transfer 2', transfer.transaction);

// El inventario refleja el estado liquidado (contrato, 5.2): se espera a `finalized`.
for (let i = 0; ; i++) {
  const [status] = (await rpc.getSignatureStatuses([transferSignature]).send()).value;
  if (status?.confirmationStatus === 'finalized') break;
  if (i === 60) throw new Error('la transferencia no llega a finalized en 60 s');
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

// El tipo, registrado como lo hara POST /v1/items: el inventario saca de aqui el item_id.
const db = openDatabase(':memory:');
const now = timestamp();
db.prepare('INSERT INTO collections VALUES (?, ?, ?, ?)').run(item.collectionId, gameId, 'Armeria', now);
db.prepare(
  "INSERT INTO operations (operation_id, kind, state, created_at, updated_at) VALUES ('opr_devnet', 'create_item', 'settled', ?, ?)",
).run(now, now);
db.prepare(
  `INSERT INTO items (item_id, collection_id, mint, name, symbol, uri, qualities, operation_id, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'opr_devnet', ?)`,
).run(itemId, item.collectionId, mint, item.name, item.symbol, item.uri, JSON.stringify(item.qualities), now);

for (const [who, address, amount] of [
  ['emisor', holder, 1],
  ['receptor', recipient, 2],
] as const) {
  const inventory = await readHolderInventory(rpc, db, game, address);
  if (inventory.length !== 1 || inventory[0]?.item_id !== itemId || inventory[0].amount !== amount) {
    throw new Error(`inventario del ${who}: ${JSON.stringify(inventory)}, se esperaba ${amount} de ${itemId}`);
  }
  console.warn(`inventario del ${who}: ${JSON.stringify(inventory)}`);
}
console.warn('ninguno de los dos tenedores ha firmado nada');
