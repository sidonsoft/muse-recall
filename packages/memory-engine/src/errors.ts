/**
 * Domain errors for the memory engine.
 *
 * Codes are stable and machine-readable; messages are for humans. The HTTP
 * layer maps codes to statuses without parsing prose.
 */
export type MemoryErrorCode =
  | 'memory_not_found'
  | 'memory_conflict'
  | 'memory_invalid'
  | 'memory_storage_failed';

export class MemoryError extends Error {
  readonly code: MemoryErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: MemoryErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'MemoryError';
    this.code = code;
    this.details = details;
  }

  static isMemoryError(value: unknown): value is MemoryError {
    return value instanceof MemoryError;
  }
}

export class MemoryNotFoundError extends MemoryError {
  constructor(id: string) {
    super('memory_not_found', `No memory with id ${id}.`, { id });
    this.name = 'MemoryNotFoundError';
  }
}

/**
 * A request that is structurally valid but conflicts with current state —
 * for example superseding a memory that is already superseded, or editing a
 * memory into a duplicate of another active record.
 */
export class MemoryConflictError extends MemoryError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('memory_conflict', message, details);
    this.name = 'MemoryConflictError';
  }
}
