import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEngine, openDatabase } from '@mml/memory-engine';
import { EchoProvider } from '@mml/muse-provider';
import { type HealthResponse, HealthResponseSchema } from '@mml/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../apps/server/src/app.js';
import type { AppConfig } from '../../apps/server/src/config.js';
import { SERVICE_VERSION } from '../../apps/server/src/config.js';
import { ForgeWorkspace } from '../../apps/server/src/forge/workspace.js';
import {
  formatSetupPanel,
  gatherDemoSeedFacts,
  probeSetupReadiness,
  SEEDED_DEMO_PROJECT,
} from '../../apps/server/src/setup-readiness.js';

/**
 * The setup readiness block inside GET /api/health, exercised with the real
 * Forge workspace and a real SQLite file.
 *
 * The unit tests cover the probe's decisions from supplied facts; this covers the
 * wiring *and* the facts themselves, because the interesting failure mode is a
 * probe that calls the demo "ready" from something weaker — a database file that
 * exists, a workspace directory that exists, an unrelated project. A judge who is
 * told the demo is seeded and then opens an empty Studio stops trusting every row
 * on the panel, so these tests pin the negative cases:
 *
 *   - a fresh instance with nothing seeded: `missing`, with the seed command;
 *   - an unrelated project that *is* seeded: the demo is still `missing`;
 *   - a real seeded demo: `ready`, and the detail names what was inspected;
 *   - a demo whose artifact no longer matches its recorded hash: `missing`, and
 *     the panel says the app will refuse to serve those bytes.
 *
 * Nothing here mutates a real user's data: every fixture lives in a temp
 * directory, and the probe's own reads are asserted not to create or repair
 * anything.
 */

const openApps: FastifyInstance[] = [];
const openDatabases: { close: () => void }[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
  for (const database of openDatabases.splice(0)) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function testConfig(workspaceRoot: string, databasePath: string): AppConfig {
  return {
    environment: 'test',
    host: '127.0.0.1',
    port: 8787,
    logLevel: 'silent',
    corsOrigins: [],
    databasePath,
    wal: false,
    workspaceRoot,
    toolApprovalPolicy: 'always',
    provider: { kind: 'echo', museBin: 'muse' },
    memoryBudget: { max_memories: 8, max_characters: 4_000, max_memory_characters: 1_000 },
    sweepOnStart: true,
    alertBackupMaxAgeHours: 24,
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

async function fixture(overrides: Partial<AppConfig> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'setup-readiness-health-'));
  roots.push(dir);
  const dbFile = join(dir, 'app.db');
  const database = openDatabase({ path: dbFile, wal: false });
  openDatabases.push(database);
  const engine = new MemoryEngine(database.db);
  const workspaceRoot = join(dir, 'workspaces');
  const app = await buildApp({
    config: { ...testConfig(workspaceRoot, dbFile), ...overrides },
    db: database.db,
    dbPath: dbFile,
    provider: new EchoProvider(),
    engine,
  });
  openApps.push(app);
  return { app, engine, dbFile, workspaceRoot };
}

async function health(app: FastifyInstance): Promise<HealthResponse> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/health',
    headers: { host: '127.0.0.1:8787' },
  });
  expect(response.statusCode).toBe(200);
  const payload = response.json().data as HealthResponse;
  expect(() => HealthResponseSchema.parse(payload)).not.toThrow();
  return payload;
}

/**
 * Write a project the same shape the product uses on disk: a `state.json` that
 * points at an approved version, and the version file itself. `recordedSha` may
 * deliberately disagree with `bytes` to stage a corrupted artifact.
 */
async function writeForgeProject(
  workspaceRoot: string,
  projectId: string,
  options: { bytes: string; recordedSha?: string },
): Promise<string> {
  const sha =
    options.recordedSha ?? createHash('sha256').update(options.bytes, 'utf8').digest('hex');
  const projectDir = join(workspaceRoot, 'forge', projectId);
  await mkdir(join(projectDir, 'versions', '1'), { recursive: true });
  await writeFile(
    join(projectDir, 'state.json'),
    JSON.stringify({
      project_id: projectId,
      current_version: 1,
      versions: [
        {
          version: 1,
          created_at: '2026-10-27T00:00:00.000Z',
          summary: 'fixture baseline',
          sha256: sha,
        },
      ],
      can_rollback: false,
    }),
  );
  await writeFile(join(projectDir, 'versions', '1', 'index.html'), options.bytes, 'utf8');
  return sha;
}

describe('setup readiness in GET /api/health', () => {
  it('reports the prerequisite states for an unseeded, credential-free test instance', async () => {
    const { app } = await fixture();
    const setup = (await health(app)).setup;
    expect(setup).toBeTruthy();
    // The environment is whatever runs the suite; both are honest answers.
    expect(['local', 'codespaces']).toContain(setup?.environment);
    expect(setup?.provider).toBe('echo');
    // Offline provider on purpose: generation is off by design, not broken.
    expect(setup?.cli.state).toBe('not_available');
    // No media key in this instance's configuration, and nothing was probed live.
    expect(setup?.media_api.state).toBe('missing');
    expect(setup?.media_api.fix).toContain('FORGE_MUSE_API_KEY');
    // A fresh temp workspace has no seeded demo, which is the most common reason
    // a first Studio session looks empty.
    expect(setup?.offline_seed.state).toBe('missing');
    expect(setup?.offline_seed.detail).toContain(SEEDED_DEMO_PROJECT);
    expect(setup?.offline_seed.fix).toContain('pnpm demo:seed');
    // The browser row is machine-dependent, so only its shape is pinned: whatever
    // it says, it says what it actually checked.
    expect(['ready', 'missing', 'not_available', 'not_probed']).toContain(setup?.browser.state);
    expect((setup?.browser.detail ?? '').length).toBeGreaterThan(10);
    if (setup?.browser.state === 'missing') {
      expect(setup.browser.fix).toContain('playwright-core install chromium');
    }
  });

  it('serves health with maximum-length model IDs and a long demo name', async () => {
    const key = 'a-private-server-key';
    const { app, engine, workspaceRoot } = await fixture({
      forge: {
        maxRuntimeMs: 600_000,
        maxCalls: 25,
        maxInputTokens: 1_500_000,
        museBin: null,
        apiKey: key,
        model: null,
        fallbackApiKey: null,
        fallbackModel: null,
        reasoningEffort: 'medium',
      },
      media: { model: 'i'.repeat(200), samModel: 's'.repeat(200), visionModel: 'vision-test' },
    });
    engine.ensureProject(SEEDED_DEMO_PROJECT, 'Demo project '.repeat(20));
    await writeForgeProject(workspaceRoot, SEEDED_DEMO_PROJECT, {
      bytes: '<!doctype html><title>Demo</title>',
    });
    const setup = (await health(app)).setup;
    expect(setup?.media_api.state).toBe('ready');
    expect(setup?.media_api.detail).toContain('quota are unverified');
    expect(setup?.offline_seed.state).toBe('ready');
    expect(setup?.offline_seed.detail).toContain('match their recorded hash');
    expect(JSON.stringify(setup)).not.toContain(key);
  });

  it('does not report the demo ready when a different project is the seeded one', async () => {
    const { app, engine, workspaceRoot } = await fixture();
    // A real application project, complete and valid: exactly the state that a
    // weaker "does some workspace content exist?" check would mistake for a seed.
    engine.ensureProject('palette-bench', 'Palette Bench');
    await writeForgeProject(workspaceRoot, 'palette-bench', {
      bytes: '<!doctype html><title>Palette Bench</title>',
    });

    const setup = (await health(app)).setup;
    expect(setup?.offline_seed.state).toBe('missing');
    expect(setup?.offline_seed.detail).toContain(SEEDED_DEMO_PROJECT);
    expect(setup?.offline_seed.detail).not.toContain('Palette Bench');
    expect(setup?.offline_seed.detail).not.toMatch(/match their recorded hash/);
    expect(setup?.offline_seed.fix).toContain('pnpm demo:seed');
  });

  it('reports the demo ready from the project, its version and its artifact bytes', async () => {
    const { app, engine, workspaceRoot } = await fixture();
    const bytes = '<!doctype html><title>Muse Recall demo</title>';
    const sha = await writeForgeProject(workspaceRoot, SEEDED_DEMO_PROJECT, { bytes });
    engine.ensureProject(SEEDED_DEMO_PROJECT, 'Muse Recall demo');

    const setup = (await health(app)).setup;
    expect(setup?.offline_seed.state).toBe('ready');
    // It names what it established, in terms a reader can check.
    expect(setup?.offline_seed.detail).toContain('Muse Recall demo');
    expect(setup?.offline_seed.detail).toContain(SEEDED_DEMO_PROJECT);
    expect(setup?.offline_seed.detail).toContain('v1');
    expect(setup?.offline_seed.detail).toContain('match their recorded hash');
    expect(setup?.offline_seed.detail).toContain('Read-only');
    expect(sha).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuses to call a corrupted demo artifact ready', async () => {
    const { app, engine, workspaceRoot } = await fixture();
    engine.ensureProject(SEEDED_DEMO_PROJECT, 'Muse Recall demo');
    await writeForgeProject(workspaceRoot, SEEDED_DEMO_PROJECT, {
      bytes: '<!doctype html><title>edited by hand</title>',
      recordedSha: createHash('sha256').update('original bytes', 'utf8').digest('hex'),
    });

    const setup = (await health(app)).setup;
    expect(setup?.offline_seed.state).toBe('missing');
    expect(setup?.offline_seed.detail).toContain('no longer match their recorded hash');
    expect(setup?.offline_seed.fix).toContain('Recovery');
  });

  it('leaves an unrelated project untouched while inspecting the demo', async () => {
    const { engine, dbFile, workspaceRoot } = await fixture();
    engine.ensureProject('palette-bench', 'Palette Bench');
    const sha = await writeForgeProject(workspaceRoot, 'palette-bench', {
      bytes: '<!doctype html><title>Palette Bench</title>',
    });

    const before = await gatherDemoSeedFacts({
      databasePath: dbFile,
      workspace: new ForgeWorkspace(workspaceRoot),
    });
    expect(before.record).toBe('absent');
    expect(before.current_version).toBeNull();
    expect(before.artifact).toBe('unchecked');

    // The read-only claim, checked rather than asserted in a comment: after the
    // probe ran, the other project's bytes and state are still what they were.
    const { readFile } = await import('node:fs/promises');
    const stateFile = join(workspaceRoot, 'forge', 'palette-bench', 'state.json');
    expect(JSON.parse(await readFile(stateFile, 'utf8')).versions[0].sha256).toBe(sha);
    const after = await gatherDemoSeedFacts({
      databasePath: dbFile,
      workspace: new ForgeWorkspace(workspaceRoot),
    });
    expect(after).toEqual(before);
  });

  it('does not let the setup block change the liveness verdict', async () => {
    const { app } = await fixture();
    const payload = await health(app);
    // Missing prerequisites are onboarding facts, not a sick server.
    expect(payload.setup?.offline_seed.state).toBe('missing');
    expect(payload.status).toBe('ok');
  });

  it('prints the same rows the payload carries, without claiming a live check', async () => {
    const { app } = await fixture();
    const setup = (await health(app)).setup;
    if (!setup) throw new Error('the health payload carried no setup block');
    const panel = formatSetupPanel(setup);
    for (const label of ['CLI', 'Media API', 'Browser validation', 'Offline demo']) {
      expect(panel).toContain(label);
    }
    expect(panel).toContain('MISSING');
    expect(panel).toContain('fix:');
    expect(panel).toContain('not "verified"');
    expect(panel).toContain('docs/guide/FOR_JUDGES.md');
    expect(panel).toContain('(2) generate live applications');
    // Nothing in a printed panel may leak a credential value.
    expect(panel).not.toMatch(/api[_-]?key\s*[:=]\s*\S/);
    const probed = probeSetupReadiness({ providerId: 'muse-cli', mediaApiKey: null });
    expect(probed.offline_seed.state).toBe('not_probed');
    expect(probed.offline_seed.detail).toContain('not inspected');
  });
});
