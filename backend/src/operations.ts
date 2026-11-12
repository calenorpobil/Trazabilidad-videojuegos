/**
 * Maquina de estados de las operaciones (contrato, 7):
 *
 *   pending --> applied --> settled
 *      |           |
 *      +-----------+-----> failed
 *
 * Las transiciones validas salen de `OPERATION_TRANSITIONS`, sin repetirlas aqui. Cada cambio se
 * hace con un UPDATE condicionado al estado de origen, de modo que dos procesos que intenten
 * mover la misma operacion no pueden saltarse la maquina: el segundo no encuentra la fila.
 */
import {
  OPERATION_STATES,
  OPERATION_TRANSITIONS,
  errorBody,
  type ChainErrorBody,
  type ErrorCode,
  type OperationState,
} from './contract.js';
import { timestamp, type Db, type OperationKind } from './db.js';
import { newId } from './ids.js';

/** Lo que devuelve `GET /v1/operations/{id}` (contrato, 5.1). Sin firma ni datos de red. */
export interface OperationView {
  operation_id: string;
  state: OperationState;
  error: ChainErrorBody | null;
}

export class OperationNotFoundError extends Error {
  override readonly name = 'OperationNotFoundError';
}

export class InvalidTransitionError extends Error {
  override readonly name = 'InvalidTransitionError';
}

/** Estados desde los que se puede llegar a `to`. */
function sourcesOf(to: OperationState): OperationState[] {
  return OPERATION_STATES.filter((from) => OPERATION_TRANSITIONS[from].includes(to));
}

/**
 * Registra una operacion nueva en `pending`, en el paso 1. Pensada para llamarse dentro de una
 * reclamacion idempotente. `payload` es lo que hace falta para construir un paso posterior (P11):
 * hoy, solo el `grant` de un tipo partido.
 */
export function createOperation(db: Db, kind: OperationKind, payload: unknown = null, now: Date = new Date()): string {
  const id = newId('operation');
  const at = timestamp(now);
  db.prepare(
    `INSERT INTO operations (operation_id, kind, state, payload, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?, ?)`,
  ).run(id, kind, payload === null ? null : JSON.stringify(payload), at, at);
  return id;
}

/**
 * Guarda la firma de la transaccion del paso en curso. Se llama ANTES de enviarla: si el backend
 * se reinicia despues, el seguimiento sabe que buscar y no la envia otra vez.
 */
export function recordSignature(db: Db, operationId: string, signature: string, now: Date = new Date()): void {
  const result = db
    .prepare("UPDATE operations SET signature = ?, updated_at = ? WHERE operation_id = ? AND state = 'pending'")
    .run(signature, timestamp(now), operationId);
  if (result.changes === 0) {
    const current = getOperation(db, operationId);
    if (current === null) throw new OperationNotFoundError(operationId);
    throw new InvalidTransitionError(`${operationId}: no se registra una firma en ${current.state}`);
  }
}

/**
 * Mueve una operacion a `to`. `failed` exige un error y ningun otro estado lo admite.
 * Lanza `InvalidTransitionError` si la maquina no permite el salto desde el estado actual.
 */
export function transitionOperation(
  db: Db,
  operationId: string,
  to: OperationState,
  error?: { code: ErrorCode; message: string },
  now: Date = new Date(),
): void {
  if ((to === 'failed') !== (error !== undefined)) {
    throw new InvalidTransitionError(
      to === 'failed' ? 'una operacion failed necesita un error' : `una operacion ${to} no lleva error`,
    );
  }
  const from = sourcesOf(to);
  const result = db
    .prepare(
      `UPDATE operations
          SET state = ?, error_code = ?, error_message = ?, updated_at = ?
        WHERE operation_id = ? AND state IN (${from.map(() => '?').join(', ')})`,
    )
    .run(to, error?.code ?? null, error?.message ?? null, timestamp(now), operationId, ...from);

  if (result.changes === 0) {
    const current = getOperation(db, operationId);
    if (current === null) throw new OperationNotFoundError(operationId);
    throw new InvalidTransitionError(`${operationId}: ${current.state} -> ${to} no esta permitido`);
  }
}

export function getOperation(db: Db, operationId: string): OperationView | null {
  const row = db
    .prepare('SELECT operation_id, state, error_code, error_message FROM operations WHERE operation_id = ?')
    .get(operationId) as
    | { operation_id: string; state: OperationState; error_code: ErrorCode | null; error_message: string | null }
    | undefined;
  if (row === undefined) return null;
  return {
    operation_id: row.operation_id,
    state: row.state,
    error: row.error_code === null ? null : errorBody(row.error_code, row.error_message ?? ''),
  };
}
