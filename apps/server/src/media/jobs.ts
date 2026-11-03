/**
 * Durable media jobs (queued|running|succeeded|failed|cancelled|interrupted).
 *
 * Follows the ForgeJobStore atomic-rename pattern: one JSON file per job
 * under `<projectDir>/media-jobs/<jobId>.json`, written through a
 * same-directory temp file with 0600 permissions and an atomic rename. Writes
 * for one job are serialised so a slow early write cannot land after a newer
 * terminal state and resurrect it.
 *
 * Lifecycle:
 * - `enqueue` creates a `queued` job. `start` moves queued -> running.
 * - `succeed` / `fail` move running -> terminal. `cancel` moves
 *   queued|running -> cancelled AND bumps the generation counter, so a worker
 *   holding the old generation can never publish late results afterwards.
 * - `publishResult` requires the worker's generation to match the current
 *   record; a mismatch (or a cancelled/interrupted/terminal record) throws
 *   `cancelled` and the result is never written.
 * - `recover` marks any persisted queued|running job as `interrupted`.
 *   Interrupted jobs are never resumed; they are terminal audit records.
 *
 * Secrets: job params, logs and errors are scrubbed before persistence.
 * Keys named like `*secret*`, `*token*`, `*password*`, `api_key`,
 * `authorization` (plus bearer values) are replaced with `[redacted]`.
 */

import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { FORGE_PROJECT_ID_PATTERN } from '@mml/shared';
import {
  ensurePrivateDirectory,
  isMissingFile,
  syncDirectory,
  syncFile,
} from '../forge/fs-utils.js';
import type { ForgeWorkspace } from '../forge/workspace.js';

export type MediaJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
export type MediaJobKind = 'generate' | 'edit' | 'upscale' | 'describe';

export type MediaJobErrorCode =
  | 'invalid_project_id'
  | 'invalid_job_id'
  | 'invalid_job_state'
  | 'job_not_found'
  | 'job_invalid'
  | 'cancelled'
  | 'persistence_failed';

export class MediaJobError extends Error {
  constructor(
    readonly code: MediaJobErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface MediaJobResult {
  asset_id: string;
  version: number;
  sha256: string;
}

export interface MediaJob {
  id: string;
  project_id: string;
  kind: MediaJobKind;
  status: MediaJobStatus;
  /** Fencing counter: bumped on cancel so stale workers cannot publish. */
  generation: number;
  params: Record<string, unknown>;
  result: MediaJobResult | null;
  error: string | null;
  logs: string[];
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface MediaJobRecoveryIssue {
  file: string;
  project_id: string;
  job_id: string | null;
  message: string;
}

export interface MediaJobLoadResult {
  jobs: MediaJob[];
  issues: MediaJobRecoveryIssue[];
}

export interface EnqueueMediaJobInput {
  id?: string;
  kind: MediaJobKind;
  params?: Record<string, unknown>;
}

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const JOB_KINDS: readonly MediaJobKind[] = ['generate', 'edit', 'upscale', 'describe'];
const MAX_LOGS = 200;
const MAX_LOG_CHARS = 2_000;
const MAX_PARAMS_BYTES = 32_768;
const MAX_ERROR_CHARS = 2_000;
const TERMINAL: readonly MediaJobStatus[] = ['succeeded', 'failed', 'cancelled', 'interrupted'];

const SENSITIVE_KEY =
  /(secret|passwd|password|api[-_ ]?key|auth[-_ ]?token|access[-_ ]?token|refresh[-_ ]?token|bearer|client[-_ ]?secret|private[-_ ]?key)/i;

function scrubValue(value: unknown): unknown {
  if (typeof value === 'string') {
    // Bare bearer tokens in free text are the common leak; bound the shape we match.
    if (/bearer\s+[A-Za-z0-9\-._~+/=]{8,}/i.test(value)) return '[redacted]';
    return value;
  }
  if (Array.isArray(value)) return value.map(scrubValue);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : scrubValue(entry);
    }
    return out;
  }
  return value;
}

function scrubParams(params: Record<string, unknown>): Record<string, unknown> {
  const scrubbed = scrubValue(params) as Record<string, unknown>;
  const encoded = JSON.stringify(scrubbed);
  if (encoded.length > MAX_PARAMS_BYTES) {
    throw new MediaJobError(
      'invalid_job_state',
      `Media job params exceed the ${String(MAX_PARAMS_BYTES)}-byte bound.`,
    );
  }
  return scrubbed;
}

function scrubLine(line: string): string {
  const bounded = line.length > MAX_LOG_CHARS ? `${line.slice(0, MAX_LOG_CHARS)}… truncated` : line;
  const scrubbed = scrubValue(bounded);
  if (typeof scrubbed !== 'string') return bounded;
  // Free-text `key=value` secrets in a log line have no object key to match:
  // redact the value side of common secret assignments.
  return scrubbed
    .replace(
      /((?:secret|passwd|password|api[-_ ]?key|auth[-_ ]?token|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|private[-_ ]?key)\s*[:=]\s*)([^\s,;]+)/gi,
      '$1[redacted]',
    )
    .replace(/(bearer\s+)[A-Za-z0-9\-._~+/=]{8,}/gi, '$1[redacted]');
}

function scrubError(message: string): string {
  return scrubLine(message).slice(0, MAX_ERROR_CHARS);
}

function assertProjectId(projectId: string): void {
  if (!FORGE_PROJECT_ID_PATTERN.test(projectId)) {
    throw new MediaJobError('invalid_project_id', 'Invalid media project id.');
  }
}

function assertJobId(jobId: string): void {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new MediaJobError('invalid_job_id', 'Invalid media job id.');
  }
}

function isTerminal(status: MediaJobStatus): boolean {
  return (TERMINAL as readonly string[]).includes(status);
}

function validateRecord(raw: unknown, file: string, projectName: string): MediaJob {
  if (typeof raw !== 'object' || raw === null) {
    throw new MediaJobError('job_invalid', `Media job record is not an object: ${file}.`);
  }
  const candidate = raw as Partial<MediaJob>;
  if (typeof candidate.id !== 'string' || !JOB_ID_PATTERN.test(candidate.id)) {
    throw new MediaJobError('job_invalid', `Media job record has an invalid id: ${file}.`);
  }
  if (candidate.project_id !== projectName) {
    throw new MediaJobError('job_invalid', `Media job belongs to a different project: ${file}.`);
  }
  if (!JOB_KINDS.includes(candidate.kind as MediaJobKind)) {
    throw new MediaJobError('job_invalid', `Media job has an unknown kind: ${file}.`);
  }
  if (
    !['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(
      candidate.status as string,
    )
  ) {
    throw new MediaJobError('job_invalid', `Media job has an unknown status: ${file}.`);
  }
  if (!Number.isSafeInteger(candidate.generation) || (candidate.generation as number) < 0) {
    throw new MediaJobError('job_invalid', `Media job has an invalid generation: ${file}.`);
  }
  if (
    typeof candidate.params !== 'object' ||
    candidate.params === null ||
    Array.isArray(candidate.params)
  ) {
    throw new MediaJobError('job_invalid', `Media job has invalid params: ${file}.`);
  }
  if (candidate.result !== null && candidate.result !== undefined) {
    const result = candidate.result as Partial<MediaJobResult>;
    if (
      typeof result.asset_id !== 'string' ||
      !Number.isSafeInteger(result.version) ||
      typeof result.sha256 !== 'string'
    ) {
      throw new MediaJobError('job_invalid', `Media job has a malformed result: ${file}.`);
    }
  }
  if (
    candidate.error !== null &&
    candidate.error !== undefined &&
    typeof candidate.error !== 'string'
  ) {
    throw new MediaJobError('job_invalid', `Media job has a malformed error: ${file}.`);
  }
  if (!Array.isArray(candidate.logs) || candidate.logs.some((line) => typeof line !== 'string')) {
    throw new MediaJobError('job_invalid', `Media job has malformed logs: ${file}.`);
  }
  return {
    id: candidate.id,
    project_id: projectName,
    kind: candidate.kind as MediaJobKind,
    status: candidate.status as MediaJobStatus,
    generation: candidate.generation as number,
    params: candidate.params as Record<string, unknown>,
    result: (candidate.result ?? null) as MediaJobResult | null,
    error: (candidate.error ?? null) as string | null,
    logs: (candidate.logs as string[]).slice(0, MAX_LOGS),
    created_at:
      typeof candidate.created_at === 'string' ? candidate.created_at : new Date(0).toISOString(),
    started_at: (candidate.started_at ?? null) as string | null,
    finished_at: (candidate.finished_at ?? null) as string | null,
  };
}

interface JobWaiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface PendingSnapshot {
  job: MediaJob;
}

interface JobWriteQueue {
  pending: PendingSnapshot | null;
  running: Promise<void> | null;
  waiters: JobWaiter[];
  lastError: Error | null;
}

export class MediaJobStore {
  private readonly queues = new Map<string, JobWriteQueue>();

  constructor(private readonly workspace: ForgeWorkspace) {}

  private jobsDir(projectId: string): string {
    assertProjectId(projectId);
    return join(this.workspace.projectDir(projectId), 'media-jobs');
  }

  async enqueue(projectId: string, input: EnqueueMediaJobInput): Promise<MediaJob> {
    assertProjectId(projectId);
    if (!JOB_KINDS.includes(input.kind)) {
      throw new MediaJobError(
        'invalid_job_state',
        `Unknown media job kind: ${String(input.kind)}.`,
      );
    }
    const id = input.id ?? randomUUID();
    assertJobId(id);
    const now = new Date().toISOString();
    const job: MediaJob = {
      id,
      project_id: projectId,
      kind: input.kind,
      status: 'queued',
      generation: 0,
      params: scrubParams(input.params ?? {}),
      result: null,
      error: null,
      logs: [],
      created_at: now,
      started_at: null,
      finished_at: null,
    };
    await this.persist(job);
    return job;
  }

  async get(projectId: string, jobId: string): Promise<MediaJob> {
    assertProjectId(projectId);
    assertJobId(jobId);
    let raw: string;
    try {
      raw = await readFile(join(this.jobsDir(projectId), `${jobId}.json`), 'utf8');
    } catch {
      throw new MediaJobError('job_not_found', `Media job ${jobId} does not exist.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new MediaJobError('job_invalid', `Media job ${jobId} is not valid JSON.`);
    }
    return validateRecord(parsed, `${projectId}/media-jobs/${jobId}.json`, projectId);
  }

  async start(projectId: string, jobId: string): Promise<{ job: MediaJob; generation: number }> {
    const job = await this.get(projectId, jobId);
    if (job.status !== 'queued') {
      throw new MediaJobError(
        'invalid_job_state',
        `Media job ${jobId} cannot start from status ${job.status}; only queued jobs can start.`,
      );
    }
    const next: MediaJob = { ...job, status: 'running', started_at: new Date().toISOString() };
    await this.persist(next);
    return { job: next, generation: next.generation };
  }

  async appendLog(projectId: string, jobId: string, line: string): Promise<MediaJob> {
    const job = await this.get(projectId, jobId);
    if (isTerminal(job.status)) {
      throw new MediaJobError(
        'invalid_job_state',
        `Media job ${jobId} is ${job.status}; terminal jobs accept no more logs.`,
      );
    }
    const next: MediaJob = { ...job, logs: [...job.logs, scrubLine(line)].slice(-MAX_LOGS) };
    await this.persist(next);
    return next;
  }

  async succeed(
    projectId: string,
    jobId: string,
    result: MediaJobResult,
    expectedGeneration?: number,
  ): Promise<MediaJob> {
    const job = await this.get(projectId, jobId);
    this.assertPublishable(job, expectedGeneration);
    const next: MediaJob = {
      ...job,
      status: 'succeeded',
      result,
      error: null,
      finished_at: new Date().toISOString(),
    };
    await this.persist(next);
    return next;
  }

  async fail(
    projectId: string,
    jobId: string,
    message: string,
    expectedGeneration?: number,
  ): Promise<MediaJob> {
    const job = await this.get(projectId, jobId);
    this.assertPublishable(job, expectedGeneration);
    const next: MediaJob = {
      ...job,
      status: 'failed',
      result: null,
      error: scrubError(message),
      finished_at: new Date().toISOString(),
    };
    await this.persist(next);
    return next;
  }

  /**
   * Cancel a queued or running job. Terminal jobs cannot be cancelled.
   * The generation bump fences out the worker holding the old generation:
   * any later `succeed`/`fail`/`publishResult` with the stale generation
   * throws `cancelled` and writes nothing.
   */
  async cancel(projectId: string, jobId: string): Promise<MediaJob> {
    const job = await this.get(projectId, jobId);
    if (isTerminal(job.status)) {
      throw new MediaJobError(
        'invalid_job_state',
        `Media job ${jobId} is already ${job.status}; terminal jobs cannot be cancelled.`,
      );
    }
    const next: MediaJob = {
      ...job,
      status: 'cancelled',
      generation: job.generation + 1,
      error: 'Cancelled by operator.',
      finished_at: new Date().toISOString(),
    };
    await this.persist(next);
    return next;
  }

  /**
   * Publish a worker-produced result exactly once. The worker must present
   * the generation captured at `start`; any mismatch means the job was
   * cancelled (or superseded) and the result is refused, never persisted.
   */
  async publishResult(
    projectId: string,
    jobId: string,
    expectedGeneration: number,
    result: MediaJobResult,
  ): Promise<MediaJob> {
    const job = await this.get(projectId, jobId);
    this.assertPublishable(job, expectedGeneration);
    return this.succeed(projectId, jobId, result, expectedGeneration);
  }

  private assertPublishable(job: MediaJob, expectedGeneration?: number): void {
    if (expectedGeneration !== undefined && expectedGeneration !== job.generation) {
      throw new MediaJobError(
        'cancelled',
        `Media job ${job.id} generation ${String(expectedGeneration)} is stale (current ${String(job.generation)}); refusing to publish a late result for a cancelled job.`,
      );
    }
    if (job.status === 'cancelled' || job.status === 'interrupted') {
      throw new MediaJobError(
        'cancelled',
        `Media job ${job.id} is ${job.status}; refusing to publish a late result.`,
      );
    }
    if (job.status !== 'running') {
      throw new MediaJobError(
        'invalid_job_state',
        `Media job ${job.id} is ${job.status}; only running jobs can publish results.`,
      );
    }
  }

  /**
   * Restart recovery: every persisted queued|running job becomes
   * `interrupted`. Interrupted jobs are terminal and are never resumed; a
   * fresh job must be enqueued instead. Returns the interrupted records.
   */
  async recover(projectId?: string | { projectId?: string }): Promise<MediaJob[]> {
    const scope = typeof projectId === 'string' ? projectId : projectId?.projectId;
    const loaded = await this.loadAll(scope !== undefined ? { projectId: scope } : {});
    const interrupted: MediaJob[] = [];
    for (const job of loaded.jobs) {
      if (job.status !== 'queued' && job.status !== 'running') continue;
      const next: MediaJob = {
        ...job,
        status: 'interrupted',
        error:
          'Interrupted by server restart before completion; never resumed. Enqueue a new job to retry.',
        finished_at: new Date().toISOString(),
      };
      await this.persist(next);
      interrupted.push(next);
    }
    return interrupted;
  }

  async loadAll(options: { projectId?: string } = {}): Promise<MediaJobLoadResult> {
    const result: MediaJobLoadResult = { jobs: [], issues: [] };
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
        result.issues.push({
          file: '.',
          project_id: 'media',
          job_id: null,
          message: `The media job workspace could not be read (${codeOf(error)}).`,
        });
        return result;
      }
      for (const project of projects.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!project.isDirectory() || !FORGE_PROJECT_ID_PATTERN.test(project.name)) continue;
        projectNames.push(project.name);
      }
    }

    const seen = new Set<string>();
    for (const projectName of projectNames) {
      const jobsDir = join(this.workspace.getRoot(), projectName, 'media-jobs');
      let entries: Dirent[];
      try {
        entries = await readdir(jobsDir, { withFileTypes: true });
      } catch (error) {
        if (isMissingFile(error)) continue;
        result.issues.push({
          file: `${projectName}/media-jobs`,
          project_id: projectName,
          job_id: null,
          message: `The media job directory could not be read (${codeOf(error)}).`,
        });
        continue;
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.name.endsWith('.json') || entry.name.startsWith('.')) continue;
        const relative = `${projectName}/media-jobs/${entry.name}`;
        if (!entry.isFile()) {
          result.issues.push({
            file: relative,
            project_id: projectName,
            job_id: null,
            message: 'Media job record is not a regular file.',
          });
          continue;
        }
        let raw: string;
        try {
          raw = await readFile(join(jobsDir, entry.name), 'utf8');
        } catch (error) {
          result.issues.push({
            file: relative,
            project_id: projectName,
            job_id: null,
            message: `Media job record could not be read (${codeOf(error)}).`,
          });
          continue;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw) as unknown;
        } catch {
          result.issues.push({
            file: relative,
            project_id: projectName,
            job_id: null,
            message: 'Media job record is not valid JSON.',
          });
          continue;
        }
        let job: MediaJob;
        try {
          job = validateRecord(parsed, relative, projectName);
        } catch (error) {
          result.issues.push({
            file: relative,
            project_id: projectName,
            job_id: null,
            message: error instanceof Error ? error.message : 'Media job record is invalid.',
          });
          continue;
        }
        if (job.id !== basename(entry.name, '.json')) {
          result.issues.push({
            file: relative,
            project_id: projectName,
            job_id: job.id,
            message: 'Media job id does not match its file name.',
          });
          continue;
        }
        if (seen.has(job.id)) {
          result.issues.push({
            file: relative,
            project_id: projectName,
            job_id: job.id,
            message: 'Another media job record already uses this id.',
          });
          continue;
        }
        seen.add(job.id);
        result.jobs.push(job);
      }
    }
    return result;
  }

  /** Persist one job through the serialised per-job write queue. */
  async persist(job: MediaJob): Promise<void> {
    const queue = this.queues.get(job.id) ?? {
      pending: null,
      running: null,
      waiters: [],
      lastError: null,
    };
    this.queues.set(job.id, queue);
    queue.pending = { job };
    await new Promise<void>((resolve, reject) => {
      queue.waiters.push({ resolve, reject });
      if (!queue.running) void this.drain(job.id, queue);
    });
  }

  async flush(jobId: string): Promise<void> {
    const queue = this.queues.get(jobId);
    if (!queue) return;
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

  protected async write(job: MediaJob): Promise<void> {
    const dir = this.jobsDir(job.project_id);
    await ensurePrivateDirectory(dir);
    const target = join(dir, `${job.id}.json`);
    const temp = join(dir, `.${job.id}-${process.pid}-${randomUUID()}.tmp`);
    try {
      // `wx` prevents clobbering a concurrently created temp file. The final
      // rename is atomic on the same filesystem: a reader sees either the
      // previous complete record or the new complete record. The temp file is
      // fsynced before the rename so a power loss after an acknowledged save
      // can publish the entry, never an entry without bytes.
      await writeFile(temp, `${JSON.stringify(job, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      await syncFile(temp);
      await rename(temp, target);
      await syncDirectory(dir);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** Test seam: clear an idle in-memory write queue between isolated runs. */
  clearQueueForTests(jobId: string): void {
    const queue = this.queues.get(jobId);
    if (queue && !queue.running && !queue.pending) this.queues.delete(jobId);
  }
}

function codeOf(error: unknown): string {
  const raw =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof raw === 'string' && /^[A-Z0-9_]+$/.test(raw) ? raw : 'unknown';
}

/** Absolute host paths never reach the browser; keep only an errno-style code. */
export function mediaJobFsMessage(action: string, error: unknown): string {
  return `${action} (${codeOf(error)}).`;
}
