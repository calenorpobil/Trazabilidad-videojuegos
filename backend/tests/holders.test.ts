/**
 * Mapa de tenedores: `external_id` -> `holder_id` y direccion, registrado la primera vez. Los
 * valores son los vectores de `keys.test.ts`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db.js';
import { resolveHolder } from '../src/holders.js';

const KEYS = {
  masterSeed: Uint8Array.from(Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex')),
  gameId: 'test-game',
};
const PLAYER_42 = { holderId: 'hld_2LmEXGH9GXGjSmfF', address: '2LmEXGH9GXGjSmfFy7VY9E6nVXioH5R2bTvusCUbRWTq' };

let db: Db;
beforeEach(() => {
  db = openDatabase(':memory:');
});

const count = (): number => (db.prepare('SELECT count(*) AS n FROM holders').get() as { n: number }).n;

describe('resolveHolder', () => {
  it('un external_id nuevo se deriva y se registra', () => {
    expect(resolveHolder(db, KEYS, { external_id: 'player-42' })).toEqual(PLAYER_42);
    expect(db.prepare('SELECT external_id, address FROM holders WHERE holder_id = ?').get(PLAYER_42.holderId)).toEqual({
      external_id: 'player-42',
      address: PLAYER_42.address,
    });
  });

  it('resolver otra vez el mismo external_id no duplica la fila', () => {
    resolveHolder(db, KEYS, { external_id: 'player-42' });
    expect(resolveHolder(db, KEYS, { external_id: 'player-42' })).toEqual(PLAYER_42);
    expect(count()).toBe(1);
  });

  it('un holder_id registrado da el mismo tenedor', () => {
    resolveHolder(db, KEYS, { external_id: 'player-42' });
    expect(resolveHolder(db, KEYS, { holder_id: PLAYER_42.holderId })).toEqual(PLAYER_42);
  });

  it('un holder_id sin registrar es null, y no registra nada', () => {
    expect(resolveHolder(db, KEYS, { holder_id: PLAYER_42.holderId })).toBeNull();
    expect(count()).toBe(0);
  });

  it('un external_id invalido lanza y no registra nada', () => {
    expect(() => resolveHolder(db, KEYS, { external_id: '' })).toThrow();
    expect(count()).toBe(0);
  });
});
