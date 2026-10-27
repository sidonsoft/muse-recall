import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoryEngine } from '@mml/memory-engine';
import {
  type DecisionGuardAdvisory,
  type ForgeJob,
  type ForgeJobKind,
  ForgeJobSchema,
  type ForgeJobStatus,
  type ForgeState,
  type ForgeUsage,
  type ForgeValidation,
  type Memory,
  redactSecrets,
} from '@mml/shared';
import { evaluateDecisionGuardAdvisory } from './decision-guard.js';
import { buildForgePrompt, buildRetrievalQuery } from './prompt.js';
import { checkGameRuntime } from './runtime-check.js';
import { ForgeError, type ForgeWorkspace } from './workspace.js';

/**
 * Runs one Muse job against a staging copy.
 *
 * Budgets are enforced on what is measurable: wall-clock runtime and observed
 * model calls are hard stops; tokens are reported but cannot be capped inside
 * the CLI, so they are labelled observational.
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
  runtimeCheck?: (html: string) => Promise<{ ok: boolean; errors: string[] }>;
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
  private readonly runtimeCheck: (html: string) => Promise<{ ok: boolean; errors: string[] }>;
  private readonly now: () => Date;
  private readonly jobs = new Map<string, ForgeJob>();
  private readonly state = new Map<string, ExecuteState>();
  private readonly cancelled = new Set<string>();
  private readonly locks = new Map<string, Promise<unknown>>();

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
  }

  list(projectId: string): ForgeJob[] {
    return [...this.jobs.values()]
      .filter((job) => job.project_id === projectId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  get(jobId: string): ForgeJob | undefined {
    return this.jobs.get(jobId);
  }

  async start(input: StartJobInput): Promise<ForgeJob> {
    await this.workspace.ensureProject(input.projectId);
    const active = this.list(input.projectId).filter(
      (job) => job.status === 'queued' || job.status === 'running',
    ).length;
    if (active >= 2) {
      throw new ForgeError('too_many_jobs', 'Two jobs are already running for this project.');
    }
    const id = randomUUID();
    const staging = await this.workspace.createStaging(input.projectId, id);

    // A modification must start from the approved source. An empty workspace
    // makes the model regenerate the game instead of editing it.
    let baseVersion: number | null = null;
    if (input.kind === 'modify') {
      const state = await this.workspace.state(input.projectId);
      if (state.current_version === null) {
        throw new ForgeError(
          'no_current_version',
          'Generate and approve a game before requesting a modification.',
        );
      }
      const current = await this.workspace.currentHtml(input.projectId);
      if (current === null) {
        throw new ForgeError('no_current_version', 'The approved game could not be read.');
      }
      baseVersion = state.current_version;
      await writeFile(join(staging, 'index.html'), current, 'utf8');
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
        budget: { max_memories: 6, max_characters: 3_000 },
      },
      { now: this.now() },
    );
    const memoryIds = retrieval.results.map((result) => result.memory.id);
    const memoryBlock =
      retrieval.results.length > 0
        ? retrieval.results.map((result) => `- ${result.injected_content}`).join('\n')
        : '';

    const job = ForgeJobSchema.parse({
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

    this.jobs.set(id, job);
    await this.persist(job);
    this.state.set(id, {
      child: null,
      timedOut: false,
      terminal: null,
      terminalText: null,
      usage: { calls: 0, input_tokens: 0, output_tokens: 0, runtime_ms: 0 },
    });

    const images: string[] = [];
    if (input.screenshot && input.kind === 'modify') {
      const imagePath = join(staging, 'preview.png');
      await writeFile(imagePath, input.screenshot);
      images.push(imagePath);
    }

    void this.execute(job, staging, memoryBlock, images).catch((error: unknown) => {
      void this.finish(job, { status: 'failed', error: (error as Error).message });
    });
    return job;
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
          `The approved game is v${String(state.current_version)}, but this change was staged from v${String(current.base_version)}. Regenerate it.`,
        );
      }

      // Server-side runtime verification: a structurally valid game can still
      // throw on load. Nothing is promoted until it renders cleanly.
      const stagedHtml = await this.workspace.stagedHtml(current.project_id, current.id);
      const runtime = stagedHtml
        ? await this.runtimeCheck(stagedHtml)
        : { ok: false, errors: ['The staged game is missing.'] };
      if (!runtime.ok) {
        const failed = ForgeJobSchema.parse({
          ...current,
          status: 'failed',
          error: 'Runtime verification failed.',
          validation: { ok: false, issues: runtime.errors },
          finished_at: this.now().toISOString(),
        });
        this.jobs.set(current.id, failed);
        await this.persist(failed);
        throw new ForgeError(
          'runtime_failed',
          'The staged game failed runtime verification.',
          runtime.errors,
        );
      }

      // Decision Guard (Phase 12C) runs only after the blocking runtime check
      // passed. It records a fresh advisory snapshot for the reviewed source;
      // it can neither change `validation` nor stop the promotion below.
      const decisionGuard = stagedHtml ? this.advisory(current, stagedHtml, true) : null;
      if (decisionGuard) {
        current.decision_guard = decisionGuard;
        await this.persist(current);
      }

      const summary = current.summary ?? current.request ?? current.prompt;
      const promoted = await this.workspace.promote(current.project_id, current.id, summary, {
        baseVersion: current.base_version,
        jobId: current.id,
      });

      const approved = ForgeJobSchema.parse({
        ...current,
        status: 'succeeded',
        version: promoted.version,
        finished_at: this.now().toISOString(),
      });
      this.jobs.set(current.id, approved);
      await this.persist(approved);

      if (options.captureMemory) {
        this.engine.create({
          type: 'technical_decision',
          scope: 'project',
          project_id: current.project_id,
          content: (options.decision ?? summary).slice(0, 1_000),
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
    if (job.status !== 'succeeded' || job.version !== null) {
      throw new ForgeError(
        'invalid_job_state',
        'Only a succeeded, unapplied change can be rejected.',
      );
    }
    await this.workspace.reject(job.project_id, job.id);
    const rejected = ForgeJobSchema.parse({
      ...job,
      status: 'rejected',
      finished_at: this.now().toISOString(),
    });
    this.jobs.set(job.id, rejected);
    await this.persist(rejected);
    return rejected;
  }

  private requireJob(jobId: string): ForgeJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new ForgeError('invalid_job_id', 'Unknown job.');
    return job;
  }

  private async execute(
    job: ForgeJob,
    staging: string,
    memoryBlock: string,
    images: string[],
    attempt: 'primary' | 'fallback' = 'primary',
  ): Promise<void> {
    const execState = this.state.get(job.id);
    if (!execState) return;

    const prompt = buildForgePrompt({
      kind: job.kind,
      prompt: job.prompt,
      request: job.request,
      memoryBlock,
    });
    this.update(job, { prompt_sha256: createHash('sha256').update(prompt).digest('hex') });
    const promptPath = join(staging, 'prompt.txt');
    await writeFile(promptPath, prompt, 'utf8');

    const args = [
      'exec',
      '--json',
      '--workspace',
      staging,
      '--prompt-file',
      promptPath,
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
      stdio: [apiKey ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      ...(this.env ? { env: { ...process.env, ...this.env } } : {}),
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
      void this.finish(job, {
        status: 'failed',
        error: `Could not start Muse: ${error.message}`,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const runtime = Date.now() - startedAt;
      execState.usage = { ...execState.usage, runtime_ms: runtime };
      const cancelled = this.cancelled.has(job.id);
      const base = { usage: execState.usage, finished_at: this.now().toISOString() };

      void (async () => {
        if (cancelled) {
          await this.finish(job, { ...base, status: 'cancelled' });
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
          this.carry.set(
            job.id,
            addUsage(execState.usage, this.carry.get(job.id)) ?? execState.usage,
          );
          this.log(
            job,
            `Subscription quota exhausted; retrying with ${this.fallbackModel ?? 'the API key'}.`,
          );
          await this.resetStaging(job, staging);
          await this.execute(job, staging, memoryBlock, images, 'fallback');
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
            error: 'Generated game failed validation.',
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
          summary: execState.terminalText?.slice(0, 2_000) ?? 'Game updated.',
          validation,
          ...(decisionGuard ? { decision_guard: decisionGuard } : {}),
        });
      })();
    });
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

  private update(job: ForgeJob, patch: Partial<ForgeJob>): void {
    const next = { ...job, ...patch };
    this.jobs.set(job.id, next);
    Object.assign(job, next);
    void this.persist(next);
  }

  private async resetStaging(job: ForgeJob, staging: string): Promise<void> {
    if (job.kind === 'modify') {
      const current = await this.workspace.currentHtml(job.project_id);
      if (current !== null) await writeFile(join(staging, 'index.html'), current, 'utf8');
    } else {
      const file = join(staging, 'index.html');
      await writeFile(file, '', 'utf8');
    }
  }

  private sanitize(text: string): string {
    return redactSecrets(text, { secrets: [this.apiKey, this.fallbackApiKey] });
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
    });
  }

  private async finish(
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
    this.cancelled.delete(job.id);
    const carried = this.carry.get(job.id);
    this.carry.delete(job.id);
    this.update(job, {
      status: patch.status,
      error: patch.error ? this.sanitize(patch.error) : null,
      summary: patch.summary ? this.sanitize(patch.summary) : job.summary,
      validation: patch.validation ?? job.validation,
      decision_guard: patch.decision_guard ?? job.decision_guard,
      usage: carried ? addUsage(patch.usage ?? job.usage, carried) : (patch.usage ?? job.usage),
      finished_at: patch.finished_at ?? this.now().toISOString(),
    });
    this.state.delete(job.id);
  }

  private async persist(job: ForgeJob): Promise<void> {
    try {
      const dir = join(this.workspace.projectDir(job.project_id), 'jobs');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${job.id}.json`), `${JSON.stringify(job, null, 2)}\n`, 'utf8');
    } catch {
      // Persistence is best-effort; in-memory state remains authoritative.
    }
  }
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
