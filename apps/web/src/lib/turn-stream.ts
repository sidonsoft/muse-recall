import type {
  CapturedMemory,
  RetrievalMetadata,
  RetrievedMemory,
  TokenUsage,
  TurnResult,
} from '@mml/shared';

/**
 * SSE client for a conversation turn.
 *
 * The browser has to read the stream frame by frame: `EventSource` cannot POST,
 * and a completed turn must be reconcilable with what was streamed. Errors are
 * surfaced as data (the server sends an `error` event) rather than thrown
 * mid-stream, so the UI can show the partial answer and the failure together.
 */

export interface TurnStreamHandlers {
  onRetrieval?: (metadata: RetrievalMetadata, results: RetrievedMemory[]) => void;
  onMemoryCaptured?: (captures: CapturedMemory[]) => void;
  onDelta?: (text: string) => void;
  onUsage?: (usage: TokenUsage) => void;
  onCompleted?: (turn: TurnResult) => void;
  onError?: (error: { code: string; message: string }) => void;
}

export class TurnStreamError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'TurnStreamError';
    this.code = code;
  }
}

interface Frame {
  event: string;
  data: unknown;
}

function parseFrame(block: string): Frame | null {
  const event = /^event:\s*(.+)$/m.exec(block)?.[1]?.trim();
  const data = /^data:\s*(.+)$/m.exec(block)?.[1];
  if (!event || !data) return null;
  try {
    return { event, data: JSON.parse(data) as unknown };
  } catch {
    return null;
  }
}

export async function streamTurn(
  sessionId: string,
  input: { content: string; capture_memories?: boolean },
  handlers: TurnStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(input),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    const body = (await response.text()) || '{}';
    let code = 'request_failed';
    let message = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: { code?: string; message?: string } };
      code = parsed.error?.code ?? code;
      message = parsed.error?.message ?? message;
    } catch {
      // Keep the status-based message.
    }
    throw new TurnStreamError(code, message);
  }

  if (!response.body) {
    throw new TurnStreamError('no_stream', 'The server returned no response body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const frame = parseFrame(block);
      if (frame) dispatch(frame, handlers);
      boundary = buffer.indexOf('\n\n');
    }
  }

  // A final frame without a trailing blank line.
  const trailing = parseFrame(buffer.trim());
  if (trailing) dispatch(trailing, handlers);
}

function dispatch(frame: Frame, handlers: TurnStreamHandlers): void {
  switch (frame.event) {
    case 'retrieval': {
      const data = frame.data as { metadata: RetrievalMetadata; results: RetrievedMemory[] };
      handlers.onRetrieval?.(data.metadata, data.results);
      break;
    }
    case 'memory_captured': {
      const data = frame.data as { captures: CapturedMemory[] };
      handlers.onMemoryCaptured?.(data.captures);
      break;
    }
    case 'delta': {
      const data = frame.data as { text: string };
      handlers.onDelta?.(data.text);
      break;
    }
    case 'usage': {
      const data = frame.data as { usage: TokenUsage };
      handlers.onUsage?.(data.usage);
      break;
    }
    case 'completed': {
      const data = frame.data as { turn: TurnResult };
      handlers.onCompleted?.(data.turn);
      break;
    }
    case 'error': {
      const data = frame.data as { code: string; message: string };
      handlers.onError?.({ code: data.code, message: data.message });
      break;
    }
    default:
      break;
  }
}
