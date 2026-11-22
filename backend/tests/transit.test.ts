/**
 * Firma de la autoridad en OpenBao Transit (P12, opcion B): lectura de la clave, eleccion de version,
 * firma verificada y fallos. Contra el Transit falso de `fake-transit.ts`; la prueba contra un
 * OpenBao real y devnet esta en verificaciones, V23.
 */
import { verify, createPublicKey } from 'node:crypto';
import {
  blockhash,
  compileTransaction,
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  signTransactionMessageWithSigners,
  type Address,
  type GetAccountInfoApi,
  type Rpc,
} from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { loadAuthority } from '../src/authority.js';
import { CHAIN_ASSETS_PROGRAM_ADDRESS, getGameEncoder } from '../src/generated/index.js';
import { buildInitializeGame, buildRotateAuthority, type Lifetime } from '../src/transactions.js';
import { pickVersion, readTransitKey, transitSign, transitSigner, TransitError } from '../src/transit.js';
import { fakeTransit, TRANSIT } from './fake-transit.js';

const GAME_ID = 'test-game';
const SEED = Uint8Array.from(Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex'));
const LIFETIME: Lifetime = { blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 0n };

function verifies(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicKey]),
    format: 'der',
    type: 'spki',
  });
  return verify(null, message, key, signature);
}

/** Nodo falso que responde con la cuenta `Game` guardando `authority`, o sin cuenta si es `null`. */
function gameRpc(authority: Address | null): Rpc<GetAccountInfoApi> {
  return {
    getAccountInfo: () => ({
      send: () =>
        Promise.resolve({
          context: { slot: 0n },
          value:
            authority === null
              ? null
              : {
                  data: [
                    Buffer.from(getGameEncoder().encode({ authority, gameId: GAME_ID, bump: 255 })).toString('base64'),
                    'base64',
                  ],
                  owner: CHAIN_ASSETS_PROGRAM_ADDRESS,
                  executable: false,
                  lamports: 1_041_400n,
                  space: 77n,
                  rentEpoch: 0n,
                },
        }),
    }),
  } as unknown as Rpc<GetAccountInfoApi>;
}

describe('readTransitKey', () => {
  it('lee las versiones en orden, con su direccion', async () => {
    const bao = fakeTransit({ versions: 3 });
    const versions = await readTransitKey(TRANSIT, bao.fetch);
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    for (const v of versions) {
      expect(v.publicKey).toEqual(bao.publicKey(v.version));
      expect(v.address).toBe(getAddressDecoder().decode(bao.publicKey(v.version)));
    }
  });

  it('rechaza una clave que no es ed25519 o que es derivada', async () => {
    await expect(readTransitKey(TRANSIT, fakeTransit({ type: 'ecdsa-p256' }).fetch)).rejects.toThrow(/ed25519/);
    await expect(readTransitKey(TRANSIT, fakeTransit({ derived: true }).fetch)).rejects.toThrow(/derivada/);
  });

  it('un token rechazado o un OpenBao caido son TransitError, sin repetir el token', async () => {
    const wrong = { ...TRANSIT, token: 'otro' };
    const denied = readTransitKey(wrong, fakeTransit().fetch);
    await expect(denied).rejects.toThrow(TransitError);
    await expect(denied).rejects.toThrow(/403/);

    const down = readTransitKey(TRANSIT, () => Promise.reject(new Error(`ECONNREFUSED ${TRANSIT.token}`)));
    await expect(down).rejects.toThrow(/no responde/);
    await expect(down).rejects.not.toThrow(TRANSIT.token);
  });
});

describe('pickVersion', () => {
  it('sin juego en la cadena, la mas reciente; con juego, la que es su autoridad', async () => {
    const versions = await readTransitKey(TRANSIT, fakeTransit({ versions: 3 }).fetch);
    expect(pickVersion(versions, null).version).toBe(3);
    expect(pickVersion(versions, versions[0]?.address as Address).version).toBe(1);
  });

  it('falla si la autoridad del juego no es ninguna version', async () => {
    const versions = await readTransitKey(TRANSIT, fakeTransit({ versions: 2 }).fetch);
    expect(() => pickVersion(versions, '11111111111111111111111111111111' as Address)).toThrow(/rotate-authority/);
  });
});

describe('transitSign', () => {
  it('firma con la version pedida, aunque haya otras mas recientes', async () => {
    const bao = fakeTransit({ versions: 2 });
    const [v1] = await readTransitKey(TRANSIT, bao.fetch);
    if (v1 === undefined) throw new Error('sin versiones');
    const message = Uint8Array.from(Buffer.from('mensaje de prueba'));
    const signature = await transitSign(TRANSIT, v1, message, bao.fetch);

    expect(bao.signRequests).toEqual([{ input: Buffer.from(message).toString('base64'), key_version: 1 }]);
    expect(signature).toHaveLength(64);
    expect(verifies(bao.publicKey(1), message, signature)).toBe(true);
  });

  it('rechaza una firma que no verifica', async () => {
    const bao = fakeTransit({ corruptSignatures: true });
    const [v1] = await readTransitKey(TRANSIT, bao.fetch);
    if (v1 === undefined) throw new Error('sin versiones');
    await expect(transitSign(TRANSIT, v1, new Uint8Array([1, 2, 3]), bao.fetch)).rejects.toThrow(/no verifica/);
  });
});

describe('transitSigner en una transaccion', () => {
  it('una sola firma, la de la version elegida, valida sobre los bytes del mensaje', async () => {
    const bao = fakeTransit({ versions: 2 });
    const versions = await readTransitKey(TRANSIT, bao.fetch);
    const v2 = pickVersion(versions, null);
    const signer = transitSigner(TRANSIT, v2, bao.fetch);

    const draft = await buildInitializeGame(signer, GAME_ID, LIFETIME);
    const message = getCompiledTransactionMessageDecoder().decode(compileTransaction(draft).messageBytes);
    expect(message.header.numSignerAccounts).toBe(1);
    expect(message.staticAccounts[0]).toBe(v2.address);

    const signed = await signTransactionMessageWithSigners(draft);
    const signatures = Object.entries(signed.signatures);
    expect(signatures).toHaveLength(1);
    expect(signatures[0]?.[0]).toBe(v2.address);
    expect(verifies(v2.publicKey, Uint8Array.from(signed.messageBytes), signatures[0]?.[1] as Uint8Array)).toBe(true);
  });

  it('rotate_authority: firma la version vieja y la nueva solo es un argumento', async () => {
    const bao = fakeTransit({ versions: 2 });
    const [v1, v2] = await readTransitKey(TRANSIT, bao.fetch);
    if (v1 === undefined || v2 === undefined) throw new Error('sin versiones');
    const draft = await buildRotateAuthority(transitSigner(TRANSIT, v1, bao.fetch), GAME_ID, v2.address, LIFETIME);
    const signed = await signTransactionMessageWithSigners(draft);
    expect(Object.keys(signed.signatures)).toEqual([v1.address]);
    expect(bao.signRequests.map((r) => r.key_version)).toEqual([1]);
  });
});

describe('loadAuthority', () => {
  it('con la semilla, la clave derivada, como hasta ahora', async () => {
    const loaded = await loadAuthority({ authority: { kind: 'seed' }, masterSeed: SEED, gameId: GAME_ID }, gameRpc(null));
    expect(loaded.description).toBe('semilla');
  });

  it('con Transit, la version que es hoy la autoridad de Game', async () => {
    const bao = fakeTransit({ versions: 3 });
    const versions = await readTransitKey(TRANSIT, bao.fetch);
    const v2 = versions[1]?.address as Address;
    const config = { authority: { kind: 'transit', transit: TRANSIT } as const, masterSeed: SEED, gameId: GAME_ID };

    const loaded = await loadAuthority(config, gameRpc(v2), bao.fetch);
    expect(loaded.signer.address).toBe(v2);
    expect(loaded.description).toMatch(/version 2/);
    expect(loaded.description).not.toContain(TRANSIT.token);

    const fresh = await loadAuthority(config, gameRpc(null), bao.fetch);
    expect(fresh.signer.address).toBe(versions[2]?.address);
  });
});
