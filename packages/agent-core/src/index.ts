/**
 * @mml/agent-core — the conversational runtime.
 *
 *   agent-runtime.ts    sessions, active-turn registry, cancellation
 *   turn-processor.ts   one turn: capture → persist → retrieve → assemble → stream → persist
 *   context-assembler.ts bounded prompt construction with explicit sections
 *   session-store.ts    durable sessions, messages, and retrieval evidence
 *   memory-capture.ts   explicit "remember …" handling and candidate proposals
 *   streaming.ts        transport-agnostic event handling (SSE + collecting)
 */

export type { AgentRuntimeDependencies } from './agent-runtime.js';
export { AgentRuntime } from './agent-runtime.js';
export type { AgentConfig, AutoCaptureMode, ContextBudgets, ToolSettings } from './config.js';
export {
  DEFAULT_AGENT_CONFIG,
  DEFAULT_CONTEXT_BUDGETS,
  DEFAULT_SYSTEM_INSTRUCTIONS,
} from './config.js';
export type { AssembledContext, AssembleInput, CorrectionContext } from './context-assembler.js';
export { assembleContext } from './context-assembler.js';
export type { AgentErrorCode } from './errors.js';
export { AgentError } from './errors.js';
export type { ParsedMemoryCommand } from './memory-capture.js';
export {
  extractCandidates,
  inferMemoryType,
  isAnnouncementOnly,
  meaningfulTokens,
  parseMemoryCommand,
  selectSupersessionCandidate,
} from './memory-capture.js';
export type { AppendMessageInput, SessionStoreOptions, TurnMemoryInput } from './session-store.js';
export { SessionStore } from './session-store.js';
export type { StreamingEventHandler } from './streaming.js';
export { CollectingHandler, SseStreamHandler } from './streaming.js';
export { TurnProcessor, toAgentError } from './turn-processor.js';
