import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import type { AppConfig } from '../../apps/server/src/config.js';
import { SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

/**
 * Adversarial boundary suite (roadmap §5 release criterion for remote access).
 * Where the per-guard tests (host-guard, origin-guard, access-token) verify
 * each layer in isolation, this file attacks the composed HTTP surface the
 * way an adversary would: layered spoofing, route-casing and path-slash
 * evasion around the auth exemption, malformed Authorization shapes, and
 * header-injection attempts. Every expectation states which layer must
 * refuse first — the order itself is part of the contract (D045).
 */

const openApps: FastifyInstance[] = [];
const openDatabases: { close: () => void }[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  for (const database of openDatabases.splice(0)) database.close();
});

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    corsOrigins: [],
    databasePath: ':memory:',
    wal: false,
    workspaceRoot: '/tmp/mml-workspaces',
    toolApprovalPolicy: 'always',
    provider: { kind: 'echo' },
    memoryBudget: { max_memories: 8, max_characters: 4_000, max_memory_characters: 1_000 },
    sweepOnStart: true,
    agent: {
      budgets: {
        max_history_messages: 8,
        max_history_characters: 6_000,
        max_memory_characters: 4_000,
        max_prompt_characters: 24_000,
        max_message_characters: 8_000,
        max_correction_history: 3,
      },
      autoCapture: 'suggest',
      includeCorrectionHistory: true,
      maxOutputTokens: 1_200,
      tools: { enabled: false, approvalPolicy: 'always', maxCallsPerTurn: 3, decisionMode: 'off' },
    },
    serviceVersion: SERVICE_VERSION,
    ...overrides,
  };
}

async function appWith(overrides: Partial<AppConfig> = {}): Promise<FastifyInstance> {
  const database = openDatabase({ path: ':memory:', wal: false });
  openDatabases.push(database);
  const provider = new EchoProvider();
  const app = await buildApp({
    config: testConfig(overrides),
    db: database.db,
    dbPath: ':memory:',
    provider,
    engine: new MemoryEngine(database.db),
    providerHealth: new ProviderHealthTracker(provider, 0),
  });
  openApps.push(app);
  return app;
}

const LOOPBACK = '127.0.0.1:8787';
const TOKEN = 'adversarial-suite-secret-0123456789';
const AUTH = { authorization: `Bearer ${TOKEN}` };
const MEMORY_BODY = {
  type: 'contextual_fact',
  scope: 'global',
  content: 'an adversarial probe payload',
};

describe('adversarial boundary suite (§5 release criterion)', () => {
  describe('loopback beta (no token)', () => {
    it('a fully consistent Host+Origin spoof pair is refused by the host guard (400)', async () => {
      const app = await appWith();
      const response = await app.inject({
        method: 'POST',
        url: '/api/memories',
        headers: { host: 'evil.example', origin: 'http://evil.example' },
        payload: MEMORY_BODY,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('invalid_host');
    });

    it('route-casing evasion cannot get past the guards before routing', async () => {
      const app = await appWith();
      const response = await app.inject({
        method: 'POST',
        url: '/API/memories',
        headers: { host: 'evil.example', origin: 'http://evil.example' },
        payload: MEMORY_BODY,
      });
      // Guard hooks run before route resolution: refused, not a 404 that
      // would prove the request reached the routing layer at all.
      expect(response.statusCode).toBe(400);
      const list = await app.inject({
        method: 'GET',
        url: '/api/memories',
        headers: { host: LOOPBACK },
      });
      expect(list.json().data.items).toHaveLength(0);
    });

    it('X-Forwarded-Host does not launder a cross-origin mutation', async () => {
      const app = await appWith();
      const response = await app.inject({
        method: 'POST',
        url: '/api/memories',
        headers: {
          host: LOOPBACK,
          origin: 'http://evil.example',
          'x-forwarded-host': LOOPBACK,
          'x-forwarded-proto': 'http',
        },
        payload: MEMORY_BODY,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('forbidden_origin');
    });

    it('Sec-Fetch-Site: cross-site with the Origin header stripped is still refused', async () => {
      const app = await appWith();
      const response = await app.inject({
        method: 'POST',
        url: '/api/memories',
        headers: { host: LOOPBACK, 'sec-fetch-site': 'cross-site' },
        payload: MEMORY_BODY,
      });
      expect(response.statusCode).toBe(403);
    });

    it('safe methods stay answerable to foreign origins without changing state (documented posture)', async () => {
      const app = await appWith();
      const read = await app.inject({
        method: 'GET',
        url: '/api/memories',
        headers: { host: LOOPBACK, origin: 'http://evil.example' },
      });
      expect(read.statusCode).toBe(200);
      const options = await app.inject({
        method: 'OPTIONS',
        url: '/api/memories',
        headers: { host: LOOPBACK, origin: 'http://evil.example' },
      });
      // OPTIONS is not state-changing per the guard (404 from Fastify is
      // fine; the contract is "never a mutation behind the guard's back").
      expect(options.statusCode).not.toBe(403);
    });
  });

  describe('token mode (shared bearer, port 8787)', () => {
    it('path-shape evasion cannot slip past the health exemption', async () => {
      const app = await appWith({ port: 8787, accessToken: TOKEN });
      const queries: Array<[string, string]> = [
        ['GET', '/api/HEALTH'],
        ['GET', '/api/health/'],
        ['POST', '/api/health'],
      ];
      for (const [method, url] of queries) {
        const response = await app.inject({ method, url, headers: { host: LOOPBACK } });
        expect(response.statusCode, `${method} ${url}`).toBe(401);
      }
      // Normalization to the SAME exempt route is the honest outcome — it is
      // the documented health endpoint, not a second open one.
      const normalized = await app.inject({
        method: 'GET',
        url: '/api/health/../health',
        headers: { host: LOOPBACK },
      });
      expect(normalized.statusCode).toBe(200);
      const open = await app.inject({
        method: 'GET',
        url: '/api/health?next=/api/memories',
        headers: { host: LOOPBACK },
      });
      expect(open.statusCode).toBe(200);
    });

    it('malformed Authorization shapes all 401 with a challenge', async () => {
      const app = await appWith({ port: 8787, accessToken: TOKEN });
      const shapes: Array<string | string[]> = [
        'bearer ' + TOKEN, // wrong case: exact-match contract (D045)
        'Basic ' + TOKEN,
        'Bearer  ' + TOKEN, // extra space
        `Bearer ${TOKEN}x`,
        // Headers are not URL-decoded; an equivalent-looking encoding is a
        // different secret, and the digest comparison must refuse it.
        `Bearer ${TOKEN.replace(/-/g, '%2D')}`,
        TOKEN,
        // What Node hands a handler when a client sends two Authorization
        // headers on the wire: one comma-joined string (inject cannot send
        // real duplicates) — the digest comparison must refuse it.
        `Bearer ${TOKEN}, Bearer other`,
        [],
      ];
      for (const header of shapes) {
        const response = await app.inject({
          method: 'GET',
          url: '/api/memories',
          headers: { host: LOOPBACK, authorization: header },
        });
        expect(response.statusCode, JSON.stringify(header)).toBe(401);
        expect(response.headers['www-authenticate']).toBe('Bearer');
      }
    });

    it('a valid token never overrides the host guard: wrong port is 400 even authenticated', async () => {
      const app = await appWith({ port: 8787, accessToken: TOKEN });
      const wrongPort = await app.inject({
        method: 'GET',
        url: '/api/memories',
        headers: { host: 'evil.example:9999', ...AUTH },
      });
      expect(wrongPort.statusCode).toBe(400);
      expect(wrongPort.json().error.code).toBe('invalid_host');
      const loopbackWrongPort = await app.inject({
        method: 'GET',
        url: '/api/memories',
        headers: { host: '127.0.0.1:9999', ...AUTH },
      });
      expect(loopbackWrongPort.statusCode).toBe(400);
    });

    it('a token is not a CSRF clearance: cross-origin mutations still 403 after 200-worthy auth', async () => {
      const app = await appWith({ port: 8787, accessToken: TOKEN });
      const crossOrigin = await app.inject({
        method: 'POST',
        url: '/api/memories',
        headers: { host: LOOPBACK, origin: 'http://evil.example', ...AUTH },
        payload: MEMORY_BODY,
      });
      expect(crossOrigin.statusCode).toBe(403);
      const sameOrigin = await app.inject({
        method: 'POST',
        url: '/api/memories',
        headers: { host: LOOPBACK, ...AUTH },
        payload: MEMORY_BODY,
      });
      expect(sameOrigin.statusCode).toBe(201);
    });

    it('responses never echo the token, and meta reports the active trust model honestly', async () => {
      const app = await appWith({ port: 8787, accessToken: TOKEN });
      const meta = await app.inject({
        method: 'GET',
        url: '/api/meta',
        headers: { host: LOOPBACK, ...AUTH },
      });
      expect(meta.statusCode).toBe(200);
      expect(meta.body).not.toContain(TOKEN);
      expect(meta.json().data.safety.authentication).toBe('shared-token');
      const failure = await app.inject({
        method: 'GET',
        url: '/api/memories',
        headers: { host: LOOPBACK, authorization: 'Bearer nope-not-the-token-0000000000' },
      });
      expect(failure.body).not.toContain(TOKEN);
    });

    it('token mode keeps the D045 posture: arbitrary Host NAMES are accepted only with the secret AND correct port', async () => {
      const app = await appWith({ port: 8787, accessToken: TOKEN });
      const rebindingNoAuth = await app.inject({
        method: 'GET',
        url: '/api/memories',
        headers: { host: 'attacker-rebind.example:8787' },
      });
      expect(rebindingNoAuth.statusCode).toBe(401);
      const rebindingWithAuth = await app.inject({
        method: 'POST',
        url: '/api/memories',
        headers: { host: 'attacker-rebind.example:8787', ...AUTH },
        payload: MEMORY_BODY,
      });
      // Accepted by design: DNS-rebinding cannot attach the secret, and the
      // port still pins the configured API surface. Recorded so a future
      // regression that drops the port check in token mode is caught.
      expect(rebindingWithAuth.statusCode).toBe(201);
    });
  });
});
