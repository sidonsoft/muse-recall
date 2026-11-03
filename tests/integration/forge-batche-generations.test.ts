import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import { type AppConfig, SERVICE_VERSION } from '../../apps/server/src/config.js';
import { decisionContentSha256 } from '../../apps/server/src/forge/decision-reference.js';
import { ForgeJobManager } from '../../apps/server/src/forge/runner.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/fake-muse.mjs', import.meta.url));

/**
 * Batch E — decision provenance through the real routes.
 *
 * A generation records the exact wording of every decision it was handed, and
 * the prior-generation listing compares that record against what is stored
 * now. Nothing here re-runs a generation or rewrites one: every assertion about
 * a past version is read from the record written when that job started.
 */

const PROMPT = 'A colourful farmyard memory game for children with twelve cards.';

/** Passes the studio validator, so approvals create generations in these tests. */
const GAME_SOURCE = `<!doctype html><html><head><title>Batch E Game</title>
<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>
</head><body><div id="game"></div><script>
var elapsed = 0; var score = 0; function pick(){ score += 10; elapsed += 1; }
new Phaser.Game({ type: Phaser.AUTO, width: 640, height: 480, parent: 'game', scene: { create: function(){} } });
</script><p>SOURCE_TAIL_MARKER</p></body></html>`;

interface Harness {
  app: FastifyInstance;
  engine: MemoryEngine;
  workspace: ForgeWorkspace;
  manager: ForgeJobManager;
  root: string;
  promptPath: string;
  close: () => Promise<void>;
}

const open: Harness[] = [];

afterEach(async () => {
  for (const harness of open.splice(0)) {
    await harness.close();
    await rm(harness.root, { recursive: true, force: true });
  }
});

function config(workspaceRoot: string): AppConfig {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    corsOrigins: [],
    databasePath: ':memory:',
    wal: false,
    workspaceRoot,
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
  };
}

async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'forge-batch-e-'));
  const sourcePath = join(root, 'source.html');
  const promptPath = join(root, 'prompt-for-model.txt');
  await writeFile(sourcePath, GAME_SOURCE, 'utf8');
  const database = openDatabase({ path: ':memory:', wal: false });
  const engine = new MemoryEngine(database.db);
  const workspace = new ForgeWorkspace(root);
  let tick = 0;
  const base = Date.UTC(2026, 10, 1, 8, 0, 0);
  const manager = new ForgeJobManager({
    workspace,
    engine,
    museBin: FIXTURE,
    env: {
      FAKE_MUSE_MODE: 'copy',
      FAKE_MUSE_HTML: sourcePath,
      FAKE_MUSE_PROMPT_COPY: promptPath,
    },
    maxRuntimeMs: 10_000,
    maxCalls: 10,
    maxInputTokens: 10_000_000,
    reasoningEffort: 'low',
    runtimeCheck: async () => ({ ok: true, errors: [] }),
    now: () => new Date(base + tick++ * 1000),
  });
  const app = await buildApp({
    config: config(root),
    db: database.db,
    dbPath: ':memory:',
    provider: new EchoProvider(),
    engine,
    forgeWorkspace: workspace,
    forgeManager: manager,
    providerHealth: new ProviderHealthTracker(new EchoProvider(), 0),
  });
  const instance: Harness = {
    app,
    engine,
    workspace,
    manager,
    root,
    promptPath,
    close: async () => {
      await app.close();
      database.close();
    },
  };
  open.push(instance);
  return instance;
}

function decision(engine: MemoryEngine, projectId: string, content: string) {
  return engine.create({
    type: 'constraint',
    scope: 'project',
    project_id: projectId,
    content,
    confidence: 0.9,
    validation_status: 'verified',
    source: { session_id: null, reference: null },
    expires_at: null,
    tags: [],
  }).memory;
}

async function createProject(app: FastifyInstance, id = 'batch-e') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/forge/projects',
    payload: { project_id: id, name: 'Batch E' },
  });
  expect(response.statusCode).toBe(200);
}

type JobView = {
  id: string;
  status: string;
  version: number | null;
  memory_reference: Array<Record<string, unknown>> | null;
  decision_revisions_supplied: Array<Record<string, unknown>> | null;
  logs: string[];
};

async function startGenerate(app: FastifyInstance, body: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/forge/projects/batch-e/generate',
    payload: { prompt: PROMPT, ...body },
  });
  expect(response.statusCode).toBe(202);
  return response.json().data.id as string;
}

async function startModify(app: FastifyInstance, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/forge/projects/batch-e/modify',
    payload: { request: 'Make the cards larger.', ...body },
  });
}

async function job(app: FastifyInstance, id: string): Promise<JobView> {
  const response = await app.inject({ method: 'GET', url: `/api/forge/jobs/${id}` });
  expect(response.statusCode).toBe(200);
  return response.json().data as JobView;
}

async function finished(app: FastifyInstance, id: string): Promise<JobView> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const current = await job(app, id);
    if (
      ['succeeded', 'failed', 'cancelled', 'budget_exceeded', 'rejected'].includes(current.status)
    ) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`job ${id} did not finish`);
}

async function approve(app: FastifyInstance, id: string) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/forge/jobs/${id}/approve`,
    payload: { capture_memory: false },
  });
  expect(response.statusCode).toBe(200);
  return response.json().data as { version: number };
}

async function generations(app: FastifyInstance) {
  const response = await app.inject({
    method: 'GET',
    url: '/api/forge/projects/batch-e/generations',
  });
  expect(response.statusCode).toBe(200);
  return response.json().data as {
    project_id: string;
    current_version: number | null;
    truncated: boolean;
    items: Array<{
      version: number | null;
      job_id: string;
      job_status: string | null;
      memory_reference: Array<{
        memory_id: string;
        revision: number;
        content_sha256: string;
        excerpt: string;
        user_selected: boolean;
      }> | null;
      comparison: {
        label: string;
        reason: string;
        drift: Array<Record<string, unknown>>;
        added_since: Array<Record<string, unknown>>;
        unchanged: Array<Record<string, unknown>>;
        limits: string[];
      };
    }>;
  };
}

describe('prior generations carry their decision reference', () => {
  it('records the exact wording a generation was handed and lists it back', async () => {
    const h = await harness();
    await createProject(h.app);
    const ocean = decision(h.engine, 'batch-e', 'Theme: ocean, never woodland.');

    const generated = await startGenerate(h.app);
    const reviewed = await finished(h.app, generated);
    expect(reviewed.status).toBe('succeeded');
    // The reference is written at start time, before any model output exists.
    expect(reviewed.memory_reference).toHaveLength(1);
    const stored = reviewed.memory_reference?.[0] as Record<string, unknown>;
    expect(stored.memory_id).toBe(ocean.id);
    expect(stored.revision).toBe(1);
    expect(stored.content_sha256).toBe(decisionContentSha256(ocean.content));
    expect(stored.excerpt).toBe('Theme: ocean, never woodland.');
    expect(stored.user_selected).toBe(false);

    await approve(h.app, generated);
    const listed = await generations(h.app);
    expect(listed.current_version).toBe(1);
    expect(listed.items).toHaveLength(1);
    const generation = listed.items[0] as (typeof listed.items)[number];
    expect(generation.version).toBe(1);
    expect(generation.job_id).toBe(generated);
    expect(generation.memory_reference).toHaveLength(1);
    expect(generation.comparison.label).toBe('matched_current_decision');
    expect(generation.comparison.limits.length).toBeGreaterThan(0);
  });

  it('labels an older generation received_previous_decision once the decision changes', async () => {
    const h = await harness();
    await createProject(h.app);
    const ocean = decision(h.engine, 'batch-e', 'Theme: ocean, never woodland.');

    const first = await startGenerate(h.app);
    await finished(h.app, first);
    await approve(h.app, first);

    // The user corrects the decision: a new record supersedes the old one.
    const woodland = h.engine.correct(
      {
        supersedes: [ocean.id],
        type: 'constraint',
        scope: 'project',
        project_id: 'batch-e',
        content: 'Theme: woodland, ocean only for the background.',
        confidence: 0.9,
        validation_status: 'verified',
        source: { session_id: null, reference: null },
        tags: [],
      },
      'user',
    ).memory;

    // Iterating on an approved generation goes through a modify proposal,
    // which is what Batch E's update proposal is.
    const second = await startModify(h.app, { request: 'Use the current theme for the cards.' });
    expect(second.statusCode).toBe(202);
    const secondJob = second.json().data as { id: string };
    await finished(h.app, secondJob.id);
    await approve(h.app, secondJob.id);

    const listed = await generations(h.app);
    expect(listed.items.map((item) => item.version)).toEqual([2, 1]);

    const older = listed.items[1] as (typeof listed.items)[number];
    expect(older.comparison.label).toBe('received_previous_decision');
    expect(older.comparison.drift).toHaveLength(1);
    const drift = older.comparison.drift[0] as Record<string, unknown>;
    expect(drift.change).toBe('superseded');
    expect(drift.memory_id).toBe(ocean.id);
    expect(drift.supplied_excerpt).toBe('Theme: ocean, never woodland.');
    expect(drift.current_excerpt).toBe('Theme: woodland, ocean only for the background.');
    expect(drift.superseded_by).toBe(woodland.id);
    // The newer generation needs no drift at all: it matched what is current.
    expect((listed.items[0] as (typeof listed.items)[number]).comparison.drift).toEqual([]);
    // Every generation is comparable, so none of them is unknown.
    for (const item of listed.items) expect(item.memory_reference).not.toBeNull();
    // Naming the relationship is never naming a cause.
    for (const item of listed.items) {
      expect(item.comparison.limits.join(' ')).toMatch(/not evidence/);
    }
  });

  it('reports a withdrawn decision as retired, not as a revision that never happened', async () => {
    const h = await harness();
    await createProject(h.app);
    const decisionRecord = decision(
      h.engine,
      'batch-e',
      'No countdown timer anywhere in the game.',
    );

    const generated = await startGenerate(h.app);
    await finished(h.app, generated);
    await approve(h.app, generated);

    // Soft deletion keeps the row, keeps its wording byte-identical, and bumps
    // the revision. Wording-plus-revision comparison alone would call that an
    // in-place revision and then quote a deleted decision as current guidance.
    h.engine.softDelete(decisionRecord.id, { reason: 'user withdrew the rule', actor: 'user' });

    const listed = await generations(h.app);
    const generation = listed.items[0] as (typeof listed.items)[number];
    expect(generation.comparison.label).toBe('received_previous_decision');
    const drift = generation.comparison.drift[0] as Record<string, unknown>;
    expect(drift.change).toBe('withdrawn');
    expect(drift.current_status).toBe('deleted');
    expect(drift.current_excerpt).toBeNull();
    // The wording the generation did receive stays on the record, so the
    // reviewer can still see exactly what it was given.
    expect(drift.supplied_excerpt).toBe('No countdown timer anywhere in the game.');
    // A retired decision is not offered as guidance for a new proposal.
    const proposal = await startModify(h.app, {
      decisions: [{ memory_id: decisionRecord.id }],
    });
    expect(proposal.statusCode).toBe(422);
    expect(proposal.json().error.code).toBe('decision_not_active');
  });

  it('records the exact injected prefix when a selected decision is too long', async () => {
    const h = await harness();
    await createProject(h.app);
    const tail = 'TAIL_MARKER_THE_MODEL_NEVER_SEES';
    const long = `${'A theme card must show exactly one symbol.'.repeat(80)} ${tail}`;
    expect(long.length).toBeGreaterThan(2_000);
    const big = decision(h.engine, 'batch-e', long);

    const base = await startGenerate(h.app);
    await finished(h.app, base);
    await approve(h.app, base);

    const response = await startModify(h.app, { decisions: [{ memory_id: big.id }] });
    expect(response.statusCode).toBe(202);
    const started = response.json().data as { id: string };
    const reviewed = await finished(h.app, started.id);

    const supplied = (reviewed.decision_revisions_supplied as Array<Record<string, unknown>>)[0];
    if (!supplied) throw new Error('the job recorded no decision reference to inspect');
    // The stored decision is recorded whole …
    expect(supplied.content_sha256).toBe(decisionContentSha256(long));
    // … but the injection fingerprint covers only the truncated prefix.
    const injected = (await readFile(h.promptPath, 'utf8')).includes(tail);
    expect(injected).toBe(false);
    expect(typeof supplied.injected_sha256).toBe('string');
    expect(supplied.injected_sha256).not.toBe(supplied.content_sha256);
    expect(supplied.injected_truncated).toBe(true);
    expect(supplied.injected_excerpt).not.toContain(tail);
    // And the job says so in plain language, not only as a flag.
    expect(reviewed.logs?.some((line) => line.includes('injection cap'))).toBe(true);
  });

  it('hands the new job the current wording, not the superseded one', async () => {
    const h = await harness();
    await createProject(h.app);
    const ocean = decision(h.engine, 'batch-e', 'Theme: ocean, never woodland.');
    h.engine.correct(
      {
        supersedes: [ocean.id],
        type: 'constraint',
        scope: 'project',
        project_id: 'batch-e',
        content: 'Theme: woodland, ocean only for the background.',
        confidence: 0.9,
        validation_status: 'verified',
        source: { session_id: null, reference: null },
        tags: [],
      },
      'user',
    );

    const generated = await startGenerate(h.app);
    await finished(h.app, generated);

    const prompt = await readFile(h.promptPath, 'utf8');
    expect(prompt).toContain('Theme: woodland, ocean only for the background.');
    expect(prompt).not.toContain('Theme: ocean, never woodland.');
  });

  it('accepts user-selected decisions and records the exact revision supplied', async () => {
    const h = await harness();
    await createProject(h.app);
    const palette = decision(h.engine, 'batch-e', 'Accent colour must be #FF7E5F.');
    const theme = decision(h.engine, 'batch-e', 'Theme: woodland.');

    // A proposal updates an existing generation, so one has to be approved first.
    const base = await startGenerate(h.app);
    await finished(h.app, base);
    await approve(h.app, base);

    const response = await startModify(h.app, {
      decisions: [{ memory_id: palette.id }, { memory_id: theme.id }],
    });
    expect(response.statusCode).toBe(202);
    const started = response.json().data as {
      id: string;
      decision_revisions_supplied?: unknown[];
    };
    // The revisions are recorded at start time, so the client sees them in the
    // 202 response rather than only after the job finishes.
    expect(started.decision_revisions_supplied).toHaveLength(2);

    const reviewed = await finished(h.app, started.id);
    const supplied = reviewed.decision_revisions_supplied as Array<Record<string, unknown>>;
    expect(supplied).toHaveLength(2);
    expect(supplied.map((entry) => [entry.memory_id, entry.revision, entry.user_selected])).toEqual(
      [
        [palette.id, 1, true],
        [theme.id, 1, true],
      ],
    );
    for (const [index, source] of [palette, theme].entries()) {
      expect(supplied[index]?.content_sha256).toBe(decisionContentSha256(source.content));
    }

    const prompt = await readFile(h.promptPath, 'utf8');
    expect(prompt).toContain('Accent colour must be #FF7E5F.');
    expect(prompt).toContain('Theme: woodland.');

    await approve(h.app, started.id);
    const listed = await generations(h.app);
    const generation = listed.items[0] as (typeof listed.items)[number];
    expect(generation.memory_reference).toHaveLength(2);
    expect(generation.memory_reference?.map((entry) => entry.user_selected)).toEqual([true, true]);
  });

  it('refuses a decision the user did not select being passed off as current', async () => {
    const h = await harness();
    await createProject(h.app);
    const ocean = decision(h.engine, 'batch-e', 'Theme: ocean.');
    const first = await startGenerate(h.app);
    await finished(h.app, first);
    await approve(h.app, first);
    const replacement = h.engine.correct(
      {
        supersedes: [ocean.id],
        type: 'constraint',
        scope: 'project',
        project_id: 'batch-e',
        content: 'Theme: woodland.',
        confidence: 0.9,
        validation_status: 'verified',
        source: { session_id: null, reference: null },
        tags: [],
      },
      'user',
    ).memory;

    // A superseded decision cannot be selected: it is no longer the guidance.
    const superseded = await startModify(h.app, { decisions: [{ memory_id: ocean.id }] });
    expect(superseded.statusCode).toBe(422);
    expect(superseded.json().error.code).toBe('decision_superseded');
    // The message names the record that replaced it, so the UI can point the
    // user at the current decision instead of the stale one.
    expect(superseded.json().error.message).toContain(replacement.id);

    // A stale expected revision is refused rather than silently re-pinned.
    const moved = await startModify(h.app, {
      decisions: [{ memory_id: replacement.id, expected_revision: 99 }],
    });
    expect(moved.statusCode).toBe(409);
    expect(moved.json().error.code).toBe('decision_revision_conflict');
    expect(moved.json().error.message).toContain('revision 99');

    // A decision from another project never enters this project's proposal.
    const other = decision(h.engine, 'other-game', 'Theme: desert.');
    const foreign = await startModify(h.app, { decisions: [{ memory_id: other.id }] });
    expect(foreign.statusCode).toBe(422);
    expect(foreign.json().error.code).toBe('decision_cross_project');

    // None of the refusals started a job or added a generation.
    const state = await h.workspace.state('batch-e');
    expect(state.current_version).toBe(1);
    expect(h.manager.list('batch-e')).toHaveLength(1);
    expect((await generations(h.app)).items).toHaveLength(1);
  });

  it('reads the listing without staging, approving, or creating anything', async () => {
    const h = await harness();
    await createProject(h.app);
    decision(h.engine, 'batch-e', 'Theme: ocean.');
    const generated = await startGenerate(h.app);
    await finished(h.app, generated);
    await approve(h.app, generated);

    const stateBefore = await h.workspace.state('batch-e');
    const artifactBefore = await readFile(
      join(h.workspace.projectDir('batch-e'), 'staging', 'index.html'),
      'utf8',
    ).catch(() => null);
    const jobsBefore = h.manager.list('batch-e').length;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const listed = await generations(h.app);
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0]?.comparison.unchanged).toHaveLength(1);
    }

    expect(await h.workspace.state('batch-e')).toEqual(stateBefore);
    expect(h.manager.list('batch-e')).toHaveLength(jobsBefore);
    expect(
      await readFile(
        join(h.workspace.projectDir('batch-e'), 'staging', 'index.html'),
        'utf8',
      ).catch(() => null),
    ).toEqual(artifactBefore);
    // The approved artifact on disk is untouched by the comparison.
    const approved = await readFile(
      join(h.workspace.projectDir('batch-e'), 'versions', '1', 'index.html'),
      'utf8',
    );
    expect(approved).toContain('Batch E Game');
  });
});
