import { describe, expect, it, vi } from 'vitest';
import { MediaAdapter } from '../../apps/server/src/media/adapter.js';
import { MediaOperations } from '../../apps/server/src/media/operations.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function adapter(fetchImpl: typeof fetch): MediaAdapter {
  return new MediaAdapter({ apiKey: 'test-key', model: 'muse-image-1', fetchImpl, maxRetries: 0 });
}

describe('MediaOperations (Batch B1)', () => {
  it('generates from b64_json and validates the returned image', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ b64_json: PNG.toString('base64') }] }),
    );
    const operations = new MediaOperations(adapter(fetchImpl as unknown as typeof fetch), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const output = await operations.generate({ prompt: 'a cat', size: '512x512' });
    expect(output.mime).toBe('image/png');
    expect(output.width).toBe(1);
    expect(output.height).toBe(1);
    expect(output.bytes.equals(PNG)).toBe(true);
    expect(output.payload_source).toBe('b64_json');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.meta.ai/v1/images/generations');
    expect(JSON.parse(String(init.body))).toMatchObject({
      prompt: 'a cat',
      size: '512x512',
      model: 'muse-image-1',
      response_format: 'b64_json',
    });
  });

  it('downloads a provider URL from the allowlist with no credentials', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('/v1/images/generations')) {
        return jsonResponse({ data: [{ url: 'https://api.meta.ai/assets/one.png' }] });
      }
      return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    });
    const operations = new MediaOperations(adapter(fetchImpl as unknown as typeof fetch), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const output = await operations.generate({ prompt: 'a dog' });
    expect(output.bytes.equals(PNG)).toBe(true);
    expect(output.payload_source).toBe('url');
    const download = fetchImpl.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(download?.headers).toEqual({ accept: 'image/png,image/jpeg,image/webp' });
    expect(download?.redirect).toBe('manual');
  });

  it('refuses a download URL outside the allowlist and a redirect', async () => {
    const outside = vi.fn(async () =>
      jsonResponse({ data: [{ url: 'https://evil.example/x.png' }] }),
    );
    await expect(
      new MediaOperations(adapter(outside as unknown as typeof fetch), {
        fetchImpl: outside as unknown as typeof fetch,
      }).generate({ prompt: 'x' }),
    ).rejects.toThrow(/allowlist/);

    const redirect = vi.fn(async (input: string | URL | Request) =>
      String(input).includes('/v1/images/generations')
        ? jsonResponse({ data: [{ url: 'https://api.meta.ai/assets/one.png' }] })
        : new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
    );
    await expect(
      new MediaOperations(adapter(redirect as unknown as typeof fetch), {
        fetchImpl: redirect as unknown as typeof fetch,
      }).generate({ prompt: 'x' }),
    ).rejects.toThrow(/redirect/i);
  });

  it('rejects non-canonical base64, oversized prompts and unknown sizes', async () => {
    const operations = new MediaOperations(
      adapter(
        vi.fn(async () => jsonResponse({ data: [{ b64_json: '!!!' }] })) as unknown as typeof fetch,
      ),
    );
    await expect(operations.generate({ prompt: 'x' })).rejects.toThrow(/canonical base64/);
    await expect(operations.generate({ prompt: ' ' })).rejects.toThrow(/prompt is required/);
    await expect(operations.generate({ prompt: 'x', size: '999x999' as never })).rejects.toThrow(
      /Unsupported image size/,
    );
  });

  it('sends the operations model explicitly instead of relying on the adapter', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        model: 'muse-image-2-actual',
        data: [{ b64_json: PNG.toString('base64') }],
      }),
    );
    const operations = new MediaOperations(adapter(fetchImpl as unknown as typeof fetch), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      model: 'muse-image-2',
    });
    const output = await operations.generate({ prompt: 'a cat' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'muse-image-2' });
    expect(output.model).toBe('muse-image-2');
    expect(output.observed_model).toBe('muse-image-2-actual');
  });

  it('never reports a configured model as observed when the provider omits it', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ b64_json: PNG.toString('base64') }] }),
    );
    const operations = new MediaOperations(adapter(fetchImpl as unknown as typeof fetch), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      model: 'muse-image-2',
    });
    const output = await operations.generate({ prompt: 'a cat' });
    expect(output.model).toBe('muse-image-2');
    expect(output.observed_model).toBeNull();
  });

  it('edits with multipart form data carrying the source image', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ b64_json: PNG.toString('base64') }] }),
    );
    const operations = new MediaOperations(adapter(fetchImpl as unknown as typeof fetch), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const output = await operations.edit({
      prompt: 'make it blue',
      image: { bytes: PNG, mime: 'image/png' },
    });
    expect(output.bytes.equals(PNG)).toBe(true);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get('model')).toBe('muse-image-1');
    expect(form.get('prompt')).toBe('make it blue');
    const image = form.get('image');
    expect(image).toBeInstanceOf(Blob);
    expect((image as Blob).type).toBe('image/png');
  });
});
