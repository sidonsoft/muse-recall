import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import { codespacesWebOrigins } from '../../apps/server/src/codespaces.js';
import { loadConfig } from '../../apps/server/src/config.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

/**
 * A state-changing request from the web app as GitHub Codespaces delivers it.
 *
 * The forwarder rewrites the browser's `https://<codespace>-5173.app.github.dev`
 * request to `Host: localhost:5173` and `Origin: https://localhost:5173`; the
 * Vite dev proxy then passes both through to the API unchanged. The config is
 * loaded from the environment exactly as the server loads it.
 */

const CODESPACE_ENV = {
  CODESPACES: 'true',
  CODESPACE_NAME: 'judge-box-x5jx45',
  GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev',
};
const FORWARDED = { host: 'localhost:5173', origin: 'https://localhost:5173' };

const openApps: FastifyInstance[] = [];
const openDatabases: { close: () => void }[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  for (const database of openDatabases.splice(0)) database.close();
});

async function appFor(env: NodeJS.ProcessEnv): Promise<FastifyInstance> {
  const config = {
    ...loadConfig({ MODEL_PROVIDER: 'echo', LOG_LEVEL: 'silent', ...env }, '/repo'),
    databasePath: ':memory:',
    wal: false,
  };
  const database = openDatabase({ path: ':memory:', wal: false });
  openDatabases.push(database);
  const provider = new EchoProvider();
  const app = await buildApp({
    config,
    db: database.db,
    dbPath: ':memory:',
    provider,
    engine: new MemoryEngine(database.db),
    providerHealth: new ProviderHealthTracker(provider, 0),
  });
  openApps.push(app);
  return app;
}

function explain(app: FastifyInstance, headers: Record<string, string>) {
  return app.inject({
    method: 'POST',
    url: '/api/retrieval/preview',
    headers,
    payload: { project_id: null, query: 'which palette should the game use?' },
  });
}

describe('GitHub Codespaces forwarded requests', () => {
  it('accepts a retrieval explanation from the forwarded web app', async () => {
    const app = await appFor(CODESPACE_ENV);
    const response = await explain(app, FORWARDED);
    expect(response.statusCode, response.body).toBe(200);
  });

  it('accepts the browser origin if the forwarder passes it through', async () => {
    const app = await appFor(CODESPACE_ENV);
    const response = await explain(app, {
      host: 'localhost:5173',
      origin: 'https://judge-box-x5jx45-5173.app.github.dev',
    });
    expect(response.statusCode, response.body).toBe(200);
  });

  it('still rejects other codespaces, other ports and foreign sites', async () => {
    const app = await appFor(CODESPACE_ENV);
    for (const origin of [
      'https://someone-else-5173.app.github.dev',
      'https://judge-box-x5jx45-8787.app.github.dev',
      'https://localhost:9999',
      'https://evil.example',
    ]) {
      const response = await explain(app, { host: 'localhost:5173', origin });
      expect(response.statusCode, origin).toBe(403);
      expect(response.json().error.code, origin).toBe('forbidden_origin');
    }
  });

  it('does not trust the forwarded form outside a codespace', async () => {
    const app = await appFor({});
    const response = await explain(app, FORWARDED);
    expect(response.statusCode).toBe(403);
  });
});

describe('codespacesWebOrigins', () => {
  const local = ['http://127.0.0.1:5173', 'http://localhost:5173'];

  it('is empty outside a codespace', () => {
    expect(codespacesWebOrigins(local, {})).toEqual([]);
    expect(codespacesWebOrigins(local, { CODESPACES: 'false' })).toEqual([]);
  });

  it('derives one rewritten and one forwarded origin per local web port', () => {
    expect(codespacesWebOrigins(local, CODESPACE_ENV)).toEqual([
      'https://localhost:5173',
      'https://judge-box-x5jx45-5173.app.github.dev',
    ]);
  });

  it('works without the codespace name and ignores non-loopback origins', () => {
    expect(
      codespacesWebOrigins(['http://localhost:4173', 'http://example.com:5173'], {
        CODESPACES: 'true',
      }),
    ).toEqual(['https://localhost:4173']);
  });
});
