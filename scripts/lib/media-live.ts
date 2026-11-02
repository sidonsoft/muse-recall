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
    const job = record as Record<string, unknown>;
    const usage = job.usage as Record<string, unknown> | undefined;
    const calls = usage?.calls;
    jobs.push({
      job_id: typeof job.id === 'string' ? job.id : name.replace(/\.json$/, ''),
      kind: typeof job.kind === 'string' ? job.kind : 'unknown',
      status: typeof job.status === 'string' ? job.status : 'unknown',
      usage_calls: typeof calls === 'number' ? calls : null,
      version: typeof job.version === 'number' ? job.version : null,
      base_version: typeof job.base_version === 'number' ? job.base_version : null,
      model_observed: typeof job.model_observed === 'string' ? job.model_observed : null,
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
  for (const kind of options.expectedKinds) {
    if (!jobs.some((job) => job.kind === kind)) {
      issues.push(`no coding job of kind ${kind} was recorded`);
    }
  }
  for (const job of jobs) {
    if (job.status !== 'succeeded') {
      issues.push(`job ${job.job_id.slice(0, 8)} (${job.kind}) ended ${job.status}`);
    }
    if (job.usage_calls === null) {
      issues.push(`job ${job.job_id.slice(0, 8)} (${job.kind}) reports no usage.calls`);
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
