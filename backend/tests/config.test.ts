import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, seedFilePermissionsOk } from '../src/config.js';

const SEED = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

const common = {
  CHAIN_GAME_ID: 'chain-demo',
  CHAIN_WRITE_KEY: 'w'.repeat(32),
  CHAIN_READ_TOKEN: 'r'.repeat(32),
};
const base = { ...common, CHAIN_MASTER_SEED: SEED };

const dir = mkdtempSync(join(tmpdir(), 'chain-config-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('loadConfig', () => {
  it('lee la configuracion minima y aplica los valores por defecto', () => {
    const c = loadConfig(base);
    expect(c.gameId).toBe('chain-demo');
    expect(Buffer.from(c.masterSeed).toString('hex')).toBe(SEED);
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(8787);
    expect(c.databasePath).toBe('chain.db');
    expect(c.rpcUrl).toBe('https://api.devnet.solana.com');
  });

  it('acepta otro nodo http(s) y rechaza lo que no es una URL', () => {
    expect(loadConfig({ ...base, CHAIN_RPC_URL: 'http://127.0.0.1:8899' }).rpcUrl).toBe('http://127.0.0.1:8899');
    expect(() => loadConfig({ ...base, CHAIN_RPC_URL: 'devnet' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, CHAIN_RPC_URL: 'ftp://x.test' })).toThrow(ConfigError);
  });

  it('lee la semilla de un fichero, admitiendo un salto de linea final', () => {
    const path = join(dir, 'ok.seed');
    writeFileSync(path, `${SEED}\n`);
    chmodSync(path, 0o600);
    const c = loadConfig({ ...common, CHAIN_MASTER_SEED_FILE: path });
    expect(Buffer.from(c.masterSeed).toString('hex')).toBe(SEED);
  });

  it('exige exactamente una via para la semilla', () => {
    expect(() => loadConfig(common)).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, CHAIN_MASTER_SEED_FILE: 'x.seed' })).toThrow(ConfigError);
  });

  it('rechaza una semilla mal formada sin repetirla en el mensaje', () => {
    const bad = 'zz'.repeat(32);
    let message = '';
    try {
      loadConfig({ ...base, CHAIN_MASTER_SEED: bad });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('CHAIN_MASTER_SEED');
    expect(message).not.toContain(bad);
  });

  it('rechaza un fichero de semilla que no existe', () => {
    expect(() => loadConfig({ ...common, CHAIN_MASTER_SEED_FILE: join(dir, 'no-existe') })).toThrow(ConfigError);
  });

  it('rechaza un game_id fuera de formato', () => {
    expect(() => loadConfig({ ...base, CHAIN_GAME_ID: 'Chain_Demo' })).toThrow(ConfigError);
  });

  it('rechaza credenciales cortas o iguales entre si', () => {
    expect(() => loadConfig({ ...base, CHAIN_WRITE_KEY: 'corta' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, CHAIN_READ_TOKEN: base.CHAIN_WRITE_KEY })).toThrow(ConfigError);
  });

  it('rechaza un puerto fuera de rango', () => {
    expect(() => loadConfig({ ...base, CHAIN_PORT: '70000' })).toThrow(ConfigError);
  });
});

describe('permisos del fichero de semilla', () => {
  it('en POSIX exige que ni el grupo ni otros puedan leerlo', () => {
    expect(seedFilePermissionsOk(0o100600, 'linux')).toBe(true);
    expect(seedFilePermissionsOk(0o100400, 'linux')).toBe(true);
    expect(seedFilePermissionsOk(0o100640, 'linux')).toBe(false);
    expect(seedFilePermissionsOk(0o100644, 'darwin')).toBe(false);
  });

  it('en Windows no comprueba los bits de modo, que no reflejan los permisos reales', () => {
    expect(seedFilePermissionsOk(0o100666, 'win32')).toBe(true);
  });

  it('rechaza al cargar un fichero legible por otros en POSIX', () => {
    const path = join(dir, 'abierto.seed');
    writeFileSync(path, SEED);
    chmodSync(path, 0o644);
    const env = { ...common, CHAIN_MASTER_SEED_FILE: path };
    if (process.platform === 'win32') {
      expect(() => loadConfig(env)).not.toThrow();
    } else {
      expect(() => loadConfig(env)).toThrow(/0600/);
    }
  });
});
