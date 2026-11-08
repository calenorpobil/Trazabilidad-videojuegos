/**
 * Identificadores opacos con prefijo (contrato, 1). El cliente no los interpreta ni asume su
 * longitud. Son aleatorios: no codifican nada, y en particular ninguna direccion.
 *
 * Los `holder_id` no salen de aqui: se derivan de la clave del jugador (propuesta, 4.3).
 */
import { randomBytes } from 'node:crypto';
import { ID_PREFIX, type EntityKind } from './contract.js';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** 16 caracteres de 62 posibles: unos 95 bits, sin colisiones en la practica. */
const ID_LENGTH = 16;
/** Mayor multiplo de 62 que cabe en un byte: por encima se descarta, para no sesgar. */
const LIMIT = 256 - (256 % ALPHABET.length);

export function newId(kind: Exclude<EntityKind, 'holder'>): string {
  let out = '';
  while (out.length < ID_LENGTH) {
    for (const byte of randomBytes(ID_LENGTH * 2)) {
      if (byte < LIMIT) out += ALPHABET[byte % ALPHABET.length];
      if (out.length === ID_LENGTH) break;
    }
  }
  return ID_PREFIX[kind] + out;
}
