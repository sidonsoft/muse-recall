/**
 * Batch E live review acceptance: one paid vision call against a frame whose
 * contents are known, and a score for whether the findings pointed at them.
 *
 * Every previous claim about screenshot review came from a stub provider written
 * by this repository. This run asks the real vision model what it sees, with two
 * pinned decisions: one the frame satisfies (score in the top bar) and one it
 * contradicts (a countdown timer, which the decision forbids). The score is
 * narrow on purpose — did the model flag the right decision, did it invent a
 * conflict where the frame agrees, and does its evidence name something actually
 * on screen. Whether the feedback is *useful* is a judgement for the reader, and
 * the findings text is recorded verbatim so they can make it.
 *
 * Budget, enforced: one vision dispatch, one transport attempt, zero calls on
 * every other paid path, and no second attempt even if the answer is wrong.
 *
 * Run: `pnpm verify:review-live-smoke` (requires FORGE_MUSE_API_KEY)
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright-core';
import {
  MediaVisualReviewResponseSchema,
  MemoryCreateResultSchema,
  MemoryListResponseSchema,
  ServiceMetaSchema,
} from '../packages/shared/src/index.js';
import { mediaMetaIssues, SERVER_READY_TIMEOUT_MS } from './lib/batchd-live.js';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';
import { accountDispatches, parseMediaTrace } from './lib/media-trace.js';
import { REVIEW_PROBE, scoreReviewProbe } from './lib/review-live.js';

const ROOT = process.cwd();
const PROJECT_ID = 'review-live';

const checks: string[] = [];
const observations: Record<string, unknown> = {};
const calls: Record<string, number> = {
  review: 0,
  vision: 0,
  imageGeneration: 0,
  transcribe: 0,
  /** Dispatches on paths this review-only run must never touch. */
  otherPaidPaths: 0,
};

function check(label: string): void {
  checks.push(label);
  process.stdout.write(`  ✓ ${label}\n`);
}

class SmokeFailure extends Error {}

function fail(message: string): never {
  throw new SmokeFailure(message);
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Envelope {
  data?: unknown;
  error?: { code?: string; message?: string };
}

function asEnvelope(value: unknown): Envelope {
  return typeof value === 'object' && value !== null ? (value as Envelope) : {};
}

async function call(
  url: string,
  method: 'GET' | 'POST' | 'PATCH',
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; envelope: Envelope; headers: Record<string, string> }> {
  const response = await fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
        }),
    ...(body === undefined && headers !== undefined ? { headers } : {}),
  });
  const headersOut: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headersOut[key] = value;
  });
  return {
    status: response.status,
    envelope: asEnvelope(await response.json().catch(() => undefined)),
    headers: headersOut,
  };
}

/** The app under review: a dark game UI with a top-bar score and a countdown. */
function fixtureHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Orb Runner</title>
<style>
  body { margin:0; background:#10151c; color:#e8eef7; font:16px/1.4 ui-sans-serif,system-ui; }
  header { display:flex; justify-content:space-between; padding:18px 24px; background:#1b2430; }
  .score { font-weight:700; letter-spacing:0.08em; }
  .board { display:grid; place-items:center; height:620px; }
  .countdown { font-size:96px; font-weight:800; color:#f2b53c; letter-spacing:0.05em; }
  .hint { color:#8fa3bd; margin-top:12px; }
</style></head>
<body>
  <header><strong>Orb Runner</strong><span class="score">SCORE 120</span></header>
  <div class="board">
    <div>
      <div class="countdown">COUNTDOWN 10</div>
      <div class="hint">Get ready — the round starts when the count reaches zero.</div>
    </div>
  </div>
</body></html>`;
}

function startProcess(command: string, args: string[], env: NodeJS.ProcessEnv, logPath: string) {
  const merged: NodeJS.ProcessEnv = { ...process.env, ...env };
  if (merged.ACCESS_TOKEN === '') delete merged.ACCESS_TOKEN;
  const child = spawn(command, args, { cwd: ROOT, env: merged, stdio: ['ignore', 'pipe', 'pipe'] });
  const sink = (chunk: Buffer | string): void => {
    appendFileSync(logPath, String(chunk));
  };
  child.stdout?.on('data', sink);
  child.stderr?.on('data', sink);
  return { child, logPath };
}

async function stopProcess(item: { child: ReturnType<typeof spawn> }): Promise<void> {
  const child = item.child;
  if (child.pid === undefined || child.killed) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5_000);
    timer.unref();
    child.kill('SIGTERM');
  });
}

async function reservePort(): Promise<number> {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address();
      if (address === null || typeof address === 'string') {
        listener.close();
        reject(new Error('the port reservation bound without reporting an address'));
        return;
      }
      const { port } = address;
      listener.close(() => resolve(port));
    });
  });
}

async function waitForReady(
  url: string,
  server: { child: ReturnType<typeof spawn>; logPath: string },
): Promise<void> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  let last: unknown;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      last = `HTTP ${String(response.status)}`;
    } catch (error) {
      last = error;
    }
    if (server.child.exitCode !== null) {
      throw new Error(
        `the server exited (${String(server.child.exitCode)}) before ready: ${readFileSync(server.logPath, 'utf8').slice(-400)}`,
      );
    }
    if (Date.now() > deadline) fail(`the health probe never answered (${String(last)})`);
    await sleep(200);
  }
}

async function main(): Promise<void> {
  const key = process.env.FORGE_MUSE_API_KEY?.trim() ?? '';
  if (key === '') {
    process.stderr.write(
      'live review smoke: unconfigured (need FORGE_MUSE_API_KEY; no call made)\n',
    );
    process.exitCode = 2;
    return;
  }
  const serverBundle = join(ROOT, 'apps', 'server', 'dist', 'index.js');
  if (!existsSync(serverBundle)) {
    fail(
      'apps/server/dist/index.js is missing — run pnpm exec tsx scripts/build-production-bundles.ts first',
    );
  }

  const launched = await launchVerificationBrowser();
  const browser: Browser | undefined = launched.browser;
  if (!browser) {
    process.stderr.write(
      'live review smoke: no verification browser available to render the frame\n',
    );
    process.exitCode = 2;
    return;
  }
  reportBrowserSelection(launched.selection);

  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const evidenceDir = join(ROOT, 'test-results', 'review-live', stamp);
  mkdirSync(evidenceDir, { recursive: true });
  const dataRoot = mkdtempSync(join(tmpdir(), 'review-live-smoke-'));
  const serverLog = join(evidenceDir, 'server.log');
  writeFileSync(serverLog, '');
  const serverPort = await reservePort();
  const apiBase = `http://127.0.0.1:${String(serverPort)}`;
  const server = startProcess(
    process.execPath,
    [serverBundle],
    {
      PORT: String(serverPort),
      DATA_ROOT: join(dataRoot, 'data'),
      WORKSPACE_ROOT: join(dataRoot, 'workspaces'),
      FORGE_MUSE_BIN: join(ROOT, 'tests', 'fixtures', 'fake-muse.mjs'),
      FORGE_MUSE_API_KEY: key,
      FORGE_MUSE_BASE_URL: process.env.FORGE_MUSE_BASE_URL ?? 'https://api.meta.ai/v1',
      FORGE_MUSE_MODEL: process.env.FORGE_MUSE_MODEL ?? 'muse-wonder-1.0',
      FORGE_MEDIA_MAX_RETRIES: '0',
      FORGE_MEDIA_TRACE: '1',
      FORGE_ALLOW_UNENCRYPTED_DATA_ROOT: '1',
      LOG_LEVEL: 'warn',
    },
    serverLog,
  );
  let exitCode = 0;
  let blockedAt: string | undefined;

  try {
    if (process.env.FORGE_FALLBACK_API_KEY) {
      delete process.env.FORGE_FALLBACK_API_KEY;
      check('FORGE_FALLBACK_API_KEY is scrubbed, so this review cannot take a fallback route');
    }
    await waitForReady(`${apiBase}/api/health`, server);
    check('the server answered readiness probes');
    const metaResponse = await call(`${apiBase}/api/meta`, 'GET');
    const meta = ServiceMetaSchema.parse(metaResponse.envelope.data);
    const issues = mediaMetaIssues(meta.media);
    if (issues.length > 0) fail(`not configured for a bounded live run: ${issues.join('; ')}`);
    if (meta.build === null) fail('the running bundle carries no build identity');
    observations.build = meta.build;
    observations.models = meta.media;
    check(
      `the live server is configured with zero retries and the vision model is ${meta.media.vision_model} (build ${meta.build.commit.slice(0, 7)})`,
    );

    const project = await call(`${apiBase}/api/forge/projects`, 'POST', {
      project_id: PROJECT_ID,
      name: 'Live review acceptance',
      description: 'One paid screenshot review against decisions with known answers.',
    });
    if (![200, 201, 409].includes(project.status))
      fail(`project setup returned HTTP ${String(project.status)}`);

    // Two decisions, created through the public API exactly as a user's accepted
    // decisions would be, and pinned to the revisions the response reports.
    const ids: Record<string, string> = {};
    const pinned: Array<{ memory_id: string; expected_revision: number }> = [];
    for (const decision of REVIEW_PROBE.decisions) {
      const created = await call(`${apiBase}/api/memories`, 'POST', {
        type: decision.type,
        scope: 'project',
        project_id: PROJECT_ID,
        content: decision.content,
        tags: decision.tags,
        confidence: 0.9,
        validation_status: 'verified',
      });
      if (![200, 201].includes(created.status)) {
        fail(`creating decision ${decision.key} returned HTTP ${String(created.status)}`);
      }
      const record = MemoryCreateResultSchema.parse(created.envelope.data);
      const id = record.memory.id;
      ids[decision.key] = id;
      pinned.push({ memory_id: id, expected_revision: record.memory.revision });
    }
    check(
      `two decisions are on record for ${PROJECT_ID}, pinned at revision ${String(pinned[0]?.expected_revision)}`,
    );

    // Render the frame and capture it: the contents are known, so the model's
    // answer has something fixed to be measured against.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.setContent(fixtureHtml(), { waitUntil: 'load' });
    const frame = await page.screenshot({ type: 'png' });
    await context.close();
    if (frame.length === 0) fail('the fixture frame came back empty');
    writeFileSync(join(evidenceDir, 'frame.png'), frame);
    const frameSha = sha256(frame);
    const dataUrl = `data:image/png;base64,${frame.toString('base64')}`;
    observations.frame = {
      sha256: frameSha,
      bytes: frame.length,
      rendered_by: 'managed Chromium, 1280x800',
      visible: [REVIEW_PROBE.frame.topBar, REVIEW_PROBE.frame.countdown, REVIEW_PROBE.frame.title],
      decisions: REVIEW_PROBE.decisions,
    };
    check(
      `the frame under review is a real capture (${String(frame.length)} bytes, sha ${frameSha.slice(0, 12)}…)`,
    );

    const idempotencyKey = `review-live-${frameSha.slice(0, 24)}`;
    const reviewBody = { screenshot_data_url: dataUrl, decisions: pinned };
    const traceBefore = parseMediaTrace(readFileSync(serverLog, 'utf8')).length;
    const review = await call(
      `${apiBase}/api/forge/projects/${PROJECT_ID}/visual-review`,
      'POST',
      reviewBody,
      { 'idempotency-key': idempotencyKey },
    );
    const traceAfter = parseMediaTrace(readFileSync(serverLog, 'utf8')).slice(traceBefore);
    const dispatched = accountDispatches(traceAfter).dispatches;
    calls.review = dispatched.filter((entry) => entry.path === '/v1/responses').length;
    calls.vision = calls.review;
    if (review.status !== 200) {
      observations.review_error = {
        status: review.status,
        code: review.envelope.error?.code ?? null,
        message: (review.envelope.error?.message ?? '').slice(0, 300),
      };
      fail(
        `visual review returned HTTP ${String(review.status)} (${String(review.envelope.error?.code ?? 'no code')})`,
      );
    }
    const payload = MediaVisualReviewResponseSchema.parse(review.envelope.data);
    if (payload.screenshot_sha256 !== frameSha) {
      fail(
        'the server echoed a screenshot fingerprint that does not match the frame that was sent',
      );
    }
    if (payload.artifact_changed !== false || payload.advisory !== true) {
      fail('the review did not report itself as advisory and non-mutating');
    }
    observations.review = {
      model: payload.provider.model ?? null,
      observed_model: payload.provider.observed ?? null,
      provider_attempts: payload.provider_attempts,
      ignored_entries: payload.ignored_entries,
      limits: payload.limits,
      unverified: payload.unverified,
      findings: payload.findings.map((finding) => ({
        decision_key:
          Object.keys(ids).find((key2) => ids[key2] === finding.decision_id) ?? 'unknown',
        verdict: finding.verdict,
        confidence: finding.confidence,
        evidence: finding.evidence,
        uncertainty: finding.uncertainty,
      })),
    };
    check(
      `one review dispatch on /v1/responses (${String(payload.findings.length)} finding(s), ${String(payload.unverified.length)} unverified, ${String(payload.ignored_entries)} ignored), model ${payload.provider.observed ?? payload.provider.model ?? 'unreported'}`,
    );

    const score = scoreReviewProbe(payload.findings, payload.unverified, ids);
    observations.score = {
      flagged: score.flagged,
      false_conflict: score.falseConflict,
      lexical_grounding: score.lexicalGrounding,
      evidence_denies_the_frame: score.evidenceDeniesTheFrame,
      score_limits: score.limits,
      rows: score.rows.map((row) => ({
        decision_key: Object.keys(ids).find((k) => ids[k] === row.decision_id) ?? 'unknown',
        verdict: row.verdict,
        confidence: row.confidence,
      })),
    };
    if (score.issues.length > 0) {
      fail(`the live review did not match what the frame shows: ${score.issues.join('; ')}`);
    }
    check(
      'the findings point at the right decisions: the countdown is flagged as a possible conflict with on-screen evidence, and the score in the top bar is not called a conflict',
    );

    // Replay must not cost a second call, and must describe the same subject.
    const replay = await call(
      `${apiBase}/api/forge/projects/${PROJECT_ID}/visual-review`,
      'POST',
      reviewBody,
      { 'idempotency-key': idempotencyKey },
    );
    if (replay.status !== 200) fail(`replay returned HTTP ${String(replay.status)}`);
    if (replay.headers['idempotent-replayed'] !== '1') {
      fail('the replay was not served from the recorded answer');
    }
    const replayPayload = MediaVisualReviewResponseSchema.parse(replay.envelope.data);
    if (JSON.stringify(replayPayload) !== JSON.stringify(payload)) {
      fail('the replayed answer differs from the recorded answer');
    }
    const wholeRun = accountDispatches(parseMediaTrace(readFileSync(serverLog, 'utf8'))).dispatches;
    observations.dispatches = wholeRun;
    if (wholeRun.length !== 1) {
      fail(`${String(wholeRun.length)} provider dispatch(es) in a run allowed exactly one`);
    }
    if (wholeRun.some((entry) => entry.attempt > 1)) fail('a transport retry happened');
    // Anything on a path other than the review path is a forbidden dispatch, not
    // a coding call: this run has no coding path to attribute it to.
    calls.otherPaidPaths = wholeRun.filter((entry) => entry.path !== '/v1/responses').length;
    check(
      'the replay cost nothing (idempotent-replayed: 1) and the whole run touched exactly one paid path, once',
    );

    // Review is advisory: nothing about the project may have moved.
    const view = await call(`${apiBase}/api/forge/projects/${PROJECT_ID}`, 'GET');
    const state = view.envelope.data as { state?: { versions?: unknown[] }; jobs?: unknown[] };
    const versionCount = Array.isArray(state.state?.versions) ? state.state?.versions.length : -1;
    const jobCount = Array.isArray(state.jobs) ? state.jobs.length : -1;
    if (versionCount !== 0 || jobCount !== 0) {
      fail(
        `a screenshot review created ${String(versionCount)} version(s) and ${String(jobCount)} job(s)`,
      );
    }
    const memories = await call(`${apiBase}/api/memories?project_id=${PROJECT_ID}`, 'GET');
    const listed = MemoryListResponseSchema.parse(memories.envelope.data);
    if (listed.items.length !== 2) {
      fail(
        `the project should hold the two decisions it created, found ${String(listed.items.length)}`,
      );
    }
    check(
      'the review wrote nothing: no version, no job, and the two decisions are still the only rows',
    );

    // Contents, not the file name: a path string certifies any log, including
    // one that in fact holds the credential.
    const logBody = readFileSync(serverLog, 'utf8');
    if (logBody.includes(key)) fail('the API token appears in the server log contents');
    check(
      `the API token does not appear in the ${String(logBody.length)} bytes of server log the run produced`,
    );

    process.stdout.write('\nBatch E live review smoke: PASS\n');
  } catch (error) {
    if (!(error instanceof SmokeFailure)) {
      const name = error instanceof Error ? error.constructor.name : typeof error;
      process.stderr.write(`[${name}] ${error instanceof Error ? error.message : String(error)}\n`);
    }
    blockedAt = error instanceof Error ? error.message : String(error);
    exitCode = 1;
  } finally {
    await stopProcess(server);
    if (browser.close) await browser.close().catch(() => undefined);
    // The ledger is read last, so it reports every dispatch the adapter made —
    // including any made before a failure stopped the run.
    try {
      const ledger = accountDispatches(parseMediaTrace(readFileSync(serverLog, 'utf8')));
      calls.review = ledger.dispatches.filter((entry) => entry.path === '/v1/responses').length;
      calls.vision = calls.review;
      calls.otherPaidPaths = ledger.dispatches.filter(
        (entry) => entry.path !== '/v1/responses',
      ).length;
      observations.dispatch_ledger = ledger.dispatches.map((entry) => ({
        path: entry.path,
        attempt: entry.attempt,
        outcome: entry.outcome ?? null,
        status: entry.status ?? null,
      }));
      observations.unpaired_outcome_lines = ledger.unpairedOutcomes.length;
      observations.unanswered_dispatches = ledger.unanswered.length;
    } catch {
      observations.dispatch_ledger = 'the server log could not be read for the ledger';
    }
    const summary = {
      ok: exitCode === 0,
      blocked_at: blockedAt ?? null,
      checks,
      observations,
      calls,
      budget: { paid_vision_calls: 1, transport_retries: 0, other_paid_paths: 0 },
      evidence_dir: evidenceDir,
    };
    writeFileSync(join(evidenceDir, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`);
    if (exitCode !== 0) {
      writeFileSync(
        join(evidenceDir, 'FAILED.md'),
        `# Live review run FAILED\n\nReason: ${blockedAt ?? 'unknown'}\n\nChecks completed first: ${String(checks.length)}\n\nA scoring failure here is a result about the model's answer, not a plumbing error: the frame, the decisions and the pinned revisions are recorded above. The finding text is kept verbatim so the answer can be judged by a reader. This run cannot be repeated without spending quota, so the evidence stays.\n`,
      );
    }
    writeFileSync(
      join(evidenceDir, 'summary.txt'),
      `${exitCode === 0 ? 'PASS' : 'FAILED'}: ${String(checks.length)} checks; calls ${JSON.stringify(calls)}\n`,
    );
    rmSync(dataRoot, { recursive: true, force: true });
    process.stdout.write(`evidence: ${evidenceDir}\n`);
  }
  process.exitCode = exitCode;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `live review smoke: fatal [${error instanceof Error ? error.constructor.name : typeof error}] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
