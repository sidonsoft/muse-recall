/**
 * Fail-closed validation for reattaching a preserved Batch C isolate
 * (database + workspace from a completed live run). Pure filesystem
 * reads and hashes — no servers, browsers, or provider calls. Every
 * mismatch throws before the harness starts anything.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface IsolateExpectations {
  baselineSha256: string;
  stagedSha256: string;
  cutoutSha256: string;
  cutoutBytes: number;
  referenceSha256: string;
  jobStatus: 'succeeded';
}

export interface VerifiedIsolate {
  isolateDir: string;
  projectId: string;
  projectDir: string;
  jobId: string;
  job: {
    status: string;
    finishedAt: string | null;
    modelObserved: string | null;
    usageCalls: number | null;
    memoryIds: unknown;
  };
  stagedSha256: string;
  cutoutSha256: string;
  cutoutBytes: number;
}

function fail(reason: string): never {
  throw new Error(`isolate verification failed: ${reason}`);
}

function readJson(path: string, what: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    fail(`${what} is missing at ${path}`);
  }
  try {
    return JSON.parse(raw as string) as unknown;
  } catch {
    fail(`${what} at ${path} is not valid JSON`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Verify a preserved isolate directory against the expected live
 * evidence. Throws on any structural or hash mismatch.
 */
export function verifyStagedIsolate(
  isolateDir: string,
  projectId: string,
  jobId: string,
  expected: IsolateExpectations,
): VerifiedIsolate {
  let root: string;
  try {
    root = statSync(isolateDir).isDirectory() ? isolateDir : '';
  } catch {
    root = '';
  }
  if (root === '') fail(`isolate directory is missing: ${isolateDir}`);
  const projectDir = join(root, 'workspaces', 'forge', projectId);
  try {
    if (!statSync(projectDir).isDirectory()) fail(`project is missing: ${projectDir}`);
  } catch {
    fail(`project is missing: ${projectDir}`);
  }
  const dbPath = join(root, 'memory.db');
  try {
    if (!statSync(dbPath).isFile()) fail(`database is missing: ${dbPath}`);
  } catch {
    fail(`database is missing: ${dbPath}`);
  }

  // Baseline: on-disk v1 bytes must equal the recorded v1 state sha.
  const state = readJson(join(projectDir, 'state.json'), 'state.json');
  if (!isRecord(state) || !Array.isArray(state.versions)) fail('state.json has no versions[]');
  const v1 = (state.versions as unknown[]).find((entry) => isRecord(entry) && entry.version === 1);
  const recordedV1 = isRecord(v1) && typeof v1.sha256 === 'string' ? v1.sha256 : null;
  if (recordedV1 === null) fail('state.json has no v1 sha256');
  const v1Bytes = readFile(join(projectDir, 'versions', '1', 'index.html'), 'v1 index.html');
  if (sha256(v1Bytes) !== recordedV1) fail('v1 bytes do not match the recorded v1 sha256');
  if (recordedV1 !== expected.baselineSha256) fail('v1 sha256 is not the expected baseline');

  // Coding job: must be the single succeeded job, no fallback markers.
  const jobPath = join(projectDir, 'jobs', `${jobId}.json`);
  const job = readJson(jobPath, 'job record');
  if (!isRecord(job)) fail('job record is not an object');
  if (job.status !== expected.jobStatus)
    fail(`job status is ${JSON.stringify(job.status)}, expected ${expected.jobStatus}`);
  if (typeof job.finished_at !== 'string' || job.finished_at.length === 0)
    fail('job record has no finished_at timestamp');
  const logsText = JSON.stringify((job as { logs?: unknown }).logs ?? '');
  if (/fallback/i.test(logsText)) fail('job logs contain a fallback marker');
  const usage = isRecord(job.usage) ? job.usage : null;
  const usageCalls = usage !== null && typeof usage.calls === 'number' ? usage.calls : null;

  // Cutout asset bytes pinned by the retained live evidence.
  const found = findCutoutBySha(join(projectDir, 'media'), expected.cutoutSha256);
  if (found === null) fail('cutout bytes matching the retained sha are not in the media store');
  if (found.bytes.length !== expected.cutoutBytes)
    fail(`cutout bytes are ${found.bytes.length}, expected ${expected.cutoutBytes}`);

  // Staged artifact: sha must equal the independently verified value.
  const staged = readFile(join(projectDir, 'staging', jobId, 'index.html'), 'staged index.html');
  const stagedSha = sha256(staged);
  if (stagedSha !== expected.stagedSha256)
    fail(
      `staged sha ${stagedSha.slice(0, 12)}… is not the expected ${expected.stagedSha256.slice(0, 12)}…`,
    );

  // Reference image: the cutout source bytes must match the retained ref.
  const refFound = findCutoutBySha(join(projectDir, 'media'), expected.referenceSha256);
  if (refFound === null)
    fail('reference bytes matching the retained sha are not in the media store');

  // Job store must contain exactly this one job: no hidden extra work.
  const jobFiles = readdirSync(join(projectDir, 'jobs')).filter((name) => name.endsWith('.json'));
  if (jobFiles.length !== 1 || jobFiles[0] !== `${jobId}.json`)
    fail(`job store holds ${jobFiles.length} records; expected exactly the preserved job`);

  return {
    isolateDir: root,
    projectId,
    projectDir,
    jobId,
    job: {
      status: job.status as string,
      finishedAt: job.finished_at as string,
      modelObserved: typeof job.model_observed === 'string' ? job.model_observed : null,
      usageCalls,
      memoryIds: (job as { memory_ids?: unknown }).memory_ids ?? null,
    },
    stagedSha256: stagedSha,
    cutoutSha256: expected.cutoutSha256,
    cutoutBytes: expected.cutoutBytes,
  };
}

function readFile(path: string, what: string): Buffer {
  try {
    const bytes = readFileSync(path);
    if (bytes.length === 0) fail(`${what} is empty at ${path}`);
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('isolate verification failed'))
      throw error;
    fail(`${what} is missing at ${path}`);
  }
}

/** First media version blob whose sha256 matches; null when absent. */
function findCutoutBySha(mediaDir: string, sha: string): { path: string; bytes: Buffer } | null {
  let assets: string[];
  try {
    assets = readdirSync(mediaDir);
  } catch {
    return null;
  }
  for (const asset of assets) {
    // Layout is media/<assetId>/<version>.bin alongside <version>.json.
    for (const entry of readdirSafe(join(mediaDir, asset))) {
      if (!entry.endsWith('.bin')) continue;
      try {
        const bytes = readFileSync(join(mediaDir, asset, entry));
        if (createHash('sha256').update(bytes).digest('hex') === sha) {
          return { path: join(mediaDir, asset, entry), bytes };
        }
      } catch {}
    }
  }
  return null;
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
