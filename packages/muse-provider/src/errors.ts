import type { ProviderErrorCode } from '@mml/shared';

/**
 * A provider failure with a stable machine-readable code.
 *
 * The code — not the message — drives retry policy, HTTP status mapping, and
 * what the UI shows. Messages are for humans and may change.
 */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ProviderErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.details = details;
  }

  static isProviderError(value: unknown): value is ProviderError {
    return value instanceof ProviderError;
  }
}
