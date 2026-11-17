/**
 * Datos de demo: una colección y tres tipos, con su entrega inicial al jugador de la demo, creados por la
 * API del backend con el `write_key`. Es lo que haría una herramienta del estudio: el catálogo no lo crea
 * el juego (propuesta, revisión del 16 de noviembre de 2026). Sirve para probar y para las capturas; en el
 * vídeo, la creación se enseña desde la consola.
 *
 * **Repetible.** Cada escritura lleva una clave de idempotencia fija, `<etiqueta>:<qué>`. Ejecutarlo otra
 * vez devuelve lo ya creado sin duplicar nada (contrato, 3). Para otro juego de datos, otra etiqueta. Una
 * creación que acabó en `failed` no se repite con la misma etiqueta: el backend devuelve el fallo anterior.
 */

export interface DemoItem {
  readonly key: string;
  readonly name: string;
  readonly symbol: string;
  readonly qualities: Readonly<Record<string, string>>;
  readonly amount: number;
}

export const DEMO_COLLECTION = 'Armería de la demo';

export const DEMO_ITEMS: readonly DemoItem[] = [
  { key: 'sword', name: 'Espada de hierro', symbol: 'SWORD', qualities: { rarity: 'common', damage: '12' }, amount: 3 },
  { key: 'shield', name: 'Escudo de roble', symbol: 'SHIELD', qualities: { rarity: 'rare', defense: '8' }, amount: 2 },
  { key: 'potion', name: 'Poción de vida', symbol: 'POTION', qualities: { rarity: 'common', heal: '25' }, amount: 5 },
];

export interface SeedOptions {
  /** Base del backend, sin barra final. */
  readonly backendUrl: string;
  readonly writeKey: string;
  /** Si está, se espera a que cada creación llegue a `settled` o `failed`. */
  readonly readToken?: string;
  /** Prefijo de las claves de idempotencia. */
  readonly tag: string;
  /** Quién recibe la entrega inicial, por su `external_id`. */
  readonly player: string;
  readonly log: (line: string) => void;
  readonly pollMs?: number;
  readonly timeoutMs?: number;
}

export interface SeededItem {
  readonly name: string;
  readonly itemId: string;
  readonly operationId: string;
  /** Estado final, o `null` si no se esperó. */
  readonly state: string | null;
}

export class SeedError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function seedDemo(options: SeedOptions): Promise<{ collectionId: string; items: SeededItem[] }> {
  const base = options.backendUrl.replace(/\/+$/, '');
  const pollMs = options.pollMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 90_000;

  async function call(method: 'GET' | 'POST', path: string, token: string, key?: string, body?: object) {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (body !== undefined) headers['content-type'] = 'application/json; charset=utf-8';
    if (key !== undefined) headers['idempotency-key'] = key;
    const response = await fetch(base + path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: response.status, json, retryAfter: Number(response.headers.get('retry-after') ?? 0) };
  }

  async function write(path: string, key: string, body: object): Promise<Record<string, unknown>> {
    const r = await call('POST', path, options.writeKey, key, body);
    if (r.status < 200 || r.status >= 300 || r.json === null) {
      throw new SeedError(`${path}: HTTP ${r.status} ${JSON.stringify(r.json)}`);
    }
    return r.json;
  }

  /** Sondea hasta un estado final. Un 429 espera lo que diga `Retry-After`. */
  async function settle(operationId: string, readToken: string): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const r = await call('GET', `/v1/operations/${encodeURIComponent(operationId)}`, readToken);
      if (r.status === 429) {
        await sleep(Math.max(r.retryAfter * 1000, pollMs));
        continue;
      }
      if (r.status !== 200 || r.json === null) throw new SeedError(`operación ${operationId}: HTTP ${r.status}`);
      const state = r.json['state'];
      if (state === 'settled' || state === 'failed') return state;
      await sleep(pollMs);
    }
    throw new SeedError(`operación ${operationId}: sin estado final en ${Math.round(timeoutMs / 1000)} s`);
  }

  const collection = await write('/v1/collections', `${options.tag}:collection`, { name: DEMO_COLLECTION });
  const collectionId = String(collection['collection_id']);
  options.log(`colección «${DEMO_COLLECTION}»: ${collectionId}`);

  const items: SeededItem[] = [];
  for (const item of DEMO_ITEMS) {
    const created = await write('/v1/items', `${options.tag}:${item.key}`, {
      collection_id: collectionId,
      name: item.name,
      symbol: item.symbol,
      uri: '',
      qualities: item.qualities,
      initial_grant: { holder: { external_id: options.player }, amount: item.amount },
    });
    const itemId = String(created['item_id']);
    const operationId = String(created['operation_id']);
    const state = options.readToken === undefined ? null : await settle(operationId, options.readToken);
    options.log(`${item.amount} × ${item.name} para ${options.player}: ${itemId} (${operationId}${state === null ? '' : `, ${state}`})`);
    items.push({ name: item.name, itemId, operationId, state });
  }
  return { collectionId, items };
}
