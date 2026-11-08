/**
 * Vectores fijos de las direcciones que deriva el backend (propuesta, 4.7): la PDA `Game`, la
 * semilla y el mint de cada tipo, y la cuenta de token asociada de un tenedor.
 *
 * De donde salen los valores (8-nov-2026, en WSL, sin compartir codigo con `src/addresses.ts`):
 *
 *   printf '%s' itm_0123456789abcdef | sha256sum
 *   solana find-program-derived-address <programa> string:game string:<game_id>
 *   solana find-program-derived-address <programa> string:item pubkey:<game> hex:<item_seed>
 *   solana find-program-derived-address <programa de cuentas asociadas> \
 *     pubkey:<tenedor> pubkey:<Token-2022> pubkey:<mint>
 *
 * La CLI de Solana 4.1.2 usa la misma derivacion que el programa en Rust. Ademas, la PDA de
 * `oc2-1794140207` es la del juego que creo `devnet_tx` en la prueba de humo de OC2 (V12).
 *
 * Si alguno cambia, todos los tipos ya creados dejan de encontrarse: no se "actualizan" para que
 * el test pase.
 */
import type { Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { findGameAddress, findHolderTokenAddress, findItemMintAddress, itemSeed } from '../src/addresses.js';

const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const ALICE = '9iSwm7eB94k9GL7fEnJCBZa3NvqGiSX7uAv1pzUC2NJp' as Address;

describe('item_seed := SHA-256(item_id en UTF-8)', () => {
  it('vector 1: itm_0123456789abcdef', () => {
    expect(toHex(itemSeed('itm_0123456789abcdef'))).toBe(
      '608c56ef4aab020acb12e4439066a85fe2c14eabbc5e0cba989bb20c063427aa',
    );
  });

  it('vector 2: itm_7Hs2Qd8Xa4Rb0Tk1', () => {
    expect(toHex(itemSeed('itm_7Hs2Qd8Xa4Rb0Tk1'))).toBe(
      'fede13e1b215a894651c19d7d1f33048eb3a5a6d0b8b77b2040f010611bbbaa5',
    );
  });

  it('usa el item_id completo, con su prefijo', () => {
    expect(toHex(itemSeed('0123456789abcdef'))).not.toBe(toHex(itemSeed('itm_0123456789abcdef')));
  });

  it('tiene 32 bytes, lo que cabe en el [u8; 32] de CreateItemArgs', () => {
    expect(itemSeed('itm_0123456789abcdef')).toHaveLength(32);
  });
});

describe('PDA Game: ["game", game_id]', () => {
  it('oc2-1794140207, el juego de la prueba de humo de OC2', async () => {
    expect(await findGameAddress('oc2-1794140207')).toBe('DVKimGfAe2H98Y6BVY1wmtbFPZGB4Z5YERGU54ZuVtEQ');
  });

  it('test-game', async () => {
    expect(await findGameAddress('test-game')).toBe('6XiaWL7NyLajXEHVxJ7XW8e8B1DfegStC4BXDpXz3PyE');
  });
});

describe('mint del tipo: ["item", game, item_seed]', () => {
  it.each([
    ['oc2-1794140207', 'itm_0123456789abcdef', '59FNfehFekLxScvJTt4ijXUNSKm3MBTvEVAqsDuPUT5Q'],
    ['oc2-1794140207', 'itm_7Hs2Qd8Xa4Rb0Tk1', '3dATJfzdoUAs84msdpfzKjGb42MCNLcv3nGPm9t7eQDp'],
    ['test-game', 'itm_0123456789abcdef', 'DuA7mX5EqPu8UyY22QoyuwTurV2vzWqaK1FWHynHw2UK'],
    ['test-game', 'itm_7Hs2Qd8Xa4Rb0Tk1', '7CstA2oFjbuZQTBxkzApejsMFsCvPyxQ3BCoxrHZE9jP'],
  ])('%s / %s', async (gameId, itemId, mint) => {
    expect(await findItemMintAddress(await findGameAddress(gameId), itemId)).toBe(mint);
  });
});

describe('cuenta de token asociada (Token-2022)', () => {
  it.each([
    ['59FNfehFekLxScvJTt4ijXUNSKm3MBTvEVAqsDuPUT5Q', 'EUMuEkqDWmriR4BoLHeV8zcMg774suyrWTHGiDLsx21U'],
    ['7CstA2oFjbuZQTBxkzApejsMFsCvPyxQ3BCoxrHZE9jP', '8jTboKigZZ22GkfmGTzGhhDZqhk121nt2BpHTa3ndN6m'],
  ])('mint %s', async (mint, token) => {
    expect(await findHolderTokenAddress(ALICE, mint as Address)).toBe(token);
  });
});
