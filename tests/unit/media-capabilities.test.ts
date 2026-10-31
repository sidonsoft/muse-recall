import { ProviderError } from '@mml/muse-provider';
import { MediaProbeReportSchema } from '@mml/shared';
import { describe, expect, it } from 'vitest';
import {
  isAllowedMediaUrl,
  MEDIA_PROVIDER_ORIGIN,
  MediaAdapter,
} from '../../apps/server/src/media/adapter.js';
import {
  MEDIA_PROBE_PATHS,
  probeMediaCapabilities,
  probeMediaCapability,
} from '../../apps/server/src/media/capabilities.js';

/**
 * Batch A1 — media capability probes.
 *
 * A deterministic fixture adapter stands in for the Meta Model API: no
 * network, no quota. The tests prove:
 *  1. missing credentials → `unconfigured` (never throws);
 *  2. auth/transport failures → `failed` with provider-code mapping;
 *  3. unknown-route statuses → `unavailable`;
 *  4. duplicate submissions carry the Idempotency-Key header;
 *  5. a cancellation that lands after the response completed still reports
 *     failure — it is never republished as success (`cancelled`).
 */

type Call = { url: string; init: RequestInit; key: string | null };

/** Scripted in-memory stand-in for `fetch`. */
function fixtureFetch(behavior: (call: Call) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const impl = (async (url: unknown, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: String(url),
      init: init ?? {},
      key: headers.get('idempotency-key'),
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

describe('media origin guard', () => {
  it('pins requests to https://api.meta.ai', () => {
    expect(MEDIA_PROVIDER_ORIGIN).toBe('https://api.meta.ai');
    expect(isAllowedMediaUrl('https://api.meta.ai/v1/media/image/generate')).toBe(true);
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
});

describe('probeMediaCapabilities', () => {
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

  it('maps success to available with model and shape detail', async () => {
    const { impl } = fixtureFetch(() => okJson({ data: [1], status: 'ok' }));
    const adapter = new MediaAdapter({
      apiKey: 'test-key-12345',
      model: 'muse-wonder-1.0',
      fetchImpl: impl,
    });
    const report = await probeMediaCapabilities(adapter);
    expect(MediaProbeReportSchema.parse(report)).toEqual(report);
    for (const entry of report.capabilities) {
      expect(entry.status).toBe('available');
      expect(entry.model).toBe('muse-wonder-1.0');
      expect(typeof entry.latency_ms).toBe('number');
      expect(entry.detail).toContain('object{data,status}');
    }
  });

  it('maps 401 to failed (auth), 404/405 to unavailable', async () => {
    const { impl } = fixtureFetch((call) => {
      if (call.url.endsWith('/segment')) return okJson({ error: 'nope' }, 404);
      if (call.url.endsWith('/video')) return okJson({ error: 'nope' }, 405);
      return okJson({ error: 'bad key' }, 401);
    });
    const adapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: impl });
    const report = await probeMediaCapabilities(adapter, { model: 'probe-model' });
    const statusOf = (name: string): string | undefined =>
      report.capabilities.find((c) => c.capability === name)?.status;
    const detailOf = (name: string): string | null | undefined =>
      report.capabilities.find((c) => c.capability === name)?.detail;
    expect(statusOf('image-generate')).toBe('failed');
    expect(detailOf('image-generate')).toContain('401');
    expect(statusOf('segment')).toBe('unavailable');
    expect(statusOf('video')).toBe('unavailable');
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
    const { impl, calls } = fixtureFetch(() => okJson({ ok: true }));
    const adapter = new MediaAdapter({ apiKey: 'test-key-12345', fetchImpl: impl });
    await adapter.call(
      MEDIA_PROBE_PATHS['image-generate'],
      { probe: true },
      { idempotencyKey: 'dup-key-1' },
    );
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
      MEDIA_PROBE_PATHS.segment,
      { probe: true },
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
      adapter.call(MEDIA_PROBE_PATHS.video, {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'provider_cancelled' });
    expect(calls).toHaveLength(0);
  });

  it('adapter throws provider_auth_failed when unconfigured (probes stay silent)', async () => {
    const { impl } = fixtureFetch(() => okJson({ ok: true }));
    const adapter = new MediaAdapter({ apiKey: null, fetchImpl: impl });
    await expect(adapter.call('/v1/media/video', {})).rejects.toBeInstanceOf(ProviderError);
    await expect(adapter.call('/v1/media/video', {})).rejects.toMatchObject({
      code: 'provider_auth_failed',
    });
  });
});
