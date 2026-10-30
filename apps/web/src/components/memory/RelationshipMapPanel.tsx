import type { MemoryGraph, MemoryGraphNode } from '@mml/shared';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';

/**
 * Relationship map (gap G-9 remainder, D052 follow-up): a pure-client SVG
 * rendering of the SAME graph payload the timeline stream reads — no
 * server-side layout, no second endpoint. Chains read left to right, oldest
 * first, corrections as arrows; the current claim is accented, superseded or
 * expired nodes muted. A text list of the same chains accompanies the SVG so
 * the information is never visual-only.
 */

interface Chain {
  nodes: MemoryGraphNode[];
}

/** Group nodes into connected components via the edges (union-find). */
function buildChains(graph: MemoryGraph): Chain[] {
  const parent = new Map<string, string>(graph.nodes.map((node) => [node.id, node.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  for (const edge of graph.edges) {
    const a = find(edge.old_id);
    const b = find(edge.new_id);
    if (a !== b) parent.set(a, b);
  }
  const byRoot = new Map<string, MemoryGraphNode[]>();
  for (const node of graph.nodes) {
    const root = find(node.id);
    byRoot.set(root, [...(byRoot.get(root) ?? []), node]);
  }
  const chains: Chain[] = [];
  for (const members of byRoot.values()) {
    // Order each chain topologically: a node whose old-end has no predecessor
    // in this component comes first; ties fall back to created_at.
    const ordered: MemoryGraphNode[] = [];
    const remaining = new Map(members.map((node) => [node.id, node]));
    const incoming = new Map<string, string>(graph.edges.map((edge) => [edge.new_id, edge.old_id]));
    let cursor: MemoryGraphNode | undefined = members.find((node) => {
      const prev = incoming.get(node.id);
      return !prev || !remaining.has(prev);
    });
    while (cursor) {
      const current = cursor;
      ordered.push(current);
      remaining.delete(current.id);
      const nextEdge = graph.edges.find((edge) => edge.old_id === current.id);
      cursor = nextEdge ? remaining.get(nextEdge.new_id) : remaining.values().next().value;
    }
    chains.push({ nodes: ordered });
  }
  chains.sort((a, b) => ((a.nodes[0]?.created_at ?? '') < (b.nodes[0]?.created_at ?? '') ? -1 : 1));
  return chains;
}

const NODE_W = 170;
const NODE_H = 34;
const GAP_X = 70;
const GAP_Y = 46;

export function RelationshipMapPanel() {
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

  const chains = graph ? buildChains(graph) : [];
  const width = Math.max(
    320,
    ...chains.map((chain) => chain.nodes.length * (NODE_W + GAP_X) - GAP_X + 24),
  );
  const height = Math.max(1, chains.length) * (NODE_H + GAP_Y) - GAP_Y + 24;

  return (
    <section aria-label="Memory relationship map" className="panel p-3">
      <h3 className="text-[12px] font-semibold text-ink">Relationship map</h3>
      {error ? (
        <p role="alert" className="mt-1 text-[11px] text-err">
          Relationship map unavailable: {error}
        </p>
      ) : !graph ? (
        <p className="mt-1 text-[11px] text-muted">Reading supersession links…</p>
      ) : graph.nodes.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted">
          Nothing to map yet — memories appear here when they are saved.
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${String(width)} ${String(height)}`}
            width="100%"
            role="img"
            aria-label={`Supersession map: ${String(graph.edges.length)} correction link${
              graph.edges.length === 1 ? '' : 's'
            } across ${String(graph.nodes.length)} memories`}
            className="mt-2 max-h-64"
          >
            {chains.map((chain, row) => {
              const y = 12 + row * (NODE_H + GAP_Y);
              return (
                <g key={chain.nodes[0]?.id ?? String(row)}>
                  {chain.nodes.slice(0, -1).map((node, index) => (
                    <line
                      key={`edge-${node.id}`}
                      x1={12 + index * (NODE_W + GAP_X) + NODE_W}
                      x2={12 + (index + 1) * (NODE_W + GAP_X)}
                      y1={y + NODE_H / 2}
                      y2={y + NODE_H / 2}
                      stroke="var(--color-line-bright)"
                      strokeWidth={1.5}
                      markerEnd="url(#map-arrow)"
                    />
                  ))}
                  {chain.nodes.map((node, index) => {
                    const x = 12 + index * (NODE_W + GAP_X);
                    const current = node.status === 'active';
                    return (
                      <g key={node.id}>
                        <rect
                          x={x}
                          y={y}
                          width={NODE_W}
                          height={NODE_H}
                          rx={8}
                          fill={current ? 'var(--color-surface-2)' : 'var(--color-surface)'}
                          stroke={current ? 'var(--color-accent)' : 'var(--color-line)'}
                          strokeWidth={current ? 1.6 : 1}
                          opacity={current ? 1 : 0.72}
                        />
                        <text
                          x={x + 8}
                          y={y + 14}
                          className="fill-[var(--color-ink-dim)]"
                          fontSize={10}
                        >
                          {node.excerpt.length > 26
                            ? `${node.excerpt.slice(0, 25)}…`
                            : node.excerpt}
                        </text>
                        <text
                          x={x + 8}
                          y={y + 26}
                          className="fill-[var(--color-muted)]"
                          fontSize={8.5}
                        >
                          {node.status} · {node.type}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
            <defs>
              <marker
                id="map-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill="var(--color-line-bright)" />
              </marker>
            </defs>
          </svg>
          <ul className="mt-2 space-y-1">
            {chains.map((chain) => (
              <li
                key={chain.nodes.map((node) => node.id).join('-')}
                className="text-[11px] text-muted"
              >
                {chain.nodes.map((node) => node.excerpt).join(' → ')}
                {chain.nodes.length === 1 && graph.edges.length === 0
                  ? ' — no corrections yet'
                  : ''}
              </li>
            ))}
          </ul>
          {graph.truncated ? (
            <p className="mt-1 text-[10.5px] text-muted">
              The store is larger than shown; the map covers the most recently updated memories.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
