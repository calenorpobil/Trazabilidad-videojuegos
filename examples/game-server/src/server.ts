/**
 * Servidor de juego de ejemplo del hito (propuesta, 3, 4.4 y 7). Es lo que escribiría un estudio: el
 * único que tiene el `write_key`, y quien decide qué puede hacer cada jugador. El addon le manda las
 * escrituras; las lecturas van directas del juego al backend, con el `read_token`, y no pasan por aquí.
 *
 *   POST /v1/items/{item_id}/transfer    se reenvía; el emisor lo pone el servidor: el jugador de la demo
 *   POST /v1/collections, POST /v1/items `403` / `REJECTED`: el catálogo lo crea el estudio
 *
 * **El juego no crea colecciones ni tipos** (propuesta, revisión del 16 de noviembre de 2026). Eso es del
 * estudio, desde la consola `/admin`, que también hace la entrega inicial. Un servidor que reenviara la
 * creación pedida por el cliente dejaría a cualquier jugador crearse los objetos que quisiera.
 *
 * Cada escritura sigue el mismo orden:
 *   1. exige `Idempotency-Key` y autoriza: el juego no puede elegir el emisor de una transferencia;
 *   2. registra la acción en `actions` **antes** de llamar (4.4). Si ya estaba registrada, reenvía la
 *      acción registrada, no la nueva: misma clave, misma acción. Si el backend ya la aceptó, devuelve
 *      lo guardado sin llamarlo;
 *   3. la reenvía al backend con el `write_key` y la `Idempotency-Key` sin tocar;
 *   4. guarda la respuesta y la devuelve tal cual, con su `Retry-After` si lo trae.
 *
 * La idempotencia de verdad la garantiza el backend (contrato, 3). Lo que añade este registro es que
 * la acción queda fijada al aceptarla: un reintento con otros datos no cambia lo que se pidió.
 *
 * La demo tiene un solo jugador que pide cosas, así que todas las transferencias salen de él. Un juego
 * real lo sacaría de la sesión del jugador; el addon no tiene credencial hacia el servidor de juego,
 * porque la demo no la necesita.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { timestamp, type Db } from './db.js';

export interface ServerOptions {
  readonly db: Db;
  /** Base del backend, sin barra final. */
  readonly backendUrl: string;
  readonly writeKey: string;
  /** El jugador de la demo: el emisor de toda transferencia, por su `external_id`. */
  readonly player: string;
  /** Lo que se espera al backend, en milisegundos. */
  readonly backendTimeoutMs?: number;
  readonly logger?: boolean;
}

const KEY_HEADER = 'idempotency-key';
/** Contrato, 3. */
const KEY_MAX = 128;

type ErrorCode = 'REJECTED' | 'NOT_FOUND' | 'INTERNAL';

/** Error con la forma del contrato (6). De los tres que produce este servidor, sólo `INTERNAL` se reintenta. */
function sendError(reply: FastifyReply, status: number, code: ErrorCode, message: string): FastifyReply {
  return reply.status(status).send({ error: { code, message, retryable: code === 'INTERNAL' } });
}

interface Action {
  route: string;
  body: string;
  status_code: number | null;
  response: string | null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function buildServer(options: ServerOptions): FastifyInstance {
  const { db, writeKey, player } = options;
  const backendUrl = options.backendUrl.replace(/\/+$/, '');
  const timeoutMs = options.backendTimeoutMs ?? 30_000;
  const app = Fastify({ logger: options.logger ?? false });

  const insert = db.prepare(
    `INSERT INTO actions (key, route, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (key) DO NOTHING`,
  );
  const select = db.prepare('SELECT route, body, status_code, response FROM actions WHERE key = ?');
  const update = db.prepare('UPDATE actions SET status_code = ?, response = ?, updated_at = ? WHERE key = ?');

  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode;
    // JSON mal formado, tipo de contenido incorrecto, cuerpo demasiado grande...
    if (status !== undefined && status >= 400 && status < 500) return sendError(reply, 400, 'REJECTED', 'peticion mal formada');
    request.log.error(error);
    return sendError(reply, 500, 'INTERNAL', 'fallo interno del servidor de juego');
  });
  app.setNotFoundHandler((_request, reply) => sendError(reply, 404, 'NOT_FOUND', 'ruta inexistente'));

  /**
   * Pasos 1 a 4 de la cabecera. `authorize` devuelve el cuerpo que se reenvía, o un mensaje si el
   * jugador no puede pedir eso.
   */
  async function relay(
    request: FastifyRequest,
    reply: FastifyReply,
    route: string,
    authorize: (body: Record<string, unknown>) => Record<string, unknown> | string,
  ) {
    const key = request.headers[KEY_HEADER];
    if (typeof key !== 'string' || key.length < 1 || key.length > KEY_MAX) {
      return sendError(reply, 400, 'REJECTED', `falta Idempotency-Key, o no tiene de 1 a ${KEY_MAX} caracteres`);
    }
    if (!isObject(request.body)) return sendError(reply, 400, 'REJECTED', 'el cuerpo debe ser un objeto JSON');
    const authorized = authorize(request.body);
    if (typeof authorized === 'string') return sendError(reply, 400, 'REJECTED', authorized);

    // Registrar primero, llamar después.
    const now = timestamp();
    insert.run(key, route, JSON.stringify(authorized), now, now);
    const action = select.get(key) as Action;
    if (action.status_code !== null && action.status_code >= 200 && action.status_code < 300) {
      return reply.status(action.status_code).send(JSON.parse(action.response as string));
    }

    let response: Response;
    try {
      response = await fetch(backendUrl + action.route, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${writeKey}`,
          'content-type': 'application/json; charset=utf-8',
          [KEY_HEADER]: key,
        },
        body: action.body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // La acción queda registrada sin respuesta: el mismo reintento la vuelve a enviar.
      request.log.error({ err: error }, 'el backend no responde');
      return sendError(reply, 500, 'INTERNAL', 'el backend no responde');
    }
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      request.log.error({ status: response.status }, 'respuesta del backend que no es JSON');
      return sendError(reply, 500, 'INTERNAL', 'respuesta inesperada del backend');
    }
    update.run(response.status, text, timestamp(), key);
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter !== null) void reply.header('retry-after', retryAfter);
    return reply.status(response.status).send(body);
  }

  const catalogIsForTheStudio = async (_request: FastifyRequest, reply: FastifyReply) =>
    sendError(reply, 403, 'REJECTED', 'el juego no crea colecciones ni tipos: lo hace el estudio desde la consola');
  app.post('/v1/collections', catalogIsForTheStudio);
  app.post('/v1/items', catalogIsForTheStudio);

  app.post<{ Params: { item_id: string } }>('/v1/items/:item_id/transfer', async (request, reply) =>
    relay(request, reply, `/v1/items/${encodeURIComponent(request.params.item_id)}/transfer`, (body) => {
      // Quién da es decisión del servidor, no del juego, que el jugador controla.
      if (Object.hasOwn(body, 'from')) return 'el emisor lo decide el servidor de juego: quita "from"';
      return { ...body, from: { external_id: player } };
    }),
  );

  return app;
}
