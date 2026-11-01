import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { MediaAdapter } from '../../apps/server/src/media/adapter.js';
import { probeMediaCapability } from '../../apps/server/src/media/capabilities.js';
import { MediaSegmentation, type RgbaImage } from '../../apps/server/src/media/segment.js';
import {
  assembleResponsesStream,
  type SseEvent,
  SseParser,
} from '../../apps/server/src/media/sse.js';

/**
 * Batch C — Responses streaming contract (`stream: true`) for SAM.
 *
 * Every fixture below is an offline SSE byte stream: no provider, no
 * network. The matrix covers the documented contract plus its failure
 * modes — matches across split deltas, genuine zero matches, interrupted
 * streams, terminal errors, and contract mismatches — and proves the
 * transport preserves bounded, hash-keyed evidence for each dispatch.
 */

/** Real-grammar lane for the contract-mismatch probe (terminal text, no deltas). */
const LANE_LIKE = '<0f>0<|box;x1=1;y1=2;x2=10;y2=12;w=16;h=16|><|mask;x=0;y=0;data=4,4,~payload|>';
/** Two real-grammar matches (same payloads as media-segment.test.ts). */
const LANE_TWO_MATCHES =
  '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>' +
  "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>" +
  ',1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>' +
  '<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>\n';

const deltaEvent = (text: string): string =>
  `event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}`;

const completedEvent = (response: unknown): string =>
  `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response })}`;

function terminalResponse(output: unknown[]): Record<string, unknown> {
  return {
    id: 'resp_stream_1',
    status: 'completed',
    model: 'sam-3.1-actual',
    output,
  };
}

function laneOutput(lane: string): unknown[] {
  return [{ type: 'message', content: [{ type: 'output_text', text: lane }] }];
}

function sseResponse(raw: string, status = 200): Response {
  return new Response(raw, {
    status,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

/** 8x8 source: left half red, right half blue, full alpha. */
function twoTone(): RgbaImage {
  const width = 8;
  const height = 8;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (x < 4) {
        data[offset] = 255;
      } else {
        data[offset + 2] = 255;
      }
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

function streamAdapter(fetchImpl: unknown, maxRetries = 0, trace = false): MediaAdapter {
  return new MediaAdapter({
    apiKey: 'test-key',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    maxRetries,
    traceAttempts: trace,
  });
}

async function readEvents(response: Response): Promise<SseEvent[]> {
  const text = await response.text();
  return new SseParser().push(text);
}

describe('SseParser', () => {
  it('parses event blocks and ignores comments, ids and empty blocks', () => {
    const parser = new SseParser();
    const events = parser.push(
      ': keep-alive\nid: 1\n\nevent: response.output_text.delta\ndata: {"delta":"ab"}\n\n: another\n\n',
    );
    expect(events).toEqual([{ event: 'response.output_text.delta', data: '{"delta":"ab"}' }]);
  });

  it('holds partial blocks across pushes and handles CRLF', () => {
    const parser = new SseParser();
    expect(parser.push('event: response.comp')).toEqual([]);
    expect(parser.push('leted\r\ndata: {"a":1')).toEqual([]);
    expect(parser.push('}\r\n\r\n')).toEqual([{ event: 'response.completed', data: '{"a":1}' }]);
  });

  it('joins multi-line data and defaults missing event names', () => {
    const parser = new SseParser();
    expect(parser.push('data: line1\ndata: line2\n\n')).toEqual([
      { event: 'message', data: 'line1\nline2' },
    ]);
  });

  it('keeps split multibyte sequences intact across byte chunks', async () => {
    const raw = `${deltaEvent('café — ')}\n\n${completedEvent(terminalResponse([]))}\n\n`;
    const bytes = new TextEncoder().encode(raw);
    const parser = new SseParser();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const events: SseEvent[] = [];
    // One-byte chunks: every multibyte sequence is split mid-character.
    for (let i = 0; i < bytes.length; i += 1) {
      events.push(...parser.push(decoder.decode(bytes.slice(i, i + 1), { stream: true })));
    }
    events.push(...parser.push(decoder.decode()));
    const assembled = assembleResponsesStream(events, 'segment');
    expect(assembled.lane).toBe('café — ');
    expect(assembled.deltaEvents).toBe(1);
  });
});

describe('assembleResponsesStream', () => {
  it('concatenates deltas in order and returns the terminal object', async () => {
    const raw =
      `${deltaEvent('<0f>0<|box;')}\n\n` +
      'event: some.future.event\ndata: {"n":1}\n\n' +
      `${deltaEvent('x1=1|>')}\n\n${completedEvent(terminalResponse(laneOutput('<0f>lane')))}\n\n`;
    const assembled = assembleResponsesStream(await readEvents(sseResponse(raw)), 'segment');
    expect(assembled.lane).toBe('<0f>0<|box;x1=1|>');
    expect(assembled.deltaEvents).toBe(2);
    expect(assembled.ignoredEvents).toBe(1);
    expect(assembled.events).toBe(4);
    expect(assembled.response.status).toBe('completed');
  });

  it('accepts a genuine zero-match stream (no deltas, empty terminal text)', async () => {
    const raw = `${completedEvent(terminalResponse(laneOutput('')))}\n\n`;
    const assembled = assembleResponsesStream(await readEvents(sseResponse(raw)), 'segment');
    expect(assembled.lane).toBe('');
    expect(assembled.deltaEvents).toBe(0);
    expect(assembled.texts).toEqual([{ kind: 'text', text: '' }]);
  });

  it('refuses a stream that ends without a terminal event', async () => {
    const raw = `${deltaEvent('partial')}\n\n`;
    const events = await readEvents(sseResponse(raw));
    expect(() => assembleResponsesStream(events, 'segment')).toThrow(/without a terminal/);
  });

  it('refuses a bare [DONE] with no terminal event', async () => {
    const raw = `${deltaEvent('partial')}\n\ndata: [DONE]\n\n`;
    const events = await readEvents(sseResponse(raw));
    expect(() => assembleResponsesStream(events, 'segment')).toThrow(/without a terminal/);
  });

  it('throws bounded errors for terminal failure events', async () => {
    const failed =
      'event: response.failed\n' +
      `data: ${JSON.stringify({ response: { status: 'failed', error: { message: `x`.repeat(500) } } })}\n\n`;
    const failedEvents = await readEvents(sseResponse(failed));
    let message = '';
    try {
      assembleResponsesStream(failedEvents, 'segment');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/terminal response\.failed/);
    expect(message.length).toBeLessThanOrEqual(300);
    expect(message).toContain('…');

    const incomplete =
      'event: response.incomplete\n' +
      `data: ${JSON.stringify({ response: { status: 'incomplete' } })}\n\n`;
    const incompleteEvents = await readEvents(sseResponse(incomplete));
    expect(() => assembleResponsesStream(incompleteEvents, 'segment')).toThrow(
      /terminal response\.incomplete/,
    );

    const streamError =
      `event: error\ndata: ${JSON.stringify({ message: 'boom' })}\n\n` +
      `${completedEvent(terminalResponse([]))}\n\n`;
    const streamErrorEvents = await readEvents(sseResponse(streamError));
    expect(() => assembleResponsesStream(streamErrorEvents, 'segment')).toThrow(
      /stream error event/,
    );
  });

  it('rejects malformed delta payloads and missing terminal objects', async () => {
    const nonJson = 'event: response.output_text.delta\ndata: not-json\n\n';
    const nonJsonEvents = await readEvents(sseResponse(nonJson));
    expect(() => assembleResponsesStream(nonJsonEvents, 'segment')).toThrow(/non-JSON/);

    const nonString =
      'event: response.output_text.delta\ndata: {"delta":42}\n\n' +
      `${completedEvent(terminalResponse([]))}\n\n`;
    const nonStringEvents = await readEvents(sseResponse(nonString));
    expect(() => assembleResponsesStream(nonStringEvents, 'segment')).toThrow(/non-string delta/);

    const noObject = `event: response.completed\ndata: {"nope":true}\n\n`;
    const noObjectEvents = await readEvents(sseResponse(noObject));
    expect(() => assembleResponsesStream(noObjectEvents, 'segment')).toThrow(/no response object/);
  });

  it('rejects malformed terminal objects instead of reporting zero matches', async () => {
    const malformed: Array<{ name: string; response: unknown }> = [
      { name: 'empty object', response: {} },
      { name: 'completed without output', response: { status: 'completed' } },
      { name: 'completed with non-array output', response: { status: 'completed', output: {} } },
      { name: 'completed with empty output', response: { status: 'completed', output: [] } },
      {
        name: 'completed with empty content',
        response: {
          status: 'completed',
          output: [{ type: 'message', content: [] }],
        },
      },
      { name: 'wrong-type status', response: { status: 200, output: [] } },
    ];
    for (const { name, response } of malformed) {
      const events = await readEvents(sseResponse(`${completedEvent(response)}\n\n`));
      let error: unknown = null;
      try {
        assembleResponsesStream(events, 'segment');
      } catch (e) {
        error = e;
      }
      expect(error, name).not.toBeNull();
      expect(String((error as Error).message), name).toMatch(/terminal/);
      // Partial stream evidence rides on every assembly failure.
      expect(
        (
          error as {
            details?: { events?: unknown; deltaEvents?: unknown; ignoredEvents?: unknown };
          }
        ).details,
      ).toEqual({ events: 1, deltaEvents: 0, ignoredEvents: 0 });
    }
    // The documented genuine zero match: completed status plus an
    // explicit empty output_text part, with no deltas.
    const valid = await readEvents(
      sseResponse(`${completedEvent(terminalResponse(laneOutput('')))}\n\n`),
    );
    const assembled = assembleResponsesStream(valid, 'segment');
    expect(assembled.lane).toBe('');
    expect(assembled.texts).toEqual([{ kind: 'text', text: '' }]);
  });

  it('counts lifecycle and unknown events without touching the lane', async () => {
    const raw =
      'event: response.created\n' +
      `data: ${JSON.stringify({ type: 'response.created' })}\n\n` +
      'event: some.future.event\n' +
      `data: ${JSON.stringify({ n: 1 })}\n\n` +
      `${deltaEvent('ab')}\n\n` +
      'event: response.output_text.done\n' +
      `data: ${JSON.stringify({ type: 'response.output_text.done' })}\n\n` +
      `${completedEvent(terminalResponse(laneOutput('ab')))}` +
      '\n\n';
    const assembled = assembleResponsesStream(await readEvents(sseResponse(raw)), 'segment');
    expect(assembled.lane).toBe('ab');
    expect(assembled.deltaEvents).toBe(1);
    // created + future event + output_text.done are not delta/terminal.
    expect(assembled.ignoredEvents).toBe(3);
    expect(assembled.events).toBe(5);
  });

  it('counts unknown events on a valid empty stream', async () => {
    const raw =
      'event: response.created\n' +
      `data: ${JSON.stringify({ type: 'response.created' })}\n\n` +
      `${completedEvent(terminalResponse(laneOutput('')))}` +
      '\n\n';
    const assembled = assembleResponsesStream(await readEvents(sseResponse(raw)), 'segment');
    expect(assembled.lane).toBe('');
    expect(assembled.deltaEvents).toBe(0);
    expect(assembled.ignoredEvents).toBe(1);
  });

  it('collects terminal refusals without throwing (the caller decides)', async () => {
    const raw = `${completedEvent({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no geometry' }] }],
    })}\n\n`;
    const assembled = assembleResponsesStream(await readEvents(sseResponse(raw)), 'segment');
    expect(assembled.lane).toBe('');
    expect(assembled.refusals).toEqual([{ kind: 'refusal', text: 'no geometry' }]);
  });
});

describe('MediaAdapter.callStream', () => {
  it('requests SSE explicitly and returns parsed events with hash evidence', async () => {
    const raw =
      `${deltaEvent('ab')}\n\n${deltaEvent('cd')}\n\n` +
      `${completedEvent(terminalResponse(laneOutput('abcd')))}\n\n`;
    const seen: Array<{ url: unknown; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: unknown, init: RequestInit) => {
      seen.push({ url, init });
      return sseResponse(raw);
    });
    const traces: string[] = [];
    const error = console.error;
    console.error = (...args: unknown[]): void => {
      traces.push(args.map(String).join(' '));
    };
    try {
      const result = await streamAdapter(fetchImpl, 0, true).callStream('/v1/responses', {
        model: 'sam',
      });
      const body = JSON.parse(String((seen[0]?.init.body ?? '{}') as string)) as Record<
        string,
        unknown
      >;
      expect(body.stream).toBe(true);
      expect(new Headers(seen[0]?.init.headers).get('accept')).toBe('text/event-stream');
      expect(result.status).toBe(200);
      expect(result.events).toHaveLength(3);
      expect(result.streamBytes).toBe(new TextEncoder().encode(raw).length);
      expect(result.responseSha256).toBe(createHash('sha256').update(raw).digest('hex'));
      expect(result.responseSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(result.attempts).toBe(1);
      expect(traces.some((line) => line.includes('model=sam'))).toBe(true);
      const outcome = traces.find((line) => line.includes('outcome=response'));
      expect(outcome).toContain('status=200');
      expect(outcome).toContain(`bytes=${result.streamBytes}`);
      expect(outcome).toContain('events=3');
    } finally {
      console.error = error;
    }
  });

  it('fails closed on non-SSE bodies, missing bodies and redirects', async () => {
    const json = vi.fn(async () => new Response('{}', { status: 200 }));
    await expect(streamAdapter(json).callStream('/v1/responses', {})).rejects.toThrow(
      /text\/event-stream/,
    );

    const empty = vi.fn(
      async () =>
        new Response(null, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    await expect(streamAdapter(empty).callStream('/v1/responses', {})).rejects.toThrow(/no body/);

    const redirect = vi.fn(async () => new Response(null, { status: 307 }));
    await expect(streamAdapter(redirect).callStream('/v1/responses', {})).rejects.toThrow(
      /redirected/,
    );
  });

  it('maps HTTP failures and retries network errors per policy', async () => {
    const denied = vi.fn(async () => new Response('nope', { status: 401 }));
    const auth = streamAdapter(denied)
      .callStream('/v1/responses', {})
      .catch((e: Error) => e);
    await expect(auth).resolves.toMatchObject({ code: 'provider_auth_failed' });

    let calls = 0;
    const flaky = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return sseResponse(`${completedEvent(terminalResponse(laneOutput('')))}\n\n`);
    });
    const retried = await streamAdapter(flaky, 1).callStream('/v1/responses', {});
    expect(retried.attempts).toBe(2);
    expect(retried.events).toHaveLength(1);

    const strict = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const failure = await streamAdapter(strict)
      .callStream('/v1/responses', {})
      .catch((e: Error) => e);
    expect(failure).toMatchObject({ code: 'provider_unavailable' });
    expect((failure as { details?: { attempts?: number } }).details?.attempts).toBe(1);
  });

  it('refuses oversized streams before buffering them', async () => {
    const huge = vi.fn(
      async () =>
        new Response('x', {
          status: 200,
          headers: { 'content-type': 'text/event-stream', 'content-length': '99999999' },
        }),
    );
    const oversized = await streamAdapter(huge)
      .callStream('/v1/responses', {})
      .catch((e: Error) => e);
    expect(String((oversized as Error).message)).toMatch(/above the .* limit/);
    // Post-dispatch transport refusal: the dispatch is still accounted.
    expect((oversized as { details?: { attempts?: unknown } }).details?.attempts).toBe(1);
  });
});

describe('MediaSegmentation over streaming', () => {
  it('sends stream:true and parses matches split across deltas', async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(String(init?.body));
      const raw =
        `${deltaEvent(LANE_TWO_MATCHES.slice(0, 60))}\n\n` +
        `${deltaEvent(LANE_TWO_MATCHES.slice(60, 150))}\n\n` +
        `${deltaEvent(LANE_TWO_MATCHES.slice(150))}\n\n` +
        `${completedEvent(terminalResponse(laneOutput(LANE_TWO_MATCHES)))}\n\n`;
      return sseResponse(raw);
    });
    const src: RgbaImage = { width: 320, height: 334, data: Buffer.alloc(320 * 334 * 4, 200) };
    const result = await new MediaSegmentation(streamAdapter(fetchImpl), {
      model: 'sam-test',
    }).segment(src, 'dot');
    expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({ model: 'sam-test', stream: true });
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]?.box).toEqual({ x1: 211, y1: 228, x2: 271, y2: 255 });
    expect(result.observedModel).toBe('sam-3.1-actual');
    expect(result.attempts).toBe(1);
    expect(result.deltaEvents).toBe(3);
    expect(result.ignoredEvents).toBe(0);
    expect(result.streamEvents).toBe(4);
    expect(result.streamBytes).toBeGreaterThan(0);
    expect(result.responseSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports genuine zero matches without an error', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse(`${completedEvent(terminalResponse(laneOutput('')))}\n\n`),
    );
    const result = await new MediaSegmentation(streamAdapter(fetchImpl)).segment(twoTone(), 'x');
    expect(result.matches).toEqual([]);
    expect(result.lane).toBe('');
    expect(result.model).toBe('sam-3.1');
  });

  it('rejects a terminal object whose status is not completed', async () => {
    const failed = vi.fn(async () =>
      sseResponse(
        `${completedEvent({ status: 'failed', output: [], error: { message: 'busy' } })}\n\n`,
      ),
    );
    await expect(
      new MediaSegmentation(streamAdapter(failed)).segment(twoTone(), 'dot'),
    ).rejects.toThrow(/terminal status "failed"/);
  });

  it('rejects refusals, interruptions, failures and contract mismatch', async () => {
    const refusing = vi.fn(async () =>
      sseResponse(
        `${completedEvent({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }],
        })}\n\n`,
      ),
    );
    await expect(
      new MediaSegmentation(streamAdapter(refusing)).segment(twoTone(), 'dot'),
    ).rejects.toThrow(/refused/);

    const interrupted = vi.fn(async () => sseResponse(`${deltaEvent('partial')}\n\n`));
    await expect(
      new MediaSegmentation(streamAdapter(interrupted)).segment(twoTone(), 'dot'),
    ).rejects.toThrow(/without a terminal/);

    const failed = vi.fn(async () =>
      sseResponse(
        `event: response.failed\ndata: ${JSON.stringify({ response: { status: 'failed' } })}\n\n`,
      ),
    );
    await expect(
      new MediaSegmentation(streamAdapter(failed)).segment(twoTone(), 'dot'),
    ).rejects.toThrow(/terminal response\.failed/);

    const mismatched = vi.fn(async () =>
      sseResponse(`${completedEvent(terminalResponse(laneOutput(LANE_TWO_MATCHES)))}\n\n`),
    );
    await expect(
      new MediaSegmentation(streamAdapter(mismatched)).segment(twoTone(), 'dot'),
    ).rejects.toThrow(/contract mismatch/);

    const garbage = vi.fn(async () =>
      sseResponse(
        `${deltaEvent('hello, not geometry')}\n\n` +
          `${completedEvent(terminalResponse(laneOutput('hello, not geometry')))}\n\n`,
      ),
    );
    await expect(
      new MediaSegmentation(streamAdapter(garbage)).segment(twoTone(), 'dot'),
    ).rejects.toThrow(/no usable matches/);
  });
});

it('preserves attempts and stream evidence on validation failures', async () => {
  const raw = `${deltaEvent('partial')}\n\n`;
  const interrupted = vi.fn(async () => sseResponse(raw));
  const failure = await new MediaSegmentation(streamAdapter(interrupted))
    .segment(twoTone(), 'dot')
    .catch((e: Error) => e);
  expect(failure).toMatchObject({ code: 'provider_invalid_output' });
  const details = (failure as { details?: Record<string, unknown> }).details ?? {};
  expect(details.attempts).toBe(1);
  expect(details.stream_events).toBe(1);
  expect(details.stream_bytes).toBeGreaterThan(0);
  expect(details.response_sha256).toBe(createHash('sha256').update(raw).digest('hex'));
  // One delta seen, none ignored: exact assembly counts survive.
  expect(details.delta_events).toBe(1);
  expect(details.ignored_events).toBe(0);
});

describe('segment probe over streaming', () => {
  it('validates streamed geometry and records hash evidence', async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(String(init?.body));
      const lane = '<0f>0<|box;x1=1;y1=2;x2=10;y2=12;w=16;h=16|><|mask;x=0;y=0;data=4,4,~payload|>';
      return sseResponse(
        `${deltaEvent(lane)}\n\n${completedEvent(terminalResponse(laneOutput(lane)))}\n\n`,
      );
    });
    const entry = await probeMediaCapability('segment', streamAdapter(fetchImpl, 1), {
      models: { segment: 'sam-probe' },
    });
    expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({ model: 'sam-probe', stream: true });
    expect(entry.status).toBe('available');
    expect(entry.detail).toContain('geometry');
    expect(entry.detail).toContain('sha=');
    expect(entry.detail).toContain('events=');
  });

  it('fails malformed terminals and terminal-only geometry at the probe', async () => {
    const malformed = streamAdapter(
      vi.fn(async () => sseResponse(`${completedEvent({ status: 'completed' })}\n\n`)),
    );
    const bad = await probeMediaCapability('segment', malformed);
    expect(bad.status).toBe('failed');
    expect(bad.detail).toContain('terminal');

    const mismatched = streamAdapter(
      vi.fn(async () =>
        sseResponse(`${completedEvent(terminalResponse(laneOutput(LANE_LIKE)))}\n\n`),
      ),
    );
    const offContract = await probeMediaCapability('segment', mismatched);
    expect(offContract.status).toBe('failed');
    expect(offContract.detail).toContain('contract mismatch');
  });

  it('passes streamed zero matches and fails interruptions and refusals', async () => {
    const zero = streamAdapter(
      vi.fn(async () => sseResponse(`${completedEvent(terminalResponse(laneOutput('')))}\n\n`)),
    );
    const empty = await probeMediaCapability('segment', zero);
    expect(empty.status).toBe('available');
    expect(empty.detail).toContain('zero matches');

    const cut = streamAdapter(vi.fn(async () => sseResponse(`${deltaEvent('x')}\n\n`)));
    const interrupted = await probeMediaCapability('segment', cut);
    expect(interrupted.status).toBe('failed');
    expect(interrupted.detail).toContain('terminal');

    const refusing = streamAdapter(
      vi.fn(async () =>
        sseResponse(
          `${completedEvent({
            status: 'completed',
            output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }],
          })}\n\n`,
        ),
      ),
    );
    const refused = await probeMediaCapability('segment', refusing);
    expect(refused.status).toBe('failed');
    expect(refused.detail).toContain('refusal');
  });
});
