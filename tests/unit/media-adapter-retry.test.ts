import { describe, expect, it, vi } from 'vitest';
import { MediaAdapter, type MediaFetch } from '../../apps/server/src/media/adapter.js';

/**
 * P2 regression for Batch C acceptance: the smoke must be able to disable the
 * media adapter's default retry and prove how many provider attempts actually
 * happened. These tests use a fake transport only; no provider traffic.
 */

function response(status: number, body = 'upstream unavailable'): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

describe('MediaAdapter retry budget (P2)', () => {
  it('defaults to one retry, so one submission can become two provider attempts', async () => {
    let attempts = 0;
    const fetchImpl: MediaFetch = async () => {
      attempts += 1;
      return response(503);
    };
    const adapter = new MediaAdapter({ apiKey: 'test-key', fetchImpl });
    await expect(
      adapter.call('/v1/responses', { model: 'sam-3.1', input: [] }),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(attempts).toBe(2);
  });

  it('maxRetries: 0 refuses a second attempt on a retryable 503', async () => {
    let attempts = 0;
    const fetchImpl: MediaFetch = async () => {
      attempts += 1;
      return response(503);
    };
    const adapter = new MediaAdapter({ apiKey: 'test-key', maxRetries: 0, fetchImpl });
    const failure = await adapter
      .call('/v1/responses', { model: 'muse-spark-1.3', input: [] })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: 'provider_unavailable',
      details: { status: 503, attempts: 1 },
    });
    expect(attempts).toBe(1);
  });

  it('maxRetries: 0 refuses a second attempt on a retryable 429', async () => {
    let attempts = 0;
    const fetchImpl: MediaFetch = async () => {
      attempts += 1;
      return response(429, 'rate limited');
    };
    const adapter = new MediaAdapter({ apiKey: 'test-key', maxRetries: 0, fetchImpl });
    const failure = await adapter
      .call('/v1/responses', { model: 'muse-spark-1.3', input: [] })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: 'invalid_request',
      details: { status: 429, attempts: 1 },
    });
    expect(attempts).toBe(1);
  });

  it('maxRetries: 0 refuses a second attempt on a network error', async () => {
    let attempts = 0;
    const fetchImpl: MediaFetch = async () => {
      attempts += 1;
      throw new TypeError('socket hang up');
    };
    const adapter = new MediaAdapter({ apiKey: 'test-key', maxRetries: 0, fetchImpl });
    await expect(
      adapter.call('/v1/responses', { model: 'muse-spark-1.3', input: [] }),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(attempts).toBe(1);
  });

  it('maxRetries: 0 refuses a second attempt on a timeout', async () => {
    let attempts = 0;
    const fetchImpl: MediaFetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        attempts += 1;
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });
    const adapter = new MediaAdapter({
      apiKey: 'test-key',
      maxRetries: 0,
      timeoutMs: 5,
      fetchImpl,
    });
    await expect(
      adapter.call('/v1/responses', { model: 'sam-3.1', input: [] }),
    ).rejects.toMatchObject({ code: 'provider_cancelled' });
    expect(attempts).toBe(1);
  });

  it('reports the dispatch count on success and on retry-exhausted failure', async () => {
    const okImpl: MediaFetch = async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const ok = await new MediaAdapter({ apiKey: 'test-key', fetchImpl: okImpl }).call(
      '/v1/responses',
      { model: 'sam-3.1', input: [] },
    );
    expect(ok.attempts).toBe(1);

    let exhausted = 0;
    const failImpl: MediaFetch = async () => {
      exhausted += 1;
      return response(503);
    };
    const failure = await new MediaAdapter({ apiKey: 'test-key', fetchImpl: failImpl })
      .call('/v1/responses', { model: 'sam-3.1', input: [] })
      .catch((error: unknown) => error);
    expect(exhausted).toBe(2);
    expect(failure).toMatchObject({
      code: 'provider_unavailable',
      details: { status: 503, attempts: 2 },
    });
  });

  it('traceAttempts emits one bounded line per attempt and never the key', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.map((value) => String(value)).join(' '));
    });
    const fetchImpl: MediaFetch = async () => response(503, 'secret-key rejected');
    const adapter = new MediaAdapter({
      apiKey: 'secret-key',
      maxRetries: 0,
      traceAttempts: true,
      fetchImpl,
    });
    await expect(
      adapter.call('/v1/responses', { model: 'sam-3.1', input: [] }),
    ).rejects.toMatchObject({ code: 'provider_unavailable', details: { status: 503 } });
    spy.mockRestore();
    const trace = lines.filter((line) => line.includes('[media-trace]'));
    expect(trace.some((line) => line.includes('attempt=1'))).toBe(true);
    expect(
      trace.some((line) => line.includes('outcome=response') && line.includes('status=503')),
    ).toBe(true);
    expect(lines.join('\n')).not.toContain('secret-key');
  });
});
