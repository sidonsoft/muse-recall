import { MEDIA_AUDIO_MAX_BYTES, MEDIA_VIDEO_MAX_BYTES } from '@mml/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { DownloadDeps } from '../../apps/web/src/components/studio/source-playback.ts';
import {
  attachSourceDownload,
  type DownloadSnapshot,
  downloadSource,
  downloadView,
  filenameFor,
  IDLE_DOWNLOAD,
  IDLE_SNAPSHOT,
  type PlaybackDeps,
  type PlaybackSnapshot,
  playbackKey,
  playbackMessage,
  playbackView,
  SourceDownload,
  SourcePlayback,
} from '../../apps/web/src/components/studio/source-playback.ts';
import { ApiError, api, type SourceBytes } from '../../apps/web/src/lib/api.ts';

/**
 * Batch D fix: `<audio>/<video src>` and a download `href` pointing straight at
 * `/media/sources/:id/bytes` cannot send the bearer header, so they 401 under
 * ACCESS_TOKEN. Bytes must arrive through the API client and reach the element
 * as a `blob:` object URL. Vitest runs in node with no DOM, so the URL
 * lifecycle is exercised through injected fakes — which is also what makes the
 * revoke/stale guarantees directly observable.
 */

interface Fakes {
  deps: PlaybackDeps & DownloadDeps;
  created: string[];
  revoked: string[];
  fetches: Array<{ projectId: string; sourceId: string }>;
  triggerCalls: Array<{ url: string; filename: string }>;
}

function makeFakes(
  fetchBytes: (projectId: string, sourceId: string) => Promise<SourceBytes>,
): Fakes {
  const created: string[] = [];
  const revoked: string[] = [];
  const fetches: Array<{ projectId: string; sourceId: string }> = [];
  const triggerCalls: Array<{ url: string; filename: string }> = [];
  let next = 0;
  return {
    created,
    revoked,
    fetches,
    triggerCalls,
    deps: {
      fetchBytes: async (projectId, sourceId) => {
        fetches.push({ projectId, sourceId });
        return fetchBytes(projectId, sourceId);
      },
      createUrl: () => {
        const url = `blob:local/${String(++next)}`;
        created.push(url);
        return url;
      },
      revokeUrl: (url) => void revoked.push(url),
      trigger: (url, filename) => void triggerCalls.push({ url, filename }),
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function bytesFor(projectId: string, sourceId: string): SourceBytes {
  const blob = new Blob([`${projectId}/${sourceId}`]);
  return { blob, mime: 'audio/wav', byteLength: blob.size };
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { fetch?: unknown }).fetch;
});

describe('SourcePlayback object-URL lifecycle', () => {
  it('publishes exactly one blob URL for the current source', async () => {
    const fakes = makeFakes(async (projectId, sourceId) => bytesFor(projectId, sourceId));
    const playback = new SourcePlayback(fakes.deps);
    const inFlight = playback.load('alpha', 'src-a');
    expect(playback.current().status).toBe('loading');
    expect(playback.current().objectUrl).toBeNull();
    expect(playbackMessage(playback.current())).toBe('Loading source bytes\u2026');
    await inFlight;
    expect(fakes.created).toHaveLength(1);
    expect(playback.current().objectUrl).toBe(fakes.created[0]);
    expect(playback.current().sourceKey).toBe(playbackKey('alpha', 'src-a'));
    expect(fakes.revoked).toEqual([]);
    playback.dispose();
  });

  it('revokes the previous URL the moment another source is selected', async () => {
    const fakes = makeFakes(async (projectId, sourceId) => bytesFor(projectId, sourceId));
    const playback = new SourcePlayback(fakes.deps);
    await playback.load('alpha', 'src-a');
    const firstUrl = playback.current().objectUrl as string;
    const switching = playback.load('alpha', 'src-b');
    // Revoked before the second fetch even resolves: no stale cross-source audio.
    expect(fakes.revoked).toEqual([firstUrl]);
    await switching;
    expect(fakes.created).toHaveLength(2);
    expect(playback.current().objectUrl).toBe(fakes.created[1]);
    expect(playback.current().sourceKey).toBe(playbackKey('alpha', 'src-b'));
    playback.dispose();
  });

  it('drops a stale response for a source that is no longer active', async () => {
    const slowA = deferred<SourceBytes>();
    const fastB = deferred<SourceBytes>();
    const fakes = makeFakes((_projectId, sourceId) =>
      sourceId === 'src-a' ? slowA.promise : fastB.promise,
    );
    const playback = new SourcePlayback(fakes.deps);
    const stale = playback.load('alpha', 'src-a');
    const current = playback.load('alpha', 'src-b');
    fastB.resolve(bytesFor('alpha', 'src-b'));
    await current;
    // The late bytes for src-a arrive after src-b is already active.
    slowA.resolve(bytesFor('alpha', 'src-a'));
    await stale;
    // They never reach an element and never leak an unreleased URL.
    expect(fakes.created).toHaveLength(1);
    expect(playback.current().sourceKey).toBe(playbackKey('alpha', 'src-b'));
    expect(playback.current().objectUrl).toBe(fakes.created[0]);
    playback.dispose();
    expect(fakes.revoked).toEqual(fakes.created);
  });

  it('revokes the URL on unmount', async () => {
    const fakes = makeFakes(async (projectId, sourceId) => bytesFor(projectId, sourceId));
    const playback = new SourcePlayback(fakes.deps);
    await playback.load('alpha', 'src-a');
    const url = playback.current().objectUrl as string;
    playback.dispose();
    expect(fakes.revoked).toEqual([url]);
    expect(playback.current()).toEqual(IDLE_SNAPSHOT);
  });

  it('publishes nothing after unmount when the fetch lands later', async () => {
    const pending = deferred<SourceBytes>();
    const fakes = makeFakes(() => pending.promise);
    const playback = new SourcePlayback(fakes.deps);
    const inFlight = playback.load('alpha', 'src-a');
    playback.dispose();
    pending.resolve(bytesFor('alpha', 'src-a'));
    await inFlight;
    expect(fakes.created).toEqual([]);
    expect(fakes.revoked).toEqual([]);
    expect(playback.current()).toEqual(IDLE_SNAPSHOT);
  });

  it('keeps a project switch from showing another project bytes', async () => {
    const fakes = makeFakes(async (projectId, sourceId) => bytesFor(projectId, sourceId));
    const playback = new SourcePlayback(fakes.deps);
    await playback.load('alpha', 'shared-id');
    const firstUrl = playback.current().objectUrl as string;
    await playback.load('beta', 'shared-id');
    expect(fakes.revoked).toEqual([firstUrl]);
    expect(playback.current().sourceKey).toBe(playbackKey('beta', 'shared-id'));
    expect(fakes.fetches.map((entry) => entry.projectId)).toEqual(['alpha', 'beta']);
    playback.dispose();
  });

  it('surfaces an auth failure without creating any URL', async () => {
    const fakes = makeFakes(() =>
      Promise.reject(new ApiError('unauthorized', 'Missing or invalid bearer token.', 401)),
    );
    const playback = new SourcePlayback(fakes.deps);
    await playback.load('alpha', 'src-a');
    expect(fakes.created).toEqual([]);
    expect(fakes.revoked).toEqual([]);
    expect(playback.current().error).toEqual({
      code: 'unauthorized',
      message: 'Missing or invalid bearer token.',
    });
    expect(playback.current().objectUrl).toBeNull();
    expect(playback.current().sourceKey).toBe(playbackKey('alpha', 'src-a'));
    expect(playbackMessage(playback.current())).toBe(
      'Playback unavailable: Missing or invalid bearer token.',
    );
    playback.dispose();
  });
});

describe('api.mediaSourceBytes request plumbing', () => {
  interface StubCall {
    url: string;
    headers: Record<string, string>;
  }
  function stubFetch(
    call: (init: { headers: Record<string, string> }) => {
      status?: number;
      contentType?: string;
      body?: Uint8Array | string;
      contentLength?: string;
    },
  ): StubCall[] {
    const calls: StubCall[] = [];
    (globalThis as { fetch?: unknown }).fetch = (input: string, init: RequestInit) => {
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(input), headers });
      const spec = call({ headers });
      const headersOut: Record<string, string> = {};
      if (spec.contentType !== undefined) headersOut['content-type'] = spec.contentType;
      if (spec.contentLength !== undefined) headersOut['content-length'] = spec.contentLength;
      const body =
        spec.body === undefined
          ? ''
          : typeof spec.body === 'string'
            ? spec.body
            : new Uint8Array(spec.body);
      return Promise.resolve(
        new Response(body, { status: spec.status ?? 200, headers: headersOut }),
      );
    };
    return calls;
  }

  it('sends the bearer header when a token is stored, on the exact project+source path', async () => {
    const store = new Map<string, string>([['mml.access_token', 'sekret']]);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    const png = Uint8Array.from([1, 2, 3, 4]);
    const calls = stubFetch(() => ({ contentType: 'audio/wav', body: png }));
    const fetched = await api.mediaSourceBytes('proj-1', 'src-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/forge/projects/proj-1/media/sources/src-1/bytes');
    expect(calls[0]?.headers.authorization).toBe('Bearer sekret');
    // No credential travels in the URL: only the header does.
    expect(calls[0]?.url).not.toContain('token');
    expect(fetched.mime).toBe('audio/wav');
    expect(fetched.byteLength).toBe(png.length);
    expect(await fetched.blob.text()).not.toContain('sekret');
  });

  it('sends no auth header and still succeeds in the tokenless loopback mode', async () => {
    const calls = stubFetch(() => ({ contentType: 'video/mp4', body: Uint8Array.from([9, 9]) }));
    const fetched = await api.mediaSourceBytes('proj-1', 'src-1');
    expect(calls[0]?.headers.authorization).toBeUndefined();
    expect(Object.keys(calls[0]?.headers ?? {})).toEqual([]);
    expect(fetched.mime).toBe('video/mp4');
    expect(fetched.byteLength).toBe(2);
  });

  it('keeps the envelope error code for a 401 so the panel can explain it', async () => {
    stubFetch(() => ({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        error: { code: 'unauthorized', message: 'Missing or invalid bearer token.' },
      }),
    }));
    const failure = await api.mediaSourceBytes('proj-1', 'src-1').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe('unauthorized');
    expect((failure as ApiError).status).toBe(401);
    expect((failure as ApiError).message).toBe('Missing or invalid bearer token.');
  });

  it('refuses a non-media response type instead of feeding it to a media element', async () => {
    stubFetch(() => ({ contentType: 'text/html', body: '<html></html>' }));
    const failure = await api.mediaSourceBytes('proj-1', 'src-1').catch((error: unknown) => error);
    expect((failure as ApiError).code).toBe('unsafe_content_type');
  });

  it('enforces the shared byte caps from the header and from the read size', async () => {
    stubFetch(() => ({
      contentType: 'audio/wav',
      contentLength: String(MEDIA_AUDIO_MAX_BYTES + 1),
      body: Uint8Array.from([1]),
    }));
    const announced = await api
      .mediaSourceBytes('proj-1', 'src-1')
      .catch((error: unknown) => error);
    expect((announced as ApiError).code).toBe('source_too_large');

    stubFetch(() => ({
      contentType: 'video/mp4',
      body: new Uint8Array(MEDIA_VIDEO_MAX_BYTES + 1),
    }));
    const actual = await api.mediaSourceBytes('proj-1', 'src-1').catch((error: unknown) => error);
    expect((actual as ApiError).code).toBe('source_too_large');
  });
});

describe('playbackView selection gating', () => {
  const readyForA: PlaybackSnapshot = {
    sourceKey: playbackKey('alpha', 'src-a'),
    status: 'ready',
    objectUrl: 'blob:previous-source',
    blob: new Blob(['a']),
    mime: 'audio/wav',
    byteLength: 1,
    error: null,
  };

  it('hides a ready snapshot that belongs to another source', () => {
    // Exactly the render that happens after a selection change but before the
    // playback effect runs: the old blob URL must not reach the element.
    const view = playbackView(readyForA, 'alpha', 'src-b');
    expect(view.status).toBe('loading');
    expect(view.objectUrl).toBeNull();
    expect(view.blob).toBeNull();
    expect(view.sourceKey).toBe(playbackKey('alpha', 'src-b'));
    expect(playbackMessage(view)).toBe('Loading source bytes\u2026');
  });

  it('hides it across a project switch even when the source id matches', () => {
    const view = playbackView(readyForA, 'beta', 'src-a');
    expect(view.objectUrl).toBeNull();
    expect(view.status).toBe('loading');
    expect(view.sourceKey).toBe(playbackKey('beta', 'src-a'));
  });

  it('passes the snapshot through for the exact current selection', () => {
    expect(playbackView(readyForA, 'alpha', 'src-a')).toBe(readyForA);
  });

  it('shows an error only for the source it came from', () => {
    const failed: PlaybackSnapshot = {
      ...readyForA,
      status: 'error',
      objectUrl: null,
      error: { code: 'unauthorized', message: 'Missing or invalid bearer token.' },
    };
    expect(playbackView(failed, 'alpha', 'src-b').status).toBe('loading');
    expect(playbackView(failed, 'alpha', 'src-b').error).toBeNull();
    const same = playbackView(failed, 'alpha', 'src-a');
    expect(same.status).toBe('error');
    expect(playbackMessage(same)).toBe('Playback unavailable: Missing or invalid bearer token.');
  });
});

describe('SourceDownload selection fence', () => {
  it('never downloads for a source that is no longer selected', async () => {
    const pending = deferred<SourceBytes>();
    const fakes = makeFakes(() => pending.promise);
    const downloads = new SourceDownload(fakes.deps);
    downloads.select('alpha', 'src-a');
    const started = downloads.download('alpha', 'src-a', 'audio/wav');
    expect(downloads.current()).toEqual({
      sourceKey: playbackKey('alpha', 'src-a'),
      pending: true,
      error: null,
    });
    // The person switches source while the byte fetch is still running.
    downloads.select('alpha', 'src-b');
    expect(downloads.current()).toEqual(IDLE_DOWNLOAD_EXT('alpha', 'src-b'));
    pending.resolve(bytesFor('alpha', 'src-a'));
    expect(await started).toBe('stale');
    // No URL was ever made, and no download fires against the new selection.
    expect(fakes.created).toEqual([]);
    expect(fakes.revoked).toEqual([]);
    expect(fakes.triggerCalls).toEqual([]);
    expect(downloads.current()).toEqual(IDLE_DOWNLOAD_EXT('alpha', 'src-b'));
  });

  it('suppresses a late failure instead of showing it on the new selection', async () => {
    const pending = deferred<SourceBytes>();
    const fakes = makeFakes(() => pending.promise);
    const downloads = new SourceDownload(fakes.deps);
    downloads.select('alpha', 'src-a');
    const started = downloads.download('alpha', 'src-a', 'audio/wav');
    downloads.select('beta', 'src-z');
    pending.reject(new ApiError('unauthorized', 'Missing or invalid bearer token.', 401));
    expect(await started).toBe('stale');
    expect(downloads.current().error).toBeNull();
    expect(downloads.current().pending).toBe(false);
    expect(downloads.current().sourceKey).toBe(playbackKey('beta', 'src-z'));
  });

  it('reports progress, downloads, and clears it for the selected source', async () => {
    const fakes = makeFakes(async (projectId, sourceId) => bytesFor(projectId, sourceId));
    const downloads = new SourceDownload(fakes.deps);
    downloads.select('alpha', 'src-a');
    const started = downloads.download('alpha', 'src-a', 'audio/wav');
    expect(downloads.current().pending).toBe(true);
    expect(await started).toBe('downloaded');
    expect(fakes.triggerCalls).toEqual([
      { url: fakes.created[0] as string, filename: 'src-a.wav' },
    ]);
    expect(fakes.revoked).toEqual(fakes.created);
    expect(downloads.current()).toEqual({
      sourceKey: playbackKey('alpha', 'src-a'),
      pending: false,
      error: null,
    });
  });

  it('surfaces a failure for the source it belongs to', async () => {
    const fakes = makeFakes(() => Promise.reject(new ApiError('source_too_large', 'too big', 200)));
    const downloads = new SourceDownload(fakes.deps);
    downloads.select('alpha', 'src-a');
    expect(await downloads.download('alpha', 'src-a', 'audio/wav')).toBe('failed');
    expect(downloads.current().error).toBe('too big');
    expect(downloads.current().sourceKey).toBe(playbackKey('alpha', 'src-a'));
    expect(fakes.created).toEqual([]);
  });

  it('refuses to start a download once the selection has already moved', async () => {
    const fakes = makeFakes(async (projectId, sourceId) => bytesFor(projectId, sourceId));
    const downloads = new SourceDownload(fakes.deps);
    downloads.select('alpha', 'src-b');
    expect(await downloads.download('alpha', 'src-a', 'audio/wav')).toBe('stale');
    expect(fakes.fetches).toEqual([]);
  });

  it('stops before creating a URL when the selection moves mid-fetch', async () => {
    const pending = deferred<SourceBytes>();
    const fakes = makeFakes(() => pending.promise);
    let current = true;
    const started = downloadSource(
      { ...fakes.deps, isCurrent: () => current },
      'alpha',
      'src-a',
      'src-a.wav',
      null,
    );
    current = false;
    pending.resolve(bytesFor('alpha', 'src-a'));
    expect(await started).toBe('stale');
    expect(fakes.created).toEqual([]);
    expect(fakes.triggerCalls).toEqual([]);
    expect(fakes.revoked).toEqual([]);
  });

  it('drops pending work on unmount', async () => {
    const pending = deferred<SourceBytes>();
    const fakes = makeFakes(() => pending.promise);
    const downloads = new SourceDownload(fakes.deps);
    downloads.select('alpha', 'src-a');
    const started = downloads.download('alpha', 'src-a', 'audio/wav');
    downloads.dispose();
    pending.resolve(bytesFor('alpha', 'src-a'));
    expect(await started).toBe('stale');
    expect(fakes.created).toEqual([]);
    expect(fakes.triggerCalls).toEqual([]);
    expect(downloads.current()).toEqual(IDLE_DOWNLOAD);
  });
});

function IDLE_DOWNLOAD_EXT(projectId: string, sourceId: string) {
  return { sourceKey: playbackKey(projectId, sourceId), pending: false, error: null };
}

describe('download without a token in the URL', () => {
  it('reuses the authenticated blob and revokes the temporary URL', async () => {
    const fakes = makeFakes(async (projectId, sourceId) => bytesFor(projectId, sourceId));
    const existing = new Blob(['already-fetched']);
    await downloadSource(fakes.deps, 'alpha', 'src-a', filenameFor('src-a', 'audio/wav'), existing);
    expect(fakes.fetches).toEqual([]);
    expect(fakes.triggerCalls).toEqual([
      { url: fakes.created[0] as string, filename: 'src-a.wav' },
    ]);
    expect(fakes.created[0]).toMatch(/^blob:/);
    expect(fakes.created[0]).not.toContain('token');
    expect(fakes.revoked).toEqual(fakes.created);
  });

  it('fetches through the API client when no bytes are loaded yet', async () => {
    const fakes = makeFakes(async (projectId, sourceId) => bytesFor(projectId, sourceId));
    await downloadSource(fakes.deps, 'alpha', 'src-a', filenameFor('src-a', 'video/mp4'), null);
    expect(fakes.fetches).toEqual([{ projectId: 'alpha', sourceId: 'src-a' }]);
    expect(fakes.triggerCalls[0]?.filename).toBe('src-a.mp4');
    expect(fakes.revoked).toEqual(fakes.created);
  });

  it('names downloads by source id and mime, with no source sniffing', () => {
    expect(filenameFor('id-1', 'audio/wav')).toBe('id-1.wav');
    expect(filenameFor('id-1', 'video/mp4')).toBe('id-1.mp4');
    expect(filenameFor('id-1', 'application/octet-stream')).toBe('id-1.bin');
  });
});

describe('download mount lifecycle (the hook wiring)', () => {
  it('records the selection at attach so the very first click downloads', async () => {
    // A panel that mounts with a source already active: nothing else ever
    // called select(), so download() used to refuse its own selection.
    const fakes = makeFakes(async (projectId, sourceId) => bytesFor(projectId, sourceId));
    const binding = attachSourceDownload(fakes.deps, 'alpha', 'src-a');
    expect(binding.controller.current().sourceKey).toBe(playbackKey('alpha', 'src-a'));
    expect(await binding.controller.download('alpha', 'src-a', 'audio/wav')).toBe('downloaded');
    expect(fakes.triggerCalls).toEqual([
      { url: fakes.created[0] as string, filename: 'src-a.wav' },
    ]);
    binding.detach();
  });

  it('re-arms with a live controller across StrictMode setup, cleanup, setup', async () => {
    const fakes = makeFakes(async (projectId, sourceId) => bytesFor(projectId, sourceId));
    const first = attachSourceDownload(fakes.deps, 'alpha', 'src-a');
    first.detach(); // StrictMode's extra cleanup on the first mount
    const second = attachSourceDownload(fakes.deps, 'alpha', 'src-a'); // ...and its re-setup
    expect(second.controller).not.toBe(first.controller);
    // The regression this guards: a single permanent controller stayed
    // subscribed after its own dispose(), so every later download returned
    // stale and the Download button silently did nothing in dev.
    expect(await first.controller.download('alpha', 'src-a', 'audio/wav')).toBe('stale');
    expect(await second.controller.download('alpha', 'src-a', 'audio/wav')).toBe('downloaded');
    expect(fakes.triggerCalls).toHaveLength(1);
    second.detach();
  });

  it('an in-flight download at unmount never fires and never leaks a URL', async () => {
    const pending = deferred<SourceBytes>();
    const fakes = makeFakes(() => pending.promise);
    const binding = attachSourceDownload(fakes.deps, 'alpha', 'src-a');
    const started = binding.controller.download('alpha', 'src-a', 'audio/wav');
    binding.detach();
    pending.resolve(bytesFor('alpha', 'src-a'));
    expect(await started).toBe('stale');
    expect(fakes.created).toEqual([]);
    expect(fakes.revoked).toEqual([]);
    expect(fakes.triggerCalls).toEqual([]);
  });

  it('hands nothing at all to the next selection when the source changes mid-download', async () => {
    const pending = deferred<SourceBytes>();
    const fakes = makeFakes(() => pending.promise);
    const previous = attachSourceDownload(fakes.deps, 'alpha', 'src-a');
    const started = previous.controller.download('alpha', 'src-a', 'audio/wav');
    previous.detach(); // effect cleanup for the selection change
    const next = attachSourceDownload(fakes.deps, 'alpha', 'src-b'); // effect for the new one
    pending.reject(new ApiError('unauthorized', 'Missing or invalid bearer token.', 401));
    expect(await started).toBe('stale');
    expect(next.controller.current()).toEqual({
      sourceKey: playbackKey('alpha', 'src-b'),
      pending: false,
      error: null,
    });
    expect(fakes.created).toEqual([]);
    expect(fakes.triggerCalls).toEqual([]);
    next.detach();
  });
});

describe('downloadView selection gating', () => {
  const pendingOnA: DownloadSnapshot = {
    sourceKey: playbackKey('alpha', 'src-a'),
    pending: true,
    error: null,
  };

  it('hides a pending state that belongs to another source', () => {
    expect(downloadView(pendingOnA, 'alpha', 'src-b')).toEqual(IDLE_DOWNLOAD);
    expect(downloadView(pendingOnA, 'beta', 'src-a')).toEqual(IDLE_DOWNLOAD);
  });

  it('shows an error only on the source that failed', () => {
    const failed: DownloadSnapshot = {
      sourceKey: playbackKey('alpha', 'src-a'),
      pending: false,
      error: 'Missing or invalid bearer token.',
    };
    expect(downloadView(failed, 'alpha', 'src-b')).toEqual(IDLE_DOWNLOAD);
    expect(downloadView(failed, 'alpha', 'src-a')).toBe(failed);
  });

  it('stays idle while nothing is selected', () => {
    expect(downloadView(pendingOnA, 'alpha', null)).toEqual(IDLE_DOWNLOAD);
    expect(downloadView(pendingOnA, 'alpha', '')).toEqual(IDLE_DOWNLOAD);
  });
});
