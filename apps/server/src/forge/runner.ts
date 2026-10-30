import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoryEngine } from '@mml/memory-engine';
import {
  type DecisionGuardAdvisory,
  FORGE_PINNED_TYPES,
  type ForgeApprovalVerification,
  type ForgeJob,
  type ForgeJobKind,
  ForgeJobSchema,
  type ForgeJobStatus,
  type ForgeRecoveryIssue,
  type ForgeRecoveryReport,
  type ForgeRecoveryStorage,
  type ForgeRuntimeBrowserSelection,
  type ForgeState,
  type ForgeUsage,
  type ForgeValidation,
  type Memory,
  type RetrievedMemory,
  redactSecrets,
} from '@mml/shared';
import { forgeChildEnv } from './child-env.js';
import { isCliAvailable } from './cli-lookup.js';
import { evaluateDecisionGuardAdvisory } from './decision-guard.js';
import { ensurePrivateDirectory, syncDirectory, syncFile, writePrivateFile } from './fs-utils.js';
import { type ForgeJobPersistence, ForgeJobStore } from './job-store.js';
import { buildForgePrompt, buildRetrievalQuery } from './prompt.js';
import { checkGameRuntime } from './runtime-check.js';
import { ForgeError, type ForgeWorkspace } from './workspace.js';

/**
 * Runs one Muse job against a staging copy.
 *
 * Budgets are enforced on what is measurable: wall-clock runtime is a hard
 * stop; the call cap is passed to `muse exec --max-model-steps` and re-checked
 * on completion; tokens are reported but cannot be capped inside the CLI, so
 * they are labelled observational.
 */

export interface ForgeManagerOptions {
  workspace: ForgeWorkspace;
  engine: MemoryEngine;
  museBin?: string;
  maxRuntimeMs?: number;
  maxCalls?: number;
  maxInputTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** Extra environment for the child process (tests use it to script the CLI). */
  env?: NodeJS.ProcessEnv;
  /** Meta Model API key, passed to `muse exec` over stdin. */
  apiKey?: string;
  /** Model id for API-key runs (e.g. muse-spark-1.3-contributor). */
  model?: string;
  /** Key used only when the subscription reports quota exhaustion. */
  fallbackApiKey?: string;
  fallbackModel?: string;
  /** Browser runtime check run before approval; injectable for tests. */
  runtimeCheck?: (html: string) => Promise<{
    ok: boolean;
    errors: string[];
    browser?: string | null;
    browser_selection?: ForgeRuntimeBrowserSelection;
  }>;
  /** Durable job persistence; injectable for failure tests. */
  jobStore?: ForgeJobPersistence;
  /** Grace period before a shutdown escalates from SIGTERM to SIGKILL. */
  shutdownGraceMs?: number;
  now?: () => Date;
}

export interface StartJobInput {
  projectId: string;
  kind: ForgeJobKind;
  prompt: string;
  request?: string | null;
  /** Screenshot bytes for a modify job, written into the staging directory. */
  screenshot?: Buffer;
}

interface ExecuteState {
  child: ChildProcess | null;
  timedOut: boolean;
  terminal: string | null;
  terminalText: string | null;
  usage: ForgeUsage;
}

const MAX_LOGS = 200;

/**
 * Kept as a re-export for callers that imported Forge's pinned set from the
 * runner. The configuration itself lives in `@mml/shared` so the preview API
 * cannot drift from the production retrieval path.
 */
export { FORGE_PINNED_TYPES };

export class ForgeJobManager {
  readonly workspace: ForgeWorkspace;
  private readonly engine: MemoryEngine;
  private readonly museBin: string;
  private readonly maxRuntimeMs: number;
  private readonly maxCalls: number;
  private readonly maxInputTokens: number;
  private readonly effort: 'low' | 'medium' | 'high';
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly apiKey: string | undefined;
  private readonly model: string | undefined;
  private readonly fallbackApiKey: string | undefined;
  private readonly fallbackModel: string | undefined;
  private readonly carry = new Map<string, ForgeUsage>();
  private readonly runtimeCheck: (html: string) => Promise<{
    ok: boolean;
    errors: string[];
    browser?: string | null;
    browser_selection?: ForgeRuntimeBrowserSelection;
  }>;
  private readonly now: () => Date;
  private readonly store: ForgeJobPersistence;
  private readonly shutdownGraceMs: number;
  private readonly recoveryStartedAt: string;
  private readonly loadIssues: ForgeRecoveryIssue[] = [];
  private readonly persistenceIssues = new Map<string, ForgeRecoveryIssue>();
  private readonly acknowledgedIssueIds = new Set<string>();
  private acknowledgementTail: Promise<void> = Promise.resolve();
  private readonly startupLoadedByProject = new Map<string, number>();
  private readonly startupInterruptedByProject = new Map<string, number>();
  private readonly laterLoadedByProject = new Map<string, number>();
  private readonly laterInterruptedByProject = new Map<string, number>();
  private readonly loadIssueIds = new Set<string>();
  private readonly projectStorageErrors = new Map<string, string>();
  private readonly jobRevisions = new Map<string, number>();
  private recoveryPromise: Promise<ForgeRecoveryReport> | null = null;
  private rootStorageError: string | null = null;
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;
  private readonly starts = new Set<Promise<unknown>>();
  private readonly completions = new Map<string, { promise: Promise<void>; resolve: () => void }>();
  private readonly finalizations = new Map<string, Promise<void>>();
  private readonly terminalJobs = new Set<string>();
  private readonly jobs = new Map<string, ForgeJob>();
  private readonly state = new Map<string, ExecuteState>();
  private readonly cancelled = new Set<string>();
  private readonly locks = new Map<string, Promise<unknown>>();

  /** True when the generation CLI can be found; see `isCliAvailable`. */
  cliAvailable(): boolean {
    return isCliAvailable(this.museBin);
  }

  constructor(options: ForgeManagerOptions) {
    this.workspace = options.workspace;
    this.engine = options.engine;
    this.museBin = options.museBin ?? process.env.FORGE_MUSE_BIN ?? 'muse';
    this.maxRuntimeMs = options.maxRuntimeMs ?? 10 * 60_000;
    this.maxCalls = options.maxCalls ?? 25;
    this.maxInputTokens = options.maxInputTokens ?? 1_500_000;
    this.effort = options.reasoningEffort ?? 'low';
    this.env = options.env;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.fallbackApiKey = options.fallbackApiKey;
    this.fallbackModel = options.fallbackModel ?? 'muse-spark-1.3-contributor';
    this.runtimeCheck = options.runtimeCheck ?? checkGameRuntime;
    this.now = options.now ?? (() => new Date());
    this.store = options.jobStore ?? new ForgeJobStore(this.workspace);
    this.shutdownGraceMs = options.shutdownGraceMs ?? 5_000;
    this.recoveryStartedAt = this.now().toISOString();
  }

  list(projectId: string): ForgeJob[] {
    return [...this.jobs.values()]
      .filter((job) => job.project_id === projectId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  get(jobId: string): ForgeJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Reload persisted jobs exactly once.
   *
   * Queued and running records are marked `interrupted`, never resumed: a
   * model call may have consumed quota or written files before the restart,
   * and silently re-running it would duplicate both. Succeeded-but-unapplied
   * jobs keep their staged bytes so the review can continue.
   */
  recover(): Promise<ForgeRecoveryReport> {
    if (!this.recoveryPromise) this.recoveryPromise = this.recoverOnce();
    return this.recoveryPromise;
  }

  /** Wait for all queued durable writes. Used during shutdown. */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.jobs.keys()].map((jobId) => this.store.flush(jobId)));
  }

  /**
   * Stop accepting work, terminate owned children with bounded escalation, and
   * wait for terminal state to be persisted. Repeat calls share one promise.
   */
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  private async performShutdown(): Promise<void> {
    // An in-flight start either aborts at its next checkpoint or registers a
    // completion before this returns. Waiting here closes that race without
    // broad process matching.
    await Promise.allSettled([...this.starts]);

    // Mark every non-terminal job cancelled before signalling, so a child that
    // exits from SIGTERM is recorded as cancelled rather than as a failure.
    for (const job of this.jobs.values()) {
      if (job.status === 'queued' || job.status === 'running') this.cancelled.add(job.id);
    }
    this.signalActive('SIGTERM');
    if (!(await this.waitForCompletions(this.shutdownGraceMs))) {
      this.signalActive('SIGKILL');
      if (!(await this.waitForCompletions(this.shutdownGraceMs))) {
        // A close callback that never ran must not leave an unobservable
        // queued/running record behind. Terminalization is idempotent.
        for (const job of [...this.jobs.values()]) {
          if (job.status === 'queued' || job.status === 'running') {
            await this.finish(job, {
              status: 'cancelled',
              error: 'Cancelled because the server shut down.',
            });
          }
        }
      }
    }
    await this.flush();
  }

  private signalActive(signal: NodeJS.Signals): void {
    for (const execState of this.state.values()) {
      const child = execState.child;
      if (!child || child.exitCode !== null || child.signalCode !== null) continue;
      try {
        child.kill(signal);
      } catch {
        // The child may have exited between the check and the signal.
      }
    }
  }

  private async waitForCompletions(timeoutMs: number): Promise<boolean> {
    const pending = [...this.completions.values()].map((entry) => entry.promise);
    if (pending.length === 0) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const result = await Promise.race([Promise.allSettled(pending).then(() => true), timeout]);
    if (timer) clearTimeout(timer);
    return result;
  }

  private assertAccepting(): void {
    if (this.shuttingDown) {
      throw new ForgeError(
        'shutting_down',
        'The server is shutting down; no new Forge job can start.',
      );
    }
  }

  private beginCompletion(jobId: string): void {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    this.completions.set(jobId, { promise, resolve });
  }

  private complete(jobId: string): void {
    const completion = this.completions.get(jobId);
    if (!completion) return;
    this.completions.delete(jobId);
    completion.resolve();
  }

  /** Observable recovery/storage state, scoped to one project when asked. */
  recovery(projectId?: string): ForgeRecoveryReport {
    const currentJobs = projectId ? this.list(projectId) : [...this.jobs.values()];
    const startupLoaded = projectId
      ? (this.startupLoadedByProject.get(projectId) ?? 0)
      : [...this.startupLoadedByProject.values()].reduce((sum, count) => sum + count, 0);
    const startupInterrupted = projectId
      ? (this.startupInterruptedByProject.get(projectId) ?? 0)
      : [...this.startupInterruptedByProject.values()].reduce((sum, count) => sum + count, 0);
    const laterLoaded = projectId
      ? (this.laterLoadedByProject.get(projectId) ?? 0)
      : [...this.laterLoadedByProject.values()].reduce((sum, count) => sum + count, 0);
    const laterInterrupted = projectId
      ? (this.laterInterruptedByProject.get(projectId) ?? 0)
      : [...this.laterInterruptedByProject.values()].reduce((sum, count) => sum + count, 0);

    const issues = [...this.loadIssues, ...this.persistenceIssues.values()]
      .filter(
        (issue) =>
          projectId === undefined || issue.scope === 'store' || issue.project_id === projectId,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    const visible = issues.filter(
      (issue) => issue.kind === 'active' || !this.acknowledgedIssueIds.has(issue.id),
    );
    const persistenceFailure = projectId
      ? [...this.persistenceIssues.values()].find((issue) => issue.project_id === projectId)
      : undefined;
    const projectFailure = projectId
      ? (this.projectStorageErrors.get(projectId) ?? persistenceFailure?.message ?? null)
      : null;
    const rootFailure = this.rootStorageError;
    const storageScope: ForgeRecoveryStorage['scope'] =
      rootFailure && projectFailure
        ? 'both'
        : rootFailure
          ? 'store'
          : projectFailure
            ? 'project'
            : 'healthy';
    const storageError = projectFailure ?? rootFailure ?? null;

    return {
      startup: {
        scanned_at: this.recoveryStartedAt,
        loaded_jobs: startupLoaded,
        interrupted_jobs: startupInterrupted,
      },
      later_recovery: {
        loaded_jobs: laterLoaded,
        interrupted_jobs: laterInterrupted,
      },
      current_jobs: currentJobs.length,
      current_interrupted_jobs: currentJobs.filter((job) => job.status === 'interrupted').length,
      issues: visible.slice(-50),
      acknowledged_issues: issues.length - visible.length,
      storage: {
        ok: storageError === null,
        error: storageError,
        scope: storageScope,
        root_ok: rootFailure === null,
        root_error: rootFailure,
        project_ok: projectId ? projectFailure === null : null,
        project_error: projectId ? projectFailure : null,
      },
    };
  }

  /** Acknowledge historical notices without deleting job or audit records. */
  acknowledge(projectId: string, issueIds: string[]): Promise<ForgeRecoveryReport> {
    // Serialize read/modify/write so concurrent acknowledgements cannot
    // overwrite each other, and never publish an id before the write succeeds.
    const operation = this.acknowledgementTail.then(
      () => this.acknowledgeNow(projectId, issueIds),
      () => this.acknowledgeNow(projectId, issueIds),
    );
    this.acknowledgementTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async acknowledgeNow(
    projectId: string,
    issueIds: string[],
  ): Promise<ForgeRecoveryReport> {
    const requested = new Set(issueIds);
    const allowed = this.loadIssues.filter(
      (issue) =>
        issue.kind === 'startup' &&
        requested.has(issue.id) &&
        // Store-wide notices are intentionally visible (and acknowledgeable)
        // from every project. A project's own notice is not, even when its id
        // is the historical `forge` store sentinel.
        (issue.scope === 'store' || issue.project_id === projectId),
    );
    if (allowed.length === 0) return this.recovery(projectId);

    const proposed = new Set(this.acknowledgedIssueIds);
    for (const issue of allowed) proposed.add(issue.id);
    await this.saveAcknowledgements(proposed);
    // Publish only after the durable write succeeded.
    this.acknowledgedIssueIds.clear();
    for (const id of proposed) this.acknowledgedIssueIds.add(id);
    return this.recovery(projectId);
  }

  /** Explicit storage health check with independent root/project outcomes. */
  async checkStorage(projectId: string): Promise<ForgeRecoveryReport> {
    let result: Awaited<ReturnType<ForgeJobPersistence['healthCheck']>>;
    try {
      result = await this.store.healthCheck(projectId);
    } catch (error) {
      const message = this.boundedStorageMessage(error);
      // Unknown check failure: do not claim either scope is healthy.
      this.rootStorageError = message;
      this.projectStorageErrors.set(projectId, message);
      return this.recovery(projectId);
    }

    const rootWasUnreadable = this.rootStorageError !== null;
    const projectWasUnreadable = this.projectStorageErrors.has(projectId);

    if (result.root.ok) {
      if (rootWasUnreadable) {
        // A writable root is not enough: the records that could not be listed
        // at startup must be re-read before the store-wide error can clear.
        await this.reloadAfterStorageRecovery();
      } else {
        this.rootStorageError = null;
      }
    } else {
      this.rootStorageError = this.boundedStorageText(result.root.error);
    }

    if (result.project.ok) {
      // A store-wide reload can discover a project read failure after the
      // project scope was captured. Retry that project too before clearing it.
      if (projectWasUnreadable || this.projectStorageErrors.has(projectId)) {
        await this.reloadAfterStorageRecovery(projectId);
      } else {
        this.projectStorageErrors.delete(projectId);
      }
      // The directory is writable again, but that says nothing about the job
      // records whose required writes failed. Retry the newest in-memory state
      // for each affected job before clearing its incident. A failed retry
      // records a fresh active incident and keeps storage unhealthy.
      await this.retryProjectPersistence(projectId);
    } else {
      this.projectStorageErrors.set(projectId, this.boundedStorageText(result.project.error));
    }
    return this.recovery(projectId);
  }

  /**
   * Re-read records hidden by an earlier directory failure. Reconciliation
   * never overwrites a job already in memory: that record may be newer than
   * disk, or it may still be executing. Newly discovered queued/running jobs
   * become interrupted and are never resumed.
   *
   * The relevant error is cleared *before* the read so a repeated failure is
   * observable rather than being masked by the previously known message.
   * Returns false when the scope is still not readable.
   */
  private async reloadAfterStorageRecovery(projectId?: string): Promise<boolean> {
    if (projectId === undefined) {
      this.rootStorageError = null;
    } else {
      this.projectStorageErrors.delete(projectId);
    }

    let loaded: Awaited<ReturnType<ForgeJobPersistence['loadAll']>>;
    try {
      loaded = await this.store.loadAll(projectId === undefined ? {} : { projectId });
    } catch (error) {
      const message = this.boundedStorageMessage(error);
      if (projectId === undefined) {
        this.rootStorageError = message;
        this.recordLoadIssue(
          'job_store_unreadable',
          '.',
          'The Forge job store could not be re-read after recovery.',
          'forge',
          null,
          'store',
        );
      } else {
        this.projectStorageErrors.set(projectId, message);
        this.recordLoadIssue(
          'job_store_unreadable',
          `${projectId}/jobs`,
          'The project job directory could not be re-read after recovery.',
          projectId,
          null,
        );
      }
      return false;
    }

    this.addLoadIssues(loaded.issues);
    this.applyLoadedStorageFailures(loaded.issues);
    await this.reconcileRecoveredJobs(loaded.jobs, 'later');

    return projectId === undefined
      ? this.rootStorageError === null
      : !this.projectStorageErrors.has(projectId);
  }

  /**
   * Persist the latest affected job records after a successful directory
   * health check. Retries use the store's per-job write queue, and a retry
   * only clears its incident after a stable snapshot has been durably written.
   * If state changes while a write is in flight, the newest revision is
   * written again rather than letting a stale retry overwrite it.
   */
  private async retryProjectPersistence(projectId: string): Promise<void> {
    const failed = [...this.persistenceIssues.values()].filter(
      (issue) => issue.project_id === projectId && issue.job_id !== null,
    );
    for (const issue of failed) {
      if (issue.job_id) await this.retryJobPersistence(issue.job_id, issue);
    }
  }

  private async retryJobPersistence(
    jobId: string,
    expectedIncident: ForgeRecoveryIssue,
  ): Promise<void> {
    let incident = this.persistenceIssues.get(jobId);
    if (incident !== expectedIncident) return;
    let wrote = false;

    // Three attempts cover the initial snapshot, a concurrent state change,
    // and a final retry of the newest revision. If state keeps changing, the
    // warning stays visible rather than claiming a stable durable record.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const job = this.jobs.get(jobId);
      if (!job) return;
      if (!wrote && this.persistenceIssues.get(jobId) !== expectedIncident) return;
      const revision = this.jobRevisions.get(jobId) ?? 0;

      try {
        // Read the latest job synchronously above and enqueue immediately, so
        // any later update is ordered after this write. `save` resolves only
        // after this snapshot (or its coalesced successor) is written.
        await this.store.save(job, { required: true });
        await this.store.flush(jobId);
        wrote = true;
      } catch (error) {
        this.recordPersistenceIssue(job, error);
        incident = this.persistenceIssues.get(jobId);
        if ((this.jobRevisions.get(jobId) ?? 0) === revision) return;
        wrote = true;
        continue;
      }

      if ((this.jobRevisions.get(jobId) ?? 0) !== revision) {
        // A newer state arrived while the stale snapshot was being written.
        // Write that revision too; otherwise the stale retry would win.
        wrote = true;
        continue;
      }
      if (this.persistenceIssues.get(jobId) === incident) {
        this.persistenceIssues.delete(jobId);
      }
      return;
    }
  }

  private boundedStorageMessage(error: unknown): string {
    return this.boundedStorageText(error instanceof Error ? error.message : String(error));
  }

  private boundedStorageText(value: string | null): string {
    return this.sanitize(value ?? 'Storage health check failed.').slice(0, 300);
  }

  private async loadAcknowledgements(): Promise<void> {
    try {
      const raw = await readFile(this.acknowledgementPath(), 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const value of parsed) {
        if (typeof value === 'string' && value.length > 0 && value.length <= 400) {
          this.acknowledgedIssueIds.add(value);
        }
      }
    } catch {
      // A missing or malformed acknowledgement file must not hide active failures.
    }
  }

  private async saveAcknowledgements(ids: Set<string>): Promise<void> {
    const root = this.workspace.getRoot();
    await ensurePrivateDirectory(root);
    const target = this.acknowledgementPath();
    const temp = join(root, `.recovery-ack-${process.pid}-${randomUUID()}.tmp`);
    try {
      await writeFile(temp, `${JSON.stringify([...ids].sort(), null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      await syncFile(temp);
      await rename(temp, target);
      await syncDirectory(root);
    } catch {
      await rm(temp, { force: true }).catch(() => undefined);
      throw new ForgeError(
        'persistence_failed',
        'The recovery acknowledgement could not be saved. Check workspace permissions and disk space.',
      );
    }
  }

  private acknowledgementPath(): string {
    return join(this.workspace.getRoot(), '.recovery-ack.json');
  }

  private async recoverOnce(): Promise<ForgeRecoveryReport> {
    await this.loadAcknowledgements();
    let loaded: Awaited<ReturnType<ForgeJobPersistence['loadAll']>>;
    try {
      loaded = await this.store.loadAll();
    } catch {
      this.rootStorageError = 'The Forge job store could not be read.';
      this.recordLoadIssue(
        'job_store_unreadable',
        '.',
        this.rootStorageError,
        'forge',
        null,
        'store',
      );
      return this.recovery();
    }
    this.addLoadIssues(loaded.issues);
    this.applyLoadedStorageFailures(loaded.issues);
    await this.reconcileRecoveredJobs(loaded.jobs, 'startup');
    return this.recovery();
  }

  /**
   * Reconcile records that surface during startup or a later storage retry.
   *
   * A job already present in memory always wins: it can be newer than the
   * record on disk, and an active child must never be replaced by a stale
   * `queued` snapshot. Newly discovered queued/running records are terminalized
   * as interrupted, never resumed. Succeeded-unapplied jobs keep their staging.
   */
  private async reconcileRecoveredJobs(
    jobs: ForgeJob[],
    source: 'startup' | 'later',
  ): Promise<void> {
    for (const job of jobs) {
      if (this.jobs.has(job.id)) continue;
      let current = job;
      let interrupted = false;
      if (job.status === 'queued' || job.status === 'running') {
        current = ForgeJobSchema.parse({
          ...job,
          status: 'interrupted',
          error:
            'Interrupted by a server restart. The model run was not resumed; any staged files are kept for inspection.',
          finished_at: this.now().toISOString(),
        });
        interrupted = true;
        this.recordLoadIssue(
          'job_interrupted',
          `${job.project_id}/jobs/${job.id}.json`,
          'A running job was interrupted by the server restart and was not resumed.',
          job.project_id,
          job.id,
        );
        await this.persistQuiet(current);
      } else if (job.status === 'succeeded' && job.version === null) {
        // A crash between promoting the version and writing the job record
        // leaves the version in state.json with this job's id. Reconcile it
        // instead of offering an already-applied change for review again.
        const reconciled = await this.reconcilePromotion(job);
        if (reconciled) current = reconciled;
      }
      if (current.status === 'succeeded' && current.version === null) {
        const staged = await this.workspace
          .stagedSnapshot(current.project_id, current.id)
          .catch(() => null);
        if (!staged) {
          this.recordLoadIssue(
            'staged_missing',
            `${current.project_id}/staging/${current.id}`,
            'The staged review file is missing, so this job cannot be approved.',
            current.project_id,
            current.id,
          );
        }
      }

      if (source === 'startup') {
        this.startupLoadedByProject.set(
          job.project_id,
          (this.startupLoadedByProject.get(job.project_id) ?? 0) + 1,
        );
        if (interrupted) {
          this.startupInterruptedByProject.set(
            job.project_id,
            (this.startupInterruptedByProject.get(job.project_id) ?? 0) + 1,
          );
        }
      } else {
        this.laterLoadedByProject.set(
          job.project_id,
          (this.laterLoadedByProject.get(job.project_id) ?? 0) + 1,
        );
        if (interrupted) {
          this.laterInterruptedByProject.set(
            job.project_id,
            (this.laterInterruptedByProject.get(job.project_id) ?? 0) + 1,
          );
        }
      }
      this.setJob(current);
    }
  }

  private addLoadIssues(issues: ForgeRecoveryIssue[]): void {
    for (const issue of issues) {
      if (this.loadIssueIds.has(issue.id)) continue;
      this.loadIssueIds.add(issue.id);
      this.loadIssues.push(issue);
    }
  }

  private setJob(job: ForgeJob): void {
    this.jobs.set(job.id, job);
    this.jobRevisions.set(job.id, (this.jobRevisions.get(job.id) ?? 0) + 1);
  }

  /**
   * `loadAll` reports directory read failures as issues instead of throwing.
   * Carry only those availability failures into storage health; malformed
   * individual records stay historical notices and must not make the store
   * look unavailable.
   */
  private applyLoadedStorageFailures(issues: ForgeRecoveryIssue[]): void {
    for (const issue of issues) {
      if (issue.code !== 'job_store_unreadable') continue;
      const message = this.boundedStorageText(issue.message);
      if (issue.scope === 'store') {
        this.rootStorageError = message;
      } else {
        this.projectStorageErrors.set(issue.project_id, message);
      }
    }
  }

  private async reconcilePromotion(job: ForgeJob): Promise<ForgeJob | null> {
    try {
      const state = await this.workspace.state(job.project_id);
      const applied = state.versions.find((entry) => entry.job_id === job.id);
      if (!applied) return null;
      const reconciled = ForgeJobSchema.parse({ ...job, version: applied.version });
      await this.persistQuiet(reconciled);
      return reconciled;
    } catch {
      this.recordLoadIssue(
        'state_unreadable',
        `${job.project_id}/state.json`,
        'Promotion history could not be reconciled with the project state.',
        job.project_id,
        job.id,
      );
      return null;
    }
  }

  /**
   * Reject new work once shutdown begins. The wrapper tracks in-flight starts
   * so `shutdown()` can wait for them to abort at their next checkpoint (or
   * expose a child that it must terminate).
   */
  async start(input: StartJobInput): Promise<ForgeJob> {
    this.assertAccepting();
    const start = this.startJob(input);
    this.starts.add(start);
    try {
      return await start;
    } finally {
      this.starts.delete(start);
    }
  }

  private async startJob(input: StartJobInput): Promise<ForgeJob> {
    this.assertAccepting();
    await this.workspace.ensureProject(input.projectId);
    this.assertAccepting();
    const active = this.list(input.projectId).filter(
      (job) => job.status === 'queued' || job.status === 'running',
    ).length;
    if (active >= 2) {
      throw new ForgeError('too_many_jobs', 'Two jobs are already running for this project.');
    }
    const id = randomUUID();
    const staging = await this.workspace.createStaging(input.projectId, id);
    if (this.shuttingDown) {
      await this.workspace.reject(input.projectId, id).catch(() => undefined);
      this.assertAccepting();
    }

    // A modification must start from the approved source. An empty workspace
    // makes the model regenerate the application instead of editing it.
    let baseVersion: number | null = null;
    let memories: RetrievedMemory[] = [];
    let job: ForgeJob;
    try {
      if (input.kind === 'modify') {
        const state = await this.workspace.state(input.projectId);
        if (state.current_version === null) {
          throw new ForgeError(
            'no_current_version',
            'Generate and approve an application before requesting a modification.',
          );
        }
        const current = await this.workspace.currentHtml(input.projectId);
        if (current === null) {
          throw new ForgeError('no_current_version', 'The approved application could not be read.');
        }
        baseVersion = state.current_version;
        await writePrivateFile(join(staging, 'index.html'), current);
      }

      const query = buildRetrievalQuery({
        projectId: input.projectId,
        kind: input.kind,
        prompt: input.prompt,
        request: input.request,
      });
      const retrieval = this.engine.retrieve(
        {
          project_id: input.projectId,
          query,
          mode: 'forge',
        },
        { now: this.now() },
      );
      const memoryIds = retrieval.results.map((result) => result.memory.id);
      memories = retrieval.results;

      job = ForgeJobSchema.parse({
        id,
        project_id: input.projectId,
        kind: input.kind,
        status: 'queued',
        prompt: input.prompt,
        request: input.request ?? null,
        summary: null,
        error: null,
        created_at: this.now().toISOString(),
        started_at: null,
        finished_at: null,
        logs: [],
        usage: null,
        memory_ids: memoryIds,
        base_version: baseVersion,
        validation: null,
        version: null,
      });
    } catch (error) {
      // No execution began; do not leave staging behind for a job that never
      // existed. Completed/recovered staging is never removed by this path.
      await this.workspace.reject(input.projectId, id).catch(() => undefined);
      throw error;
    }

    this.setJob(job);
    try {
      await this.persist(job);
    } catch {
      // A job that cannot be stored durably must not start a paid model run:
      // after a crash there would be no record of what was executed.
      this.jobs.delete(id);
      this.jobRevisions.delete(id);
      this.persistenceIssues.delete(id);
      await this.workspace.reject(input.projectId, id).catch(() => undefined);
      throw new ForgeError(
        'persistence_failed',
        'The job could not be stored durably, so it was not started. Check workspace permissions and disk space.',
      );
    }
    this.state.set(id, {
      child: null,
      timedOut: false,
      terminal: null,
      terminalText: null,
      usage: { calls: 0, input_tokens: 0, output_tokens: 0, runtime_ms: 0 },
    });
    // Register completion before any post-persist I/O so shutdown can always
    // observe and terminalize this job, even if screenshot writing fails.
    this.beginCompletion(id);
    try {
      const images: string[] = [];
      if (input.screenshot && input.kind === 'modify') {
        const imagePath = join(staging, 'preview.png');
        await writePrivateFile(imagePath, input.screenshot);
        images.push(imagePath);
      }

      void this.execute(job, staging, memories, images).catch((error: unknown) => {
        void this.failCompletion(job, error).catch(() => undefined);
      });
      return job;
    } catch (error) {
      await this.finish(job, { status: 'failed', error: this.errorMessage(error) }).catch(
        () => undefined,
      );
      await this.workspace.reject(input.projectId, id).catch(() => undefined);
      throw error;
    }
  }

  cancel(jobId: string): ForgeJob | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    if (job.status === 'queued' || job.status === 'running') {
      this.cancelled.add(jobId);
      const child = this.state.get(jobId)?.child;
      if (child) child.kill('SIGKILL');
    }
    return this.jobs.get(jobId);
  }

  async diff(jobId: string) {
    const job = this.requireJob(jobId);
    const diff = await this.workspace.diffStaged(job.project_id, job.id);
    // Advisory only: carried alongside the diff so the review UI can show it
    // without ever feeding it into `diff.validation`.
    return { ...diff, decision_guard: job.decision_guard };
  }

  async approve(
    jobId: string,
    options: { captureMemory: boolean; decision?: string },
  ): Promise<{ job: ForgeJob; state: ForgeState }> {
    const job = this.requireJob(jobId);
    return this.withProjectLock(job.project_id, async () => {
      const current = this.requireJob(jobId);
      if (current.status !== 'succeeded' || current.version !== null) {
        throw new ForgeError(
          'invalid_job_state',
          'Only a succeeded, unapplied change can be approved.',
        );
      }

      const state = await this.workspace.state(current.project_id);
      if (state.current_version !== current.base_version) {
        throw new ForgeError(
          'version_conflict',
          `The approved application is v${String(state.current_version)}, but this change was staged from v${String(current.base_version)}. Regenerate it.`,
        );
      }

      // Server-side runtime verification: a structurally valid application can still
      // throw on load. Nothing is promoted until it renders cleanly. The
      // snapshot hash is the exact byte sequence the browser checked, and
      // promotion refuses anything else.
      const staged = await this.workspace.stagedSnapshot(current.project_id, current.id);
      const runtime = staged
        ? await this.runtimeCheck(staged.html)
        : { ok: false, errors: ['The staged application is missing.'] };
      const browserSelection = this.boundedBrowserSelection(runtime.browser_selection);
      const browser = runtime.browser ? this.boundedText(runtime.browser, 160) : null;
      if (!runtime.ok) {
        const checkedAt = this.now().toISOString();
        const runtimeDetails = runtime.errors
          .slice(0, 20)
          .map((error) => this.sanitize(error).slice(0, 300));
        const failed = ForgeJobSchema.parse({
          ...current,
          status: 'failed',
          error: 'Runtime verification failed.',
          validation: { ok: false, issues: runtimeDetails },
          approval_verification: staged
            ? {
                syntax_structure: current.validation,
                runtime: {
                  ok: false,
                  checked_at: checkedAt,
                  artifact_sha256: staged.sha256,
                  browser,
                  ...(browserSelection ? { browser_selection: browserSelection } : {}),
                  errors: runtimeDetails,
                },
                recorded_at: checkedAt,
              }
            : null,
          finished_at: checkedAt,
        });
        this.setJob(failed);
        try {
          await this.persist(failed);
        } catch {
          // The runtime failure is still the primary result. Keep its bounded
          // diagnostics in the response even though the failed record could not
          // be stored; do not expose the raw filesystem error.
          throw new ForgeError(
            'persistence_failed',
            'Runtime verification failed and the failure could not be recorded durably.',
            [...runtimeDetails, 'The failed job record could not be saved.'],
          );
        }
        throw new ForgeError(
          'runtime_failed',
          'The staged application failed runtime verification.',
          runtimeDetails,
        );
      }

      // Decision Guard (Phase 12C) runs only after the blocking runtime check
      // passed. It is advisory metadata: do not add a separate durable write
      // that can block approval. The approved lifecycle record below carries
      // the snapshot atomically with the promotion result.
      const decisionGuard = staged ? this.advisory(current, staged.html, true) : null;
      if (decisionGuard) {
        current.decision_guard = decisionGuard;
      }

      // Capturing a decision is an explicit user act. The model's terminal
      // summary is never promoted into a verified creative decision.
      const decision = options.decision?.trim() ?? '';
      if (options.captureMemory && decision.length === 0) {
        throw new ForgeError(
          'decision_required',
          'Saving to project memory requires a decision written by the user.',
        );
      }

      const summary = versionSummary(current);
      const checkedAt = this.now().toISOString();
      const approvalVerification: ForgeApprovalVerification = {
        syntax_structure: current.validation,
        runtime: staged
          ? {
              ok: runtime.ok,
              checked_at: checkedAt,
              artifact_sha256: staged.sha256,
              browser,
              ...(browserSelection ? { browser_selection: browserSelection } : {}),
              errors: runtime.errors
                .slice(0, 20)
                .map((error) => this.sanitize(error).slice(0, 300)),
            }
          : null,
        recorded_at: checkedAt,
      };
      const promoted = await this.workspace.promote(current.project_id, current.id, summary, {
        baseVersion: current.base_version,
        jobId: current.id,
        ...(staged ? { expectedSha256: staged.sha256 } : {}),
        verification: approvalVerification,
      });
      if (promoted.note) this.log(current, promoted.note);

      const approved = ForgeJobSchema.parse({
        ...current,
        status: 'succeeded',
        version: promoted.version,
        approval_verification: approvalVerification,
        // `finished_at` records when generation completed, not when a human
        // later approved the already-finished artifact. Approval time lives in
        // `approval_verification.recorded_at`.
        finished_at: current.finished_at ?? this.now().toISOString(),
      });
      this.setJob(approved);
      try {
        await this.persist(approved);
      } catch {
        // The version is already promoted and immutable. Report the partial
        // write instead of implying the approval did not happen; startup
        // recovery reconciles the job record from state.json.
        throw new ForgeError(
          'persistence_failed',
          `v${promoted.version} is now the approved version, but its job record could not be updated. Reopen the project to reconcile it.`,
        );
      }

      if (options.captureMemory) {
        this.engine.create({
          type: 'technical_decision',
          scope: 'project',
          project_id: current.project_id,
          content: decision.slice(0, 1_000),
          source: { session_id: null, reference: `forge:${current.id}` },
          confidence: 0.9,
          validation_status: 'verified',
          tags: ['forge'],
          expires_at: null,
        });
      }

      return { job: approved, state: await this.workspace.state(current.project_id) };
    });
  }

  async rollback(projectId: string): Promise<ForgeState> {
    return this.withProjectLock(projectId, async () => {
      await this.workspace.rollback(projectId);
      return this.workspace.state(projectId);
    });
  }

  private async withProjectLock<T>(projectId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(projectId) ?? Promise.resolve();
    const next = previous.then(run, run);
    this.locks.set(
      projectId,
      next.catch(() => undefined),
    );
    return next;
  }

  async reject(jobId: string): Promise<ForgeJob> {
    const job = this.requireJob(jobId);
    // Rejection deletes staging, so it must contend with approval for the same
    // project: otherwise a rejection racing an approval could delete the bytes
    // that promotion is about to copy.
    return this.withProjectLock(job.project_id, async () => {
      const current = this.requireJob(jobId);
      if (current.status !== 'succeeded' || current.version !== null) {
        throw new ForgeError(
          'invalid_job_state',
          'Only a succeeded, unapplied change can be rejected.',
        );
      }
      await this.workspace.reject(current.project_id, current.id);
      const rejected = ForgeJobSchema.parse({
        ...current,
        status: 'rejected',
        // Rejection is a review decision on a completed generation; it must not
        // rewrite when the model actually finished.
        finished_at: current.finished_at ?? this.now().toISOString(),
      });
      this.setJob(rejected);
      try {
        await this.persist(rejected);
      } catch {
        throw new ForgeError(
          'persistence_failed',
          'The staged files were removed, but the rejection could not be recorded durably. Reopen the project before relying on this state.',
        );
      }
      return rejected;
    });
  }

  private requireJob(jobId: string): ForgeJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new ForgeError('invalid_job_id', 'Unknown job.');
    return job;
  }

  private async execute(
    job: ForgeJob,
    staging: string,
    memories: RetrievedMemory[],
    images: string[],
    attempt: 'primary' | 'fallback' = 'primary',
  ): Promise<void> {
    const execState = this.state.get(job.id);
    if (!execState || this.terminalJobs.has(job.id)) return;
    if (this.shuttingDown || this.cancelled.has(job.id)) {
      await this.finish(job, {
        status: 'cancelled',
        error: this.shuttingDown ? 'Cancelled because the server shut down.' : null,
      });
      return;
    }

    const prompt = buildForgePrompt({
      kind: job.kind,
      prompt: job.prompt,
      request: job.request,
      memories,
      hasScreenshot: images.length > 0,
    });
    this.update(job, { prompt_sha256: createHash('sha256').update(prompt).digest('hex') });
    const promptPath = join(staging, 'prompt.txt');
    await writePrivateFile(promptPath, prompt);
    // Shutdown may begin while the prompt is being written; do not spawn a
    // child after the manager has promised to stop.
    if (this.shuttingDown || this.cancelled.has(job.id)) {
      await this.finish(job, {
        status: 'cancelled',
        error: this.shuttingDown ? 'Cancelled because the server shut down.' : null,
      });
      return;
    }

    const args = [
      'exec',
      '--json',
      // Keep the child out of the developer's personal context and the
      // network, and stop it from persisting a second transcript or blocking
      // on a human. Forge needs file-write tools, so it cannot use the
      // provider's `--preset empty`; these flags are the common subset.
      '--no-session-log',
      '--no-foreign-personal-context',
      '--disable-web-tools',
      '--disable-reminders',
      '--disable-request-user-input',
      '--workspace',
      staging,
      '--prompt-file',
      promptPath,
      // Enforce the call budget before the CLI starts another model step. The
      // reported usage is still re-checked on completion.
      '--max-model-steps',
      String(this.maxCalls),
      '--reasoning-effort',
      this.effort,
    ];
    const apiKey = attempt === 'fallback' ? this.fallbackApiKey : this.apiKey;
    const model = attempt === 'fallback' ? this.fallbackModel : this.model;
    if (apiKey) args.push('--provider', 'meta', '--api-key-stdin');
    if (model) args.push('--model', model);
    for (const image of images) args.push('--image', image);

    this.update(job, { status: 'running', started_at: this.now().toISOString() });
    const startedAt = Date.now();

    const child = spawn(this.museBin, args, {
      // Running from the staging directory makes relative paths in the child
      // default to the job's workspace. It is a convenience, not a sandbox:
      // the process still has the server user's OS permissions.
      cwd: staging,
      env: forgeChildEnv(this.env),
      stdio: [apiKey ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    if (apiKey && child.stdin) {
      child.stdin.write(apiKey);
      child.stdin.end();
    }
    execState.child = child;
    // Cancellation can arrive between `start()` and this spawn; honour it now.
    if (this.cancelled.has(job.id)) child.kill('SIGKILL');

    const timer = setTimeout(() => {
      execState.timedOut = true;
      child.kill('SIGKILL');
    }, this.maxRuntimeMs);

    let stdoutBuffer = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdoutBuffer += chunk;
      let newline = stdoutBuffer.indexOf('\n');
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (line.length > 0) this.consumeLine(job, execState, line);
        newline = stdoutBuffer.indexOf('\n');
      }
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.log(job, `stderr: ${chunk.slice(0, 2_000)}`);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      // Spawn failures race the close event. Both paths share one idempotent
      // finalization and must never leave a rejected promise unobserved.
      void this.failCompletion(job, error).catch(() => undefined);
    });

    child.stdin?.on('error', (error) => {
      this.log(job, `stdin: ${this.errorMessage(error)}`);
    });
    child.stdout?.on('error', (error) => {
      this.log(job, `stdout: ${this.errorMessage(error)}`);
    });
    child.stderr?.on('error', (error) => {
      this.log(job, `stderr: ${this.errorMessage(error)}`);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const runtime = Date.now() - startedAt;
      execState.usage = { ...execState.usage, runtime_ms: runtime };
      // Completion does I/O (staging reset, validation, advisory evaluation)
      // and can fail. It is deliberately contained here: an unhandled
      // rejection would terminate the server before the job could be recorded.
      void this.completeChild(job, code, execState, staging, memories, images, attempt)
        .catch((error: unknown) => this.failCompletion(job, error))
        .catch(() => undefined);
    });
  }

  /**
   * Process a child's successful exit. Any failure in this path terminalizes
   * the job with a bounded diagnostic instead of scheduling a fallback or
   * leaving the completion promise unresolved.
   */
  private async completeChild(
    job: ForgeJob,
    code: number | null,
    execState: ExecuteState,
    staging: string,
    memories: RetrievedMemory[],
    images: string[],
    attempt: 'primary' | 'fallback',
  ): Promise<void> {
    if (this.terminalJobs.has(job.id)) return;
    const base = { usage: execState.usage, finished_at: this.now().toISOString() };
    const cancelled = this.cancelled.has(job.id);

    if (cancelled) {
      await this.finish(job, {
        ...base,
        status: 'cancelled',
        error: this.shuttingDown ? 'Cancelled because the server shut down.' : null,
      });
      return;
    }
    if (execState.timedOut) {
      await this.finish(job, {
        ...base,
        status: 'failed',
        error: `Job exceeded the ${Math.round(this.maxRuntimeMs / 1000)}s runtime budget.`,
      });
      return;
    }
    if (
      (code !== 0 || execState.terminal === 'failed') &&
      attempt === 'primary' &&
      this.fallbackApiKey &&
      quotaFailure(job)
    ) {
      this.carry.set(job.id, addUsage(execState.usage, this.carry.get(job.id)) ?? execState.usage);
      this.log(
        job,
        `Subscription quota exhausted; retrying with ${this.fallbackModel ?? 'the API key'}.`,
      );
      // A staging reset reads the approved source. If that read fails, this
      // throws and the fallback is never started; completion error handling
      // records the failure on the job.
      await this.resetStaging(job, staging);
      if (this.terminalJobs.has(job.id)) return;
      await this.execute(job, staging, memories, images, 'fallback');
      return;
    }
    if (code !== 0 || execState.terminal === 'failed') {
      const stderr = job.logs
        .filter((line) => line.startsWith('stderr:'))
        .slice(-2)
        .join(' ')
        .slice(0, 400);
      await this.finish(job, {
        ...base,
        status: 'failed',
        error:
          execState.terminalText ??
          `Muse exited with code ${String(code)}.${stderr ? ` ${stderr}` : ''}`,
      });
      return;
    }

    const validation = await this.workspace.validateStaged(job.project_id, job.id);
    if (!validation.ok) {
      await this.finish(job, {
        ...base,
        status: 'failed',
        error: 'Generated application failed validation.',
        validation,
      });
      return;
    }
    if (
      execState.usage.calls > this.maxCalls ||
      execState.usage.input_tokens > this.maxInputTokens
    ) {
      await this.finish(job, {
        ...base,
        status: 'budget_exceeded',
        error: `Budget exceeded: ${execState.usage.calls} calls, ${execState.usage.input_tokens} input tokens.`,
        validation,
      });
      return;
    }

    // Advisory snapshot for human review. It is computed after structural
    // validation and recorded beside — never inside — `validation`. The
    // blocking browser check runs on approve, which re-snapshots after it.
    const staged = await this.workspace.stagedHtml(job.project_id, job.id);
    const decisionGuard = staged === null ? null : this.advisory(job, staged, false);

    await this.finish(job, {
      ...base,
      status: 'succeeded',
      summary: execState.terminalText?.slice(0, 2_000) ?? 'Application updated.',
      validation,
      ...(decisionGuard ? { decision_guard: decisionGuard } : {}),
    });
  }

  /**
   * Terminalize a failed completion. Cancellation wins if it arrived before
   * the failure was observed, preserving shutdown semantics. This method never
   * rejects: it is the last line of defence against a second unhandled
   * rejection inside the close handler.
   */
  private async failCompletion(job: ForgeJob, error: unknown): Promise<void> {
    const cancelled = this.cancelled.has(job.id) || this.shuttingDown;
    try {
      await this.finish(job, {
        status: cancelled ? 'cancelled' : 'failed',
        error: cancelled
          ? this.shuttingDown
            ? 'Cancelled because the server shut down.'
            : null
          : this.errorMessage(error),
      });
    } catch {
      // `finish` itself is defensive, but a terminal record must still resolve
      // completion tracking if an unexpected sync error escaped it.
      try {
        this.update(
          job,
          {
            status: 'failed',
            error: 'Job completion failed and the result could not be recorded.',
          },
          true,
        );
      } catch {
        // Nothing further can be persisted; completion still resolves below.
      }
      this.state.delete(job.id);
      await this.store.flush(job.id).catch(() => undefined);
      this.complete(job.id);
    }
  }

  private errorMessage(error: unknown): string {
    const raw =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Unknown completion error.';
    const detail = this.sanitize(raw).replaceAll(this.workspace.getRoot(), '<workspace>');
    return this.boundedText(`Job completion failed: ${detail || 'unknown error'}`, 300);
  }

  private consumeLine(job: ForgeJob, execState: ExecuteState, line: string): void {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      this.log(job, line.slice(0, 500));
      return;
    }
    if (!isRecord(event)) return;
    const type = typeof event.payload_type === 'string' ? event.payload_type : '';
    const payload = isRecord(event.payload) ? event.payload : {};

    if (type === 'run.usage') {
      const models = Array.isArray(payload.models) ? payload.models : [];
      let input = 0;
      let output = 0;
      for (const model of models) {
        if (!isRecord(model)) continue;
        if (typeof model.input_tokens === 'number') input += model.input_tokens;
        if (typeof model.output_tokens === 'number') output += model.output_tokens;
      }
      execState.usage = {
        ...execState.usage,
        calls: typeof payload.calls === 'number' ? payload.calls : execState.usage.calls,
        input_tokens: input,
        output_tokens: output,
      };
      return;
    }
    if (type === 'run.output.delta' && typeof payload.text === 'string') {
      this.log(job, payload.text.trim());
      return;
    }
    if (type === 'run.terminal') {
      if (typeof payload.terminal === 'string') execState.terminal = payload.terminal;
      if (typeof payload.text === 'string') execState.terminalText = payload.text;
      return;
    }
    if (type === 'task.lifecycle' && isRecord(payload.event) && payload.event.kind === 'failed') {
      this.log(job, 'task failed');
    }
  }

  private log(job: ForgeJob, entry: string): void {
    const trimmed = entry.trim();
    if (trimmed.length === 0) return;
    const logs = [...job.logs, this.sanitize(trimmed).slice(0, 2_000)].slice(-MAX_LOGS);
    this.update(job, { logs });
  }

  private update(job: ForgeJob, patch: Partial<ForgeJob>, required = false): void {
    const next = { ...job, ...patch };
    this.setJob(next);
    Object.assign(job, next);
    // Logs and usage are intermediate: the store coalesces superseded
    // snapshots. Terminal transitions pass `required` and are awaited by
    // `finish`/approval/rejection.
    void this.persist(next, required).catch(() => undefined);
  }

  private async resetStaging(job: ForgeJob, staging: string): Promise<void> {
    if (job.kind === 'modify') {
      const current = await this.workspace.currentHtml(job.project_id);
      if (current !== null) await writePrivateFile(join(staging, 'index.html'), current);
    } else {
      const file = join(staging, 'index.html');
      await writePrivateFile(file, '');
    }
  }

  private sanitize(text: string): string {
    return redactSecrets(text, { secrets: [this.apiKey, this.fallbackApiKey] });
  }

  /** Bound and redact untrusted launch diagnostics before schema validation. */
  private boundedBrowserSelection(
    selection: ForgeRuntimeBrowserSelection | undefined,
  ): ForgeRuntimeBrowserSelection | undefined {
    if (!selection) return undefined;
    const policy =
      selection.policy === 'managed' || selection.policy === 'chrome' ? selection.policy : null;
    if (!policy) return undefined;
    return {
      policy,
      attempted: this.boundedText(selection.attempted, 160),
      selected:
        typeof selection.selected === 'string' ? this.boundedText(selection.selected, 160) : null,
      failure:
        typeof selection.failure === 'string' ? this.boundedText(selection.failure, 300) : null,
    };
  }

  private boundedText(text: string, limit: number): string {
    const redacted = this.sanitize(text);
    if (redacted.length <= limit) return redacted;
    const marker = '…';
    return `${redacted.slice(0, Math.max(0, limit - marker.length))}${marker}`.slice(0, limit);
  }

  /**
   * Advisory Decision Guard snapshot for the exact staged source.
   *
   * Resolves only the job's *recorded* memory ids, scoped to the job's project.
   * The snapshot is metadata for a human reviewer; it is never read by
   * `approve`, `promote`, or any validation path.
   */
  private advisory(job: ForgeJob, source: string, runtimeVerified: boolean): DecisionGuardAdvisory {
    return evaluateDecisionGuardAdvisory({
      projectId: job.project_id,
      memoryIds: job.memory_ids,
      source,
      getMemory: (id): Memory | null => this.engine.get(id),
      evaluatedAt: this.now(),
      runtimeVerified,
      secrets: [this.apiKey, this.fallbackApiKey],
    });
  }

  private finish(
    job: ForgeJob,
    patch: {
      status: ForgeJobStatus;
      error?: string | null;
      summary?: string | null;
      validation?: ForgeValidation;
      decision_guard?: DecisionGuardAdvisory;
      usage?: ForgeUsage;
      finished_at?: string;
    },
  ): Promise<void> {
    // Close and spawn-error can race. Share one finalization promise so the
    // second caller waits for the same durable record instead of returning
    // early while completion tracking is still pending.
    const existing = this.finalizations.get(job.id);
    if (existing) return existing;
    if (this.terminalJobs.has(job.id)) {
      this.complete(job.id);
      return Promise.resolve();
    }

    const operation = this.finalize(job, patch);
    this.finalizations.set(job.id, operation);
    const clear = (): void => {
      if (this.finalizations.get(job.id) === operation) this.finalizations.delete(job.id);
    };
    void operation.then(clear, clear);
    return operation;
  }

  private async finalize(
    job: ForgeJob,
    patch: {
      status: ForgeJobStatus;
      error?: string | null;
      summary?: string | null;
      validation?: ForgeValidation;
      decision_guard?: DecisionGuardAdvisory;
      usage?: ForgeUsage;
      finished_at?: string;
    },
  ): Promise<void> {
    this.terminalJobs.add(job.id);
    this.cancelled.delete(job.id);
    const carried = this.carry.get(job.id);
    this.carry.delete(job.id);
    try {
      this.update(
        job,
        {
          status: patch.status,
          error: patch.error ? this.sanitize(patch.error) : null,
          summary: patch.summary ? this.sanitize(patch.summary) : job.summary,
          validation: patch.validation ?? job.validation,
          decision_guard: patch.decision_guard ?? job.decision_guard,
          usage: carried ? addUsage(patch.usage ?? job.usage, carried) : (patch.usage ?? job.usage),
          finished_at: patch.finished_at ?? this.now().toISOString(),
        },
        true,
      );
    } finally {
      this.state.delete(job.id);
      // Make the terminal record observable before callers see completion. A
      // failed write is already recorded by `persist` and shown in recovery().
      await this.store.flush(job.id).catch(() => undefined);
      this.complete(job.id);
    }
  }

  private async persist(job: ForgeJob, required = true): Promise<void> {
    try {
      await this.store.save(job, { required });
      this.persistenceIssues.delete(job.id);
    } catch (error) {
      this.recordPersistenceIssue(job, error);
      throw error;
    }
  }

  private async persistQuiet(job: ForgeJob): Promise<void> {
    await this.persist(job).catch(() => undefined);
  }

  private recordPersistenceIssue(job: ForgeJob, error: unknown): void {
    const message = this.persistenceMessage(error);
    this.persistenceIssues.set(job.id, {
      id: this.issueId(
        'job_persist_failed',
        job.project_id,
        job.id,
        `${job.project_id}/jobs/${job.id}.json`,
      ),
      kind: 'active',
      code: 'job_persist_failed',
      scope: 'project',
      file: `${job.project_id}/jobs/${job.id}.json`,
      message,
      project_id: job.project_id,
      job_id: job.id,
    });
  }

  private persistenceMessage(error: unknown): string {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : 'unknown';
    return `A durable job write failed${code === 'unknown' ? '' : ` (${code})`}.`;
  }

  private recordLoadIssue(
    code: ForgeRecoveryIssue['code'],
    file: string,
    message: string,
    projectId: string,
    jobId: string | null,
    scope: ForgeRecoveryIssue['scope'] = 'project',
  ): void {
    const relative = file.slice(0, 300);
    const id = this.issueId(code, projectId, jobId, relative);
    if (this.loadIssueIds.has(id)) return;
    this.loadIssueIds.add(id);
    this.loadIssues.push({
      id,
      kind: 'startup',
      code,
      scope,
      file: relative,
      message: this.sanitize(message).slice(0, 300),
      project_id: projectId,
      job_id: jobId,
    });
  }

  private issueId(
    code: ForgeRecoveryIssue['code'],
    projectId: string,
    jobId: string | null,
    file: string,
  ): string {
    return `${code}:${projectId}:${jobId ?? ''}:${file}`.slice(0, 400);
  }
}

const GENERIC_VERSION_SUMMARIES = new Set([
  'application updated',
  'application updated.',
  'game updated',
  'game updated.',
  'app generated',
  'app modified',
  'generated',
  'modified',
  'copied',
  'completed',
  'done',
]);

/**
 * Prefer a meaningful recorded summary. Model terminal text often says only
 * "Application updated."; fall back to the user's bounded request instead of
 * inventing a description or promoting model prose into memory.
 */
function versionSummary(job: ForgeJob): string {
  const clean = (value: string | null | undefined): string =>
    (value ?? '').trim().replace(/\s+/g, ' ');
  const candidate = clean(job.summary);
  if (candidate.length > 0 && !GENERIC_VERSION_SUMMARIES.has(candidate.toLowerCase())) {
    return candidate.slice(0, 500);
  }
  const request = clean(job.request ?? job.prompt);
  return (request.length > 0 ? request : 'First approved version').slice(0, 500);
}

function quotaFailure(job: ForgeJob): boolean {
  const text = job.logs.slice(-30).join(' ');
  return /quota|429|rate.?limit|usage window/i.test(text);
}

function addUsage(a: ForgeUsage | null, b: ForgeUsage | undefined): ForgeUsage | null {
  if (!a && !b) return null;
  return {
    calls: (a?.calls ?? 0) + (b?.calls ?? 0),
    input_tokens: (a?.input_tokens ?? 0) + (b?.input_tokens ?? 0),
    output_tokens: (a?.output_tokens ?? 0) + (b?.output_tokens ?? 0),
    runtime_ms: (a?.runtime_ms ?? 0) + (b?.runtime_ms ?? 0),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
