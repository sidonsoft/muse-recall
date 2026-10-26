import type {
  CapturedMemory,
  MemoryCandidate,
  Project,
  RetrievalMetadata,
  RetrievedMemory,
  ServiceMeta,
  Session,
  SessionDetail,
} from '@mml/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../lib/api.ts';
import { formatTimestamp } from '../../lib/format.ts';
import { streamTurn } from '../../lib/turn-stream.ts';
import { Icon } from '../Icon.tsx';
import { StatusPill } from '../ui.tsx';
import { MessageBubble } from './MessageBubble.tsx';

/**
 * Conversations.
 *
 * Sessions are independent: switching conversations never carries a transcript
 * into another one. Every assistant turn shows what the application retrieved
 * for it, and the composer can turn memory capture off entirely.
 */
export function ConversationsView({ meta }: { meta: ServiceMeta | null }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [streamRetrieval, setStreamRetrieval] = useState<{
    metadata: RetrievalMetadata;
    results: RetrievedMemory[];
  } | null>(null);
  const [streamCaptures, setStreamCaptures] = useState<CapturedMemory[]>([]);
  const [pendingUser, setPendingUser] = useState<string | null>(null);

  const [input, setInput] = useState('');
  const [captureEnabled, setCaptureEnabled] = useState(true);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);

  const [creating, setCreating] = useState(false);
  const [newProject, setNewProject] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const refreshSessions = useCallback(async () => {
    try {
      const [list, projectList] = await Promise.all([api.listSessions(), api.projects()]);
      setSessions(list.items);
      setProjects(projectList);
      setActiveId((current) => current ?? list.items[0]?.id ?? null);
    } catch (cause) {
      setError(toError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshDetail = useCallback(async (sessionId: string) => {
    try {
      setDetail(await api.session(sessionId));
    } catch (cause) {
      setError(toError(cause));
    }
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    void refreshDetail(activeId);
  }, [activeId, refreshDetail]);

  // Scroll when the transcript grows or a streamed token arrives. The key is
  // referenced in the effect so the dependency is intentional, not incidental.
  const scrollKey = `${detail?.messages.length ?? 0}:${streamText.length}:${pendingUser ? 1 : 0}`;
  useEffect(() => {
    if (!scrollKey) return;
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [scrollKey]);

  async function handleCreate() {
    try {
      const session = await api.createSession({ project_id: newProject.trim() || null });
      setSessions((current) => [session, ...current]);
      setActiveId(session.id);
      setCreating(false);
      setNewProject('');
      setNotice('Conversation started. It shares project memory, not another transcript.');
    } catch (cause) {
      setError(toError(cause));
    }
  }

  async function handleSend() {
    const content = input.trim();
    if (!content || streaming || !activeId) return;

    setInput('');
    setPendingUser(content);
    setStreamText('');
    setStreamRetrieval(null);
    setStreamCaptures([]);
    setCandidates([]);
    setError(null);
    setNotice(null);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamTurn(
        activeId,
        { content, capture_memories: captureEnabled },
        {
          onRetrieval: (metadata, results) => setStreamRetrieval({ metadata, results }),
          onMemoryCaptured: (captures) => setStreamCaptures(captures),
          onDelta: (text) => setStreamText((current) => current + text),
          onCompleted: (turn) => {
            setCandidates(turn.candidates);
            if (turn.captures.length > 0) {
              setNotice(
                `Saved ${turn.captures.length} memory record(s) for this project. They are available to every session in it.`,
              );
            }
            void refreshDetail(activeId);
            void refreshSessions();
          },
          onError: (streamError) => setError(streamError),
        },
        controller.signal,
      );
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        setNotice('Turn cancelled. Partial output, if any, is saved as interrupted.');
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (activeId) void refreshDetail(activeId);
      } else {
        setError(toError(cause));
      }
    } finally {
      setStreaming(false);
      setPendingUser(null);
      setStreamText('');
      setStreamRetrieval(null);
      setStreamCaptures([]);
      abortRef.current = null;
    }
  }

  async function handleSaveCandidate(candidate: MemoryCandidate) {
    try {
      await api.createMemory({
        type: candidate.type,
        scope: detail?.project_id ? 'project' : 'global',
        project_id: detail?.project_id ?? null,
        content: candidate.content,
        confidence: candidate.confidence,
        validation_status: 'unverified',
        source: { session_id: activeId, reference: 'suggested-candidate' },
      });
      setCandidates((current) => current.filter((entry) => entry.content !== candidate.content));
      setNotice('Candidate stored as an unverified memory. Confirm it in the Memory inspector.');
    } catch (cause) {
      setError(toError(cause));
    }
  }

  async function handleArchive() {
    if (!detail) return;
    try {
      const next = detail.status === 'archived' ? 'active' : 'archived';
      await api.updateSession(detail.id, { status: next });
      await refreshSessions();
      await refreshDetail(detail.id);
    } catch (cause) {
      setError(toError(cause));
    }
  }

  async function handleDelete() {
    if (!detail) return;
    if (!window.confirm('Delete this conversation and its transcript? This cannot be undone.')) {
      return;
    }
    try {
      await api.deleteSession(detail.id);
      setDetail(null);
      setActiveId(null);
      await refreshSessions();
    } catch (cause) {
      setError(toError(cause));
    }
  }

  const activeSession = detail;

  return (
    <div className="grid h-[calc(100dvh-9.5rem)] min-h-0 gap-4 xl:grid-cols-[250px_minmax(0,1fr)]">
      {/* ---------------- Sessions ---------------- */}
      <aside className="flex min-h-0 flex-col gap-2">
        <button
          type="button"
          onClick={() => setCreating((current) => !current)}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-accent-dim"
        >
          <Icon name={creating ? 'close' : 'plus'} className="size-3.5" />
          {creating ? 'Cancel' : 'New conversation'}
        </button>

        {creating ? (
          <div className="space-y-1.5 rounded-lg border border-line bg-surface p-2">
            <label className="block text-[10px] text-muted" htmlFor="new-project">
              Project scope (memory is shared here)
            </label>
            <input
              id="new-project"
              value={newProject}
              onChange={(event) => setNewProject(event.target.value)}
              list="known-projects"
              placeholder="e.g. montys-memory-meadow"
              className="w-full rounded-md border border-line bg-base/70 px-2 py-1 font-mono text-[11px] text-ink focus:outline-none"
            />
            <datalist id="known-projects">
              {projects.map((project) => (
                <option key={project.id} value={project.id} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => void handleCreate()}
              className="w-full rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] text-ink-dim transition hover:text-ink"
            >
              Create
            </button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {loading ? <p className="text-[11px] text-muted">Loading…</p> : null}
          {!loading && sessions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-2.5 py-3 text-[11px] leading-relaxed text-muted">
              No conversations yet. Start one and tell Muse something worth remembering.
            </p>
          ) : null}

          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => setActiveId(session.id)}
              className={`block w-full rounded-lg border px-2.5 py-2 text-left transition ${
                session.id === activeId
                  ? 'border-accent/40 bg-surface-2 ring-1 ring-accent/25'
                  : 'border-line bg-surface hover:border-line-bright'
              }`}
            >
              <p className="truncate text-[11px] font-medium text-ink">
                {session.title ?? 'Untitled conversation'}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[9px] text-muted">
                <span className="truncate">{session.project_id ?? 'global'}</span>
                <span>·</span>
                <span>{session.message_count} msg</span>
              </p>
              <p className="mt-0.5 text-[9px] text-muted">
                {formatTimestamp(session.last_message_at ?? session.updated_at)}
                {session.status === 'archived' ? ' · archived' : ''}
              </p>
            </button>
          ))}
        </div>
      </aside>

      {/* ---------------- Transcript ---------------- */}
      <section className="flex min-h-0 flex-col rounded-xl border border-line bg-surface/40">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="truncate text-[12px] font-semibold text-ink">
              {activeSession?.title ?? 'No conversation selected'}
            </h2>
            <p className="mt-0.5 font-mono text-[10px] text-muted">
              {activeSession
                ? `${activeSession.project_id ?? 'global scope'} · ${activeSession.messages.length} messages`
                : 'Create or select a conversation'}
            </p>
          </div>
          {activeSession ? (
            <div className="flex items-center gap-1.5">
              {activeSession.status === 'archived' ? (
                <StatusPill tone="warn">archived</StatusPill>
              ) : null}
              <button
                type="button"
                onClick={() => void handleArchive()}
                className="rounded-md border border-line bg-surface-2 px-2 py-1 text-[10px] text-ink-dim transition hover:text-ink"
              >
                {activeSession.status === 'archived' ? 'Unarchive' : 'Archive'}
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="rounded-md border border-line bg-surface-2 px-2 py-1 text-[10px] text-muted transition hover:text-err"
              >
                Delete
              </button>
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {!activeSession ? (
            <EmptyState />
          ) : activeSession.messages.length === 0 && !pendingUser ? (
            <div className="mx-auto max-w-md py-10 text-center">
              <p className="text-xs font-medium text-ink">Start the conversation</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                Memories are shared through the project scope, so a new conversation in the same
                project picks up where knowledge left off — without this transcript.
              </p>
            </div>
          ) : null}

          {activeSession?.messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}

          {pendingUser ? (
            <>
              <div className="flex flex-col items-end gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                  you
                </span>
                <div className="max-w-[min(680px,100%)] rounded-xl border border-accent/25 bg-accent/10 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
                  <p className="whitespace-pre-wrap break-words">{pendingUser}</p>
                </div>
              </div>

              {streamCaptures.length > 0 ? (
                <div className="rounded-lg border border-ok/25 bg-ok/5 px-3 py-2">
                  <p className="text-[10px] font-medium text-ok">
                    Saved {streamCaptures.length} memory record(s)
                  </p>
                  <ul className="mt-1 space-y-0.5 text-[10px] leading-relaxed text-ink-dim">
                    {streamCaptures.map((capture) => (
                      <li key={capture.memory_id}>
                        · {capture.content}
                        {capture.superseded_ids.length > 0 ? ' (superseded an earlier record)' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-col items-start gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                  muse
                </span>
                <div className="max-w-[min(680px,100%)] rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-dim">
                  {streamText.length > 0 ? (
                    <p className="whitespace-pre-wrap break-words">{streamText}</p>
                  ) : (
                    <p className="flex items-center gap-2 text-muted">
                      <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                      {streamRetrieval
                        ? `Retrieved ${streamRetrieval.metadata.selected_count} memory record(s), waiting for Muse…`
                        : 'Thinking…'}
                    </p>
                  )}
                </div>
                {streamRetrieval ? (
                  <p className="text-[10px] text-muted">
                    {streamRetrieval.metadata.selected_count} memories ·{' '}
                    {streamRetrieval.metadata.characters_used} chars ·{' '}
                    {streamRetrieval.metadata.query_mode} search
                  </p>
                ) : null}
              </div>
            </>
          ) : null}

          {error ? <ErrorBanner error={error} /> : null}

          {notice ? (
            <p className="rounded-lg border border-ok/30 bg-ok/5 px-3 py-2 text-[11px] leading-relaxed text-ok">
              {notice}
            </p>
          ) : null}

          {candidates.length > 0 ? (
            <div className="rounded-lg border border-accent/25 bg-accent/5 px-3 py-2">
              <p className="text-[10px] font-medium text-accent">
                Memory candidates — confirm to store
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {candidates.map((candidate) => (
                  <li key={candidate.content} className="flex items-start justify-between gap-2">
                    <span className="text-[11px] leading-relaxed text-ink-dim">
                      {candidate.content}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleSaveCandidate(candidate)}
                      className="shrink-0 rounded-md border border-line bg-surface-2 px-2 py-0.5 text-[10px] text-ink-dim transition hover:text-ink"
                    >
                      Save
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[10px] text-muted">
                These are proposals extracted from your message. Nothing is stored until you
                confirm.
              </p>
            </div>
          ) : null}

          <div ref={bottomRef} />
        </div>

        <div className="border-t border-line px-3 py-2.5">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              rows={2}
              maxLength={meta?.phase ? 16_000 : 16_000}
              placeholder={
                activeSession?.status === 'archived'
                  ? 'This conversation is archived — unarchive it to continue.'
                  : 'Ask Muse something, or say “Remember that …”'
              }
              disabled={!activeSession || activeSession.status === 'archived' || streaming}
              aria-label="Message"
              className="min-h-[44px] flex-1 resize-none rounded-lg border border-line bg-base/70 px-2.5 py-2 text-[12px] leading-relaxed text-ink placeholder:text-muted focus:border-line-bright focus:outline-none disabled:opacity-50"
            />
            {streaming ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="h-[44px] rounded-lg border border-line bg-surface-2 px-3 text-[11px] font-medium text-ink-dim transition hover:text-ink"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={
                  !activeSession || activeSession.status === 'archived' || input.trim().length === 0
                }
                className="h-[44px] rounded-lg bg-accent px-3.5 text-[11px] font-semibold text-white transition hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-[10px] text-muted">
              <input
                type="checkbox"
                checked={captureEnabled}
                onChange={(event) => setCaptureEnabled(event.target.checked)}
                className="size-3 accent-[var(--color-accent)]"
              />
              Capture explicit memory instructions
            </label>
            <span className="text-[10px] text-muted">
              {stepLabel(streaming, streamRetrieval !== null)}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

function stepLabel(streaming: boolean, retrieved: boolean): string {
  if (!streaming) return 'Enter sends · Shift+Enter adds a line';
  return retrieved ? 'Streaming answer…' : 'Searching memory…';
}

function EmptyState() {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <div className="mx-auto flex size-10 items-center justify-center rounded-xl bg-surface-2 text-accent ring-1 ring-line">
        <Icon name="chat" className="size-4.5" />
      </div>
      <p className="mt-3 text-xs font-medium text-ink">No conversation selected</p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        Create a conversation and choose a project. Memory belongs to the project, so a brand-new
        conversation can continue the work without inheriting the old transcript.
      </p>
    </div>
  );
}

function ErrorBanner({ error }: { error: { code: string; message: string } }) {
  return (
    <div className="rounded-lg border border-err/30 bg-err/5 px-3 py-2">
      <p className="text-[11px] font-medium text-err">
        {error.code === 'provider_failure'
          ? 'Muse could not complete the turn.'
          : error.code === 'context_overflow'
            ? 'The context budget was exhausted.'
            : 'The turn failed.'}
      </p>
      <p className="mt-0.5 text-[10px] leading-relaxed text-ink-dim">{error.message}</p>
      <p className="mt-1 text-[10px] text-muted">
        {error.code === 'provider_failure'
          ? 'Check that the Muse CLI is logged in (muse login) and the model is available, then retry.'
          : error.code === 'context_overflow'
            ? 'Shorten the message, or raise CONTEXT_MAX_PROMPT_CHARACTERS.'
            : 'Retry the turn. Your message was saved.'}
      </p>
    </div>
  );
}

function toError(cause: unknown): { code: string; message: string } {
  if (cause instanceof ApiError) return { code: cause.code, message: cause.message };
  if (cause instanceof Error) return { code: 'request_failed', message: cause.message };
  return { code: 'request_failed', message: String(cause) };
}
