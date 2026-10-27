export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

export function formatTokens(value: number): string {
  return value.toLocaleString('en-US');
}

/** Shorten a filesystem path for display without hiding its tail. */
export function shortenPath(path: string, keep = 34): string {
  if (path.length <= keep) return path;
  const tail = path.slice(path.length - keep);
  // Start at a path separator so the result never begins mid-directory.
  const boundary = tail.indexOf('/');
  return `…${boundary > 0 ? tail.slice(boundary) : tail}`;
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) return 'never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Date + time for audit trails, where the day matters as much as the clock. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Compact byte count for artifact metadata. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Human label for a project identifier such as `forge-demo`. */
export function humanizeId(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

/** A short, monospace-safe rendering of an integrity hash. */
export function shortSha(sha: string | null | undefined, length = 8): string {
  if (!sha) return '—';
  return sha.slice(0, length);
}
