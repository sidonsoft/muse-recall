import type { MessageWithEvidence, TurnMemoryEvidence } from '@mml/shared';
import { useState } from 'react';
import { formatDateTime } from '../../lib/format.ts';
import { Icon } from '../Icon.tsx';
import { StatusPill } from '../ui.tsx';

/**
 * One message.
 *
 * Assistant messages carry an expandable **Memory used** section. It reports
 * what the *application* retrieved for the turn — not what the model used.
 * Retrieval is evidence that a memory was provided; it is not proof that the
 * answer depended on it, and the wording says so.
 */
export function MessageBubble({ message }: { message: MessageWithEvidence }) {
  const isUser = message.role === 'user';
  const hasEvidence = message.memories.length > 0;
  const [expanded, setExpanded] = useState(false);

  return (
    <article className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      <div className="flex items-center gap-2 text-[10px] text-muted">
        <span className="font-mono uppercase tracking-[0.12em]">{isUser ? 'you' : 'muse'}</span>
        <span>·</span>
        <span>{formatDateTime(message.created_at)}</span>
        {message.status !== 'complete' ? (
          <StatusPill tone={message.status === 'interrupted' ? 'warn' : 'err'}>
            {message.status}
          </StatusPill>
        ) : null}
      </div>

      <div
        className={`max-w-[min(680px,100%)] rounded-xl border px-3.5 py-2.5 text-[13px] leading-relaxed ${
          isUser ? 'border-accent/25 bg-accent/10 text-ink' : 'border-line bg-surface text-ink-dim'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
      </div>

      {!isUser && hasEvidence ? (
        <div className="w-full max-w-[min(680px,100%)]">
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface-2/40 px-2.5 py-1.5 text-[10px] text-muted transition hover:border-line-bright hover:text-ink-dim"
          >
            <span className="flex items-center gap-1.5">
              <Icon name="memory" className="size-3" />
              Memory used · {message.memories.length} retrieved
              {message.context ? (
                <>
                  <span>·</span>
                  <span>{message.context.memory_characters} chars</span>
                  <span>·</span>
                  <span>~{message.context.estimated_tokens} tokens (estimated)</span>
                </>
              ) : null}
            </span>
            <Icon
              name="chevronDown"
              className={`size-3.5 shrink-0 transition ${expanded ? 'rotate-180' : ''}`}
            />
          </button>

          {expanded ? <MemoryUsedDetail message={message} /> : null}
        </div>
      ) : null}
    </article>
  );
}

function MemoryUsedDetail({ message }: { message: MessageWithEvidence }) {
  return (
    <div className="mt-1.5 space-y-2 rounded-lg border border-line bg-base/50 p-2.5">
      <p className="text-[10px] leading-relaxed text-muted">
        Retrieved by the application for this turn. A memory being listed here means it was provided
        to the model — not proof that the model relied on it.
      </p>

      <ol className="space-y-1.5">
        {message.memories.map((entry) => (
          <EvidenceRow key={entry.memory_id} entry={entry} />
        ))}
      </ol>

      {message.context ? (
        <div className="space-y-1 border-t border-line pt-2">
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
            Context statistics
          </p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted">
            <Stat
              label="prompt characters"
              value={message.context.prompt_characters.toLocaleString()}
            />
            <Stat label="estimated tokens" value={`~${message.context.estimated_tokens}`} />
            <Stat
              label="memory characters"
              value={message.context.memory_characters.toLocaleString()}
            />
            <Stat
              label="history messages"
              value={`${message.context.history_messages}${message.context.history_messages_dropped > 0 ? ` (${message.context.history_messages_dropped} dropped)` : ''}`}
            />
          </dl>
          {message.context.warnings.length > 0 ? (
            <ul className="space-y-0.5 text-[10px] text-warn">
              {message.context.warnings.map((warning) => (
                <li key={warning}>· {warning}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EvidenceRow({ entry }: { entry: TurnMemoryEvidence }) {
  const [showContent, setShowContent] = useState(false);

  return (
    <li className="rounded-md border border-line/70 bg-surface-2/30 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] text-ink-dim">{entry.memory_type}</span>
        <span className="text-[9px] text-muted">·</span>
        <span className="font-mono text-[9px] text-muted">{entry.scope}</span>
        <span className="text-[9px] text-muted">·</span>
        <span className="font-mono text-[9px] text-accent">score {entry.score.toFixed(3)}</span>
        {entry.pinned ? <StatusPill tone="accent">pinned</StatusPill> : null}
        {entry.truncated ? <StatusPill tone="warn">truncated</StatusPill> : null}
        {!entry.memory_available ? <StatusPill tone="err">no longer available</StatusPill> : null}
      </div>

      <p className="mt-1 text-[10px] leading-relaxed text-muted">{entry.evidence}</p>

      {entry.memory_available && entry.memory ? (
        <button
          type="button"
          onClick={() => setShowContent((current) => !current)}
          className="mt-1 text-left text-[11px] leading-relaxed text-ink-dim hover:text-ink"
        >
          {showContent ? (
            <span className="whitespace-pre-wrap">{entry.memory.content}</span>
          ) : (
            <span className="line-clamp-2">{entry.memory.content}</span>
          )}
        </button>
      ) : (
        <p className="mt-1 text-[10px] italic text-muted">
          This memory was deleted after the turn. The record that it influenced this answer remains;
          its content does not.
        </p>
      )}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="truncate">{label}</dt>
      <dd className="shrink-0 font-mono text-ink-dim">{value}</dd>
    </div>
  );
}
