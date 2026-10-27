import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MemoryEngine } from '@mml/memory-engine';
import {
  type ForgeJob,
  type ForgeJobKind,
  ForgeJobSchema,
  type ForgeJobStatus,
  type ForgeState,
  type ForgeUsage,
  type ForgeValidation,
} from '@mml/shared';
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

    const query =
      input.kind === 'modify' ? `${input.prompt}\n${input.request ?? ''}` : input.prompt;
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
    return this.workspace.diffStaged(job.project_id, job.id);
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
  ): Promise<void> {
    const execState = this.state.get(job.id);
    if (!execState) return;

    const prompt = buildPrompt(job, memoryBlock);
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
    for (const image of images) args.push('--image', image);

    this.update(job, { status: 'running', started_at: this.now().toISOString() });
    const startedAt = Date.now();

    const child = spawn(this.museBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(this.env ? { env: { ...process.env, ...this.env } } : {}),
    });
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
        if (code !== 0 || execState.terminal === 'failed') {
          await this.finish(job, {
            ...base,
            status: 'failed',
            error: execState.terminalText ?? `Muse exited with code ${String(code)}.`,
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

        await this.finish(job, {
          ...base,
          status: 'succeeded',
          summary: execState.terminalText?.slice(0, 2_000) ?? 'Game updated.',
          validation,
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
    const logs = [...job.logs, trimmed.slice(0, 2_000)].slice(-MAX_LOGS);
    this.update(job, { logs });
  }

  private update(job: ForgeJob, patch: Partial<ForgeJob>): void {
    const next = { ...job, ...patch };
    this.jobs.set(job.id, next);
    Object.assign(job, next);
    void this.persist(next);
  }

  private async finish(
    job: ForgeJob,
    patch: {
      status: ForgeJobStatus;
      error?: string | null;
      summary?: string | null;
      validation?: ForgeValidation;
      usage?: ForgeUsage;
      finished_at?: string;
    },
  ): Promise<void> {
    this.cancelled.delete(job.id);
    this.update(job, {
      status: patch.status,
      error: patch.error ?? null,
      summary: patch.summary ?? job.summary,
      validation: patch.validation ?? job.validation,
      usage: patch.usage ?? job.usage,
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

function buildPrompt(job: ForgeJob, memoryBlock: string): string {
  const memory = memoryBlock
    ? `\nProject design decisions from previous sessions (authoritative unless contradicted):\n${memoryBlock}\n`
    : '';
  if (job.kind === 'generate') {
    return [
      'Create a playable browser game in this workspace.',
      'Write exactly one file: index.html. Use Phaser 3 from https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js.',
      'It must be a complete single-file game: canvas, start/restart, mouse and touch input, score or progress, a win condition, responsive scaling, and readable text.',
      'Do not add other files, do not use a build step, and do not load assets from the network other than Phaser.',
      'After writing, run node --check on the inline script and fix any syntax error.',
      memory,
      'Game description:',
      job.prompt,
    ].join('\n');
  }
  return [
    'The current approved game is already in this workspace at index.html.',
    'Edit that file in place: keep every part of the existing implementation that the request does not ask you to change.',
    'Modify index.html only; do not regenerate the game from scratch.',
    'The attached screenshot is the current rendered preview. Use it to understand the visual result.',
    'Apply the requested visual change while preserving gameplay: cards, matching, score, restart, win condition, mouse/touch, and responsive layout.',
    'Keep the existing Phaser 3 CDN and Phaser.Game initialisation. Do not replace the engine with vanilla JavaScript and do not add libraries.',
    'Do not add other files or dependencies. After editing, run node --check on the inline script.',
    memory,
    'Requested change:',
    job.request ?? job.prompt,
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
