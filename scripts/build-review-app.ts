/**
 * Build a real Muse app for **human** quality review, and package the evidence a
 * person needs to judge it.
 *
 * This is the one workflow in the repository whose output cannot be scored by a
 * gate. Everything else here asks a question with a yes/no answer ("did the
 * restart keep the bytes identical?", "was there exactly one paid dispatch?").
 * The remaining open questions in the beta are judgement: is the generated app
 * good, did it follow the project's decisions, would you hand it to a colleague.
 * So this script spends its machine effort on two things only —
 *
 *   1. producing the app through the product's own path (real coding model, real
 *      approval, real served artifact), and
 *   2. proving whether the evidence it captured is worth judging at all
 *      (`scripts/lib/review-packet.ts`),
 *
 * and then stops. The judgement sheet in `review-packet.md` is left blank on
 * purpose.
 *
 * Cost: exactly **one coding job**, capped by `REVIEW_APP_MAX_CALLS` internal
 * calls (default 12), submitted under an Idempotency-Key so a client-side retry
 * cannot spend a second job. Zero provider media calls: the media adapter traces
 * every dispatch and the run fails its own accounting if any appears.
 *
 * Prerequisites: the configured credential and coding CLI. With no credential the
 * run refuses (exit 2) rather than falling back to the deterministic fake CLI: an
 * app nobody had to pay for is not evidence of model quality.
 *
 * Usage:
 *   FORGE_MUSE_API_KEY=... FORGE_MUSE_BIN=$(command -v muse) pnpm run review:app
 *
 * A further app is one command away:
 *   REVIEW_APP_SLUG=habit-garden REVIEW_APP_BRIEF_FILE=docs/review-apps/habit-garden-brief.md \
 *   REVIEW_APP_DECISIONS_FILE=docs/review-apps/habit-garden-decisions.json pnpm run review:app
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright-core';
import { PNG } from 'pngjs';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';
import { describeBundleIdentity, verifyBuildProvenance } from './lib/build-provenance.js';
import {
  classifyGateFailure,
  describeGateOutcome,
  GATE_PASS,
  PrerequisiteRefusal,
} from './lib/gate-outcome.js';
import { readCodingJobs, totalCodingCalls } from './lib/media-live.js';
import { accountDispatches, ledgerEvidence, readMediaTrace } from './lib/media-trace.js';
import { type PacketFacts, packetIssues, renderReviewPacket } from './lib/review-packet.js';

const ROOT = process.cwd();
const APP = process.env.REVIEW_APP_SLUG?.trim() || 'palette-bench';
const BRIEF_FILE = process.env.REVIEW_APP_BRIEF_FILE?.trim() || `docs/review-apps/${APP}-brief.md`;
const DECISIONS_FILE =
  process.env.REVIEW_APP_DECISIONS_FILE?.trim() || `docs/review-apps/${APP}-decisions.json`;
const MAX_CALLS_PER_JOB = Number(process.env.REVIEW_APP_MAX_CALLS ?? '12');
const CODING_MODEL = process.env.REVIEW_APP_CODING_MODEL?.trim() || 'muse-wonder-1.0';
const PROJECT = `review-${APP}`;
const STAMP = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);
const OUT = join(ROOT, 'test-results', 'human-review', `${APP}-${STAMP}`);
const JOB_TIMEOUT_MS = Number(process.env.REVIEW_APP_JOB_TIMEOUT_MS ?? '900000');

const LOADED_VIA =
  'the artifact bytes loaded as a document from disk (the artifact endpoint itself answers with a JSON envelope for the Studio preview)';

const checks: string[] = [];
const observations: Record<string, unknown> = {};
let dataRoot: string | null = null;
let reportStatus = 'PASS';
let reportOk = true;

function check(label: string): void {
  checks.push(label);
  console.log(`  ✓ ${label}`);
}

function logPath(name: string): string {
  return join(OUT, `${name}.log`);
}

interface ArtifactInfo {
  version: number | null;
  sha256: string;
  bytes: number;
  lines: number | null;
  title: string;
}

type PageFacts = PacketFacts['page'];

interface Managed {
  child: ChildProcess;
  log: string;
  stop: () => Promise<void>;
}

function start(name: string, command: string, args: string[], env: NodeJS.ProcessEnv): Managed {
  const log = logPath(name);
  const child = spawn(command, args, {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const handle = (chunk: Buffer): void => {
    writeFileSync(log, `${readFileSync(log, 'utf8')}${chunk.toString()}`.slice(-2_000_000));
  };
  child.stdout?.on('data', handle);
  child.stderr?.on('data', handle);
  writeFileSync(log, '');
  return {
    child,
    log,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
          }, 5_000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    },
  };
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === 'string') throw new Error('could not allocate a port');
  return address.port;
}

async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `HTTP ${String(response.status)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for ${url}: ${last}`);
}

function dataOf(body: unknown): Record<string, unknown> {
  const record = body as Record<string, unknown>;
  const data = record.data ?? record;
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
}

async function apiJson(
  base: string,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${path} -> HTTP ${String(response.status)}: ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  return dataOf(body);
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Distinct colours in a PNG, as a blank-page detector and nothing more. */
function distinctColors(pngBytes: Buffer): number {
  const png = PNG.sync.read(pngBytes);
  const seen = new Set<number>();
  for (let i = 0; i + 2 < png.data.length; i += 4) {
    seen.add(
      (png.data[i] as number) * 65_536 +
        (png.data[i + 1] as number) * 256 +
        (png.data[i + 2] as number),
    );
    if (seen.size > 4_096) break;
  }
  return seen.size;
}

function writeReport(status: string, extra: Record<string, unknown> = {}): void {
  const report = {
    ok: reportOk,
    gate: 'review-app',
    app: APP,
    project: PROJECT,
    stamp: STAMP,
    status,
    paid: {
      coding_jobs: 1,
      max_calls_per_job: MAX_CALLS_PER_JOB,
      idempotency_key: observations.idempotency_key ?? null,
      media_dispatches: observations.media_dispatches ?? null,
      coding_calls_known: observations.coding_calls_known ?? null,
      coding_calls_unknown_jobs: observations.coding_calls_unknown_jobs ?? null,
    },
    checks,
    observations: { ...observations, ...extra },
    generated_at: new Date().toISOString(),
  };
  writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

async function main(): Promise<void> {
  const briefPath = join(ROOT, BRIEF_FILE);
  const decisionsPath = join(ROOT, DECISIONS_FILE);
  if (!existsSync(briefPath)) {
    throw new PrerequisiteRefusal(
      `no brief at ${BRIEF_FILE}: an app needs a brief before it can be judged`,
    );
  }
  if (!existsSync(decisionsPath)) {
    throw new PrerequisiteRefusal(
      `no decisions file at ${DECISIONS_FILE}: the review asks whether the app followed decisions that were never seeded`,
    );
  }
  const bin = process.env.FORGE_MUSE_BIN?.trim() ?? '';
  if (bin.length === 0 || !existsSync(bin)) {
    throw new PrerequisiteRefusal(
      `FORGE_MUSE_BIN must name a real coding CLI (got "${bin || '(unset)'}")`,
    );
  }
  const key = process.env.FORGE_MUSE_API_KEY?.trim() ?? '';
  if (key.length === 0) {
    throw new PrerequisiteRefusal(
      'FORGE_MUSE_API_KEY is not set: an app produced by the deterministic fake CLI is not evidence of model quality, so this gate refuses rather than fake it',
    );
  }
  if (!Number.isInteger(MAX_CALLS_PER_JOB) || MAX_CALLS_PER_JOB < 1 || MAX_CALLS_PER_JOB > 30) {
    throw new PrerequisiteRefusal(
      `REVIEW_APP_MAX_CALLS must be an integer between 1 and 30 (got ${String(MAX_CALLS_PER_JOB)})`,
    );
  }

  const brief = readFileSync(briefPath, 'utf8');
  const seeded = JSON.parse(readFileSync(decisionsPath, 'utf8')) as {
    decisions?: { type?: string; content?: string; confidence?: number; tags?: string[] }[];
  };
  if (!Array.isArray(seeded.decisions) || seeded.decisions.length === 0) {
    throw new PrerequisiteRefusal(`${DECISIONS_FILE} holds no decisions`);
  }

  mkdirp(OUT);
  writeFileSync(join(OUT, 'brief.md'), brief);
  copyFileSync(decisionsPath, join(OUT, 'decisions-requested.json'));

  const provenance = verifyBuildProvenance({ root: ROOT });
  const identity = describeBundleIdentity(provenance);
  observations.buildProvenance = {
    commit: provenance.commit,
    treeClean: provenance.treeClean,
    bundlesBuiltAtHead: identity.builtAtHead,
    bundlesBuiltFromCleanTree: identity.builtFromCleanTree,
    bundlesBuiltAtCommit: identity.builtAtCommit,
    supportsCommitIdentity: identity.supportsCommitIdentity,
    serverBuildHash: identity.serverBuildHash,
    webBuildHash: identity.webBuildHash,
    identity_note: identity.note,
  };
  console.log(`  bundles: ${identity.note}`);

  const launched = await launchVerificationBrowser();
  const browser: Browser = launched.browser;
  reportBrowserSelection(launched.selection);
  check(`browser available: ${launched.selection.selected ?? launched.selection.attempted}`);

  const serverPort = await freePort();
  dataRoot = mkdtempSync(join(tmpdir(), `review-app-${APP}-`));
  const apiBase = `http://127.0.0.1:${serverPort}`;

  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(serverPort),
    DATABASE_PATH: join(dataRoot, 'memory.db'),
    WORKSPACE_ROOT: join(dataRoot, 'workspaces'),
    CORS_ORIGINS: apiBase,
    MODEL_PROVIDER: 'echo',
    LOG_LEVEL: 'warn',
    FORGE_MUSE_BIN: bin,
    FORGE_MUSE_API_KEY: key,
    FORGE_MUSE_MODEL: CODING_MODEL,
    FORGE_REASONING_EFFORT: 'low',
    FORGE_MAX_CALLS: String(MAX_CALLS_PER_JOB),
    FORGE_MAX_RUNTIME_MS: '600000',
    // No media call should happen at all; if one does, the ledger has to show it.
    FORGE_MEDIA_MAX_RETRIES: '0',
    FORGE_MEDIA_TRACE: '1',
  };
  const server = start(
    'api',
    process.execPath,
    [join(ROOT, 'apps/server/dist/index.js')],
    serverEnv,
  );
  try {
    await waitForHttp(`${apiBase}/api/health`);
    check('started the production API on an isolated database and workspace');

    await apiJson(apiBase, '/api/forge/projects', {
      method: 'POST',
      body: JSON.stringify({ project_id: PROJECT, name: `${APP} (human review)` }),
    });

    const decisions: PacketFacts['decisions'] = [];
    for (const decision of seeded.decisions ?? []) {
      if (typeof decision.content !== 'string' || typeof decision.type !== 'string') {
        throw new Error('a seeded decision is missing type or content');
      }
      const created = await apiJson(apiBase, '/api/memories', {
        method: 'POST',
        body: JSON.stringify({
          type: decision.type,
          scope: 'project',
          project_id: PROJECT,
          content: decision.content,
          confidence: decision.confidence ?? 0.9,
          validation_status: 'verified',
          tags: decision.tags ?? [],
        }),
      });
      const memory = (created.memory ?? created) as Record<string, unknown>;
      if (typeof memory.id !== 'string' || typeof memory.revision !== 'number') {
        throw new Error('the memory API returned a decision without an id and revision');
      }
      decisions.push({
        id: memory.id,
        revision: memory.revision,
        type: decision.type,
        content: decision.content,
      });
    }
    check(`seeded ${String(decisions.length)} project decisions at pinned revisions`);
    observations.decisions = decisions;

    // One job, submitted once, under an Idempotency-Key: if the response is lost
    // the replay returns the recorded answer instead of starting a second job.
    const idempotencyKey = randomUUID();
    observations.idempotency_key = idempotencyKey;
    const job = dataOf(
      await apiJson(apiBase, `/api/forge/projects/${PROJECT}/generate`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ prompt: brief }),
      }),
    );
    const jobId = typeof job.id === 'string' ? job.id : '';
    if (jobId.length === 0) throw new Error('the generate call returned no job id');
    let jobStatus = typeof job.status === 'string' ? job.status : 'queued';
    let jobKind = typeof job.kind === 'string' ? job.kind : 'generate';
    let jobUsageCalls: number | null = null;
    let jobModel: string | null = null;
    observations.job = { id: jobId, kind: jobKind, status: jobStatus };
    check(
      `submitted one generate job (${jobId.slice(0, 8)}) capped at ${String(MAX_CALLS_PER_JOB)} internal calls`,
    );

    const deadline = Date.now() + JOB_TIMEOUT_MS;
    while (jobStatus === 'queued' || jobStatus === 'running') {
      if (Date.now() > deadline) {
        await apiJson(apiBase, `/api/forge/jobs/${jobId}/cancel`, { method: 'POST' }).catch(
          () => undefined,
        );
        throw new Error(
          `coding job ${jobId.slice(0, 8)} did not finish within ${String(JOB_TIMEOUT_MS)}ms and was cancelled`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const polled = dataOf(await apiJson(apiBase, `/api/forge/jobs/${jobId}`));
      if (typeof polled.status === 'string') jobStatus = polled.status;
      if (typeof polled.kind === 'string') jobKind = polled.kind;
      const usage = polled.usage as Record<string, unknown> | undefined;
      if (typeof usage?.calls === 'number') jobUsageCalls = usage.calls;
      if (typeof polled.model_observed === 'string') jobModel = polled.model_observed;
      observations.job = {
        id: jobId,
        kind: jobKind,
        status: jobStatus,
        usage_calls: jobUsageCalls,
        model_observed: jobModel,
      };
    }
    if (jobStatus !== 'succeeded') {
      throw new Error(`the coding job ended ${jobStatus}: nothing was staged to approve`);
    }
    check(`the coding CLI staged a version (model ${jobModel ?? 'unnamed'}, CLI ${bin})`);
    observations.coding_cli = bin;

    await apiJson(apiBase, `/api/forge/jobs/${jobId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ capture_memory: false }),
    });
    const artifact = dataOf(await apiJson(apiBase, `/api/forge/projects/${PROJECT}/artifact`));
    const html = typeof artifact.html === 'string' ? artifact.html : '';
    const sha = typeof artifact.sha256 === 'string' ? artifact.sha256 : '';
    if (html.length === 0) throw new Error('the approved artifact holds no HTML');
    if (sha !== sha256(html)) {
      throw new Error('the artifact hash the API reported does not match the bytes it returned');
    }
    writeFileSync(join(OUT, 'artifact.html'), html);
    const artifactInfo: ArtifactInfo = {
      version: typeof artifact.version === 'number' ? artifact.version : null,
      sha256: sha,
      bytes: Buffer.byteLength(html, 'utf8'),
      lines: typeof artifact.lines === 'number' ? artifact.lines : null,
      title: typeof artifact.title === 'string' ? artifact.title : '',
    };
    observations.artifact = { ...artifactInfo, saved_to: 'artifact.html' };
    check(
      `approved v${String(artifactInfo.version ?? '?')} and saved the artifact (${String(artifactInfo.bytes)} bytes)`,
    );

    // Read the job back out of the workspace isolate as well: the API's own
    // numbers describe what it thinks it did, the record says what it spent.
    const jobs = readCodingJobs(join(dataRoot, 'workspaces', 'forge', PROJECT));
    const totals = totalCodingCalls(jobs);
    observations.coding_job_records = jobs;
    observations.coding_calls_known = totals.known;
    observations.coding_calls_unknown_jobs = totals.unknownJobs;
    const record = jobs.find((entry) => entry.job_id === jobId) ?? jobs[0];

    const trace = accountDispatches(readMediaTrace(server.log));
    observations.media_dispatches = trace.dispatches.length;
    observations.media_ledger = { ...ledgerEvidence(server.log), dispatch_paths: trace.paths };
    if (trace.dispatches.length > 0) {
      throw new Error(
        `this app was supposed to cost no media call and the ledger shows ${String(trace.dispatches.length)}: ${trace.paths.join(', ')}`,
      );
    }
    check('the ledger records zero provider media calls');

    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    const httpFailures: string[] = [];
    const nonLocal: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200));
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message.slice(0, 200)));
    page.on('requestfailed', (request) =>
      httpFailures.push(`${request.method()} ${request.url()}`.slice(0, 200)),
    );
    page.on('response', (response) => {
      if (response.status() >= 400)
        httpFailures.push(`${String(response.status())} ${response.url()}`.slice(0, 200));
    });
    page.on('request', (request) => {
      const host = new URL(request.url()).hostname;
      if (host !== '127.0.0.1' && host !== 'localhost') nonLocal.push(host);
    });
    // The artifact endpoint answers with a JSON envelope, which is what the
    // Studio reads to render its sandboxed preview. Judging the app means
    // loading the artifact bytes as a document, so the screenshot shows the app
    // rather than the transport. This is recorded in the packet, because an app
    // seen through the product's own preview could behave differently.
    const endpointResponse = await fetch(`${apiBase}/api/forge/projects/${PROJECT}/artifact`);
    observations.artifact_endpoint_content_type =
      endpointResponse.headers.get('content-type') ?? 'none';
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`file://${join(OUT, 'artifact.html')}`, { waitUntil: 'load' });
    await page.waitForTimeout(1_500);
    const shot = await page.screenshot({ path: join(OUT, 'app-1280.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    const mobile = await page.screenshot({ path: join(OUT, 'app-390.png'), fullPage: true });
    const domFacts = await page.evaluate(() => ({
      title: document.title,
      controls: document.querySelectorAll('button, input, select, a[href], textarea').length,
      text_length: (document.body?.textContent ?? '').length,
    }));
    await page.close();

    const pageInfo: PageFacts = {
      title: domFacts.title,
      interactive_controls: domFacts.controls,
      distinct_colors: distinctColors(shot),
      console_errors: consoleErrors.length,
      http_failures: httpFailures.length,
      non_local_requests: [...new Set(nonLocal)],
    };
    observations.page = { ...pageInfo, visible_text_characters: domFacts.text_length };
    observations.console_errors = consoleErrors;
    check(
      `the approved artifact loads: ${String(pageInfo.interactive_controls)} control(s), ${String(pageInfo.distinct_colors)} distinct colour(s), ${String(pageInfo.console_errors)} console error(s)`,
    );

    const facts: PacketFacts = {
      project: PROJECT,
      app_name: APP,
      brief_path: BRIEF_FILE,
      created_at: new Date().toISOString(),
      commit: provenance.commit,
      bundle_identity: {
        server_build_hash: identity.serverBuildHash,
        web_build_hash: identity.webBuildHash,
        supports_commit_identity: identity.supportsCommitIdentity,
        note: identity.note,
      },
      decisions,
      job: {
        id: jobId,
        coding_cli: bin,
        kind: jobKind === 'modify' ? 'modify' : 'generate',
        status: jobStatus,
        usage_calls: record?.usage_calls ?? jobUsageCalls,
        model_observed: record?.model_observed ?? jobModel,
      },
      artifact: {
        version: artifactInfo.version,
        sha256: artifactInfo.sha256,
        bytes: artifactInfo.bytes,
        saved_to: join('test-results', 'human-review', `${APP}-${STAMP}`, 'artifact.html'),
      },
      media_dispatches: observations.media_dispatches as number,
      screenshots: [
        { name: 'app-1280.png', label: 'desktop 1280×800, full page', bytes: shot.length },
        { name: 'app-390.png', label: 'phone 390×844, full page', bytes: mobile.length },
      ],
      page: pageInfo,
      loaded_via: LOADED_VIA,
    };
    const issues = packetIssues(facts);
    writeFileSync(join(OUT, 'review-packet.md'), renderReviewPacket(facts, issues));
    observations.packet_issues = issues;
    check(
      `wrote the judgement sheet (${String(issues.length)} evidence issue(s) flagged) in review-packet.md`,
    );

    cpSync(dataRoot, join(OUT, 'isolate'), { recursive: true });
    reportOk = true;
    reportStatus = 'PASS';
    writeReport(reportStatus);
    console.log(
      `\nPASS: ${String(checks.length)} checks — packet: ${join(OUT, 'review-packet.md')}`,
    );
    console.log(
      `  cost: 1 coding job, ${String(observations.coding_calls_known)} internal call(s) known, ${String(observations.media_dispatches)} media call(s)`,
    );
  } finally {
    await server.stop().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

function mkdirp(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

main().then(
  async () => {
    process.exitCode = GATE_PASS.exitCode;
  },
  async (error: unknown) => {
    const outcome = classifyGateFailure(error);
    reportOk = false;
    reportStatus =
      outcome.kind === 'blocked' ? `BLOCKED: ${outcome.reason}` : `FAILED: ${outcome.reason}`;
    console.error(`\n${describeGateOutcome(outcome)}`);
    if (outcome.kind === 'failed')
      console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    try {
      writeReport(reportStatus);
      if (dataRoot && existsSync(dataRoot)) {
        cpSync(dataRoot, join(OUT, 'isolate-at-failure'), { recursive: true });
      }
    } catch {
      /* evidence is best effort */
    }
    console.error(`evidence: ${OUT}`);
    process.exitCode = outcome.exitCode;
  },
);
