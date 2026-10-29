import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import type { ModelRequest } from '@mml/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import type { AppConfig } from '../../apps/server/src/config.js';
import { SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

/**
 * Generative interface API tests.
 *
 * The deterministic provider returns a scripted planning form so the whole
 * path — generate, validate, store, render payload, submit, capture memory,
 * continue the conversation — is exercised without a network call.
 */

const open: { app: FastifyInstance; db: { close: () => void }; engine: MemoryEngine }[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) {
    await harness.app.close();
    harness.db.close();
  }
});

const GENERATED_FORM = {
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

function config(): AppConfig {
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
      tools: {
        enabled: false,
        approvalPolicy: 'always',
        maxCallsPerTurn: 3,
        decisionMode: 'off',
      },
      maxOutputTokens: 1_200,
    },
    serviceVersion: SERVICE_VERSION,
  };
}

async function harness(options: { generation?: string; failFirstFollowUp?: boolean } = {}) {
  const database = openDatabase({ path: ':memory:', wal: false });
  let followUps = 0;
  const provider = new EchoProvider({
    respond: (request: ModelRequest) => {
      const content = request.messages[0]?.content ?? '';
      if (content.startsWith('Design a short interactive planning form')) {
        return options.generation ?? JSON.stringify(GENERATED_FORM);
      }
      followUps += 1;
      if (options.failFirstFollowUp && followUps === 1) {
        throw new Error('provider failed');
      }
      return 'Continuing with the plan you submitted.';
    },
  });
  const engine = new MemoryEngine(database.db);
  const app = await buildApp({
    config: config(),
    db: database.db,
    dbPath: ':memory:',
    provider,
    engine,
    providerHealth: new ProviderHealthTracker(provider, 0),
  });
  open.push({ app, db: database, engine });
  return { app, engine };
}

async function newSession(app: FastifyInstance, projectId: string | null = 'demo-game') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { project_id: projectId },
  });
  return response.json().data as { id: string };
}

async function generate(app: FastifyInstance, sessionId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/sessions/${sessionId}/ui`,
    payload: { intent: 'Plan the first milestone for the game' },
  });
}

describe('POST /api/sessions/:id/ui', () => {
  it('generates a validated interface and anchors it in the transcript', async () => {
    const { app } = await harness();
    const session = await newSession(app);

    const response = await generate(app, session.id);
    expect(response.statusCode).toBe(201);

    const { data } = response.json();
    expect(data.surface.status).toBe('active');
    expect(data.surface.title).toBe('First milestone plan');
    expect(data.surface.message_id).toEqual(expect.any(String));

    const form = data.surface.spec.blocks.find((block: { kind: string }) => block.kind === 'form');
    expect(form.fields).toHaveLength(4);
    expect(form.save_to_memory.type).toBe('project');
    expect(form.fields[1].options).toEqual([
      { value: 'mobile-web', label: 'Mobile web' },
      { value: 'desktop', label: 'Desktop' },
    ]);

    const detail = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}` });
    const note = detail
      .json()
      .data.messages.find((message: { role: string }) => message.role === 'assistant');
    expect(note.content).toContain('First milestone plan');

    const list = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/ui` });
    expect(list.json().data.items).toHaveLength(1);
  });

  it('returns 502 when the model does not produce a valid interface', async () => {
    const { app } = await harness({ generation: 'this is not json' });
    const session = await newSession(app);

    const response = await generate(app, session.id);
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('ui_generation_failed');
  });

  it('rejects generation for an archived session', async () => {
    const { app } = await harness();
    const session = await newSession(app);
    await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}`,
      payload: { status: 'archived' },
    });

    const response = await generate(app, session.id);
    expect(response.statusCode).toBe(409);
  });

  it('404s for an unknown session', async () => {
    const { app } = await harness();
    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions/00000000-0000-4000-8000-000000000000/ui',
      payload: { intent: 'Plan something' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /api/sessions/:id/ui/:surfaceId/events', () => {
  async function setup(options: { generation?: string; failFirstFollowUp?: boolean } = {}) {
    const { app, engine } = await harness(options);
    const session = await newSession(app);
    const generated = await generate(app, session.id);
    return { app, engine, session, surface: generated.json().data.surface };
  }

  function submission(values: Record<string, unknown>) {
    return { action_id: 'plan', values };
  }

  it('validates, stores the plan as project memory, and continues the conversation', async () => {
    const { app, engine, session, surface } = await setup();

    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/ui/${surface.id}/events`,
      payload: submission({
        goal: 'Ship a playable demo',
        platforms: ['mobile-web', 'desktop'],
        weeks: 4,
        offline: true,
      }),
    });

    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.surface.status).toBe('submitted');
    expect(data.surface.events).toHaveLength(1);
    expect(data.memory).not.toBeNull();
    expect(data.memory.content).toContain('Ship a playable demo');
    expect(data.memory.type).toBe('project');
    expect(data.turn.assistant_message.content).toContain('Continuing with the plan');

    // The submitted values are project knowledge now, retrievable later.
    const retrieval = engine.retrieve({
      project_id: 'demo-game',
      query: 'playable demo mobile web',
    });
    expect(retrieval.results.map((entry) => entry.memory.content).join(' ')).toContain(
      'Ship a playable demo',
    );
  });

  it('rejects a second submission of the same interface', async () => {
    const { app, session, surface } = await setup();
    const payload = submission({ goal: 'One', platforms: ['desktop'] });

    await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/ui/${surface.id}/events`,
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/ui/${surface.id}/events`,
      payload,
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('surface_already_submitted');
  });

  it('allows resubmission after the follow-up turn fails once', async () => {
    const { app, session, surface } = await setup({ failFirstFollowUp: true });
    const payload = submission({ goal: 'Retry the plan', platforms: ['desktop'] });

    const failed = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/ui/${surface.id}/events`,
      payload,
    });
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error.code).toBe('provider_failure');

    // The failed turn must leave the surface active, not already submitted.
    const list = await app.inject({ method: 'GET', url: `/api/sessions/${session.id}/ui` });
    const afterFailure = list
      .json()
      .data.items.find((item: { id: string }) => item.id === surface.id);
    expect(afterFailure.status).toBe('active');

    const retried = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/ui/${surface.id}/events`,
      payload,
    });
    expect(retried.statusCode).toBe(200);
    const { data } = retried.json();
    expect(data.surface.status).toBe('submitted');
    expect(data.surface.events).toHaveLength(1);
    expect(data.memory).not.toBeNull();
    expect(data.turn.assistant_message.content).toContain('Continuing with the plan');
  });

  it('rejects a missing required field', async () => {
    const { app, session, surface } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/ui/${surface.id}/events`,
      payload: submission({ platforms: ['desktop'] }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_submission');
  });

  it('rejects an option the interface did not declare', async () => {
    const { app, session, surface } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/ui/${surface.id}/events`,
      payload: submission({ goal: 'x', platforms: ['ios'] }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('invalid_submission');
  });

  it('rejects an undeclared field', async () => {
    const { app, session, surface } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/ui/${surface.id}/events`,
      payload: submission({ goal: 'x', platforms: ['desktop'], admin: 'true' }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('Unknown field');
  });

  it('404s for a surface from another session', async () => {
    const { app, surface } = await setup();
    const other = await newSession(app, 'other-project');

    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${other.id}/ui/${surface.id}/events`,
      payload: submission({ goal: 'x', platforms: ['desktop'] }),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('meta', () => {
  it('reports the UI protocol as complete', async () => {
    const { app } = await harness();
    const response = await app.inject({ method: 'GET', url: '/api/meta' });
    const { data } = response.json();
    expect(data.phase).toBe(5);
    expect(data.modules.ui_protocol).toBe('complete');
  });
});
