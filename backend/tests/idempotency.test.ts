/**
 * Invariante 2 de CLAUDE.md: marcar primero, llamar despues. `sendToChain` hace aqui de la llamada
 * a la cadena: el test cuenta cuantas veces se llamaria.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db.js';
import { IDEMPOTENCY_KEY_MAX, claim, isValidIdempotencyKey } from '../src/idempotency.js';
import { createOperation, getOperation, transitionOperation } from '../src/operations.js';

const dir = mkdtempSync(join(tmpdir(), 'chain-idem-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Escritura de ejemplo con la forma de `POST /v1/items/{id}/grants`. */
function grant(db: Db, key: string, holder: string, sent: string[]) {
  const result = claim(db, key, () => {
    const operationId = createOperation(db, 'grant');
    return { status: 202, operationId, body: { operation_id: operationId, holder_id: holder } };
  });
  if (!result.replayed && result.operationId !== null) sent.push(result.operationId);
  return result;
}

describe('claim', () => {
  it('la primera vez registra la operacion y deja que el llamador la envie', () => {
    const db = openDatabase(':memory:');
    const sent: string[] = [];
    const r = grant(db, 'k1', 'hld_a', sent);
    expect(r.replayed).toBe(false);
    expect(r.status).toBe(202);
    expect(sent).toEqual([r.operationId]);
    expect(getOperation(db, r.operationId as string)?.state).toBe('pending');
  });

  it('un reintento con la misma clave devuelve el mismo cuerpo y no vuelve a enviar', () => {
    const db = openDatabase(':memory:');
    const sent: string[] = [];
    const first = grant(db, 'k1', 'hld_a', sent);
    const second = grant(db, 'k1', 'hld_a', sent);
    expect(second.replayed).toBe(true);
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(sent).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM operations').get()).toEqual({ n: 1 });
  });

  it('la misma clave con otro cuerpo devuelve el resultado original (contrato, 9.5)', () => {
    const db = openDatabase(':memory:');
    const sent: string[] = [];
    const first = grant(db, 'k1', 'hld_a', sent);
    const other = grant(db, 'k1', 'hld_OTRO', sent);
    expect(other.body).toEqual(first.body);
    expect(sent).toHaveLength(1);
  });

  it('claves distintas son escrituras distintas', () => {
    const db = openDatabase(':memory:');
    const sent: string[] = [];
    grant(db, 'k1', 'hld_a', sent);
    grant(db, 'k2', 'hld_a', sent);
    expect(sent).toHaveLength(2);
  });

  it('la clave queda marcada antes de que el llamador toque la cadena', () => {
    const db = openDatabase(':memory:');
    let markedWhenSending = false;
    const r = claim(db, 'k1', () => {
      const operationId = createOperation(db, 'grant');
      return { status: 202, operationId, body: { operation_id: operationId } };
    });
    // Aqui iria el envio. Lo que importa: la clave ya esta confirmada en la base de datos.
    if (!r.replayed) {
      markedWhenSending = db.prepare("SELECT 1 FROM idempotency WHERE key = 'k1'").get() !== undefined;
    }
    expect(markedWhenSending).toBe(true);
  });

  it('la marca es visible desde otra conexion antes del envio (otro proceso del backend)', () => {
    const path = join(dir, 'dos-conexiones.db');
    const a = openDatabase(path);
    const b = openDatabase(path);
    const sent: string[] = [];
    const first = grant(a, 'k1', 'hld_a', sent);
    const fromOther = grant(b, 'k1', 'hld_a', sent);
    expect(fromOther.replayed).toBe(true);
    expect(fromOther.body).toEqual(first.body);
    expect(sent).toHaveLength(1);
    a.close();
    b.close();
  });

  it('si el registro falla, no se marca nada y la misma clave sirve despues', () => {
    const db = openDatabase(':memory:');
    expect(() =>
      claim(db, 'k1', () => {
        createOperation(db, 'grant');
        throw new Error('la coleccion no existe');
      }),
    ).toThrow('la coleccion no existe');
    expect(db.prepare('SELECT COUNT(*) AS n FROM idempotency').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM operations').get()).toEqual({ n: 0 });

    const sent: string[] = [];
    expect(grant(db, 'k1', 'hld_a', sent).replayed).toBe(false);
  });

  it('una operacion que acabo en failed devuelve su respuesta original: reintentar exige clave nueva', () => {
    const db = openDatabase(':memory:');
    const sent: string[] = [];
    const first = grant(db, 'k1', 'hld_a', sent);
    transitionOperation(db, first.operationId as string, 'failed', { code: 'EXPIRED', message: 'caducada' });
    const again = grant(db, 'k1', 'hld_a', sent);
    expect(again.replayed).toBe(true);
    expect(again.operationId).toBe(first.operationId);
    expect(sent).toHaveLength(1);
  });

  it('guarda tambien las escrituras sin operacion, como POST /v1/collections', () => {
    const db = openDatabase(':memory:');
    const register = () => ({ status: 201, operationId: null, body: { collection_id: 'col_a' } });
    claim(db, 'k1', register);
    const again = claim(db, 'k1', () => {
      throw new Error('no deberia registrarse dos veces');
    });
    expect(again).toEqual({ replayed: true, status: 201, operationId: null, body: { collection_id: 'col_a' } });
  });
});

describe('isValidIdempotencyKey', () => {
  it(`admite de 1 a ${IDEMPOTENCY_KEY_MAX} caracteres`, () => {
    expect(isValidIdempotencyKey('a')).toBe(true);
    expect(isValidIdempotencyKey('a'.repeat(IDEMPOTENCY_KEY_MAX))).toBe(true);
  });

  it('rechaza una clave ausente, vacia o demasiado larga', () => {
    expect(isValidIdempotencyKey(undefined)).toBe(false);
    expect(isValidIdempotencyKey('')).toBe(false);
    expect(isValidIdempotencyKey('a'.repeat(IDEMPOTENCY_KEY_MAX + 1))).toBe(false);
  });

  it('claim no acepta una clave invalida', () => {
    const db = openDatabase(':memory:');
    expect(() => claim(db, '', () => ({ status: 202, operationId: null, body: {} }))).toThrow();
  });
});
