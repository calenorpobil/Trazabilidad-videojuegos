/**
 * Crea el juego de un despliegue en la cadena: `initialize_game` con la autoridad derivada de la
 * semilla maestra (P14). Se ejecuta una vez, antes de la primera escritura, con las mismas variables
 * de entorno que `npm start`:
 *
 *   CHAIN_GAME_ID=... CHAIN_MASTER_SEED_FILE=... (y las demas de config.ts) npm run init-game
 *
 * Es repetible: si el juego ya existe con esta autoridad, no hace nada. Si existe con otra, falla, y
 * hay que elegir otro `CHAIN_GAME_ID` (la PDA del juego sale solo de su identificador).
 *
 * La autoridad paga la creacion y todas las operaciones del juego, asi que necesita fondos antes. En
 * devnet, desde la CLI: `solana transfer <autoridad> 0.2 --allow-unfunded-recipient`.
 */
import { createSolanaRpc, getSignatureFromTransaction, signTransactionMessageWithSigners } from '@solana/kit';
import { findGameAddress } from '../src/addresses.js';
import { loadConfig } from '../src/config.js';
import { fetchMaybeGame } from '../src/generated/index.js';
import { deriveAuthority } from '../src/keys.js';
import { send, simulate } from '../src/submission.js';
import { authoritySigner, buildInitializeGame } from '../src/transactions.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

/** Codigo de salida. Sin `process.exit`: en Windows corta sockets a medio cerrar y libuv aborta. */
async function main(): Promise<number> {
  const config = loadConfig();
  const rpc = createSolanaRpc(config.rpcUrl);
  const authority = await authoritySigner(deriveAuthority(config.masterSeed, config.gameId));
  const game = await findGameAddress(config.gameId);
  const { value: balance } = await rpc.getBalance(authority.address, { commitment: 'confirmed' }).send();

  console.warn(`juego ${config.gameId}`);
  console.warn(`autoridad ${authority.address}, saldo ${Number(balance) / LAMPORTS_PER_SOL} SOL`);

  const existing = await fetchMaybeGame(rpc, game, { commitment: 'confirmed' });
  if (existing.exists) {
    if (existing.data.authority !== authority.address) {
      console.error('Ese juego ya existe con otra autoridad: elige otro CHAIN_GAME_ID.');
      return 1;
    }
    console.warn('El juego ya estaba creado con esta autoridad. Nada que hacer.');
    return 0;
  }

  const lifetime = (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;
  const transaction = await signTransactionMessageWithSigners(
    await buildInitializeGame(authority, config.gameId, lifetime),
  );
  const simulated = await simulate(rpc, transaction);
  if (simulated !== null) {
    console.error(`No se puede crear el juego: ${simulated.failure.code}, ${simulated.failure.message}`);
    if (simulated.failure.code === 'INSUFFICIENT_FUNDS') {
      console.error(`Financia la autoridad: solana transfer ${authority.address} 0.2 --allow-unfunded-recipient`);
    }
    return 1;
  }

  const signature = getSignatureFromTransaction(transaction);
  await send(rpc, transaction);
  for (let i = 0; i < 60; i++) {
    const [status] = (await rpc.getSignatureStatuses([signature]).send()).value;
    if (status?.err) {
      console.error(`initialize_game falla en la cadena: ${JSON.stringify(status.err)}`);
      return 1;
    }
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      console.warn(`Juego creado: ${signature}`);
      return 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.error(`initialize_game sin confirmar en 60 s: ${signature}`);
  return 1;
}

process.exitCode = await main();
