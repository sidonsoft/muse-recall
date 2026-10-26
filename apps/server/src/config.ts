import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type AutoCaptureMode,
  type ContextBudgets,
  DEFAULT_CONTEXT_BUDGETS,
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

export const SERVICE_NAME = 'muse-memory-lab' as const;
export const SERVICE_VERSION = '0.1.0';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
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
  MUSE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(900_000).default(120_000),
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
});

export interface AppConfig {
  environment: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  corsOrigins: string[];
  databasePath: string;
  wal: boolean;
  workspaceRoot: string;
  toolApprovalPolicy: 'always' | 'never';
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

  return {
    environment: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    logLevel: value.LOG_LEVEL,
    corsOrigins: value.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    databasePath: resolve(cwd, value.DATABASE_PATH),
    wal: value.SQLITE_WAL,
    workspaceRoot: resolve(cwd, value.WORKSPACE_ROOT),
    toolApprovalPolicy: value.TOOL_APPROVAL_POLICY,
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
    },
    provider: {
      kind: value.MODEL_PROVIDER,
      museBin: value.MUSE_BIN,
      museModel: value.MUSE_MODEL,
      museReasoningEffort: value.MUSE_REASONING_EFFORT as MuseReasoningEffort,
      museTimeoutMs: value.MUSE_TIMEOUT_MS,
      cwd,
    },
    serviceVersion: SERVICE_VERSION,
  };
}

/**
 * Load a `.env` file when present.
 *
 * Uses Node's built-in loader (>= 20.12) so the project needs no dotenv
 * dependency. Absent files are not an error: the environment may already be
 * fully populated (CI, containers).
 */
export function loadDotEnv(cwd: string = process.cwd()): void {
  const candidate = resolve(cwd, '.env');
  if (!existsSync(candidate)) return;
  process.loadEnvFile(candidate);
}
