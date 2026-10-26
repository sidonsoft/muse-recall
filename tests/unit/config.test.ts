import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, loadDotEnv, SERVICE_VERSION } from '../../apps/server/src/config.js';

describe('loadConfig', () => {
  it('applies local-first defaults', () => {
    const config = loadConfig({}, '/repo');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8787);
    expect(config.environment).toBe('development');
    expect(config.provider.kind).toBe('muse-cli');
    expect(config.provider.museModel).toBe('muse-wonder-1.0');
    expect(config.toolApprovalPolicy).toBe('always');
    expect(config.wal).toBe(true);
  });

  it('resolves relative paths against the supplied working directory', () => {
    const config = loadConfig({ DATABASE_PATH: './data/test.db' }, '/repo');
    expect(config.databasePath).toBe(resolve('/repo', 'data/test.db'));
    expect(config.workspaceRoot).toBe(resolve('/repo', 'workspaces'));
  });

  it('coerces numeric values from strings', () => {
    const config = loadConfig({ PORT: '9000', MUSE_TIMEOUT_MS: '5000' }, '/repo');
    expect(config.port).toBe(9000);
    expect(config.provider.museTimeoutMs).toBe(5_000);
  });

  it('splits and trims CORS origins, dropping blanks', () => {
    const config = loadConfig({ CORS_ORIGINS: ' http://a.test , http://b.test ,, ' }, '/repo');
    expect(config.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
  });

  it('names the offending variable when a value is invalid', () => {
    expect(() => loadConfig({ PORT: 'not-a-number' }, '/repo')).toThrow(/PORT/);
    expect(() => loadConfig({ MODEL_PROVIDER: 'openai' }, '/repo')).toThrow(/MODEL_PROVIDER/);
    expect(() => loadConfig({ MUSE_REASONING_EFFORT: 'turbo' }, '/repo')).toThrow(
      /MUSE_REASONING_EFFORT/,
    );
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadConfig({ PORT: '70000' }, '/repo')).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: '0' }, '/repo')).toThrow(/PORT/);
  });

  it('exposes a version that matches the package manifest', async () => {
    const manifest = (await import('../../package.json', { with: { type: 'json' } })).default as {
      version: string;
    };
    expect(SERVICE_VERSION).toBe(manifest.version);
  });
});

describe('loadDotEnv', () => {
  it('is a no-op when no .env file exists', () => {
    expect(() => loadDotEnv('/definitely/not/a/real/directory')).not.toThrow();
  });
});
