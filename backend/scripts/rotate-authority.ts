/**
 * Rota la autoridad del juego a la version mas reciente de su clave de OpenBao Transit (P12):
 * `rotate_authority`, con una sola firma, la de la autoridad actual, que tambien paga. Los activos no
 * cambian, porque sus poderes los tiene la PDA `Game` (4.7).
 *
 * Mismas variables de entorno que `npm start`, con `CHAIN_AUTHORITY_SIGNER=transit`. Dos usos:
 * 1. Pasar a Transit un juego que firmaba con la semilla. Antes, crear la clave en OpenBao:
 *    `POST /v1/transit/keys/<nombre>` con `{"type":"ed25519"}` (README, «Autoridad en OpenBao»).
 * 2. Rotar dentro de Transit: `POST /v1/transit/keys/<nombre>/rotate` y despues este script.
 *
 *   CHAIN_AUTHORITY_SIGNER=transit CHAIN_BAO_ADDR=... CHAIN_BAO_TOKEN=... CHAIN_BAO_TRANSIT_KEY=... npm run rotate-authority
 *
 * Antes de ejecutarlo:
 * - Parar el backend: firma con la version que eligio al arrancar, y el programa rechaza sus firmas
 *   en cuanto la autoridad cambia. Se arranca de nuevo al acabar.
 * - Financiar la autoridad nueva, que paga desde entonces. El script lo comprueba y da la orden.
 *
 * La autoridad vieja no se pierde: la semilla la sigue derivando y Transit conserva su version
 * mientras no se recorte (`trim`). No recortes una version que aun tenga fondos.
 */
import { createSolanaRpc, getSignatureFromTransaction, signTransactionMessageWithSigners } from '@solana/kit';
import type { TransactionSigner } from '@solana/kit';
import { onChainAuthority } from '../src/authority.js';
import { loadConfig } from '../src/config.js';
import { deriveAuthority } from '../src/keys.js';
import { send, simulate } from '../src/submission.js';
import { authoritySigner, buildRotateAuthority } from '../src/transactions.js';
import { readTransitKey, transitSigner } from '../src/transit.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

/** Codigo de salida. Sin `process.exit`: en Windows corta sockets a medio cerrar y libuv aborta. */
async function main(): Promise<number> {
  const config = loadConfig();
  if (config.authority.kind !== 'transit') {
    console.error('Define CHAIN_AUTHORITY_SIGNER=transit y las variables de OpenBao: la autoridad nueva sale de Transit.');
    return 1;
  }
  const { transit } = config.authority;
  const rpc = createSolanaRpc(config.rpcUrl);

  const current = await onChainAuthority(rpc, config.gameId);
  if (current === null) {
    console.error(`El juego ${config.gameId} no existe en la cadena: crealo con npm run init-game.`);
    return 1;
  }
  const versions = await readTransitKey(transit);
  const target = versions.at(-1);
  if (target === undefined) throw new Error('la clave no tiene versiones');
  if (target.address === current) {
    console.error(`La autoridad ya es la version ${target.version}. Rota antes la clave en OpenBao:`);
    console.error(`  POST ${transit.addr}/v1/${transit.mount}/keys/${transit.key}/rotate`);
    return 1;
  }

  // Firma la autoridad actual: la de la semilla o una version anterior de la clave.
  let signer: TransactionSigner;
  let from: string;
  const seeded = deriveAuthority(config.masterSeed, config.gameId);
  const previous = versions.find((v) => v.address === current);
  if (seeded.address === current) {
    signer = await authoritySigner(seeded);
    from = 'la semilla';
  } else if (previous !== undefined) {
    signer = transitSigner(transit, previous);
    from = `la version ${previous.version}`;
  } else {
    console.error(`La autoridad actual (${current}) no es la de la semilla ni ninguna version de la clave: no hay quien firme.`);
    return 1;
  }

  console.warn(`juego ${config.gameId}`);
  console.warn(`autoridad actual ${current} (${from})`);
  console.warn(`autoridad nueva  ${target.address} (version ${target.version} de ${transit.key})`);

  const { value: funds } = await rpc.getBalance(target.address, { commitment: 'confirmed' }).send();
  if (funds === 0n) {
    console.error('La autoridad nueva no tiene fondos, y pagara todas las operaciones. Financiala antes:');
    console.error(`  solana transfer ${target.address} 0.2 --allow-unfunded-recipient`);
    return 1;
  }
  console.warn(`saldo de la nueva: ${Number(funds) / LAMPORTS_PER_SOL} SOL`);

  const lifetime = (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;
  const transaction = await signTransactionMessageWithSigners(
    await buildRotateAuthority(signer, config.gameId, target.address, lifetime),
  );
  const simulated = await simulate(rpc, transaction);
  if (simulated !== null) {
    console.error(`No se puede rotar: ${simulated.failure.code}, ${simulated.failure.message}`);
    return 1;
  }

  const signature = getSignatureFromTransaction(transaction);
  await send(rpc, transaction);
  for (let i = 0; i < 60; i++) {
    const [status] = (await rpc.getSignatureStatuses([signature]).send()).value;
    if (status?.err) {
      console.error(`rotate_authority falla en la cadena: ${JSON.stringify(status.err)}`);
      return 1;
    }
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      const now = await onChainAuthority(rpc, config.gameId);
      if (now !== target.address) {
        console.error(`Confirmada, pero la autoridad del juego es ${now}: revisa la transaccion ${signature}`);
        return 1;
      }
      console.warn(`Autoridad rotada: ${signature}`);
      console.warn(`Arranca el backend: firmara con la version ${target.version}.`);
      return 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.error(`rotate_authority sin confirmar en 60 s: ${signature}`);
  return 1;
}

process.exitCode = await main();
