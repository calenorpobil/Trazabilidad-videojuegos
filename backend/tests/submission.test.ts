/**
 * Clasificacion de los fallos de la cadena en categorias del contrato (6). Los logs siguen el
 * formato del runtime (`"Program {} failed: {}"`, Agave, `stable_log.rs`).
 */
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import type { TransactionError } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { classifyFailure, failingProgram, SYSTEM_PROGRAM_ADDRESS } from '../src/submission.js';

const PROGRAM = '4SUNiKmyk4QtXhU2oNGn6uiXiSUevRdmXpZdRFXPeLNz';
const customOne: TransactionError = { InstructionError: [0, { Custom: 1 }] };

/** Logs de un fallo de `inner` dentro de `chain-assets`, por CPI. */
const nested = (inner: string) => [
  `Program ${PROGRAM} invoke [1]`,
  'Program log: Instruction: Transfer',
  `Program ${inner} invoke [2]`,
  `Program ${inner} failed: custom program error: 0x1`,
  `Program ${PROGRAM} consumed 9000 of 200000 compute units`,
  `Program ${PROGRAM} failed: custom program error: 0x1`,
];

describe('failingProgram', () => {
  it('devuelve el programa mas interno que fallo', () => {
    expect(failingProgram(nested(TOKEN_2022_PROGRAM_ADDRESS))).toBe(TOKEN_2022_PROGRAM_ADDRESS);
  });

  it('devuelve null si ningun programa fallo', () => {
    expect(failingProgram([`Program ${PROGRAM} invoke [1]`, `Program ${PROGRAM} success`])).toBeNull();
  });
});

describe('classifyFailure', () => {
  it('la autoridad sin fondos para la comision, la renta o sin cuenta es INSUFFICIENT_FUNDS', () => {
    for (const err of ['InsufficientFundsForFee', 'AccountNotFound', { InsufficientFundsForRent: { account_index: 0 } }]) {
      expect(classifyFailure(err as TransactionError, []).code).toBe('INSUFFICIENT_FUNDS');
    }
  });

  it('Custom 1 del programa de sistema (lamports) es INSUFFICIENT_FUNDS', () => {
    expect(classifyFailure(customOne, nested(SYSTEM_PROGRAM_ADDRESS)).code).toBe('INSUFFICIENT_FUNDS');
  });

  it('Custom 1 de Token-2022 (saldo) es INSUFFICIENT_BALANCE', () => {
    expect(classifyFailure(customOne, nested(TOKEN_2022_PROGRAM_ADDRESS)).code).toBe('INSUFFICIENT_BALANCE');
  });

  it('Custom 1 sin saber quien fallo, u otro codigo, es INTERNAL', () => {
    expect(classifyFailure(customOne, []).code).toBe('INTERNAL');
    expect(classifyFailure(customOne, nested(PROGRAM)).code).toBe('INTERNAL');
    expect(classifyFailure({ InstructionError: [0, { Custom: 6000 }] }, nested(PROGRAM)).code).toBe('INTERNAL');
    expect(classifyFailure({ InstructionError: [0, 'InvalidAccountData'] }, []).code).toBe('INTERNAL');
    expect(classifyFailure('AccountInUse', []).code).toBe('INTERNAL');
  });

  it('un blockhash desconocido es EXPIRED', () => {
    expect(classifyFailure('BlockhashNotFound', []).code).toBe('EXPIRED');
  });

  it('ningun mensaje nombra la cadena', () => {
    const errs: TransactionError[] = ['InsufficientFundsForFee', 'BlockhashNotFound', 'AccountInUse', customOne];
    for (const err of errs) {
      for (const logs of [[], nested(TOKEN_2022_PROGRAM_ADDRESS)]) {
        expect(classifyFailure(err, logs).message).not.toMatch(/solana|lamport|blockhash|token|mint/i);
      }
    }
  });
});
