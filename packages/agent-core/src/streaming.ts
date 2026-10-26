import type { ServerResponse } from 'node:http';
import type {
  CapturedMemory,
  RetrievalMetadata,
  RetrievedMemory,
  TokenUsage,
  ToolCall,
  TurnEvent,
  TurnResult,
} from '@mml/shared';
import type { AgentError } from './errors.js';

/**
 * Streaming event handling.
 *
 * The runtime emits events; it does not know how they are transported. That
 * keeps the turn lifecycle testable with a collecting handler and lets the HTTP
 * layer own SSE framing and socket teardown.
 */
export interface StreamingEventHandler {
  retrieval(metadata: RetrievalMetadata, results: RetrievedMemory[]): void | Promise<void>;
  memoryCaptured(captures: CapturedMemory[]): void | Promise<void>;
  /** Optional so simple handlers and tests do not have to implement it. */
  toolCall?(calls: ToolCall[]): void | Promise<void>;
  delta(text: string): void | Promise<void>;
  usage(usage: TokenUsage): void | Promise<void>;
  completed(turn: TurnResult): void | Promise<void>;
  error(error: AgentError): void | Promise<void>;
}

/** Collects events for tests and for the non-streaming JSON response path. */
export class CollectingHandler implements StreamingEventHandler {
  readonly events: TurnEvent[] = [];

  retrieval(metadata: RetrievalMetadata, results: RetrievedMemory[]): void {
    this.events.push({ type: 'retrieval', metadata, results });
  }

  memoryCaptured(captures: CapturedMemory[]): void {
    this.events.push({ type: 'memory_captured', captures });
  }

  delta(text: string): void {
    this.events.push({ type: 'delta', text });
  }

  toolCall(calls: ToolCall[]): void {
    this.events.push({ type: 'tool_call', calls });
  }

  usage(usage: TokenUsage): void {
    this.events.push({ type: 'usage', usage });
  }

  completed(turn: TurnResult): void {
    this.events.push({ type: 'completed', turn });
  }

  error(error: AgentError): void {
    this.events.push({
      type: 'error',
      code: error.code,
      message: error.message,
      session_id: typeof error.details.session_id === 'string' ? error.details.session_id : null,
    });
  }

  text(): string {
    return this.events
      .filter((event) => event.type === 'delta')
      .map((event) => (event.type === 'delta' ? event.text : ''))
      .join('');
  }
}

/**
 * Server-Sent Events transport.
 *
 * Writes are defensive: once the client disconnects, every write fails, and a
 * turn must not be derailed by an EPIPE while it is being cancelled.
 */
export class SseStreamHandler implements StreamingEventHandler {
  private readonly raw: ServerResponse;
  private closed = false;

  constructor(raw: ServerResponse) {
    this.raw = raw;
    this.raw.on('close', () => {
      this.closed = true;
    });
  }

  get isClosed(): boolean {
    return this.closed || this.raw.writableEnded;
  }

  private send(type: string, payload: unknown): void {
    if (this.isClosed) return;
    try {
      this.raw.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      this.closed = true;
    }
  }

  retrieval(metadata: RetrievalMetadata, results: RetrievedMemory[]): void {
    this.send('retrieval', { metadata, results });
  }

  memoryCaptured(captures: CapturedMemory[]): void {
    this.send('memory_captured', { captures });
  }

  delta(text: string): void {
    this.send('delta', { text });
  }

  toolCall(calls: ToolCall[]): void {
    this.send('tool_call', { calls });
  }

  usage(usage: TokenUsage): void {
    this.send('usage', { usage });
  }

  completed(turn: TurnResult): void {
    this.send('completed', { turn });
  }

  error(error: AgentError): void {
    this.send('error', { code: error.code, message: error.message, details: error.details });
  }

  close(): void {
    if (this.isClosed) return;
    try {
      this.raw.end();
    } catch {
      // Socket already gone.
    }
  }
}
