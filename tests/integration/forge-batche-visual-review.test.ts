import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider, ProviderError } from '@mml/muse-provider';
import {
  FORGE_SCREENSHOT_DATA_URL_MAX_LENGTH,
  MediaVisualReviewRequestSchema,
  MediaVisualReviewResponseSchema,
} from '@mml/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';

/** What fastify's light-my-request harness accepts as a request body. */
type ReviewPayload = NonNullable<InjectOptions['payload']>;

import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import { type AppConfig, SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ForgeJobManager } from '../../apps/server/src/forge/runner.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import { IdempotencyStore } from '../../apps/server/src/idempotency.js';
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

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function harness(
  options: {
    unconfigured?: boolean;
    outcome?: OutcomeBuilder;
    holdReview?: Deferred;
    /** Fires the moment a dispatch is inside the provider, before it answers. */
    onEnter?: () => void;
    /** Named per call so a test can fail the first attempt and succeed later. */
    failWith?: (call: number) => Error | undefined;
    /** A store whose write fails, to check what happens to a paid-for answer. */
    recordFault?: boolean;
  } = {},
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
      options.onEnter?.();
      // A held review lets a test observe a second request that arrives while
      // the first is still in flight, rather than after it has been recorded.
      if (options.holdReview !== undefined) await options.holdReview.promise;
      const failure = options.failWith?.(review.calls);
      if (failure !== undefined) throw failure;
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
  // A store whose write fails, so a test can see what happens to an answer the
  // provider already produced when the replay record cannot be kept.
  let faulty: IdempotencyStore | undefined;
  if (options.recordFault === true) {
    faulty = new IdempotencyStore(database.db);
    faulty.record = () => {
      throw new Error('ENOSPC: no space left on device');
    };
  }
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
    idempotency: faulty,
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

/** A screenshot body whose payload is the given bytes. */
function screenshotBody(bytes: Buffer, selection: Selection[]): Record<string, unknown> {
  return reviewBody(selection, `data:image/png;base64,${bytes.toString('base64')}`);
}

/** The same PNG with a rewritten IHDR size, for a header a renderer would reject. */
function pngResized(bytes: Buffer, width: number, height: number): Buffer {
  const copy = Buffer.from(bytes);
  copy.writeUInt32BE(width, 16);
  copy.writeUInt32BE(height, 20);
  return copy;
}

function decision(engine: MemoryEngine, content: string, projectId = PROJECT) {
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

/** A selection the way the screen sends one: an id pinned to the revision it showed. */
interface Selection {
  memory_id: string;
  expected_revision: number;
}

function pick(memory: { id: string; revision: number }): Selection {
  return { memory_id: memory.id, expected_revision: memory.revision };
}

function reviewBody(selection: Selection[], screenshot = SCREENSHOT) {
  return { screenshot_data_url: screenshot, decisions: selection };
}

/** A run that finished but was never approved: a job, not a generation. */
async function generateOnly(app: FastifyInstance): Promise<string> {
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
  return jobId;
}

async function postReview(
  app: FastifyInstance,
  body: ReviewPayload,
  headers?: Record<string, string>,
) {
  return app.inject({
    method: 'POST',
    url: `/api/forge/projects/${PROJECT}/visual-review`,
    headers,
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

    const response = await postReview(h.app, reviewBody([pick(theme), pick(timer)]));
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
        tags: [],
      },
      'user',
    ).memory;
    const proposed = h.engine.propose({
      type: 'preference',
      scope: 'project',
      project_id: PROJECT,
      source: { session_id: null, reference: null },
      expires_at: null,
      tags: [],
      content: 'Maybe add a sunset background.',
      confidence: 0.5,
      validation_status: 'unverified',
    }).memory;
    const foreign = decision(h.engine, 'Theme: desert.', 'other-project');
    const retired = decision(h.engine, 'No countdown timer anywhere.');
    h.engine.softDelete(retired.id, { reason: 'user withdrew the rule', actor: 'user' });

    await approveGenerate(h.app);

    const cases: Array<{ body: ReviewPayload; status: number; code: string }> = [
      { body: reviewBody([pick(stale)]), status: 422, code: 'decision_superseded' },
      { body: reviewBody([pick(proposed)]), status: 422, code: 'decision_not_active' },
      { body: reviewBody([pick(foreign)]), status: 422, code: 'decision_cross_project' },
      { body: reviewBody([pick(retired)]), status: 422, code: 'decision_not_active' },
      {
        body: reviewBody([pick({ id: '9c1f2a3b-4d5e-4f60-8a71-8b9c0d0e0f01', revision: 1 })]),
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
        body: reviewBody([pick(current)], `data:image/jpeg;base64,${'A'.repeat(200)}`),
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

    const response = await postReview(h.app, reviewBody([pick(theme), pick(timer)]));
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
    const response = await postReview(h.app, reviewBody([pick(theme)]));
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('media_unconfigured');
  });

  it('refuses a decision whose wording moved under the screen, before any provider call', async () => {
    const h = await harness();
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: ocean.');
    await approveGenerate(h.app);

    // The screen is showing revision 1. The user edits the decision in place,
    // which keeps the same id and bumps the revision.
    const revised = h.engine.update(theme.id, { content: 'Theme: woodland.' }, 'user');
    expect(revised.revision).toBe(2);
    expect(revised.id).toBe(theme.id);

    const stale = await postReview(
      h.app,
      reviewBody([{ memory_id: theme.id, expected_revision: 1 }]),
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('decision_revision_conflict');
    expect(stale.json().error.message).toContain('revision 2');
    // Reviewing the *current* wording is fine, and it says which revision that
    // was, so the response cannot be mistaken for the one the screen displayed.
    const fresh = await postReview(
      h.app,
      reviewBody([{ memory_id: theme.id, expected_revision: 2 }]),
    );
    expect(fresh.statusCode).toBe(200);
    const payload = MediaVisualReviewResponseSchema.parse(fresh.json().data);
    expect(payload.findings[0]?.decision_revision).toBe(2);
    expect(payload.findings[0]?.decision_excerpt).toBe('Theme: woodland.');
    // Only the accepted review reached the model.
    expect(h.review.calls).toBe(1);
  });

  it('attaches a review to a generation of this project and to no other', async () => {
    const h = await harness();
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    const jobId = await approveGenerate(h.app);

    const pinned = await postReview(h.app, {
      ...reviewBody([pick(theme)]),
      job_id: jobId,
    });
    expect(pinned.statusCode).toBe(200);
    const payload = MediaVisualReviewResponseSchema.parse(pinned.json().data);
    // The identity echoed back comes from the server's job record.
    expect(payload.generation).toMatchObject({ id: jobId, kind: 'generate', version: 1 });
    expect(payload.artifact_changed).toBe(false);

    // A job id from another project, or one that does not exist, is refused
    // rather than quietly reviewed against the wrong generation.
    const foreignJob = h.manager
      .list(PROJECT)
      .map((job) => job.id)
      .concat(['9c1f2a3b-4d5e-4f60-8a71-8b9c0d0e0f02']);
    const other = h.manager.get(foreignJob[0] as string) as { project_id: string };
    expect(other.project_id).toBe(PROJECT);
    for (const candidate of [
      '9c1f2a3b-4d5e-4f60-8a71-8b9c0d0e0f02',
      '00000000-0000-4000-8000-000000000000',
    ]) {
      const response = await postReview(h.app, { ...reviewBody([pick(theme)]), job_id: candidate });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('invalid_job_id');
    }
    expect(h.review.calls).toBe(1);
  });

  it('refuses an id-only selection before the store or the provider is touched', async () => {
    const h = await harness();
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');

    // The contract has no optional revision: without one the route could only
    // review whatever wording the decision carries now.
    expect(
      MediaVisualReviewRequestSchema.safeParse({
        screenshot_data_url: SCREENSHOT,
        decisions: [{ memory_id: theme.id }],
      }).success,
    ).toBe(false);

    const response = await postReview(h.app, {
      screenshot_data_url: SCREENSHOT,
      decisions: [{ memory_id: theme.id }],
    });
    expect([400, 422]).toContain(response.statusCode);
    expect(h.review.calls).toBe(0);
  });

  it('refuses to call a run that was never approved a generation', async () => {
    const h = await harness();
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    const jobId = await generateOnly(h.app);

    // The run finished; nobody approved its artifact, so there is no version.
    const run = h.manager.get(jobId);
    expect(run?.status).toBe('succeeded');
    expect(run?.version).toBeNull();

    const response = await postReview(h.app, {
      ...reviewBody([pick(theme)]),
      job_id: jobId,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('invalid_job_id');
    expect(response.json().error.message).toContain('not an approved generation');
    expect(h.review.calls).toBe(0);
  });

  it('spends one call for one frame, and replays it for the same request', async () => {
    const h = await harness();
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    await approveGenerate(h.app);
    const body = reviewBody([pick(theme)]);

    const first = await postReview(h.app, body, { 'idempotency-key': 'review-frame-a-1' });
    expect(first.statusCode).toBe(200);
    const replay = await postReview(h.app, body, { 'idempotency-key': 'review-frame-a-1' });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('1');
    expect(replay.json()).toEqual(first.json());
    // The point is the provider: the answer came from the record, not a second call.
    expect(h.review.calls).toBe(1);

    // A different key is a different question: the server has no basis to call
    // it the same review, so it dispatches again.
    const second = await postReview(h.app, reviewBody([pick(theme)]), {
      'idempotency-key': 'review-frame-b-1',
    });
    expect(second.statusCode).toBe(200);
    expect(h.review.calls).toBe(2);
  });

  it('refuses a concurrent duplicate instead of paying twice', async () => {
    const gate = deferred();
    const entered = deferred();
    const h = await harness({ holdReview: gate, onEnter: () => entered.resolve() });
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    await approveGenerate(h.app);
    const body = reviewBody([pick(theme)]);

    // The rival is released only once the first review is demonstrably inside the
    // provider: a fixed sleep cannot promise that on a loaded machine, and a rival
    // that arrives after the record lands would be a replay, not a concurrent
    // duplicate — the test would pass without exercising de-duplication at all.
    const first = postReview(h.app, body, { 'idempotency-key': 'review-concurrent-1' });
    await entered.promise;
    const rival = await postReview(h.app, body, { 'idempotency-key': 'review-concurrent-1' });
    expect(rival.statusCode).toBe(409);
    expect(rival.json().error.code).toBe('idempotency_in_progress');
    expect(h.review.calls).toBe(1);

    // Let the in-flight call finish: it is the one call this key pays for.
    gate.resolve();
    const done = await first;
    expect(done.statusCode).toBe(200);
    expect(h.review.calls).toBe(1);
  });

  it('records nothing for a refusal, so the same key can be retried once it is fixed', async () => {
    const h = await harness();
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    await approveGenerate(h.app);

    // Pinned to a revision the record is not at: refused before any dispatch.
    const stale = await postReview(
      h.app,
      reviewBody([{ memory_id: theme.id, expected_revision: 99 }]),
      { 'idempotency-key': 'review-retry-1' },
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('decision_revision_conflict');
    expect(h.review.calls).toBe(0);

    const fixed = await postReview(h.app, reviewBody([pick(theme)]), {
      'idempotency-key': 'review-retry-1',
    });
    expect(fixed.statusCode).toBe(200);
    expect(h.review.calls).toBe(1);
  });

  it('will not replay feedback once the pinned decision has moved on', async () => {
    const h = await harness();
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    await approveGenerate(h.app);
    const body = reviewBody([pick(theme)]);

    const first = await postReview(h.app, body, { 'idempotency-key': 'review-stale-replay-1' });
    expect(first.statusCode).toBe(200);
    expect(h.review.calls).toBe(1);

    // The identical request now points at a record that has moved on. The key
    // matches a recorded answer, but that answer describes wording nobody
    // accepted any more, so the refusal is what comes back — not the cache.
    h.engine.update(theme.id, {
      content: 'Theme: woodland and moss.',
      expected_revision: theme.revision,
    });
    const replay = await postReview(h.app, body, { 'idempotency-key': 'review-stale-replay-1' });
    expect(replay.statusCode).toBe(409);
    expect(replay.json().error.code).toBe('decision_revision_conflict');
    expect(h.review.calls).toBe(1);
  });

  it('rejects a malformed key before touching the store or the provider', async () => {
    const h = await harness();
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    await approveGenerate(h.app);

    for (const key of [
      'short',
      'a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z,0,1,2,3,4,5',
    ]) {
      const response = await postReview(h.app, reviewBody([pick(theme)]), {
        'idempotency-key': key,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('bad_request');
    }
    expect(h.review.calls).toBe(0);
  });

  it('refuses a malformed or truncated screenshot before the provider sees a byte', async () => {
    const h = await harness();
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    await approveGenerate(h.app);
    const before = await artifactFingerprint(h);

    const cases: Array<{ label: string; bytes: Buffer; message: string }> = [
      {
        label: 'not a PNG at all',
        // Long enough to clear the schema's floor, so the refusal comes from the
        // decoder rather than the request shape.
        bytes: Buffer.from('this used to be a screenshot, repeated '.repeat(12)),
        message: 'not a valid PNG',
      },
      {
        label: 'smaller than a real capture',
        bytes: pngResized(PNG, 8, 8),
        message: 'too small',
      },
    ];

    for (const testCase of cases) {
      const response = await postReview(h.app, screenshotBody(testCase.bytes, [pick(theme)]), {
        'idempotency-key': `review-bad-${testCase.label.replace(/\W+/g, '-')}`,
      });
      expect(response.statusCode, testCase.label).toBe(400);
      expect(response.json().error.code, testCase.label).toBe('invalid_screenshot');
      expect(response.json().error.message, testCase.label).toContain(testCase.message);
    }

    // The schema's own length floor is above the decoder's header floor, so a
    // payload that reaches the decoder is never shorter than the header it reads:
    // truncation cannot smuggle a RangeError out of the route. A junk payload at
    // the largest length the schema accepts must still be a clean request error.
    const maximal = await postReview(
      h.app,
      screenshotBody(Buffer.alloc(FORGE_SCREENSHOT_DATA_URL_MAX_LENGTH * 3 - 100, 0x41), [
        pick(theme),
      ]),
      { 'idempotency-key': 'review-bad-maximal-length' },
    );
    expect([400, 413]).toContain(maximal.statusCode);
    expect(['invalid_screenshot', 'validation_failed', 'payload_too_large']).toContain(
      maximal.json().error.code,
    );

    // A non-PNG media type never reaches the decoder either.    // A non-PNG media type never reaches the decoder either.
    const jpeg = await postReview(
      h.app,
      {
        screenshot_data_url: `data:image/jpeg;base64,${PNG.toString('base64')}`,
        decisions: [pick(theme)],
      },
      { 'idempotency-key': 'review-bad-jpeg-media-type' },
    );
    expect(jpeg.statusCode).toBe(400);
    expect(jpeg.json().error.code).toBe('invalid_screenshot');

    expect(h.review.calls).toBe(0);
    expect(await artifactFingerprint(h)).toEqual(before);
  });

  it('answers a quota or auth failure as a provider failure, never a Forge conflict', async () => {
    const h = await harness({
      failWith: () =>
        new ProviderError('provider_auth_failed', 'Subscription quota exhausted.', {
          status: 429,
          attempts: 1,
        }),
    });
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    await approveGenerate(h.app);
    const before = await artifactFingerprint(h);

    const response = await postReview(h.app, reviewBody([pick(theme)]), {
      'idempotency-key': 'review-quota-1',
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('provider_auth_failed');
    // The bounded, non-secret telemetry survives: who was called, with what
    // status, and how many dispatches it took.
    expect(response.json().error.details).toEqual({ status: 429, attempts: 1 });
    expect(JSON.stringify(response.json())).not.toContain('data:image/png');
    expect(await artifactFingerprint(h)).toEqual(before);
  });

  it('keeps the bounded stream evidence for a timeout or an unusable answer', async () => {
    const sha = 'a'.repeat(64);
    const h = await harness({
      failWith: (call) =>
        call === 1
          ? new ProviderError('provider_timeout', 'The review exceeded its wall-clock budget.', {
              attempts: 1,
              stream_events: 9,
              stream_bytes: 3234,
              response_sha256: sha,
              delta_events: 1,
              ignored_events: 8,
            })
          : new ProviderError('provider_invalid_output', 'The review answer was not usable JSON.', {
              attempts: 1,
              stream_events: 2,
              response_sha256: sha,
            }),
    });
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    await approveGenerate(h.app);

    const timedOut = await postReview(h.app, reviewBody([pick(theme)]), {
      'idempotency-key': 'review-timeout-1',
    });
    expect(timedOut.statusCode).toBe(504);
    expect(timedOut.json().error.code).toBe('provider_timeout');
    expect(timedOut.json().error.details).toEqual({
      attempts: 1,
      stream_events: 9,
      stream_bytes: 3234,
      response_sha256: sha,
      delta_events: 1,
      ignored_events: 8,
    });

    const unusable = await postReview(h.app, reviewBody([pick(theme)]), {
      'idempotency-key': 'review-invalid-1',
    });
    // An unusable provider answer is a provider fault (502), not something the
    // user wrote wrongly; only our own malformed request would be a 400.
    expect(unusable.statusCode).toBe(502);
    expect(unusable.json().error.code).toBe('provider_invalid_output');
    expect(unusable.json().error.details.response_sha256).toBe(sha);
    expect(h.review.calls).toBe(2);
  });

  it('leaves a failed review retryable: nothing is recorded and the artifact is untouched', async () => {
    const h = await harness({
      // A storage fault the server did not name: the route must not pretend it
      // is the client's mistake, and must not answer 200 with no feedback.
      failWith: (call) =>
        call === 1 ? new Error('ENOSPC: no space left on device, write') : undefined,
    });
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    await approveGenerate(h.app);
    const before = await artifactFingerprint(h);
    const body = reviewBody([pick(theme)]);

    const failed = await postReview(h.app, body, {
      'idempotency-key': 'review-retry-after-failure',
    });
    expect(failed.statusCode).toBe(500);
    expect(failed.json().error.code).toBe('internal_error');
    // The storage detail stays in the server log, not in the client's error.
    expect(JSON.stringify(failed.json())).not.toContain('ENOSPC');

    // Same key, now that the cause is gone: a failure must not become a cached
    // answer that the user is stuck with.
    const retry = await postReview(h.app, body, {
      'idempotency-key': 'review-retry-after-failure',
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    expect(h.review.calls).toBe(2);
    expect(await artifactFingerprint(h)).toEqual(before);
  });

  it('refuses a key that was already spent on a different selection', async () => {
    const h = await harness();
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    const timer = decision(h.engine, 'Never show a countdown timer.');
    await approveGenerate(h.app);

    const first = await postReview(h.app, reviewBody([pick(theme)]), {
      'idempotency-key': 'review-swapped-selection',
    });
    expect(first.statusCode).toBe(200);

    // Same key, still a valid request, different question. The answer on file
    // describes the theme; serving it for the timer would be feedback about
    // something else wearing the identity of a review of this decision.
    const rival = await postReview(h.app, reviewBody([pick(timer)]), {
      'idempotency-key': 'review-swapped-selection',
    });
    expect(rival.statusCode).toBe(409);
    expect(rival.json().error.code).toBe('idempotency_key_reused');
    expect(JSON.stringify(rival.json())).not.toContain('blue bar');
    expect(h.review.calls).toBe(1);
  });

  it('refuses a key that was already spent on a different frame', async () => {
    const h = await harness();
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    await approveGenerate(h.app);
    const selection = [pick(theme)];

    const first = await postReview(h.app, reviewBody(selection), {
      'idempotency-key': 'review-swapped-frame',
    });
    expect(first.statusCode).toBe(200);
    const firstFrame = (first.json().data as { screenshot_sha256: string }).screenshot_sha256;

    // Bytes after IEND change the fingerprint while leaving a frame a decoder
    // still reads: a genuinely different capture, not a malformed request.
    const other = Buffer.concat([PNG, Buffer.from('a second capture')]);
    const rival = await postReview(h.app, screenshotBody(other, selection), {
      'idempotency-key': 'review-swapped-frame',
    });
    expect(rival.statusCode).toBe(409);
    expect(rival.json().error.code).toBe('idempotency_key_reused');
    expect(h.review.calls).toBe(1);

    // The original answer stays reachable for the frame it was recorded against.
    const replay = await postReview(h.app, reviewBody(selection), {
      'idempotency-key': 'review-swapped-frame',
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('1');
    expect((replay.json().data as { screenshot_sha256: string }).screenshot_sha256).toBe(
      firstFrame,
    );
    expect(h.review.calls).toBe(1);
  });

  it('refuses a key that was already spent against a different generation', async () => {
    const h = await harness();
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    const jobId = await approveGenerate(h.app);

    const unbound = await postReview(h.app, reviewBody([pick(theme)]), {
      'idempotency-key': 'review-swapped-generation',
    });
    expect(unbound.statusCode).toBe(200);

    // Same frame, same decisions, now filed against a named generation: the
    // recorded answer says it reviewed nothing in particular.
    const bound = await postReview(
      h.app,
      { ...reviewBody([pick(theme)]), job_id: jobId },
      {
        'idempotency-key': 'review-swapped-generation',
      },
    );
    expect(bound.statusCode).toBe(409);
    expect(bound.json().error.code).toBe('idempotency_key_reused');
    expect(h.review.calls).toBe(1);
  });

  it('still returns a paid-for answer when the replay record cannot be written', async () => {
    const h = await harness({ recordFault: true });
    await createProject(h.app);
    const theme = decision(h.engine, 'Theme: woodland.');
    await approveGenerate(h.app);
    const body = reviewBody([pick(theme)]);

    const first = await postReview(h.app, body, { 'idempotency-key': 'review-record-fault' });
    expect(first.statusCode).toBe(200);
    expect(JSON.stringify(first.json())).toContain('blue bar');

    // The record was lost, so there is nothing to replay: the client pays for a
    // second look rather than being handed an error after the model already
    // answered. Losing the cache is a logging event, not a failed review.
    const retry = await postReview(h.app, body, { 'idempotency-key': 'review-record-fault' });
    expect(retry.statusCode).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    expect(h.review.calls).toBe(2);
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
      MediaVisualReviewRequestSchema.safeParse(reviewBody([pick(theme)], 'data:image/png;base64,'))
        .success,
    ).toBe(false);
    expect(MediaVisualReviewRequestSchema.safeParse(reviewBody([pick(theme)])).success).toBe(true);
  });
});
