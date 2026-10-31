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
  // /v1/responses for understand/segment/video-path.
  return okJson({
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'red' }] }],
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
    await expect(
      adapter.call('/v1/responses', { model: 'm', input: 'hi' }),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
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
    for (const entry of report.capabilities) {
      expect(entry.status).toBe('available');
      expect(entry.model).toBe('custom-model');
      expect(typeof entry.latency_ms).toBe('number');
    }
    // Image request carries the documented model + prompt fields.
    const genCall = calls.find((c) => c.url.endsWith('/images/generations'));
    const genBody = JSON.parse(genCall?.bodyText ?? '{}') as Record<string, unknown>;
    expect(genBody['prompt']).toBe('a tiny red square, flat design');
    // Transcribe rides as multipart (no JSON content-type from the adapter).
    const asrCall = calls.find((c) => c.url.endsWith('/asr/transcribe'));
    expect(asrCall?.contentType).toBeNull();
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
    const { impl, calls } = fixtureFetch((call) =>
      documentedSuccess(new URL(call.url).pathname),
    );
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
    const attempt = adapter.call(
      '/v1/responses',
      { input: 'hi' },
      { signal: controller.signal },
    );
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
