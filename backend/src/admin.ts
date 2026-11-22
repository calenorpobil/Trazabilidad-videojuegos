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
 *   GET    /admin/api/operations           las 50 ultimas, con enlace a su transaccion, su tipo y, en
 *                                          un transfer, entre quien
 *   GET    /admin/api/operations/{id}      una, con enlace a su transaccion
 *   GET    /admin/api/holders/{ref}/items  inventario por holder_id o por external_id ya registrado, con
 *                                          la cuenta del tenedor y el mint de cada tipo en el explorador
 *   GET    /admin/api/deployment           que despliegue es: juego, estudio, cuenta `Game`, autoridad,
 *                                          quien firma y programa, con sus enlaces al explorador
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
 * La cookie se llama `chain_admin_<game_id>`: las cookies no distinguen puertos, y dos despliegues en
 * la misma maquina (`127.0.0.1:8787` y `:8788`) con el mismo nombre se pisarian la sesion.
 *
 * **Origen.** `SameSite=Strict` tampoco distingue puertos: una pagina en otro puerto de `127.0.0.1` es
 * del mismo sitio y su peticion lleva la cookie. Por eso toda peticion a `/admin/api` que no sea
 * `GET` ni `HEAD` exige una cabecera `Origin` cuyo host coincida con `Host`, o responde `403`. Detras
 * de un proxy, este debe conservar `Host`.
 *
 * **Host.** Si el backend escucha en loopback, `/admin` solo responde a `Host` de loopback con su
 * puerto (`allowedHosts`), o `421`: corta el DNS rebinding, con el que una web ajena hablaria con la
 * consola bajo su propio nombre y podria agotar los intentos de entrada.
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
import { CHAIN_ASSETS_PROGRAM_ADDRESS } from './generated/index.js';
import type { Db } from './db.js';
import type { Holder } from './holders.js';
import type { InventoryItem } from './inventory.js';
import { FixedWindowLimiter } from './rate-limit.js';

export interface AdminOptions {
  /** `CHAIN_ADMIN_KEY`. */
  readonly key: string;
  /** Plantilla del enlace a una transaccion, con `{signature}`. */
  readonly explorerTxUrl: string;
  /** Plantilla del enlace a una cuenta, con `{address}`. Sin ella, la vista «Despliegue» va sin enlaces. */
  readonly explorerAddressUrl?: string;
  /** `CHAIN_STUDIO_NAME`, solo para mostrarlo. */
  readonly studioName?: string | null;
  /** De donde sale la firma de la autoridad (`authority.ts`). Nunca lleva secretos. */
  readonly signer?: string;
  /** Duracion de una sesion. Por defecto, 8 horas. */
  readonly sessionMs?: number;
  /** Intentos de entrada por minuto y por IP. Por defecto, 10. */
  readonly loginLimit?: number;
  /** Valores de `Host` admitidos en `/admin`, en minusculas. Sin ella, cualquiera (`loopbackHosts`). */
  readonly allowedHosts?: readonly string[];
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Los `Host` con que se llega a un backend que escucha en loopback, o `undefined` si escucha en otra
 * direccion: exponerlo es decision de quien despliega, y entonces el nombre publico no se conoce aqui.
 */
export function loopbackHosts(host: string, port: number): string[] | undefined {
  if (!LOOPBACK.has(host.toLowerCase())) return undefined;
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

/** Si el host de `origin` es el de la cabecera `Host`, con el puerto por defecto de su esquema normalizado. */
function sameHost(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined || host === undefined || host === '') return false;
  try {
    const o = new URL(origin);
    return o.host === new URL(`${o.protocol}//${host}`).host;
  } catch {
    return false;
  }
}

/** Lo que la consola toma del servidor: los mismos manejadores y lecturas que la API. */
export interface AdminDeps {
  readonly db: Db;
  /** Da nombre a la cookie de sesion. */
  readonly gameId: string;
  /** La PDA `Game` del juego. */
  readonly gameAddress: string;
  /** La autoridad con que firma este backend. */
  readonly authorityAddress: string;
  readonly createCollection: RouteHandlerMethod;
  readonly createItem: RouteHandlerMethod;
  readonly listItems: RouteHandlerMethod;
  readonly inventory: (holder: Holder) => Promise<InventoryItem[]>;
  readonly now?: () => number;
}

/** Nombre de la cookie de sesion de un juego. `game_id` cumple `[a-z0-9-]`, valido en una cookie. */
export const sessionCookie = (gameId: string): string => `chain_admin_${gameId}`;
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
  /** El tipo que crea un `create_item` o que mueve un `transfer`. */
  item: { item_id: string; name: string } | null;
  /** En un `transfer`, entre quien. El `external_id` es el identificador del jugador en el juego. */
  transfer: { from: AdminHolder; to: AdminHolder } | null;
  created_at: string;
  updated_at: string;
}

export interface AdminHolder {
  holder_id: string;
  external_id: string;
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
  from_holder_id: string | null;
  from_external_id: string | null;
  to_holder_id: string | null;
  to_external_id: string | null;
}

/** El tipo sale de `items.operation_id` en un `create_item` y de `operations.item_id` en un `transfer`. */
const OPERATION_SELECT = `SELECT o.operation_id, o.kind, o.state, o.step, o.signature, o.error_code, o.error_message,
       o.created_at, o.updated_at, i.item_id, i.name AS item_name,
       o.from_holder_id, hf.external_id AS from_external_id, o.to_holder_id, ht.external_id AS to_external_id
  FROM operations o
  LEFT JOIN items i ON i.item_id = COALESCE(o.item_id, (SELECT c.item_id FROM items c WHERE c.operation_id = o.operation_id))
  LEFT JOIN holders hf ON hf.holder_id = o.from_holder_id
  LEFT JOIN holders ht ON ht.holder_id = o.to_holder_id`;

export function registerAdmin(app: FastifyInstance, options: AdminOptions, deps: AdminDeps): void {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  const keyDigest = digest(options.key);
  const sessionMs = options.sessionMs ?? DEFAULT_SESSION_MS;
  const loginLimiter = new FixedWindowLimiter({ limit: options.loginLimit ?? 10, windowMs: 60_000 }, now);
  /** Resumen del token de sesion -> caducidad. El token en claro solo esta en la cookie. */
  const sessions = new Map<string, number>();
  const cookieName = sessionCookie(deps.gameId);
  const allowedHosts = options.allowedHosts === undefined ? undefined : new Set(options.allowedHosts);

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
    transfer:
      r.from_holder_id === null || r.to_holder_id === null
        ? null
        : {
            from: { holder_id: r.from_holder_id, external_id: r.from_external_id ?? '' },
            to: { holder_id: r.to_holder_id, external_id: r.to_external_id ?? '' },
          },
    created_at: r.created_at,
    updated_at: r.updated_at,
  });

  const isAdmin = (url: string) => url === '/admin' || url.startsWith('/admin/') || url.startsWith('/admin?');

  app.addHook('onSend', async (request, reply) => {
    if (isAdmin(request.url)) void reply.headers(SECURITY_HEADERS);
  });

  // Host y origen, antes que la sesion y que el limite de entrada.
  app.addHook('onRequest', async (request, reply) => {
    if (!isAdmin(request.url)) return;
    const host = request.headers.host?.toLowerCase();
    if (allowedHosts !== undefined && (host === undefined || !allowedHosts.has(host))) {
      return fail(reply, 421, 'REJECTED', 'host no admitido en la consola');
    }
    const unsafe = request.method !== 'GET' && request.method !== 'HEAD';
    if (unsafe && request.url.startsWith('/admin/api/') && !sameHost(request.headers.origin, host)) {
      return fail(reply, 403, 'REJECTED', 'origen ausente o distinto del de la consola');
    }
  });

  // --- Sesion ---

  const sessionOf = (request: FastifyRequest): string | null => {
    const token = cookieValue(request, cookieName);
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
      `${cookieName}=${token}`,
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

  const addressUrl = (address: string) =>
    options.explorerAddressUrl === undefined
      ? null
      : options.explorerAddressUrl.replace('{address}', encodeURIComponent(address));
  app.get('/admin/api/deployment', { preHandler: requireSession }, async () => ({
    game_id: deps.gameId,
    studio_name: options.studioName ?? null,
    game: { address: deps.gameAddress, explorer_url: addressUrl(deps.gameAddress) },
    authority: { address: deps.authorityAddress, explorer_url: addressUrl(deps.authorityAddress), signer: options.signer ?? null },
    program: { address: CHAIN_ASSETS_PROGRAM_ADDRESS, explorer_url: addressUrl(CHAIN_ASSETS_PROGRAM_ADDRESS) },
  }));

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

  const mintOf = db.prepare<[string], { mint: string }>('SELECT mint FROM items WHERE item_id = ?');

  /**
   * Por `holder_id` o por un `external_id` ya registrado. A diferencia de la API, aqui no se registra
   * un tenedor nuevo: consultar no debe crear filas.
   *
   * Lleva la cuenta del tenedor y el mint de cada tipo, con sus enlaces al explorador: con ellos se
   * comprueba en la cadena, sin fiarse de este backend, que el saldo es el que se ve y que el mint lo
   * emitio la cuenta `Game` de este juego. La API (contrato, 5.2) no da direcciones; la consola, si.
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
      return {
        holder_id: row.holder_id,
        external_id: row.external_id,
        account: { address: row.address, explorer_url: addressUrl(row.address) },
        items: items.map((item) => {
          // El inventario sale de los mints de la cadena, asi que el tipo esta en `items`.
          const mint = mintOf.get(item.item_id)?.mint ?? null;
          return { ...item, mint: mint === null ? null : { address: mint, explorer_url: addressUrl(mint) } };
        }),
      };
    },
  );
}
