import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  ERROR_RETRYABLE,
  ID_PREFIX,
  OPERATION_STATES,
  OPERATION_TRANSITIONS,
  errorBody,
} from '../src/contract.js';

describe('contrato congelado', () => {
  it('tiene exactamente los cuatro estados del apartado 7', () => {
    expect(OPERATION_STATES).toEqual(['pending', 'applied', 'settled', 'failed']);
  });

  it('permite applied -> failed, que es la transicion que justifica los dos estados', () => {
    expect(OPERATION_TRANSITIONS.applied).toContain('failed');
    expect(OPERATION_TRANSITIONS.applied).toContain('settled');
  });

  it('no deja salir de un estado terminal', () => {
    expect(OPERATION_TRANSITIONS.settled).toEqual([]);
    expect(OPERATION_TRANSITIONS.failed).toEqual([]);
  });

  it('declara reintentabilidad y codigo HTTP para cada categoria de error', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_RETRYABLE, code).toHaveProperty(code);
      expect(ERROR_HTTP_STATUS, code).toHaveProperty(code);
    }
  });

  it('mantiene fuera de HTTP las categorias que solo produce el addon', () => {
    expect(ERROR_HTTP_STATUS.CONFIG).toBeNull();
    expect(ERROR_HTTP_STATUS.NETWORK).toBeNull();
    expect(ERROR_HTTP_STATUS.EXPIRED).toBeNull();
  });

  it('construye el cuerpo de error con la reintentabilidad del contrato', () => {
    expect(errorBody('INSUFFICIENT_BALANCE', 'sin unidades')).toEqual({
      code: 'INSUFFICIENT_BALANCE',
      message: 'sin unidades',
      retryable: false,
    });
    expect(errorBody('INSUFFICIENT_FUNDS', 'sin saldo operativo').retryable).toBe(true);
  });

  it('usa prefijos distintos y con guion bajo para cada tipo de identificador', () => {
    const prefixes = Object.values(ID_PREFIX);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const prefix of prefixes) {
      expect(prefix).toMatch(/^[a-z]{3}_$/);
    }
  });
});
