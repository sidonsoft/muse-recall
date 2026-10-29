import { afterEach, describe, expect, it, vi } from 'vitest';

const SESSION_ID = '00000000-0000-4000-8000-000000000000';

describe('turn stream HTTP base URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uses VITE_API_BASE_URL for the session stream', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8788');
    vi.resetModules();
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { streamTurn } = await import('../../apps/web/src/lib/turn-stream.ts');
    await streamTurn(SESSION_ID, { content: 'hello' }, {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `http://127.0.0.1:8788/api/sessions/${SESSION_ID}/messages`,
    );
  });
});
