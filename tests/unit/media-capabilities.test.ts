import { ProviderError } from '@mml/muse-provider';
import { MediaProbeReportSchema } from '@mml/shared';
import { describe, expect, it } from 'vitest';
import {
  isAllowedMediaUrl,
  MEDIA_PROVIDER_ORIGIN,
  MEDIA_RESPONSE_MAX_BYTES,
  MediaAdapter,
} from '../../apps/server/src/media/adapter.js';
import {
  MEDIA_PROBE_MODELS,
  probeMediaCapabilities,
  probeMediaCapability,
} from '../../apps/server/src/media/capabilities.js';

/**
 * Batch A1 — media capability probes (rewritten after the d3f3b67 review).
 *
 * The old suite proved invented `/v1/media/*` routes with `{probe:true}`
 * payloads; those fixtures established no provider compatibility. These
 * tests pin the DOCUMENTED contracts instead:
 *
 * - image-generate → POST /v1/images/generations, ImagesResponse validated;
 * - image-understand/segment/video → POST /v1/responses with real input
 *   shapes, output validated (not merely HTTP 200);
 * - transcribe → POST /v1/asr/transcribe as multipart, transcript validated.
 *
 * Plus the adapter fixes: full payloads preserved (truncation repro),
 * oversized bodies refused (large-image + over-limit), and redirects
 * rejected (redirect regression). No network, no quota: a scripted fetch.
 */

type Call = {
  url: string;
  init: RequestInit;
  key: string | null;
  contentType: string | null;
  bodyText: string | null;
  rawBody: unknown;
};

/** Scripted in-memory stand-in for `fetch`. */
function fixtureFetch(behavior: (call: Call) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const impl = (async (url: unknown, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const rawBody = init?.body;
    let bodyText: string | null = null;
    if (typeof rawBody === 'string') bodyText = rawBody;
    const call: Call = {
      url: String(url),
      init: init ?? {},
      key: headers.get('idempotency-key'),
      contentType: headers.get('content-type'),
      bodyText,
      rawBody,
    };
    calls.push(call);
    return behavior(call);
  }) as typeof fetch;
  return { impl, calls };
}

const okJson = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Documented-shape success fixtures per path. */
function documentedSuccess(path: string): Response {
  if (path === '/v1/images/generations') {
    return okJson({ created: 1, data: [{ b64_json: 'aGVsbG8=' }] });
  }
  if (path === '/v1/asr/transcribe') {
    return okJson({ text: 'hello world' });
  }
  // /v1/responses: the caller distinguishes the lane by request. Segment
  // fixtures carry real SAM grammar (see checkSegmentResponse); understand
  // and video-path carry text lanes.
  if (path === '/v1/responses') {
    return okJson({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'red' }] }],
    });
  }
  return okJson({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'red' }] }],
  });
}

/** SAM streaming success: geometry deltas through a terminal completed event. */
function samSuccess(): Response {
  const lane = '<0f>0<|box;x1=1;y1=2;x2=10;y2=12;w=16;h=16|><|mask;x=0;y=0;data=4,4,~payload|>';
  const blocks = [
    `event: response.output_text.delta\ndata: ${JSON.stringify({ delta: lane.slice(0, 20) })}`,
    `event: response.output_text.delta\ndata: ${JSON.stringify({ delta: lane.slice(20) })}`,
    `event: response.completed\ndata: ${JSON.stringify({
      response: {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: lane }] }],
      },
    })}`,
  ];
  return new Response(`${blocks.join('\n\n')}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** SAM streaming zero-match: completed terminal, no deltas, empty lane. */
function samZeroMatches(): Response {
  const terminal = {
    response: {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '' }] }],
    },
  };
  return new Response(`event: response.completed\ndata: ${JSON.stringify(terminal)}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('media origin guard', () => {
  it('pins requests to https://api.meta.ai', () => {
    expect(MEDIA_PROVIDER_ORIGIN).toBe('https://api.meta.ai');
    expect(isAllowedMediaUrl('https://api.meta.ai/v1/responses')).toBe(true);
    expect(isAllowedMediaUrl('https://api.meta.ai.evil.example/v1/x')).toBe(false);
    expect(isAllowedMediaUrl('http://api.meta.ai/v1/x')).toBe(false);
    expect(isAllowedMediaUrl('https://example.com/v1/x')).toBe(false);
    expect(isAllowedMediaUrl('not a url')).toBe(false);
  });

  it('rejects non-provider origins without I/O', async () => {
    const { impl, calls } = fixtureFetch(() => okJson({ ok: true }));
    const adapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: impl });
    await expect(adapter.call('https://example.com/v1/x', {})).rejects.toMatchObject({
      code: 'invalid_request',
    });
    // The constructor pins the origin, so no relative path can escape it —
    // the only rejection path is a smuggled absolute URL; prove no fetch ran.
    expect(calls).toHaveLength(0);
  });

  it('refuses redirects instead of following them to another host', async () => {
    const { impl, calls } = fixtureFetch(
      () =>
        new Response(null, {
          status: 307,
          headers: { location: 'https://evil.example/collect' },
        }),
    );
    const adapter = new MediaAdapter({
      apiKey: 'test-key-12345',
      fetchImpl: impl,
      maxRetries: 0,
    });
    await expect(adapter.call('/v1/responses', { model: 'm', input: 'hi' })).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
    expect(calls).toHaveLength(1);
    // The redirect target never appears in diagnostics (untrusted content).
    await expect(
      adapter.call('/v1/responses', { model: 'm', input: 'hi' }).catch((e: Error) => e.message),
    ).resolves.not.toContain('evil.example');
  });
});

describe('adapter payload preservation (truncation repro)', () => {
  it('returns a 5,026-char JSON body whole and parseable (was truncated to 2,000)', async () => {
    const payload = { data: [{ b64_json: 'x'.repeat(5000) }] };
    const raw = JSON.stringify(payload);
    expect(raw.length).toBeGreaterThan(5000);
    const { impl } = fixtureFetch(() => okJson(payload));
    const adapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: impl });
    const result = await adapter.call('/v1/images/generations', { prompt: 'x' });
    expect(result.body).toBe(raw);
    expect(() => JSON.parse(result.body)).not.toThrow();
    expect((JSON.parse(result.body) as typeof payload).data[0]?.b64_json).toHaveLength(5000);
  });

  it('preserves a realistic large image payload within the byte cap', async () => {
    // ~2 MB base64 image: the embed ceiling proves this must survive intact.
    const b64 = 'aGVsbG8='.repeat(280_000); // ~1.96 MB
    const payload = { created: 1, data: [{ b64_json: b64 }] };
    const { impl } = fixtureFetch(() => okJson(payload));
    const adapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: impl });
    const result = await adapter.call('/v1/images/generations', { prompt: 'x' });
    const parsed = JSON.parse(result.body) as { data: Array<{ b64_json: string }> };
    expect(parsed.data[0]?.b64_json).toBe(b64);
  });

  it('refuses bodies over the cap instead of truncating', async () => {
    const over = MEDIA_RESPONSE_MAX_BYTES + 1024;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(over));
        controller.close();
      },
    });
    const { impl } = fixtureFetch(() => new Response(stream, { status: 200 }));
    const adapter = new MediaAdapter({
      apiKey: 'test-key-12345',
      fetchImpl: impl,
      maxRetries: 0,
    });
    await expect(adapter.call('/v1/responses', { input: 'hi' })).rejects.toMatchObject({
      code: 'provider_invalid_output',
    });
  });

  it('refuses an over-cap content-length without reading the stream', async () => {
    const { impl, calls } = fixtureFetch(
      () =>
        new Response('tiny', {
          status: 200,
          headers: { 'content-length': String(MEDIA_RESPONSE_MAX_BYTES + 1) },
        }),
    );
    const adapter = new MediaAdapter({
      apiKey: 'test-key-12345',
      fetchImpl: impl,
      maxRetries: 0,
    });
    await expect(adapter.call('/v1/responses', { input: 'hi' })).rejects.toMatchObject({
      code: 'provider_invalid_output',
    });
    expect(calls).toHaveLength(1);
  });
});

describe('probeMediaCapabilities (documented contracts)', () => {
  it('reports unconfigured (never throws) when no API key is present', async () => {
    const { impl, calls } = fixtureFetch(() => okJson({ ok: true }));
    const adapter = new MediaAdapter({ apiKey: null, fetchImpl: impl });
    const report = await probeMediaCapabilities(adapter);
    expect(MediaProbeReportSchema.parse(report)).toEqual(report);
    expect(report.capabilities).toHaveLength(5);
    for (const entry of report.capabilities) {
      expect(entry.status).toBe('unconfigured');
      expect(entry.latency_ms).toBeNull();
      expect(entry.detail).toBeNull();
    }
    expect(calls).toHaveLength(0);
  });

  it('treats blank keys as unconfigured', async () => {
    const { impl } = fixtureFetch(() => okJson({ ok: true }));
    const adapter = new MediaAdapter({ apiKey: '   ', fetchImpl: impl });
    const report = await probeMediaCapability('transcribe', adapter);
    expect(report.status).toBe('unconfigured');
  });

  it('sends documented requests and validates shapes (not just HTTP 200)', async () => {
    const { impl, calls } = fixtureFetch((call) => {
      const path = new URL(call.url).pathname;
      const body =
        call.bodyText !== null ? (JSON.parse(call.bodyText) as Record<string, unknown>) : {};
      // Route the segment probe's concept prompt to SAM grammar; other
      // Responses calls get text lanes.
      if (path === '/v1/responses' && JSON.stringify(body).includes('red square')) {
        return samSuccess();
      }
      return documentedSuccess(path);
    });
    const adapter = new MediaAdapter({
      apiKey: 'test-key-12345',
      model: 'custom-model',
      fetchImpl: impl,
    });
    const report = await probeMediaCapabilities(adapter);
    expect(MediaProbeReportSchema.parse(report)).toEqual(report);
    expect(calls.map((c) => new URL(c.url).pathname).sort()).toEqual([
      '/v1/asr/transcribe',
      '/v1/images/generations',
      '/v1/responses',
      '/v1/responses',
      '/v1/responses',
    ]);
    const statusOf = (name: string): string | undefined =>
      report.capabilities.find((c) => c.capability === name)?.status;
    // Understand/segment/transcribe validate capability-specific results.
    expect(statusOf('image-generate')).toBe('available');
    expect(statusOf('image-understand')).toBe('available');
    expect(statusOf('segment')).toBe('available');
    expect(statusOf('transcribe')).toBe('available');
    // Text-only reachability is explicitly NOT video-ready.
    expect(statusOf('video')).toBe('unverified');
    // Image request carries the documented model + prompt fields.
    const genCall = calls.find((c) => c.url.endsWith('/images/generations'));
    const genBody = JSON.parse(genCall?.bodyText ?? '{}') as Record<string, unknown>;
    expect(genBody['prompt']).toBe('a tiny red square, flat design');
    // Transcribe rides as multipart (no JSON content-type) with the
    // documented `request` (JSON settings) + `audio` (clip) parts.
    const asrCall = calls.find((c) => c.url.endsWith('/asr/transcribe'));
    expect(asrCall?.contentType).toBeNull();
    const form = asrCall?.rawBody;
    expect(form).toBeInstanceOf(FormData);
    const settings = JSON.parse(String((form as FormData).get('request'))) as Record<
      string,
      unknown
    >;
    expect(settings['model']).toBe('custom-model');
    expect(settings['audioEncoding']).toBe('WAV');
    expect(settings['mode']).toBe('PUSH_TO_TALK');
    expect((form as FormData).get('audio')).toBeInstanceOf(Blob);
    // Default documented models are pinned per capability.
    expect(MEDIA_PROBE_MODELS['image-generate']).toBe('muse-image-1.0');
    expect(MEDIA_PROBE_MODELS.segment).toBe('sam-3.1');
    expect(MEDIA_PROBE_MODELS.transcribe).toBe('muse-voice-transcribe-1.0');
  });

  it('marks 200-with-wrong-shape as failed, not available', async () => {
    const { impl } = fixtureFetch((call) => {
      const path = new URL(call.url).pathname;
      if (path === '/v1/images/generations') return okJson({ created: 1, data: [] });
      return documentedSuccess(path);
    });
    const adapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: impl });
    const entry = await probeMediaCapability('image-generate', adapter);
    expect(entry.status).toBe('failed');
    expect(entry.detail).toContain('ImagesResponse without data[]');
  });

  it('review repro: empty-content + unknown-results shapes are not available', async () => {
    // The exact repro: output with only `content: []` and `results: []`.
    const { impl } = fixtureFetch((call) => {
      const path = new URL(call.url).pathname;
      if (path === '/v1/images/generations') {
        return okJson({ created: 1, data: [{ b64_json: 'aGVsbG8=' }] });
      }
      if (path === '/v1/asr/transcribe') return okJson({ results: [] });
      return okJson({ output: [{ content: [] }] });
    });
    const adapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: impl });
    const report = await probeMediaCapabilities(adapter, { model: 'repro' });
    const statusOf = (name: string): string | undefined =>
      report.capabilities.find((c) => c.capability === name)?.status;
    expect(statusOf('image-understand')).toBe('failed');
    expect(statusOf('segment')).toBe('failed');
    expect(statusOf('transcribe')).toBe('failed');
    // Video stays unverified on reachability regardless of lane shape...
    // here the lane is empty so even reachability fails.
    expect(statusOf('video')).toBe('failed');
  });

  it('refusal, truncated-output, and error envelopes are failed, never available', async () => {
    const refusal = okJson({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I cannot help.' }] }],
    });
    const truncated = okJson({ status: 'incomplete', output: [] });
    const errorEnvelope = okJson({ type: 'error', message: 'model busy' });
    const { impl: rImpl } = fixtureFetch(() => refusal);
    const rAdapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: rImpl });
    const refused = await probeMediaCapability('image-understand', rAdapter);
    expect(refused.status).toBe('failed');
    expect(refused.detail).toContain('refusal');

    const { impl: tImpl } = fixtureFetch(() => truncated);
    const tAdapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: tImpl });
    const cut = await probeMediaCapability('image-understand', tAdapter);
    expect(cut.status).toBe('failed');
    expect(cut.detail).toContain('incomplete');

    const { impl: eImpl } = fixtureFetch(() => errorEnvelope);
    const eAdapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: eImpl });
    const errored = await probeMediaCapability('transcribe', eAdapter);
    expect(errored.status).toBe('failed');
    expect(errored.detail).toContain('error result');
  });

  it('legitimate empty results validate: SAM zero-match and silent ASR are available', async () => {
    // SAM with no matches: empty output_text lane on completed output.
    const { impl: sImpl } = fixtureFetch(() => samZeroMatches());
    const sAdapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: sImpl });
    const zero = await probeMediaCapability('segment', sAdapter);
    expect(zero.status).toBe('available');
    expect(zero.detail).toContain('zero matches');

    // A known-object SAM lane validates geometry and reports the match.
    const { impl: gImpl } = fixtureFetch(() => samSuccess());
    const gAdapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: gImpl });
    const match = await probeMediaCapability('segment', gAdapter);
    expect(match.status).toBe('available');
    expect(match.detail).toContain('geometry');

    // ASR silence: empty turns[] is well-formed, so available (no speech).
    const { impl: aImpl } = fixtureFetch(() => okJson({ turns: [] }));
    const aAdapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: aImpl });
    const silent = await probeMediaCapability('transcribe', aAdapter);
    expect(silent.status).toBe('available');
    expect(silent.detail).toContain('silence');

    // ASR single-turn silence: empty text string is well-formed too.
    const { impl: eImpl } = fixtureFetch(() => okJson({ text: '' }));
    const eAdapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: eImpl });
    const empty = await probeMediaCapability('transcribe', eAdapter);
    expect(empty.status).toBe('available');
  });

  it('transcribe rejects malformed turns (wrong-type transcript, missing fields)', async () => {
    const { impl: wImpl } = fixtureFetch(() => okJson({ turns: [{ transcript: 42 }] }));
    const wAdapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: wImpl });
    const wrongType = await probeMediaCapability('transcribe', wAdapter);
    expect(wrongType.status).toBe('failed');
    expect(wrongType.detail).toContain('without string transcript');

    const { impl: mImpl } = fixtureFetch(() => okJson({ turns: [{ speaker: 'A' }] }));
    const mAdapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: mImpl });
    const missing = await probeMediaCapability('transcribe', mAdapter);
    expect(missing.status).toBe('failed');
  });

  it('text inference success with video failure does not read as video-ready', async () => {
    // Text turn works, but the video path 422s on media input: the probe
    // must stay unverified (reachability), never available.
    const { impl, calls } = fixtureFetch((call) => {
      const body = call.bodyText !== null ? call.bodyText : '';
      if (body.includes('ready')) {
        return okJson({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'ready' }] }],
        });
      }
      return okJson({ error: 'video input rejected' }, 422);
    });
    const adapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: impl });
    const entry = await probeMediaCapability('video', adapter);
    expect(entry.status).toBe('unverified');
    expect(entry.detail).toContain('untested');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/v1/responses');
  });

  it('a deliberate clip test with a file_id can promote video to available', async () => {
    const { impl, calls } = fixtureFetch(() =>
      okJson({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'A red square.' }] }],
      }),
    );
    const adapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: impl });
    const entry = await probeMediaCapability('video', adapter, {
      videoClip: { fileId: 'file-abc123' },
    });
    expect(entry.status).toBe('available');
    const sent = JSON.parse(calls[0]?.bodyText ?? '{}') as Record<string, unknown>;
    expect(JSON.stringify(sent)).toContain('file-abc123');
  });

  it('maps 401 to failed (auth), 404/405 to unavailable', async () => {
    const { impl } = fixtureFetch((call) => {
      const path = new URL(call.url).pathname;
      if (path === '/v1/images/generations') return okJson({ error: 'nope' }, 404);
      return okJson({ error: 'bad key' }, 401);
    });
    const adapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: impl });
    const report = await probeMediaCapabilities(adapter, { model: 'probe-model' });
    const statusOf = (name: string): string | undefined =>
      report.capabilities.find((c) => c.capability === name)?.status;
    const detailOf = (name: string): string | null | undefined =>
      report.capabilities.find((c) => c.capability === name)?.detail;
    // Fabricated-route 404s are gone: these are real-path statuses.
    expect(statusOf('image-generate')).toBe('unavailable');
    expect(detailOf('image-generate')).toContain('404');
    expect(statusOf('transcribe')).toBe('failed');
    for (const entry of report.capabilities) {
      expect(entry.model).toBe('probe-model');
    }
  });

  it('maps transport failures to failed without leaking secrets', async () => {
    const secret = 'test-key-12345';
    const { impl } = fixtureFetch(() => {
      throw new Error(`boom while using ${secret}`);
    });
    const adapter = new MediaAdapter({ apiKey: secret, fetchImpl: impl, maxRetries: 0 });
    const entry = await probeMediaCapability('transcribe', adapter);
    expect(entry.status).toBe('failed');
    expect(entry.detail).not.toContain(secret);
  });

  it('sends the duplicate-submission key as Idempotency-Key', async () => {
    const { impl, calls } = fixtureFetch((call) => documentedSuccess(new URL(call.url).pathname));
    const adapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: impl });
    await adapter.call('/v1/responses', { input: 'hi' }, { idempotencyKey: 'dup-key-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.key).toBe('dup-key-1');
    // The probe path also forwards the key.
    await probeMediaCapability('transcribe', adapter, { idempotencyKey: 'dup-key-2' });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.key).toBe('dup-key-2');
  });

  it('a cancellation that wins the race never publishes success', async () => {
    const gate = { release: (_value: Response): void => {} };
    const pending = new Promise<Response>((resolve) => {
      gate.release = resolve;
    });
    const { impl } = fixtureFetch(() => pending);
    const adapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: impl });
    const controller = new AbortController();
    const attempt = adapter.call('/v1/responses', { input: 'hi' }, { signal: controller.signal });
    controller.abort();
    // The transport resolves late — after cancellation already won.
    gate.release(okJson({ ok: true }));
    await expect(attempt).rejects.toMatchObject({ code: 'provider_cancelled' } satisfies {
      code: string;
    });
  });

  it('pre-aborted signals fail fast as cancelled', async () => {
    const { impl, calls } = fixtureFetch(() => okJson({ ok: true }));
    const adapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: impl });
    const controller = new AbortController();
    controller.abort();
    await expect(
      adapter.call('/v1/responses', {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'provider_cancelled' });
    expect(calls).toHaveLength(0);
  });

  it('adapter throws provider_auth_failed when unconfigured (probes stay silent)', async () => {
    const { impl } = fixtureFetch(() => okJson({ ok: true }));
    const adapter = new MediaAdapter({ apiKey: null, fetchImpl: impl });
    await expect(adapter.call('/v1/responses', {})).rejects.toBeInstanceOf(ProviderError);
    await expect(adapter.call('/v1/responses', {})).rejects.toMatchObject({
      code: 'provider_auth_failed',
    });
  });
});
