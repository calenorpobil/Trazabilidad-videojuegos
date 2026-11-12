import { describe, expect, it } from 'vitest';
import { OPERATION_STATES, OPERATION_TRANSITIONS, type OperationState } from '../src/contract.js';
import { openDatabase } from '../src/db.js';
import {
  InvalidTransitionError,
  OperationNotFoundError,
  createOperation,
  getOperation,
  openOperations,
  recordSignature,
  transitionOperation,
} from '../src/operations.js';

const failure = { code: 'EXPIRED', message: 'la ventana de validez se agoto' } as const;
const SUBMISSION = { signature: 'firma', lastValidBlockHeight: 300_000_123n };

/** Lleva una operacion nueva hasta `state` por el camino mas corto. */
function operationIn(state: OperationState) {
  const db = openDatabase(':memory:');
  const id = createOperation(db, 'grant');
  if (state === 'applied' || state === 'settled') transitionOperation(db, id, 'applied');
  if (state === 'settled') transitionOperation(db, id, 'settled');
  if (state === 'failed') transitionOperation(db, id, 'failed', failure);
  return { db, id };
}

describe('maquina de estados de una operacion', () => {
  it('nace en pending y sin error', () => {
    const { db, id } = operationIn('pending');
    expect(getOperation(db, id)).toEqual({ operation_id: id, state: 'pending', error: null });
  });

  it('recorre el camino feliz pending -> applied -> settled', () => {
    const { db, id } = operationIn('settled');
    expect(getOperation(db, id)?.state).toBe('settled');
  });

  it('admite applied -> failed: una transaccion confirmada puede desaparecer', () => {
    const { db, id } = operationIn('applied');
    transitionOperation(db, id, 'failed', failure);
    expect(getOperation(db, id)).toEqual({
      operation_id: id,
      state: 'failed',
      error: { code: 'EXPIRED', message: failure.message, retryable: true },
    });
  });

  // Recorre la tabla entera: cada salto permitido funciona y cada salto prohibido se rechaza.
  for (const from of OPERATION_STATES) {
    for (const to of OPERATION_STATES) {
      const allowed = OPERATION_TRANSITIONS[from].includes(to);
      it(`${from} -> ${to} ${allowed ? 'se permite' : 'se rechaza'}`, () => {
        const { db, id } = operationIn(from);
        const move = () => transitionOperation(db, id, to, to === 'failed' ? failure : undefined);
        if (allowed) {
          move();
          expect(getOperation(db, id)?.state).toBe(to);
        } else {
          expect(move).toThrow(InvalidTransitionError);
          expect(getOperation(db, id)?.state).toBe(from);
        }
      });
    }
  }

  it('failed exige un error, y los demas estados no lo admiten', () => {
    const { db, id } = operationIn('pending');
    expect(() => transitionOperation(db, id, 'failed')).toThrow(InvalidTransitionError);
    expect(() => transitionOperation(db, id, 'applied', failure)).toThrow(InvalidTransitionError);
    expect(getOperation(db, id)?.state).toBe('pending');
  });

  it('distingue una operacion inexistente de un salto prohibido', () => {
    const db = openDatabase(':memory:');
    expect(() => transitionOperation(db, 'opr_no_existe', 'applied')).toThrow(OperationNotFoundError);
    expect(getOperation(db, 'opr_no_existe')).toBeNull();
  });

  it('no expone la firma ni datos de red en la vista del contrato', () => {
    const { db, id } = operationIn('applied');
    db.prepare("UPDATE operations SET signature = 'firma', last_valid_block_height = 1 WHERE operation_id = ?").run(id);
    expect(Object.keys(getOperation(db, id) ?? {})).toEqual(['operation_id', 'state', 'error']);
  });
});

describe('paso, payload, firma y altura de validez (P11 y P13)', () => {
  const row = (db: ReturnType<typeof openDatabase>, id: string) =>
    db
      .prepare('SELECT step, payload, signature, last_valid_block_height AS lvbh FROM operations WHERE operation_id = ?')
      .get(id);

  it('nace en el paso 1, sin payload, firma ni altura', () => {
    const { db, id } = operationIn('pending');
    expect(row(db, id)).toEqual({ step: 1, payload: null, signature: null, lvbh: null });
  });

  it('guarda el payload como JSON', () => {
    const db = openDatabase(':memory:');
    const id = createOperation(db, 'create_item', { holder: 'x', amount: 3 });
    expect(JSON.parse((row(db, id) as { payload: string }).payload)).toEqual({ holder: 'x', amount: 3 });
  });

  it('registra la firma en pending con la altura hasta la que vale', () => {
    const { db, id } = operationIn('pending');
    recordSignature(db, id, SUBMISSION);
    expect(row(db, id)).toMatchObject({ step: 1, signature: 'firma', lvbh: 300_000_123 });
  });

  it('el paso 2 sustituye la firma y la altura y vacia el payload', () => {
    const db = openDatabase(':memory:');
    const id = createOperation(db, 'create_item', { holder: 'x', amount: 3 });
    recordSignature(db, id, SUBMISSION);
    recordSignature(db, id, { signature: 'firma-2', lastValidBlockHeight: 300_000_456n }, 2);
    expect(row(db, id)).toEqual({ step: 2, payload: null, signature: 'firma-2', lvbh: 300_000_456 });
  });

  it('una firma sin altura, o una altura sin firma, no se pueden guardar', () => {
    const { db, id } = operationIn('pending');
    const set = (sql: string) => () => db.prepare(`UPDATE operations SET ${sql} WHERE operation_id = ?`).run(id);
    expect(set("signature = 'firma'")).toThrow(/CHECK/);
    expect(set('last_valid_block_height = 1')).toThrow(/CHECK/);
  });

  it('no registra una firma fuera de pending ni en una operacion que no existe', () => {
    const { db, id } = operationIn('settled');
    expect(() => recordSignature(db, id, SUBMISSION)).toThrow(InvalidTransitionError);
    expect(() => recordSignature(db, 'opr_nada', SUBMISSION)).toThrow(OperationNotFoundError);
  });
});

describe('openOperations', () => {
  it('lista las pending y applied con firma, y nada mas', () => {
    const db = openDatabase(':memory:');
    const withSignature = (state: OperationState, payload: unknown = null) => {
      const id = createOperation(db, 'create_item', payload);
      recordSignature(db, id, SUBMISSION);
      if (state !== 'pending') transitionOperation(db, id, state === 'failed' ? 'failed' : 'applied', state === 'failed' ? failure : undefined);
      if (state === 'settled') transitionOperation(db, id, 'settled');
      return id;
    };
    const pending = withSignature('pending', { holder: 'x', amount: 3 });
    const applied = withSignature('applied');
    withSignature('settled');
    withSignature('failed');
    createOperation(db, 'transfer'); // sin firma: aun no reclamada del todo, no se sigue

    expect(openOperations(db)).toEqual([
      {
        operationId: pending,
        kind: 'create_item',
        state: 'pending',
        step: 1,
        payload: { holder: 'x', amount: 3 },
        signature: 'firma',
        lastValidBlockHeight: 300_000_123n,
      },
      expect.objectContaining({ operationId: applied, state: 'applied', payload: null }),
    ]);
  });
});
