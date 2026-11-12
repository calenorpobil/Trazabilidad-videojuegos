/**
 * Servidor HTTP del contrato (`docs/especificacion/http-contract.md`). Rutas del hito:
 *
 *   POST /v1/collections                 escritura, 201, sin operacion
 *   POST /v1/items                       escritura, 202: create_item + grant (bloque 3)
 *   POST /v1/items/{item_id}/transfer    escritura, 202 (bloque 4)
 *   GET  /v1/holders/{holder_id}/items   lectura (bloque 4)
 *   GET  /v1/operations/{operation_id}   lectura: lo que sondea el addon
 *
 * Lo demas responde `404`: `POST …/grants` y `PATCH /v1/items/{id}` quedan bajo la linea de corte
 * (propuesta, 8.1), y los listados de catalogo son del bloque W1.
 *
 * **Orden de una escritura** (invariante 2 y revision del 12-nov-2026):
 *   1. si la clave ya esta aceptada, se devuelve lo guardado sin validar ni tocar la cadena;
 *   2. se valida y se prepara: se lee lo que haga falta de la cadena y se **firma** la transaccion;
 *   3. `claim`, en UNA transaccion SQLite: la operacion, sus filas, la firma y la clave;
 *   4. solo entonces, y solo si no era un reintento, se envia.
 * Un reinicio entre 3 y 4 deja una firma que nunca llega a la cadena: el seguimiento (bloque 5) la
 * dara por caducada. Nunca se envia dos veces lo mismo, ni dos transacciones distintas.
 *
 * Fuera de este modulo, y por bloque: el seguimiento `pending -> applied -> settled`, el segundo
 * paso de un tipo partido y las categorias de error de la cadena (bloque 5); el limite de tasa
 * del `read_token` y la consola `/admin` (W1).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  signTransactionMessageWithSigners,
  type Address,
  type GetAccountInfoApi,
  type GetLatestBlockhashApi,
  type Rpc,
  type SendTransactionApi,
  type Transaction,
  type TransactionSigner,
} from '@solana/kit';
import { z } from 'zod';
import { findGameAddress, findItemMintAddress } from './addresses.js';
import { errorBody, ERROR_HTTP_STATUS, IDEMPOTENCY_HEADER, RESERVED_QUALITY_KEY, type ErrorCode } from './contract.js';
import { timestamp, type Db } from './db.js';
import { resolveHolder, type HolderKeys, type HolderRef } from './holders.js';
import { claim, findAccepted, isValidIdempotencyKey, type AcceptedResponse } from './idempotency.js';
import { newId } from './ids.js';
import { readHolderInventory, type InventoryRpc } from './inventory.js';
import { EXTERNAL_ID_MAX } from './keys.js';
import { createOperation, getOperation, recordSignature } from './operations.js';
import { planItemCreation, planTransfer, type TransactionDraft } from './transactions.js';

export type ChainRpc = Rpc<GetLatestBlockhashApi & GetAccountInfoApi & SendTransactionApi> & InventoryRpc;

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

const collectionBody = z.strictObject({ name: z.string().min(1) });

const itemBody = z.strictObject({
  collection_id: z.string().min(1),
  name: text(1, 32),
  symbol: text(1, 10),
  uri: text(0, 200).default(''),
  qualities: qualities.default({}),
  initial_grant: z.strictObject({ holder: holderRef, amount }),
});

const transferBody = z.strictObject({ from: holderRef, to: holderRef, amount });

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
  /** Transaccion ya firmada que se envia despues de reclamar. `null` si no toca la cadena. */
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

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ContractError) return sendError(reply, error.code, error.message);
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
    const result = claim(db, key, prepared.register);
    if (!result.replayed && prepared.transaction !== null) {
      try {
        await rpc
          .sendTransaction(getBase64EncodedWireTransaction(prepared.transaction), {
            encoding: 'base64',
            preflightCommitment: 'confirmed',
          })
          .send();
      } catch (error) {
        // Aceptada y con su firma registrada: el seguimiento (bloque 5) decide su final.
        request.log.error({ err: error, operation: result.operationId }, 'envio fallido');
      }
    }
    return reply.status(result.status).send(result.body);
  }

  app.post('/v1/collections', { preHandler: requireWrite }, async (request, reply) =>
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
    }),
  );

  app.post('/v1/items', { preHandler: requireWrite }, async (request, reply) =>
    write(request, reply, async () => {
      const body = itemBody.parse(request.body);
      const collection = db.prepare('SELECT 1 FROM collections WHERE collection_id = ?').get(body.collection_id);
      if (collection === undefined) throw new ContractError('NOT_FOUND', 'coleccion inexistente');
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
      const plan = await planItemCreation(authority, gameId, item, grant, await latest());
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
          recordSignature(db, operationId, getSignatureFromTransaction(transaction));
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
    }),
  );

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

        const plan = await planTransfer(rpc, authority, gameId, itemId, from.address, to.address, body.amount, await latest());
        if (plan.outcome === 'rejected') {
          // `no_sender_account`: el emisor nunca tuvo unidades de este tipo, y por tanto no le
          // alcanzan. La comprobacion completa del saldo es del bloque 5.
          if (plan.reason === 'no_sender_account') {
            throw new ContractError('INSUFFICIENT_BALANCE', 'el emisor no tiene unidades de este tipo');
          }
          throw new ContractError('REJECTED', `transferencia invalida: ${plan.reason}`);
        }
        const transaction = await sign(plan.transaction);

        return {
          transaction,
          register: () => {
            const operationId = createOperation(db, 'transfer');
            recordSignature(db, operationId, getSignatureFromTransaction(transaction));
            return {
              status: 202,
              body: { operation_id: operationId, from_holder_id: from.holderId, to_holder_id: to.holderId },
              operationId,
            };
          },
        };
      }),
  );

  app.get<{ Params: { holder_id: string } }>(
    '/v1/holders/:holder_id/items',
    { preHandler: requireRead },
    async (request) => {
      const holder = holderOrNotFound({ holder_id: request.params.holder_id });
      const items = await readHolderInventory(rpc, db, game, holder.address as Address);
      return { holder_id: holder.holderId, items };
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

  return app;
}
