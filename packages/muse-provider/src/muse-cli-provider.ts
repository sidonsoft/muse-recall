import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  buildChildEnv,
  type ModelCallOptions,
  type ModelCapabilities,
  type ModelEvent,
  type ModelMessage,
  type ModelProvider,
  type ModelRequest,
  ModelRequestSchema,
  type ModelResponse,
  ModelResponseSchema,
  redactSecrets,
  type StopReason,
  type TokenUsage,
} from '@mml/shared';
import { z } from 'zod';
import { ProviderError } from './errors.js';

/** Models reported by `muse model-profile` / the Muse provider catalog. */
export const MUSE_MODELS = ['muse-wonder-1.0', 'muse-spark-1.3', 'muse-spark-1.2'] as const;
export const MUSE_DEFAULT_MODEL = 'muse-wonder-1.0';
export const MUSE_DEFAULT_REASONING_EFFORT = 'medium';

/** The Muse CLI exposes no output-token flag; bound its stream by characters. */
const OUTPUT_CHARS_PER_TOKEN = 4;

export const MUSE_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const;
export type MuseReasoningEffort = (typeof MUSE_REASONING_EFFORTS)[number];

/** Context window reported by the Muse provider catalog (1,007,997 tokens). */
const MUSE_CONTEXT_TOKENS = 1_007_997;

export interface MuseCliProviderOptions {
  /** Path to the Muse CLI binary. Defaults to `muse` on PATH. */
  bin?: string;
  /** Model id. Unknown ids fall back to the provider default (see docs). */
  model?: string;
  reasoningEffort?: MuseReasoningEffort;
  /** Wall-clock budget for one invocation. */
  timeoutMs?: number;
  /** Muse preset. `empty` yields a bare model with no built-in tools. */
  preset?: string;
  cwd?: string;
  /** Extra environment for the child process. */
  env?: Record<string, string>;
  /** Meta Model API key delivered over stdin; never placed in argv or env. */
  apiKey?: string;
  /** Meta Model API key used only when the subscription reports quota exhaustion. */
  fallbackApiKey?: string;
  /** Model id for the fallback attempt. */
  fallbackModel?: string;
  /** Extra CLI arguments appended verbatim (escape hatch, used by tests). */
  extraArgs?: string[];
}

/**
 * Model provider backed by the official Muse Code CLI (`muse exec --json`).
 *
 * Verified against Muse Code 1.4.13 — see docs/muse-integration.md.
 *
 * The CLI is a *stateless text protocol*: one process per call, no tool loop,
 * no provider-side session. That is a deliberate boundary. The agent harness
 * owns conversation state, tool execution, and authorization, so no
 * model-generated instruction is ever executed without passing through our
 * own permission layer.
 *
 * Each invocation is made hermetic with these flags:
 *   --preset empty                  no built-in tools to confuse the protocol
 *   --no-foreign-personal-context   don't load the developer's private rules
 *   --no-session-log                the CLI must not persist a second history
 *   --disable-web-tools             no network reach from the child
 *   --disable-reminders             no background reminder sub-agents
 *   --disable-request-user-input    the model cannot block on a human
 */
export class MuseCliProvider implements ModelProvider {
  readonly id = 'muse-cli';
  readonly name = 'Meta Muse (Muse Code CLI)';

  private readonly bin: string;
  private readonly model: string;
  private readonly reasoningEffort: MuseReasoningEffort;
  private readonly timeoutMs: number;
  private readonly preset: string;
  private readonly cwd: string;
  private readonly env: Record<string, string>;
  private readonly apiKey: string | undefined;
  private readonly extraArgs: string[];
  private readonly fallbackApiKey: string | undefined;
  private readonly fallbackModel: string | undefined;

  constructor(options: MuseCliProviderOptions = {}) {
    this.bin = options.bin ?? 'muse';
    this.model = options.model ?? MUSE_DEFAULT_MODEL;
    this.reasoningEffort = options.reasoningEffort ?? MUSE_DEFAULT_REASONING_EFFORT;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.preset = options.preset ?? 'empty';
    this.cwd = options.cwd ?? process.cwd();
    this.env = options.env ?? {};
    this.apiKey = options.apiKey;
    this.extraArgs = options.extraArgs ?? [];
    this.fallbackApiKey = options.fallbackApiKey;
    this.fallbackModel = options.fallbackModel ?? 'muse-spark-1.3-contributor';
  }

  capabilities(): ModelCapabilities {
    return {
      streaming: true,
      tool_calling: false,
      structured_output: true,
      provider_sessions: false,
      max_context_tokens: MUSE_CONTEXT_TOKENS,
      models: [...MUSE_MODELS],
      notes: [
        'One headless process per request; the harness owns conversation state.',
        'Native tool calling is not exposed over the CLI adapter; the harness runs the tool loop.',
        'Temperature is not settable through the CLI and is ignored.',
        'Unknown model ids are accepted by the CLI and fall back to its default model.',
        'Usage is reported per run, but may be empty when allowance refresh fails.',
        'max_output_tokens is enforced by this adapter as a character budget (~4 chars/token); the CLI has no output-token flag.',
      ],
    };
  }

  /** Convenience wrapper used by the health check to prove a live round-trip. */
  async generate(request: ModelRequest, options: ModelCallOptions = {}): Promise<ModelResponse> {
    let text = '';
    let model = this.model;
    let stopReason: StopReason = 'completed';
    let usage: TokenUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cached_input_tokens: 0,
      reasoning_tokens: 0,
    };
    let latencyMs = 0;
    let completed = false;

    for await (const event of this.stream(request, options)) {
      switch (event.type) {
        case 'text_delta':
          text += event.text;
          break;
        case 'usage':
          usage = event.usage;
          break;
        case 'completed':
          completed = true;
          text = event.text;
          model = event.model;
          stopReason = event.stop_reason;
          latencyMs = event.latency_ms;
          break;
        case 'error':
          throw new ProviderError(event.code, event.message);
        default:
          break;
      }
    }

    if (!completed) {
      throw new ProviderError(
        'provider_crashed',
        'Muse run ended without a terminal event; the output protocol may have changed.',
        { text_length: text.length },
      );
    }

    return ModelResponseSchema.parse({
      text,
      model,
      provider: this.id,
      stop_reason: stopReason,
      usage,
      latency_ms: latencyMs,
    });
  }

  async *stream(request: ModelRequest, options: ModelCallOptions = {}): AsyncIterable<ModelEvent> {
    // Quota failover: stream the primary attempt; if it fails before producing
    // any text because the subscription window is exhausted, retry once with
    // the API key. Events are not buffered, so streaming is unchanged.
    let emittedText = false;
    for await (const event of this.streamAttempt(request, false, options)) {
      if (event.type === 'text_delta' && event.text.trim().length > 0) emittedText = true;
      if (
        event.type === 'error' &&
        !emittedText &&
        this.fallbackApiKey &&
        /quota|429|rate.?limit|usage window/i.test(`${event.code} ${event.message}`)
      ) {
        yield* this.streamAttempt(request, true, options);
        return;
      }
      yield event;
    }
  }

  private async *streamAttempt(
    request: ModelRequest,
    fallback: boolean,
    options: ModelCallOptions,
  ): AsyncIterable<ModelEvent> {
    const parsed = ModelRequestSchema.safeParse(request);
    if (!parsed.success) {
      yield {
        type: 'error',
        code: 'invalid_request',
        message: `invalid model request: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      };
      return;
    }

    if (options.signal?.aborted) {
      yield {
        type: 'error',
        code: 'provider_cancelled',
        message: 'The Muse run was cancelled.',
      };
      return;
    }

    const startedAt = performance.now();
    const charBudget = parsed.data.max_output_tokens
      ? parsed.data.max_output_tokens * OUTPUT_CHARS_PER_TOKEN
      : undefined;
    let child: ChildProcess | undefined;
    let timedOut = false;
    let aborted = false;
    let truncated = false;
    let timer: NodeJS.Timeout | undefined;
    let tmpDir: string | undefined;
    let removeAbortListener: (() => void) | undefined;

    try {
      tmpDir = await mkdtemp(join(tmpdir(), 'mml-muse-'));
      const promptPath = join(tmpDir, 'prompt.md');
      await writeFile(promptPath, formatPrompt(parsed.data.messages), 'utf8');

      const apiKey = fallback ? this.fallbackApiKey : this.apiKey;
      const args = [
        'exec',
        '--json',
        '--no-session-log',
        '--no-foreign-personal-context',
        '--disable-web-tools',
        '--disable-reminders',
        '--disable-request-user-input',
        '--preset',
        this.preset,
        '--model',
        fallback
          ? (this.fallbackModel ?? parsed.data.model ?? this.model)
          : (parsed.data.model ?? this.model),
        '--reasoning-effort',
        this.reasoningEffort,
        '--prompt-file',
        promptPath,
      ];

      if (parsed.data.response_schema) {
        const schemaPath = join(tmpDir, 'schema.json');
        await writeFile(schemaPath, JSON.stringify(parsed.data.response_schema), 'utf8');
        args.push('--output-schema', schemaPath);
      }

      if (apiKey) args.push('--provider', 'meta', '--api-key-stdin');
      args.push(...this.extraArgs);

      child = spawn(this.bin, args, {
        cwd: this.cwd,
        env: buildChildEnv({ overrides: this.env }),
        stdio: [apiKey ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      });

      const proc = child;
      let spawnError: Error | null = null;
      proc.on('error', (error) => {
        spawnError = error;
      });

      // Abort is a hard stop: the caller is waiting for cancellation, so do not
      // let a wedged child keep the request (and its quota) alive.
      const onAbort = () => {
        aborted = true;
        proc.kill('SIGKILL');
      };
      if (options.signal) {
        options.signal.addEventListener('abort', onAbort, { once: true });
        removeAbortListener = () => options.signal?.removeEventListener('abort', onAbort);
        if (options.signal.aborted) onAbort();
      }

      if (apiKey && proc.stdin && !aborted) {
        proc.stdin.write(apiKey);
        proc.stdin.end();
      }

      let stderrTail = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-8_192);
      });

      timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
        // Escalate if the child ignores SIGTERM.
        setTimeout(() => proc.kill('SIGKILL'), 5_000).unref();
      }, this.timeoutMs);
      timer.unref();

      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => {
          proc.on('close', (code, signal) => resolve({ code, signal }));
        },
      );

      let assembled = '';
      let observedModel = parsed.data.model ?? this.model;
      let terminal: { terminal: string; text: string; reason: string | null } | null = null;
      let usage: TokenUsage | null = null;

      if (!proc.stdout) {
        throw new ProviderError('provider_crashed', 'muse produced no stdout stream');
      }

      const lines = createInterface({ input: proc.stdout, crlfDelay: Number.POSITIVE_INFINITY });
      for await (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;

        const frame = parseFrame(trimmed);
        if (!frame) continue;

        switch (frame.payload_type) {
          case 'run.output.delta': {
            const delta = RunOutputDelta.safeParse(frame.payload);
            if (!delta.success) break;

            const remaining =
              charBudget === undefined ? delta.data.text.length : charBudget - assembled.length;
            const accepted =
              remaining >= delta.data.text.length
                ? delta.data.text
                : delta.data.text.slice(0, Math.max(0, remaining));

            if (accepted.length > 0) {
              assembled += accepted;
              yield { type: 'text_delta', text: accepted };
            }

            if (accepted.length < delta.data.text.length) {
              // The CLI cannot be asked to stop at a token count, so enforce
              // the budget on the byte stream: stop reading and kill the child.
              truncated = true;
              proc.kill('SIGKILL');
              lines.close();
              break;
            }
            break;
          }
          case 'run.model.configured': {
            const configured = RunModelConfigured.safeParse(frame.payload);
            if (configured.success) observedModel = configured.data.model_id;
            break;
          }
          case 'run.usage': {
            const reported = RunUsage.safeParse(frame.payload);
            if (!reported.success) break;
            usage = sumUsage(reported.data.models);
            yield { type: 'usage', usage };
            break;
          }
          case 'run.terminal.completed':
          case 'run.terminal.failed':
          case 'run.terminal.cancelled': {
            const ended = RunTerminal.safeParse(frame.payload);
            if (ended.success) {
              terminal = {
                terminal: ended.data.terminal,
                text: ended.data.text,
                reason: ended.data.reason ?? null,
              };
            }
            break;
          }
          default:
            break;
        }

        if (truncated) break;
      }

      const exit = await exited;
      const latencyMs = Math.round(performance.now() - startedAt);

      if (aborted) {
        yield {
          type: 'error',
          code: 'provider_cancelled',
          message: 'The Muse run was cancelled.',
        };
        return;
      }

      if (timedOut) {
        yield {
          type: 'error',
          code: 'provider_timeout',
          message: `Muse did not finish within ${this.timeoutMs} ms and was terminated.`,
        };
        return;
      }

      if (spawnError) {
        yield {
          type: 'error',
          code: 'provider_unavailable',
          message: this.redact(
            `Could not start the Muse CLI ("${this.bin}"): ${(spawnError as Error).message}`,
          ),
        };
        return;
      }

      if (truncated) {
        yield {
          type: 'completed',
          text: assembled,
          model: observedModel,
          stop_reason: 'max_tokens',
          latency_ms: latencyMs,
        };
        return;
      }

      if (!terminal) {
        yield {
          type: 'error',
          code: 'provider_crashed',
          message: this.redact(
            `Muse exited (code ${exit.code ?? 'null'}, signal ${
              exit.signal ?? 'none'
            }) without a terminal event. Stderr: ${stderrTail.trim().slice(-800)}`,
          ),
        };
        return;
      }

      if (terminal.terminal !== 'completed') {
        const authHint = /credential_rejected|unauthori[sz]ed|401|403|api key/i.test(stderrTail);
        yield {
          type: 'error',
          code: authHint ? 'provider_auth_failed' : 'provider_crashed',
          message: this.redact(
            `Muse run ended as "${terminal.terminal}"${
              terminal.reason ? `: ${terminal.reason}` : ''
            }.${stderrTail.trim() ? ` Stderr: ${stderrTail.trim().slice(-800)}` : ''}`,
          ),
        };
        return;
      }

      // Prefer the terminal text (authoritative) but fall back to deltas.
      const rawText = terminal.text.length > 0 ? terminal.text : assembled;
      const text =
        charBudget !== undefined && rawText.length > charBudget
          ? rawText.slice(0, charBudget)
          : rawText;

      yield {
        type: 'completed',
        text,
        model: observedModel,
        stop_reason: text.length < rawText.length ? 'max_tokens' : 'completed',
        latency_ms: latencyMs,
      };
    } catch (error) {
      if (ProviderError.isProviderError(error)) {
        yield { type: 'error', code: error.code, message: this.redact(error.message) };
        return;
      }
      yield {
        type: 'error',
        code: 'provider_crashed',
        message: this.redact(
          `Unexpected Muse adapter failure: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      };
    } finally {
      removeAbortListener?.();
      if (timer) clearTimeout(timer);
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  /** Redact both credentials from every diagnostic this adapter emits. */
  private redact(text: string): string {
    return redactSecrets(text, { secrets: [this.apiKey, this.fallbackApiKey] });
  }
}

/**
 * Render a conversation as the single text prompt the CLI accepts.
 *
 * Preset `empty` gives us a bare model with no system-role channel, so role
 * boundaries are made explicit in the text. The prompt is written to a file
 * rather than passed as argv to stay clear of OS argument-length limits.
 */
export function formatPrompt(messages: ModelMessage[]): string {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content.trim());
  const turns = messages.filter((m) => m.role !== 'system');

  const parts: string[] = [];
  if (system.length > 0) {
    parts.push(`<instructions>\n${system.join('\n\n')}\n</instructions>`);
  }
  if (turns.length > 0) {
    const transcript = turns
      .map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content.trim()}`)
      .join('\n\n');
    parts.push(`<conversation>\n${transcript}\n</conversation>`);
  }
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Wire payload shapes we consume. Narrow on purpose: the full MSP schema is
// ~416 KB and versioned by the binary, so we validate only our fields and
// ignore everything else.
// ---------------------------------------------------------------------------

const FrameSchema = z.object({
  payload_type: z.string(),
  payload: z.unknown(),
});
type Frame = z.infer<typeof FrameSchema>;

function parseFrame(line: string): Frame | null {
  try {
    const parsed = FrameSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const RunOutputDelta = z.object({ text: z.string() });

const RunModelConfigured = z.object({ model_id: z.string() });

const RunUsage = z.object({
  models: z
    .array(
      z.object({
        model: z.string().optional(),
        input_tokens: z.number().int().min(0).default(0),
        output_tokens: z.number().int().min(0).default(0),
        cached_tokens: z.number().int().min(0).default(0),
        reasoning_tokens: z.number().int().min(0).default(0),
      }),
    )
    .default([]),
});

const RunTerminal = z.object({
  terminal: z.enum(['completed', 'failed', 'cancelled']),
  text: z.string().default(''),
  reason: z.string().nullable().optional(),
});

const EMPTY_USAGE: TokenUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cached_input_tokens: 0,
  reasoning_tokens: 0,
};

/** Sum usage across every model that participated in the run. */
function sumUsage(
  models: Array<{
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
    reasoning_tokens: number;
  }>,
): TokenUsage {
  if (models.length === 0) return EMPTY_USAGE;
  return models.reduce<TokenUsage>(
    (total, model) => ({
      input_tokens: total.input_tokens + model.input_tokens,
      output_tokens: total.output_tokens + model.output_tokens,
      cached_input_tokens: total.cached_input_tokens + model.cached_tokens,
      reasoning_tokens: total.reasoning_tokens + model.reasoning_tokens,
    }),
    { ...EMPTY_USAGE },
  );
}
