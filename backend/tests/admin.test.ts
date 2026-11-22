/**
 * Consola `/admin` (bloque W1): sesion, cabeceras de seguridad, y que sus rutas usan los mismos
 * manejadores que la API. SQLite en memoria, RPC falso y reloj falso para la caducidad.
 */
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { loopbackHosts, sessionCookie } from '../src/admin.js';
import { openDatabase, type Db } from '../src/db.js';
import { findGameAddress } from '../src/addresses.js';
import { CHAIN_ASSETS_PROGRAM_ADDRESS } from '../src/generated/index.js';
import { deriveAuthority } from '../src/keys.js';
import { transitionOperation } from '../src/operations.js';
import { buildServer, type ChainRpc } from '../src/server.js';
import { authoritySigner } from '../src/transactions.js';
import { chainRpc, fakeChain } from './fake-rpc.js';

const SEED = Uint8Array.from(Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex'));
const WRITE = 'w'.repeat(40);
const READ = 'r'.repeat(40);
const ADMIN = 'a'.repeat(40);
const GAME_ID = 'test-game';
const HOUR = 60 * 60 * 1000;
/** El origen con que el navegador llama a la consola: `inject` manda `Host: localhost:80`. */
const ORIGIN = 'http://localhost:80';
const COOKIE = 'chain_admin_test-game';

let db: Db;
let app: FastifyInstance;
const clock = { t: 0 };
let keyCounter = 0;

beforeEach(async () => {
  clock.t = 1_000_000;
  db = openDatabase(':memory:');
  app = await buildServer({
    db,
    gameId: GAME_ID,
    masterSeed: SEED,
    writeKey: WRITE,
    readToken: READ,
    authority: await authoritySigner(deriveAuthority(SEED, GAME_ID)),
    rpc: chainRpc(fakeChain()) as ChainRpc,
    admin: {
      key: ADMIN,
      explorerTxUrl: 'https://explorer.test/tx/{signature}?cluster=devnet',
      explorerAddressUrl: 'https://explorer.test/address/{address}?cluster=devnet',
      studioName: 'Estudio de prueba',
      signer: 'semilla',
      loginLimit: 3,
    },
    now: () => clock.t,
  });
});

async function login(key = ADMIN) {
  return app.inject({ method: 'POST', url: '/admin/api/session', headers: { origin: ORIGIN }, payload: { key } });
}

/** Cookie de una sesion valida, lista para la cabecera `cookie`. */
async function session(): Promise<string> {
  const r = await login();
  expect(r.statusCode).toBe(204);
  return (r.headers['set-cookie'] as string).split(';')[0] as string;
}

async function admin(cookie: string | null, method: 'GET' | 'POST', url: string, payload?: object) {
  const headers: Record<string, string> = {};
  if (cookie !== null) headers['cookie'] = cookie;
  if (method === 'POST') {
    headers['idempotency-key'] = `consola-${++keyCounter}`;
    headers['origin'] = ORIGIN;
  }
  const r = await app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
  return { status: r.statusCode, body: r.body === '' ? null : (r.json() as Record<string, unknown>), headers: r.headers };
}

describe('pagina', () => {
  it('se sirve sin sesion, sin datos, con CSP de solo el propio origen', async () => {
    for (const url of ['/admin', '/admin/']) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toMatch(/^text\/html/);
      expect(r.headers['content-security-policy']).toContain("default-src 'self'");
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.body).toContain('/admin/admin.js');
    }
    const js = await app.inject({ method: 'GET', url: '/admin/admin.js' });
    expect(js.headers['content-type']).toMatch(/^text\/javascript/);
    const css = await app.inject({ method: 'GET', url: '/admin/admin.css' });
    expect(css.headers['content-type']).toMatch(/^text\/css/);
  });

  it('no sirve nada fuera de la lista de ficheros', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/../package.json' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/admin/otro.js' })).statusCode).toBe(404);
  });
});

describe('sesion', () => {
  it('sin cookie valida, las rutas de datos responden 401', async () => {
    for (const url of ['/admin/api/session', '/admin/api/collections', '/admin/api/items', '/admin/api/operations']) {
      const r = await admin(null, 'GET', url);
      expect(r.status).toBe(401);
      expect((r.body?.['error'] as { code: string }).code).toBe('REJECTED');
    }
    expect((await admin(`${COOKIE}=inventada`, 'GET', '/admin/api/collections')).status).toBe(401);
  });

  it('ni el read_token ni el write_key abren la consola', async () => {
    for (const token of [READ, WRITE]) {
      const r = await app.inject({ method: 'GET', url: '/admin/api/collections', headers: { authorization: `Bearer ${token}` } });
      expect(r.statusCode).toBe(401);
      expect((await login(token)).statusCode).toBe(401);
    }
  });

  it('la credencial da una cookie HttpOnly, SameSite=Strict, limitada a /admin', async () => {
    const r = await login();
    expect(r.statusCode).toBe(204);
    const cookie = r.headers['set-cookie'] as string;
    expect(cookie).toMatch(new RegExp(`^${COOKIE}=[A-Za-z0-9_-]{43}; `));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/admin');
    expect(cookie).not.toContain('Secure'); // por HTTP en 127.0.0.1; por HTTPS si lo lleva
  });

  it('la sesion caduca a las 8 horas y salir la invalida', async () => {
    const cookie = await session();
    expect((await admin(cookie, 'GET', '/admin/api/session')).status).toBe(204);
    clock.t += 8 * HOUR;
    expect((await admin(cookie, 'GET', '/admin/api/session')).status).toBe(401);

    const other = await session();
    const out = await app.inject({ method: 'DELETE', url: '/admin/api/session', headers: { cookie: other, origin: ORIGIN } });
    expect(out.statusCode).toBe(204);
    expect(out.headers['set-cookie']).toContain('Max-Age=0');
    expect((await admin(other, 'GET', '/admin/api/session')).status).toBe(401);
  });

  it('limita los intentos de entrada por IP', async () => {
    for (let i = 0; i < 3; i++) expect((await login('mala')).statusCode).toBe(401);
    const r = await login();
    expect(r.statusCode).toBe(429);
    expect(r.headers['retry-after']).toBeDefined();
    clock.t += 60_000;
    expect((await login()).statusCode).toBe(204);
  });

  it('la cookie lleva el game_id: dos despliegues en la misma maquina no se pisan la sesion', async () => {
    expect(sessionCookie('juego-a')).not.toBe(sessionCookie('juego-b'));
    const cookie = await session();
    expect(cookie.startsWith(`${COOKIE}=`)).toBe(true);
    // La de otro juego, con el mismo valor, no vale aqui.
    expect((await admin(cookie.replace(COOKIE, sessionCookie('otro')), 'GET', '/admin/api/session')).status).toBe(401);
  });
});

describe('despliegue', () => {
  it('dice que juego y estudio es, con sus cuentas y enlaces; sin sesion es 401', async () => {
    expect((await admin(null, 'GET', '/admin/api/deployment')).status).toBe(401);
    const r = await admin(await session(), 'GET', '/admin/api/deployment');
    expect(r.status).toBe(200);
    const game = await findGameAddress(GAME_ID);
    const authority = deriveAuthority(SEED, GAME_ID).address;
    expect(r.body).toEqual({
      game_id: GAME_ID,
      studio_name: 'Estudio de prueba',
      game: { address: game, explorer_url: `https://explorer.test/address/${game}?cluster=devnet` },
      authority: { address: authority, explorer_url: `https://explorer.test/address/${authority}?cluster=devnet`, signer: 'semilla' },
      program: {
        address: CHAIN_ASSETS_PROGRAM_ADDRESS,
        explorer_url: `https://explorer.test/address/${CHAIN_ASSETS_PROGRAM_ADDRESS}?cluster=devnet`,
      },
    });
  });
});

describe('origen y host', () => {
  /** Una escritura de la consola con sesion valida y el `origin` dado. */
  async function write(cookie: string, headers: Record<string, string>) {
    return app.inject({
      method: 'POST',
      url: '/admin/api/collections',
      headers: { cookie, 'idempotency-key': `origen-${++keyCounter}`, ...headers },
      payload: { name: 'Armeria' },
    });
  }

  it('sin Origin, o con el de otro puerto u otro host, una escritura da 403 aunque haya sesion', async () => {
    const cookie = await session();
    for (const headers of [{}, { origin: 'http://localhost:3000' }, { origin: 'http://evil.test' }, { origin: 'null' }]) {
      const r = await write(cookie, headers);
      expect(r.statusCode).toBe(403);
      expect((r.json() as { error: { code: string } }).error.code).toBe('REJECTED');
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM collections').get()).toEqual({ n: 0 });
    expect((await write(cookie, { origin: ORIGIN })).statusCode).toBe(201);
    expect(db.prepare('SELECT COUNT(*) AS n FROM collections').get()).toEqual({ n: 1 });
  });

  it('entrar y salir tambien exigen el origen; las lecturas no', async () => {
    const noOrigin = await app.inject({ method: 'POST', url: '/admin/api/session', payload: { key: ADMIN } });
    expect(noOrigin.statusCode).toBe(403);
    const cookie = await session();
    const out = await app.inject({ method: 'DELETE', url: '/admin/api/session', headers: { cookie } });
    expect(out.statusCode).toBe(403);
    expect((await admin(cookie, 'GET', '/admin/api/session')).status).toBe(204);
  });

  it('con allowedHosts, /admin solo responde a esos Host (DNS rebinding): 421', async () => {
    const hosts = loopbackHosts('127.0.0.1', 8787);
    expect(hosts).toEqual(['127.0.0.1:8787', 'localhost:8787', '[::1]:8787']);
    expect(loopbackHosts('0.0.0.0', 8787)).toBeUndefined();
    const guarded = await buildServer({
      db,
      gameId: GAME_ID,
      masterSeed: SEED,
      writeKey: WRITE,
      readToken: READ,
      authority: await authoritySigner(deriveAuthority(SEED, GAME_ID)),
      rpc: chainRpc(fakeChain()) as ChainRpc,
      admin: { key: ADMIN, explorerTxUrl: 'https://explorer.test/tx/{signature}', ...(hosts ? { allowedHosts: hosts } : {}) },
    });
    const at = (host: string, origin: string) =>
      guarded.inject({ method: 'POST', url: '/admin/api/session', headers: { host, origin }, payload: { key: ADMIN } });
    const rebound = await at('evil.test:8787', 'http://evil.test:8787');
    expect(rebound.statusCode).toBe(421);
    expect((await guarded.inject({ method: 'GET', url: '/admin', headers: { host: 'evil.test:8787' } })).statusCode).toBe(421);
    expect((await at('127.0.0.1:8787', 'http://127.0.0.1:8787')).statusCode).toBe(204);
    expect((await at('LOCALHOST:8787', 'http://localhost:8787')).statusCode).toBe(204);
    // La API no cambia: el addon y el servidor de juego no pasan por aqui.
    const api = await guarded.inject({
      method: 'GET',
      url: '/v1/items',
      headers: { host: 'evil.test:8787', authorization: `Bearer ${READ}` },
    });
    expect(api.statusCode).toBe(200);
  });
});

describe('datos: los mismos manejadores que la API', () => {
  it('crea una coleccion y un tipo, y la API los ve; la clave de idempotencia es la misma', async () => {
    const cookie = await session();
    const col = await admin(cookie, 'POST', '/admin/api/collections', { name: 'Armeria' });
    expect(col.status).toBe(201);
    const collectionId = col.body?.['collection_id'] as string;

    const item = await admin(cookie, 'POST', '/admin/api/items', {
      collection_id: collectionId,
      name: 'Espada',
      symbol: 'SWORD',
      initial_grant: { holder: { external_id: 'game-reserve' }, amount: 5 },
    });
    expect(item.status).toBe(202);

    const viaApi = await app.inject({ method: 'GET', url: '/v1/items', headers: { authorization: `Bearer ${READ}` } });
    expect((viaApi.json() as { items: { item_id: string }[] }).items.map((i) => i.item_id)).toEqual([item.body?.['item_id']]);

    // Validacion estricta y sin clave, como en la API.
    const bad = await app.inject({ method: 'POST', url: '/admin/api/collections', headers: { cookie, origin: ORIGIN }, payload: { name: 'x' } });
    expect(bad.statusCode).toBe(400);
  });

  it('el recuento de tipos de una coleccion solo cuenta los de settled', async () => {
    const cookie = await session();
    const collectionId = (await admin(cookie, 'POST', '/admin/api/collections', { name: 'Armeria' })).body?.['collection_id'];
    const ops = [];
    for (let i = 0; i < 2; i++) {
      const r = await admin(cookie, 'POST', '/admin/api/items', {
        collection_id: collectionId,
        name: `Espada ${i}`,
        symbol: 'SWORD',
        initial_grant: { holder: { external_id: 'game-reserve' }, amount: 1 },
      });
      ops.push(r.body?.['operation_id'] as string);
    }
    transitionOperation(db, ops[0] as string, 'failed', { code: 'EXPIRED', message: 'caducada' });
    transitionOperation(db, ops[1] as string, 'applied');
    transitionOperation(db, ops[1] as string, 'settled');

    const r = await admin(cookie, 'GET', '/admin/api/collections');
    expect(r.body).toEqual({
      collections: [{ collection_id: collectionId, name: 'Armeria', created_at: expect.any(String), settled_items: 1 }],
    });
    // El listado de tipos, en cambio, los da todos con su estado (contrato, 5.4).
    const items = (await admin(cookie, 'GET', '/admin/api/items')).body?.['items'] as { state: string }[];
    expect(items.map((i) => i.state)).toEqual(['settled', 'failed']);
  });

  it('las operaciones llevan la firma registrada y su enlace al explorador', async () => {
    const cookie = await session();
    const collectionId = (await admin(cookie, 'POST', '/admin/api/collections', { name: 'Armeria' })).body?.['collection_id'];
    const created = await admin(cookie, 'POST', '/admin/api/items', {
      collection_id: collectionId,
      name: 'Espada',
      symbol: 'SWORD',
      initial_grant: { holder: { external_id: 'game-reserve' }, amount: 1 },
    });
    const operationId = created.body?.['operation_id'] as string;
    const { signature } = db.prepare('SELECT signature FROM operations WHERE operation_id = ?').get(operationId) as {
      signature: string;
    };

    const one = await admin(cookie, 'GET', `/admin/api/operations/${operationId}`);
    expect(one.body).toEqual({
      operation_id: operationId,
      kind: 'create_item',
      state: 'pending',
      step: 1,
      error: null,
      signature,
      explorer_url: `https://explorer.test/tx/${signature}?cluster=devnet`,
      item: { item_id: created.body?.['item_id'], name: 'Espada' },
      transfer: null,
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
    const list = await admin(cookie, 'GET', '/admin/api/operations');
    expect(list.body).toEqual({ operations: [one.body] });
    expect((await admin(cookie, 'GET', '/admin/api/operations/opr_nada')).status).toBe(404);
  });

  it('una transferencia dice que tipo mueve y entre quien', async () => {
    const cookie = await session();
    const collectionId = (await admin(cookie, 'POST', '/admin/api/collections', { name: 'Armeria' })).body?.['collection_id'];
    const created = await admin(cookie, 'POST', '/admin/api/items', {
      collection_id: collectionId,
      name: 'Espada',
      symbol: 'SWORD',
      initial_grant: { holder: { external_id: 'player-42' }, amount: 3 },
    });
    // Las transferencias no se hacen desde la consola (8.1, recorte 5): llegan del servidor de juego.
    const sent = await app.inject({
      method: 'POST',
      url: `/v1/items/${created.body?.['item_id'] as string}/transfer`,
      headers: { authorization: `Bearer ${WRITE}`, 'idempotency-key': 'transferencia' },
      payload: { from: { external_id: 'player-42' }, to: { external_id: 'player-77' }, amount: 1 },
    });
    expect(sent.statusCode).toBe(202);
    const { operation_id, from_holder_id, to_holder_id } = sent.json() as Record<string, string>;

    const r = await admin(cookie, 'GET', `/admin/api/operations/${operation_id as string}`);
    expect(r.body).toMatchObject({
      kind: 'transfer',
      item: { item_id: created.body?.['item_id'], name: 'Espada' },
      transfer: {
        from: { holder_id: from_holder_id, external_id: 'player-42' },
        to: { holder_id: to_holder_id, external_id: 'player-77' },
      },
    });
    const list = (await admin(cookie, 'GET', '/admin/api/operations')).body?.['operations'] as { kind: string }[];
    expect(list.map((o) => o.kind)).toEqual(['transfer', 'create_item']);
  });

  it('el inventario se consulta por holder_id o por external_id registrado, sin registrar ninguno nuevo', async () => {
    const cookie = await session();
    const unknown = await admin(cookie, 'GET', '/admin/api/holders/player-99/items');
    expect(unknown.status).toBe(404);
    expect(db.prepare('SELECT count(*) AS n FROM holders').get()).toEqual({ n: 0 });

    const collectionId = (await admin(cookie, 'POST', '/admin/api/collections', { name: 'Armeria' })).body?.['collection_id'];
    const created = await admin(cookie, 'POST', '/admin/api/items', {
      collection_id: collectionId,
      name: 'Espada',
      symbol: 'SWORD',
      initial_grant: { holder: { external_id: 'player-42' }, amount: 1 },
    });
    const holderId = created.body?.['holder_id'] as string;
    for (const ref of ['player-42', holderId]) {
      const r = await admin(cookie, 'GET', `/admin/api/holders/${ref}/items`);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ holder_id: holderId, external_id: 'player-42', items: [] });
    }
  });
});
