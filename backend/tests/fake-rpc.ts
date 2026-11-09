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
