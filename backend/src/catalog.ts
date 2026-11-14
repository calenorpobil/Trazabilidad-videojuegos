/**
 * Listados de catalogo (contrato, 5.3 y 5.4), de SQLite y nunca de la cadena (propuesta, 4.4).
 * Los usan `GET /v1/collections`, `GET /v1/items` y la consola `/admin`: una sola implementacion.
 *
 * **El estado de un tipo es el de la operacion que lo creo.** La fila de `items` se escribe al
 * aceptar la peticion, antes de que la transaccion llegue a la cadena, y no se borra si la operacion
 * falla: un `create_item` que caduca deja su fila con la operacion en `failed`. Por eso todo listado
 * se une a `operations`:
 * - `GET /v1/items` muestra **todos** los tipos con su `state`, tambien los `failed`: es lo que deja
 *   al administrador verlos (contrato, 5.4).
 * - Lo que trata un tipo como utilizable (el inventario de un tenedor, el recuento de la consola)
 *   exige `settled` (`SETTLED_ITEM`).
 */
import type { OperationState } from './contract.js';
import type { Db } from './db.js';

export interface CollectionView {
  collection_id: string;
  name: string;
  created_at: string;
  /** Tipos de la coleccion cuya creacion esta en `settled`. Solo en la consola, no en el contrato. */
  settled_items?: number;
}

export interface ItemView {
  item_id: string;
  collection_id: string;
  name: string;
  symbol: string;
  uri: string;
  qualities: Record<string, string>;
  operation_id: string;
  state: OperationState;
  revision: number;
  edit: { operation_id: string; state: OperationState } | null;
  created_at: string;
}

/** Condicion SQL de un tipo utilizable, sobre `items` con alias `i`: su creacion esta en `settled`. */
export const SETTLED_ITEM = `EXISTS (SELECT 1 FROM operations o
  WHERE o.operation_id = i.operation_id AND o.state = 'settled')`;

/**
 * Colecciones, la mas reciente primero (contrato, 5.3). `created_at` tiene resolucion de segundos:
 * a igualdad, decide el orden de insercion.
 */
export function listCollections(db: Db, withCounts = false): CollectionView[] {
  const rows = db
    .prepare(
      `SELECT c.collection_id, c.name, c.created_at,
              (SELECT COUNT(*) FROM items i WHERE i.collection_id = c.collection_id AND ${SETTLED_ITEM}) AS settled_items
         FROM collections c
        ORDER BY c.created_at DESC, c.rowid DESC`,
    )
    .all() as (CollectionView & { settled_items: number })[];
  return rows.map(({ settled_items, ...c }) => (withCounts ? { ...c, settled_items } : c));
}

export function collectionExists(db: Db, collectionId: string): boolean {
  return db.prepare('SELECT 1 FROM collections WHERE collection_id = ?').get(collectionId) !== undefined;
}

interface ItemRow {
  item_id: string;
  collection_id: string;
  name: string;
  symbol: string;
  uri: string;
  qualities: string;
  operation_id: string;
  state: OperationState;
  revision: number;
  edit_operation_id: string | null;
  edit_state: OperationState | null;
  created_at: string;
}

/**
 * Tipos, el mas reciente primero, con el estado de su creacion (contrato, 5.4). Con `collectionId`,
 * solo los de esa coleccion; el `404` de una coleccion inexistente lo decide quien llama.
 */
export function listItems(db: Db, collectionId: string | null = null): ItemView[] {
  const rows = db
    .prepare(
      `SELECT i.item_id, i.collection_id, i.name, i.symbol, i.uri, i.qualities, i.operation_id,
              o.state, i.revision, i.edit_operation_id, e.state AS edit_state, i.created_at
         FROM items i
         JOIN operations o ON o.operation_id = i.operation_id
         LEFT JOIN operations e ON e.operation_id = i.edit_operation_id
        WHERE ? IS NULL OR i.collection_id = ?
        ORDER BY i.created_at DESC, i.rowid DESC`,
    )
    .all(collectionId, collectionId) as ItemRow[];
  return rows.map((r) => ({
    item_id: r.item_id,
    collection_id: r.collection_id,
    name: r.name,
    symbol: r.symbol,
    uri: r.uri,
    qualities: JSON.parse(r.qualities) as Record<string, string>,
    operation_id: r.operation_id,
    state: r.state,
    revision: r.revision,
    // La edicion queda bajo la linea de corte (8.1): hoy siempre es null.
    edit:
      r.edit_operation_id === null || r.edit_state === null
        ? null
        : { operation_id: r.edit_operation_id, state: r.edit_state },
    created_at: r.created_at,
  }));
}
