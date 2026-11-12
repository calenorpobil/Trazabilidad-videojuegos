/**
 * Vectores fijos de derivacion de claves (propuesta, 4.3). Se escribieron ANTES de la
 * implementacion, como pide la seccion 15.
 *
 * De donde salen los valores: un script aparte, que no comparte codigo con `src/keys.ts`,
 * calcula HKDF-SHA512 a mano (RFC 5869, con HMAC) y la clave publica con WebCrypto a traves de
 * `@solana/kit`. La implementacion usa `hkdfSync` y `node:crypto`. Que coincidan dos caminos
 * distintos es lo que da valor a los vectores. El paso semilla -> clave publica se ancla ademas
 * al vector oficial de RFC 8032.
 *
 * Si alguno de estos valores cambia, todas las direcciones de un juego desplegado cambian con
 * el: el juego pierde su autoridad. No se "actualizan" para que el test pase.
 *
 * Las claves de jugador se anadieron el 12-nov-2026, al resolverse la Q12, con el mismo metodo:
 * el script aparte reproduce primero el vector 1 de la autoridad y despues calcula estos.
 *
 *   player_seed(ext) := HKDF-SHA512(ikm = master_seed, salt = game_id, info = "player:" || ext)
 *   holder_id(ext)   := "hld_" || base58(pubkey(keypair(player_seed(ext))))[0..16]
 */
import { describe, expect, it } from 'vitest';
import { deriveAuthority, derivePlayer, publicKeyFromSeed } from '../src/keys.js';

const hex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'hex'));
const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

const SEED_COUNTING = hex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
const SEED_ONES = hex('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

describe('semilla -> clave publica (ed25519)', () => {
  it('reproduce el vector TEST 1 de RFC 8032, seccion 7.1', () => {
    const seed = hex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
    expect(toHex(publicKeyFromSeed(seed))).toBe(
      'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    );
  });
});

describe('clave de la autoridad del juego', () => {
  it('vector 1: semilla 00..1f, juego test-game', () => {
    const a = deriveAuthority(SEED_COUNTING, 'test-game');
    expect(toHex(a.secret)).toBe('84309ef13ac74ce1af238e31a2c790210bcd4e929204510466bf49eab494c47f');
    expect(a.address).toBe('8RjThphJ2mp9s1PvFp5yEdJ4tcnMQPfDj6UbEfqAQ1sz');
  });

  it('vector 2: semilla ff..ff, juego chain-demo', () => {
    const a = deriveAuthority(SEED_ONES, 'chain-demo');
    expect(toHex(a.secret)).toBe('805315e332287e26be33cb0e957a05b1bebe25556854ea535b2a93433575de11');
    expect(a.address).toBe('9iSwm7eB94k9GL7fEnJCBZa3NvqGiSX7uAv1pzUC2NJp');
  });

  it('vector 3: misma semilla, otro juego, otra clave (salt = game_id)', () => {
    const a = deriveAuthority(SEED_COUNTING, 'otro-juego');
    expect(toHex(a.secret)).toBe('28e08e4df91dbe850b831901a673f6dde53a886b8c7723156c3a7199ee0ecfc5');
    expect(a.address).toBe('Ari5iQHz4bmcyRjfGDfEC3mynYiVUbUPxWofuYcMXwN9');
  });

  it('es determinista', () => {
    expect(deriveAuthority(SEED_ONES, 'chain-demo')).toEqual(deriveAuthority(SEED_ONES, 'chain-demo'));
  });

  it('rechaza una semilla que no tiene 32 bytes', () => {
    expect(() => deriveAuthority(new Uint8Array(31), 'test-game')).toThrow();
    expect(() => deriveAuthority(new Uint8Array(33), 'test-game')).toThrow();
  });

  it('rechaza un game_id fuera de [a-z0-9-]{1,32}', () => {
    for (const bad of ['', 'Test-Game', 'juego_1', 'año', 'a'.repeat(33)]) {
      expect(() => deriveAuthority(SEED_COUNTING, bad), bad).toThrow();
    }
  });
});

describe('clave y holder_id de un jugador', () => {
  it('vector 1: semilla 00..1f, juego test-game, player-42', () => {
    const p = derivePlayer(SEED_COUNTING, 'test-game', 'player-42');
    expect(toHex(p.secret)).toBe('cbf6163fb57f29b5aa56daee9106d121f919214a8b095eb8df26ec1ea5750b9a');
    expect(p.address).toBe('2LmEXGH9GXGjSmfFy7VY9E6nVXioH5R2bTvusCUbRWTq');
    expect(p.holderId).toBe('hld_2LmEXGH9GXGjSmfF');
  });

  it('vector 2: otro jugador del mismo juego', () => {
    const p = derivePlayer(SEED_COUNTING, 'test-game', 'player-77');
    expect(toHex(p.secret)).toBe('19efcaca0d81423dc22849ca3996236c7b63bd0af5a54e0e044f5c057e42d2dd');
    expect(p.address).toBe('4ZqitPcCAcAz1X7L5KY9ZNFHMu5uf5URh5Rz4tpFs31j');
    expect(p.holderId).toBe('hld_4ZqitPcCAcAz1X7L');
  });

  it('vector 3: mismo jugador, otra semilla y otro juego', () => {
    const p = derivePlayer(SEED_ONES, 'otro-juego', 'player-42');
    expect(toHex(p.secret)).toBe('0d3eacfd4b0533cbd03e805bfabefc1adca50b7fbbdf213014d081201702ab35');
    expect(p.address).toBe('EGraMU8wB9SASaBXkXXxEZU1XKv2NMk1uafnaSEHcMo6');
    expect(p.holderId).toBe('hld_EGraMU8wB9SASaBX');
  });

  it('vector 4: external_id fuera de ASCII, en UTF-8', () => {
    const p = derivePlayer(SEED_COUNTING, 'test-game', 'jugador-ñ');
    expect(toHex(p.secret)).toBe('03cecf9913ae76c3107cc2cba2d040229955ac532e02f7bdbf0d7191dd476c60');
    expect(p.address).toBe('2tgNY9ZNwUfSk6ZiwFJwFH8BKBhNNQ16oA2a3aa5tibB');
    expect(p.holderId).toBe('hld_2tgNY9ZNwUfSk6Zi');
  });

  it('un jugador nunca coincide con la autoridad', () => {
    expect(derivePlayer(SEED_COUNTING, 'test-game', 'authority').address).not.toBe(
      deriveAuthority(SEED_COUNTING, 'test-game').address,
    );
  });

  it('rechaza un external_id fuera de 1..64 caracteres', () => {
    expect(() => derivePlayer(SEED_COUNTING, 'test-game', '')).toThrow();
    expect(() => derivePlayer(SEED_COUNTING, 'test-game', 'a'.repeat(65))).toThrow();
    // 64 caracteres, aunque ocupen mas bytes en UTF-8.
    expect(() => derivePlayer(SEED_COUNTING, 'test-game', 'ñ'.repeat(64))).not.toThrow();
  });
});
