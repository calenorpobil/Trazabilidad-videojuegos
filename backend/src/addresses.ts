/**
 * Direcciones que deriva el backend para `chain-assets` (propuesta, 4.7). Ninguna cruza la API
 * publica: se quedan dentro del backend (invariante 3).
 *
 *   Game         := PDA(["game", game_id])
 *   item_seed    := SHA-256(item_id en UTF-8), con el prefijo `itm_` incluido
 *   mint         := PDA(["item", Game, item_seed])
 *   cuenta       := cuenta de token asociada de Token-2022 (tenedor, mint)
 *
 * `item_seed` (decidido el 8-nov-2026) hace el mint determinista a partir del `item_id`: no hay que
 * guardar nada mas para encontrarlo. Cabe exacto en el `[u8; 32]` de `CreateItemArgs`.
 *
 * Vectores fijos en `tests/addresses.test.ts`. Cambiar este modulo pierde los tipos ya creados.
 */
import { createHash } from 'node:crypto';
import { getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { CHAIN_ASSETS_PROGRAM_ADDRESS, findGamePda } from './generated/index.js';

const ITEM_SEED_PREFIX = 'item';

export function itemSeed(itemId: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(itemId, 'utf8').digest());
}

export async function findGameAddress(gameId: string): Promise<Address> {
  const [game] = await findGamePda({ gameId });
  return game;
}

export async function findItemMintAddress(game: Address, itemId: string): Promise<Address> {
  const [mint] = await getProgramDerivedAddress({
    programAddress: CHAIN_ASSETS_PROGRAM_ADDRESS,
    seeds: [ITEM_SEED_PREFIX, getAddressEncoder().encode(game), itemSeed(itemId)],
  });
  return mint;
}

export async function findHolderTokenAddress(holder: Address, mint: Address): Promise<Address> {
  const [token] = await findAssociatedTokenPda({ owner: holder, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
  return token;
}
