import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MediaAdapter,
  type MediaFetch,
  traceModelName,
} from '../../apps/server/src/media/adapter.js';
import {
  MEDIA_PROBE_MODELS,
  probeMediaCapability,
} from '../../apps/server/src/media/capabilities.js';

/**
 * A live run must be able to say which model every paid dispatch used. The image
 * edit endpoint takes `model` as a multipart form field, which the adapter cannot
 * see in a JSON payload, so the ledger line used to read `model=(none)` for a call
 * that had named its model.
 */
function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(' '));
  });
  return { lines, restore: () => spy.mockRestore() };
}

const ok: MediaFetch = async () =>
  new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('media trace names the model a dispatch pays for', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names the model a JSON payload carries', async () => {
    const out = capture();
    const adapter = new MediaAdapter({
      apiKey: 'test-key',
      maxRetries: 0,
      traceAttempts: true,
      fetchImpl: ok,
    });
    await adapter.call('/v1/images/generations', { model: 'muse-image-1.0', prompt: 'x' });
    out.restore();
    const trace = out.lines.filter((line) => line.includes('[media-trace]'));
    expect(trace.some((line) => line.includes('model=muse-image-1.0'))).toBe(true);
  });

  it('names the model a multipart call carries in a form field', async () => {
    const out = capture();
    const adapter = new MediaAdapter({
      apiKey: 'test-key',
      maxRetries: 0,
      traceAttempts: true,
      fetchImpl: ok,
    });
    const form = new FormData();
    form.append('model', 'muse-image-1.0');
    await adapter.call('/v1/images/edits', {}, { rawBody: form, traceModel: 'muse-image-1.0' });
    out.restore();
    const trace = out.lines.filter((line) => line.includes('[media-trace]'));
    expect(trace.some((line) => line.includes('path=/v1/images/edits'))).toBe(true);
    expect(trace.some((line) => line.includes('model=muse-image-1.0'))).toBe(true);
  });

  it('says (none) when nothing names the model, rather than inventing one', async () => {
    const out = capture();
    const adapter = new MediaAdapter({
      apiKey: 'test-key',
      maxRetries: 0,
      traceAttempts: true,
      fetchImpl: ok,
    });
    await adapter.call('/v1/other', {}, { rawBody: new FormData() });
    out.restore();
    const trace = out.lines.filter((line) => line.includes('[media-trace]'));
    expect(trace.some((line) => line.includes('model=(none)'))).toBe(true);
  });

  it('prefers the caller-stated model over a payload field it cannot have sent', () => {
    expect(traceModelName({ traceModel: 'muse-image-1.0' }, { model: 'other-model' })).toBe(
      'muse-image-1.0',
    );
    expect(traceModelName({}, { model: 'sam-3.1' })).toBe('sam-3.1');
    expect(traceModelName({ traceModel: '   ' }, {})).toBe('(none)');
  });
});

describe('a capability probe names the model it paid for', () => {
  it('names the model of a transcribe probe, whose model travels inside a multipart part', async () => {
    // Probes are not free. `/v1/asr/transcribe` carries `model` inside the
    // multipart `request` part, so the probe ledger line used to read
    // `model=(none)`: the run knew it had spent a call and could not say on what.
    const out = capture();
    const adapter = new MediaAdapter({
      apiKey: 'test-key',
      maxRetries: 0,
      traceAttempts: true,
      fetchImpl: async () =>
        new Response(JSON.stringify({ text: 'a red square' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const probe = await probeMediaCapability('transcribe', adapter);
    out.restore();
    expect(probe.status).toBe('available');
    const trace = out.lines.filter((line) => line.includes('[media-trace]'));
    expect(trace.some((line) => line.includes('path=/v1/asr/transcribe'))).toBe(true);
    expect(
      trace.some(
        (line) =>
          line.includes('path=/v1/asr/transcribe') &&
          line.includes(`model=${MEDIA_PROBE_MODELS.transcribe}`),
      ),
    ).toBe(true);
    expect(trace.some((line) => line.includes('model=(none)'))).toBe(false);
  });
});
