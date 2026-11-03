/**
 * Batch C — scoped LIVE acceptance smoke (paid calls: exactly one vision, one
 * SAM, one coding request; no image-generation call).
 *
 * The call budget is enforced at the provider boundary, not by counting UI
 * submissions: the spawned server runs with FORGE_MEDIA_MAX_RETRIES=0 (a
 * single UI submission can no longer become two provider dispatches) and
 * FORGE_MEDIA_TRACE=1 (one bounded, secret-free line per attempt in the
 * server log). Every vision/SAM response must carry provider_attempts: 1
 * or the run fails. Coding fallback is scrubbed from the server
 * environment so one coding job cannot silently become two CLI invocations;
 * the job logs are still inspected for fallback markers as a backstop.
 *
 * BATCHC_SMOKE_VISION_ONLY=1 stops after the single vision attempt (SAM
 * and coding stay paused until vision succeeds and the remaining run scope
 * is explicit). Any failure stops the run immediately and writes an
 * evidence report with redacted status/body, provider attempts, and the
 * effective server configuration actually in force.
 *
 * Flow (real Studio UI, real providers, isolated database/workspace):
 *   seed recorded baseline v1 (no model call) -> upload an existing reference
 *   image -> live vision Suggest -> edit/propose/accept one draft (dismiss
 *   another) -> live SAM Segment -> inspect/select match -> save transparent
 *   cutout -> approve it -> Insert into Studio -> ONE coding request stages an
 *   app using the asset placeholder -> approve v2 (image embedded) -> restart ->
 *   byte identity -> rollback to v1 -> byte identity + v2/embedded bytes intact.
 *
 * Requirements: FORGE_MUSE_API_KEY (existing configured key; never printed)
 * and FORGE_MUSE_BIN (a real `muse` CLI). Playwright Chromium installed.
 *
 * Usage:
 *   FORGE_MUSE_API_KEY=... FORGE_MUSE_BIN=$(which muse) \
 *     pnpm exec tsx scripts/verify-batchc-live-smoke.ts
 * Vision-only (single vision attempt, SAM/coding paused):
 *   BATCHC_SMOKE_VISION_ONLY=1 FORGE_MUSE_API_KEY=... FORGE_MUSE_BIN=$(which muse) \
 *     pnpm exec tsx scripts/verify-batchc-live-smoke.ts
 * Resume without spending another vision call (reuses retained drafts):
 *   BATCHC_SMOKE_RESUME_FROM=test-results/batchc-live/<stamp> FORGE_MUSE_API_KEY=... \
 *     FORGE_MUSE_BIN=$(which muse) pnpm exec tsx scripts/verify-batchc-live-smoke.ts
 * Cutout continuation (no new SAM or vision call; reuses a retained cutout):
 *   BATCHC_SMOKE_RESUME_CUTOUT=test-results/batchc-live/<stamp> FORGE_MUSE_API_KEY=... \
 *     FORGE_MUSE_BIN=$(which muse) pnpm exec tsx scripts/verify-batchc-live-smoke.ts
 *   The retained cutout.png bytes (sha-verified against the retained
 *   report) are uploaded as a new asset and approved/Insert/coded through
 *   the normal UI flow. Bytes, box, and concept are labeled retained live
 *   output from the cited run — never a fresh SAM or vision result.
 *
 * Build provenance (fail-closed, runs before any provider I/O): the
 * script hashes the exact production inputs (sources, entry HTML, CSS,
 * bundler/compiler config, package manifests, lockfile) and the dist
 * outputs, and compares both against the recorded build manifests.
 * BATCHC_SMOKE_{SERVER,WEB}_DIST override the verified dist locations;
 * that hook exists only for the hermetic gate regression and is never
 * set in live runs.
 *
 * The SAM segmentation concept defaults to 'green rounded memory game card'
 * (the reference image shows 12 large uniform green cards on a gradient
 * background; even one match stages the cutout). BATCHC_SMOKE_SAM_CONCEPT
 * overrides it without a code change. A valid-but-empty SAM lane is a
 * verified auth/request/empty-state result, not a provider failure: it is
 * recorded with observations.segment plus a 03-sam-zero-matches.png
 * screenshot, and the run stops with the SAM allowance consumed.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { PNG } from 'pngjs';
import {
  BATCHC_ALLOWED_PATHS,
  type BatchCModelIds,
  batchcExpectedCalls,
  batchcLedgerIssues,
} from './lib/batchc-scope.js';
import { verifyBuildProvenance } from './lib/build-provenance.js';
import { seedForgeDemo } from './lib/demo-seed.js';
import {
  accountDispatches,
  assertSingleProviderAttempt,
  countModelAttempts,
  ledgerEvidence,
  readMediaTrace,
  shouldStopAfterVisionOnly,
} from './lib/media-trace.js';
import { loadRetainedCutout, type RetainedCutout } from './lib/retained-cutout.js';
import {
  loadRetainedVisionEvidence,
  type RetainedVisionEvidence,
} from './lib/retained-evidence.js';

const ROOT = process.cwd();
const PROJECT = `batchc-live-${Date.now().toString(36).slice(-6)}`;
const LONG = 900_000;
const IMAGE = process.env.BATCHC_SMOKE_IMAGE ?? join(ROOT, 'docs/assets/muse-forge-after.png');
const STAMP = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
const EVIDENCE = join(ROOT, 'test-results', 'batchc-live', STAMP);
/** Bounded server stdout/stderr for this run; module scope so the trace reader can use it. */
const SERVER_LOG = join(EVIDENCE, 'server.log');

const checks: string[] = [];
const calls = { vision: 0, sam: 0, coding: 0, imageGeneration: 0 };
const observations: Record<string, unknown> = {};
let evidenceWritten = false;
let pageRef: Page | null = null;
/** 'full' or 'vision-only' (BATCHC_SMOKE_VISION_ONLY=1); recorded in evidence.
 * Resolved from the environment at startup so failed runs are labeled with
 * the scope they actually ran under, not the scope they reached. */
let runScope = process.env.BATCHC_SMOKE_VISION_ONLY === '1' ? 'vision-only' : 'full';

function check(label: string): void {
  checks.push(label);
  console.log(`  ✓ ${label}`);
}
function fail(message: string): never {
  throw new Error(`batchc live smoke failed: ${message}`);
}
function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function dataOf(result: { status: number; text: string }, what: string): Record<string, unknown> {
  if (result.status >= 300) fail(`${what}: HTTP ${result.status}: ${result.text.slice(0, 300)}`);
  const body = JSON.parse(result.text);
  if (!body?.ok) fail(`${what}: not ok: ${result.text.slice(0, 300)}`);
  return body.data;
}
async function api(
  base: string,
  method: string,
  path: string,
  payload?: unknown,
): Promise<{ status: number; text: string; bytes: Buffer }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: payload !== undefined ? { 'content-type': 'application/json' } : {},
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, text: bytes.toString('utf8'), bytes };
}
async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  fail(`timed out waiting for ${url}: ${last}`);
}
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === 'string') fail('could not allocate a port');
  return address.port;
}

interface Managed {
  child: ChildProcess;
}
function start(
  name: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd = ROOT,
  logFile?: string,
): Managed {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const append = (chunk: Buffer) => {
    if (logFile === undefined) return;
    try {
      appendFileSync(logFile, chunk);
    } catch {
      /* logging must not mask the result */
    }
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', (chunk: Buffer) => {
    append(chunk);
    const text = chunk.toString('utf8');
    // Preserve only bounded diagnostics; never credentials.
    if (text.trim().length > 0) console.error(`[${name}] ${text.trim().slice(0, 400)}`);
  });
  child.on('error', (error) => console.error(`[${name}] spawn error: ${error.message}`));
  return { child };
}
async function stop(item: Managed): Promise<void> {
  const pid = item.child.pid;
  if (item.child.exitCode !== null || pid === undefined) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* gone */
      }
      resolve();
    }, 10_000);
    item.child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      resolve();
    }
  });
}

async function fillStable(page: Page, label: string, value: string): Promise<void> {
  const field = page.getByLabel(label);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await field.fill(value).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 150));
    if ((await field.inputValue().catch(() => '')) === value) return;
  }
  fail(`field ${label} never held its value`);
}

function readEmbedded(
  html: string,
): { mime: string; base64: string; bytes: Buffer; sha: string } | null {
  const match = /data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)/.exec(html);
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  const bytes = Buffer.from(match[2], 'base64');
  return { mime: match[1], base64: match[2], bytes, sha: sha256(bytes) };
}
function readAlphaStats(bytes: Buffer): {
  width: number;
  height: number;
  transparent: number;
  opaque: number;
} {
  const png = PNG.sync.read(bytes);
  let transparent = 0;
  let opaque = 0;
  for (let index = 3; index < png.data.length; index += 4) {
    const alpha = png.data[index] ?? 255;
    if (alpha === 0) transparent += 1;
    else if (alpha === 255) opaque += 1;
  }
  return { width: png.width, height: png.height, transparent, opaque };
}

/** Bound diagnostics for failure evidence: the server already redacts
 *  provider messages, but raw transport bodies are masked here for
 *  credential-shaped values before they reach the evidence report. */
function redactForEvidence(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer <redacted>')
    .replace(/api[_-]?key["'\s:=]+[\w.-]{8,}/gi, 'api_key=<redacted>');
}
async function captureHttpFailure(
  label: string,
  response: { status(): number; text(): Promise<string> },
  screenshot: string,
): Promise<never> {
  const raw = await response.text().catch(() => '<unreadable body>');
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  observations[`${label}Error`] = {
    http_status: response.status(),
    body: redactForEvidence(raw.slice(0, 1_000)),
    json: parsed,
    attempts: (() => {
      const details = (parsed as { error?: { details?: unknown } } | null)?.error?.details;
      if (details !== null && typeof details === 'object') {
        const attempts = (details as Record<string, unknown>).attempts;
        return typeof attempts === 'number' ? attempts : null;
      }
      return null;
    })(),
    effective_media_config: observations.effectiveConfig ?? null,
  };
  await pageRef
    ?.screenshot({ path: join(EVIDENCE, screenshot), fullPage: false })
    .catch(() => undefined);
  fail(`${label} failed (HTTP ${response.status()}): ${raw.slice(0, 300) || '<non-text body>'}`);
}

/**
 * The whole-run paid-call budget, asserted rather than reported.
 *
 * Per-operation checks (`assertSingleProviderAttempt`) only bound the call being made
 * now; they say nothing about an extra dispatch somewhere else in the run. This reads
 * the same trace the run wrote and refuses a pass when the run touched a path its scope
 * never authorised, left a dispatch unanswered, answered one it never started, retried,
 * or spent more than one vision/SAM call. Coding is excluded by construction: the Muse
 * CLI never writes a media-trace line, so its calls come from the job's own usage.
 */
function assertPaidCallBudget(): void {
  const evidence = ledgerEvidence(SERVER_LOG);
  const ledger = accountDispatches(readMediaTrace(SERVER_LOG));
  const expected = batchcExpectedCalls(runScope);
  // The ids come from what the running server reported configuring, so a
  // dispatch on a model outside those two cannot slip through an unrecognised
  // middle ground.
  const authorisedModels: BatchCModelIds = {
    vision:
      typeof observations.requestedVisionModel === 'string'
        ? observations.requestedVisionModel
        : null,
    sam: typeof observations.requestedSamModel === 'string' ? observations.requestedSamModel : null,
  };
  const issues = batchcLedgerIssues(ledger, expected, authorisedModels);
  observations.batchcAuthorisedModels = authorisedModels;
  observations.batchcLedgerEvidence = evidence;
  observations.batchcDispatchPaths = ledger.paths;
  observations.batchcExpectedCalls = expected;
  observations.batchcLedgerIssues = issues;
  if (issues.length > 0) {
    fail(`the paid-call budget does not hold: ${issues.join(' | ')}`.slice(0, 600));
  }
  check(
    `whole-run paid-call budget holds: ${String(expected.vision)} vision (${String(authorisedModels.vision)}) + ${String(expected.sam)} SAM (${String(authorisedModels.sam)}) on ${BATCHC_ALLOWED_PATHS.join(', ')}, nothing else (${String(evidence.logBytes)} bytes of trace read)`,
  );
}

async function writeEvidence(): Promise<void> {
  if (evidenceWritten) return;
  evidenceWritten = true;
  mkdirSync(EVIDENCE, { recursive: true });
  const report = {
    kind: 'Batch C live acceptance smoke (paid calls: 1 vision + 1 SAM + 1 coding)',
    status: 'live results; not fixtures; no retries; qualification/confirmatory evidence separate',
    generated_at: new Date().toISOString(),
    project: PROJECT,
    reference_image: {
      source: 'existing repository image (uploaded)',
      path: IMAGE,
      sha256: sha256(readFileSync(IMAGE)),
      bytes: readFileSync(IMAGE).length,
    },
    calls,
    ui_submissions: calls,
    scope: runScope,
    media_retry_policy:
      'FORGE_MEDIA_MAX_RETRIES=0 (transport retries disabled); FORGE_MEDIA_TRACE=1',
    provider_attempts: observations.providerAttempts ?? null,
    media_trace_path: 'server.log (bounded [media-trace] lines; no credential values)',
    media_trace_evidence: observations.batchcLedgerEvidence ?? {
      note: 'the trace log was never read for this report: it was written after the ledger check, which runs only on a passing run',
    },
    requested_models: {
      vision: observations.requestedVisionModel ?? null,
      sam: observations.requestedSamModel ?? null,
      coding: observations.requestedCodingModel ?? null,
    },
    observed_models: {
      vision: observations.visionObservedModel ?? 'not surfaced by the media response contract',
      sam: observations.samObservedModel ?? 'not surfaced by the media response contract',
      coding: observations.codingModelObserved ?? null,
    },
    usage: {
      media: 'not surfaced by the media response contract',
      coding: observations.codingUsage ?? null,
    },
    checks,
    observations,
  };
  writeFileSync(join(EVIDENCE, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nevidence: ${EVIDENCE}`);
}

async function main(): Promise<void> {
  const key = process.env.FORGE_MUSE_API_KEY?.trim() ?? '';
  const bin = process.env.FORGE_MUSE_BIN?.trim() ?? 'muse';
  if (key.length === 0) {
    console.log('live smoke: unconfigured (need FORGE_MUSE_API_KEY; no call made)');
    process.exitCode = 2;
    return;
  }
  if (calls.vision + calls.sam + calls.coding !== 0) fail('call budget must start at zero');
  // Build provenance gate: the production builds under test must match
  // the current source tree exactly (content hashes, never timestamps).
  // Runs before any browser, server, or provider I/O: a stale build
  // fails here with zero dispatches. BATCHC_SMOKE_{SERVER,WEB}_DIST
  // override the verified locations (hermetic gate-regression hook;
  // never set in live runs, which always verify the real dist outputs).
  let provenance: ReturnType<typeof verifyBuildProvenance>;
  try {
    const serverDist = process.env.BATCHC_SMOKE_SERVER_DIST?.trim();
    const webDist = process.env.BATCHC_SMOKE_WEB_DIST?.trim();
    provenance = verifyBuildProvenance({
      root: ROOT,
      ...(serverDist !== undefined && serverDist.length > 0 ? { serverDist } : {}),
      ...(webDist !== undefined && webDist.length > 0 ? { webDist } : {}),
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  observations.buildProvenance = {
    commit: provenance.commit,
    treeCleanAtMeasure: provenance.treeCleanAtMeasure,
    treeStatusAtMeasure: provenance.treeStatusAtMeasure,
    server: {
      sourceHash: provenance.server.sourceHash,
      sourceFiles: provenance.server.sourceFiles,
      buildHash: provenance.server.buildHash,
      buildFiles: provenance.server.buildFiles,
      builtAt: provenance.server.builtAt,
    },
    web: {
      sourceHash: provenance.web.sourceHash,
      sourceFiles: provenance.web.sourceFiles,
      buildHash: provenance.web.buildHash,
      buildFiles: provenance.web.buildFiles,
      builtAt: provenance.web.builtAt,
    },
  };
  check(
    `production builds match the tested source (server ${provenance.server.buildHash.slice(0, 12)}…, web ${provenance.web.buildHash.slice(0, 12)}…; commit ${provenance.commit.slice(0, 12)})`,
  );
  const resumeDir = process.env.BATCHC_SMOKE_RESUME_FROM?.trim() ?? '';
  const resumeCutoutDir = process.env.BATCHC_SMOKE_RESUME_CUTOUT?.trim() ?? '';
  let retained: RetainedVisionEvidence | null = null;
  let retainedCutout: RetainedCutout | null = null;
  if (process.env.BATCHC_SMOKE_VISION_ONLY === '1' && (resumeDir || resumeCutoutDir)) {
    fail('BATCHC_SMOKE_VISION_ONLY is mutually exclusive with resume modes');
  }
  if (resumeDir && resumeCutoutDir) {
    fail('BATCHC_SMOKE_RESUME_FROM and BATCHC_SMOKE_RESUME_CUTOUT are mutually exclusive');
  }
  if (resumeDir) {
    // Fail fast before any browser/server cost: a resumed run is only valid
    // with retained drafts from a completed vision step.
    retained = loadRetainedVisionEvidence(resumeDir);
    if (retained.suggestions.length === 0) fail(`no retained suggestions in ${resumeDir}`);
    runScope = 'resume';
    observations.scope =
      'resume: reuses retained vision drafts without a new vision call; SAM/coding per explicit scope';
    observations.resumedFrom = resumeDir;
  }
  if (resumeCutoutDir) {
    // Fail fast before any browser/server cost: the continuation needs a
    // sha-verified retained cutout from a completed SAM run.
    retainedCutout = loadRetainedCutout(resumeCutoutDir);
    runScope = 'resume-cutout';
    observations.scope =
      'resume-cutout: uploads a retained SAM cutout with no new SAM or vision call; approve/Insert/coding per explicit scope';
    observations.resumedFromCutout = resumeCutoutDir;
  }
  mkdirSync(EVIDENCE, { recursive: true });

  writeFileSync(SERVER_LOG, '');
  const dataRoot = mkdtempSync(join(tmpdir(), 'batchc-live-'));
  const workspaceRoot = join(dataRoot, 'workspaces');
  const databasePath = join(dataRoot, 'memory.db');
  const seed = await seedForgeDemo({ workspaceRoot, databasePath, projectId: PROJECT });
  check(
    `seeded recorded baseline v1 without a model call (sha256 ${seed.baselineSha256.slice(0, 12)}…)`,
  );

  const { launchVerificationBrowser, reportBrowserSelection } = await import('./lib/browser.js');
  const launched = await launchVerificationBrowser();
  const browser: Browser = launched.browser;
  reportBrowserSelection(launched.selection);
  const serverPort = await freePort();
  const webPort = await freePort();
  const apiBase = `http://127.0.0.1:${serverPort}`;
  const webBase = `http://127.0.0.1:${webPort}`;
  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(serverPort),
    DATABASE_PATH: databasePath,
    WORKSPACE_ROOT: workspaceRoot,
    CORS_ORIGINS: webBase,
    MODEL_PROVIDER: 'muse-cli',
    MUSE_BIN: bin,
    MUSE_MODEL: process.env.MUSE_MODEL ?? 'muse-wonder-1.0',
    FORGE_MUSE_BIN: bin,
    FORGE_MUSE_API_KEY: key,
    FORGE_MUSE_MODEL: process.env.FORGE_MUSE_MODEL ?? process.env.MUSE_MODEL ?? 'muse-wonder-1.0',
    FORGE_REASONING_EFFORT: 'low',
    FORGE_MAX_RUNTIME_MS: String(LONG),
    FORGE_RUNTIME_BROWSER: 'managed',
    FORGE_MEDIA_MAX_RETRIES: '0',
    FORGE_MEDIA_TRACE: '1',
    // Scrub any ambient fallback credential: one coding job must not be
    // able to silently become two CLI invocations via quota fallback. The
    // job logs are still inspected for fallback markers as a backstop.
    FORGE_FALLBACK_API_KEY: undefined,
    LOG_LEVEL: 'warn',
  };
  const visionOnly = process.env.BATCHC_SMOKE_VISION_ONLY === '1';
  // One coding job must not silently become two CLI invocations through a
  // fallback provider. Scrub fallback credentials/models inherited from the
  // caller's environment; the job logs are also checked after completion.
  delete serverEnv.FORGE_FALLBACK_API_KEY;
  delete serverEnv.FORGE_FALLBACK_MODEL;
  const startApi = (): Managed =>
    start(
      'api',
      process.execPath,
      [join(ROOT, 'apps/server/dist/index.js')],
      serverEnv,
      ROOT,
      SERVER_LOG,
    );
  let server = startApi();
  let web: Managed | null = null;
  const errors: string[] = [];
  const mediaResponses: Record<string, Array<Record<string, unknown>>> = {};
  try {
    await waitForHttp(`${apiBase}/api/health`);
    check('started the production API against an isolated seeded database');
    // Effective configuration actually in force — recorded in evidence and
    // used for every model/attempt claim below instead of hard-coded labels.
    // Fails fast if the server does not honor the zero-retry budget.
    const meta = JSON.parse((await api(apiBase, 'GET', '/api/meta')).text).data as {
      forge?: {
        configured_model?: string | null;
        observed_model?: string | null;
        cli_available?: boolean;
      };
      media?: {
        image_model?: string;
        sam_model?: string;
        vision_model?: string;
        max_retries?: number;
      };
      build?: { commit?: string; source_hash?: string; built_at?: string } | null;
    };
    // Server identity: the running API must prove it is the verified
    // build (baked commit + source hash), not a stale process.
    const runtimeIdentity = meta.build ?? null;
    observations.serverIdentity = runtimeIdentity;
    const baked = provenance.server.identity;
    if (
      runtimeIdentity === null ||
      baked === null ||
      runtimeIdentity.commit !== baked.commit ||
      runtimeIdentity.source_hash !== baked.source_hash
    ) {
      fail(
        `running API identity does not match the verified build: runtime=${JSON.stringify(runtimeIdentity)} baked=${JSON.stringify(baked)}`,
      );
    }
    check(
      `running API proves the verified build identity (commit ${String(runtimeIdentity.commit).slice(0, 12)})`,
    );
    observations.effectiveConfig = {
      forge_configured_model: meta.forge?.configured_model ?? null,
      // The Generate button is disabled while no CLI is available; record
      // it so a disabled-button stall is diagnosable from the report.
      forge_cli_available: meta.forge?.cli_available ?? null,
      media: meta.media ?? null,
    };
    if (meta.media?.max_retries !== 0) {
      fail(
        `server does not honor the zero-retry budget: /api/meta media=${JSON.stringify(meta.media ?? null)}`,
      );
    }
    check(
      `server enforces zero media retries (vision=${meta.media.vision_model}, sam=${meta.media.sam_model})`,
    );
    const effectiveMeta = meta;
    observations.effectiveMediaConfig = effectiveMeta.media ?? null;
    web = start(
      'web',
      process.execPath,
      [
        join(ROOT, 'apps/web/node_modules/vite/bin/vite.js'),
        'preview',
        '--host',
        '127.0.0.1',
        '--port',
        String(webPort),
        '--strictPort',
      ],
      { ...process.env, VITE_PROXY_TARGET: apiBase },
      join(ROOT, 'apps/web'),
    );
    await waitForHttp(webBase);
    check('served the production web build with the scoped credential');

    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const page = await context.newPage();
    pageRef = page;
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (text.toLowerCase().includes('favicon')) return;
      if (/Failed to load resource.*404/i.test(text)) return;
      errors.push(text);
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', async (response) => {
      const url = response.url();
      for (const name of ['suggest', 'segment', 'cutout']) {
        if (!url.includes(`/media/${name}`) && !url.includes('/media/segments/')) continue;
        try {
          const body = (await response.json()) as { data?: Record<string, unknown> } & Record<
            string,
            unknown
          >;
          const keyName = name === 'cutout' ? 'cutout' : name;
          mediaResponses[keyName] ??= [];
          mediaResponses[keyName]?.push((body.data ?? body) as Record<string, unknown>);
        } catch {
          /* non-JSON response */
        }
      }
    });

    await page.goto(webBase, { waitUntil: 'networkidle', timeout: 30_000 });
    try {
      await page
        .getByRole('button', { name: 'HTML Studio', exact: true })
        .waitFor({ timeout: 20_000 });
    } catch (error) {
      await page
        .screenshot({ path: join(EVIDENCE, '00-page-failure.png'), fullPage: true })
        .catch(() => undefined);
      writeFileSync(join(EVIDENCE, '00-page-failure.html'), await page.content().catch(() => ''));
      fail(
        `Studio shell did not render (url ${page.url()}): ${errors.join(' | ').slice(0, 800) || String(error)}`,
      );
    }
    await page.locator('button[title^="Project:"]').click();
    const dialog = page.getByRole('dialog', { name: 'Switch project' });
    await dialog.waitFor({ timeout: 10_000 });
    await dialog.getByLabel('Project id').fill(PROJECT);
    await dialog.getByRole('button', { name: 'Open', exact: true }).click();
    await page.getByText('v1 approved', { exact: false }).waitFor({ timeout: 20_000 });
    check(`opened seeded project ${PROJECT} (baseline v1)`);
    const media = page.getByRole('region', { name: 'Media assets' });
    await media.waitFor({ timeout: 20_000 });

    // ---- upload the existing reference image (no model call) -----------------
    const imageBytes = readFileSync(IMAGE);
    const uploaded = dataOf(
      await api(apiBase, 'POST', `/api/forge/projects/${PROJECT}/media/upload`, {
        mime: 'image/png',
        data_base64: imageBytes.toString('base64'),
        source_text: 'existing Batch C acceptance reference (docs/assets/muse-forge-after.png)',
      }),
      'upload reference image',
    ) as { asset_id: string; version: number; sha256?: string };
    observations.referenceAsset = {
      asset_id: uploaded.asset_id,
      version: uploaded.version,
      sha256: sha256(imageBytes),
    };
    check(
      `uploaded existing reference image as asset ${uploaded.asset_id.slice(0, 8)} v${uploaded.version}`,
    );
    await page.reload({ waitUntil: 'networkidle', timeout: 30_000 });
    const assetImage = page.locator(`img[src*="${uploaded.asset_id}"]`).first();
    await assetImage.waitFor({ timeout: 20_000 });

    // Cutout continuation skips vision/propose/accept/SAM entirely: the
    // retained cutout bytes are uploaded below with no model dispatch.
    let cutoutRecord:
      | {
          asset_id: string;
          version: number;
          sha256?: string;
          parent?: unknown;
          source?: unknown;
          model?: unknown;
        }
      | undefined;
    if (!resumeCutoutDir) {
      // ---- 1. vision drafts -> propose -> accept (live suggest, or retained on resume) ----
      // Resume reuses retained drafts byte-for-byte with no new vision call and
      // proposes the edited draft via API; the Memory accept flow below stays
      // UI-driven in both scopes.
      if (calls.vision !== 0) fail('vision call budget exhausted');
      let suggestData: {
        suggestions: Array<{ type: string; content: string; confidence: number }>;
        asset_id: string;
        version: number;
        provider_attempts?: number;
      };
      let editedContent: string;
      if (!resumeDir) {
        const assetRow = page
          .locator('li', { has: page.locator(`img[src*="${uploaded.asset_id}"]`) })
          .first();
        await assetRow
          .getByTitle('Suggest decisions or extract a cutout from this version')
          .click();
        await page.getByTitle('Suggest project decisions from this image').click();
        await fillStable(page, 'Suggestion guidance', 'visual style, palette and layout');
        calls.vision += 1;
        const [suggestResponse] = await Promise.all([
          page.waitForResponse(
            (response) =>
              response.url().includes('/media/suggest') && response.request().method() === 'POST',
            { timeout: LONG },
          ),
          page.getByRole('button', { name: 'Suggest', exact: true }).click(),
        ]);
        const suggestBody = await suggestResponse.text();
        let suggestEnvelope: { ok?: boolean; data?: unknown; error?: unknown } | null = null;
        try {
          suggestEnvelope = JSON.parse(suggestBody) as {
            ok?: boolean;
            data?: unknown;
            error?: unknown;
          };
        } catch {
          suggestEnvelope = null;
        }
        if (
          !suggestResponse.ok() ||
          suggestEnvelope?.ok !== true ||
          suggestEnvelope.data === undefined
        ) {
          await captureHttpFailure('vision', suggestResponse, '01-vision-failure.png');
          // The capture writes the evidence and the report; state the outcome
          // here as well so the narrowed envelope below is honest, not assumed.
          fail('the vision call returned no usable suggest envelope');
        }
        suggestData = suggestEnvelope.data as {
          suggestions: Array<{ type: string; content: string; confidence: number }>;
          asset_id: string;
          version: number;
          provider_attempts?: number;
        };
        if (suggestData.provider_attempts !== 1) {
          fail(
            `vision response provider_attempts=${String(suggestData.provider_attempts)}; expected 1`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 350));
        const traceEntries = readMediaTrace(SERVER_LOG);
        const visionAttempts = countModelAttempts(traceEntries, 'muse-spark');
        observations.requestedVisionModel = effectiveMeta.media?.vision_model ?? null;
        observations.visionProviderAttempts = visionAttempts;
        observations.providerAttempts = {
          ...(observations.providerAttempts as Record<string, number> | undefined),
          vision: visionAttempts,
        };
        try {
          assertSingleProviderAttempt({
            capability: 'vision',
            responseAttempts: suggestData.provider_attempts,
            traceAttempts: visionAttempts,
          });
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error));
        }
        observations.visionProviderAttempts = 1;
        observations.visionResponse = {
          asset_id: suggestData.asset_id,
          version: suggestData.version,
          suggestions: suggestData.suggestions,
        };
        if (suggestData.suggestions.length === 0)
          fail('vision returned no suggestions (unusable; stopping, no retry)');
        await page.getByLabel('Suggestion content').first().waitFor({ timeout: 20_000 });
        check(
          `live vision returned ${suggestData.suggestions.length} editable draft(s) (one call)`,
        );
        if (shouldStopAfterVisionOnly(visionOnly, calls)) {
          runScope = 'vision-only';
          observations.scope =
            'vision-only: single vision attempt recorded; SAM/coding paused pending explicit scope';
          await page.screenshot({ path: join(EVIDENCE, '01-vision-drafts.png'), fullPage: false });
          check('vision-only scope complete; SAM/coding paused');
          assertPaidCallBudget();
          console.log(`\nlive Batch C smoke (vision-only): PASS (${checks.length} checks)`);
          console.log(
            `calls: vision=${calls.vision} sam=${calls.sam} coding=${calls.coding} imageGeneration=${calls.imageGeneration}`,
          );
          return;
        }

        const first = suggestData.suggestions[0];
        if (!first) fail('vision returned a draft list with no first element');
        editedContent = `${first.content} (reviewer edit: acceptance smoke)`.slice(0, 500);
        await page.getByLabel('Suggestion content').first().fill(editedContent);
        await page.getByRole('button', { name: 'Propose to memory', exact: true }).first().click();
        await page.getByText('Proposed to memory', { exact: false }).waitFor({ timeout: 20_000 });
        check('edited draft proposed to memory (draft still requires explicit acceptance)');
        if (suggestData.suggestions.length > 1) {
          await page.getByRole('button', { name: 'dismiss', exact: true }).last().click();
          check('dismissed one draft at the reference panel (never proposed)');
        }
        mediaResponses.suggest = mediaResponses.suggest ?? [];
        await page.screenshot({ path: join(EVIDENCE, '01-vision-drafts.png'), fullPage: false });
      } else {
        // Resume: reuse retained drafts byte-for-byte with no new vision call.
        // The edited draft is proposed via API; acceptance below stays UI-driven.
        if (!retained) fail('resume requested without retained vision evidence');
        if ((mediaResponses.suggest ?? []).length !== 0) {
          fail('resume scope produced a vision request; exactly zero are allowed');
        }
        const retainedSha = sha256(imageBytes);
        if (retained.referenceSha256 !== null && retained.referenceSha256 !== retainedSha) {
          fail('reference image bytes differ from the retained vision evidence');
        }
        suggestData = {
          suggestions: retained.suggestions,
          asset_id: uploaded.asset_id,
          version: uploaded.version,
        };
        observations.visionResponse = {
          asset_id: uploaded.asset_id,
          version: uploaded.version,
          suggestions: retained.suggestions,
          resumedFrom: resumeDir,
          resumedDraftSha256: sha256(JSON.stringify(retained.suggestions)),
          referenceImageSha256: retainedSha,
        };
        observations.providerAttempts = {
          ...(observations.providerAttempts as Record<string, number> | undefined),
          vision: 0,
        };
        observations.requestedVisionModel = effectiveMeta.media?.vision_model ?? null;
        check(`reused ${retained.suggestions.length} retained vision draft(s); no new vision call`);
        const retainedFirst = suggestData.suggestions[0];
        if (!retainedFirst) fail('retained drafts list has no first element');
        editedContent = `${retainedFirst.content} (reviewer edit: acceptance smoke)`.slice(0, 500);
        const retainedProposed = dataOf(
          await api(apiBase, 'POST', '/api/memories/proposals', {
            type: retainedFirst.type,
            scope: 'project',
            project_id: PROJECT,
            content: editedContent,
            source: {
              session_id: null,
              reference: `muse-asset://${uploaded.asset_id}/v${uploaded.version}`,
            },
            confidence: retainedFirst.confidence,
            validation_status: 'unverified',
          }),
          'propose retained draft',
        ) as { memory?: { id?: string } };
        if (!retainedProposed.memory?.id) fail('retained draft proposal returned no memory id');
        check('edited draft proposed to memory via API (draft still requires explicit acceptance)');
        await page.screenshot({ path: join(EVIDENCE, '01-vision-drafts.png'), fullPage: false });
      }

      // explicit acceptance in Memory review (real UI)
      const proposedList = JSON.parse(
        (await api(apiBase, 'GET', `/api/memories?project_id=${PROJECT}&status=proposed&limit=50`))
          .text,
      ).data.items as Array<{ id: string; content: string; source: { reference: string | null } }>;
      const proposal =
        proposedList.find((entry) => entry.content.includes('reviewer edit')) ?? proposedList[0];
      if (!proposal) fail('proposed memory not found');
      await page.getByRole('button', { name: 'Memory', exact: true }).click();
      // Filter to proposals first: row buttons carry content text, not a
      // content-derived accessible name, so name-matching cannot find them.
      await page.getByLabel('Filter by status').waitFor({ timeout: 20_000 });
      await page.getByLabel('Filter by status').selectOption('proposed');
      await page
        .getByRole('button')
        .filter({ hasText: editedContent.slice(0, 60) })
        .first()
        .click();
      await page.getByText('Agent proposal', { exact: false }).waitFor({ timeout: 20_000 });
      const memoryDetail = page.getByRole('region', { name: 'Memory detail' });
      await memoryDetail.waitFor({ timeout: 10_000 });
      await page.screenshot({ path: join(EVIDENCE, '02-memory-proposal.png'), fullPage: false });
      await memoryDetail.getByRole('button', { name: 'Accept proposal', exact: true }).click();
      await page.getByText('Proposal accepted', { exact: false }).waitFor({ timeout: 20_000 });
      const accepted = JSON.parse((await api(apiBase, 'GET', `/api/memories/${proposal.id}`)).text)
        .data.memory as { status: string; source: { reference: string | null }; content: string };
      const expectedReference = `muse-asset://${uploaded.asset_id}/v${uploaded.version}`;
      if (accepted.status !== 'active') fail(`accepted memory status is ${accepted.status}`);
      if (accepted.source.reference !== expectedReference)
        fail(`source reference ${accepted.source.reference} != ${expectedReference}`);
      check(`accepted proposal is active with source-version link ${expectedReference}`);
      // ---- 2. live SAM -> inspect/select match -> save cutout -----------------
      await page.getByRole('button', { name: 'HTML Studio', exact: true }).click();
      await page.getByRole('region', { name: 'Media assets' }).waitFor({ timeout: 20_000 });
      const assetRow2 = page
        .locator('li', { has: page.locator(`img[src*="${uploaded.asset_id}"]`) })
        .first();
      await assetRow2.getByTitle('Suggest decisions or extract a cutout from this version').click();
      await page.getByTitle('Extract an object cutout with SAM').click();
      const samConcept =
        process.env.BATCHC_SMOKE_SAM_CONCEPT?.trim() || 'green rounded memory game card';
      observations.samConcept = samConcept;
      await fillStable(page, 'Segmentation concept', samConcept);
      if (calls.sam !== 0) fail('SAM call budget exhausted');
      calls.sam += 1;
      const [segmentResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes('/media/segment') && response.request().method() === 'POST',
          { timeout: LONG },
        ),
        page.getByRole('button', { name: 'Segment', exact: true }).click(),
      ]);
      const segmentBody = await segmentResponse.text();
      const segmentEnvelope = JSON.parse(segmentBody) as {
        ok?: boolean;
        data?: unknown;
        error?: { code?: unknown; message?: unknown; details?: unknown };
      };
      if (
        !segmentResponse.ok() ||
        segmentEnvelope.ok !== true ||
        segmentEnvelope.data === undefined
      ) {
        // Bounded provider evidence survives in the error envelope details
        // (dispatch count plus stream bytes/events/hash when available).
        observations.samError = {
          http_status: segmentResponse.status(),
          body: segmentBody.slice(0, 500),
          details:
            segmentEnvelope.error !== null &&
            typeof segmentEnvelope.error === 'object' &&
            (segmentEnvelope.error as { details?: unknown }).details !== undefined
              ? (segmentEnvelope.error as { details?: unknown }).details
              : null,
        };
        await page
          .screenshot({ path: join(EVIDENCE, '03-sam-failure.png'), fullPage: false })
          .catch(() => undefined);
        fail(
          `live SAM request failed (HTTP ${segmentResponse.status()}): ${segmentBody.slice(0, 300)}`,
        );
      }
      const segmentData = segmentEnvelope.data as {
        provider_attempts?: number;
        stream_events?: number;
        stream_bytes?: number;
        response_sha256?: string;
        delta_events?: number;
        ignored_events?: number;
        segment_id: string;
        matches: Array<{
          match_index: number;
          box: { x1: number; y1: number; x2: number; y2: number };
          preview_data_url: string;
          confidence?: number;
        }>;
      };
      await new Promise((resolve) => setTimeout(resolve, 350));
      const samAttempts = countModelAttempts(readMediaTrace(SERVER_LOG), 'sam-');
      observations.requestedSamModel = effectiveMeta.media?.sam_model ?? null;
      observations.samProviderAttempts = samAttempts;
      observations.providerAttempts = {
        ...(observations.providerAttempts as Record<string, number> | undefined),
        sam: samAttempts,
      };
      try {
        assertSingleProviderAttempt({
          capability: 'SAM',
          responseAttempts: segmentData.provider_attempts,
          traceAttempts: samAttempts,
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
      observations.segment = {
        segment_id: segmentData.segment_id,
        matches: segmentData.matches.map((m) => ({
          match_index: m.match_index,
          box: m.box,
          confidence: m.confidence,
        })),
        // Bounded streaming evidence preserved from the API response.
        stream_events: segmentData.stream_events ?? null,
        stream_bytes: segmentData.stream_bytes ?? null,
        response_sha256: segmentData.response_sha256 ?? null,
        delta_events: segmentData.delta_events ?? null,
        ignored_events: segmentData.ignored_events ?? null,
      };
      if (segmentData.matches.length === 0) {
        observations.samEmpty = { concept: samConcept, segment_id: segmentData.segment_id };
        await page
          .screenshot({ path: join(EVIDENCE, '03-sam-zero-matches.png'), fullPage: false })
          .catch(() => undefined);
        fail(
          `SAM returned zero matches for concept ${JSON.stringify(samConcept)} (valid empty lane; unusable for acceptance; stopping, no retry)`,
        );
      }
      await page.getByRole('button', { name: /Match 0 preview/ }).waitFor({ timeout: 20_000 });
      check(`live SAM returned ${segmentData.matches.length} match(es) with previews (one call)`);
      for (const match of segmentData.matches) {
        const b64 = match.preview_data_url.split(',')[1] ?? '';
        writeFileSync(
          join(EVIDENCE, `overlay-match-${match.match_index}.png`),
          Buffer.from(b64, 'base64'),
        );
      }
      await page.screenshot({ path: join(EVIDENCE, '03-sam-overlays.png'), fullPage: false });
      const chosen = segmentData.matches.length > 1 ? 1 : 0;
      await page.getByRole('button', { name: new RegExp(`Match ${chosen} preview`) }).click();
      await page
        .getByRole('button', { name: new RegExp(`Save cutout of match ${chosen}`) })
        .click();
      await page
        .getByText('Cutout saved as a new candidate asset', { exact: false })
        .waitFor({ timeout: 30_000 });
      cutoutRecord = (mediaResponses.cutout ?? []).at(-1) as
        | {
            asset_id: string;
            version: number;
            parent?: unknown;
            source?: unknown;
            sha256?: string;
            model?: unknown;
          }
        | undefined;
      if (!cutoutRecord) fail('cutout response was not captured');
      observations.cutout = cutoutRecord;
      check(
        `saved cutout of match ${chosen} as asset ${cutoutRecord.asset_id.slice(0, 8)} v${cutoutRecord.version}`,
      );
    } else {
      // Resume-cutout: upload the retained SAM cutout bytes as a new asset
      // and approve it through the normal UI flow below. Bytes, box, and
      // concept are retained live output from the cited run — labeled as
      // such, never a fresh SAM or vision result.
      if (!retainedCutout) fail('cutout continuation requested without retained cutout bytes');
      if (calls.sam !== 0 || calls.vision !== 0)
        fail('cutout continuation call budget must start at zero');
      const uploadedRefSha = sha256(imageBytes);
      if (uploadedRefSha !== retainedCutout.referenceSha256)
        fail('reference image bytes differ from the retained cutout evidence');
      observations.samConcept = `${retainedCutout.concept} (retained; no new dispatch)`;
      observations.samEmpty = null;
      const cutoutUploaded = dataOf(
        await api(apiBase, 'POST', `/api/forge/projects/${PROJECT}/media/upload`, {
          mime: 'image/png',
          data_base64: retainedCutout.bytes.toString('base64'),
          source_text: `retained live SAM cutout from ${resumeCutoutDir} (no new SAM dispatch)`,
        }),
        'upload retained cutout',
      ) as { asset_id: string; version: number };
      cutoutRecord = {
        asset_id: cutoutUploaded.asset_id,
        version: cutoutUploaded.version,
      };
      observations.cutoutSource = {
        reusedFrom: resumeCutoutDir,
        originalSegmentId: retainedCutout.segmentId,
        retainedSha256: retainedCutout.sha256,
        retainedBytes: retainedCutout.bytes.length,
        concept: retainedCutout.concept,
        box: retainedCutout.box,
        maskWidth: retainedCutout.maskWidth,
        maskHeight: retainedCutout.maskHeight,
        referenceSha256: retainedCutout.referenceSha256,
        note: 'retained live SAM output; no new SAM or vision dispatch in this run',
      };
      observations.providerAttempts = { vision: 0, sam: 0 };
      observations.requestedVisionModel = effectiveMeta.media?.vision_model ?? null;
      observations.requestedSamModel = effectiveMeta.media?.sam_model ?? null;
      observations.cutout = {
        ...cutoutRecord,
        retainedFrom: resumeCutoutDir,
        originalSegmentId: retainedCutout.segmentId,
      };
      check(
        `uploaded retained cutout as asset ${cutoutRecord.asset_id.slice(0, 8)} v${cutoutRecord.version} (no new SAM call)`,
      );
      await page.reload({ waitUntil: 'networkidle', timeout: 30_000 });
      await page
        .locator(`img[src*="${cutoutRecord.asset_id}"]`)
        .first()
        .waitFor({ timeout: 20_000 });
    }
    if (!cutoutRecord) fail('no cutout asset available');

    const cutoutBytes = (
      await api(
        apiBase,
        'GET',
        `/api/forge/projects/${PROJECT}/media/${cutoutRecord.asset_id}/versions/${cutoutRecord.version}/bytes`,
      )
    ).bytes;
    const alpha = readAlphaStats(cutoutBytes);
    observations.cutoutPng = { bytes: cutoutBytes.length, sha256: sha256(cutoutBytes), ...alpha };
    if (resumeCutoutDir) {
      // Round-trip integrity: the served bytes must equal the retained cutout.
      if (!retainedCutout || sha256(cutoutBytes) !== retainedCutout.sha256)
        fail('served cutout bytes differ from the retained cutout');
    }
    writeFileSync(join(EVIDENCE, 'cutout.png'), cutoutBytes);
    if (alpha.transparent === 0) fail('cutout PNG has no transparent pixels (unusable)');
    copyFileSync(IMAGE, join(EVIDENCE, 'source-reference.png'));
    // checkerboard view for human visual review (not a format check)
    const checker = await context.newPage();
    await checker.setContent(
      `<!doctype html><style>html,body{margin:0;height:100%}body{display:grid;place-items:center;background:#fff}div{width:720px;height:540px;background-image:linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%);background-size:32px 32px;background-position:0 0,0 16px,16px -16px,-16px 0;display:grid;place-items:center}img{max-width:100%;max-height:100%;image-rendering:pixelated}</style><div><img alt="checkerboard cutout" src="${apiBase}/api/forge/projects/${PROJECT}/media/${cutoutRecord.asset_id}/versions/${cutoutRecord.version}/bytes"></div>`,
      { waitUntil: 'networkidle' },
    );
    await checker.locator('img').waitFor({ timeout: 20_000 });
    await checker.screenshot({
      path: join(EVIDENCE, '04-cutout-checkerboard.png'),
      fullPage: true,
    });
    await checker.close();
    check('captured source, overlay and checkerboard cutout evidence for visual review');

    // ---- 3. approve cutout, Insert into Studio, ONE live coding request -----
    const cutoutRow = page
      .locator('li', { has: page.locator(`img[src*="${cutoutRecord.asset_id}"]`) })
      .first();
    await cutoutRow.getByTitle('Approve this version').click();
    await cutoutRow.getByText(/Approved: v/).waitFor({ timeout: 20_000 });
    check('approved cutout candidate');
    await cutoutRow.getByTitle('Insert this reference into the instruction').click();
    const placeholder = /muse-asset:\/\/[^\s"'<>`]+/.exec(
      await page.getByLabel('Change request').inputValue(),
    )?.[0];
    if (!placeholder?.startsWith('muse-asset://'))
      fail('Insert did not place a well-formed placeholder');
    observations.placeholder = placeholder;
    check(`Insert placed ${placeholder} in the Studio change draft`);

    if (calls.coding !== 0) fail('coding call budget exhausted');
    await fillStable(
      page,
      'Change request',
      `${placeholder}\nUse this cutout verbatim as the src of an <img> in a small gallery card. Do not remove or rewrite the placeholder. Keep the page small and valid.`,
    );
    // Bounded Generate-request diagnostics: distinguish click fired /
    // request emitted / HTTP response / job created / provider attempt
    // without logging credentials or the raw prompt (path + status and
    // bounded transport failure text only). `calls.coding` counts the UI
    // submission (the click); the provider attempt stays unknown until a
    // job record says otherwise — never relabeled as zero.
    const generateUrlPart = `/api/forge/projects/${PROJECT}/generate`;
    type GenerateProbe = {
      phase: 'request' | 'response' | 'requestfailed';
      status?: number;
      failure?: string;
    };
    const generateProbe: GenerateProbe[] = [];
    const onGenerateRequest = (request: { url: () => string; method: () => string }): void => {
      if (request.method() === 'POST' && request.url().includes(generateUrlPart))
        generateProbe.push({ phase: 'request' });
    };
    const onGenerateResponse = (response: { url: () => string; status: () => number }): void => {
      if (response.url().includes(generateUrlPart))
        generateProbe.push({ phase: 'response', status: response.status() });
    };
    const onGenerateFailed = (request: {
      url: () => string;
      failure: () => { errorText: string } | null;
    }): void => {
      if (request.url().includes(generateUrlPart))
        generateProbe.push({
          phase: 'requestfailed',
          failure: (request.failure()?.errorText ?? 'unknown').slice(0, 120),
        });
    };
    page.on('request', onGenerateRequest);
    page.on('response', onGenerateResponse);
    page.on('requestfailed', onGenerateFailed);
    let generateClicked = false;
    let changeResponse: Awaited<ReturnType<typeof page.waitForResponse>> | null = null;
    let generateError: unknown = null;
    try {
      const [resp] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes(generateUrlPart) && response.request().method() === 'POST',
          { timeout: 30_000 },
        ),
        page
          .getByRole('button', { name: 'Generate change', exact: true })
          .click()
          .then(() => {
            generateClicked = true;
            calls.coding += 1;
          }),
      ]);
      changeResponse = resp;
    } catch (error) {
      // waitForResponse rejects on timeout; the click may still have
      // fired (or hung). Fall through to diagnostics, never silently.
      generateError = error;
    } finally {
      page.off('request', onGenerateRequest);
      page.off('response', onGenerateResponse);
      page.off('requestfailed', onGenerateFailed);
    }
    if (!changeResponse) {
      await page
        .screenshot({ path: join(EVIDENCE, '05-generate-failure.png'), fullPage: false })
        .catch(() => undefined);
      observations.generateAttempt = {
        clicked: generateClicked,
        requestEmitted: generateProbe.some((entry) => entry.phase === 'request'),
        responseReceived: generateProbe.some((entry) => entry.phase === 'response'),
        httpStatus: generateProbe.find((entry) => entry.phase === 'response')?.status ?? null,
        jobCreated: false,
        transportFailures: generateProbe.filter((entry) => entry.phase === 'requestfailed'),
        consoleTail: errors.slice(-8).map((text) => text.slice(0, 200)),
        waitError: generateError instanceof Error ? generateError.message.slice(0, 200) : null,
        uiSubmissions: calls.coding,
        providerObserved: null,
        note: 'no job record: provider invocation unknown, not zero',
      };
      fail(
        `generate step produced no usable HTTP response (clicked=${String(generateClicked)} ` +
          `request=${String(generateProbe.some((entry) => entry.phase === 'request'))} ` +
          `response=${String(generateProbe.some((entry) => entry.phase === 'response'))}); ` +
          'provider invocation unknown — see observations.generateAttempt',
      );
    }
    const changeJob = JSON.parse(await changeResponse.text()).data as { id: string };
    observations.codingJobId = changeJob.id;
    await page.getByText('Change staged.', { exact: false }).waitFor({ timeout: LONG });
    check('ONE live coding request staged an application using the cutout');
    const jobData = JSON.parse((await api(apiBase, 'GET', `/api/forge/jobs/${changeJob.id}`)).text)
      .data as {
      usage?: unknown;
      model_observed?: string | null;
      status: string;
    };
    const jobLogs = JSON.stringify((jobData as { logs?: unknown }).logs ?? '');
    if (/fallback/i.test(jobLogs)) {
      fail('coding job logs report a fallback invocation; one-request budget not enforceable');
    }
    observations.codingUsage = jobData.usage ?? null;
    const codingUsage = jobData.usage as { calls?: number } | null;
    observations.codingProviderAttempts = codingUsage?.calls ?? null;
    observations.providerAttempts = {
      ...(observations.providerAttempts as Record<string, number | null> | undefined),
      coding: codingUsage?.calls ?? null,
    };
    observations.codingModelObserved = jobData.model_observed ?? null;
    observations.requestedCodingModel = meta.forge?.configured_model ?? null;
    observations.codingModelObserved = jobData.model_observed ?? meta.forge?.observed_model ?? null;
    if (jobData.status !== 'succeeded') fail(`coding job status ${jobData.status}`);
    await page.getByRole('tab', { name: 'Preview' }).click();
    await page
      .frameLocator('iframe[title="HTML application preview"]')
      .locator('img')
      .first()
      .waitFor({ timeout: 30_000 });
    await page.screenshot({ path: join(EVIDENCE, '05-staged-preview.png'), fullPage: false });
    check('staged preview renders the inserted cutout');

    const review = page.getByRole('region', { name: 'Review' });
    await review.getByRole('button', { name: /^Approve (& publish )?v2/ }).click();
    await page
      .getByText('Previous versions remain available in history.', { exact: false })
      .waitFor({ timeout: LONG });
    const v2 = await artifact(apiBase);
    const embedded = readEmbedded(v2.html);
    if (!embedded) fail('approved v2 has no embedded image');
    if (v2.html.includes('muse-asset://')) fail('approved v2 has an unresolved asset reference');
    if (embedded.sha !== sha256(cutoutBytes))
      fail('embedded bytes differ from the approved cutout');
    observations.approvedV2 = {
      htmlSha256: v2.versionSha,
      embedded: { mime: embedded.mime, bytes: embedded.bytes.length, sha256: embedded.sha },
    };
    await page.screenshot({ path: join(EVIDENCE, '06-approved-embedded.png'), fullPage: false });
    check(`approved v2 embeds the exact cutout bytes (${embedded.sha.slice(0, 12)}…)`);

    // ---- 4. restart: exact HTML + embedded bytes ----------------------------
    await stop(server);
    server = startApi();
    await waitForHttp(`${apiBase}/api/health`);
    // The restarted process must prove the same verified build identity;
    // a mismatched or missing identity stops the run before acceptance
    // continues on an unverified server.
    const revivedMeta = JSON.parse((await api(apiBase, 'GET', '/api/meta')).text).data as {
      build?: { commit?: string; source_hash?: string; built_at?: string } | null;
    };
    const revivedIdentity = revivedMeta.build ?? null;
    observations.serverIdentityAfterRestart = revivedIdentity;
    if (
      revivedIdentity === null ||
      revivedIdentity.commit !== runtimeIdentity?.commit ||
      revivedIdentity.source_hash !== runtimeIdentity?.source_hash
    ) {
      fail(
        `restarted API identity does not match the verified build: ${JSON.stringify(revivedIdentity)}`,
      );
    }
    check('restarted API proves the same verified build identity');
    await page.reload({ waitUntil: 'networkidle', timeout: 30_000 });
    await page.getByText('v2 approved', { exact: false }).waitFor({ timeout: 30_000 });
    const revived = await artifact(apiBase);
    const revivedEmbedded = readEmbedded(revived.html);
    if (revived.versionSha !== v2.versionSha) fail('version HTML changed across restart');
    if (!revivedEmbedded || revivedEmbedded.sha !== embedded.sha)
      fail('embedded image bytes changed across restart');
    observations.restart = { htmlSha256: revived.versionSha, embeddedSha256: revivedEmbedded.sha };
    check('restart preserved byte-identical v2 HTML and embedded asset bytes');

    // ---- 5. rollback to seeded v1; v2/embedded bytes stay intact ------------
    await page.getByRole('button', { name: 'Undo last change' }).click();
    await page.getByRole('button', { name: 'Restore v1', exact: true }).click();
    await page.getByText('v1 approved', { exact: false }).waitFor({ timeout: 30_000 });
    const v1 = await artifact(apiBase);
    if (v1.versionSha !== seed.baselineSha256) fail('rollback HTML is not the seeded v1 baseline');
    const v2File = readFileSync(join(workspaceRoot, PROJECT, 'versions', '2', 'index.html'));
    const v2FileEmbedded = readEmbedded(v2File.toString('utf8'));
    if (sha256(v2File) !== v2.versionSha) fail('v2 version file changed after rollback');
    if (!v2FileEmbedded || v2FileEmbedded.sha !== embedded.sha)
      fail('v2 embedded bytes changed after rollback');
    observations.rollback = {
      currentHtmlSha256: v1.versionSha,
      seededBaselineSha256: seed.baselineSha256,
      retainedV2HtmlSha256: sha256(v2File),
      retainedV2EmbeddedSha256: v2FileEmbedded.sha,
    };
    await page.screenshot({ path: join(EVIDENCE, '07-rollback-v1.png'), fullPage: false });
    check('rollback restored exact v1 HTML; v2 HTML/embedded bytes remain intact');

    if (errors.length > 0) fail(`console/page errors: ${errors.join(' | ').slice(0, 500)}`);
    assertPaidCallBudget();
    console.log(`\nlive Batch C smoke: PASS (${checks.length} checks)`);
    console.log(
      `calls: vision=${calls.vision} sam=${calls.sam} coding=${calls.coding} imageGeneration=${calls.imageGeneration}`,
    );
  } finally {
    try {
      await writeEvidence();
    } catch (error) {
      console.error(
        `evidence write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await stop(server);
    if (web) await stop(web);
    await browser.close().catch(() => undefined);
  }
}

async function artifact(apiBase: string): Promise<{ html: string; versionSha: string }> {
  const body = JSON.parse(
    (await api(apiBase, 'GET', `/api/forge/projects/${PROJECT}/artifact`)).text,
  ).data as { html: string; sha256: string };
  if (sha256(body.html) !== body.sha256) fail('artifact endpoint sha mismatch');
  return { html: body.html, versionSha: body.sha256 };
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  // The failure message is evidence too: record it so the report is
  // self-contained even when the run dies before any check completes.
  // The finally block inside main() already wrote the report once without
  // this message, so allow exactly one rewrite that preserves everything
  // accumulated so far (checks, observations, screenshots on disk).
  observations.error = error instanceof Error ? error.message : String(error);
  evidenceWritten = false;
  try {
    await writeEvidence();
  } catch {
    /* evidence best-effort on failure */
  }
  process.exitCode = 1;
});
