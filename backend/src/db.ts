/**
 * Base de datos SQLite del backend: un fichero, sin servidor (propuesta, 4.4).
 *
 * El esquema sale de 4.4, con la revision del 8-nov-2026: `idempotency` guarda la respuesta
 * aceptada y `holders` guarda el mapa de tenedores. La version va en `PRAGMA user_version`; no hay
 * herramienta de migraciones porque solo existe la version 1.
 */
import Database from 'better-sqlite3';
import { OPERATION_STATES } from './contract.js';

export type Db = Database.Database;

/** Tipos de operacion del hito. `update_item` queda fuera (8.1). */
export const OPERATION_KINDS = ['create_item', 'grant', 'transfer'] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

export const SCHEMA_VERSION = 1;

const sqlList = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(', ');

const SCHEMA_V1 = `
CREATE TABLE collections (
  collection_id TEXT PRIMARY KEY,
  game_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE operations (
  operation_id  TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN (${sqlList(OPERATION_KINDS)})),
  state         TEXT NOT NULL CHECK (state IN (${sqlList(OPERATION_STATES)})),
  signature     TEXT,
  error_code    TEXT,
  error_message TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  -- Una operacion lleva error si y solo si esta en failed (contrato, 5.1).
  CHECK ((state = 'failed') = (error_code IS NOT NULL))
);

CREATE TABLE items (
  item_id           TEXT PRIMARY KEY,
  collection_id     TEXT NOT NULL REFERENCES collections (collection_id),
  mint              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  symbol            TEXT NOT NULL,
  uri               TEXT NOT NULL DEFAULT '',
  qualities         TEXT NOT NULL,
  operation_id      TEXT NOT NULL REFERENCES operations (operation_id),
  revision          INTEGER NOT NULL DEFAULT 0,
  edit_operation_id TEXT REFERENCES operations (operation_id),
  created_at        TEXT NOT NULL
);

CREATE TABLE idempotency (
  key          TEXT PRIMARY KEY,
  operation_id TEXT REFERENCES operations (operation_id),
  status_code  INTEGER NOT NULL,
  response     TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE holders (
  holder_id   TEXT PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  address     TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);
`;

/** Abre (o crea) la base de datos y deja el esquema en la version actual. `:memory:` para tests. */
export function openDatabase(path: string): Db {
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (path !== ':memory:') db.pragma('journal_mode = WAL');

  const version = db.pragma('user_version', { simple: true }) as number;
  if (version === 0) {
    db.transaction(() => {
      db.exec(SCHEMA_V1);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }).immediate();
  } else if (version !== SCHEMA_VERSION) {
    db.close();
    throw new Error(`esquema de base de datos desconocido: version ${version}, se esperaba ${SCHEMA_VERSION}`);
  }
  return db;
}

/** Marca de tiempo en el formato del contrato: ISO 8601 en UTC, sin milisegundos. */
export function timestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
