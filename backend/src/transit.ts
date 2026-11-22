/**
 * La autoridad firma dentro de OpenBao, con el motor Transit (P12, opcion B; propuesta, revision del
 * 21 de noviembre de 2026). La clave privada no sale nunca de OpenBao: el backend le manda los bytes
 * del mensaje de la transaccion y recibe la firma.
 *
 * Comprobado contra OpenBao 2.7.2 (verificaciones, V23):
 * - Una clave `ed25519` firma ed25519 **puro** sobre los bytes de `input`, sin *prehash*: es lo que
 *   valida Solana. La firma llega como `vault:v<version>:<base64 de 64 bytes>`.
 * - `GET /v1/<mount>/keys/<nombre>` da, por version, `public_key` en base64 (32 bytes).
 * - Rotar crea una version nueva, con otra clave publica; las anteriores siguen firmando con
 *   `key_version` mientras no se recorten. Por eso se firma siempre con una version fija: la que
 *   coincide con la autoridad guardada en `Game` (`pickVersion`). Para cambiar de version en la
 *   cadena esta `npm run rotate-authority`.
 *
 * Cada firma se verifica aqui antes de usarla: la simulacion no comprueba firmas, y una firma mala
 * solo se veria al enviar.
 *
 * El token de OpenBao es una credencial (guia, «Credenciales y semilla»): ningun mensaje lo repite.
 */
import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { getAddressDecoder, type Address, type SignatureBytes, type TransactionPartialSigner } from '@solana/kit';
import { z } from 'zod';

export interface TransitConfig {
  /** Base de OpenBao, sin barra final: `http://127.0.0.1:8200`. */
  readonly addr: string;
  readonly token: string;
  /** Donde esta montado el motor Transit. */
  readonly mount: string;
  /** Nombre de la clave de la autoridad. */
  readonly key: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class TransitError extends Error {
  override readonly name = 'TransitError';
}

export interface TransitKeyVersion {
  readonly version: number;
  readonly publicKey: Uint8Array;
  readonly address: Address;
}

/** Nombres de montaje y de clave admitidos: sin barras, para que no cambien la ruta. */
export const TRANSIT_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

const REQUEST_TIMEOUT_MS = 10_000;
const ED25519_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;
/** Prefijo DER de SPKI para una clave publica Ed25519 de 32 bytes (RFC 8410). */
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const keyResponse = z.object({
  data: z.object({
    type: z.string(),
    derived: z.boolean(),
    keys: z.record(z.string(), z.object({ public_key: z.string() })),
  }),
});

const signResponse = z.object({ data: z.object({ signature: z.string() }) });

async function call(config: TransitConfig, fetchImpl: FetchLike, path: string, body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.addr}/v1/${config.mount}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'X-Vault-Token': config.token,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new TransitError(`OpenBao no responde en ${config.addr}`);
  }
  if (!response.ok) {
    // OpenBao da sus errores en `errors`; nunca incluyen el token.
    let detail = '';
    try {
      const json = (await response.json()) as { errors?: unknown };
      if (Array.isArray(json.errors) && json.errors.length > 0) detail = `: ${json.errors.join('; ')}`;
    } catch {
      // Sin cuerpo JSON: basta con el estado.
    }
    throw new TransitError(`OpenBao responde ${response.status} en ${config.mount}/${path}${detail}`);
  }
  return response.json();
}

function decodePublicKey(base64: string, version: number): Uint8Array {
  const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
  if (bytes.length !== ED25519_KEY_BYTES) {
    throw new TransitError(`la version ${version} no tiene una clave publica ed25519 de ${ED25519_KEY_BYTES} bytes`);
  }
  return bytes;
}

/** Versiones de la clave de la autoridad, de la mas antigua a la mas reciente. */
export async function readTransitKey(config: TransitConfig, fetchImpl: FetchLike = fetch): Promise<TransitKeyVersion[]> {
  const parsed = keyResponse.safeParse(await call(config, fetchImpl, `keys/${encodeURIComponent(config.key)}`));
  if (!parsed.success) throw new TransitError(`respuesta inesperada al leer la clave ${config.key}`);
  const { type, derived, keys } = parsed.data.data;
  if (type !== 'ed25519') throw new TransitError(`la clave ${config.key} es ${type}: tiene que ser ed25519`);
  // Una clave derivada exige `context` en cada firma y no da una sola clave publica por version.
  if (derived) throw new TransitError(`la clave ${config.key} es derivada: creala con derived=false`);

  const versions = Object.entries(keys).map(([v, entry]) => {
    const version = Number(v);
    if (!Number.isInteger(version) || version < 1) throw new TransitError(`version de clave invalida: ${v}`);
    const publicKey = decodePublicKey(entry.public_key, version);
    return { version, publicKey, address: getAddressDecoder().decode(publicKey) };
  });
  if (versions.length === 0) throw new TransitError(`la clave ${config.key} no tiene versiones disponibles`);
  return versions.sort((a, b) => a.version - b.version);
}

/**
 * La version con la que se firma: la que es hoy la autoridad de `Game` o, si el juego aun no existe
 * (`npm run init-game`), la mas reciente.
 */
export function pickVersion(versions: readonly TransitKeyVersion[], onChainAuthority: Address | null): TransitKeyVersion {
  if (onChainAuthority === null) {
    const latest = versions.at(-1);
    if (latest === undefined) throw new TransitError('la clave no tiene versiones');
    return latest;
  }
  const match = versions.find((v) => v.address === onChainAuthority);
  if (match === undefined) {
    throw new TransitError(
      'la autoridad del juego no es ninguna version de la clave de Transit: rota primero con npm run rotate-authority',
    );
  }
  return match;
}

function verifier(publicKey: Uint8Array): KeyObject {
  return createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, publicKey]), format: 'der', type: 'spki' });
}

/** Firma `message` con una version fija de la clave y comprueba la firma antes de devolverla. */
export async function transitSign(
  config: TransitConfig,
  version: TransitKeyVersion,
  message: Uint8Array,
  fetchImpl: FetchLike = fetch,
): Promise<Uint8Array> {
  const body = { input: Buffer.from(message).toString('base64'), key_version: version.version };
  const parsed = signResponse.safeParse(await call(config, fetchImpl, `sign/${encodeURIComponent(config.key)}`, body));
  if (!parsed.success) throw new TransitError('respuesta inesperada al firmar');

  const match = /^vault:v(\d+):([A-Za-z0-9+/=]+)$/.exec(parsed.data.data.signature);
  if (match === null || Number(match[1]) !== version.version) {
    throw new TransitError(`OpenBao no firmo con la version ${version.version}`);
  }
  const signature = Uint8Array.from(Buffer.from(match[2] as string, 'base64'));
  if (signature.length !== ED25519_SIGNATURE_BYTES || !verify(null, message, verifier(version.publicKey), signature)) {
    throw new TransitError(`la firma de la version ${version.version} no verifica`);
  }
  return signature;
}

/** Firmante de `@solana/kit` que firma en OpenBao. Encaja donde hoy va el de la semilla. */
export function transitSigner(
  config: TransitConfig,
  version: TransitKeyVersion,
  fetchImpl: FetchLike = fetch,
): TransactionPartialSigner {
  return Object.freeze({
    address: version.address,
    signTransactions: async (transactions) =>
      Promise.all(
        transactions.map(async (transaction) => {
          const message = Uint8Array.from(transaction.messageBytes);
          const signature = await transitSign(config, version, message, fetchImpl);
          return Object.freeze({ [version.address]: signature as SignatureBytes });
        }),
      ),
  });
}
