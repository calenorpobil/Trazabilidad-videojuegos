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
 * el tipo registrado en un SQLite en memoria). Despues repite lo mismo por HTTP, con el servidor del
 * backend y tenedores nombrados por su external_id. Imprime las firmas para `verificaciones.md`.
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
import { buildServer } from '../src/server.js';
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
  return checkOneSignature(label, getSignatureFromTransaction(signed));
}

/** `getTransaction` de una transaccion ya confirmada: una firma (invariante 1) y sin error. */
async function checkOneSignature(label: string, signature: Signature): Promise<Signature> {
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

/** Espera a que la firma llegue a `commitment`, como mucho 90 s. */
async function waitFor(signature: Signature, commitment: 'confirmed' | 'finalized'): Promise<void> {
  for (let i = 0; i < 90; i++) {
    const [status] = (await rpc.getSignatureStatuses([signature]).send()).value;
    if (status?.err) throw new Error(`${signature}: fallo en la cadena: ${JSON.stringify(status.err)}`);
    const reached = status?.confirmationStatus;
    if (reached === 'finalized' || (commitment === 'confirmed' && reached === 'confirmed')) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${signature} no llega a ${commitment} en 90 s`);
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
await waitFor(transferSignature, 'finalized');

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

// --- Las mismas escrituras y lecturas por HTTP, con el servidor del backend (bloques 3 y 4) ---
//
// Mismo juego y misma autoridad; tenedores derivados de una semilla maestra aleatoria y nombrados
// por su external_id. El seguimiento hasta `settled` es del bloque 5: aqui se espera a mano la firma
// que el servidor registro en `operations`.
const WRITE_KEY = 'w'.repeat(40);
const READ_TOKEN = 'r'.repeat(40);
const httpDb = openDatabase(':memory:');
const http = await buildServer({
  db: httpDb,
  gameId,
  masterSeed: crypto.getRandomValues(new Uint8Array(32)),
  writeKey: WRITE_KEY,
  readToken: READ_TOKEN,
  authority,
  rpc,
  logger: process.env['CHAIN_DEVNET_LOG'] === '1',
});

let keyCounter = 0;
async function request(method: 'GET' | 'POST', url: string, body?: object): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { authorization: `Bearer ${method === 'GET' ? READ_TOKEN : WRITE_KEY}` };
  if (method === 'POST') headers['idempotency-key'] = `devnet-${gameId}-${++keyCounter}`;
  const response = await http.inject({ method, url, headers, ...(body === undefined ? {} : { payload: body }) });
  const json = response.json() as Record<string, unknown>;
  if (response.statusCode >= 300) throw new Error(`${method} ${url}: ${response.statusCode} ${JSON.stringify(json)}`);
  return json;
}

/** Firma que el servidor guardo para la operacion, ya comprobada en la cadena. */
async function settle(label: string, operationId: string): Promise<void> {
  const row = httpDb.prepare('SELECT signature FROM operations WHERE operation_id = ?').get(operationId) as {
    signature: Signature;
  };
  await waitFor(row.signature, 'finalized');
  await checkOneSignature(`HTTP ${label}`, row.signature);
}

const { collection_id: collectionId } = await request('POST', '/v1/collections', { name: 'Armeria' });
const created = await request('POST', '/v1/items', {
  collection_id: collectionId,
  name: 'Escudo de roble',
  symbol: 'SHIELD',
  uri: 'https://ejemplo.test/escudo.json',
  qualities: { rarity: 'rare' },
  initial_grant: { holder: { external_id: 'player-42' }, amount: 3 },
});
console.warn(`HTTP POST /v1/items: ${JSON.stringify(created)}`);
await settle('create_item + grant 3', created['operation_id'] as string);

const moved = await request('POST', `/v1/items/${created['item_id'] as string}/transfer`, {
  from: { holder_id: created['holder_id'] },
  to: { external_id: 'player-77' },
  amount: 2,
});
console.warn(`HTTP POST transfer: ${JSON.stringify(moved)}`);
await settle('transfer 2', moved['operation_id'] as string);

for (const [who, holderId, amount] of [
  ['emisor', moved['from_holder_id'], 1],
  ['receptor', moved['to_holder_id'], 2],
] as const) {
  const inventory = await request('GET', `/v1/holders/${holderId as string}/items`);
  const items = inventory['items'] as { item_id: string; amount: number }[];
  if (items.length !== 1 || items[0]?.item_id !== created['item_id'] || items[0]?.amount !== amount) {
    throw new Error(`HTTP inventario del ${who}: ${JSON.stringify(inventory)}, se esperaba ${amount}`);
  }
  console.warn(`HTTP inventario del ${who}: ${JSON.stringify(inventory)}`);
}
await http.close();
