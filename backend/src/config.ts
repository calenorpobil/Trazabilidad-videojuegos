/**
 * Configuracion del backend, leida de variables de entorno al arrancar. Un despliegue sirve a
 * un juego (contrato, 1): `game_id` es configuracion, nunca un campo de peticion.
 *
 * La semilla maestra llega por una de dos vias (propuesta, 4.3), y exactamente una:
 * - `CHAIN_MASTER_SEED`: 64 caracteres hexadecimales.
 * - `CHAIN_MASTER_SEED_FILE`: ruta a un fichero con esos 64 caracteres, fuera del repositorio
 *   y con permisos `0600`.
 *
 * Ningun mensaje de error repite el valor de la semilla ni de las credenciales.
 *
 * Fuera de este bloque: la URL de la red (bloque 3) y la credencial de la consola (W1).
 */
import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';
import { GAME_ID_PATTERN, MASTER_SEED_BYTES } from './keys.js';

export interface Config {
  readonly gameId: string;
  readonly masterSeed: Uint8Array;
  readonly writeKey: string;
  readonly readToken: string;
  readonly databasePath: string;
  readonly host: string;
  readonly port: number;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Longitud minima de `write_key` y `read_token`: lo bastante para no adivinarse. */
export const MIN_CREDENTIAL_LENGTH = 32;

const SEED_HEX = new RegExp(`^[0-9a-fA-F]{${MASTER_SEED_BYTES * 2}}$`);

const schema = z
  .object({
    CHAIN_GAME_ID: z.string().regex(GAME_ID_PATTERN, 'debe cumplir [a-z0-9-]{1,32}'),
    CHAIN_MASTER_SEED: z.string().optional(),
    CHAIN_MASTER_SEED_FILE: z.string().min(1).optional(),
    CHAIN_WRITE_KEY: z.string().min(MIN_CREDENTIAL_LENGTH, `minimo ${MIN_CREDENTIAL_LENGTH} caracteres`),
    CHAIN_READ_TOKEN: z.string().min(MIN_CREDENTIAL_LENGTH, `minimo ${MIN_CREDENTIAL_LENGTH} caracteres`),
    CHAIN_DATABASE_PATH: z.string().min(1).default('chain.db'),
    CHAIN_HOST: z.string().min(1).default('127.0.0.1'),
    CHAIN_PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  })
  .refine((e) => (e.CHAIN_MASTER_SEED === undefined) !== (e.CHAIN_MASTER_SEED_FILE === undefined), {
    message: 'define exactamente una: CHAIN_MASTER_SEED o CHAIN_MASTER_SEED_FILE',
    path: ['CHAIN_MASTER_SEED'],
  })
  .refine((e) => e.CHAIN_WRITE_KEY !== e.CHAIN_READ_TOKEN, {
    // Una lectura exige el read_token exactamente (contrato, 2): si coincidieran, no se distinguirian.
    message: 'CHAIN_WRITE_KEY y CHAIN_READ_TOKEN deben ser distintos',
    path: ['CHAIN_READ_TOKEN'],
  });

/**
 * En sistemas POSIX, el fichero de la semilla no puede ser legible por el grupo ni por otros.
 * En Windows los bits de modo no reflejan los permisos reales y no se comprueban.
 */
export function seedFilePermissionsOk(mode: number, platform: NodeJS.Platform): boolean {
  return platform === 'win32' || (mode & 0o077) === 0;
}

function parseSeed(text: string, origin: string): Uint8Array {
  const trimmed = text.trim();
  if (!SEED_HEX.test(trimmed)) {
    throw new ConfigError(`${origin}: debe contener ${MASTER_SEED_BYTES * 2} caracteres hexadecimales`);
  }
  return Uint8Array.from(Buffer.from(trimmed, 'hex'));
}

function readSeedFile(path: string, platform: NodeJS.Platform): Uint8Array {
  let mode: number;
  let text: string;
  try {
    mode = statSync(path).mode;
    text = readFileSync(path, 'utf8');
  } catch {
    throw new ConfigError('CHAIN_MASTER_SEED_FILE: no se puede leer el fichero');
  }
  if (!seedFilePermissionsOk(mode, platform)) {
    throw new ConfigError('CHAIN_MASTER_SEED_FILE: los permisos deben ser 0600');
  }
  return parseSeed(text, 'CHAIN_MASTER_SEED_FILE');
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Solo la ruta y el motivo: zod no incluye el valor recibido en estos mensajes.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`configuracion invalida\n  ${issues.join('\n  ')}`);
  }
  const e = parsed.data;
  const masterSeed =
    e.CHAIN_MASTER_SEED !== undefined
      ? parseSeed(e.CHAIN_MASTER_SEED, 'CHAIN_MASTER_SEED')
      : readSeedFile(e.CHAIN_MASTER_SEED_FILE as string, platform);

  return {
    gameId: e.CHAIN_GAME_ID,
    masterSeed,
    writeKey: e.CHAIN_WRITE_KEY,
    readToken: e.CHAIN_READ_TOKEN,
    databasePath: e.CHAIN_DATABASE_PATH,
    host: e.CHAIN_HOST,
    port: e.CHAIN_PORT,
  };
}
