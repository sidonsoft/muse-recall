/**
 * Authenticated source playback lifecycle (Batch D fix).
 *
 * Browser media elements and download links cannot send the bearer header, so
 * under ACCESS_TOKEN a direct `/media/sources/:id/bytes` URL returns 401. The
 * bytes therefore come through the API client and reach the element as a
 * `blob:` object URL, which carries no credentials of its own.
 *
 * This module is framework-free (the React hook below is a thin wrapper) so
 * the URL lifecycle, the stale-response fence, and the download path are all
 * testable with injected fakes — no DOM, no jsdom, no network.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, type SourceBytes } from '../../lib/api.ts';

export type PlaybackStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PlaybackSnapshot {
  /** `project:source` the snapshot describes, or '' when nothing is loaded. */
  sourceKey: string;
  status: PlaybackStatus;
  /** Object URL for the element; null unless `status === 'ready'`. */
  objectUrl: string | null;
  blob: Blob | null;
  mime: string | null;
  byteLength: number;
  error: { code: string; message: string } | null;
}

export const IDLE_SNAPSHOT: PlaybackSnapshot = {
  sourceKey: '',
  status: 'idle',
  objectUrl: null,
  blob: null,
  mime: null,
  byteLength: 0,
  error: null,
};

export function playbackKey(projectId: string, sourceId: string): string {
  return `${projectId}:${sourceId}`;
}

/** What the panel shows instead of a media element, per playback status. */
export function playbackMessage(snapshot: PlaybackSnapshot): string {
  if (snapshot.status === 'loading') return 'Loading source bytes\u2026';
  if (snapshot.status === 'error')
    return `Playback unavailable: ${snapshot.error?.message ?? 'unknown error'}`;
  return 'Source bytes are not loaded.';
}

export interface PlaybackDeps {
  fetchBytes: (projectId: string, sourceId: string) => Promise<SourceBytes>;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
}

/**
 * One controller per (project, source) mount. A new `load` or `dispose`
 * advances the fence, so an in-flight response for an older key can neither
 * publish a URL nor be mistaken for the current source's bytes.
 */
export class SourcePlayback {
  private readonly deps: PlaybackDeps;
  private readonly listeners = new Set<(snapshot: PlaybackSnapshot) => void>();
  private snapshot: PlaybackSnapshot = IDLE_SNAPSHOT;
  private fence = 0;
  private url: string | null = null;
  private disposed = false;

  constructor(deps: PlaybackDeps) {
    this.deps = deps;
  }

  current(): PlaybackSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: PlaybackSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Load bytes for one exact project+source, replacing any previous source.
   * Resolves once the outcome (ready or error) has been published, so callers
   * and tests can sequence without polling.
   */
  load(projectId: string, sourceId: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    // Any URL for the previous source is dropped before the new fetch even
    // starts: a stale cross-project preview must never remain reachable.
    this.revokeCurrentUrl();
    const token = ++this.fence;
    this.publish({
      ...IDLE_SNAPSHOT,
      sourceKey: playbackKey(projectId, sourceId),
      status: 'loading',
    });
    return this.deps
      .fetchBytes(projectId, sourceId)
      .then((bytes) => {
        if (this.disposed || token !== this.fence) return; // stale: drop it
        const url = this.deps.createUrl(bytes.blob);
        this.url = url;
        this.publish({
          sourceKey: playbackKey(projectId, sourceId),
          status: 'ready',
          objectUrl: url,
          blob: bytes.blob,
          mime: bytes.mime,
          byteLength: bytes.byteLength,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (this.disposed || token !== this.fence) return;
        this.publish({
          sourceKey: playbackKey(projectId, sourceId),
          status: 'error',
          objectUrl: null,
          blob: null,
          mime: null,
          byteLength: 0,
          error: {
            code:
              error instanceof Error && 'code' in error
                ? String((error as { code: unknown }).code)
                : 'playback_failed',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      });
  }

  /** Drop everything: late responses are fenced out and the URL is revoked. */
  dispose(): void {
    this.disposed = true;
    this.fence += 1;
    this.revokeCurrentUrl();
    this.snapshot = IDLE_SNAPSHOT;
  }

  private revokeCurrentUrl(): void {
    if (this.url === null) return;
    const url = this.url;
    this.url = null;
    this.deps.revokeUrl(url);
  }

  private publish(snapshot: PlaybackSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

export interface DownloadDeps {
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  /** Attach an `<a download>` to the document and click it. */
  trigger: (url: string, filename: string) => void;
}

/**
 * Download without exposing a token: reuse the already-authenticated blob when
 * present (no second fetch), otherwise fetch it through the API client, and
 * hand the browser a `blob:` URL that carries no credentials.
 */
export async function downloadSource(
  deps: DownloadDeps & PlaybackDeps,
  projectId: string,
  sourceId: string,
  filename: string,
  existing: Blob | null,
): Promise<void> {
  const bytes = existing !== null ? { blob: existing } : await deps.fetchBytes(projectId, sourceId);
  const url = deps.createUrl(bytes.blob);
  try {
    deps.trigger(url, filename);
  } finally {
    deps.revokeUrl(url);
  }
}

/** React wrapper: one controller per project+source, revoked on every change. */
export function useSourcePlayback(projectId: string, sourceId: string | null): PlaybackSnapshot {
  const [snapshot, setSnapshot] = useState<PlaybackSnapshot>(IDLE_SNAPSHOT);

  useEffect(() => {
    if (sourceId === null || sourceId.length === 0) {
      setSnapshot(IDLE_SNAPSHOT);
      return;
    }
    const playback = new SourcePlayback({
      fetchBytes: (project, source) => api.mediaSourceBytes(project, source),
      createUrl: (blob) => URL.createObjectURL(blob),
      revokeUrl: (url) => URL.revokeObjectURL(url),
    });
    const unsubscribe = playback.subscribe(setSnapshot);
    playback.load(projectId, sourceId);
    return () => {
      unsubscribe();
      playback.dispose();
    };
  }, [projectId, sourceId]);

  return snapshot;
}

/** Download state for the current selection; fetches bytes only on demand. */
export function useSourceDownload(
  projectId: string,
  sourceId: string | null,
  mime: string | null,
): { download: () => void; pending: boolean; error: string | null } {
  const [state, setState] = useState<{ pending: boolean; error: string | null }>({
    pending: false,
    error: null,
  });

  const download = useCallback(() => {
    if (sourceId === null || sourceId.length === 0) return;
    setState((previous) => ({ ...previous, pending: true, error: null }));
    void downloadSource(
      {
        fetchBytes: (project, source) => api.mediaSourceBytes(project, source),
        createUrl: (blob) => URL.createObjectURL(blob),
        revokeUrl: (url) => URL.revokeObjectURL(url),
        trigger: (url, filename) => {
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = filename;
          anchor.rel = 'noopener';
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
        },
      },
      projectId,
      sourceId,
      filenameFor(sourceId, mime ?? ''),
      null,
    ).then(
      () => setState({ pending: false, error: null }),
      (error: unknown) =>
        setState({
          pending: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  }, [projectId, sourceId, mime]);

  return { download: download, pending: state.pending, error: state.error };
}

/** Filename for a downloaded source, matching the server's own naming. */
export function filenameFor(sourceId: string, mime: string): string {
  const extension = mime === 'video/mp4' ? 'mp4' : mime === 'audio/wav' ? 'wav' : 'bin';
  return `${sourceId}.${extension}`;
}
