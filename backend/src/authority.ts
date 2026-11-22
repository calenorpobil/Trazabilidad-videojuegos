/**
 * Quien firma como autoridad del juego, segun la configuracion (`config.ts`, `CHAIN_AUTHORITY_SIGNER`):
 * la clave derivada de la semilla, o una version de la clave de Transit en OpenBao (`transit.ts`).
 *
 * Con Transit, la version se elige al arrancar: la que coincide con la autoridad guardada en `Game`.
 * Si se rota la autoridad (`npm run rotate-authority`), el backend firma con la version vieja hasta
 * que se reinicia, y esas firmas las rechaza el programa: se para, se rota y se arranca.
 */
import type { Address, GetAccountInfoApi, Rpc, TransactionSigner } from '@solana/kit';
import { findGameAddress } from './addresses.js';
import type { Config } from './config.js';
import { fetchMaybeGame } from './generated/index.js';
import { deriveAuthority } from './keys.js';
import { authoritySigner } from './transactions.js';
import { pickVersion, readTransitKey, transitSigner, type FetchLike } from './transit.js';

export interface LoadedAuthority {
  readonly signer: TransactionSigner;
  /** Para los logs: de donde sale la firma. Nunca incluye secretos. */
  readonly description: string;
}

/** La autoridad que guarda hoy `Game`, o `null` si el juego aun no existe en la cadena. */
export async function onChainAuthority(rpc: Rpc<GetAccountInfoApi>, gameId: string): Promise<Address | null> {
  const game = await fetchMaybeGame(rpc, await findGameAddress(gameId), { commitment: 'confirmed' });
  return game.exists ? game.data.authority : null;
}

export async function loadAuthority(
  config: Pick<Config, 'authority' | 'masterSeed' | 'gameId'>,
  rpc: Rpc<GetAccountInfoApi>,
  fetchImpl: FetchLike = fetch,
): Promise<LoadedAuthority> {
  if (config.authority.kind === 'seed') {
    return { signer: await authoritySigner(deriveAuthority(config.masterSeed, config.gameId)), description: 'semilla' };
  }
  const { transit } = config.authority;
  const versions = await readTransitKey(transit, fetchImpl);
  const version = pickVersion(versions, await onChainAuthority(rpc, config.gameId));
  return {
    signer: transitSigner(transit, version, fetchImpl),
    description: `OpenBao Transit, clave ${transit.key} version ${version.version}`,
  };
}
