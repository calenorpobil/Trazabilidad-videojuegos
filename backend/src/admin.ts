/**
 * Consola de administracion (propuesta, 3; bloque W1). La sirve el propio backend bajo `/admin`, y el
 * navegador solo habla con el:
 *
 *   GET    /admin                          la pagina (`frontend/`), sin datos
 *   POST   /admin/api/session              entra con la credencial de la consola: cookie de sesion
 *   GET    /admin/api/session              204 si la sesion vale
 *   DELETE /admin/api/session              sale
 *   GET    /admin/api/collections          como GET /v1/collections, con recuento de tipos en settled
 *   POST   /admin/api/collections          el mismo manejador que POST /v1/collections
 *   GET    /admin/api/items                el mismo listado que GET /v1/items
 *   POST   /admin/api/items                el mismo manejador que POST /v1/items
 *   GET    /admin/api/operations           las 50 ultimas, con enlace a su transaccion
 *   GET    /admin/api/operations/{id}      una, con enlace a su transaccion
 *   GET    /admin/api/holders/{ref}/items  inventario por holder_id o por external_id ya registrado
 *
 * **No es parte del contrato HTTP** (contrato, 2): ni el addon ni el servidor de juego usan estas
 * rutas. Por eso pueden mostrar la firma registrada y su enlace al explorador, que el contrato nunca
 * expone (5.1). Entregar y transferir no estan: se hacen desde la demo (8.1, recorte 5).
 *
 * **Acceso.** `CHAIN_ADMIN_KEY` se cambia en `POST /admin/api/session` por una cookie `HttpOnly`,
 * `SameSite=Strict` y con `Path=/admin`, y `Secure` si la peticion llego por HTTPS. Las sesiones
 * viven en memoria: un reinicio obliga a entrar otra vez. Sin cookie valida, las rutas de
 * `/admin/api` responden `401`; la pagina en si no lleva datos y se sirve sin sesion, porque es la
 * que pide la credencial. Ninguna credencial de la API (`write_key`, `read_token`) llega al
 * navegador: las rutas llaman a los mismos manejadores por dentro.
 *
 * La pagina se sirve con una CSP que solo admite recursos del propio origen: ni scripts en linea
 * ni de terceros.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import { z } from 'zod';
import { listCollections } from './catalog.js';
import { errorBody, type ErrorCode, type OperationState } from './contract.js';
import type { Db } from './db.js';
import type { Holder } from './holders.js';
import type { InventoryItem } from './inventory.js';
import { FixedWindowLimiter } from './rate-limit.js';

export interface AdminOptions {
  /** `CHAIN_ADMIN_KEY`. */
  readonly key: string;
  /** Plantilla del enlace a una transaccion, con `{signature}`. */
  readonly explorerTxUrl: string;
  /** Duracion de una sesion. Por defecto, 8 horas. */
  readonly sessionMs?: number;
  /** Intentos de entrada por minuto y por IP. Por defecto, 10. */
  readonly loginLimit?: number;
}

/** Lo que la consola toma del servidor: los mismos manejadores y lecturas que la API. */
export interface AdminDeps {
  readonly db: Db;
  readonly createCollection: RouteHandlerMethod;
  readonly createItem: RouteHandlerMethod;
  readonly listItems: RouteHandlerMethod;
  readonly inventory: (holder: Holder) => Promise<InventoryItem[]>;
  readonly now?: () => number;
}

export const SESSION_COOKIE = 'chain_admin';
const DEFAULT_SESSION_MS = 8 * 60 * 60 * 1000;
const RECENT_OPERATIONS = 50;

/** Ficheros de `frontend/`: los unicos que se sirven, con su tipo. */
const FRONTEND = new URL('../../frontend/', import.meta.url);
const ASSETS = {
  'admin.js': 'text/javascript; charset=utf-8',
  'admin.css': 'text/css; charset=utf-8',
} as const;

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
} as const;

const loginBody = z.strictObject({ key: z.string().min(1) });

const digest = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

function cookieValue(request: FastifyRequest, name: string): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function fail(reply: FastifyReply, status: number, code: ErrorCode, message: string): FastifyReply {
  return reply.status(status).send({ error: errorBody(code, message) });
}

/** Una operacion como la ve la consola: con la firma del paso en curso y su enlace. */
export interface AdminOperation {
  operation_id: string;
  kind: string;
  state: OperationState;
  step: number;
  error: { code: string; message: string } | null;
  signature: string | null;
  explorer_url: string | null;
  item: { item_id: string; name: string } | null;
  created_at: string;
  updated_at: string;
}

interface OperationRow {
  operation_id: string;
  kind: string;
  state: OperationState;
  step: number;
  signature: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  item_id: string | null;
  item_name: string | null;
}

const OPERATION_SELECT = `SELECT o.operation_id, o.kind, o.state, o.step, o.signature, o.error_code, o.error_message,
       o.created_at, o.updated_at, i.item_id, i.name AS item_name
  FROM operations o LEFT JOIN items i ON i.operation_id = o.operation_id`;

export function registerAdmin(app: FastifyInstance, options: AdminOptions, deps: AdminDeps): void {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const keyDigest = digest(options.key);
  const sessionMs = options.sessionMs ?? DEFAULT_SESSION_MS;
  const loginLimiter = new FixedWindowLimiter({ limit: options.loginLimit ?? 10, windowMs: 60_000 }, now);
  /** Resumen del token de sesion -> caducidad. El token en claro solo esta en la cookie. */
  const sessions = new Map<string, number>();

  const page = readFileSync(new URL('index.html', FRONTEND), 'utf8');
  const assets = new Map(
    Object.entries(ASSETS).map(([name, type]) => [name, { type, body: readFileSync(new URL(name, FRONTEND), 'utf8') }]),
  );

  const explorerUrl = (signature: string | null) =>
    signature === null ? null : options.explorerTxUrl.replace('{signature}', encodeURIComponent(signature));

  const toView = (r: OperationRow): AdminOperation => ({
    operation_id: r.operation_id,
    kind: r.kind,
    state: r.state,
    step: r.step,
    error: r.error_code === null ? null : { code: r.error_code, message: r.error_message ?? '' },
    signature: r.signature,
    explorer_url: explorerUrl(r.signature),
    item: r.item_id === null ? null : { item_id: r.item_id, name: r.item_name ?? '' },
    created_at: r.created_at,
    updated_at: r.updated_at,
  });

  app.addHook('onSend', async (request, reply) => {
    if (request.url === '/admin' || request.url.startsWith('/admin/')) void reply.headers(SECURITY_HEADERS);
  });

  // --- Sesion ---

  const sessionOf = (request: FastifyRequest): string | null => {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token === null || token === '') return null;
    const id = digest(token).toString('hex');
    const expires = sessions.get(id);
    if (expires === undefined) return null;
    if (expires <= now()) {
      sessions.delete(id);
      return null;
    }
    return id;
  };

  const requireSession = async (request: FastifyRequest, reply: FastifyReply) => {
    if (sessionOf(request) === null) return fail(reply, 401, 'REJECTED', 'sesion de la consola ausente o caducada');
  };

  const cookie = (request: FastifyRequest, token: string, maxAgeSeconds: number) =>
    [
      `${SESSION_COOKIE}=${token}`,
      'Path=/admin',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${maxAgeSeconds}`,
      ...(request.protocol === 'https' ? ['Secure'] : []),
    ].join('; ');

  app.post('/admin/api/session', async (request, reply) => {
    const verdict = loginLimiter.take(request.ip);
    if (!verdict.allowed) {
      void reply.header('retry-after', verdict.retryAfterSeconds);
      return fail(reply, 429, 'RATE_LIMITED', 'demasiados intentos de entrada: espera un poco');
    }
    const body = loginBody.safeParse(request.body);
    if (!body.success || !timingSafeEqual(digest(body.data.key), keyDigest)) {
      return fail(reply, 401, 'REJECTED', 'credencial de la consola invalida');
    }
    const at = now();
    for (const [id, expires] of sessions) if (expires <= at) sessions.delete(id);
    const token = randomBytes(32).toString('base64url');
    sessions.set(digest(token).toString('hex'), at + sessionMs);
    return reply
      .header('set-cookie', cookie(request, token, Math.floor(sessionMs / 1000)))
      .status(204)
      .send();
  });

  app.get('/admin/api/session', { preHandler: requireSession }, async (_request, reply) => reply.status(204).send());

  app.delete('/admin/api/session', async (request, reply) => {
    const id = sessionOf(request);
    if (id !== null) sessions.delete(id);
    return reply.header('set-cookie', cookie(request, '', 0)).status(204).send();
  });

  // --- Pagina ---

  const sendPage = async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.type('text/html; charset=utf-8').send(page);
  app.get('/admin', sendPage);
  app.get('/admin/', sendPage);
  for (const [name, asset] of assets) {
    app.get(`/admin/${name}`, async (_request, reply) => reply.type(asset.type).send(asset.body));
  }

  // --- Datos: las mismas funciones que la API ---

  app.get('/admin/api/collections', { preHandler: requireSession }, async () => ({
    collections: listCollections(db, true),
  }));
  app.post('/admin/api/collections', { preHandler: requireSession }, deps.createCollection);
  app.get('/admin/api/items', { preHandler: requireSession }, deps.listItems);
  app.post('/admin/api/items', { preHandler: requireSession }, deps.createItem);

  app.get('/admin/api/operations', { preHandler: requireSession }, async () => ({
    operations: (
      db
        .prepare(`${OPERATION_SELECT} ORDER BY o.created_at DESC, o.rowid DESC LIMIT ${RECENT_OPERATIONS}`)
        .all() as OperationRow[]
    ).map(toView),
  }));

  app.get<{ Params: { operation_id: string } }>(
    '/admin/api/operations/:operation_id',
    { preHandler: requireSession },
    async (request, reply) => {
      const row = db.prepare(`${OPERATION_SELECT} WHERE o.operation_id = ?`).get(request.params.operation_id) as
        | OperationRow
        | undefined;
      if (row === undefined) return fail(reply, 404, 'NOT_FOUND', 'operacion inexistente');
      return toView(row);
    },
  );

  /**
   * Por `holder_id` o por un `external_id` ya registrado. A diferencia de la API, aqui no se registra
   * un tenedor nuevo: consultar no debe crear filas.
   */
  app.get<{ Params: { ref: string } }>(
    '/admin/api/holders/:ref/items',
    { preHandler: requireSession },
    async (request, reply) => {
      const { ref } = request.params;
      const row = db
        .prepare(
          `SELECT holder_id, external_id, address FROM holders
            WHERE holder_id = ? OR external_id = ? ORDER BY holder_id = ? DESC LIMIT 1`,
        )
        .get(ref, ref, ref) as { holder_id: string; external_id: string; address: Holder['address'] } | undefined;
      if (row === undefined) return fail(reply, 404, 'NOT_FOUND', 'tenedor inexistente');
      const items = await deps.inventory({ holderId: row.holder_id, address: row.address });
      return { holder_id: row.holder_id, external_id: row.external_id, items };
    },
  );
}
