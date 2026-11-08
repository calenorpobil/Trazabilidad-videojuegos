/**
 * Idempotencia de las escrituras (contrato, 3; propuesta, 4.4). Invariante 2 de CLAUDE.md:
 * **marcar primero, llamar despues.**
 *
 * `claim` ejecuta, dentro de UNA transaccion SQLite inmediata:
 *   1. buscar la clave; si existe, devolver la respuesta guardada sin hacer nada mas;
 *   2. si no, registrar la peticion (`register`: crea la operacion y sus filas y devuelve la
 *      respuesta del 202);
 *   3. guardar la clave con esa respuesta.
 *
 * La transaccion se confirma ANTES de volver al llamador, y solo entonces el llamador toca la
 * cadena, y solo si `replayed` es `false`. Asi no hay ventana en la que un reintento vea la clave
 * sin marcar mientras la primera peticion ya esta enviando.
 *
 * Si `register` lanza (validacion, coleccion inexistente...), la transaccion se deshace y la clave
 * queda libre: solo se marca lo aceptado.
 *
 * `immediate` toma el bloqueo de escritura al empezar, de modo que dos procesos con la misma clave
 * no pueden leer los dos "no existe".
 */
import { timestamp, type Db } from './db.js';

/** Longitud admitida de `Idempotency-Key` (contrato, 3). */
export const IDEMPOTENCY_KEY_MAX = 128;

export function isValidIdempotencyKey(key: string | undefined): key is string {
  return key !== undefined && key.length >= 1 && key.length <= IDEMPOTENCY_KEY_MAX;
}

export interface AcceptedResponse {
  /** Codigo HTTP de la respuesta aceptada: 202, o 201 para las colecciones. */
  status: number;
  body: unknown;
  /** `null` en `POST /v1/collections`, que no tiene operacion. */
  operationId: string | null;
}

export interface ClaimResult extends AcceptedResponse {
  /** `true` si la clave ya existia: el llamador NO debe tocar la cadena. */
  replayed: boolean;
}

export function claim(db: Db, key: string, register: () => AcceptedResponse, now: Date = new Date()): ClaimResult {
  if (!isValidIdempotencyKey(key)) {
    throw new Error(`la clave de idempotencia debe tener entre 1 y ${IDEMPOTENCY_KEY_MAX} caracteres`);
  }
  return db
    .transaction((): ClaimResult => {
      const previous = db
        .prepare('SELECT operation_id, status_code, response FROM idempotency WHERE key = ?')
        .get(key) as { operation_id: string | null; status_code: number; response: string } | undefined;
      if (previous !== undefined) {
        return {
          replayed: true,
          status: previous.status_code,
          body: JSON.parse(previous.response),
          operationId: previous.operation_id,
        };
      }

      const accepted = register();
      db.prepare(
        'INSERT INTO idempotency (key, operation_id, status_code, response, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(key, accepted.operationId, accepted.status, JSON.stringify(accepted.body), timestamp(now));
      return { replayed: false, ...accepted };
    })
    .immediate();
}
