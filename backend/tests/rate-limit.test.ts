/**
 * Limite de tasa en ventana fija (P14, bloque W1), con un reloj falso.
 */
import { describe, expect, it } from 'vitest';
import { FixedWindowLimiter } from '../src/rate-limit.js';

function limiter(limit: number, windowMs = 60_000) {
  const clock = { t: 0 };
  return { clock, l: new FixedWindowLimiter({ limit, windowMs }, () => clock.t) };
}

describe('FixedWindowLimiter', () => {
  it('admite hasta el limite por clave y rechaza despues, con los segundos hasta la proxima ventana', () => {
    const { clock, l } = limiter(2);
    clock.t = 15_000;
    expect(l.take('a')).toEqual({ allowed: true });
    expect(l.take('a')).toEqual({ allowed: true });
    expect(l.take('a')).toEqual({ allowed: false, retryAfterSeconds: 45 });
    // Otra IP lleva su propia cuenta.
    expect(l.take('b')).toEqual({ allowed: true });
  });

  it('la ventana siguiente empieza de cero', () => {
    const { clock, l } = limiter(1);
    expect(l.take('a').allowed).toBe(true);
    expect(l.take('a').allowed).toBe(false);
    clock.t = 60_000;
    expect(l.take('a').allowed).toBe(true);
  });

  it('Retry-After nunca es 0', () => {
    const { clock, l } = limiter(1);
    clock.t = 59_999;
    l.take('a');
    expect(l.take('a')).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it('rechaza una configuracion sin sentido', () => {
    expect(() => new FixedWindowLimiter({ limit: 0, windowMs: 1000 })).toThrow();
    expect(() => new FixedWindowLimiter({ limit: 1, windowMs: 0 })).toThrow();
  });
});
