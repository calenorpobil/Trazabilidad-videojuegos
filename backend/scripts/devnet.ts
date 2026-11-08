/**
 * Prueba manual contra devnet (propuesta, 9): FUERA de la CI, porque depende de una red externa.
 *
 *   CHAIN_DEVNET_KEYPAIR=<fichero de clave de la CLI de Solana, con fondos> npm run test:devnet
 *
 * Desde TypeScript y con los constructores del backend: crea un juego, un tipo tipico y su primera
 * emision a un tenedor con clave aleatoria, que no firma. Comprueba con `getTransaction` que cada
 * transaccion lleva UNA firma (invariante 1) y que el tenedor tiene su unidad. Imprime las firmas
 * para anotarlas en `verificaciones.md`.
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
  generateKeyPairSigner,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
  signTransactionMessageWithSigners,
  type Signature,
} from '@solana/kit';
import { findGameAddress, findHolderTokenAddress, findItemMintAddress } from '../src/addresses.js';
import { newId } from '../src/ids.js';
import { buildInitializeGame, planItemCreation, type TransactionDraft } from '../src/transactions.js';

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
const gameId = `b3-${Math.floor(Date.now() / 1000)}`;
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

console.warn(`autoridad ${authority.address}, juego ${gameId}, tipo ${itemId}, tenedor ${holder}`);
const latest = async () => (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;

await send('initialize_game', await buildInitializeGame(authority, gameId, await latest()));

const plan = await planItemCreation(
  authority,
  gameId,
  {
    itemId,
    collectionId: newId('collection'),
    name: 'Espada de hierro',
    symbol: 'SWORD',
    uri: 'https://ejemplo.test/espada.json',
    qualities: { rarity: 'common', damage: '12' },
  },
  { holder, amount: 1 },
  await latest(),
);
if (plan.outcome !== 'single') throw new Error(`el tipo tipico deberia ir en una transaccion: ${plan.outcome}`);
await send('create_item + grant', plan.transactions[0]);

const mint = await findItemMintAddress(await findGameAddress(gameId), itemId);
const balance = await rpc
  .getTokenAccountBalance(await findHolderTokenAddress(holder, mint), { commitment: 'confirmed' })
  .send();
if (balance.value.amount !== '1') throw new Error(`el tenedor tiene ${balance.value.amount}, se esperaba 1`);
console.warn(`mint ${mint}: el tenedor tiene 1 unidad y no ha firmado nada`);
