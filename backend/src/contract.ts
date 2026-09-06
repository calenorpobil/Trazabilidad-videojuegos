/**
 * El contrato HTTP congelado (`docs/http-contract.md`), escrito una sola vez como
 * codigo. Todo lo demas del backend depende de este modulo; nada de lo que hay aqui
 * se redefine en otro sitio.
 *
 * Regla que este fichero hace cumplir: ningun nombre publico menciona la cadena.
 */

/** Estados de una operacion. Apartado 7 del contrato. */
export const OPERATION_STATES = ['pending', 'applied', 'settled', 'failed'] as const;

export type OperationState = (typeof OPERATION_STATES)[number];

/**
 * Transiciones permitidas. `applied -> failed` es posible a proposito: una
 * transaccion confirmada y no final puede desaparecer, y esa es toda la razon de que
 * el juego solo escriba estado en `settled`.
 */
export const OPERATION_TRANSITIONS: Readonly<Record<OperationState, readonly OperationState[]>> = {
  pending: ['applied', 'failed'],
  applied: ['settled', 'failed'],
  settled: [],
  failed: [],
};

/** Categorias de error. Apartado 6 del contrato. Accionables, nunca codigos de cadena. */
export const ERROR_CODES = [
  'REJECTED',
  'NOT_FOUND',
  'RATE_LIMITED',
  'INSUFFICIENT_BALANCE',
  'INSUFFICIENT_FUNDS',
  'EXPIRED',
  'INTERNAL',
  'CONFIG',
  'NETWORK',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Si reintentar la misma peticion tiene sentido. Lo consume el addon, no el backend. */
export const ERROR_RETRYABLE: Readonly<Record<ErrorCode, boolean>> = {
  REJECTED: false,
  NOT_FOUND: false,
  RATE_LIMITED: true,
  INSUFFICIENT_BALANCE: false,
  INSUFFICIENT_FUNDS: true,
  EXPIRED: true,
  INTERNAL: true,
  CONFIG: false,
  NETWORK: true,
};

/** Codigo HTTP con el que responde el backend. `null` = no viaja por HTTP. */
export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number | null>> = {
  REJECTED: 400,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INSUFFICIENT_BALANCE: 409,
  INSUFFICIENT_FUNDS: 503,
  EXPIRED: null,
  INTERNAL: 500,
  CONFIG: null,
  NETWORK: null,
};

/** Prefijos de los identificadores opacos. Nunca viaja una direccion en crudo. */
export const ID_PREFIX = {
  collection: 'col_',
  item: 'itm_',
  operation: 'opr_',
  holder: 'hld_',
} as const;

export type EntityKind = keyof typeof ID_PREFIX;

/** Cuerpo de error, identico en una respuesta HTTP y dentro de una operacion `failed`. */
export interface ChainErrorBody {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export function errorBody(code: ErrorCode, message: string): ChainErrorBody {
  return { code, message, retryable: ERROR_RETRYABLE[code] };
}

/** Clave de `qualities` que escribe el backend y que el integrador no puede usar. */
export const RESERVED_QUALITY_KEY = 'collection';

/** Cabecera obligatoria en toda escritura. Marcar primero, llamar despues. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';
