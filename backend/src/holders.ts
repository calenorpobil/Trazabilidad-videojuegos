/**
 * Mapa de tenedores (propuesta, 4.3 y revision del 8-nov-2026): resuelve la referencia de un
 * contrato (4.1) a su `holder_id` y a su direccion en la cadena, que no sale del backend.
 *
 * - `external_id`: se deriva la clave del jugador y se registra en `holders` la primera vez.
 * - `holder_id`: solo vale si esta registrado. El `holder_id` trunca la direccion y no se puede
 *   invertir; uno que no esta en la tabla es `404` (propuesta, 4.4).
 */
import type { Address } from '@solana/kit';
import { timestamp, type Db } from './db.js';
import { derivePlayer } from './keys.js';

/** Referencia a un tenedor, con exactamente una de las dos claves (contrato, 4.1). */
export type HolderRef = { readonly external_id: string } | { readonly holder_id: string };

export interface Holder {
  readonly holderId: string;
  readonly address: Address;
}

/** Lo que hace falta para derivar claves de jugador: la configuracion del despliegue. */
export interface HolderKeys {
  readonly masterSeed: Uint8Array;
  readonly gameId: string;
}

/** Devuelve el tenedor, o `null` si es un `holder_id` sin registrar. Pensada para ir dentro de una transaccion SQLite. */
export function resolveHolder(db: Db, keys: HolderKeys, ref: HolderRef, now: Date = new Date()): Holder | null {
  if ('holder_id' in ref) {
    const row = db.prepare('SELECT holder_id, address FROM holders WHERE holder_id = ?').get(ref.holder_id) as
      | { holder_id: string; address: Address }
      | undefined;
    return row === undefined ? null : { holderId: row.holder_id, address: row.address };
  }

  const player = derivePlayer(keys.masterSeed, keys.gameId, ref.external_id);
  db.prepare(
    `INSERT INTO holders (holder_id, external_id, address, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (external_id) DO NOTHING`,
  ).run(player.holderId, ref.external_id, player.address, timestamp(now));

  const row = db.prepare('SELECT holder_id, address FROM holders WHERE external_id = ?').get(ref.external_id) as
    | { holder_id: string; address: Address }
    | undefined;
  // Si la fila no coincide, otro external_id tiene el mismo holder_id: dos direcciones con los mismos
  // 16 primeros caracteres. No deberia ocurrir nunca (unos 93 bits), pero no se oculta.
  if (row?.holder_id !== player.holderId || row.address !== player.address) {
    throw new Error(`holder_id duplicado al registrar un external_id: ${player.holderId}`);
  }
  return { holderId: row.holder_id, address: row.address };
}
