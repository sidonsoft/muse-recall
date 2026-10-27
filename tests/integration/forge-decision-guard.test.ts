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
import { ForgeJobManager } from '../../apps/server/src/forge/runner.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import { ProviderHealthTracker } from '../../apps/server/src/provider-health.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/fake-muse.mjs', import.meta.url));
const BASELINE = fileURLToPath(new URL('../../demo/forge-baseline/index.html', import.meta.url));

/** 64×64 solid PNG for the modify flow. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsItoHOMY1Qi+hcEKLDX9WgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQELguAI4FLuAoFBQAAAABJRU5ErkJggg==';

const PROMPT = 'A colourful farmyard memory game for children with twelve cards.';

type RuntimeCheck = (html: string) => Promise<{ ok: boolean; errors: string[] }>;

interface Harness {
  app: FastifyInstance;
  engine: MemoryEngine;
  manager: ForgeJobManager;
  root: string;
  sourcePath: string;
  events: string[];
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

function game(body: string): string {
  return `<!doctype html><html><head><title>Decision Test Game</title>
<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>
</head><body><div id="game"></div><script>
${body}
new Phaser.Game({ type: Phaser.AUTO, width: 640, height: 480, parent: 'game', scene: { create: function(){} } });
</script><p>SOURCE_TAIL_MARKER</p></body></html>`;
}

const COMPLIANT_SOURCE = game(
  'var elapsed = 0; var score = 0; function pick(){ score += 10; elapsed += 1; }',
);
const PALETTE_SOURCE = `<!doctype html><html><head><title>Palette Test</title>
<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>
<style>:root { --accent: #FF7E5F; }</style></head><body><div id="game"></div><script>
new Phaser.Game({ type: Phaser.AUTO, width: 640, height: 480, parent: 'game', scene: { create: function(){} } });
</script></body></html>`;
const VIOLATION_SOURCE = game(
  'var timeLeft = 30; var score = 0; setInterval(function(){ timeLeft -= 1; }, 1000); function wrongPick(){ score -= 5; }',
);

async function harness(
  options: { runtimeCheck?: RuntimeCheck; source?: string } = {},
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'forge-guard-'));
  const sourcePath = join(root, 'source.html');
  await writeFile(sourcePath, options.source ?? COMPLIANT_SOURCE, 'utf8');
  const database = openDatabase({ path: ':memory:', wal: false });
  const engine = new MemoryEngine(database.db);
  const workspace = new ForgeWorkspace(root);
  const events: string[] = [];
  let tick = 0;
  const base = Date.UTC(2026, 9, 27, 4, 0, 0);
  const now = () => new Date(base + tick++ * 1000);
  const runtimeCheck: RuntimeCheck =
    options.runtimeCheck ??
    (async () => {
      events.push(`runtime:start:${now().toISOString()}`);
      events.push(`runtime:ok:${now().toISOString()}`);
      return { ok: true, errors: [] };
    });
  const manager = new ForgeJobManager({
    workspace,
    engine,
    museBin: FIXTURE,
    env: { FAKE_MUSE_MODE: 'copy', FAKE_MUSE_HTML: sourcePath },
    maxRuntimeMs: 10_000,
    maxCalls: 10,
    maxInputTokens: 10_000_000,
    reasoningEffort: 'low',
    runtimeCheck,
    now,
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
    manager,
    root,
    sourcePath,
    events,
    close: async () => {
      await app.close();
      database.close();
    },
  };
  open.push(instance);
  return instance;
}

function constraint(h: Harness, projectId: string, content: string) {
  return h.engine.create({
    type: 'constraint',
    scope: 'project',
    project_id: projectId,
    content,
    confidence: 0.9,
    validation_status: 'verified',
  }).memory;
}

async function createProject(app: FastifyInstance, id = 'demo-game') {
  const response = await app.inject({
    method: 'POST',
    url: '/api/forge/projects',
    payload: { project_id: id, name: 'Decision Game' },
  });
  expect(response.statusCode).toBe(200);
}

async function startGenerate(app: FastifyInstance, id = 'demo-game') {
  const response = await app.inject({
    method: 'POST',
    url: `/api/forge/projects/${id}/generate`,
    payload: { prompt: PROMPT },
  });
  expect(response.statusCode).toBe(202);
  return response.json().data.id as string;
}

async function startModify(app: FastifyInstance, id = 'demo-game') {
  const response = await app.inject({
    method: 'POST',
    url: `/api/forge/projects/${id}/modify`,
    payload: {
      request: 'Make the cards larger and add a sunset background.',
      screenshot_data_url: PNG,
    },
  });
  expect(response.statusCode).toBe(202);
  return response.json().data.id as string;
}

type JobView = {
  id: string;
  status: string;
  version: number | null;
  validation: { ok: boolean; issues: string[] } | null;
  decision_guard: {
    mode: string;
    engine_version: string;
    engine_verdict: string;
    assessment: string;
    assessment_reason: string;
    findings: Array<Record<string, unknown>>;
    unverified: Array<Record<string, unknown>>;
    evaluated_memory_ids: string[];
    superseded_memory_ids: string[];
    source_sha256: string | null;
    runtime_verified: boolean;
    evaluated_at: string;
  } | null;
  memory_ids: string[];
  error: string | null;
};

async function job(app: FastifyInstance, jobId: string): Promise<JobView> {
  const response = await app.inject({ method: 'GET', url: `/api/forge/jobs/${jobId}` });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().data as JobView;
}

async function waitForFinish(app: FastifyInstance, jobId: string): Promise<JobView> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const current = await job(app, jobId);
    if (
      ['succeeded', 'failed', 'cancelled', 'budget_exceeded', 'rejected'].includes(current.status)
    ) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('job did not finish');
}

async function approve(app: FastifyInstance, jobId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/forge/jobs/${jobId}/approve`,
    payload: { capture_memory: false },
  });
}

describe('Decision Guard advisory integration', () => {
  it('snapshots after structural validation, then re-snapshots after runtime verification', async () => {
    const h = await harness();
    const decision = constraint(
      h,
      'demo-game',
      'Children’s game: avoid flashing effects, countdown timers, and penalties for mistakes.',
    );
    await createProject(h.app);
    const generated = await startGenerate(h.app);
    const reviewed = await waitForFinish(h.app, generated);

    expect(reviewed.status).toBe('succeeded');
    expect(reviewed.decision_guard?.mode).toBe('advisory');
    expect(reviewed.decision_guard?.runtime_verified).toBe(false);
    expect(reviewed.memory_ids).toContain(decision.id);
    expect(reviewed.decision_guard?.evaluated_memory_ids).toContain(decision.id);
    expect(reviewed.decision_guard?.source_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(reviewed.validation?.ok).toBe(true);

    const approved = await approve(h.app, generated);
    expect(approved.statusCode).toBe(200);
    const applied = approved.json().data.job as JobView;
    expect(applied.decision_guard?.runtime_verified).toBe(true);

    const runtimeAt = h.events
      .find((entry) => entry.startsWith('runtime:ok:'))
      ?.replace('runtime:ok:', '');
    expect(runtimeAt).toBeTruthy();
    expect(Date.parse(String(applied.decision_guard?.evaluated_at))).toBeGreaterThan(
      Date.parse(String(runtimeAt)),
    );
  });

  it('records an advisory violation without changing validation or blocking approval', async () => {
    const h = await harness({ source: VIOLATION_SOURCE });
    const decision = constraint(
      h,
      'demo-game',
      'Children’s game: avoid flashing effects, countdown timers, and penalties for mistakes.',
    );
    await createProject(h.app);
    const generated = await startGenerate(h.app);
    const reviewed = await waitForFinish(h.app, generated);

    expect(reviewed.status).toBe('succeeded');
    expect(reviewed.validation?.ok).toBe(true);
    expect(reviewed.decision_guard?.engine_verdict).toBe('BLOCK');
    expect(reviewed.decision_guard?.assessment).toBe('violation_detected');
    const rules = (reviewed.decision_guard?.findings ?? []).map((finding) => finding.rule);
    expect(rules).toContain('countdown-mechanics');
    expect(rules).toContain('mistake-penalty');
    for (const finding of reviewed.decision_guard?.findings ?? []) {
      expect(finding.decision_id).toBe(decision.id);
      expect(finding.kind).toBe('violation');
      expect(finding.blocks_approval).toBeUndefined();
    }

    // Advisory only: approval succeeds and the version is promoted.
    const approved = await approve(h.app, generated);
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data.state.current_version).toBe(1);
    const applied = approved.json().data.job as JobView;
    expect(applied.version).toBe(1);
    expect(applied.decision_guard?.engine_verdict).toBe('BLOCK');
    expect(applied.validation?.ok).toBe(true);
  });

  it('distinguishes a supported clean pass from an unverified or unavailable evaluation', async () => {
    const clean = await harness();
    const cleanDecision = constraint(
      clean,
      'demo-game',
      'Children’s game: avoid countdown timers and penalties for mistakes.',
    );
    await createProject(clean.app);
    const cleanJob = await startGenerate(clean.app);
    const cleanReviewed = await waitForFinish(clean.app, cleanJob);
    expect(cleanReviewed.validation?.ok).toBe(true);
    expect(cleanReviewed.decision_guard?.engine_verdict).toBe('PASS');
    expect(cleanReviewed.decision_guard?.assessment).toBe('no_violation_detected');
    expect(cleanReviewed.decision_guard?.assessment_reason).toMatch(/not a certification/);
    expect(cleanReviewed.decision_guard?.evaluated_memory_ids).toEqual([cleanDecision.id]);

    const none = await harness();
    await createProject(none.app);
    const noDecisionJob = await startGenerate(none.app);
    const noDecisionReviewed = await waitForFinish(none.app, noDecisionJob);
    expect(noDecisionReviewed.decision_guard?.assessment).toBe('not_verified');
    expect(
      (noDecisionReviewed.decision_guard?.unverified ?? []).map((entry) => entry.code),
    ).toContain('no_decisions');
    expect(noDecisionReviewed.decision_guard?.assessment_reason).toMatch(/no remembered decision/);

    const unsupported = await harness();
    constraint(unsupported, 'demo-game', 'Prefer rounded corners on all game panels.');
    await createProject(unsupported.app);
    const unsupportedJob = await startGenerate(unsupported.app);
    const unsupportedReviewed = await waitForFinish(unsupported.app, unsupportedJob);
    expect(unsupportedReviewed.decision_guard?.assessment).toBe('not_verified');
    expect(unsupportedReviewed.decision_guard?.engine_verdict).toBe('UNVERIFIED');
  });

  it('redacts credentials from findings, records, logs and the diff advisory', async () => {
    const evidenceSecret = 'sk-live-EVIDENCESECRET42';
    const memorySecret = 'sk-live-MEMORYSECRET42';
    const h = await harness({
      source: game(
        `var timeLeft = 10; var key = '${evidenceSecret}'; setInterval(function(){ timeLeft -= 1; }, 1000);`,
      ),
    });
    constraint(
      h,
      'demo-game',
      `Avoid countdown timers. Never persist ${memorySecret} in project memory.`,
    );
    await createProject(h.app);
    const generated = await startGenerate(h.app);
    const finished = await waitForFinish(h.app, generated);

    expect(finished.decision_guard?.assessment).toBe('violation_detected');
    expect(finished.decision_guard?.findings.length).toBeGreaterThan(0);
    expect(JSON.stringify(finished.decision_guard)).not.toContain(evidenceSecret);
    expect(JSON.stringify(finished.decision_guard)).not.toContain(memorySecret);

    const response = await h.app.inject({
      method: 'GET',
      url: `/api/forge/jobs/${generated}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(evidenceSecret);
    expect(response.body).not.toContain(memorySecret);

    const persisted = await readFile(
      join(h.root, 'forge', 'demo-game', 'jobs', `${generated}.json`),
      'utf8',
    );
    expect(persisted).not.toContain(evidenceSecret);
    expect(persisted).not.toContain(memorySecret);

    const logs = (h.manager.get(generated)?.logs ?? []).join('\n');
    expect(logs).not.toContain(evidenceSecret);
    expect(logs).not.toContain(memorySecret);

    const diff = await h.app.inject({
      method: 'GET',
      url: `/api/forge/jobs/${generated}/diff`,
    });
    expect(diff.statusCode).toBe(200);
    expect(JSON.stringify(diff.json().data.decision_guard)).not.toContain(evidenceSecret);
    expect(JSON.stringify(diff.json().data.decision_guard)).not.toContain(memorySecret);

    // The generated source itself is the reviewed artifact; it is deliberately
    // not rewritten. Only projected findings/records are redacted.
    const staged = await readFile(
      join(h.root, 'forge', 'demo-game', 'staging', generated, 'index.html'),
      'utf8',
    );
    expect(staged).toContain(evidenceSecret);
  });

  it('evaluates the active correction with superseded history resolved separately', async () => {
    const h = await harness({ source: PALETTE_SOURCE });
    const sunset = constraint(
      h,
      'demo-game',
      'Art direction: warm sunset palette. Primary accent #FF7E5F and dark text #2D1E2F.',
    );
    const corrected = h.engine.correct({
      type: 'constraint',
      scope: 'project',
      project_id: 'demo-game',
      content: 'Art direction: cool ocean palette. Primary accent #4EA8DE and dark text #102A43.',
      source: { session_id: null, reference: 'test-correction' },
      confidence: 0.95,
      validation_status: 'verified',
      tags: [],
      supersedes: [sunset.id],
    }).memory;

    await createProject(h.app);
    const generated = await startGenerate(h.app);
    const reviewed = await waitForFinish(h.app, generated);

    expect(reviewed.memory_ids).toContain(corrected.id);
    expect(reviewed.memory_ids).not.toContain(sunset.id);
    expect(reviewed.decision_guard?.evaluated_memory_ids).toEqual([corrected.id]);
    expect(reviewed.decision_guard?.superseded_memory_ids).toEqual([sunset.id]);
    const finding = reviewed.decision_guard?.findings.find(
      (entry) => entry.rule === 'superseded-palette',
    );
    expect(finding?.decision_id).toBe(corrected.id);
    expect(String(finding?.explanation)).toContain('superseded palette');
    expect(reviewed.validation?.ok).toBe(true);
  });

  it('excludes a decision superseded after the job started and says so', async () => {
    const h = await harness();
    const sunset = constraint(
      h,
      'demo-game',
      'Art direction: warm sunset palette. Primary accent #FF7E5F and dark text #2D1E2F.',
    );
    await createProject(h.app);
    const generated = await startGenerate(h.app);
    const reviewed = await waitForFinish(h.app, generated);
    expect(reviewed.memory_ids).toContain(sunset.id);
    expect(reviewed.decision_guard?.evaluated_memory_ids).toContain(sunset.id);

    // The decision is corrected while the change waits for review.
    h.engine.correct({
      type: 'constraint',
      scope: 'project',
      project_id: 'demo-game',
      content: 'Art direction: cool ocean palette. Primary accent #4EA8DE and dark text #102A43.',
      source: { session_id: null, reference: 'test-correction' },
      confidence: 0.95,
      validation_status: 'verified',
      tags: [],
      supersedes: [sunset.id],
    });

    const approved = await approve(h.app, generated);
    expect(approved.statusCode).toBe(200);
    const applied = approved.json().data.job as JobView;
    expect(applied.decision_guard?.evaluated_memory_ids).not.toContain(sunset.id);
    expect(applied.decision_guard?.engine_verdict).toBe('UNVERIFIED');
    const limitation = applied.decision_guard?.unverified.find(
      (entry) => entry.decision_id === sunset.id,
    );
    expect(limitation?.code).toBe('decision_not_active');
    // The newly created replacement was never part of this job.
    expect(applied.decision_guard?.evaluated_memory_ids).toEqual([]);
  });

  it('records an explicit limitation when a recorded memory can no longer be resolved', async () => {
    const h = await harness();
    const decision = constraint(h, 'demo-game', 'Avoid countdown timers in children’s games.');
    await createProject(h.app);
    const generated = await startGenerate(h.app);
    await waitForFinish(h.app, generated);

    h.engine.softDelete(decision.id, { reason: 'test-deleted' });
    const approved = await approve(h.app, generated);
    expect(approved.statusCode).toBe(200);
    const applied = approved.json().data.job as JobView;
    expect(applied.decision_guard?.engine_verdict).toBe('UNVERIFIED');
    const limitation = applied.decision_guard?.unverified.find(
      (entry) => entry.decision_id === decision.id,
    );
    expect(limitation?.code).toBe('memory_unresolved');
    expect(String(limitation?.reason)).toMatch(/could not be resolved/);
    expect(applied.validation?.ok).toBe(true);
  });

  it('keeps project isolation when a recorded id belongs to another project', async () => {
    const h = await harness({ source: VIOLATION_SOURCE });
    await createProject(h.app, 'project-a');
    await createProject(h.app, 'project-b');
    const foreign = constraint(h, 'project-b', 'Avoid countdown timers and mistake penalties.');
    const generated = await startGenerate(h.app, 'project-a');
    const reviewed = await waitForFinish(h.app, generated);
    expect(reviewed.memory_ids).toEqual([]);

    // Simulate a corrupted job record: another project's id is not part of the
    // original retrieval, but if it appears the guard must refuse to use it.
    const stored = h.manager.get(generated);
    expect(stored).toBeDefined();
    stored?.memory_ids.push(foreign.id);

    const approved = await approve(h.app, generated);
    expect(approved.statusCode).toBe(200);
    const applied = approved.json().data.job as JobView;
    expect(applied.decision_guard?.evaluated_memory_ids).not.toContain(foreign.id);
    expect(
      (applied.decision_guard?.findings ?? []).some((entry) => entry.decision_id === foreign.id),
    ).toBe(false);
    const limitation = applied.decision_guard?.unverified.find(
      (entry) => entry.decision_id === foreign.id,
    );
    expect(limitation?.code).toBe('cross_project');
  });

  it('marks an unsupported decision UNVERIFIED and never reports PASS', async () => {
    const h = await harness();
    const decision = constraint(h, 'demo-game', 'Prefer rounded corners on all game panels.');
    await createProject(h.app);
    const generated = await startGenerate(h.app);
    const reviewed = await waitForFinish(h.app, generated);
    expect(reviewed.decision_guard?.evaluated_memory_ids).toEqual([decision.id]);
    expect(reviewed.decision_guard?.engine_verdict).toBe('UNVERIFIED');
    expect(reviewed.decision_guard?.findings).toEqual([]);
    const limitation = reviewed.decision_guard?.unverified.find(
      (entry) => entry.decision_id === decision.id,
    );
    expect(limitation?.code).toBe('unsupported_decision');
  });

  it('reports no finding for authentic compliant generated source', async () => {
    const h = await harness({ source: await readFile(BASELINE, 'utf8') });
    constraint(
      h,
      'demo-game',
      'Children’s game: avoid flashing effects, countdown timers, and penalties for mistakes.',
    );
    await createProject(h.app);
    const generated = await startGenerate(h.app);
    const reviewed = await waitForFinish(h.app, generated);
    expect(reviewed.status, JSON.stringify(reviewed)).toBe('succeeded');
    expect(reviewed.validation?.ok).toBe(true);
    expect(reviewed.decision_guard?.engine_verdict).toBe('PASS');
    expect(reviewed.decision_guard?.findings).toEqual([]);
    expect(reviewed.decision_guard?.unverified).toEqual([]);
  });

  it('keeps runtime failure blocking and leaves the advisory snapshotted as unverified', async () => {
    const h = await harness({
      source: VIOLATION_SOURCE,
      runtimeCheck: async () => ({ ok: false, errors: ['Graphics.fillStar is not a function'] }),
    });
    constraint(h, 'demo-game', 'Avoid countdown timers and mistake penalties.');
    await createProject(h.app);
    const generated = await startGenerate(h.app);
    await waitForFinish(h.app, generated);

    const approved = await approve(h.app, generated);
    expect(approved.statusCode).toBe(422);
    expect(approved.json().error.code).toBe('runtime_failed');
    expect(approved.json().error.issues.join(' ')).toMatch(/fillStar/);

    const after = await job(h.app, generated);
    expect(after.status).toBe('failed');
    expect(after.validation?.ok).toBe(false);
    expect(after.decision_guard?.runtime_verified).toBe(false);
    expect(after.version).toBeNull();
    const state = await h.app.inject({ method: 'GET', url: '/api/forge/projects/demo-game' });
    expect(state.json().data.state.current_version).toBeNull();
  });

  it('serialises the advisory safely beside — not inside — validation', async () => {
    const h = await harness({
      source: game(
        'var timeLeft=10;/*<img src=x onerror="alert(1)">*/var score=0;setInterval(function(){timeLeft-=1;},1000);function wrong(){score-=1;}',
      ),
    });
    const decision = constraint(h, 'demo-game', 'Avoid countdown timers and mistake penalties.');
    await createProject(h.app);
    const generated = await startGenerate(h.app);
    await waitForFinish(h.app, generated);

    const response = await h.app.inject({ method: 'GET', url: `/api/forge/jobs/${generated}` });
    expect(response.statusCode).toBe(200);
    expect(String(response.headers['content-type'])).toContain('application/json');
    const body = response.body;
    expect(body.length).toBeLessThan(64_000);
    expect(body).not.toContain('SOURCE_TAIL_MARKER');
    expect(body).not.toContain(h.root);
    expect(body).not.toContain('/Users/');

    const parsed = JSON.parse(body).data as JobView;
    expect(parsed.validation?.ok).toBe(true);
    expect(parsed.decision_guard?.mode).toBe('advisory');
    expect(parsed.decision_guard?.engine_verdict).toBe('BLOCK');
    expect(parsed.decision_guard?.assessment).toBe('violation_detected');
    expect(parsed.decision_guard?.assessment_reason).toMatch(/advisory/);
    const finding = parsed.decision_guard?.findings[0];
    expect(finding?.decision_id).toBe(decision.id);
    expect(String(finding?.evidence).length).toBeLessThanOrEqual(240);
    expect(String(finding?.evidence)).toContain('timeLeft');
    expect(String(finding?.evidence)).not.toContain('\n');
    for (const value of Object.values(finding ?? {})) {
      if (typeof value === 'string') expect(value.length).toBeLessThanOrEqual(400);
    }

    // The diff carries the same advisory for the review panel, still separate
    // from the structural validation verdict.
    const diff = await h.app.inject({
      method: 'GET',
      url: `/api/forge/jobs/${generated}/diff`,
    });
    expect(diff.statusCode).toBe(200);
    const diffBody = diff.json().data as JobView & { decision_guard: JobView['decision_guard'] };
    expect(diffBody.decision_guard?.mode).toBe('advisory');
    expect((diffBody as unknown as { validation: { ok: boolean } }).validation.ok).toBe(true);
  });

  it('keeps stale-base CAS protection while advisories are recorded', async () => {
    const h = await harness();
    constraint(h, 'demo-game', 'Avoid countdown timers and mistake penalties.');
    await createProject(h.app);
    const base = await startGenerate(h.app);
    await waitForFinish(h.app, base);
    expect((await approve(h.app, base)).statusCode).toBe(200);

    await writeFile(h.sourcePath, game("var MARKER = 'first';"), 'utf8');
    const first = await startModify(h.app);
    await waitForFinish(h.app, first);

    await writeFile(h.sourcePath, game("var MARKER = 'second';"), 'utf8');
    const second = await startModify(h.app);
    await waitForFinish(h.app, second);

    expect((await approve(h.app, first)).statusCode).toBe(200);
    const stale = await approve(h.app, second);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('version_conflict');
  });

  it('keeps rollback functional after an advisory-blocked-but-approved change', async () => {
    const h = await harness({ source: VIOLATION_SOURCE });
    constraint(h, 'demo-game', 'Avoid countdown timers and mistake penalties.');
    await createProject(h.app);
    const v1 = await startGenerate(h.app);
    await waitForFinish(h.app, v1);
    expect((await approve(h.app, v1)).statusCode).toBe(200);

    await writeFile(h.sourcePath, game("var MARKER = 'v2';"), 'utf8');
    const v2 = await startModify(h.app);
    await waitForFinish(h.app, v2);
    const applied = await approve(h.app, v2);
    expect(applied.statusCode).toBe(200);
    expect(applied.json().data.state.current_version).toBe(2);

    const rollback = await h.app.inject({
      method: 'POST',
      url: '/api/forge/projects/demo-game/rollback',
      payload: {},
    });
    expect(rollback.statusCode).toBe(200);
    expect(rollback.json().data.current_version).toBe(1);
    const preview = await h.app.inject({
      method: 'GET',
      url: '/api/forge/projects/demo-game/preview',
    });
    expect(preview.body).toContain('timeLeft');
  });
});
