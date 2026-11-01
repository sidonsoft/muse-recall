import { ProviderError } from '@mml/muse-provider';
import { redactSecrets } from '@mml/shared';

/**
 * Batch C — Server-Sent Events transport for the Responses streaming
 * contract. SAM segmentation is documented to stream (`stream: true`):
 * geometry arrives as `response.output_text.delta` events and the stream
 * ends with a terminal `response.completed` event carrying the full
 * response object. A non-streaming request may return HTTP 200 with an
 * empty lane even when the model has geometry — so the empty lane alone
 * cannot distinguish "no match" from "wrong contract".
 *
 * This module is dependency-free (no adapter imports): it parses SSE
 * incrementally and assembles a Responses stream into a text lane plus
 * the terminal response object. Failure semantics mirror the
 * non-streaming envelope parser: terminal failures throw
 * `provider_invalid_output`, a stream that ends without a terminal event
 * throws (never silently published as success), and unknown event types
 * are counted and ignored for forward compatibility.
 */

export interface SseEvent {
  /** Event name (`message` when the block sets none). */
  event: string;
  /** Joined `data:` lines (spec: joined with `\n`). */
  data: string;
}

export interface TextPart {
  kind: 'text';
  text: string;
}

export interface RefusalPart {
  kind: 'refusal';
  text: string;
}

/**
 * Walk output items and collect typed text/refusal parts (parsed, not
 * grepped). Shared by the buffered envelope path and the streaming
 * path, which applies it to the terminal `response.completed` object.
 */
export function collectOutputParts(output: unknown[]): {
  texts: TextPart[];
  refusals: RefusalPart[];
} {
  const texts: TextPart[] = [];
  const refusals: RefusalPart[] = [];
  for (const item of output) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const content: unknown = record.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part === null || typeof part !== 'object' || Array.isArray(part)) continue;
      const typed = part as { type?: unknown; text?: unknown; refusal?: unknown };
      if (typed.type === 'output_text' || typed.type === 'text') {
        if (typeof typed.text === 'string') texts.push({ kind: 'text', text: typed.text });
      } else if (typed.type === 'refusal') {
        const message =
          typeof typed.refusal === 'string'
            ? typed.refusal
            : typeof typed.text === 'string'
              ? typed.text
              : 'refused';
        refusals.push({ kind: 'refusal', text: message });
      }
    }
  }
  return { texts, refusals };
}

/** Terminal outcome of a Responses stream, decided by its terminal event. */
export type StreamTerminal = 'completed';

export interface AssembledStream {
  /** Concatenated `output_text` deltas, in arrival order. */
  lane: string;
  /** The terminal `response.completed` response object. */
  response: Record<string, unknown>;
  /** Total SSE events processed (terminal included). */
  events: number;
  /** `response.output_text.delta` events folded into the lane. */
  deltaEvents: number;
  /** Unknown event types ignored for forward compatibility. */
  ignoredEvents: number;
  /** Text parts carried by the terminal response object. */
  texts: TextPart[];
  /** Refusal parts carried by the terminal response object. */
  refusals: RefusalPart[];
}

/**
 * Incremental SSE parser (WHATWG event-stream shape). Chunks split
 * anywhere — mid-line, mid-field, even mid-multibyte — and are buffered
 * until a blank line dispatches the block. Comment-only blocks and empty
 * blocks produce no event. A trailing unterminated block is held, not
 * dispatched: only a blank line ends an event.
 */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    // A blank line dispatches; the final piece is an incomplete remainder.
    const parts = this.buffer.split(/\r\n\r\n|\n\n|\r\r/);
    this.buffer = parts.pop() ?? '';
    for (const part of parts) {
      const event = parseBlock(part);
      if (event !== null) events.push(event);
    }
    return events;
  }
}

function parseBlock(block: string): SseEvent | null {
  let event = '';
  const dataLines: string[] = [];
  let hasField = false;
  for (const rawLine of block.split(/\r\n|\n|\r/)) {
    if (rawLine.startsWith(':')) continue; // comment / keep-alive
    if (rawLine.length === 0) continue;
    const colon = rawLine.indexOf(':');
    let field: string;
    let value: string;
    if (colon === -1) {
      field = rawLine;
      value = '';
    } else {
      field = rawLine.slice(0, colon);
      // One optional leading space is part of the framing, not the value.
      value = rawLine.slice(colon + 1).startsWith(' ')
        ? rawLine.slice(colon + 2)
        : rawLine.slice(colon + 1);
    }
    if (field === 'event') {
      event = value;
      hasField = true;
    } else if (field === 'data') {
      dataLines.push(value);
      hasField = true;
    }
    // `id:` and `retry:` are transport hints, not stream content: ignored.
  }
  if (!hasField) return null;
  return { event: event.length > 0 ? event : 'message', data: dataLines.join('\n') };
}

function boundedRedacted(message: string, limit = 300): string {
  const redacted = redactSecrets(message);
  if (redacted.length <= limit) return redacted;
  return `${redacted.slice(0, Math.max(0, limit - 1))}…`.slice(0, limit);
}

function parseEventData(data: string, label: string, event: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new ProviderError(
      'provider_invalid_output',
      `${label} stream event ${event} carries non-JSON data.`,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProviderError(
      'provider_invalid_output',
      `${label} stream event ${event} carries a non-object payload.`,
    );
  }
  return parsed as Record<string, unknown>;
}

function terminalResponse(
  payload: Record<string, unknown>,
  label: string,
  event: string,
): Record<string, unknown> {
  const response: unknown = payload.response;
  if (response === null || typeof response !== 'object' || Array.isArray(response)) {
    throw new ProviderError(
      'provider_invalid_output',
      `${label} stream event ${event} carries no response object.`,
    );
  }
  return response as Record<string, unknown>;
}

function failureMessage(payload: Record<string, unknown>, fallback: string): string {
  const direct: unknown = payload.error;
  const message =
    (typeof direct === 'string'
      ? direct
      : typeof (direct as Record<string, unknown> | null)?.message === 'string'
        ? String((direct as Record<string, unknown>).message)
        : null) ??
    (typeof payload.message === 'string' ? payload.message : null) ??
    fallback;
  return message;
}

/**
 * Assemble Responses-stream events into a text lane plus the terminal
 * response object. Throws `provider_invalid_output` when:
 * - a terminal failure event arrives (`response.failed`,
 *   `response.incomplete`, or a stream `error`),
 * - the stream carries `[DONE]` or ends with no terminal
 *   `response.completed` event,
 * - a delta event carries a non-JSON payload or a non-string delta.
 *
 * Unknown event types are counted and ignored so additive provider
 * events cannot break the transport.
 */
export function assembleResponsesStream(events: SseEvent[], label: string): AssembledStream {
  const trimmedLabel = label.trim().length > 0 ? label.trim() : 'stream';
  let lane = '';
  let terminal: Record<string, unknown> | null = null;
  let deltaEvents = 0;
  let ignoredEvents = 0;
  for (const { event, data } of events) {
    if (event === 'response.output_text.delta') {
      const payload = parseEventData(data, trimmedLabel, event);
      const delta: unknown = payload.delta;
      if (typeof delta !== 'string') {
        throw new ProviderError(
          'provider_invalid_output',
          `${trimmedLabel} stream event ${event} carries a non-string delta.`,
        );
      }
      lane += delta;
      deltaEvents += 1;
    } else if (event === 'response.completed') {
      if (terminal === null) {
        terminal = terminalResponse(parseEventData(data, trimmedLabel, event), trimmedLabel, event);
      }
    } else if (event === 'response.failed' || event === 'response.incomplete') {
      const payload = data.trim().length > 0 ? parseEventData(data, trimmedLabel, event) : {};
      const inner: unknown = payload.response;
      const detail =
        inner !== null && typeof inner === 'object' && !Array.isArray(inner)
          ? failureMessage(inner as Record<string, unknown>, event)
          : failureMessage(payload, event);
      throw new ProviderError(
        'provider_invalid_output',
        boundedRedacted(`${trimmedLabel} stream terminal ${event}: ${detail}`),
      );
    } else if (event === 'error') {
      const detail =
        data.trim().length > 0
          ? failureMessage(parseEventData(data, trimmedLabel, event), event)
          : event;
      throw new ProviderError(
        'provider_invalid_output',
        boundedRedacted(`${trimmedLabel} stream error event: ${detail}`),
      );
    } else if (data === '[DONE]') {
      // OpenAI-compatible end-of-stream marker: only meaningful after a
      // terminal event; otherwise the stream below reports it missing.
      if (terminal !== null) break;
    } else {
      ignoredEvents += 1;
    }
  }
  if (terminal === null) {
    throw new ProviderError(
      'provider_invalid_output',
      `${trimmedLabel} stream ended without a terminal response.completed event ` +
        `(${events.length} events, ${deltaEvents} deltas); refusing to publish a partial lane.`,
    );
  }
  const terminalOutput: unknown = terminal.output;
  const terminalStatus: unknown = terminal.status;
  if (typeof terminalStatus === 'string' && terminalStatus !== 'completed') {
    const errorField: unknown = terminal.error;
    const detail =
      typeof errorField === 'string'
        ? errorField
        : typeof (errorField as Record<string, unknown> | null)?.message === 'string'
          ? String((errorField as Record<string, unknown>).message)
          : 'terminal status not completed';
    throw new ProviderError(
      'provider_invalid_output',
      boundedRedacted(
        `${trimmedLabel} terminal status ${JSON.stringify(terminalStatus)} (not completed): ${detail}`,
      ),
    );
  }
  const { texts, refusals } = collectOutputParts(
    Array.isArray(terminalOutput) ? terminalOutput : [],
  );
  return {
    lane,
    response: terminal,
    events: events.length,
    deltaEvents,
    ignoredEvents,
    texts,
    refusals,
  };
}
