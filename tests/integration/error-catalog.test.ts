import { randomUUID } from 'node:crypto';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import type { ErrorCatalog, ModelRequest } from '@mml/shared';
import { ERROR_CATALOG_VERSION } from '@mml/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import type { AppConfig } from '../../apps/server/src/config.js';
import { SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

/** The part of an inject response a catalogue probe is judged on. */
type ErrorProbe = {
  statusCode: number;
  json(): { error?: { code?: string } };
};

/**
 * The machine-readable error catalogue (roadmap §3 remainder) must MIRROR the
 * server's real mappings — so every probe here compares a live response
 * against the published entry. If a mapping drifts without the catalogue, this
 * suite goes red; if a known asymmetry is fixed, the catalogue entry moves in
 * the same PR and these tests follow.
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
    port: 8787,
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
const TOKEN = 'catalog-probe-secret-0123456789';

describe('machine-readable error catalogue (GET /api/errors)', () => {
  it('publishes a versioned catalogue with well-formed, unique entries per group', async () => {
    const app = await appWith();
    const response = await app.inject({
      method: 'GET',
      url: '/api/errors',
      headers: { host: LOOPBACK },
    });
    expect(response.statusCode).toBe(200);
    const catalog = response.json().data as ErrorCatalog;
    expect(catalog.catalog_version).toBe(ERROR_CATALOG_VERSION);
    const groups = Object.entries(catalog.groups);
    expect(groups.length).toBe(5);
    for (const [name, entries] of groups) {
      expect(entries.length, name).toBeGreaterThan(0);
      const codes = entries.map((entry) => entry.code);
      expect(new Set(codes).size, `duplicate codes in ${name}`).toBe(codes.length);
      for (const entry of entries) {
        expect(entry.http_status).toBeGreaterThanOrEqual(400);
        expect(entry.when.length).toBeGreaterThan(10);
      }
    }
  });

  it('live responses match their published entries: code AND status (drift gate)', async () => {
    const app = await appWith();
    const catalog = (
      await app.inject({ method: 'GET', url: '/api/errors', headers: { host: LOOPBACK } })
    ).json().data as ErrorCatalog;
    const entryFor = (code: string) =>
      Object.values(catalog.groups)
        .flatMap((entries) => entries)
        .find((e) => e.code === code);

    const probes: Array<{
      code: string;
      run: () => Promise<ErrorProbe>;
    }> = [
      {
        code: 'invalid_host',
        run: () =>
          app.inject({
            method: 'POST',
            url: '/api/memories',
            headers: { host: 'evil.example' },
            payload: { type: 'contextual_fact', scope: 'global', content: 'x' },
          }),
      },
      {
        code: 'forbidden_origin',
        run: () =>
          app.inject({
            method: 'POST',
            url: '/api/memories',
            headers: { host: LOOPBACK, origin: 'http://evil.example' },
            payload: { type: 'contextual_fact', scope: 'global', content: 'x' },
          }),
      },
      {
        code: 'not_found',
        run: () => app.inject({ method: 'GET', url: '/api/nope', headers: { host: LOOPBACK } }),
      },
      {
        code: 'validation_failed',
        run: () =>
          app.inject({
            method: 'POST',
            url: '/api/memories',
            headers: { host: LOOPBACK },
            payload: { nope: true },
          }),
      },
      {
        // Catalogue v2: a write that fails BELOW the domain layer answers 5xx
        // under a stable code — proven by closing the connection out from
        // under a live app, the classic half-dead storage state.
        code: 'memory_storage_failed',
        run: async () => {
          const database = openDatabase({ path: ':memory:', wal: false });
          try {
            const broken = new EchoProvider();
            const appUnderTest = await buildApp({
              config: testConfig(),
              db: database.db,
              dbPath: ':memory:',
              provider: broken,
              engine: new MemoryEngine(database.db),
              providerHealth: new ProviderHealthTracker(broken, 0),
            });
            openApps.push(appUnderTest);
            // Closed deliberately and NOT registered with afterEach: the
            // double-close itself would be a false alarm.
            database.close();
            return await appUnderTest.inject({
              method: 'POST',
              url: '/api/memories',
              headers: { host: LOOPBACK },
              payload: { type: 'contextual_fact', scope: 'global', content: 'storage probe' },
            });
          } finally {
            try {
              database.close();
            } catch {
              // already closed — expected
            }
          }
        },
      },
    ];
    for (const probe of probes) {
      const response = await probe.run();
      const entry = entryFor(probe.code);
      expect(entry, `catalogue is missing ${probe.code}`).toBeDefined();
      expect(response.json().error?.code, probe.code).toBe(probe.code);
      expect(response.statusCode, probe.code).toBe(entry?.http_status);
    }
  });

  it('unauthorized in token mode matches its entry too', async () => {
    const app = await appWith({ accessToken: TOKEN });
    const catalog = (
      await app.inject({
        method: 'GET',
        url: '/api/errors',
        headers: { host: LOOPBACK, authorization: `Bearer ${TOKEN}` },
      })
    ).json().data as ErrorCatalog;
    const live = await app.inject({
      method: 'GET',
      url: '/api/memories',
      headers: { host: LOOPBACK },
    });
    expect(live.statusCode).toBe(401);
    expect(live.json().error.code).toBe('unauthorized');
    const entry = Object.values(catalog.groups)
      .flatMap((entries) => entries)
      .find((e) => e.code === 'unauthorized');
    expect(entry?.http_status).toBe(401);
  });

  it('meta points at the catalogue so discovery needs no docs', async () => {
    const app = await appWith();
    const meta = await app.inject({ method: 'GET', url: '/api/meta', headers: { host: LOOPBACK } });
    expect(meta.json().data.errors).toEqual({
      catalog_version: ERROR_CATALOG_VERSION,
      endpoint: '/api/errors',
    });
  });
});

/**
 * Catalogue v3 lockstep (KI-43 + KI-45 + KI-48): the five session codes that
 * were previously published only by inline sends, plus the 413 transport class
 * and the malformed-JSON code. Every one is drift-gated against a LIVE
 * response under the same rule as the probes above: code AND status must match
 * the published entry.
 */
describe('catalogue v3 additions (KI-43 / KI-45 / KI-48 lockstep)', () => {
  const SCRIPTED_FORM = {
    title: 'First milestone plan',
    description: 'Choose what to build first and where it runs.',
    fields: [
      { id: 'goal', label: 'Goal', type: 'text', required: true },
      {
        id: 'platforms',
        label: 'Platforms',
        type: 'multiselect',
        required: true,
        options: ['Mobile web', 'Desktop'],
      },
      { id: 'weeks', label: 'Weeks', type: 'number', min: 1, max: 12 },
      { id: 'offline', label: 'Offline first', type: 'checkbox' },
    ],
    submit_label: 'Save plan',
  };

  async function appScripted(
    respond: (request: ModelRequest) => string,
    overrides: Partial<AppConfig> = {},
  ): Promise<FastifyInstance> {
    const database = openDatabase({ path: ':memory:', wal: false });
    openDatabases.push(database);
    const provider = new EchoProvider({ respond });
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

  async function catalogOf(app: FastifyInstance): Promise<ErrorCatalog> {
    return (
      await app.inject({ method: 'GET', url: '/api/errors', headers: { host: LOOPBACK } })
    ).json().data as ErrorCatalog;
  }

  async function expectProbe(
    app: FastifyInstance,
    catalog: ErrorCatalog,
    code: string,
    run: () => Promise<ErrorProbe>,
  ): Promise<void> {
    const entry = Object.values(catalog.groups)
      .flatMap((entries) => entries)
      .find((candidate) => candidate.code === code);
    expect(entry, `catalogue is missing ${code}`).toBeDefined();
    const response = await run();
    expect(response.json().error?.code, code).toBe(code);
    expect(response.statusCode, code).toBe(entry?.http_status);
  }

  async function sessionWithProbeProject(app: FastifyInstance): Promise<string> {
    const created = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { host: LOOPBACK },
      payload: { project_id: 'catalog-probe' },
    });
    expect(created.statusCode).toBe(201);
    return created.json().data.id as string;
  }

  it('transport: malformed JSON answers bad_request; oversized bodies answer payload_too_large', async () => {
    const app = await appWith();
    const catalog = await catalogOf(app);
    await expectProbe(app, catalog, 'bad_request', () =>
      app.inject({
        method: 'POST',
        url: '/api/memories',
        headers: { host: LOOPBACK, 'content-type': 'application/json' },
        payload: '{"content": "this line is not valid JSON',
      }),
    );
    await expectProbe(app, catalog, 'payload_too_large', () =>
      app.inject({
        method: 'POST',
        url: '/api/memories',
        headers: { host: LOOPBACK, 'content-type': 'application/json' },
        payload: JSON.stringify({ content: 'x'.repeat(1_048_576 + 64), type: 'project' }),
      }),
    );
  });

  it('ui_generation_failed answers its published entry', async () => {
    const app = await appScripted(() => 'this is not json');
    const catalog = await catalogOf(app);
    const id = await sessionWithProbeProject(app);
    await expectProbe(app, catalog, 'ui_generation_failed', () =>
      app.inject({
        method: 'POST',
        url: `/api/sessions/${id}/ui`,
        headers: { host: LOOPBACK },
        payload: { intent: 'Plan the first milestone' },
      }),
    );
  });

  it('surface_not_found and surface_already_submitted answer their published entries', async () => {
    const app = await appScripted((request) => {
      const content = request.messages[0]?.content ?? '';
      if (content.startsWith('Design a short interactive planning form')) {
        return JSON.stringify(SCRIPTED_FORM);
      }
      return 'Scripted continuation.';
    });
    const catalog = await catalogOf(app);
    const id = await sessionWithProbeProject(app);
    await expectProbe(app, catalog, 'surface_not_found', () =>
      app.inject({
        method: 'POST',
        url: `/api/sessions/${id}/ui/${randomUUID()}/events`,
        headers: { host: LOOPBACK },
        payload: { values: {} },
      }),
    );
    const generated = await app.inject({
      method: 'POST',
      url: `/api/sessions/${id}/ui`,
      headers: { host: LOOPBACK },
      payload: { intent: 'Plan the first milestone' },
    });
    expect(generated.statusCode).toBe(201);
    const surfaceId = generated.json().data.surface.id as string;
    // The sixth code found live during this lockstep: a submission that
    // fails the stored spec answers invalid_submission (the surface must be
    // un-submitted to reach validation — use a second generated surface).
    const second = await app.inject({
      method: 'POST',
      url: `/api/sessions/${id}/ui`,
      headers: { host: LOOPBACK },
      payload: { intent: 'Plan the first milestone' },
    });
    expect(second.statusCode).toBe(201);
    const secondSurfaceId = second.json().data.surface.id as string;
    await expectProbe(app, catalog, 'invalid_submission', () =>
      app.inject({
        method: 'POST',
        url: `/api/sessions/${id}/ui/${secondSurfaceId}/events`,
        headers: { host: LOOPBACK },
        payload: { values: { goal: 'ship', platforms: ['not-a-real-option'] } },
      }),
    );
    const submit = () =>
      app.inject({
        method: 'POST',
        url: `/api/sessions/${id}/ui/${surfaceId}/events`,
        headers: { host: LOOPBACK },
        payload: { values: { goal: 'ship', platforms: ['desktop'], weeks: 4, offline: true } },
      });
    const first = await submit();
    expect(first.statusCode, 'first submission must succeed to pin the second').toBe(200);
    await expectProbe(app, catalog, 'surface_already_submitted', submit);
  });

  it('tool_call_not_found and tool_call_not_pending answer their published entries', async () => {
    const app = await appScripted(
      (request) => {
        const content = request.messages[0]?.content ?? '';
        if (content.startsWith('You are the tool-planning step')) {
          return JSON.stringify({
            calls: [{ tool: 'task.create', arguments_json: '{"title":"Catalogue probe task"}' }],
          });
        }
        return 'Understood.';
      },
      {
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
          tools: {
            enabled: true,
            approvalPolicy: 'always',
            maxCallsPerTurn: 3,
            decisionMode: 'always',
          },
        },
      },
    );
    const catalog = await catalogOf(app);
    const id = await sessionWithProbeProject(app);
    await expectProbe(app, catalog, 'tool_call_not_found', () =>
      app.inject({
        method: 'POST',
        url: `/api/sessions/${id}/tools/${randomUUID()}/decision`,
        headers: { host: LOOPBACK },
        payload: { decision: 'approve' },
      }),
    );
    const turn = await app.inject({
      method: 'POST',
      url: `/api/sessions/${id}/messages`,
      headers: { host: LOOPBACK },
      payload: { content: 'Create one task.' },
    });
    expect(turn.statusCode).toBeLessThan(500);
    const calls = (
      await app.inject({
        method: 'GET',
        url: `/api/sessions/${id}/tools`,
        headers: { host: LOOPBACK },
      })
    ).json().data.items as { id: string; status: string }[];
    expect(calls.length, 'expected a pending tool call to pin against').toBeGreaterThan(0);
    const decide = () =>
      app.inject({
        method: 'POST',
        url: `/api/sessions/${id}/tools/${calls[0]?.id}/decision`,
        headers: { host: LOOPBACK },
        payload: { decision: 'approve' },
      });
    const first = await decide();
    expect(first.statusCode, 'first decision must succeed to pin the second').toBe(200);
    await expectProbe(app, catalog, 'tool_call_not_pending', decide);
  });
});
