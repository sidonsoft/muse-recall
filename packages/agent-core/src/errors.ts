/**
 * Failure codes for the agent runtime.
 *
 * These are stable and machine-readable: the HTTP layer maps them to statuses,
 * and the SSE layer forwards them so a client can react without parsing prose.
 */
export type AgentErrorCode =
  | 'session_not_found'
  | 'session_archived'
  | 'session_busy'
  | 'context_overflow'
  | 'message_too_long'
  | 'turn_cancelled'
  | 'provider_failure'
  | 'invalid_request';

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: AgentErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.details = details;
  }

  static isAgentError(value: unknown): value is AgentError {
    return value instanceof AgentError;
  }
}
