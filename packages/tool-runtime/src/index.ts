/**
 * @mml/tool-runtime — typed, validated tools with an explicit authority model.
 *
 * The model may request calls; the runtime validates arguments, enforces
 * confirmation for writes, and records every decision in an audit log.
 */
export { ToolRegistry } from './registry.js';
export type { CreateToolCallInput } from './store.js';
export { ToolCallStore } from './store.js';
export { createDefaultToolRegistry } from './tools.js';
export type {
  AnyToolDefinition,
  ToolContext,
  ToolDefinition,
  ToolInvocation,
} from './types.js';
export { defineTool } from './types.js';
