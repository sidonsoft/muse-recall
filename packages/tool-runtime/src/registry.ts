import type { ToolInfo } from '@mml/shared';
import { z } from 'zod';
import type { AnyToolDefinition, ToolContext, ToolDefinition, ToolInvocation } from './types.js';

/**
 * Tool registry.
 *
 * Registration is typed; invocation is validated twice — arguments against the
 * tool's input schema, and the tool's own output against its output schema. A
 * tool that returns the wrong shape is a bug, and the audit record says so.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();

  register<Input, Output>(tool: ToolDefinition<Input, Output>): this {
    if (this.tools.has(tool.id)) {
      throw new Error(`duplicate tool id: ${tool.id}`);
    }
    this.tools.set(tool.id, tool as unknown as AnyToolDefinition);
    return this;
  }

  get(id: string): AnyToolDefinition | undefined {
    return this.tools.get(id);
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  ids(): string[] {
    return [...this.tools.keys()].sort();
  }

  list(): ToolInfo[] {
    return [...this.tools.values()]
      .map((tool) => ({
        id: tool.id,
        description: tool.description,
        side_effect: tool.sideEffect,
        requires_confirmation: tool.requiresConfirmation,
        input_schema: toJsonSchema(tool),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async invoke(id: string, rawArguments: unknown, context: ToolContext): Promise<ToolInvocation> {
    const tool = this.tools.get(id);
    const startedAt = performance.now();

    if (!tool) {
      return {
        status: 'invalid',
        error: `Unknown tool "${id}".`,
        durationMs: Math.round(performance.now() - startedAt),
      };
    }

    const parsed = tool.input.safeParse(rawArguments);
    if (!parsed.success) {
      return {
        status: 'invalid',
        error: 'Arguments did not match the tool schema.',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
        durationMs: Math.round(performance.now() - startedAt),
      };
    }

    try {
      const output = await tool.execute(parsed.data as never, context);
      const checked = tool.output.safeParse(output);
      if (!checked.success) {
        return {
          status: 'failed',
          error: 'Tool returned a value that did not match its output schema.',
          durationMs: Math.round(performance.now() - startedAt),
        };
      }
      return {
        status: 'executed',
        output: checked.data,
        durationMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Math.round(performance.now() - startedAt),
      };
    }
  }
}

/** JSON Schema for the model, when zod can produce one. */
function toJsonSchema(tool: AnyToolDefinition): Record<string, unknown> {
  try {
    return z.toJSONSchema(tool.input as z.ZodType, { io: 'input' }) as Record<string, unknown>;
  } catch {
    return { type: 'object' };
  }
}
