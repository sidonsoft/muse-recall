/**
 * Batch B live image acceptance: two paid calls, and measurements of what came
 * back.
 *
 * Everything known about `muse-image-1.0` in this tree came from fixtures that
 * hand us the bytes we asked for. This run asks the real model for a picture,
 * then measures the bytes the product actually stored: dimensions, colour
 * spread, how much of the frame sits under each channel, and how far the edit
 * moved the baseline. A returned image that is a valid PNG but shows none of
 * what was asked is a failed acceptance, not a pass.
 *
 * Budget, enforced by refusing to run any other way:
 *   - exactly one generate call and one edit call, each one attempt on one
 *     image path, zero transport retries
 *   - the coding, vision, SAM and voice paths must stay empty for the whole run
 *   - any failure stops the run and is reported; nothing here retries or
 *     substitutes a second call
 *
 * Run: `pnpm verify:image-live-smoke` (requires FORGE_MUSE_API_KEY)
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ForgeProjectViewSchema,
  MediaJobSchema,
  type MediaJobView,
  ServiceMetaSchema,
} from '../packages/shared/src/index.js';
import { mediaMetaIssues, SERVER_READY_TIMEOUT_MS } from './lib/batchd-live.js';
import { launchVerificationBrowser, reportBrowserSelection } from './lib/browser.js';
import { type DecodedImage, decodeImageWithBrowser } from './lib/browser-decode.js';
import {
  assetVersionPaths,
  checkRegions,
  diffShare,
  IMAGE_ALLOWED_PATHS,
  IMAGE_PROMPTS,
  imageLedgerIssues,
  MIN_EDIT_DIFF_SHARE,
  measurePng,
} from './lib/image-live.js';
import {
  accountDispatches,
  type DispatchAccount,
  ledgerEvidence,
  parseMediaTrace,
} from './lib/media-trace.js';

const ROOT = process.cwd();
const PROJECT_ID = 'image-live';
const JOB_TIMEOUT_MS = 300_000;
const POLL_MS = 1_000;
const ALLOWED_IMAGE_PATHS: string[] = [...IMAGE_ALLOWED_PATHS];
/** Paths that must stay empty: this run pays for images, nothing else. */
const FORBIDDEN_PATHS = ['/v1/responses', '/v1/asr/transcribe'];

const checks: string[] = [];
const observations: Record<string, unknown> = {};
const calls: Record<string, number> = {
  generate: 0,
  edit: 0,
  /** Dispatches on any path this image-only run must not touch. */
  otherPaidPaths: 0,
  vision: 0,
  transcribe: 0,
  clip: 0,
  imageGeneration: 0,
  coding: 0,
};

function check(label: string): void {
  checks.push(label);
  process.stdout.write(`  ✓ ${label}\n`);
}

class SmokeFailure extends Error {}

/** Raised by boot-only mode so the finally block still writes the report. */
class EarlyExit extends Error {}

function fail(message: string): never {
  throw new SmokeFailure(message);
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function read(path: string): Buffer {
  return readFileSync(path);
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

async function postJson(
  url: string,
  body: unknown,
): Promise<{ status: number; envelope: Envelope }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    envelope: asEnvelope(await response.json().catch(() => undefined)),
  };
}

async function getJson(url: string): Promise<{ status: number; envelope: Envelope }> {
  const response = await fetch(url);
  return {
    status: response.status,
    envelope: asEnvelope(await response.json().catch(() => undefined)),
  };
}

interface Managed {
  child: ReturnType<typeof spawn>;
  logPath: string;
}

function startProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  logPath: string,
): Managed {
  const merged: NodeJS.ProcessEnv = { ...process.env, ...env };
  // An empty ACCESS_TOKEN is rejected by config validation, and the intent of an
  // empty value is "no bearer token at all": drop it so the run is tokenless.
  if (merged.ACCESS_TOKEN === '') delete merged.ACCESS_TOKEN;
  const child = spawn(command, args, {
    cwd: ROOT,
    env: merged,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const sink = (chunk: Buffer | string): void => {
    appendFileSync(logPath, String(chunk));
  };
  child.stdout?.on('data', sink);
  child.stderr?.on('data', sink);
  return { child, logPath };
}

async function stopProcess(item: Managed): Promise<void> {
  const pid = item.child.pid;
  if (pid === undefined || item.child.killed) return;
  await new Promise<void>((resolve) => {
    const done = (): void => resolve();
    item.child.once('exit', done);
    const timer = setTimeout(() => {
      item.child.kill('SIGKILL');
      resolve();
    }, 5_000);
    timer.unref();
    item.child.kill('SIGTERM');
  });
}

/**
 * Read the bytes the product persisted for one asset version, and prove they
 * are the bytes the job reported. There is no asset-bytes route, so this reads
 * the isolate the run created — which is the stronger evidence anyway: it is
 * what a later approve, embed or reference would actually use.
 */
function readAssetVersion(
  workspaceRoot: string,
  assetId: string,
  version: number,
): { bytes: Buffer; manifest: Record<string, unknown> } {
  const paths = assetVersionPaths(workspaceRoot, PROJECT_ID, assetId, version);
  const bytesPath = paths.bytes;
  const manifestPath = paths.manifest;
  if (!existsSync(bytesPath)) fail(`the asset bytes are missing under ${paths.dir}`);
  if (!existsSync(manifestPath)) fail(`the asset manifest is missing at ${manifestPath}`);
  const bytes = read(bytesPath);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  return { bytes, manifest };
}

/**
 * The manifest carries the dimensions the product recorded when it stored the
 * bytes; the browser reports what those bytes actually are. Reading one against
 * the other is how the WebP header bug stayed hidden: a 1600x1600 frame from the
 * live model was recorded as 1x1600, and every preview built from that number
 * would have been wrong.
 */
function checkRecordedSize(
  label: string,
  manifest: Record<string, unknown>,
  decoded: DecodedImage,
): void {
  const recordedWidth = typeof manifest.width === 'number' ? manifest.width : Number.NaN;
  const recordedHeight = typeof manifest.height === 'number' ? manifest.height : Number.NaN;
  if (recordedWidth !== decoded.naturalWidth || recordedHeight !== decoded.naturalHeight) {
    fail(
      `${label}: the manifest records ${String(recordedWidth)}x${String(recordedHeight)} but the stored bytes decode to ${String(decoded.naturalWidth)}x${String(decoded.naturalHeight)}`,
    );
  }
}

async function main(): Promise<void> {
  const key = process.env.FORGE_MUSE_API_KEY?.trim() ?? '';
  if (key === '') {
    process.stderr.write(
      'live image smoke: unconfigured (need FORGE_MUSE_API_KEY; no call made)\n',
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

  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const evidenceDir = join(ROOT, 'test-results', 'image-live', stamp);
  mkdirSync(evidenceDir, { recursive: true });

  const launched = await launchVerificationBrowser();
  const browser = launched.browser;
  if (!browser) {
    process.stderr.write(
      'live image smoke: no verification browser is available to decode the stored frames\n',
    );
    process.exitCode = 2;
    return;
  }
  reportBrowserSelection(launched.selection);

  const dataRoot = mkdtempSync(join(tmpdir(), 'image-live-smoke-'));
  const workspaceRoot = join(dataRoot, 'workspaces');
  const serverLog = join(evidenceDir, 'server.log');
  writeFileSync(serverLog, '');

  /**
   * The dispatch ledger, taken from what the adapter actually logged rather than
   * from what the harness remembered to count. It is read on every exit path —
   * including one that threw part-way through — because a run that paid for a
   * call and then failed must still say it paid.
   */
  const drainedLedger = (): ReturnType<typeof accountDispatches> =>
    accountDispatches(parseMediaTrace(readFileSync(serverLog, 'utf8')));
  const sliceLedger = (from: number): ReturnType<typeof accountDispatches> =>
    accountDispatches(parseMediaTrace(readFileSync(serverLog, 'utf8')).slice(from));
  let server: Managed | undefined;
  const closeBrowser = async (): Promise<void> => {
    if (browser.close) await browser.close();
  };
  let blockedAt: string | undefined;
  let exitCode = 0;

  try {
    if (process.env.FORGE_FALLBACK_API_KEY) {
      delete process.env.FORGE_FALLBACK_API_KEY;
      check('FORGE_FALLBACK_API_KEY is scrubbed, so no call in this run can take a fallback route');
    }

    const serverPort = await reservePort();
    const apiBase = `http://127.0.0.1:${String(serverPort)}`;
    server = startProcess(
      process.execPath,
      [serverBundle],
      {
        // Without PORT the server would listen on its default and the reserved
        // port would sit unused; the health probe would then fail with no crash
        // in the log, which is exactly what the first run of this script did.
        PORT: String(serverPort),
        DATA_ROOT: join(dataRoot, 'data'),
        WORKSPACE_ROOT: workspaceRoot,
        ACCESS_TOKEN: '',
        FORGE_MUSE_BIN: join(ROOT, 'tests', 'fixtures', 'fake-muse.mjs'),
        FORGE_MUSE_API_KEY: key,
        FORGE_MUSE_BASE_URL: process.env.FORGE_MUSE_BASE_URL ?? 'https://api.meta.ai/v1',
        FORGE_MUSE_MODEL: process.env.FORGE_MUSE_MODEL ?? 'muse-wonder-1.0',
        // Two paid calls in this whole run, one transport attempt each.
        FORGE_MEDIA_MAX_RETRIES: '0',
        FORGE_MEDIA_TRACE: '1',
        FORGE_ALLOW_UNENCRYPTED_DATA_ROOT: '1',
        LOG_LEVEL: 'warn',
      },
      serverLog,
    );

    const health = await waitForReady(`${apiBase}/api/health`, server);
    if (health.transportError !== undefined) {
      fail(`the health probe never answered (${String(health.transportError)})`);
    }
    check('the server answered readiness probes');

    const metaResponse = await getJson(`${apiBase}/api/meta`);
    const meta = ServiceMetaSchema.parse(metaResponse.envelope.data);
    const metaIssues = mediaMetaIssues(meta.media);
    if (metaIssues.length > 0)
      fail(`the running server is not configured for a bounded live run: ${metaIssues.join('; ')}`);
    observations.models = meta.media;
    if (meta.build === null)
      fail(
        'the running bundle carries no build identity, so these calls cannot be attributed to a commit',
      );
    observations.build = meta.build;
    if (meta.forge.configured_model === null)
      fail(
        '/api/meta reports no configured coding model, so the server is not credentialed for provider calls',
      );
    check(
      `the live server is configured, retries are zero, and the image model is ${meta.media.image_model} (build ${meta.build.commit.slice(0, 7)}, source ${meta.build.source_hash.slice(0, 12)})`,
    );

    const project = await postJson(`${apiBase}/api/forge/projects`, {
      project_id: PROJECT_ID,
      name: 'Live image acceptance',
      description: 'Two paid image calls, measured.',
    });
    if (![200, 201, 409].includes(project.status))
      fail(`project setup returned HTTP ${String(project.status)}`);

    const traceSoFar = (): number => parseMediaTrace(readFileSync(serverLog, 'utf8')).length;
    if (process.env.IMAGE_SMOKE_BOOT_ONLY === '1') {
      const dispatches = accountDispatches(
        parseMediaTrace(readFileSync(serverLog, 'utf8')),
      ).dispatches;
      if (dispatches.length !== 0)
        fail(`boot-only mode dispatched ${String(dispatches.length)} time(s)`);
      check('boot-only mode: the live configuration gate passed and zero provider calls were made');
      process.stdout.write('\nBatch B live image smoke: PASS (boot-only, no paid call)\n');
      throw new EarlyExit();
    }

    let traceBeforeGenerate = 0;
    let traceBeforeEdit = 0;

    const runJob = async (path: string, body: unknown): Promise<MediaJobView> => {
      const operationMark = traceSoFar();
      /** A paid call that produced no usable job is still a paid call. */
      const ledgerOnFailure = (kind: string): void => {
        const slice = sliceLedger(operationMark);
        const failed: Array<Record<string, unknown>> =
          (observations.failed_operations as Array<Record<string, unknown>> | undefined) ?? [];
        failed.push({
          operation: path,
          at: kind,
          dispatches: slice.dispatches.map((entry) => ({
            path: entry.path,
            attempt: entry.attempt,
            outcome: entry.outcome ?? null,
            status: entry.status ?? null,
          })),
          unanswered: slice.unanswered.length,
        });
        observations.failed_operations = failed;
      };
      const started = await postJson(`${apiBase}/api/forge/projects/${PROJECT_ID}/${path}`, body);
      const accepted =
        started.status === 202 ? MediaJobSchema.safeParse(started.envelope.data) : null;
      if (accepted === null || !accepted.success) {
        ledgerOnFailure('accept');
        fail(
          `${path} returned HTTP ${String(started.status)} without a media job: ${JSON.stringify(started.envelope.error ?? {}).slice(0, 200)}`,
        );
      }
      const jobId = accepted.data.id;
      const deadline = Date.now() + JOB_TIMEOUT_MS;
      for (;;) {
        const polled = await getJson(
          `${apiBase}/api/forge/projects/${PROJECT_ID}/media/jobs/${jobId}`,
        );
        if (polled.status !== 200) fail(`job poll returned HTTP ${String(polled.status)}`);
        const job = MediaJobSchema.parse(polled.envelope.data);
        if (job.status === 'succeeded') return job;
        if (job.status === 'failed' || job.status === 'cancelled') {
          ledgerOnFailure(job.status);
          fail(
            `${path} ended ${job.status}: ${String(job.error ?? 'no error recorded')} (logs: ${(job.logs ?? []).slice(-3).join(' | ').slice(0, 300)})`,
          );
        }
        if (Date.now() > deadline) {
          ledgerOnFailure('timeout');
          fail(`${path} did not finish within ${String(JOB_TIMEOUT_MS)} ms (status ${job.status})`);
        }
        await sleep(POLL_MS);
      }
    };

    const account = (label: string, from: number, maxDispatches: number): DispatchAccount => {
      const fresh = parseMediaTrace(readFileSync(serverLog, 'utf8')).slice(from);
      const accounted = accountDispatches(fresh);
      const paths = new Set(accounted.dispatches.map((entry) => entry.path));
      for (const path of paths) {
        if (!ALLOWED_IMAGE_PATHS.includes(path)) {
          fail(`${label} dispatched on ${path}, which this image-only run must not touch`);
        }
        if (FORBIDDEN_PATHS.includes(path)) {
          fail(`${label} dispatched on ${path}; coding/vision/voice paths must stay empty`);
        }
      }
      if (accounted.dispatches.some((entry) => entry.attempt > 1)) {
        fail(`${label} shows a dispatch with attempts beyond 1 — a transport retry happened`);
      }
      if (accounted.dispatches.length > maxDispatches) {
        fail(
          `${label} spent ${String(accounted.dispatches.length)} dispatches where this run allows ${String(maxDispatches)}`,
        );
      }
      return accounted;
    };

    // ---- call 1: generate -------------------------------------------------
    traceBeforeGenerate = traceSoFar();
    const generated = await runJob('media/generate', {
      prompt: IMAGE_PROMPTS.generate.prompt,
      size: IMAGE_PROMPTS.generate.size,
    });
    const generateAccount = account('image generate', traceBeforeGenerate, 1);
    calls.generate = generateAccount.dispatches.length;
    calls.imageGeneration = generateAccount.dispatches.length;
    if (generateAccount.dispatches.length !== 1) {
      fail(
        `image generate made ${String(generateAccount.dispatches.length)} dispatches, expected exactly 1`,
      );
    }
    if (generated.result === null) fail('the generate job succeeded but recorded no asset result');
    const genResult = generated.result;
    check(
      `call 1: one dispatch on ${String(generateAccount.dispatches[0]?.path)} (HTTP ${String(generateAccount.dispatches[0]?.status)}) stored asset ${String(genResult.asset_id).slice(0, 8)} v${String(genResult.version)}`,
    );

    const first = readAssetVersion(workspaceRoot, genResult.asset_id, genResult.version);
    if (sha256(first.bytes) !== genResult.sha256) {
      fail('the stored asset bytes do not match the sha256 the job reported');
    }
    const firstDecoded = await decodeImageWithBrowser(
      browser,
      typeof first.manifest.mime === 'string' ? first.manifest.mime : 'image/png',
      first.bytes,
    );
    checkRecordedSize('generated frame', first.manifest, firstDecoded);
    const firstMeasurement = measurePng(firstDecoded.rgba, firstDecoded.width, firstDecoded.height);
    const generateRegions = checkRegions(firstMeasurement, IMAGE_PROMPTS.generate.expected);
    observations.generate = {
      asset_id: genResult.asset_id,
      version: genResult.version,
      bytes: first.bytes.length,
      sha256: genResult.sha256,
      width: firstDecoded.naturalWidth,
      height: firstDecoded.naturalHeight,
      measured_at: `${String(firstDecoded.width)}x${String(firstDecoded.height)}`,
      measurement_scale: Number(firstDecoded.scale.toFixed(3)),
      stored_mime: typeof first.manifest.mime === 'string' ? first.manifest.mime : null,
      prompt: IMAGE_PROMPTS.generate.prompt,
      requested_size: IMAGE_PROMPTS.generate.size,
      distinct_colors: firstMeasurement.distinctColors,
      mean_channels: firstMeasurement.mean,
      dominant_shares: {
        red: Number((firstMeasurement.dominant.red / firstMeasurement.pixels).toFixed(4)),
        green: Number((firstMeasurement.dominant.green / firstMeasurement.pixels).toFixed(4)),
        blue: Number((firstMeasurement.dominant.blue / firstMeasurement.pixels).toFixed(4)),
      },
      region_expectations: IMAGE_PROMPTS.generate.expected,
      region_issues: generateRegions.missing,
    };
    writeFileSync(join(evidenceDir, 'generated.png'), first.bytes);
    if (generateRegions.missing.length > 0) {
      fail(
        `the generated frame does not show what the prompt asked: ${generateRegions.missing.join('; ')}`,
      );
    }
    check(
      `the generated frame measures ${String(firstDecoded.naturalWidth)}x${String(firstDecoded.naturalHeight)} (decoded at ${String(firstDecoded.width)}x${String(firstDecoded.height)}), ${String(firstMeasurement.distinctColors)} distinct colours, red/green share ${(generateRegions.shares.red * 100).toFixed(1)}% / ${(generateRegions.shares.green * 100).toFixed(1)}% — the picture matches the subject it was asked for`,
    );

    // ---- call 2: edit -----------------------------------------------------
    traceBeforeEdit = traceSoFar();
    const edited = await runJob('media/edit', {
      prompt: IMAGE_PROMPTS.edit.prompt,
      parent: { asset_id: genResult.asset_id, version: genResult.version },
    });
    const editAccount = account('image edit', traceBeforeEdit, 1);
    calls.edit = editAccount.dispatches.length;
    calls.imageGeneration += editAccount.dispatches.length;
    if (editAccount.dispatches.length !== 1) {
      fail(
        `image edit made ${String(editAccount.dispatches.length)} dispatches, expected exactly 1`,
      );
    }
    if (edited.result === null) fail('the edit job succeeded but recorded no asset result');
    const editResult = edited.result;
    check(
      `call 2: one dispatch on ${String(editAccount.dispatches[0]?.path)} (HTTP ${String(editAccount.dispatches[0]?.status)}) stored v${String(editResult.version)} of the same asset`,
    );

    const second = readAssetVersion(workspaceRoot, editResult.asset_id, editResult.version);
    if (sha256(second.bytes) !== editResult.sha256) {
      fail('the stored edited bytes do not match the sha256 the job reported');
    }
    writeFileSync(join(evidenceDir, 'edited.png'), second.bytes);
    const secondDecoded = await decodeImageWithBrowser(
      browser,
      typeof second.manifest.mime === 'string' ? second.manifest.mime : 'image/png',
      second.bytes,
    );
    checkRecordedSize('edited frame', second.manifest, secondDecoded);
    const secondMeasurement = measurePng(
      secondDecoded.rgba,
      secondDecoded.width,
      secondDecoded.height,
    );
    const editRegions = checkRegions(secondMeasurement, IMAGE_PROMPTS.edit.expected);
    const changed =
      firstDecoded.width === secondDecoded.width && firstDecoded.height === secondDecoded.height
        ? diffShare(firstDecoded.rgba, secondDecoded.rgba, firstDecoded.width, firstDecoded.height)
        : Number.NaN;
    observations.edit = {
      asset_id: editResult.asset_id,
      version: editResult.version,
      bytes: second.bytes.length,
      sha256: editResult.sha256,
      width: secondDecoded.naturalWidth,
      height: secondDecoded.naturalHeight,
      measured_at: `${String(secondDecoded.width)}x${String(secondDecoded.height)}`,
      measurement_scale: Number(secondDecoded.scale.toFixed(3)),
      prompt: IMAGE_PROMPTS.edit.prompt,
      distinct_colors: secondMeasurement.distinctColors,
      mean_channels: secondMeasurement.mean,
      dominant_shares: {
        red: Number((secondMeasurement.dominant.red / secondMeasurement.pixels).toFixed(4)),
        green: Number((secondMeasurement.dominant.green / secondMeasurement.pixels).toFixed(4)),
        blue: Number((secondMeasurement.dominant.blue / secondMeasurement.pixels).toFixed(4)),
      },
      changed_pixel_share: Number.isNaN(changed) ? null : Number(changed.toFixed(4)),
      region_expectations: IMAGE_PROMPTS.edit.expected,
      region_issues: editRegions.missing,
    };
    if (Number.isNaN(changed)) {
      fail(
        `the edit decoded to ${String(secondDecoded.width)}x${String(secondDecoded.height)} where the baseline decoded to ${String(firstDecoded.width)}x${String(firstDecoded.height)} — the frames cannot be compared pixel by pixel`,
      );
    }
    if (changed < MIN_EDIT_DIFF_SHARE) {
      fail(
        `the edit changed ${(changed * 100).toFixed(2)}% of pixels, below the ${(MIN_EDIT_DIFF_SHARE * 100).toFixed(1)}% an edit must move — the model returned the baseline, not a change`,
      );
    }
    if (editRegions.missing.length > 0) {
      fail(
        `the edited frame does not show what the instruction asked: ${editRegions.missing.join('; ')}`,
      );
    }
    check(
      `the edited frame adds blue at ${(editRegions.shares.blue * 100).toFixed(1)}% while keeping red at ${(editRegions.shares.red * 100).toFixed(1)}% and green at ${(editRegions.shares.green * 100).toFixed(1)}%, and ${(changed * 100).toFixed(1)}% of pixels moved — a real edit, not a copy`,
    );

    // ---- run-wide invariants ---------------------------------------------
    // Record what was read before making claims about it: an empty ledger from a
    // log that does not exist proves nothing about a run.
    const logEvidence = ledgerEvidence(serverLog);
    observations.ledger_evidence = logEvidence;
    const wholeRun = accountDispatches(
      parseMediaTrace(logEvidence.logPresent ? readFileSync(serverLog, 'utf8') : ''),
    );
    observations.dispatches = wholeRun.dispatches;
    calls.otherPaidPaths = wholeRun.dispatches.filter(
      (entry) => !ALLOWED_IMAGE_PATHS.includes(entry.path),
    ).length;
    // The count is not the gate. A forbidden list that only names the paths we
    // thought to forbid lets a new paid path through — an extra /v1/files upload
    // inside an image run used to pass while the report said `otherPaidPaths: 1`.
    // The rule is the inverse: every path in the ledger must belong to this scope,
    // the per-capability counts must be exact, and every start line must have been
    // answered.
    const ledgerIssues = imageLedgerIssues(wholeRun, { generate: 1, edit: 1 });
    observations.ledger_issues = ledgerIssues;
    if (ledgerIssues.length > 0) {
      fail(`the paid-call ledger does not support this run's budget: ${ledgerIssues.join('; ')}`);
    }
    check(
      `the whole run touched only ${IMAGE_ALLOWED_PATHS.join(', ')}: ${String(wholeRun.dispatches.length)} dispatch(es), every one answered and at attempt 1`,
    );

    // Contents, not the file name: a check that searches a path string certifies
    // any log, including one that holds the credential.
    const logBody = readFileSync(serverLog, 'utf8');
    if (logBody.includes(key)) fail('the API token appears in the server log contents');
    check(
      `the API token does not appear in the ${String(logBody.length)} bytes of server log the run produced`,
    );

    const projectView = await getJson(`${apiBase}/api/forge/projects/${PROJECT_ID}`);
    const versions = ForgeProjectViewSchema.parse(projectView.envelope.data).state.versions;
    if (versions.length !== 0) {
      fail(
        `an image job created ${String(versions.length)} application version(s); media jobs must not`,
      );
    }
    check('no application version was created by either image call, and the artifact stayed empty');

    process.stdout.write('\nBatch B live image smoke: PASS\n');
  } catch (error) {
    if (!(error instanceof SmokeFailure) && !(error instanceof EarlyExit)) {
      process.stderr.write(
        `[${error instanceof Error ? error.constructor.name : typeof error}] ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    if (!(error instanceof EarlyExit)) {
      blockedAt = error instanceof Error ? error.message : String(error);
      exitCode = 1;
    }
  } finally {
    if (server !== undefined) await stopProcess(server);
    await closeBrowser().catch(() => undefined);
    // The ledger is the last thing read, so it reflects every dispatch the
    // adapter made — before or after the point the run stopped.
    try {
      const ledger = drainedLedger();
      const byPath = new Map<string, number>();
      for (const entry of ledger.dispatches) {
        byPath.set(entry.path, (byPath.get(entry.path) ?? 0) + 1);
      }
      calls.generate = byPath.get('/v1/images/generations') ?? 0;
      calls.edit = byPath.get('/v1/images/edits') ?? 0;
      calls.imageGeneration = calls.generate + calls.edit;
      calls.otherPaidPaths = ledger.dispatches.filter(
        (entry) => !ALLOWED_IMAGE_PATHS.includes(entry.path),
      ).length;
      observations.dispatch_ledger = ledger.dispatches.map((entry) => ({
        path: entry.path,
        attempt: entry.attempt,
        outcome: entry.outcome ?? null,
        status: entry.status ?? null,
      }));
      observations.dispatch_paths = [...byPath].map(([path, dispatches]) => ({ path, dispatches }));
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
      budget: { paid_image_calls: 2, transport_retries: 0, other_paid_paths: 0 },
      evidence_dir: evidenceDir,
    };
    writeFileSync(join(evidenceDir, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`);
    if (exitCode !== 0) {
      writeFileSync(
        join(evidenceDir, 'FAILED.md'),
        `# Live image run FAILED before completion\n\nReason: ${blockedAt ?? 'unknown'}\n\nChecks completed before the failure: ${String(checks.length)}\n\nThis run is not evidence that the image model works, and it is not evidence that it does not: it records what was attempted, and what the model returned up to the failure. Evidence kept here was paid for and cannot be recreated without quota.\n`,
      );
    }
    writeFileSync(
      join(evidenceDir, 'summary.txt'),
      `${exitCode === 0 ? 'PASS' : 'FAILED'}: ${String(checks.length)} checks; calls ${JSON.stringify(calls)}\n`,
    );
    if (exitCode !== 0) {
      // Whatever the model returned has already been paid for. Copy the stored
      // assets and job records into the evidence directory before the isolate
      // goes away, so a harness-side failure cannot destroy the measurement.
      const projectRoot = join(workspaceRoot, 'forge', PROJECT_ID);
      for (const subdir of ['media', 'media-jobs']) {
        const source = join(projectRoot, subdir);
        if (!existsSync(source)) continue;
        const target = join(evidenceDir, 'isolate', subdir);
        mkdirSync(target, { recursive: true });
        for (const entry of readdirSync(source)) {
          const from = join(source, entry);
          try {
            if (statSync(from).isFile()) {
              copyFileSync(from, join(target, entry));
            } else {
              // Asset versions live one level down: media/<asset_id>/<n>.bin.
              for (const inner of readdirSync(from)) {
                const innerFrom = join(from, inner);
                if (statSync(innerFrom).isFile()) {
                  const innerTarget = join(target, entry);
                  mkdirSync(innerTarget, { recursive: true });
                  copyFileSync(innerFrom, join(innerTarget, inner));
                }
              }
            }
          } catch {
            // A copy failure must not mask the run's own failure reason.
          }
        }
      }
    }
    rmSync(dataRoot, { recursive: true, force: true });
    process.stdout.write(`evidence: ${evidenceDir}\n`);
  }
  process.exitCode = exitCode;
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
  server: Managed,
): Promise<{ ready: boolean; transportError?: unknown }> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  let last: unknown;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return { ready: true };
      last = `HTTP ${String(response.status)}`;
    } catch (error) {
      last = error;
    }
    if (server.child.exitCode !== null) {
      throw new Error(
        `the server process exited (${String(server.child.exitCode)}) before becoming ready: ${readFileSync(server.logPath, 'utf8').slice(-500)}`,
      );
    }
    if (Date.now() > deadline) return { ready: false, transportError: last };
    await sleep(200);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `live image smoke: fatal [${error instanceof Error ? error.constructor.name : typeof error}] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
