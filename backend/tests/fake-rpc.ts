/**
 * RPC falsos para los tests. `senderAccountRpc` sirve a `planTransfer`; `chainRpc`, al servidor y
 * al seguimiento.
 */
import { AccountState, getTokenEncoder, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import {
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SolanaError,
  type Address,
  type GetAccountInfoApi,
  type Rpc,
  type TransactionError,
} from '@solana/kit';

const SOME_ADDRESS = '11111111111111111111111111111111' as Address;

/** Cuenta asociada de Token-2022 con `amount` unidades. */
export function tokenAccountBytes(amount: bigint, mint: Address = SOME_ADDRESS, owner: Address = SOME_ADDRESS): Uint8Array {
  return Uint8Array.from(
    getTokenEncoder().encode({
      mint,
      owner,
      amount,
      delegate: null,
      state: AccountState.Initialized,
      isNative: null,
      delegatedAmount: 0,
      closeAuthority: null,
      extensions: null,
    }),
  );
}

export type AccountInfoRpc = Rpc<GetAccountInfoApi> & { readonly requested: Address[]; readonly commitments: string[] };

/** Responde a `getAccountInfo` con la cuenta del emisor con `amount` unidades, o con nada si es `null`. */
export function senderAccountRpc(amount: bigint | null): AccountInfoRpc {
  const requested: Address[] = [];
  const commitments: string[] = [];
  const rpc = {
    requested,
    commitments,
    getAccountInfo: (address: Address, config: { commitment: string }) => ({
      send: () => {
        requested.push(address);
        commitments.push(config.commitment);
        return Promise.resolve({
          context: { slot: 0n },
          value:
            amount === null
              ? null
              : {
                  data: [Buffer.from(tokenAccountBytes(amount)).toString('base64'), 'base64'],
                  owner: TOKEN_2022_PROGRAM_ADDRESS,
                  executable: false,
                  lamports: 1_513_840n,
                  space: 165n,
                  rentEpoch: 0n,
                },
        });
      },
    }),
  };
  return rpc as unknown as AccountInfoRpc;
}

/** Estado de una firma tal como lo devuelve `getSignatureStatuses`. */
export interface FakeStatus {
  confirmationStatus: 'processed' | 'confirmed' | 'finalized';
  err: TransactionError | null;
}

/**
 * Cadena falsa para el servidor y el seguimiento: blockhash fijo, cuenta del emisor con saldo o sin
 * ella, cuentas de token y mints para el inventario, simulacion, estados y registro de lo enviado.
 */
export interface FakeChain {
  /** Saldo de la cuenta de token del emisor (para `planTransfer`), o `null` si no existe. */
  senderAmount: bigint | null;
  /** Cuentas de token del tenedor que se consulta, en bytes. */
  tokenAccounts: Uint8Array[];
  /** Mints por direccion, en bytes. */
  mints: Record<string, Uint8Array>;
  /** Resultado de `simulateTransaction`: `null` es exito. */
  simulation: { err: TransactionError; logs: string[] } | null;
  /** Estado de cada firma; las que no estan, no aparecen. */
  statuses: Record<string, FakeStatus>;
  /** Altura finalizada. */
  blockHeight: bigint;
  /** `lastValidBlockHeight` del blockhash que se entrega. */
  lastValidBlockHeight: bigint;
  /** Logs de `getTransaction`. */
  transactionLogs: string[];
  /** Si el nodo responde con un HTTP 429 a todo. */
  rateLimited: boolean;
  /** Transacciones enviadas, en base64. */
  readonly sent: string[];
  /** Opciones con las que se envio cada una. */
  readonly sendOptions: unknown[];
  /** Cuantas veces se simulo. */
  simulations: number;
}

export function fakeChain(): FakeChain {
  return {
    senderAmount: 1_000n,
    tokenAccounts: [],
    mints: {},
    simulation: null,
    statuses: {},
    blockHeight: 50n,
    lastValidBlockHeight: 100n,
    transactionLogs: [],
    rateLimited: false,
    sent: [],
    sendOptions: [],
    simulations: 0,
  };
}

export function chainRpc(chain: FakeChain): unknown {
  const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
  const account = (data: Uint8Array) => ({
    data: [b64(data), 'base64'],
    owner: TOKEN_2022_PROGRAM_ADDRESS,
    executable: false,
    lamports: 1n,
    space: BigInt(data.length),
    rentEpoch: 0n,
  });
  const reply = <T>(value: () => T) => ({
    send: () =>
      chain.rateLimited
        ? Promise.reject(
            new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
              headers: new Headers({ 'retry-after': '3' }),
              message: 'Too Many Requests',
              statusCode: 429,
            }),
          )
        : Promise.resolve(value()),
  });
  return {
    getLatestBlockhash: () =>
      reply(() => ({
        context: { slot: 0n },
        value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: chain.lastValidBlockHeight },
      })),
    getAccountInfo: () =>
      reply(() => ({
        context: { slot: 0n },
        value: chain.senderAmount === null ? null : account(tokenAccountBytes(chain.senderAmount)),
      })),
    getTokenAccountsByOwner: () =>
      reply(() => ({
        context: { slot: 0n },
        value: chain.tokenAccounts.map((data, i) => ({ pubkey: `token-${i}`, account: account(data) })),
      })),
    getMultipleAccounts: (addresses: Address[]) =>
      reply(() => ({
        context: { slot: 0n },
        value: addresses.map((a) => (chain.mints[a] === undefined ? null : account(chain.mints[a]))),
      })),
    simulateTransaction: () =>
      reply(() => {
        chain.simulations += 1;
        return {
          context: { slot: 0n },
          value: { err: chain.simulation?.err ?? null, logs: chain.simulation?.logs ?? [] },
        };
      }),
    sendTransaction: (wire: string, options: unknown) =>
      reply(() => {
        chain.sent.push(wire);
        chain.sendOptions.push(options);
        return 'firma';
      }),
    getBlockHeight: () => reply(() => chain.blockHeight),
    getSignatureStatuses: (signatures: string[]) =>
      reply(() => ({
        context: { slot: 0n },
        value: signatures.map((s) => {
          const status = chain.statuses[s];
          return status === undefined ? null : { ...status, confirmations: null, slot: 1n, status: { Ok: null } };
        }),
      })),
    getTransaction: () => reply(() => ({ meta: { logMessages: chain.transactionLogs } })),
  };
}
