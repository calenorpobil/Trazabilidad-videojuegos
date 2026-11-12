/**
 * Simular, enviar y clasificar lo que responde la cadena (bloque 5). Lo usan el servidor, para la
 * primera transaccion de cada escritura, y el seguimiento, para el paso 2 de un tipo partido.
 *
 * **Simular antes de reclamar la clave.** La transaccion firmada se simula antes de `claim`. Si no
 * se puede pagar, la escritura responde `503` / `INSUFFICIENT_FUNDS`, y si el emisor no tiene saldo,
 * `409` / `INSUFFICIENT_BALANCE` (contrato, 6), sin guardar la clave: solo se marca lo aceptado. Despues
 * se envia con `skipPreflight`, porque ya se simulo. Si el estado cambia entre la simulacion y la
 * ejecucion, la transaccion entra con error y el seguimiento la clasifica con la misma funcion.
 *
 * **Que programa fallo.** El error de Token-2022 por saldo insuficiente (`InsufficientFunds`) y el
 * del programa de sistema por lamports insuficientes (`ResultWithNegativeLamports`) llegan los dos
 * como `Custom: 1`: lo verificado en los clientes generados que hay instalados (`@solana-program/token-2022`
 * y `@solana-program/system`). Se distinguen por la primera linea `Program <id> failed: …` de los logs,
 * que es la del programa mas interno que fallo: el runtime escribe esa linea en cada nivel, de dentro
 * afuera (formato `"Program {} failed: {}"`, `program-runtime/src/stable_log.rs` de Agave, leido el
 * 12-nov-2026).
 */
import {
  getBase64EncodedWireTransaction,
  isSolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  type Rpc,
  type SendTransactionApi,
  type SimulateTransactionApi,
  type Transaction,
  type TransactionError,
} from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import type { ErrorCode } from './contract.js';

export const SYSTEM_PROGRAM_ADDRESS = '11111111111111111111111111111111';

/** Codigo `Custom` comun a `InsufficientFunds` (Token-2022) y `ResultWithNegativeLamports` (sistema). */
const CUSTOM_INSUFFICIENT = 1;

/** Un fallo con la forma del contrato. El mensaje no nombra la cadena. */
export interface Failure {
  readonly code: ErrorCode;
  readonly message: string;
}

const FUNDS: Failure = {
  code: 'INSUFFICIENT_FUNDS',
  message: 'la autoridad del juego no puede pagar la operacion: hay que recargarla',
};
const BALANCE: Failure = { code: 'INSUFFICIENT_BALANCE', message: 'el emisor no tiene unidades suficientes' };
const EXPIRED: Failure = { code: 'EXPIRED', message: 'la ventana de validez se agoto antes de confirmarse' };
const INTERNAL: Failure = { code: 'INTERNAL', message: 'la operacion no se pudo ejecutar' };

/** Programa de la primera linea `Program <id> failed: …`, o `null`. */
export function failingProgram(logs: readonly string[]): string | null {
  for (const line of logs) {
    const match = /^Program (\S+) failed: /.exec(line);
    if (match !== null) return match[1] ?? null;
  }
  return null;
}

/** Traduce el error de una transaccion, simulada o ya en la cadena, a una categoria del contrato. */
export function classifyFailure(err: TransactionError, logs: readonly string[]): Failure {
  if (err === 'InsufficientFundsForFee' || err === 'AccountNotFound') return FUNDS;
  if (err === 'BlockhashNotFound') return EXPIRED;
  if (typeof err !== 'object') return INTERNAL;
  if ('InsufficientFundsForRent' in err) return FUNDS;
  if ('InstructionError' in err) {
    const [, cause] = err.InstructionError;
    if (typeof cause === 'object' && 'Custom' in cause && Number(cause.Custom) === CUSTOM_INSUFFICIENT) {
      const program = failingProgram(logs);
      if (program === SYSTEM_PROGRAM_ADDRESS) return FUNDS;
      if (program === TOKEN_2022_PROGRAM_ADDRESS) return BALANCE;
    }
  }
  return INTERNAL;
}

/** Si el nodo respondio con un HTTP 429, los segundos de `Retry-After` (o `null` si no vino). */
export function rateLimitOf(error: unknown): { retryAfter: string | null } | null {
  if (!isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) return null;
  if (error.context.statusCode !== 429) return null;
  return { retryAfter: error.context.headers.get('retry-after') };
}

export type SubmissionRpc = Rpc<SimulateTransactionApi & SendTransactionApi>;

/** Simula la transaccion firmada en `confirmed`. `null` si se ejecutaria sin error. */
export async function simulate(rpc: SubmissionRpc, transaction: Transaction): Promise<{ failure: Failure; detail: unknown } | null> {
  const { value } = await rpc
    .simulateTransaction(getBase64EncodedWireTransaction(transaction), {
      encoding: 'base64',
      commitment: 'confirmed',
      sigVerify: false,
      replaceRecentBlockhash: false,
    })
    .send();
  if (value.err === null) return null;
  return { failure: classifyFailure(value.err, value.logs ?? []), detail: { err: value.err, logs: value.logs } };
}

/** Envia sin simular otra vez. Un fallo de red aqui no se clasifica: el seguimiento la dara por caducada. */
export async function send(rpc: SubmissionRpc, transaction: Transaction): Promise<void> {
  await rpc
    .sendTransaction(getBase64EncodedWireTransaction(transaction), { encoding: 'base64', skipPreflight: true })
    .send();
}
