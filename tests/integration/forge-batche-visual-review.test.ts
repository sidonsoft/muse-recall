import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import { MediaVisualReviewRequestSchema, MediaVisualReviewResponseSchema } from '@mml/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import { type AppConfig, SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ForgeJobManager } from '../../apps/server/src/forge/runner.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import { MediaAssetStore } from '../../apps/server/src/media/assets.js';
import { MediaJobStore } from '../../apps/server/src/media/jobs.js';
import type { MediaUnderstand, MediaVisualReview } from '../../apps/server/src/media/segment.js';
import { MediaService } from '../../apps/server/src/media/service.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

/**
 * Batch E — screenshot advisory review through the real routes.
 *
 * The vision call is a deterministic stub. What these tests pin is the contract
 * around it: decisions resolved from memory rather than taken from the request,
 * findings that must carry evidence and uncertainty, decisions the answer skipped
 * never upgraded to consistent, refusals that spend no provider call, and a Forge
 * artifact this endpoint cannot touch.
 */

const FIXTURE = fileURLToPath(new URL('../fixtures/fake-muse.mjs', import.meta.url));
const PROJECT = 'batch-e-review';

/** 64×64 PNG: the smallest capture the screenshot bound accepts. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsItoHOMY1Qi+hcEKLDX9WgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQELguAI4FLuAoFBQAAAABJRU5ErkJggg==',
  'base64',
);
const SCREENSHOT = `data:image/png;base64,${PNG.toString('base64')}`;

const GAME_SOURCE = `<!doctype html><html><head><title>Batch E Review Game</title>
<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>
</head><body><div id="game"></div><script>
var elapsed = 0; var score = 0; function pick(){ score += 10; elapsed += 1; }
new Phaser.Game({ type: Phaser.AUTO, width: 640, height: 480, parent: 'game', scene: { create: function(){} } });
</script><p>SOURCE_TAIL_MARKER</p></body></html>`;

const PROMPT = 'A colourful farmyard memory game for children with twelve cards.';

type ResolvedDecision = { id: string; text: string };

interface ReviewOutcome {
  findings: Array<{
    decision_id: string;
    verdict: 'consistent' | 'possible_conflict' | 'unclear';
    evidence: string;
    uncertainty: string;
    confidence: number;
  }>;
  unverified: Array<{ decision_id: string; reason: string }>;
  ignored: number;
}

/**
 * The stub is handed the decisions the server resolved, exactly as the real
 * operation is, so a test describes what a model answered without hard-coding
 * ids only the store knows.
 */
type OutcomeBuilder = (decisions: ResolvedDecision[]) => ReviewOutcome;

interface ReviewStub {
  calls: number;
  prompts: string[];
  outcome: OutcomeBuilder;
}

/** Answers the first selected decision, skips the rest, invents one extra. */
const DEFAULT_OUTCOME: OutcomeBuilder = (decisions) => ({
  findings: decisions.slice(0, 1).map((entry) => ({
    decision_id: entry.id,
    verdict: 'possible_conflict',
    evidence: 'a blue bar spans the bottom of the frame',
    uncertainty: 'a still frame cannot show whether the bar changes over time',
    confidence: 0.6,
  })),
  unverified: decisions.slice(1).map((entry) => ({
    decision_id: entry.id,
    reason: 'the review did not report on this decision at all',
  })),
  ignored: 1,
});

/** Reports nothing at all: every selected decision must come back unverified. */
const SILENT_OUTCOME: OutcomeBuilder = (decisions) => ({
  findings: [],
  unverified: decisions.map((entry) => ({
    decision_id: entry.id,
    reason: 'the review did not report on this decision at all',
  })),
  ignored: 0,
});

interface Harness {
  app: FastifyInstance;
  engine: MemoryEngine;
  workspace: ForgeWorkspace;
  manager: ForgeJobManager;
  review: ReviewStub;
  root: string;
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

async function harness(
  options: { unconfigured?: boolean; outcome?: OutcomeBuilder } = {},
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'forge-batch-e-review-'));
  const sourcePath = join(root, 'source.html');
  await writeFile(sourcePath, GAME_SOURCE, 'utf8');
  const database = openDatabase({ path: ':memory:', wal: false });
  const engine = new MemoryEngine(database.db);
  const workspace = new ForgeWorkspace(root);
  const assets = new MediaAssetStore(workspace);
  const jobs = new MediaJobStore(workspace);
  const review: ReviewStub = { calls: 0, prompts: [], outcome: options.outcome ?? DEFAULT_OUTCOME };
  const understand = {
    targetedModel: 'muse-spark-1.3',
    suggest: async () => ({
      suggestions: [],
      model: 'muse-spark-1.3',
      observedModel: null,
      attempts: 0,
    }),
  };
  const visualReview = {
    targetedModel: 'muse-spark-1.3',
    review: async (_image: unknown, decisions: ResolvedDecision[]) => {
      review.calls += 1;
      review.prompts.push(decisions.map((entry) => `${entry.id}:${entry.text}`).join('|'));
      const outcome = review.outcome(decisions);
      return {
        findings: outcome.findings,
        unverified: outcome.unverified,
        ignored: outcome.ignored,
        model: 'muse-spark-1.3',
        observedModel: 'muse-spark-1.3-observed',
        attempts: 1,
      };
    },
  };
  const service = new MediaService(assets, jobs, null, {
    understand: understand as unknown as MediaUnderstand,
    ...(options.unconfigured === true
      ? {}
      : { visualReview: visualReview as unknown as MediaVisualReview }),
  });
  let tick = 0;
  const base = Date.UTC(2026, 10, 1, 9, 0, 0);
  const manager = new ForgeJobManager({
    workspace,
    engine,
    museBin: FIXTURE,
    env: { FAKE_MUSE_MODE: 'copy', FAKE_MUSE_HTML: sourcePath },
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
    mediaAssets: assets,
    mediaJobs: jobs,
    mediaService: service,
    providerHealth: new ProviderHealthTracker(new EchoProvider(), 0),
  });
  const instance: Harness = {
    app,
    engine,
    workspace,
    manager,
    review,
    root,
    close: async () => {
      await app.close();
      database.close();
    },
  };
  open.push(instance);
  return instance;
}

function decision(engine: MemoryEngine, content: string, projectId = PROJECT) {
  return engine.create({
    type: 'constraint',
    scope: 'project',
    project_id: projectId,
    content,
    confidence: 0.9,
    validation_status: 'verified',
  }).memory;
}

async function createProject(app: FastifyInstance) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/forge/projects',
    payload: { project_id: PROJECT, name: 'Batch E Review' },
  });
  expect(response.statusCode).toBe(200);
}

async function approveGenerate(app: FastifyInstance): Promise<string> {
  const started = await app.inject({
    method: 'POST',
    url: `/api/forge/projects/${PROJECT}/generate`,
    payload: { prompt: PROMPT },
  });
  expect(started.statusCode).toBe(202);
  const jobId = started.json().data.id as string;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const current = await app.inject({ method: 'GET', url: `/api/forge/jobs/${jobId}` });
    if (current.json().data.status === 'succeeded') {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const approved = await app.inject({
    method: 'POST',
    url: `/api/forge/jobs/${jobId}/approve`,
    payload: { capture_memory: false },
  });
  expect(approved.statusCode).toBe(200);
  return jobId;
}

function reviewBody(decisions: string[], screenshot = SCREENSHOT) {
  return { screenshot_data_url: screenshot, decisions };
}

async function postReview(app: FastifyInstance, body: unknown) {
  return app.inject({
    method: 'POST',
    url: `/api/forge/projects/${PROJECT}/visual-review`,
    payload: body,
  });
}

/** Byte-for-byte fingerprint of everything the Forge project owns on disk. */
async function artifactFingerprint(h: Harness) {
  const projectDir = h.workspace.projectDir(PROJECT);
  const files = new Map<string, string>();
  const dirs: string[] = [];
  for (const dir of ['versions', 'staging']) {
    for (const entry of await readdir(join(projectDir, dir), { recursive: true }).catch(() => [])) {
      const path = join(projectDir, String(entry));
      const info = await stat(path).catch(() => null);
      if (info === null) continue;
      if (!info.isFile()) {
        dirs.push(String(entry));
        continue;
      }
      files.set(
        String(entry),
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      );
    }
  }
  return {
    state: createHash('sha256')
      .update(await readFile(join(projectDir, 'state.json')))
      .digest('hex'),
    files,
    dirs: dirs.sort(),
    rootListing: (await readdir(h.root)).sort(),
  };
}

describe('screenshot advisory review against accepted decisions', () => {
  it('reports findings with evidence and uncertainty and touches nothing', async () => {
    const h = await harness();
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland, ocean only for the background.');
    const timer = decision(h.engine, 'Never show a countdown timer.');

    const jobId = await approveGenerate(h.app);
    const before = await artifactFingerprint(h);
    const jobsBefore = h.manager.list(PROJECT).length;

    const response = await postReview(h.app, reviewBody([theme.id, timer.id]));
    expect(response.statusCode).toBe(200);
    const payload = MediaVisualReviewResponseSchema.parse(response.json().data);

    expect(payload.advisory).toBe(true);
    // The endpoint states in its own payload that it changed nothing.
    expect(payload.artifact_changed).toBe(false);
    expect(payload.screenshot_sha256).toBe(createHash('sha256').update(PNG).digest('hex'));
    expect(payload.provider_attempts).toBe(1);
    expect(payload.provider.model).toBe('muse-spark-1.3');
    expect(payload.provider.observed).toBe('muse-spark-1.3-observed');
    // An answer about a decision nobody selected is counted, not rendered.
    expect(payload.ignored_entries).toBe(1);

    const [finding] = payload.findings;
    expect(finding?.decision_id).toBe(theme.id);
    expect(finding?.verdict).toBe('possible_conflict');
    expect(finding?.evidence).toContain('blue bar');
    expect(finding?.uncertainty).toContain('still frame');
    // The wording and revision come from the stored record, never the model.
    expect(finding?.decision_excerpt).toBe('Theme: woodland, ocean only for the background.');
    expect(finding?.decision_revision).toBe(1);

    const [unverified] = payload.unverified;
    expect(unverified?.decision_id).toBe(timer.id);
    expect(unverified?.decision_excerpt).toBe('Never show a countdown timer.');
    expect(unverified?.decision_revision).toBe(1);
    expect(unverified?.uncertainty).toContain('unknown');

    // The limits travel inside the payload; a client cannot drop them silently.
    expect(payload.limits.join(' ')).toContain('one still frame');
    expect(payload.limits.join(' ')).toContain('advisory');

    // The model was handed the decision text the store holds.
    expect(h.review.calls).toBe(1);
    expect(h.review.prompts[0]).toContain(
      `${theme.id}:Theme: woodland, ocean only for the background.`,
    );

    // Nothing about the Forge project moved: same bytes, same versions, same
    // jobs, same directories.
    const after = await artifactFingerprint(h);
    expect(after).toEqual(before);
    expect(h.manager.list(PROJECT)).toHaveLength(jobsBefore);
    const state = await h.workspace.state(PROJECT);
    expect(state.current_version).toBe(1);
    expect(state.versions[0]?.job_id).toBe(jobId);
    expect(h.manager.list(PROJECT).every((job) => job.id === jobId)).toBe(true);
  });

  it('refuses a selection that is not a current accepted decision, without calling the provider', async () => {
    const h = await harness();
    await createProject(h.app);
    const stale = decision(h.engine, 'Theme: ocean.');
    const current = decision(h.engine, 'Theme: meadow.');
    const replacement = h.engine.correct(
      {
        supersedes: [stale.id],
        type: 'constraint',
        scope: 'project',
        project_id: PROJECT,
        content: 'Theme: woodland.',
        confidence: 0.9,
        validation_status: 'verified',
        source: { session_id: null, reference: null },
      },
      'user',
    ).memory;
    const proposed = h.engine.propose({
      type: 'preference',
      scope: 'project',
      project_id: PROJECT,
      content: 'Maybe add a sunset background.',
      confidence: 0.5,
      validation_status: 'unverified',
    }).memory;
    const foreign = decision(h.engine, 'Theme: desert.', 'other-project');
    const retired = decision(h.engine, 'No countdown timer anywhere.');
    h.engine.softDelete(retired.id, { reason: 'user withdrew the rule', actor: 'user' });

    await approveGenerate(h.app);

    const cases: Array<{ body: unknown; status: number; code: string }> = [
      { body: reviewBody([stale.id]), status: 422, code: 'decision_superseded' },
      { body: reviewBody([proposed.id]), status: 422, code: 'decision_not_active' },
      { body: reviewBody([foreign.id]), status: 422, code: 'decision_cross_project' },
      { body: reviewBody([retired.id]), status: 422, code: 'decision_not_active' },
      {
        body: reviewBody(['9c1f2a3b-4d5e-4f60-8a71-8b9c0d0e0f01']),
        status: 422,
        code: 'decision_not_found',
      },
      // An empty selection reviews nothing, so it never reaches the model.
      {
        body: reviewBody([]),
        status: 400,
        code: 'validation_failed',
      },
      {
        // Long enough to clear the request-length bound, but not a PNG.
        body: reviewBody([current.id], `data:image/jpeg;base64,${'A'.repeat(200)}`),
        status: 400,
        code: 'invalid_screenshot',
      },
    ];
    for (const testCase of cases) {
      const response = await postReview(h.app, testCase.body);
      expect(response.statusCode).toBe(testCase.status);
      expect(response.json().error.code).toBe(testCase.code);
    }
    // Not one refusal spent a provider call.
    expect(h.review.calls).toBe(0);
    // And none of them added a generation or disturbed the approved version.
    const state = await h.workspace.state(PROJECT);
    expect(state.current_version).toBe(1);
    expect(state.versions).toHaveLength(1);
    expect(replacement.status).toBe('active');
  });

  it('keeps the review advisory when the model reports nothing usable', async () => {
    const h = await harness({ outcome: SILENT_OUTCOME });
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    const timer = decision(h.engine, 'Never show a countdown timer.');
    await approveGenerate(h.app);

    const response = await postReview(h.app, reviewBody([theme.id, timer.id]));
    expect(response.statusCode).toBe(200);
    const payload = MediaVisualReviewResponseSchema.parse(response.json().data);
    // Both decisions were skipped: zero findings, both unknown, never assumed
    // consistent just because the model said nothing.
    expect(payload.findings).toEqual([]);
    expect(payload.unverified.map((entry) => entry.decision_id).sort()).toEqual(
      [theme.id, timer.id].sort(),
    );
    for (const entry of payload.unverified) {
      expect(entry.reason).toContain('did not report');
      expect(entry.uncertainty.length).toBeGreaterThan(0);
    }
    expect(payload.artifact_changed).toBe(false);
  });

  it('reports a clear failure when visual review is not configured', async () => {
    const h = await harness({ unconfigured: true });
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    const response = await postReview(h.app, reviewBody([theme.id]));
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('media_unconfigured');
  });

  it('bounds the request through the shared schema before any work happens', async () => {
    const h = await harness();
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    const oversized = {
      screenshot_data_url: `data:image/png;base64,${'A'.repeat(4_000_000)}`,
      decisions: [theme.id],
    };
    const response = await postReview(h.app, oversized);
    expect([400, 413]).toContain(response.statusCode);
    expect(h.review.calls).toBe(0);
    // The shared contract itself refuses a screenshot below the PNG bound and
    // accepts a real one, so the route cannot be the only guard.
    expect(
      MediaVisualReviewRequestSchema.safeParse(reviewBody([theme.id], 'data:image/png;base64,'))
        .success,
    ).toBe(false);
    expect(MediaVisualReviewRequestSchema.safeParse(reviewBody([theme.id])).success).toBe(true);
  });
});
