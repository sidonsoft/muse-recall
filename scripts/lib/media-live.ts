/**
 * Call accounting for the live media chain smoke (image → coding → artifact).
 *
 * This run pays twice on two different rails, and neither rail proves the other:
 *
 * - **Image calls** go through the server's media adapter, so they leave
 *   `[media-trace]` lines and can be counted exactly.
 * - **Coding jobs** run inside the real Muse CLI child process, which the media
 *   adapter never sees. Their cost is only visible in the job record's
 *   `usage.calls`, so the ledger and the job records are separate accounts and
 *   both must be read.
 *
 * A run that reports "2 image + N code" without both accounts is a claim, not a
 * measurement (KI-55).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type DispatchAccount, ledgerIntegrityIssues, pathsOutside } from './media-trace.js';

/** The only paid media paths this scope may touch. */
export const MEDIA_LIVE_ALLOWED_PATHS: readonly string[] = [
  '/v1/images/generations',
  '/v1/images/edits',
];

export interface MediaLiveBudget {
  generate: number;
  edit: number;
}

export const MEDIA_LIVE_BUDGET: MediaLiveBudget = { generate: 1, edit: 1 };

/**
 * Reasons the media ledger cannot support this run's exact-call claim.
 *
 * Checks, in order: no path outside the image scope (the inverse allowlist rule —
 * a path nobody thought to forbid is still out of scope), a complete and
 * attributable ledger with no transport retries, then the exact per-path counts.
 */
export function mediaLiveLedgerIssues(
  ledger: DispatchAccount,
  budget: MediaLiveBudget = MEDIA_LIVE_BUDGET,
): string[] {
  const issues: string[] = [];
  const outside = pathsOutside(ledger, MEDIA_LIVE_ALLOWED_PATHS);
  if (outside.length > 0) {
    issues.push(`media dispatches outside the image scope: ${outside.join(', ')}`);
  }
  issues.push(...ledgerIntegrityIssues(ledger, 'image'));
  for (const path of MEDIA_LIVE_ALLOWED_PATHS) {
    const paid = budgetForPath(budget, path);
    const seen = ledger.dispatches.filter((dispatch) => dispatch.path === path).length;
    if (paid === undefined) {
      if (seen > 0) issues.push(`${path} was dispatched but this budget does not allow it`);
      continue;
    }
    if (seen !== paid) {
      issues.push(`expected ${String(paid)} dispatch(es) on ${path}, saw ${String(seen)}`);
    }
  }
  return issues;
}

function budgetForPath(budget: MediaLiveBudget, path: string): number | undefined {
  if (path === '/v1/images/generations') return budget.generate;
  if (path === '/v1/images/edits') return budget.edit;
  return undefined;
}

/** One coding job as recorded by the product in the workspace isolate. */
export interface CodingJobAccount {
  job_id: string;
  kind: string;
  status: string;
  usage_calls: number | null;
  version: number | null;
  base_version: number | null;
  /** The model id the coding CLI reported for this job, when it reported one. */
  model_observed: string | null;
  /**
   * Set when the record exists but cannot be believed: it is not an object
   * (`null`, an array, a bare string), or `usage.calls` is not a non-negative
   * integer. A record like this counts as an **unknown** cost, never as zero and
   * never as a negative contribution to the run's total.
   */
  record_invalid?: string;
}

/**
 * Read the coding jobs the product wrote for a project.
 *
 * Reading the isolate rather than the API keeps the account independent of the
 * interface that reported success: a job the UI showed as staged still has to
 * carry `usage.calls` in its own record to be counted.
 */
export function readCodingJobs(projectDir: string): CodingJobAccount[] {
  const jobsDir = join(projectDir, 'jobs');
  let names: string[];
  try {
    names = readdirSync(jobsDir);
  } catch {
    return [];
  }
  const jobs: CodingJobAccount[] = [];
  for (const name of names.filter((entry) => entry.endsWith('.json'))) {
    let record: unknown;
    try {
      record = JSON.parse(readFileSync(join(jobsDir, name), 'utf8')) as unknown;
    } catch {
      jobs.push({
        job_id: name.replace(/\.json$/, ''),
        kind: 'unreadable',
        status: 'unreadable',
        usage_calls: null,
        version: null,
        base_version: null,
        model_observed: null,
      });
      continue;
    }
    // Valid JSON is not the same as a job record: `null`, an array or a bare
    // string parse fine and used to throw here, which turned an unreadable record
    // into a harness crash rather than an unknown-cost finding.
    if (!isRecord(record)) {
      jobs.push({
        job_id: name.replace(/\.json$/, ''),
        kind: 'unreadable',
        status: 'unreadable',
        usage_calls: null,
        version: null,
        base_version: null,
        model_observed: null,
        record_invalid: `the job file holds ${describeShape(record)}, not a job object`,
      });
      continue;
    }
    const usage = isRecord(record.usage) ? record.usage : undefined;
    const calls = usage?.calls;
    const callsUsable = typeof calls === 'number' && Number.isInteger(calls) && calls >= 0;
    const missing = typeof record.id === 'string' ? record.id : name.replace(/\.json$/, '');
    jobs.push({
      job_id: missing,
      kind: typeof record.kind === 'string' ? record.kind : 'unknown',
      status: typeof record.status === 'string' ? record.status : 'unknown',
      usage_calls: callsUsable ? calls : null,
      version: typeof record.version === 'number' ? record.version : null,
      base_version: typeof record.base_version === 'number' ? record.base_version : null,
      model_observed: typeof record.model_observed === 'string' ? record.model_observed : null,
      ...(calls === undefined || calls === null
        ? {}
        : callsUsable
          ? {}
          : {
              record_invalid: `usage.calls holds ${JSON.stringify(calls)}, which is not a non-negative integer`,
            }),
    });
  }
  return jobs.sort((a, b) => a.job_id.localeCompare(b.job_id));
}

/**
 * Reasons the coding account is not trustworthy.
 *
 * Every expected job kind must appear and have succeeded, no job may exceed the
 * per-job call cap this run configured, and no job may report an unknown call
 * count: `usage.calls` missing means the run cannot say what it paid.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

export function codingJobIssues(
  jobs: readonly CodingJobAccount[],
  options: {
    expectedKinds: readonly string[];
    maxCallsPerJob: number;
    /** The model `/api/meta` says is configured, when it says one. */
    configuredModel?: string | null;
  },
): string[] {
  const issues: string[] = [];
  if (jobs.length !== options.expectedKinds.length) {
    issues.push(
      `expected ${String(options.expectedKinds.length)} coding job(s), found ${String(jobs.length)}`,
    );
  }
  // Multiset, not presence. `some()` accepted [generate, generate, modify] for an
  // expected [generate, modify, modify]: the run would have paid for an extra
  // generation and still matched the shape this gate asked for.
  const expectedKinds = [...options.expectedKinds].sort();
  const foundKinds = jobs.map((job) => job.kind).sort();
  if (JSON.stringify(expectedKinds) !== JSON.stringify(foundKinds)) {
    issues.push(
      `the coding jobs this run expected (${expectedKinds.join(', ')}) are not the kinds recorded (${foundKinds.join(', ')})`,
    );
  }
  for (const kind of options.expectedKinds) {
    if (!jobs.some((job) => job.kind === kind)) {
      issues.push(`no coding job of kind ${kind} was recorded`);
    }
  }
  for (const job of jobs) {
    if (job.status !== 'succeeded') {
      issues.push(`job ${job.job_id.slice(0, 8)} (${job.kind}) ended ${job.status}`);
    }
    if (job.record_invalid !== undefined) {
      issues.push(`job ${job.job_id.slice(0, 8)} (${job.kind}): ${job.record_invalid}`);
    }
    if (job.usage_calls === null) {
      issues.push(`job ${job.job_id.slice(0, 8)} (${job.kind}) reports no usable usage.calls`);
    } else if (job.usage_calls > options.maxCallsPerJob) {
      issues.push(
        `job ${job.job_id.slice(0, 8)} (${job.kind}) used ${String(job.usage_calls)} calls, above the ${String(options.maxCallsPerJob)}-call cap this run set`,
      );
    }
    if (job.status === 'succeeded' && job.model_observed === null) {
      issues.push(
        `job ${job.job_id.slice(0, 8)} (${job.kind}) succeeded but names no model, so the run cannot say what it paid for`,
      );
    }
    const configured = options.configuredModel ?? null;
    if (configured !== null && job.model_observed !== null && job.model_observed !== configured) {
      issues.push(
        `job ${job.job_id.slice(0, 8)} (${job.kind}) ran ${job.model_observed} while /api/meta reports the configured coding model as ${configured} — the run measured a model this server did not say it uses`,
      );
    }
  }
  return issues;
}

export function totalCodingCalls(jobs: readonly CodingJobAccount[]): {
  known: number;
  unknownJobs: number;
} {
  let known = 0;
  let unknownJobs = 0;
  for (const job of jobs) {
    if (job.usage_calls === null) unknownJobs += 1;
    else known += job.usage_calls;
  }
  return { known, unknownJobs };
}
