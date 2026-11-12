/**
 * RPC falso para los tests que leen una cuenta antes de construir (`planTransfer`): responde a
 * `getAccountInfo` con una cuenta de 170 bytes de Token-2022 (la asociada, V12) o con nada.
 */
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import type { Address, GetAccountInfoApi, Rpc } from '@solana/kit';

export type AccountInfoRpc = Rpc<GetAccountInfoApi> & { readonly requested: Address[]; readonly commitments: string[] };

export function senderAccountRpc(exists: boolean): AccountInfoRpc {
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
          value: exists
            ? {
                data: [Buffer.alloc(170).toString('base64'), 'base64'],
                owner: TOKEN_2022_PROGRAM_ADDRESS,
                executable: false,
                lamports: 1_513_840n,
                space: 170n,
                rentEpoch: 0n,
              }
            : null,
        });
      },
    }),
  };
  return rpc as unknown as AccountInfoRpc;
}

/**
 * RPC falso para el servidor: blockhash fijo, cuentas del emisor que existen o no, cuentas de
 * token y mints para el inventario, y registro de lo que se envia.
 */
export interface FakeChain {
  /** Si la cuenta de token del emisor existe (para `planTransfer`). */
  senderAccount: boolean;
  /** Cuentas de token del tenedor que se consulta, en bytes. */
  tokenAccounts: Uint8Array[];
  /** Mints por direccion, en bytes. */
  mints: Record<string, Uint8Array>;
  /** Transacciones enviadas, en base64. */
  readonly sent: string[];
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
  const reply = <T>(value: T) => ({ send: () => Promise.resolve(value) });
  return {
    getLatestBlockhash: () =>
      reply({ context: { slot: 0n }, value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n } }),
    getAccountInfo: () => reply({ context: { slot: 0n }, value: chain.senderAccount ? account(new Uint8Array(170)) : null }),
    getTokenAccountsByOwner: () =>
      reply({
        context: { slot: 0n },
        value: chain.tokenAccounts.map((data, i) => ({ pubkey: `token-${i}`, account: account(data) })),
      }),
    getMultipleAccounts: (addresses: Address[]) =>
      reply({
        context: { slot: 0n },
        value: addresses.map((a) => (chain.mints[a] === undefined ? null : account(chain.mints[a]))),
      }),
    sendTransaction: (wire: string) => {
      chain.sent.push(wire);
      return reply('firma');
    },
  };
}
