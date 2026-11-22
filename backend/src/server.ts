/**
 * Servidor HTTP del contrato (`docs/especificacion/http-contract.md`). Rutas del hito:
 *
 *   POST /v1/collections                 escritura, 201, sin operacion
 *   POST /v1/items                       escritura, 202: create_item + grant (bloque 3)
 *   POST /v1/items/{item_id}/transfer    escritura, 202 (bloque 4)
 *   GET  /v1/holders/{holder_id}/items   lectura (bloque 4)
 *   GET  /v1/operations/{operation_id}   lectura: lo que sondea el addon
 *   GET  /v1/collections                 lectura (W1, contrato 5.3)
 *   GET  /v1/items                       lectura (W1, contrato 5.4), con el estado de su creacion
 *   GET  /v1/holders?external_id=...     lectura (contrato 5.5): el holder_id de un jugador ya registrado
 *
 * Lo demas responde `404`: `POST …/grants` y `PATCH /v1/items/{id}` quedan bajo la linea de corte
 * (propuesta, 8.1). La consola `/admin` (W1) esta en `admin.ts` y usa estos mismos manejadores.
 *
 * **Limite de tasa de las lecturas** (P14): por IP, antes de comprobar el `read_token`, para que
 * tampoco sirva para probar tokens. Pasado el limite, `429` / `RATE_LIMITED` con `Retry-After`.
 *
 * **Orden de una escritura** (invariante 2 y revision del 12-nov-2026):
 *   1. si la clave ya esta aceptada, se devuelve lo guardado sin validar ni tocar la cadena;
 *   2. se valida y se prepara: se lee lo que haga falta de la cadena, se **firma** la transaccion y
 *      se **simula** (bloque 5): sin fondos, `503` / `INSUFFICIENT_FUNDS`; sin saldo, `409`;
 *   3. `claim`, en UNA transaccion SQLite: la operacion, sus filas, la firma, la altura hasta la que
 *      vale (P13) y la clave;
 *   4. solo entonces, y solo si no era un reintento, se envia, sin volver a simular.
 * Un reinicio entre 3 y 4 deja una firma que nunca llega a la cadena: el seguimiento (`tracker.ts`)
 * la da por caducada cuando pasa su altura. Nunca se envia dos veces lo mismo, ni dos transacciones
 * distintas.
 *
 * Un HTTP 429 del nodo responde `429` / `RATE_LIMITED`, con su `Retry-After` si lo trae; cualquier
 * otro fallo del nodo, `500` / `INTERNAL` (contrato, 6).
 *
 * Fuera de este modulo: el seguimiento `pending -> applied -> settled` y el segundo paso de un tipo
 * partido (`tracker.ts`).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type RouteHandlerMethod } from 'fastify';
import {
  getSignatureFromTransaction,
  signTransactionMessageWithSigners,
  type GetAccountInfoApi,
  type GetBlockHeightApi,
  type GetLatestBlockhashApi,
  type GetSignatureStatusesApi,
  type GetTransactionApi,
  type Rpc,
  type SendTransactionApi,
  type SimulateTransactionApi,
  type Transaction,
  type TransactionSigner,
} from '@solana/kit';
import { z } from 'zod';
import { findGameAddress, findItemMintAddress } from './addresses.js';
import { registerAdmin, type AdminOptions } from './admin.js';
import { collectionExists, listCollections, listItems } from './catalog.js';
import { DEFAULT_READ_RATE_LIMIT } from './config.js';
import { errorBody, ERROR_HTTP_STATUS, IDEMPOTENCY_HEADER, RESERVED_QUALITY_KEY, type ErrorCode } from './contract.js';
import { timestamp, type Db } from './db.js';
import { findHolderIdByExternalId, resolveHolder, type Holder, type HolderKeys, type HolderRef } from './holders.js';
import { claim, findAccepted, isValidIdempotencyKey, type AcceptedResponse } from './idempotency.js';
import { newId } from './ids.js';
import { readHolderInventory, type InventoryRpc } from './inventory.js';
import { EXTERNAL_ID_MAX } from './keys.js';
import { createOperation, getOperation, recordSignature, recordTransferParties } from './operations.js';
import { FixedWindowLimiter } from './rate-limit.js';
import { rateLimitOf, send, simulate } from './submission.js';
import { planItemCreation, planTransfer, type TransactionDraft } from './transactions.js';

/** Lo que el servidor y el seguimiento piden al nodo. */
export type ChainRpc = Rpc<
  GetLatestBlockhashApi &
    GetAccountInfoApi &
    SimulateTransactionApi &
    SendTransactionApi &
    GetBlockHeightApi &
    GetSignatureStatusesApi &
    GetTransactionApi
> &
  InventoryRpc;

export interface ServerOptions {
  readonly db: Db;
  readonly gameId: string;
  readonly masterSeed: Uint8Array;
  readonly writeKey: string;
  readonly readToken: string;
  /** La autoridad del juego, unica firmante (invariante 1). En produccion, la derivada de la semilla. */
  readonly authority: TransactionSigner;
  readonly rpc: ChainRpc;
  readonly logger?: boolean;
  /** Lecturas por minuto y por IP (P14). Por defecto, `DEFAULT_READ_RATE_LIMIT`. */
  readonly readRateLimit?: number;
  /** La consola `/admin`. Sin ella, sus rutas no existen (los tests de la API no la necesitan). */
  readonly admin?: AdminOptions;
  /** Reloj del limite de tasa y de las sesiones de la consola. Solo para tests. */
  readonly now?: () => number;
}

/** Error con la forma del contrato (6). El `code` decide el estado HTTP. */
export class ContractError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// --- Validacion (contrato, 4 y 8: estricta, sin campos desconocidos) ---

/** Longitud en caracteres, como cuenta el programa (`chars()`), no en unidades UTF-16. */
const text = (min: number, max: number) =>
  z.string().refine((s) => {
    const n = [...s].length;
    return n >= min && n <= max;
  }, `debe tener entre ${min} y ${max} caracteres`);

const holderRef = z.union([
  z.strictObject({ external_id: text(1, EXTERNAL_ID_MAX) }),
  z.strictObject({ holder_id: z.string().min(1) }),
]);

const amount = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

const QUALITIES_MAX = 8;
const qualities = z
  .record(text(1, 32), text(1, 64))
  .refine((q) => Object.keys(q).length <= QUALITIES_MAX, `como mucho ${QUALITIES_MAX} cualidades`)
  .refine((q) => !Object.hasOwn(q, RESERVED_QUALITY_KEY), `la clave ${RESERVED_QUALITY_KEY} esta reservada`);

/** No llega a la cadena (el programa recibe el `collection_id`): es el límite de la consola (P14). */
const COLLECTION_NAME_MAX = 64;
const collectionBody = z.strictObject({ name: text(1, COLLECTION_NAME_MAX) });

const itemBody = z.strictObject({
  collection_id: z.string().min(1),
  name: text(1, 32),
  symbol: text(1, 10),
  uri: text(0, 200).default(''),
  qualities: qualities.default({}),
  initial_grant: z.strictObject({ holder: holderRef, amount }),
});

const transferBody = z.strictObject({ from: holderRef, to: holderRef, amount });

const itemsQuery = z.strictObject({ collection_id: z.string().min(1).optional() });

const holderQuery = z.strictObject({ external_id: text(1, EXTERNAL_ID_MAX) });

// --- Credenciales (contrato, 2) ---

const digest = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

/** Comparacion en tiempo constante, sobre resumenes para que la longitud tampoco se filtre. */
function bearerIs(request: FastifyRequest, expected: Buffer): boolean {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ') !== true) return false;
  return timingSafeEqual(digest(header.slice('Bearer '.length)), expected);
}

function sendError(reply: FastifyReply, code: ErrorCode, message: string, status?: number): FastifyReply {
  return reply.status(status ?? ERROR_HTTP_STATUS[code] ?? 500).send({ error: errorBody(code, message) });
}

/** Lo que una escritura deja preparado antes de reclamar la clave. */
interface Prepared {
  /** Sincrono: corre dentro de la transaccion SQLite de `claim`. */
  readonly register: () => AcceptedResponse;
  /** Transaccion ya firmada: se simula antes de reclamar y se envia despues. `null` si no toca la cadena. */
  readonly transaction: Signed | null;
}

type Signed = Transaction;

export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const { db, gameId, authority, rpc } = options;
  const keys: HolderKeys = { masterSeed: options.masterSeed, gameId };
  const writeDigest = digest(options.writeKey);
  const readDigest = digest(options.readToken);
  const game = await findGameAddress(gameId);

  const app = Fastify({ logger: options.logger ?? false });
  const readLimiter = new FixedWindowLimiter(
    { limit: options.readRateLimit ?? DEFAULT_READ_RATE_LIMIT, windowMs: 60_000 },
    options.now,
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ContractError) return sendError(reply, error.code, error.message);
    const limited = rateLimitOf(error);
    if (limited !== null) {
      request.log.warn('el nodo limita la tasa');
      if (limited.retryAfter !== null) void reply.header('retry-after', limited.retryAfter);
      return sendError(reply, 'RATE_LIMITED', 'demasiadas peticiones: reintenta mas tarde');
    }
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i) => `${i.path.join('.') || 'cuerpo'}: ${i.message}`);
      return sendError(reply, 'REJECTED', issues.join('; '));
    }
    const status = (error as { statusCode?: number }).statusCode;
    // JSON mal formado, tipo de contenido incorrecto, cuerpo demasiado grande...
    if (status !== undefined && status >= 400 && status < 500) return sendError(reply, 'REJECTED', 'peticion mal formada');
    request.log.error(error);
    return sendError(reply, 'INTERNAL', 'fallo interno del backend');
  });

  app.setNotFoundHandler((_request, reply) => sendError(reply, 'NOT_FOUND', 'ruta inexistente'));

  const requireWrite = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!bearerIs(request, writeDigest)) return sendError(reply, 'REJECTED', 'credencial de escritura invalida', 401);
  };
  const requireRead = async (request: FastifyRequest, reply: FastifyReply) => {
    const verdict = readLimiter.take(request.ip);
    if (!verdict.allowed) {
      void reply.header('retry-after', verdict.retryAfterSeconds);
      return sendError(reply, 'RATE_LIMITED', 'demasiadas lecturas: reintenta mas tarde');
    }
    if (!bearerIs(request, readDigest)) return sendError(reply, 'REJECTED', 'credencial de lectura invalida', 401);
  };

  const sign = async (draft: TransactionDraft): Promise<Signed> => signTransactionMessageWithSigners(draft);
  const latest = async () => (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value;

  const holderOrNotFound = (ref: HolderRef) => {
    const holder = resolveHolder(db, keys, ref);
    if (holder === null) throw new ContractError('NOT_FOUND', 'tenedor inexistente');
    return holder;
  };

  /** Pasos 1 a 4 de la cabecera. */
  async function write(request: FastifyRequest, reply: FastifyReply, prepare: () => Promise<Prepared>) {
    const key = request.headers[IDEMPOTENCY_HEADER];
    if (typeof key !== 'string' || !isValidIdempotencyKey(key)) {
      return sendError(reply, 'REJECTED', 'falta Idempotency-Key, o no tiene de 1 a 128 caracteres');
    }
    const previous = findAccepted(db, key);
    if (previous !== null) return reply.status(previous.status).send(previous.body);

    const prepared = await prepare();
    if (prepared.transaction !== null) {
      const simulated = await simulate(rpc, prepared.transaction);
      if (simulated !== null) {
        request.log.warn({ detail: simulated.detail }, 'simulacion fallida');
        const { code, message } = simulated.failure;
        // EXPIRED solo existe dentro de una operacion failed: aqui todavia no hay operacion.
        throw new ContractError(ERROR_HTTP_STATUS[code] === null ? 'INTERNAL' : code, message);
      }
    }
    const result = claim(db, key, prepared.register);
    if (!result.replayed && prepared.transaction !== null) {
      try {
        await send(rpc, prepared.transaction);
      } catch (error) {
        // Aceptada y con su firma registrada: el seguimiento la da por caducada si no llega.
        request.log.error({ err: error, operation: result.operationId }, 'envio fallido');
      }
    }
    return reply.status(result.status).send(result.body);
  }

  const createCollection: RouteHandlerMethod = async (request, reply) =>
    write(request, reply, async () => {
      const body = collectionBody.parse(request.body);
      return {
        transaction: null,
        register: () => {
          const collectionId = newId('collection');
          db.prepare('INSERT INTO collections (collection_id, game_id, name, created_at) VALUES (?, ?, ?, ?)').run(
            collectionId,
            gameId,
            body.name,
            timestamp(),
          );
          return { status: 201, body: { collection_id: collectionId }, operationId: null };
        },
      };
    });

  const createItem: RouteHandlerMethod = async (request, reply) =>
    write(request, reply, async () => {
      const body = itemBody.parse(request.body);
      if (!collectionExists(db, body.collection_id)) throw new ContractError('NOT_FOUND', 'coleccion inexistente');
      const holder = holderOrNotFound(body.initial_grant.holder);

      const item = {
        itemId: newId('item'),
        collectionId: body.collection_id,
        name: body.name,
        symbol: body.symbol,
        uri: body.uri,
        qualities: body.qualities,
      };
      const grant = { holder: holder.address, amount: body.initial_grant.amount };
      const lifetime = await latest();
      const plan = await planItemCreation(authority, gameId, item, grant, lifetime);
      if (plan.outcome === 'rejected') {
        throw new ContractError('REJECTED', 'el tipo no cabe en una transaccion: acorta sus campos');
      }
      const transaction = await sign(plan.transactions[0]);
      const mint = await findItemMintAddress(game, item.itemId);

      return {
        transaction,
        register: () => {
          // En un tipo partido, el grant (paso 2) se construye despues desde el payload (P11).
          const payload = plan.outcome === 'split' ? { holder: holder.address, amount: grant.amount } : null;
          const operationId = createOperation(db, 'create_item', payload);
          recordSignature(db, operationId, {
            signature: getSignatureFromTransaction(transaction),
            lastValidBlockHeight: lifetime.lastValidBlockHeight,
          });
          db.prepare(
            `INSERT INTO items (item_id, collection_id, mint, name, symbol, uri, qualities, operation_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            item.itemId,
            item.collectionId,
            mint,
            item.name,
            item.symbol,
            item.uri,
            JSON.stringify(item.qualities),
            operationId,
            timestamp(),
          );
          return {
            status: 202,
            body: { operation_id: operationId, item_id: item.itemId, holder_id: holder.holderId },
            operationId,
          };
        },
      };
    });

  const itemList: RouteHandlerMethod = async (request) => {
    const query = itemsQuery.parse(request.query);
    const collectionId = query.collection_id ?? null;
    if (collectionId !== null && !collectionExists(db, collectionId)) {
      throw new ContractError('NOT_FOUND', 'coleccion inexistente');
    }
    return { items: listItems(db, collectionId) };
  };

  const inventory = async (holder: Holder) => readHolderInventory(rpc, db, game, holder.address);

  app.post('/v1/collections', { preHandler: requireWrite }, createCollection);
  app.post('/v1/items', { preHandler: requireWrite }, createItem);
  app.get('/v1/collections', { preHandler: requireRead }, async () => ({ collections: listCollections(db) }));
  app.get('/v1/items', { preHandler: requireRead }, itemList);

  app.post<{ Params: { item_id: string } }>(
    '/v1/items/:item_id/transfer',
    { preHandler: requireWrite },
    async (request, reply) =>
      write(request, reply, async () => {
        const body = transferBody.parse(request.body);
        const itemId = request.params.item_id;
        if (db.prepare('SELECT 1 FROM items WHERE item_id = ?').get(itemId) === undefined) {
          throw new ContractError('NOT_FOUND', 'tipo inexistente');
        }
        const from = holderOrNotFound(body.from);
        const to = holderOrNotFound(body.to);
        if (from.holderId === to.holderId) {
          throw new ContractError('REJECTED', 'emisor y receptor son el mismo tenedor');
        }

        const lifetime = await latest();
        const plan = await planTransfer(rpc, authority, gameId, itemId, from.address, to.address, body.amount, lifetime);
        if (plan.outcome === 'rejected') {
          // Comprobacion optimista del saldo (contrato, 4.5): no tener cuenta es tener cero.
          if (plan.reason === 'no_sender_account' || plan.reason === 'insufficient_balance') {
            throw new ContractError('INSUFFICIENT_BALANCE', 'el emisor no tiene unidades suficientes de este tipo');
          }
          throw new ContractError('REJECTED', `transferencia invalida: ${plan.reason}`);
        }
        const transaction = await sign(plan.transaction);

        return {
          transaction,
          register: () => {
            const operationId = createOperation(db, 'transfer');
            recordTransferParties(db, operationId, { itemId, fromHolderId: from.holderId, toHolderId: to.holderId });
            recordSignature(db, operationId, {
              signature: getSignatureFromTransaction(transaction),
              lastValidBlockHeight: lifetime.lastValidBlockHeight,
            });
            return {
              status: 202,
              body: { operation_id: operationId, from_holder_id: from.holderId, to_holder_id: to.holderId },
              operationId,
            };
          },
        };
      }),
  );

  // Solo traduce: un external_id que ninguna escritura ha nombrado es 404, y no se registra (contrato, 5.5).
  app.get('/v1/holders', { preHandler: requireRead }, async (request) => {
    const { external_id: externalId } = holderQuery.parse(request.query);
    const holderId = findHolderIdByExternalId(db, externalId);
    if (holderId === null) throw new ContractError('NOT_FOUND', 'jugador sin registrar: ninguna escritura lo ha nombrado');
    return { holder_id: holderId, external_id: externalId };
  });

  app.get<{ Params: { holder_id: string } }>(
    '/v1/holders/:holder_id/items',
    { preHandler: requireRead },
    async (request) => {
      const holder = holderOrNotFound({ holder_id: request.params.holder_id });
      return { holder_id: holder.holderId, items: await inventory(holder) };
    },
  );

  app.get<{ Params: { operation_id: string } }>(
    '/v1/operations/:operation_id',
    { preHandler: requireRead },
    async (request) => {
      const operation = getOperation(db, request.params.operation_id);
      if (operation === null) throw new ContractError('NOT_FOUND', 'operacion inexistente');
      return operation;
    },
  );

  if (options.admin !== undefined) {
    registerAdmin(app, options.admin, {
      gameId: options.gameId,
      gameAddress: game,
      authorityAddress: authority.address,
      db,
      createCollection,
      createItem,
      listItems: itemList,
      inventory,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }

  return app;
}
