import { describe, expect, it } from 'vitest';
import { OPERATION_STATES, OPERATION_TRANSITIONS, type OperationState } from '../src/contract.js';
import { openDatabase } from '../src/db.js';
import {
  InvalidTransitionError,
  OperationNotFoundError,
  createOperation,
  getOperation,
  recordSignature,
  transitionOperation,
} from '../src/operations.js';

const failure = { code: 'EXPIRED', message: 'la ventana de validez se agoto' } as const;

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
    db.prepare("UPDATE operations SET signature = 'firma' WHERE operation_id = ?").run(id);
    expect(Object.keys(getOperation(db, id) ?? {})).toEqual(['operation_id', 'state', 'error']);
  });
});

describe('paso, payload y firma (P11)', () => {
  const row = (db: ReturnType<typeof openDatabase>, id: string) =>
    db.prepare('SELECT step, payload, signature FROM operations WHERE operation_id = ?').get(id);

  it('nace en el paso 1, sin payload ni firma', () => {
    const { db, id } = operationIn('pending');
    expect(row(db, id)).toEqual({ step: 1, payload: null, signature: null });
  });

  it('guarda el payload como JSON', () => {
    const db = openDatabase(':memory:');
    const id = createOperation(db, 'create_item', { holder: 'x', amount: 3 });
    expect(JSON.parse((row(db, id) as { payload: string }).payload)).toEqual({ holder: 'x', amount: 3 });
  });

  it('registra la firma en pending', () => {
    const { db, id } = operationIn('pending');
    recordSignature(db, id, 'firma');
    expect(row(db, id)).toMatchObject({ signature: 'firma' });
  });

  it('no registra una firma fuera de pending ni en una operacion que no existe', () => {
    const { db, id } = operationIn('settled');
    expect(() => recordSignature(db, id, 'firma')).toThrow(InvalidTransitionError);
    expect(() => recordSignature(db, 'opr_nada', 'firma')).toThrow(OperationNotFoundError);
  });
});
