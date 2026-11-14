/**
 * Limite de tasa por IP, en ventana fija y en memoria (P14, bloque W1).
 *
 * El `read_token` viaja en el binario del juego y es publico de facto (contrato, 2; propuesta,
 * 12.5): todos los jugadores lo comparten, asi que limitar por token no serviria de nada. Se limita
 * por la IP de origen. Tambien se usa en la entrada a la consola, contra la fuerza bruta.
 *
 * Ventana fija, no deslizante: lo mas simple que acota la tasa. En el peor caso, en el cambio de
 * ventana pasan el doble de peticiones; para proteger el nodo de la red y SQLite basta. El mapa se
 * vacia al empezar cada ventana, de modo que la memoria queda acotada por las IPs de una ventana.
 *
 * Un solo proceso y sin estado compartido: con varias replicas, cada una lleva su cuenta. Detras de
 * un proxy, la IP es la del proxy salvo que se configure `trustProxy` en fastify (no se hace: por
 * defecto el backend escucha en 127.0.0.1).
 */

export interface RateLimit {
  /** Peticiones admitidas por clave y ventana. */
  readonly limit: number;
  readonly windowMs: number;
}

export type Verdict = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

export class FixedWindowLimiter {
  private window = -1;
  private readonly counts = new Map<string, number>();

  constructor(
    private readonly config: RateLimit,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(config.limit) || config.limit < 1) throw new Error('el limite debe ser un entero >= 1');
    if (!Number.isInteger(config.windowMs) || config.windowMs < 1) throw new Error('la ventana debe ser un entero >= 1');
  }

  /** Cuenta una peticion de `key` y dice si cabe en la ventana actual. */
  take(key: string): Verdict {
    const at = this.now();
    const window = Math.floor(at / this.config.windowMs);
    if (window !== this.window) {
      this.window = window;
      this.counts.clear();
    }
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    if (count <= this.config.limit) return { allowed: true };
    const resetAt = (window + 1) * this.config.windowMs;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((resetAt - at) / 1000)) };
  }
}
