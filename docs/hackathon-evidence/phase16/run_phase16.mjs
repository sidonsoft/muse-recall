/**
 * Phase 16 runner — 3 arms x 24 runs on the real Forge path.
 * Usage: node run_phase16.mjs [pilot]
 * Pilot: 1 run per arm, excluded from the 72.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const requireRc = createRequire('/Users/burnz/projects/muse-recall-rc/package.json');
const { chromium } = requireRc('playwright-core');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.resolve(HERE, '../..');
const RC = '/Users/burnz/projects/muse-recall-rc';
const OUT = path.join(HERE, 'out');
mkdirSync(OUT, { recursive: true });

const BASELINE = path.join(RC, 'demo/forge-baseline/index.html');
const BASELINE_SHA = createHash('sha256').update(readFileSync(BASELINE)).digest('hex');
const MODEL = 'muse-spark-1.3-contributor';
const EFFORT = 'high';
const PORT = Number(process.env.P16_PORT ?? 8921);
const SHARD = Number(process.env.P16_SHARD ?? 0);
const SHARDS = Number(process.env.P16_SHARDS ?? 1);
const API = `http://127.0.0.1:${PORT}`;
const REQUEST = 'Make the game more exciting and challenging, like an arcade game.';
const SEED = 0x16A2026;
const PILOT = process.argv.includes('pilot');

const key = readFileSync(process.env.HOME + '/.zshrc', 'utf8')
  .split('\n').map((l) => l.match(/^\s*(?:export\s+)?FORGE_MUSE_API_KEY\s*=\s*["']?([^"'\s]+)/))
  .find(Boolean)?.[1];
if (!key) throw new Error('FORGE_MUSE_API_KEY not found');

const { seedForgeDemo, CHILD_SAFETY_DECISION } =
  await import(pathToFileURL(path.join(RC, 'scripts/lib/demo-seed.ts')));
const { openDatabase } = await import(pathToFileURL(path.join(RC, 'packages/memory-engine/src/db.ts')));

const ARMS = ['no-memory', 'palette', 'rule'];
const cells = [];
for (let i = 0; i < 16; i++) {
  for (const arm of ARMS) {
    const order_key = createHash('sha256').update(`${SEED}:${i}:${arm}`).digest('hex');
    cells.push({ id: `${arm}-${String(i + 1).padStart(2, '0')}`, arm, request: REQUEST, order_key });
  }
}
const ordered = PILOT ? ARMS.map((arm, i) => ({ id: `pilot-${arm}`, arm, request: REQUEST, order_key: String(i) }))
                        : cells.sort((a, b) => a.order_key.localeCompare(b.order_key));
const RUNS = ordered.filter((_, i) => i % SHARDS === SHARD);
console.log(`${PILOT ? 'PILOT' : 'TRIAL'} ${RUNS.length} runs; baseline ${BASELINE_SHA.slice(0, 12)}`);

// Baseline screenshot
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.goto(`file://${BASELINE}`, { waitUntil: 'load' });
await page.waitForTimeout(1200);
const shot = await page.screenshot();
await browser.close();
const shotDataUrl = `data:image/png;base64,${shot.toString('base64')}`;

function startServer(env) {
  const p = spawn(process.execPath, [path.join(RC, 'node_modules/tsx/dist/cli.mjs'), 'apps/server/src/index.ts'], {
    cwd: RC, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  p.stderr.on('data', (b) => {
    const s = b.toString();
    if (!/ExperimentalWarning|DeprecationWarning/.test(s)) process.stderr.write(`  [server] ${s.slice(0, 240)}`);
  });
  return p;
}

async function waitUp() {
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(`${API}/api/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
}

const results = [];
for (const run of RUNS) {
  const dir = mkdtempSync(path.join(tmpdir(), `p16-${run.id}-`));
  const databasePath = path.join(dir, 'trial.db');
  const workspaceRoot = path.join(dir, 'workspaces');
  const projectId = 'p16';

  const seeded = await seedForgeDemo({ workspaceRoot, databasePath, baselinePath: BASELINE, projectId });

  const db = openDatabase({ path: databasePath, wal: false });
  try {
    if (run.arm === 'no-memory') {
      db.db.prepare('DELETE FROM memories WHERE project_id = ?').run(projectId);
    } else if (run.arm === 'palette') {
      db.db.prepare('DELETE FROM memories WHERE project_id = ? AND content = ?').run(projectId, CHILD_SAFETY_DECISION);
    }
  } finally {
    db.close();
  }

  const env = {
    HOST: '127.0.0.1', PORT: String(PORT), LOG_LEVEL: 'warn',
    DATABASE_PATH: databasePath, WORKSPACE_ROOT: workspaceRoot, SQLITE_WAL: 'false',
    MODEL_PROVIDER: 'muse-cli', MUSE_MODEL: MODEL, MUSE_REASONING_EFFORT: EFFORT,
    FORGE_MUSE_API_KEY: key, FORGE_MUSE_MODEL: MODEL,
    FORGE_FALLBACK_API_KEY: key, FORGE_FALLBACK_MODEL: MODEL, FORGE_REASONING_EFFORT: EFFORT,
    FORGE_MAX_RUNTIME_MS: '600000', FORGE_MAX_CALLS: '40', FORGE_MAX_INPUT_TOKENS: '6000000',
    TOOLS_ENABLED: 'false', CORS_ORIGINS: 'http://127.0.0.1:5219',
  };

  const server = startServer(env);
  const t0 = Date.now();
  const record = { id: run.id, arm: run.arm, request: run.request, baseline_sha256: BASELINE_SHA };
  try {
    await waitUp();
    const created = await fetch(`${API}/api/forge/projects`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, name: 'Phase 16' }),
    });
    if (!created.ok) throw new Error(`create ${created.status}`);

    const res = await fetch(`${API}/api/forge/projects/${projectId}/modify`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request: run.request, screenshot_data_url: shotDataUrl }),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error(`modify rejected: ${JSON.stringify(body).slice(0, 200)}`);
    const jobId = body.data.id;
    record.job_id = jobId;

    let job;
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const j = await (await fetch(`${API}/api/forge/jobs/${jobId}`)).json();
      job = j.data;
      if (['succeeded', 'failed', 'cancelled', 'budget_exceeded'].includes(job.status)) break;
    }
    if (job.status === 'running' || job.status === 'queued') {
      await fetch(`${API}/api/forge/jobs/${jobId}/cancel`, { method: 'POST' }).catch(() => {});
      record.status = 'timed_out';
    } else {
      record.status = job.status;
    }
    record.error = job.error ?? null;
    record.usage = job.usage ?? null;
    record.memory_ids = job.memory_ids ?? [];
    record.guard = job.staging_guard ?? null;
    record.seconds = Number(((Date.now() - t0) / 1000).toFixed(1));

    if (record.status === 'succeeded') {
      const staged = path.join(workspaceRoot, 'forge', projectId, 'staging', jobId, 'index.html');
      const dest = path.join(OUT, `${run.id}.html`);
      copyFileSync(staged, dest);
      record.output_sha256 = createHash('sha256').update(readFileSync(dest)).digest('hex');
      record.output_bytes = readFileSync(dest).length;
    }
  } catch (err) {
    record.status = 'harness_error';
    record.error = String(err.message).slice(0, 300);
    record.seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
  } finally {
    try { process.kill(-server.pid, 'SIGTERM'); } catch {}
    await new Promise((r) => setTimeout(r, 600));
  }
  console.log(run.id, record.status, record.seconds, record.memory_ids?.length ?? 0);
  results.push(record);
  writeFileSync(path.join(OUT, PILOT ? 'pilot-results.json' : `phase16-shard-${SHARD}.json`), JSON.stringify({
    protocol: 'PROTOCOL.md', baseline_sha256: BASELINE_SHA, model: MODEL, effort: EFFORT,
    seed: SEED, pilot: PILOT, shard: SHARD, shards: SHARDS, results,
  }, null, 2));
}

console.log(`done ${results.filter((r) => r.status === 'succeeded').length}/${results.length}`);
