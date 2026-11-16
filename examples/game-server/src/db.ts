/**
 * SQLite del servidor de juego: un fichero y una tabla.
 *
 * `actions` guarda cada escritura que pide el juego **antes** de llamar al backend (propuesta, 4.4).
 * La clave es la `Idempotency-Key` tal como llega del addon: es la huella de `(operación, call_id)`, así
 * que identifica la acción lógica igual que el `call_id`, y es lo único que el servidor recibe de él.
 * Tras un reinicio, la tabla dice qué acciones se pidieron y cuáles no tienen todavía respuesta.
 */
import Database from 'better-sqlite3';

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS actions (
  key         TEXT PRIMARY KEY,
  -- Ruta del backend a la que se reenvía, con el identificador del tipo si lo lleva.
  route       TEXT NOT NULL,
  -- Cuerpo que se reenvía, ya autorizado: en una transferencia, con el emisor que decide el servidor.
  body        TEXT NOT NULL,
  -- Última respuesta del backend. Vacías mientras no ha respondido.
  status_code INTEGER,
  response    TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
`;

/** Abre (o crea) la base de datos. `:memory:` para tests. */
export function openDatabase(path: string): Db {
  const db = new Database(path);
  db.pragma('busy_timeout = 5000');
  if (path !== ':memory:') db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

export function timestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
