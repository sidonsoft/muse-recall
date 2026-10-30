import type { MemoryGraph } from '@mml/shared';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';

/**
 * Timeline & relationships (gap G-9 remainder, D052): a human-readable stream
 * over the SAME supersession edges the graph endpoint serves — created and
 * corrected events, newest first. Deliberately read-only: the inspector stays
 * the place that acts on memories. Edges are counted, not drawn; a canvas
 * view can layer on later without touching this contract.
 */

export function TimelinePanel() {
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .memoryGraph()
      .then((next) => {
        if (alive) setGraph(next);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      alive = false;
    };
  }, []);

  const excerpts = new Map((graph?.nodes ?? []).map((node) => [node.id, node.excerpt]));

  return (
    <section aria-label="Memory timeline" className="panel p-3">
      <h3 className="text-[12px] font-semibold text-ink">Timeline &amp; relationships</h3>
      {error ? (
        <p role="alert" className="mt-1 text-[11px] text-err">
          Timeline unavailable: {error}
        </p>
      ) : !graph ? (
        <p className="mt-1 text-[11px] text-muted">Reading supersession history…</p>
      ) : graph.events.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted">
          No memories yet — the timeline starts with the first saved memory.
        </p>
      ) : (
        <>
          <ol className="mt-2 space-y-1.5">
            {graph.events.slice(0, 12).map((event, index) => (
              <li
                key={`${event.kind}-${event.memory_id}-${String(index)}`}
                className="flex items-baseline gap-2 text-[11px]"
              >
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    event.kind === 'corrected'
                      ? 'bg-accent/15 text-ink-dim'
                      : 'bg-surface-2 text-muted'
                  }`}
                >
                  {event.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-dim">
                  {event.kind === 'corrected' ? 'corrected → ' : ''}
                  {excerpts.get(event.memory_id) ?? 'memory no longer listed'}
                </span>
                <time dateTime={event.at} className="shrink-0 text-[10.5px] text-muted">
                  {formatDateTime(event.at)}
                </time>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[10.5px] text-muted">
            {graph.edges.length === 0
              ? 'No corrections recorded yet — every memory is still current.'
              : `${String(graph.edges.length)} supersession link${graph.edges.length === 1 ? '' : 's'}: a correction replaces an earlier claim; history is preserved, never rewritten.`}
            {graph.truncated ? ' Most recent events shown; the store is larger.' : ''}
          </p>
        </>
      )}
    </section>
  );
}
