/**
 * Bucle de seguimiento (bloque 5; propuesta, 5; contrato, 7). Mueve cada operacion con firma
 * registrada por la maquina de estados mirando la cadena:
 *
 * - `confirmed` -> `applied`, y `finalized` -> `settled` (de `pending`, pasando por `applied`).
 * - Un error de la transaccion solo se da por final en `finalized`, como el exito: hasta entonces
 *   la transaccion podria estar en una bifurcacion que desaparece. Se clasifica con los logs de la
 *   transaccion (`submission.ts`).
 * - **Tipo partido (P11).** Mientras el paso 1 (`create_item`) no esta en `finalized`, la operacion
 *   sigue en `pending`: el tenedor aun no tiene nada que animar. En `finalized` se construye el
 *   `grant` desde `payload`, se firma, se simula y se registra su firma (paso 2) **antes** de
 *   enviarlo. A partir de ahi, el paso 2 sigue las mismas reglas.
 *
 * **Caducidad (P13).** La firma de cada paso se guarda con la ultima altura de bloque en la que
 * puede entrar (`last_valid_block_height`). Una operacion se da por `failed` / `EXPIRED` cuando la
 * altura **finalizada** ya pasa de esa cota y la firma no aparece, buscando tambien en el historico.
 * La altura se pide **antes** que los estados: si ya habia pasado la cota, la transaccion no puede
 * entrar despues, y lo que entrara antes lo ve la consulta de estados. Es finalizada y no confirmada
 * porque todo bloque posterior a uno finalizado por encima de la cota tiene una altura mayor, y en
 * el no cabe la transaccion. Asi caduca tambien una `applied` que desaparece, y una firma
 * registrada que nunca se llego a enviar (reinicio entre el registro y el envio).
 *
 * No reenvia transacciones: el backend no las guarda, solo su firma. Una que se pierde caduca, y
 * reintentar es decision del servidor de juego con una clave nueva (contrato, 8).
 */
import {
  getSignatureFromTransaction,
  signTransactionMessageWithSigners,
  type Address,
  type Signature,
  type TransactionError,
  type TransactionSigner,
} from '@solana/kit';
import type { Db } from './db.js';
import {
  openOperations,
  recordSignature,
  transitionOperation,
  type OpenOperation,
} from './operations.js';
import type { ChainRpc } from './server.js';
import { classifyFailure, send, simulate, type Failure } from './submission.js';
import { buildGrant } from './transactions.js';

export interface TrackerOptions {
  readonly db: Db;
  readonly rpc: ChainRpc;
  readonly gameId: string;
  /** La autoridad del juego: firma el paso 2 de un tipo partido. */
  readonly authority: TransactionSigner;
  readonly log?: (message: string, detail?: unknown) => void;
}

/** Cuantas firmas admite `getSignatureStatuses` en una llamada. */
const STATUS_BATCH = 256;

/** Intervalo del bucle. Una vuelta sin operaciones abiertas no llama al nodo. */
export const TRACKER_INTERVAL_MS = 2000;

const EXPIRED: Failure = { code: 'EXPIRED', message: 'la ventana de validez se agoto antes de confirmarse' };

type Status = Awaited<ReturnType<ReturnType<ChainRpc['getSignatureStatuses']>['send']>>['value'][number];

/** Lo que el paso 2 de un tipo partido necesita (lo escribe `POST /v1/items`). */
interface GrantPayload {
  readonly holder: Address;
  readonly amount: number;
}

/** Una vuelta del bucle: consulta la cadena una vez y mueve lo que haya que mover. */
export async function trackOnce(options: TrackerOptions): Promise<void> {
  const { db, rpc } = options;
  const open = openOperations(db);
  if (open.length === 0) return;

  // Primero la altura y despues los estados: ver la cabecera.
  const height = await rpc.getBlockHeight({ commitment: 'finalized' }).send();
  const statuses: Status[] = [];
  for (let i = 0; i < open.length; i += STATUS_BATCH) {
    const batch = open.slice(i, i + STATUS_BATCH).map((op) => op.signature as Signature);
    const { value } = await rpc.getSignatureStatuses(batch, { searchTransactionHistory: true }).send();
    statuses.push(...value);
  }

  // Una operacion que falla (el nodo corta a mitad del paso 2...) no frena a las demas.
  for (const [i, op] of open.entries()) {
    try {
      await advance(options, op, statuses[i] ?? null, height);
    } catch (error) {
      options.log?.('seguimiento de una operacion fallido', { operation: op.operationId, err: error });
    }
  }
}

async function advance(options: TrackerOptions, op: OpenOperation, status: Status, height: bigint): Promise<void> {
  const { db } = options;
  const fail = (failure: Failure) => transitionOperation(db, op.operationId, 'failed', failure);

  if (status === null) {
    if (height > op.lastValidBlockHeight) fail(EXPIRED);
    return;
  }

  const splitPending = op.step === 1 && op.payload !== null;
  if (status.confirmationStatus !== 'finalized') {
    if (status.err === null && op.state === 'pending' && !splitPending && status.confirmationStatus === 'confirmed') {
      transitionOperation(db, op.operationId, 'applied');
    }
    return;
  }

  if (status.err !== null) {
    fail(classifyFailure(status.err, await logsOf(options, op.signature as Signature)));
    options.log?.('operacion fallida en la cadena', { operation: op.operationId, err: status.err as TransactionError });
    return;
  }
  if (splitPending) {
    await startGrant(options, op);
    return;
  }
  if (op.state === 'pending') transitionOperation(db, op.operationId, 'applied');
  transitionOperation(db, op.operationId, 'settled');
}

async function logsOf(options: TrackerOptions, signature: Signature): Promise<readonly string[]> {
  const transaction = await options.rpc
    .getTransaction(signature, { commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 0 })
    .send();
  return transaction?.meta?.logMessages ?? [];
}

/** Paso 2 de un tipo partido: el `grant` desde el `payload`. Marcar primero, enviar despues. */
async function startGrant(options: TrackerOptions, op: OpenOperation): Promise<void> {
  const { db, rpc, authority, gameId } = options;
  const row = db.prepare('SELECT item_id FROM items WHERE operation_id = ?').get(op.operationId) as
    | { item_id: string }
    | undefined;
  if (row === undefined) throw new Error(`${op.operationId}: tipo partido sin fila en items`);
  const payload = op.payload as GrantPayload;

  const lifetime = (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;
  const draft = await buildGrant(authority, gameId, row.item_id, payload.holder, payload.amount, lifetime);
  const transaction = await signTransactionMessageWithSigners(draft);

  const simulated = await simulate(rpc, transaction);
  if (simulated !== null) {
    transitionOperation(db, op.operationId, 'failed', simulated.failure);
    options.log?.('paso 2 rechazado en la simulacion', { operation: op.operationId, detail: simulated.detail });
    return;
  }

  recordSignature(
    db,
    op.operationId,
    { signature: getSignatureFromTransaction(transaction), lastValidBlockHeight: lifetime.lastValidBlockHeight },
    2,
  );
  try {
    await send(rpc, transaction);
  } catch (error) {
    // Registrada: si no llega, caduca como cualquier otra.
    options.log?.('envio del paso 2 fallido', { operation: op.operationId, err: error });
  }
}

/**
 * Arranca el bucle: una vuelta cada `intervalMs`, sin solaparse. Un fallo de una vuelta (el nodo
 * limita la tasa, se cae la red) se registra y la siguiente lo intenta de nuevo. Devuelve la
 * funcion que lo para.
 */
export function startTracker(options: TrackerOptions, intervalMs: number = TRACKER_INTERVAL_MS): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const loop = async () => {
    try {
      await trackOnce(options);
    } catch (error) {
      options.log?.('vuelta del seguimiento fallida', { err: error });
    }
    if (!stopped) timer = setTimeout(() => void loop(), intervalMs);
  };
  timer = setTimeout(() => void loop(), intervalMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
