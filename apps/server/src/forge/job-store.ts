import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  FORGE_PROJECT_ID_PATTERN,
  type ForgeJob,
  ForgeJobSchema,
  type ForgeRecoveryIssue,
  redactSecrets,
} from '@mml/shared';
import { isMissingFile } from './fs-utils.js';
import type { ForgeWorkspace } from './workspace.js';

/**
 * Durable, per-job persistence for Forge.
 *
 * Each job is one JSON file under `<project>/jobs/<job-id>.json`, written with
 * a same-directory temporary file and an atomic rename. Writes for one job are
 * serialised so a slow early write cannot land after a newer terminal state
 * and resurrect it.
 *
 * This is deliberately not a database: jobs are the audit trail of model runs
 * and must remain readable with a text editor even if the rest of the app is
 * broken. The trade-off is that a single server process owns the directory;
 * multi-process coordination is out of scope for this local beta.
 */

export interface ForgeJobLoadResult {
  jobs: ForgeJob[];
  issues: ForgeRecoveryIssue[];
}

export interface ForgeStorageCheckScope {
  ok: boolean;
  error: string | null;
}

export interface ForgeStorageCheckResult {
  root: ForgeStorageCheckScope;
  project: ForgeStorageCheckScope;
}

export interface ForgeJobPersistence {
  /**
   * Persist one job. Intermediate snapshots may be coalesced; required
   * snapshots are never abandoned in favour of an older intermediate one.
   */
  save(job: ForgeJob, options?: { required?: boolean }): Promise<void>;
  /** Wait for all queued writes for one job. */
  flush(jobId: string): Promise<void>;
  /**
   * Load every readable job, reporting unreadable records instead of hiding
   * them. Passing a project id scopes the read so a later retry can recover one
   * project without treating another project's failure as resolved.
   */
  loadAll(options?: { projectId?: string }): Promise<ForgeJobLoadResult>;
  /** Explicit health check; writes and removes a temporary file. */
  healthCheck(projectId: string): Promise<ForgeStorageCheckResult>;
}

interface JobWaiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface PendingJobSnapshot {
  job: ForgeJob;
  required: boolean;
}

interface JobWriteQueue {
  pending: PendingJobSnapshot | null;
  required: boolean;
  running: Promise<void> | null;
  waiters: JobWaiter[];
  lastError: Error | null;
}

export class ForgeJobStore implements ForgeJobPersistence {
  private readonly queues = new Map<string, JobWriteQueue>();

  constructor(private readonly workspace: ForgeWorkspace) {}

  save(job: ForgeJob, options: { required?: boolean } = {}): Promise<void> {
    const queue = this.queues.get(job.id) ?? {
      pending: null,
      required: false,
      running: null,
      waiters: [],
      lastError: null,
    };
    this.queues.set(job.id, queue);
    queue.pending = { job, required: options.required === true || queue.required };
    queue.required = queue.pending.required;

    return new Promise<void>((resolve, reject) => {
      queue.waiters.push({ resolve, reject });
      if (!queue.running) queue.running = this.drain(job.id, queue);
    });
  }

  async flush(jobId: string): Promise<void> {
    const queue = this.queues.get(jobId);
    if (!queue) return;
    // A write may enqueue another snapshot while it finishes; follow the
    // running drain until neither a write nor a pending snapshot remains.
    while (queue.running || queue.pending) {
      if (queue.running) await queue.running;
      if (!queue.running && queue.pending) {
        queue.running = this.drain(jobId, queue);
      }
    }
    if (queue.lastError) throw queue.lastError;
  }

  private async drain(jobId: string, queue: JobWriteQueue): Promise<void> {
    try {
      while (queue.pending) {
        const snapshot = queue.pending;
        const waiters = queue.waiters.splice(0);
        queue.pending = null;
        queue.required = false;
        try {
          await this.write(snapshot.job);
          queue.lastError = null;
          for (const waiter of waiters) waiter.resolve();
        } catch (error) {
          queue.lastError = error instanceof Error ? error : new Error(String(error));
          for (const waiter of waiters) waiter.reject(error);
        }
      }
    } finally {
      queue.running = null;
      if (queue.pending) {
        queue.running = this.drain(jobId, queue);
      } else if (!queue.lastError) {
        this.queues.delete(jobId);
      }
    }
  }

  async healthCheck(projectId: string): Promise<ForgeStorageCheckResult> {
    const check = async (dir: string): Promise<ForgeStorageCheckScope> => {
      const temp = join(dir, `.health-${process.pid}-${randomUUID()}.tmp`);
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(temp, 'ok\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        // A directory that accepts writes but cannot be listed still prevents
        // startup recovery from reading job records; treat it as unhealthy.
        await readdir(dir);
        await rm(temp, { force: true });
        return { ok: true, error: null };
      } catch (error) {
        await rm(temp, { force: true }).catch(() => undefined);
        return {
          ok: false,
          error: fsFailureMessage('Storage health check failed', error),
        };
      }
    };

    const root = await check(this.workspace.getRoot());
    let project: ForgeStorageCheckScope;
    try {
      project = await check(join(this.workspace.projectDir(projectId), 'jobs'));
    } catch (error) {
      project = {
        ok: false,
        error: fsFailureMessage('Storage health check failed', error),
      };
    }
    return { root, project };
  }

  async loadAll(options: { projectId?: string } = {}): Promise<ForgeJobLoadResult> {
    const result: ForgeJobLoadResult = { jobs: [], issues: [] };
    const projectNames: string[] = [];
    if (options.projectId !== undefined) {
      if (!FORGE_PROJECT_ID_PATTERN.test(options.projectId)) return result;
      projectNames.push(options.projectId);
    } else {
      let projects: Dirent[];
      try {
        projects = await readdir(this.workspace.getRoot(), { withFileTypes: true });
      } catch (error) {
        if (isMissingFile(error)) return result;
        result.issues.push(
          issue({
            scope: 'store',
            code: 'job_store_unreadable',
            file: '.',
            message: fsFailureMessage('The Forge workspace could not be read', error),
            project_id: 'forge',
            job_id: null,
          }),
        );
        return result;
      }
      for (const project of projects.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!project.isDirectory() || !FORGE_PROJECT_ID_PATTERN.test(project.name)) continue;
        projectNames.push(project.name);
      }
    }

    const seen = new Set<string>();
    for (const projectName of projectNames) {
      const jobsDir = join(this.workspace.getRoot(), projectName, 'jobs');
      let entries: Dirent[];
      try {
        entries = await readdir(jobsDir, { withFileTypes: true });
      } catch (error) {
        if (isMissingFile(error)) continue;
        result.issues.push(
          issue({
            code: 'job_store_unreadable',
            file: `${projectName}/jobs`,
            message: fsFailureMessage('The job directory could not be read', error),
            project_id: projectName,
            job_id: null,
          }),
        );
        continue;
      }

      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.name.endsWith('.json') || entry.name.startsWith('.')) continue;
        const relative = `${projectName}/jobs/${entry.name}`;
        if (!entry.isFile()) {
          result.issues.push(
            issue({
              code: 'job_unreadable',
              file: relative,
              message: 'Job record is not a regular file.',
              project_id: projectName,
              job_id: null,
            }),
          );
          continue;
        }

        let raw: string;
        try {
          raw = await readFile(join(jobsDir, entry.name), 'utf8');
        } catch (error) {
          result.issues.push(
            issue({
              code: 'job_unreadable',
              file: relative,
              message: fsFailureMessage('Job record could not be read', error),
              project_id: projectName,
              job_id: null,
            }),
          );
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          result.issues.push(
            issue({
              code: 'job_unreadable',
              file: relative,
              message: 'Job record is not valid JSON.',
              project_id: projectName,
              job_id: null,
            }),
          );
          continue;
        }

        const validated = ForgeJobSchema.safeParse(parsed);
        if (!validated.success) {
          result.issues.push(
            issue({
              code: 'job_invalid',
              file: relative,
              message: `Job record does not match the job schema (${validated.error.issues[0]?.path.join('.') || 'root'}).`,
              project_id: projectName,
              job_id: null,
            }),
          );
          continue;
        }
        const job = validated.data;
        if (job.id !== basename(entry.name, '.json')) {
          result.issues.push(
            issue({
              code: 'job_project_mismatch',
              file: relative,
              message: 'Job id does not match its file name.',
              project_id: projectName,
              job_id: job.id,
            }),
          );
          continue;
        }
        if (job.project_id !== projectName) {
          result.issues.push(
            issue({
              code: 'job_project_mismatch',
              file: relative,
              message: 'Job belongs to a different project.',
              project_id: projectName,
              job_id: job.id,
            }),
          );
          continue;
        }
        if (seen.has(job.id)) {
          result.issues.push(
            issue({
              code: 'job_duplicate',
              file: relative,
              message: 'Another job record already uses this id.',
              project_id: projectName,
              job_id: job.id,
            }),
          );
          continue;
        }
        seen.add(job.id);
        result.jobs.push(job);
      }
    }
    return result;
  }

  protected async write(job: ForgeJob): Promise<void> {
    const dir = join(this.workspace.projectDir(job.project_id), 'jobs');
    await mkdir(dir, { recursive: true });
    const target = join(dir, `${job.id}.json`);
    const temp = join(dir, `.${job.id}-${process.pid}-${randomUUID()}.tmp`);
    try {
      // `wx` prevents clobbering a concurrently created temp file. The final
      // rename is atomic on the same filesystem, so a reader sees either the
      // previous complete record or the new complete record.
      await writeFile(temp, `${JSON.stringify(job, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

/**
 * Filesystem errors routinely contain an absolute host path. Job-loading
 * diagnostics are relayed to the browser, so describe the failed operation and
 * an errno-style code without exposing the host layout or a transient path.
 */
function fsFailureMessage(action: string, error: unknown): string {
  const rawCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  const code = typeof rawCode === 'string' && /^[A-Z0-9_]+$/.test(rawCode) ? rawCode : null;
  const message = `${action}${code ? ` (${code})` : ''}.`;
  return redactSecrets(message, { maxLength: 240 }).slice(0, 300);
}

function issue(
  input: Omit<ForgeRecoveryIssue, 'id' | 'kind' | 'scope'> & {
    scope?: ForgeRecoveryIssue['scope'];
  },
): ForgeRecoveryIssue {
  const id = `${input.code}:${input.project_id}:${input.job_id ?? ''}:${input.file}`.slice(0, 400);
  return { scope: 'project', ...input, id, kind: 'startup' };
}
