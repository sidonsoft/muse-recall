import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findEnvFile,
  loadConfig,
  loadDotEnv,
  SERVICE_VERSION,
} from '../../apps/server/src/config.js';

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

  it('resolves relative paths against the checkout root, not the package cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'mml-config-'));
    try {
      const nested = join(root, 'apps', 'server');
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');

      const config = loadConfig(
        { DATABASE_PATH: './data/test.db', WORKSPACE_ROOT: './ws' },
        nested,
      );
      expect(config.databasePath).toBe(resolve(root, 'data/test.db'));
      expect(config.workspaceRoot).toBe(resolve(root, 'ws'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to the supplied working directory when no workspace marker exists', () => {
    const config = loadConfig({ DATABASE_PATH: './data/test.db' }, '/repo');
    expect(config.databasePath).toBe(resolve('/repo', 'data/test.db'));
    expect(config.workspaceRoot).toBe(resolve('/repo', 'workspaces'));
  });

  it('coerces numeric values from strings', () => {
    const config = loadConfig({ PORT: '9000', MUSE_TIMEOUT_MS: '5000' }, '/repo');
    expect(config.port).toBe(9000);
    expect(config.provider.museTimeoutMs).toBe(5_000);
  });

  it('passes a configured chat API key to the provider without placing it in argv', () => {
    const config = loadConfig({ META_API_KEY: 'meta-key-12345' }, '/repo');
    expect(config.provider.apiKey).toBe('meta-key-12345');
  });

  it('wires the optional chat fallback into the provider config', () => {
    const withoutFallback = loadConfig({}, '/repo');
    expect(withoutFallback.provider.museFallbackApiKey).toBeUndefined();
    expect(withoutFallback.provider.museFallbackModel).toBeUndefined();

    const config = loadConfig(
      { MUSE_FALLBACK_API_KEY: 'fallback-key-12345', MUSE_FALLBACK_MODEL: 'muse-spark-1.3' },
      '/repo',
    );
    expect(config.provider.museFallbackApiKey).toBe('fallback-key-12345');
    expect(config.provider.museFallbackModel).toBe('muse-spark-1.3');
  });

  it('ignores MUSE_FALLBACK_MODEL when no fallback key is configured', () => {
    const config = loadConfig({ MUSE_FALLBACK_MODEL: 'muse-spark-1.3' }, '/repo');
    expect(config.provider.museFallbackApiKey).toBeUndefined();
    expect(config.provider.museFallbackModel).toBeUndefined();
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

  it('accepts loopback bind addresses', () => {
    expect(loadConfig({ HOST: 'localhost' }, '/repo').host).toBe('localhost');
    expect(loadConfig({ HOST: '::1' }, '/repo').host).toBe('::1');
  });

  it('refuses a non-loopback HOST because the API has no authentication', () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.20', 'muse.example.com']) {
      expect(() => loadConfig({ HOST: host }, '/repo')).toThrow(/HOST: must be a loopback address/);
    }
  });

  it('exposes a version that matches the package manifest', async () => {
    const manifest = (await import('../../package.json', { with: { type: 'json' } })).default as {
      version: string;
    };
    expect(SERVICE_VERSION).toBe(manifest.version);
  });
});

describe('loadDotEnv', () => {
  const created: string[] = [];

  afterEach(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
    delete process.env.MML_TEST_ENV_MARKER;
    delete process.env.MML_ENV_FILE;
  });

  function workspace(): string {
    const root = mkdtempSync(join(tmpdir(), 'mml-env-'));
    created.push(root);
    return root;
  }

  it('is a no-op when no .env file exists', () => {
    const missing = '/definitely/not/a/real/directory';
    expect(findEnvFile(missing, {})).toBeNull();
    expect(loadDotEnv(missing, {})).toBeNull();
  });

  it('finds the repository-root .env when run from a nested package', () => {
    const root = workspace();
    const nested = join(root, 'apps/server');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    writeFileSync(join(root, '.env'), 'MML_TEST_ENV_MARKER=from-root\n');

    expect(findEnvFile(nested, {})).toBe(resolve(root, '.env'));
    expect(loadDotEnv(nested, {})).toBe(resolve(root, '.env'));
    expect(process.env.MML_TEST_ENV_MARKER).toBe('from-root');
  });

  it('prefers the repository-root .env over a scoped one', () => {
    const root = workspace();
    const nested = join(root, 'apps/server');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    writeFileSync(join(root, '.env'), 'MML_TEST_ENV_MARKER=from-root\n');
    writeFileSync(join(nested, '.env'), 'MML_TEST_ENV_MARKER=from-package\n');

    expect(findEnvFile(nested, {})).toBe(resolve(root, '.env'));
    loadDotEnv(nested, {});
    expect(process.env.MML_TEST_ENV_MARKER).toBe('from-root');
  });

  it('falls back to a scoped .env when the checkout root has none', () => {
    const root = workspace();
    const nested = join(root, 'apps/server');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    writeFileSync(join(nested, '.env'), 'MML_TEST_ENV_MARKER=from-package\n');

    expect(findEnvFile(nested, {})).toBe(resolve(nested, '.env'));
    loadDotEnv(nested, {});
    expect(process.env.MML_TEST_ENV_MARKER).toBe('from-package');
  });

  it('uses INIT_CWD to find the checkout root from an unrelated cwd', () => {
    const root = workspace();
    const unrelated = workspace();
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    writeFileSync(join(root, '.env'), 'MML_TEST_ENV_MARKER=from-init-cwd\n');

    expect(findEnvFile(unrelated, { INIT_CWD: root })).toBe(resolve(root, '.env'));
    loadDotEnv(unrelated, { INIT_CWD: root });
    expect(process.env.MML_TEST_ENV_MARKER).toBe('from-init-cwd');
  });

  it('honours MML_ENV_FILE and rejects an explicit path that does not exist', () => {
    const root = workspace();
    const nested = join(root, 'apps/server');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, 'custom.env'), 'MML_TEST_ENV_MARKER=explicit\n');

    const env = { MML_ENV_FILE: resolve(root, 'custom.env') };
    expect(findEnvFile(nested, env)).toBe(resolve(root, 'custom.env'));
    loadDotEnv(nested, env);
    expect(process.env.MML_TEST_ENV_MARKER).toBe('explicit');

    expect(() => findEnvFile(nested, { MML_ENV_FILE: 'missing.env' })).toThrow(/MML_ENV_FILE/);
  });
});
