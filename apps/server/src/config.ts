import { existsSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';
import {
  type AutoCaptureMode,
  type ContextBudgets,
  DEFAULT_CONTEXT_BUDGETS,
  type ToolSettings,
} from '@mml/agent-core';
import {
  MUSE_DEFAULT_MODEL,
  MUSE_DEFAULT_REASONING_EFFORT,
  MUSE_REASONING_EFFORTS,
  type MuseReasoningEffort,
  PROVIDER_KINDS,
  type ProviderConfig,
} from '@mml/muse-provider';
import { DEFAULT_RETRIEVAL_BUDGET, type RetrievalBudget } from '@mml/shared';
import { z } from 'zod';
import { codespacesWebOrigins } from './codespaces.js';
import { isLoopbackBindHost } from './host-guard.js';

export const SERVICE_NAME = 'muse-memory-lab' as const;
export const SERVICE_VERSION = '0.1.0';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // No authentication exists by default, so the bind address IS the network
    // boundary — unless the operator sets ACCESS_TOKEN (gap G-6 groundwork),
    // the one configuration in which a non-loopback bind is defensible.
    HOST: z.string().min(1).default('127.0.0.1'),
    ACCESS_TOKEN: z
      .string()
      .min(16)
      .max(512)
      .optional()
      .describe('shared bearer secret; presence switches the trust model'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CORS_ORIGINS: z.string().default('http://127.0.0.1:5173,http://localhost:5173'),
    DATABASE_PATH: z.string().min(1).default('./data/muse-memory-lab.db'),
    SQLITE_WAL: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    MODEL_PROVIDER: z.enum(PROVIDER_KINDS).default('muse-cli'),
    MUSE_BIN: z.string().min(1).default('muse'),
    MUSE_MODEL: z.string().min(1).default(MUSE_DEFAULT_MODEL),
    MUSE_REASONING_EFFORT: z.enum(MUSE_REASONING_EFFORTS).default(MUSE_DEFAULT_REASONING_EFFORT),
    MUSE_FALLBACK_API_KEY: z.string().min(10).optional(),
    MUSE_FALLBACK_MODEL: z.string().min(2).default('muse-spark-1.3-contributor'),
    MUSE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(900_000).default(120_000),
    /** Optional Meta API key for chat; delivered to the CLI over stdin. */
    META_API_KEY: z.string().min(10).optional(),
    TOOL_APPROVAL_POLICY: z.enum(['always', 'never']).default('always'),
    WORKSPACE_ROOT: z.string().min(1).default('./workspaces'),
    MEMORY_MAX_MEMORIES: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(DEFAULT_RETRIEVAL_BUDGET.max_memories),
    MEMORY_MAX_CHARACTERS: z.coerce
      .number()
      .int()
      .min(200)
      .max(50_000)
      .default(DEFAULT_RETRIEVAL_BUDGET.max_characters),
    MEMORY_MAX_MEMORY_CHARACTERS: z.coerce
      .number()
      .int()
      .min(100)
      .max(8_000)
      .default(DEFAULT_RETRIEVAL_BUDGET.max_memory_characters),
    MEMORY_SWEEP_ON_START: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    CONTEXT_MAX_HISTORY_MESSAGES: z.coerce
      .number()
      .int()
      .min(0)
      .max(50)
      .default(DEFAULT_CONTEXT_BUDGETS.max_history_messages),
    CONTEXT_MAX_HISTORY_CHARACTERS: z.coerce
      .number()
      .int()
      .min(0)
      .max(200_000)
      .default(DEFAULT_CONTEXT_BUDGETS.max_history_characters),
    CONTEXT_MAX_PROMPT_CHARACTERS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(500_000)
      .default(DEFAULT_CONTEXT_BUDGETS.max_prompt_characters),
    CONTEXT_MAX_MESSAGE_CHARACTERS: z.coerce
      .number()
      .int()
      .min(100)
      .max(100_000)
      .default(DEFAULT_CONTEXT_BUDGETS.max_message_characters),
    CONTEXT_MAX_CORRECTION_HISTORY: z.coerce
      .number()
      .int()
      .min(0)
      .max(10)
      .default(DEFAULT_CONTEXT_BUDGETS.max_correction_history),
    AGENT_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(8_000).default(1_200),
    MEMORY_AUTO_CAPTURE: z.enum(['off', 'suggest']).default('suggest'),
    TOOLS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    TOOL_MAX_CALLS_PER_TURN: z.coerce.number().int().min(1).max(5).default(3),
    TOOL_DECISION_MODE: z.enum(['auto', 'always', 'off']).default('auto'),
    FORGE_MAX_RUNTIME_MS: z.coerce.number().int().min(10_000).max(1_800_000).default(600_000),
    FORGE_MAX_CALLS: z.coerce.number().int().min(1).max(100).default(25),
    FORGE_MAX_INPUT_TOKENS: z.coerce.number().int().min(10_000).max(10_000_000).default(1_500_000),
    FORGE_MUSE_BIN: z.string().min(1).optional(),
    FORGE_MUSE_API_KEY: z.string().min(10).optional(),
    FORGE_MUSE_MODEL: z.string().min(2).optional(),
    FORGE_FALLBACK_API_KEY: z.string().min(10).optional(),
    FORGE_FALLBACK_MODEL: z.string().min(2).default('muse-spark-1.3-contributor'),
    FORGE_REASONING_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
  })
  .superRefine((value, ctx) => {
    if (!isLoopbackBindHost(value.HOST) && !value.ACCESS_TOKEN) {
      ctx.addIssue({
        code: 'custom',
        path: ['HOST'],
        message:
          'must be a loopback address (127.0.0.1, ::1 or localhost) unless ACCESS_TOKEN is set; ' +
          'without authentication the API must not be exposed to a network',
      });
    }
  });

export interface AppConfig {
  environment: 'development' | 'test' | 'production';
  host: string;
  port: number;
  /** Shared bearer secret (gap G-6 groundwork); null/absent = loopback-only trust model. */
  accessToken?: string | null;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  corsOrigins: string[];
  databasePath: string;
  wal: boolean;
  workspaceRoot: string;
  toolApprovalPolicy: 'always' | 'never';
  forge?: {
    maxRuntimeMs: number;
    maxCalls: number;
    maxInputTokens: number;
    museBin: string | null;
    /** Meta Model API key; passed to the CLI over stdin, never logged. */
    apiKey: string | null;
    /** Model id used when an API key is configured. */
    model: string | null;
    /** Key used only when the subscription window is exhausted. */
    fallbackApiKey: string | null;
    fallbackModel: string | null;
    reasoningEffort: 'low' | 'medium' | 'high';
  };
  provider: ProviderConfig;
  /** Retrieval defaults applied when a request omits a budget. */
  memoryBudget: RetrievalBudget;
  /** Mark memories past their expiry as expired at startup. */
  sweepOnStart: boolean;
  /** Conversation context and capture configuration. */
  agent: {
    budgets: ContextBudgets;
    autoCapture: AutoCaptureMode;
    includeCorrectionHistory: boolean;
    maxOutputTokens: number;
    tools: ToolSettings;
  };
  serviceVersion: string;
}

/**
 * Resolve configuration from the environment.
 *
 * Failure is loud: a bad value stops startup with the exact variable named,
 * rather than letting the app run in a half-configured state that only shows
 * up mid-demo.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${problems}`);
  }
  const value = parsed.data;

  // The pnpm scripts start the server from `apps/server`, but the documented
  // `.env` and the data/workspace directories live at the checkout root. Anchor
  // relative paths there so the seed, the migrator and the server agree.
  const projectRoot = resolveProjectRoot(cwd, env);

  const configuredOrigins = value.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  // Inside a GitHub codespace, also trust the forwarded form of the local web
  // origins (see codespaces.ts); a no-op everywhere else.
  const corsOrigins = [...configuredOrigins, ...codespacesWebOrigins(configuredOrigins, env)];

  return {
    environment: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    accessToken: value.ACCESS_TOKEN ?? null,
    logLevel: value.LOG_LEVEL,
    corsOrigins,
    databasePath: resolve(projectRoot, value.DATABASE_PATH),
    wal: value.SQLITE_WAL,
    workspaceRoot: resolve(projectRoot, value.WORKSPACE_ROOT),
    toolApprovalPolicy: value.TOOL_APPROVAL_POLICY,
    forge: {
      maxRuntimeMs: value.FORGE_MAX_RUNTIME_MS,
      maxCalls: value.FORGE_MAX_CALLS,
      maxInputTokens: value.FORGE_MAX_INPUT_TOKENS,
      museBin: value.FORGE_MUSE_BIN ?? null,
      apiKey: value.FORGE_MUSE_API_KEY ?? null,
      model: value.FORGE_MUSE_MODEL ?? null,
      fallbackApiKey: value.FORGE_FALLBACK_API_KEY ?? null,
      fallbackModel: value.FORGE_FALLBACK_API_KEY ? value.FORGE_FALLBACK_MODEL : null,
      reasoningEffort: value.FORGE_REASONING_EFFORT,
    },
    memoryBudget: {
      max_memories: value.MEMORY_MAX_MEMORIES,
      max_characters: value.MEMORY_MAX_CHARACTERS,
      max_memory_characters: value.MEMORY_MAX_MEMORY_CHARACTERS,
    },
    sweepOnStart: value.MEMORY_SWEEP_ON_START,
    agent: {
      budgets: {
        max_history_messages: value.CONTEXT_MAX_HISTORY_MESSAGES,
        max_history_characters: value.CONTEXT_MAX_HISTORY_CHARACTERS,
        max_memory_characters: value.MEMORY_MAX_CHARACTERS,
        max_prompt_characters: value.CONTEXT_MAX_PROMPT_CHARACTERS,
        max_message_characters: value.CONTEXT_MAX_MESSAGE_CHARACTERS,
        max_correction_history: value.CONTEXT_MAX_CORRECTION_HISTORY,
      },
      autoCapture: value.MEMORY_AUTO_CAPTURE,
      includeCorrectionHistory: true,
      maxOutputTokens: value.AGENT_MAX_OUTPUT_TOKENS,
      tools: {
        enabled: value.TOOLS_ENABLED,
        approvalPolicy: value.TOOL_APPROVAL_POLICY,
        maxCallsPerTurn: value.TOOL_MAX_CALLS_PER_TURN,
        decisionMode: value.TOOL_DECISION_MODE,
      },
    },
    provider: {
      kind: value.MODEL_PROVIDER,
      museBin: value.MUSE_BIN,
      museModel: value.MUSE_MODEL,
      museReasoningEffort: value.MUSE_REASONING_EFFORT as MuseReasoningEffort,
      museTimeoutMs: value.MUSE_TIMEOUT_MS,
      cwd,
      ...(value.META_API_KEY ? { apiKey: value.META_API_KEY } : {}),
      ...(value.MUSE_FALLBACK_API_KEY
        ? {
            museFallbackApiKey: value.MUSE_FALLBACK_API_KEY,
            museFallbackModel: value.MUSE_FALLBACK_MODEL,
          }
        : {}),
    },
    serviceVersion: SERVICE_VERSION,
  };
}

/**
 * Locate the `.env` file this checkout should read.
 *
 * The documented setup copies `.env.example` to the repository root, but the
 * pnpm scripts run the server from `apps/server`. Resolving only against the
 * process working directory therefore ignored the documented file entirely and
 * silently fell back to defaults. Candidate order:
 *
 * 1. `MML_ENV_FILE`, an explicit path (relative to `cwd`); it must exist.
 * 2. `<checkout root>/.env` — the repository root, found by walking up from
 *    `cwd` (or pnpm's `INIT_CWD`) to the nearest directory containing
 *    `pnpm-workspace.yaml`.
 * 3. `<cwd>/.env` — a deliberately scoped `apps/server/.env`, kept as the
 *    fallback for anyone who prefers it.
 *
 * The walk stops at the filesystem root, so a stray `$HOME/.env` is never
 * picked up: only a directory that is actually this workspace qualifies.
 */
export function findEnvFile(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const explicit = env.MML_ENV_FILE?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    const candidate = resolve(cwd, explicit);
    if (!existsSync(candidate)) {
      throw new Error(`MML_ENV_FILE points at a file that does not exist: ${candidate}`);
    }
    return candidate;
  }

  const root = findWorkspaceRoot(cwd, env);
  const candidates = root === null ? [] : [resolve(root, '.env')];
  candidates.push(resolve(cwd, '.env'));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Nearest ancestor (inclusive) containing `pnpm-workspace.yaml`, if any. */
export function findWorkspaceRoot(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const starts = [cwd];
  const initCwd = env.INIT_CWD?.trim();
  if (initCwd !== undefined && initCwd.length > 0) starts.push(initCwd);

  for (const start of starts) {
    let current = resolve(start);
    for (;;) {
      if (existsSync(resolve(current, 'pnpm-workspace.yaml'))) return current;
      const parent = dirname(current);
      if (parent === current || current === parse(current).root) break;
      current = parent;
    }
  }
  return null;
}

/** Checkout root; falls back to `cwd` when no workspace marker is found. */
export function resolveProjectRoot(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  return findWorkspaceRoot(cwd, env) ?? resolve(cwd);
}

/**
 * Load a `.env` file when present.
 *
 * Uses Node's built-in loader (>= 20.12) so the project needs no dotenv
 * dependency. Absent files are not an error: the environment may already be
 * fully populated (CI, containers). Returns the path that was loaded so the
 * startup log can name it.
 */
export function loadDotEnv(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const candidate = findEnvFile(cwd, env);
  if (candidate === null) return null;
  process.loadEnvFile(candidate);
  return candidate;
}
