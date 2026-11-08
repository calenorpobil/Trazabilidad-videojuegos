import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, openDatabase, timestamp } from '../src/db.js';
import { ID_PREFIX } from '../src/contract.js';
import { newId } from '../src/ids.js';

const dir = mkdtempSync(join(tmpdir(), 'chain-db-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const tables = (db: ReturnType<typeof openDatabase>): string[] =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map(
    (r) => r.name,
  );

describe('openDatabase', () => {
  it('crea las cinco tablas y fija la version del esquema', () => {
    const db = openDatabase(':memory:');
    expect(tables(db)).toEqual(['collections', 'holders', 'idempotency', 'items', 'operations']);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('reabre un fichero existente sin tocar sus datos', () => {
    const path = join(dir, 'reabrir.db');
    const first = openDatabase(path);
    first.prepare("INSERT INTO collections VALUES ('col_a', 'chain-demo', 'Armeria', '2026-11-08T00:00:00Z')").run();
    first.close();
    const second = openDatabase(path);
    expect(second.prepare('SELECT COUNT(*) AS n FROM collections').get()).toEqual({ n: 1 });
    second.close();
  });

  it('se niega a abrir un esquema de una version desconocida', () => {
    const path = join(dir, 'futuro.db');
    const db = openDatabase(path);
    db.pragma('user_version = 99');
    db.close();
    expect(() => openDatabase(path)).toThrow(/version 99/);
  });

  it('rechaza un estado o un tipo de operacion que no existen', () => {
    const db = openDatabase(':memory:');
    const insert = db.prepare(
      "INSERT INTO operations (operation_id, kind, state, created_at, updated_at) VALUES ('opr_x', ?, ?, 't', 't')",
    );
    expect(() => insert.run('create_item', 'confirmed')).toThrow(/CHECK/);
    expect(() => insert.run('update_item', 'pending')).toThrow(/CHECK/);
  });

  it('no admite un failed sin error ni un error fuera de failed', () => {
    const db = openDatabase(':memory:');
    const insert = db.prepare(
      "INSERT INTO operations (operation_id, kind, state, error_code, created_at, updated_at) VALUES (?, 'grant', ?, ?, 't', 't')",
    );
    expect(() => insert.run('opr_1', 'failed', null)).toThrow(/CHECK/);
    expect(() => insert.run('opr_2', 'settled', 'INTERNAL')).toThrow(/CHECK/);
  });

  it('aplica las claves foraneas', () => {
    const db = openDatabase(':memory:');
    expect(() =>
      db
        .prepare("INSERT INTO idempotency VALUES ('k', 'opr_no_existe', 202, '{}', 't')")
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe('timestamp', () => {
  it('usa el formato del contrato, en UTC y sin milisegundos', () => {
    expect(timestamp(new Date('2026-10-11T09:30:00.123Z'))).toBe('2026-10-11T09:30:00Z');
  });
});

describe('newId', () => {
  it('lleva el prefijo de su tipo y 16 caracteres alfanumericos', () => {
    for (const kind of ['collection', 'item', 'operation'] as const) {
      expect(newId(kind)).toMatch(new RegExp(`^${ID_PREFIX[kind]}[0-9A-Za-z]{16}$`));
    }
  });

  it('no se repite', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId('operation')));
    expect(ids.size).toBe(1000);
  });
});
