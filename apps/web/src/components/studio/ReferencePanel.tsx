import type { MediaSegmentMatch, MediaSuggestion } from '@mml/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.ts';

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

const SUGGESTION_TYPES = ['preference', 'constraint', 'technical_decision'] as const;

interface EditableSuggestion extends MediaSuggestion {
  key: number;
}

/**
 * Batch C — visual references and SAM object extraction.
 *
 * Suggestions are drafts: proposing sends them to the memory review queue
 * as `proposed` records, and dismissing drops them so they never enter
 * memory at all. Cutouts save the chosen match as a new versioned asset
 * with SAM provenance, flowing through the normal approve/Insert/embed
 * path unchanged.
 */
export function ReferencePanel({
  projectId,
  assetId,
  version,
  onChanged,
}: {
  projectId: string;
  assetId: string;
  version: number;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<'suggest' | 'segment' | null>(null);

  return (
    <div className="space-y-1.5 rounded border border-line/70 px-2 py-1.5">
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setMode(mode === 'suggest' ? null : 'suggest')}
          className="rounded border border-line px-1.5 py-0.5 font-mono text-[9.5px] text-ink-dim underline decoration-dotted"
          title="Suggest project decisions from this image"
        >
          suggest
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === 'segment' ? null : 'segment')}
          className="rounded border border-line px-1.5 py-0.5 font-mono text-[9.5px] text-ink-dim underline decoration-dotted"
          title="Extract an object cutout with SAM"
        >
          segment
        </button>
      </div>
      {mode === 'suggest' ? (
        <SuggestDecisions
          projectId={projectId}
          assetId={assetId}
          version={version}
          onClose={() => setMode(null)}
        />
      ) : null}
      {mode === 'segment' ? (
        <SegmentObject
          projectId={projectId}
          assetId={assetId}
          version={version}
          onChanged={onChanged}
          onClose={() => setMode(null)}
        />
      ) : null}
    </div>
  );
}

function SuggestDecisions({
  projectId,
  assetId,
  version,
  onClose,
}: {
  projectId: string;
  assetId: string;
  version: number;
  onClose: () => void;
}) {
  const [guidance, setGuidance] = useState('');
  const [suggestions, setSuggestions] = useState<EditableSuggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [nextKey, setNextKey] = useState(0);
  // Fenced against identity switches: the parent remounts this subtree per
  // source version, and any late inference from the previous mount is
  // dropped instead of attributing v1 results to v2.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const suggest = (): void => {
    setBusy(true);
    setNotice(null);
    void api
      .mediaSuggest(projectId, {
        assetId,
        version,
        ...(guidance.trim().length > 0 ? { guidance: guidance.trim() } : {}),
      })
      .then((response) => {
        if (!mounted.current) return;
        setSuggestions(
          response.suggestions.map((suggestion, index) => ({
            ...suggestion,
            key: nextKey + index,
          })),
        );
        setNextKey((value) => value + response.suggestions.length);
        if (response.suggestions.length === 0) {
          setNotice({ tone: 'ok', text: 'No suggestions — the image implies no clear decisions.' });
        }
      })
      .catch((error: unknown) => {
        if (mounted.current) setNotice({ tone: 'err', text: messageOf(error) });
      })
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
  };

  const propose = (suggestion: EditableSuggestion): void => {
    setBusy(true);
    setNotice(null);
    void api
      .proposeMemory({
        type: suggestion.type,
        scope: 'project',
        project_id: projectId,
        content: suggestion.content,
        source: { session_id: null, reference: `muse-asset://${assetId}/v${version}` },
        confidence: suggestion.confidence,
        validation_status: 'unverified',
      })
      .then(() => {
        if (!mounted.current) return;
        setSuggestions((current) =>
          current === null ? current : current.filter((entry) => entry.key !== suggestion.key),
        );
        setNotice({ tone: 'ok', text: 'Proposed to memory — confirm it in the Memory review.' });
      })
      .catch((error: unknown) => setNotice({ tone: 'err', text: messageOf(error) }))
      .finally(() => setBusy(false));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <input
          value={guidance}
          onChange={(event) => setGuidance(event.target.value)}
          placeholder="What to look for (optional)"
          aria-label="Suggestion guidance"
          className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-[10.5px] text-ink placeholder:text-muted"
        />
        <button
          type="button"
          disabled={busy}
          onClick={suggest}
          className="rounded bg-accent px-2 py-1 text-[10.5px] font-medium text-accent-ink disabled:opacity-50"
        >
          Suggest
        </button>
        <button type="button" onClick={onClose} className="text-[10.5px] text-muted underline">
          close
        </button>
      </div>
      {notice ? (
        <p className={`text-[10px] ${notice.tone === 'ok' ? 'text-ok' : 'text-err'}`}>
          {notice.text}
        </p>
      ) : null}
      {suggestions !== null && suggestions.length === 0 && notice === null ? (
        <p className="text-[10px] text-muted">No suggestions returned.</p>
      ) : null}
      {suggestions?.map((suggestion) => (
        <div key={suggestion.key} className="space-y-1 rounded border border-line/60 p-1.5">
          <div className="flex items-center gap-1.5">
            <select
              value={suggestion.type}
              onChange={(event) =>
                setSuggestions((current) =>
                  current === null
                    ? current
                    : current.map((entry) =>
                        entry.key === suggestion.key
                          ? {
                              ...entry,
                              type: event.target.value as EditableSuggestion['type'],
                            }
                          : entry,
                      ),
                )
              }
              aria-label="Suggestion type"
              className="rounded border border-line bg-surface px-1 py-0.5 font-mono text-[9.5px] text-ink"
            >
              {SUGGESTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <span className="font-mono text-[9.5px] text-muted">
              {(suggestion.confidence * 100).toFixed(0)}%
            </span>
          </div>
          <textarea
            value={suggestion.content}
            onChange={(event) =>
              setSuggestions((current) =>
                current === null
                  ? current
                  : current.map((entry) =>
                      entry.key === suggestion.key
                        ? { ...entry, content: event.target.value }
                        : entry,
                    ),
              )
            }
            rows={2}
            aria-label="Suggestion content"
            className="w-full rounded border border-line bg-surface px-1.5 py-1 text-[10.5px] text-ink"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy || suggestion.content.trim().length === 0}
              onClick={() => propose({ ...suggestion, content: suggestion.content.trim() })}
              className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-ink disabled:opacity-50"
            >
              Propose to memory
            </button>
            <button
              type="button"
              onClick={() =>
                setSuggestions((current) =>
                  current === null
                    ? current
                    : current.filter((entry) => entry.key !== suggestion.key),
                )
              }
              className="text-[10px] text-muted underline decoration-dotted"
              title="Dismiss — this suggestion never enters memory"
            >
              dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function SegmentObject({
  projectId,
  assetId,
  version,
  onChanged,
  onClose,
}: {
  projectId: string;
  assetId: string;
  version: number;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [concept, setConcept] = useState('');
  const [segmentId, setSegmentId] = useState<string | null>(null);
  const [matches, setMatches] = useState<MediaSegmentMatch[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  // Same mount fence as suggestions: a late segment response from a
  // previous source version never lands under the new reference target.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const runSegment = (): void => {
    const text = concept.trim();
    if (text.length === 0) return;
    setBusy(true);
    setNotice(null);
    setMatches(null);
    setSegmentId(null);
    void api
      .mediaSegment(projectId, { assetId, version, concept: text })
      .then((response) => {
        if (!mounted.current) return;
        setSegmentId(response.segment_id);
        setMatches(response.matches);
        setSelected(0);
        if (response.matches.length === 0) {
          setNotice({
            tone: 'ok',
            text: `No objects matched “${text}” — try a more specific noun.`,
          });
        }
      })
      .catch((error: unknown) => {
        if (mounted.current) setNotice({ tone: 'err', text: messageOf(error) });
      })
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
  };

  const saveCutout = (): void => {
    if (segmentId === null || matches === null || matches[selected] === undefined) return;
    setBusy(true);
    setNotice(null);
    void api
      .mediaCutout(projectId, segmentId, selected)
      .then((record) => {
        if (!mounted.current) return;
        setNotice({
          tone: 'ok',
          text: `Cutout saved as a new candidate asset (v${record.version}). Approve it to embed.`,
        });
        onChanged();
      })
      .catch((error: unknown) => {
        if (mounted.current) setNotice({ tone: 'err', text: messageOf(error) });
      })
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
  };

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <input
          value={concept}
          onChange={(event) => setConcept(event.target.value)}
          placeholder="Object noun, e.g. red bicycle"
          aria-label="Segmentation concept"
          className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-[10.5px] text-ink placeholder:text-muted"
        />
        <button
          type="button"
          disabled={busy || concept.trim().length === 0}
          onClick={runSegment}
          className="rounded bg-accent px-2 py-1 text-[10.5px] font-medium text-accent-ink disabled:opacity-50"
        >
          Segment
        </button>
        <button type="button" onClick={onClose} className="text-[10.5px] text-muted underline">
          close
        </button>
      </div>
      {notice ? (
        <p className={`text-[10px] ${notice.tone === 'ok' ? 'text-ok' : 'text-err'}`}>
          {notice.text}
        </p>
      ) : null}
      {matches !== null && matches.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] text-muted">
            {matches.length} match{matches.length === 1 ? '' : 'es'} — inspect, select, save.
          </p>
          <div className="grid grid-cols-3 gap-1">
            {matches.map((match) => (
              <button
                key={match.match_index}
                type="button"
                onClick={() => setSelected(match.match_index)}
                aria-pressed={selected === match.match_index}
                className={`rounded border p-0.5 ${
                  selected === match.match_index ? 'border-accent' : 'border-line/60'
                }`}
                title={`Match ${match.match_index}: box ${match.box.x1},${match.box.y1}–${match.box.x2},${match.box.y2}${match.confidence !== undefined ? ` (${(match.confidence * 100).toFixed(0)}%)` : ''}`}
              >
                <img
                  src={match.preview_data_url}
                  alt={`Match ${match.match_index} preview`}
                  className="aspect-square w-full rounded object-cover"
                />
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || segmentId === null}
            onClick={saveCutout}
            className="rounded bg-accent px-2 py-1 text-[10.5px] font-medium text-accent-ink disabled:opacity-50"
          >
            Save cutout of match {selected}
          </button>
        </div>
      ) : null}
    </div>
  );
}
