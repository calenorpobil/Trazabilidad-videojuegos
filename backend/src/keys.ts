/**
 * Derivacion de claves desde la semilla maestra del juego (propuesta, 4.3). Esquema concreto,
 * no se reinventa:
 *
 *   authority_seed     := HKDF-SHA512(ikm = master_seed, salt = game_id, info = "authority")
 *   player_seed(ext)   := HKDF-SHA512(ikm = master_seed, salt = game_id, info = "player:" || ext)
 *   keypair(x)         := ed25519_from_seed(primeros 32 bytes de x)
 *   holder_id(ext)     := "hld_" || base58(pubkey(keypair(player_seed(ext))))[0..16]
 *
 * Los vectores fijos estan en `tests/keys.test.ts`. Cambiar cualquier detalle de este modulo
 * cambia la autoridad y los tenedores de todo juego ya desplegado.
 *
 * Las claves privadas de jugador se derivan pero no firman nunca en la v1 (propuesta, 4.2): hacen
 * falta para la direccion, y son el camino que usaria un futuro `claim`.
 */
import { createPrivateKey, createPublicKey, hkdfSync } from 'node:crypto';
import { getAddressDecoder } from '@solana/kit';
import { ID_PREFIX } from './contract.js';

export const MASTER_SEED_BYTES = 32;

/** Semilla de la PDA `Game` (4.7) y `salt` de la derivacion: debe caber en 32 bytes. */
export const GAME_ID_PATTERN = /^[a-z0-9-]{1,32}$/;

export interface AuthorityKey {
  /** Semilla ed25519 de 32 bytes. Nunca sale del backend ni se registra en logs. */
  readonly secret: Uint8Array;
  readonly publicKey: Uint8Array;
  /** Direccion en la cadena. Nunca cruza la API publica. */
  readonly address: string;
}

/** Prefijo DER de PKCS#8 para una clave privada Ed25519 de 32 bytes (RFC 8410). */
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_KEY_BYTES = 32;

export function publicKeyFromSeed(seed: Uint8Array): Uint8Array {
  if (seed.length !== ED25519_KEY_BYTES) {
    throw new Error(`la semilla ed25519 debe tener ${ED25519_KEY_BYTES} bytes`);
  }
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  // La SPKI de Ed25519 termina en los 32 bytes de la clave publica.
  return Uint8Array.from(spki.subarray(spki.length - ED25519_KEY_BYTES));
}

function hkdf(masterSeed: Uint8Array, gameId: string, info: string): Uint8Array {
  if (masterSeed.length !== MASTER_SEED_BYTES) {
    throw new Error(`la semilla maestra debe tener ${MASTER_SEED_BYTES} bytes`);
  }
  if (!GAME_ID_PATTERN.test(gameId)) {
    throw new Error('game_id debe cumplir [a-z0-9-]{1,32}');
  }
  const out = hkdfSync('sha512', masterSeed, Buffer.from(gameId, 'utf8'), Buffer.from(info, 'utf8'), 64);
  return new Uint8Array(out).slice(0, ED25519_KEY_BYTES);
}

export function deriveAuthority(masterSeed: Uint8Array, gameId: string): AuthorityKey {
  const secret = hkdf(masterSeed, gameId, 'authority');
  const publicKey = publicKeyFromSeed(secret);
  return { secret, publicKey, address: getAddressDecoder().decode(publicKey) };
}

/** Longitud de un `external_id`, en caracteres (contrato, 4.1; revision del 12-nov-2026). */
export const EXTERNAL_ID_MAX = 64;

export function isValidExternalId(externalId: string): boolean {
  const length = [...externalId].length;
  return length >= 1 && length <= EXTERNAL_ID_MAX;
}

/** Caracteres de la direccion que entran en el `holder_id`. */
const HOLDER_ID_ADDRESS_CHARS = 16;

export interface PlayerKey extends AuthorityKey {
  /** Identificador publico del tenedor. No se puede invertir: el mapa vive en `holders`. */
  readonly holderId: string;
}

export function derivePlayer(masterSeed: Uint8Array, gameId: string, externalId: string): PlayerKey {
  if (!isValidExternalId(externalId)) {
    throw new Error(`external_id debe tener entre 1 y ${EXTERNAL_ID_MAX} caracteres`);
  }
  const secret = hkdf(masterSeed, gameId, `player:${externalId}`);
  const publicKey = publicKeyFromSeed(secret);
  const address = getAddressDecoder().decode(publicKey);
  return { secret, publicKey, address, holderId: ID_PREFIX.holder + address.slice(0, HOLDER_ID_ADDRESS_CHARS) };
}
