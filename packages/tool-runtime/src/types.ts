import type { DatabaseSync } from 'node:sqlite';
import type { MemoryEngine } from '@mml/memory-engine';
import type { ToolInfo, ToolSideEffect } from '@mml/shared';
import type { ZodType } from 'zod';

/**
 * Tool contracts.
 *
 * A tool declares its side-effect class and whether confirmation is required.
 * The runtime — not the model — enforces both.
 */

export interface ToolContext {
  db: DatabaseSync;
  memory: MemoryEngine;
  /** Session the call belongs to; recorded for audit. */
  sessionId: string;
  /** Project scope for every call. Never supplied by the model. */
  projectId: string | null;
  now: () => Date;
}

export interface ToolDefinition<Input = unknown, Output = unknown> {
  id: string;
  description: string;
  sideEffect: ToolSideEffect;
  /** True when a human must approve before execution. */
  requiresConfirmation: boolean;
  input: ZodType<Input>;
  output: ZodType<Output>;
  execute: (input: Input, context: ToolContext) => Output | Promise<Output>;
}

export type AnyToolDefinition = ToolDefinition<never, never>;

export interface ToolInvocation {
  status: 'executed' | 'failed' | 'invalid';
  output?: unknown;
  error?: string;
  issues?: { path: string; message: string }[];
  durationMs: number;
}

/** Helper that preserves argument typing at the definition site. */
export function defineTool<Input, Output>(
  tool: ToolDefinition<Input, Output>,
): ToolDefinition<Input, Output> {
  return tool;
}

export type { ToolInfo };
