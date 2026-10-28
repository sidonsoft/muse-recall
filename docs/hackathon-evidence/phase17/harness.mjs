/**
 * Phase 17 shared harness: design loading, cell order, an isolated production
 * server per run, and memory seeding through the production HTTP API.
 *
 * Paths are repo-relative; keys come from the environment only.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../..');
export const DESIGN = JSON.parse(readFileSync(path.join(HERE, 'design.json'), 'utf8'));

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in the environment`);
  return value;
}

export function baselinePath(baseline) {
  return path.join(ROOT, DESIGN.baselines[baseline].path);
}

/** Every trial cell, in the locked execution order. */
export function trialCells() {
  const cells = [];
  for (const stratum of DESIGN.strata) {
    for (const arm of DESIGN.arms) {
      for (let i = 0; i < DESIGN.runs_per_cell; i++) {
        const id = `${stratum.id}-${arm}-${String(i + 1).padStart(2, '0')}`;
        const order_key = sha256(`${DESIGN.seed}:${stratum.id}:${arm}:${i}`);
        cells.push({ id, stratum: stratum.id, arm, order_key });
      }
    }
  }
  return cells.sort((a, b) => a.order_key.localeCompare(b.order_key));
}

/** Pilot cells: one per (stratum, arm) chosen by the caller; excluded from analysis. */
export function pilotCells(filter = () => true, tag = 'pilot') {
  const cells = [];
  for (const stratum of DESIGN.strata) {
    for (const arm of DESIGN.arms) {
      if (filter(stratum, arm)) cells.push({ id: `${tag}-${stratum.id}-${arm}`, stratum: stratum.id, arm, order_key: '' });
    }
  }
  return cells;
}

export function shardOf(cells, shard, shards) {
  return cells.filter((_, i) => i % shards === shard);
}

/**
 * What one arm puts where. `memories` are created through the API in order;
 * `correct` names the memory that is then superseded through the production
 * correction route; `request` is the text the user submits.
 */
export function armPlan(stratumId, arm) {
  const stratum = DESIGN.strata.find((s) => s.id === stratumId);
  const baseline = DESIGN.baselines[stratum.baseline];
  const rule = DESIGN.rules[baseline.rule];
  const request = DESIGN.requests[stratum.request];
  const context = baseline.context;
  switch (arm) {
    case 'none':
      return { memories: [], correct: null, request };
    case 'memory':
      return { memories: [rule.text, context], correct: null, request };
    case 'manual':
      return { memories: [context], correct: null, request: `${request}\n\n${rule.text}` };
    case 'corrected':
      return { memories: [rule.text, context], correct: { target: rule.text, content: rule.correction, reason: rule.correction_reason }, request };
    default:
      throw new Error(`unknown arm ${arm}`);
  }
}

export function memoryInput(projectId, content) {
  return {
    type: 'constraint',
    scope: 'project',
    project_id: projectId,
    content,
    source: { session_id: null, reference: 'phase17' },
    confidence: 0.95,
    validation_status: 'verified',
    tags: ['phase17'],
    expires_at: null,
  };
}

const requireRoot = createRequire(path.join(ROOT, 'package.json'));

export function chromium() {
  return requireRoot('playwright-core').chromium;
}

export const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** PNG data URL of a baseline as the Studio preview would show it. */
export async function screenshotDataUrl(file) {
  const browser = await chromium().launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.goto(`file://${file}`, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const shot = await page.screenshot();
    return `data:image/png;base64,${shot.toString('base64')}`;
  } finally {
    await browser.close();
  }
}

export function startServer(port, env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'apps/server/src/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, ...env, HOST: '127.0.0.1', PORT: String(port), LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stderr.on('data', (b) => {
    const s = b.toString();
    if (!/ExperimentalWarning|DeprecationWarning/.test(s)) process.stderr.write(`  [server:${port}] ${s.slice(0, 240)}`);
  });
  return child;
}

export function stopServer(child) {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {}
  return new Promise((r) => setTimeout(r, 600));
}

export function api(port) {
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, route, body) => {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) throw new Error(`${method} ${route} ${res.status}: ${JSON.stringify(json).slice(0, 240)}`);
    return json.data;
  };
  return {
    async waitUp() {
      for (let i = 0; i < 200; i++) {
        try {
          if ((await fetch(`${base}/api/health`)).ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error('server did not start');
    },
    get: (route) => call('GET', route),
    post: (route, body) => call('POST', route, body ?? {}),
  };
}

/** Production budgets: the documented maxima the live demo runs with (docs/demo/LIVE_MUSE_CONFIGURATION.md). */
export function sparkEnv({ databasePath, workspaceRoot, key }) {
  const model = DESIGN.models.spark.model;
  const effort = DESIGN.models.spark.effort;
  return {
    DATABASE_PATH: databasePath,
    WORKSPACE_ROOT: workspaceRoot,
    SQLITE_WAL: 'false',
    MODEL_PROVIDER: 'muse-cli',
    MUSE_MODEL: model,
    MUSE_REASONING_EFFORT: effort,
    FORGE_MUSE_API_KEY: key,
    FORGE_MUSE_MODEL: model,
    FORGE_FALLBACK_API_KEY: key,
    FORGE_FALLBACK_MODEL: model,
    FORGE_REASONING_EFFORT: effort,
    FORGE_MAX_RUNTIME_MS: String(DESIGN.models.spark.max_runtime_ms),
    FORGE_MAX_CALLS: String(DESIGN.models.spark.max_calls),
    FORGE_MAX_INPUT_TOKENS: String(DESIGN.models.spark.max_input_tokens),
    TOOLS_ENABLED: 'false',
    CORS_ORIGINS: 'http://127.0.0.1:5219',
  };
}

export const TERMINAL = ['succeeded', 'failed', 'cancelled', 'budget_exceeded'];

/** Polls until the job ends; the server enforces the runtime cap, the harness allows 3 min more. */
export async function waitForJob(client, jobId, maxPolls = Math.ceil((DESIGN.models.spark.max_runtime_ms + 180_000) / 3000)) {
  let job;
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    job = await client.get(`/api/forge/jobs/${jobId}`);
    if (TERMINAL.includes(job.status)) return job;
  }
  await client.post(`/api/forge/jobs/${jobId}/cancel`).catch(() => {});
  return { ...job, status: 'timed_out' };
}
