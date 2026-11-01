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

import { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * The snapshot the panel may actually render for THIS project+source.
 *
 * A prop change renders once before the effect that swaps the playback
 * controller runs, so the previous source's `ready` snapshot (and its blob
 * URL) is still in state during that render. Keying the element is not enough:
 * the snapshot itself has to be filtered, or the old bytes show under the new
 * selection. Anything that does not match becomes a neutral loading view.
 */
export function playbackView(
  snapshot: PlaybackSnapshot,
  projectId: string,
  sourceId: string,
): PlaybackSnapshot {
  const wanted = playbackKey(projectId, sourceId);
  if (snapshot.sourceKey === wanted) return snapshot;
  return { ...IDLE_SNAPSHOT, sourceKey: wanted, status: 'loading' };
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
  /**
   * False once the selection has moved. Checked after the fetch returns and
   * before any side effect, so a response for a source the person stopped
   * selecting can neither create a URL nor start a download.
   */
  isCurrent?: () => boolean;
}

export type DownloadOutcome = 'downloaded' | 'stale' | 'failed';

function isStale(deps: DownloadDeps): boolean {
  return deps.isCurrent !== undefined && !deps.isCurrent();
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
): Promise<DownloadOutcome> {
  if (isStale(deps)) return 'stale';
  const bytes = existing !== null ? { blob: existing } : await deps.fetchBytes(projectId, sourceId);
  if (isStale(deps)) return 'stale';
  const url = deps.createUrl(bytes.blob);
  try {
    deps.trigger(url, filename);
  } finally {
    deps.revokeUrl(url);
  }
  return 'downloaded';
}

export interface DownloadSnapshot {
  /** `project:source` the download state belongs to, '' when nothing started. */
  sourceKey: string;
  pending: boolean;
  error: string | null;
}

export const IDLE_DOWNLOAD: DownloadSnapshot = { sourceKey: '', pending: false, error: null };

/**
 * Download lifecycle bound to one selection. `select` advances the fence, so a
 * pending fetch for a source that is no longer selected cannot report
 * progress, an error, or a download against the new selection.
 */
export class SourceDownload {
  private readonly deps: PlaybackDeps & DownloadDeps;
  private readonly listeners = new Set<(snapshot: DownloadSnapshot) => void>();
  private snapshot: DownloadSnapshot = IDLE_DOWNLOAD;
  private fence = 0;
  private disposed = false;

  constructor(deps: PlaybackDeps & DownloadDeps) {
    this.deps = deps;
  }

  current(): DownloadSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: DownloadSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The selected source changed: drop any pending state for the old one. */
  select(projectId: string, sourceId: string | null): void {
    this.fence += 1;
    this.publish({
      ...IDLE_DOWNLOAD,
      sourceKey: sourceId === null || sourceId.length === 0 ? '' : playbackKey(projectId, sourceId),
    });
  }

  /** Start a download for the currently selected project+source. */
  download(
    projectId: string,
    sourceId: string,
    mime: string,
    existing: Blob | null = null,
  ): Promise<DownloadOutcome> {
    const key = playbackKey(projectId, sourceId);
    if (this.disposed || this.snapshot.sourceKey !== key) return Promise.resolve('stale');
    const token = ++this.fence;
    const deps: DownloadDeps & PlaybackDeps = {
      fetchBytes: this.deps.fetchBytes,
      createUrl: this.deps.createUrl,
      revokeUrl: this.deps.revokeUrl,
      isCurrent: () => !this.disposed && token === this.fence,
      trigger: (url, filename) => {
        // Guarded again: a completion can race a click on a different source.
        if (deps.isCurrent !== undefined && !deps.isCurrent()) return;
        this.deps.trigger(url, filename);
      },
    };
    this.publish({ sourceKey: key, pending: true, error: null });
    return downloadSource(deps, projectId, sourceId, filenameFor(sourceId, mime), existing).then(
      (outcome) => {
        if (deps.isCurrent !== undefined && !deps.isCurrent()) return 'stale';
        this.publish({ sourceKey: key, pending: false, error: null });
        return outcome === 'stale' ? 'stale' : 'downloaded';
      },
      (error: unknown) => {
        if (deps.isCurrent !== undefined && !deps.isCurrent()) return 'stale';
        this.publish({
          sourceKey: key,
          pending: false,
          error: error instanceof Error ? error.message : String(error),
        });
        return 'failed';
      },
    );
  }

  dispose(): void {
    this.disposed = true;
    this.fence += 1;
    this.snapshot = IDLE_DOWNLOAD;
  }

  private publish(snapshot: DownloadSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
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

/**
 * Download state for the current selection. The fence advances during render,
 * not in an effect, so a completion arriving between the prop change and the
 * effect cannot paint the old source's progress or error onto the new one.
 */
export function useSourceDownload(
  projectId: string,
  sourceId: string | null,
  mime: string | null,
): { download: () => void; pending: boolean; error: string | null } {
  const controllerRef = useRef<SourceDownload | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new SourceDownload({
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
    });
  }
  const controller = controllerRef.current;
  const [snapshot, setSnapshot] = useState<DownloadSnapshot>(IDLE_DOWNLOAD);

  const key = sourceId === null || sourceId.length === 0 ? '' : playbackKey(projectId, sourceId);
  const [previousKey, setPreviousKey] = useState(key);
  if (previousKey !== key) {
    // React's "adjust state while rendering" pattern: the reset lands on the
    // same render that shows the new selection, never one render later.
    setPreviousKey(key);
    controller.select(projectId, sourceId);
    setSnapshot(controller.current());
  }

  useEffect(() => controller.subscribe(setSnapshot), [controller]);
  useEffect(() => () => controller.dispose(), [controller]);

  const download = useCallback(() => {
    if (sourceId === null || sourceId.length === 0) return;
    void controller.download(projectId, sourceId, mime ?? '');
  }, [controller, projectId, sourceId, mime]);

  // Only the current selection's state is ever surfaced.
  const visible = snapshot.sourceKey === key ? snapshot : IDLE_DOWNLOAD;
  return { download, pending: visible.pending, error: visible.error };
}

/** Filename for a downloaded source, matching the server's own naming. */
export function filenameFor(sourceId: string, mime: string): string {
  const extension = mime === 'video/mp4' ? 'mp4' : mime === 'audio/wav' ? 'wav' : 'bin';
  return `${sourceId}.${extension}`;
}
