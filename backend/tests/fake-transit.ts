/**
 * OpenBao Transit falso, en memoria, para los tests: una clave ed25519 con varias versiones y las dos
 * rutas que usa el backend (`GET keys/<nombre>` y `POST sign/<nombre>`), con la forma que da
 * OpenBao 2.7.2 (verificaciones, V23). Firma de verdad, con claves de `node:crypto`.
 */
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { FetchLike, TransitConfig } from '../src/transit.js';

export const TRANSIT: TransitConfig = {
  addr: 'http://127.0.0.1:8200',
  token: 'token-de-prueba-que-no-debe-salir',
  mount: 'transit',
  key: 'chain-authority',
};

export interface FakeTransit {
  readonly fetch: FetchLike;
  /** Cuerpos recibidos en `sign`, en orden. */
  readonly signRequests: { input: string; key_version: number }[];
  /** Crea una version nueva, como `POST keys/<nombre>/rotate`. */
  rotate(): void;
  /** Clave publica cruda (32 bytes) de una version. */
  publicKey(version: number): Uint8Array;
}

export interface FakeTransitOptions {
  readonly versions?: number;
  readonly type?: string;
  readonly derived?: boolean;
  /** Firma con otra clave: simula una respuesta que no verifica. */
  readonly corruptSignatures?: boolean;
}

function rawPublicKey(key: KeyObject): Uint8Array {
  const spki = key.export({ format: 'der', type: 'spki' });
  return Uint8Array.from(spki.subarray(spki.length - 32));
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function fakeTransit(options: FakeTransitOptions = {}): FakeTransit {
  const keys: { privateKey: KeyObject; publicKey: KeyObject }[] = [];
  const rotate = () => {
    keys.push(generateKeyPairSync('ed25519'));
  };
  for (let i = 0; i < (options.versions ?? 1); i++) rotate();
  const intruder = generateKeyPairSync('ed25519');
  const signRequests: { input: string; key_version: number }[] = [];
  const base = `${TRANSIT.addr}/v1/${TRANSIT.mount}`;

  const fetchImpl: FetchLike = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.get('X-Vault-Token') !== TRANSIT.token) return json(403, { errors: ['permission denied'] });

    if (input === `${base}/keys/${TRANSIT.key}` && (init?.method ?? 'GET') === 'GET') {
      const versions = Object.fromEntries(
        keys.map((k, i) => [
          String(i + 1),
          { name: 'ed25519', public_key: Buffer.from(rawPublicKey(k.publicKey)).toString('base64') },
        ]),
      );
      return json(200, {
        data: { type: options.type ?? 'ed25519', derived: options.derived ?? false, keys: versions, latest_version: keys.length },
      });
    }

    if (input === `${base}/sign/${TRANSIT.key}` && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { input: string; key_version?: number };
      const version = body.key_version ?? keys.length;
      signRequests.push({ input: body.input, key_version: version });
      const pair = keys[version - 1];
      if (pair === undefined) return json(400, { errors: ['invalid key version'] });
      const message = Buffer.from(body.input, 'base64');
      const signature = sign(null, message, options.corruptSignatures ? intruder.privateKey : pair.privateKey);
      return json(200, { data: { signature: `vault:v${version}:${signature.toString('base64')}`, key_version: version } });
    }

    return json(404, { errors: ['unsupported path'] });
  };

  return {
    fetch: fetchImpl,
    signRequests,
    rotate,
    publicKey: (version) => {
      const pair = keys[version - 1];
      if (pair === undefined) throw new Error(`sin version ${version}`);
      return rawPublicKey(pair.publicKey);
    },
  };
}
