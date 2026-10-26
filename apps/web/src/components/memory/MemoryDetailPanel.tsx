import {
  MEMORY_TYPES,
  type Memory,
  type MemoryDetail,
  type MemoryType,
  type ValidationStatus,
} from '@mml/shared';
import { type ReactNode, useState } from 'react';
import { formatDateTime } from '../../lib/format.ts';
import { Icon } from '../Icon.tsx';
import { DataRow, StatusPill, type Tone } from '../ui.tsx';

const VALIDATION_TONE: Record<ValidationStatus, Tone> = {
  verified: 'ok',
  unverified: 'warn',
  disputed: 'err',
};

const STATUS_TONE: Record<Memory['status'], Tone> = {
  active: 'ok',
  superseded: 'accent',
  expired: 'warn',
  deleted: 'err',
};

export interface CorrectionSubmission {
  content: string;
  type: MemoryType;
  confidence: number;
  validation_status: ValidationStatus;
  reason: string;
}

export interface EditSubmission {
  content: string;
  confidence: number;
  validation_status: ValidationStatus;
}

type Mode = 'view' | 'correct' | 'edit' | 'delete';

export function MemoryDetailPanel({
  detail,
  busy,
  onCorrect,
  onEdit,
  onDelete,
  onSelect,
}: {
  detail: MemoryDetail;
  busy: boolean;
  onCorrect: (submission: CorrectionSubmission) => void;
  onEdit: (submission: EditSubmission) => void;
  onDelete: (reason: string) => void;
  onSelect: (id: string) => void;
}) {
  const [mode, setMode] = useState<Mode>('view');
  const memory = detail.memory;

  return (
    <section className="panel flex flex-col" aria-label="Memory detail">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill tone={STATUS_TONE[memory.status]}>{memory.status}</StatusPill>
              <StatusPill tone={VALIDATION_TONE[memory.validation_status]}>
                {memory.validation_status}
              </StatusPill>
              <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">
                {memory.type}
              </span>
            </div>
            <p className="mt-2 font-mono text-[10px] text-muted">id {memory.id.slice(0, 8)}…</p>
          </div>
          {mode === 'view' && memory.status !== 'deleted' ? (
            <div className="flex shrink-0 gap-1">
              <IconButton label="Edit memory" onClick={() => setMode('edit')} name="edit" />
              <IconButton
                label="Correct memory"
                onClick={() => setMode('correct')}
                name="history"
              />
              <IconButton label="Delete memory" onClick={() => setMode('delete')} name="trash" />
            </div>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {mode === 'view' ? <ViewBody detail={detail} onSelect={onSelect} /> : null}

        {mode === 'correct' ? (
          <CorrectionForm
            memory={memory}
            busy={busy}
            onCancel={() => setMode('view')}
            onSubmit={onCorrect}
          />
        ) : null}

        {mode === 'edit' ? (
          <EditForm
            memory={memory}
            busy={busy}
            onCancel={() => setMode('view')}
            onSubmit={onEdit}
          />
        ) : null}

        {mode === 'delete' ? (
          <DeleteForm busy={busy} onCancel={() => setMode('view')} onSubmit={onDelete} />
        ) : null}
      </div>
    </section>
  );
}

function IconButton({
  name,
  label,
  onClick,
}: {
  name: 'edit' | 'history' | 'trash';
  label: string;
  onClick: () => void;
}) {
  const tone = name === 'trash' ? 'hover:text-err' : 'hover:text-ink';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex size-7 items-center justify-center rounded-md border border-line bg-surface-2 text-muted transition ${tone}`}
    >
      <Icon name={name} className="size-3.5" />
    </button>
  );
}

function ViewBody({ detail, onSelect }: { detail: MemoryDetail; onSelect: (id: string) => void }) {
  const { memory } = detail;

  return (
    <div className="space-y-4">
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{memory.content}</p>

      <dl className="divide-y divide-line/70">
        <DataRow
          label="scope"
          value={memory.scope === 'global' ? 'global' : (memory.project_id ?? '—')}
          mono
        />
        <DataRow label="confidence" value={memory.confidence.toFixed(2)} />
        <DataRow label="source session" value={memory.source.session_id ?? '—'} mono />
        <DataRow label="source ref" value={memory.source.reference ?? '—'} mono />
        <DataRow label="created" value={formatDateTime(memory.created_at)} />
        <DataRow label="updated" value={formatDateTime(memory.updated_at)} />
        <DataRow
          label="expires"
          value={memory.expires_at ? formatDateTime(memory.expires_at) : 'never'}
        />
        <DataRow label="supersedes" value={String(memory.supersedes.length)} />
      </dl>

      {memory.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {memory.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-ink-dim"
            >
              #{tag}
            </span>
          ))}
        </div>
      ) : null}

      {detail.superseded_by ? (
        <MemoryLink label="Superseded by" memory={detail.superseded_by} onSelect={onSelect} />
      ) : null}

      {detail.supersedes.length > 0 ? (
        <div>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
            Replaced {detail.supersedes.length} earlier{' '}
            {detail.supersedes.length === 1 ? 'record' : 'records'}
          </h3>
          <div className="space-y-1.5">
            {detail.supersedes.map((old) => (
              <MemoryLink key={old.id} memory={old} onSelect={onSelect} />
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <h3 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
          <Icon name="history" className="size-3" />
          History
        </h3>
        <ol className="relative space-y-2 border-l border-line pl-3">
          {detail.history.map((entry) => (
            <li key={entry.id} className="relative">
              <span className="absolute -left-[17px] top-1.5 size-1.5 rounded-full bg-line-bright" />
              <p className="text-[11px] text-ink-dim">
                <span className="font-medium text-ink">{entry.action}</span>
                <span className="text-muted"> · {entry.actor}</span>
              </p>
              {entry.reason ? (
                <p className="mt-0.5 text-[10px] leading-relaxed text-muted">{entry.reason}</p>
              ) : null}
              <p className="mt-0.5 font-mono text-[10px] text-muted">{formatDateTime(entry.at)}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function MemoryLink({
  label,
  memory,
  onSelect,
}: {
  label?: string;
  memory: Memory;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(memory.id)}
      className="w-full rounded-lg border border-line bg-surface-2/50 px-2.5 py-2 text-left transition hover:border-line-bright"
    >
      {label ? (
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted">{label}</span>
      ) : null}
      <span className="mt-0.5 line-clamp-2 block text-[11px] leading-relaxed text-ink-dim">
        {memory.content}
      </span>
      <span className="mt-1 flex gap-2 font-mono text-[10px] text-muted">
        <span>{memory.type}</span>
        <span>·</span>
        <span>{memory.status}</span>
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-[11px] font-medium text-ink-dim">
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-lg border border-line bg-base/70 px-2.5 py-1.5 text-[12px] text-ink placeholder:text-muted focus:border-line-bright focus:outline-none';

function CorrectionForm({
  memory,
  busy,
  onSubmit,
  onCancel,
}: {
  memory: Memory;
  busy: boolean;
  onSubmit: (submission: CorrectionSubmission) => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState(memory.content);
  const [type, setType] = useState<MemoryType>(memory.type);
  const [confidence, setConfidence] = useState(Math.max(memory.confidence, 0.9));
  const [validation, setValidation] = useState<ValidationStatus>('verified');
  const [reason, setReason] = useState('');

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (content.trim().length === 0 || busy) return;
        onSubmit({
          content: content.trim(),
          type,
          confidence,
          validation_status: validation,
          reason,
        });
      }}
    >
      <p className="rounded-lg border border-accent/25 bg-accent/5 px-2.5 py-2 text-[11px] leading-relaxed text-ink-dim">
        Correcting supersedes this memory. The current record stays in history; it is no longer
        returned as a current fact.
      </p>

      <div className="space-y-1">
        <FieldLabel htmlFor="correction-content">Corrected fact</FieldLabel>
        <textarea
          id="correction-content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={4}
          maxLength={8_000}
          className={`${inputClass} resize-none`}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <FieldLabel htmlFor="correction-type">Type</FieldLabel>
          <select
            id="correction-type"
            value={type}
            onChange={(event) => setType(event.target.value as MemoryType)}
            className={inputClass}
          >
            {MEMORY_TYPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <FieldLabel htmlFor="correction-validation">Validation</FieldLabel>
          <select
            id="correction-validation"
            value={validation}
            onChange={(event) => setValidation(event.target.value as ValidationStatus)}
            className={inputClass}
          >
            {(['verified', 'unverified', 'disputed'] as const).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <FieldLabel htmlFor="correction-confidence">
          Confidence · {confidence.toFixed(2)}
        </FieldLabel>
        <input
          id="correction-confidence"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={confidence}
          onChange={(event) => setConfidence(Number(event.target.value))}
          className="w-full accent-[var(--color-accent)]"
        />
      </div>

      <div className="space-y-1">
        <FieldLabel htmlFor="correction-reason">Why (recorded in history)</FieldLabel>
        <input
          id="correction-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={1_000}
          placeholder="e.g. user changed the target platform"
          className={inputClass}
        />
      </div>

      <FormActions busy={busy} onCancel={onCancel} submitLabel="Supersede with correction" />
    </form>
  );
}

function EditForm({
  memory,
  busy,
  onSubmit,
  onCancel,
}: {
  memory: Memory;
  busy: boolean;
  onSubmit: (submission: EditSubmission) => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState(memory.content);
  const [confidence, setConfidence] = useState(memory.confidence);
  const [validation, setValidation] = useState<ValidationStatus>(memory.validation_status);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (content.trim().length === 0 || busy) return;
        onSubmit({ content: content.trim(), confidence, validation_status: validation });
      }}
    >
      <p className="rounded-lg border border-warn/25 bg-warn/5 px-2.5 py-2 text-[11px] leading-relaxed text-ink-dim">
        Editing rewrites this record in place and appends an{' '}
        <code className="font-mono">updated</code> entry to its history. Use a correction when the
        fact itself changed.
      </p>

      <div className="space-y-1">
        <FieldLabel htmlFor="edit-content">Content</FieldLabel>
        <textarea
          id="edit-content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={4}
          maxLength={8_000}
          className={`${inputClass} resize-none`}
        />
      </div>

      <div className="space-y-1">
        <FieldLabel htmlFor="edit-confidence">Confidence · {confidence.toFixed(2)}</FieldLabel>
        <input
          id="edit-confidence"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={confidence}
          onChange={(event) => setConfidence(Number(event.target.value))}
          className="w-full accent-[var(--color-accent)]"
        />
      </div>

      <div className="space-y-1">
        <FieldLabel htmlFor="edit-validation">Validation</FieldLabel>
        <select
          id="edit-validation"
          value={validation}
          onChange={(event) => setValidation(event.target.value as ValidationStatus)}
          className={inputClass}
        >
          {(['verified', 'unverified', 'disputed'] as const).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <FormActions busy={busy} onCancel={onCancel} submitLabel="Save changes" />
    </form>
  );
}

function DeleteForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        onSubmit(reason);
      }}
    >
      <p className="rounded-lg border border-err/30 bg-err/5 px-2.5 py-2 text-[11px] leading-relaxed text-ink-dim">
        Deleting removes this memory from the search index and from every read endpoint. It will not
        be retrievable as context again. This cannot be undone through the interface.
      </p>

      <div className="space-y-1">
        <FieldLabel htmlFor="delete-reason">Why (recorded in history)</FieldLabel>
        <input
          id="delete-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={1_000}
          placeholder="optional"
          className={inputClass}
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="flex-1 rounded-lg bg-err/90 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-err disabled:opacity-50"
        >
          {busy ? 'Deleting…' : 'Delete permanently'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-dim transition hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function FormActions({
  busy,
  onCancel,
  submitLabel,
}: {
  busy: boolean;
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="submit"
        disabled={busy}
        className="flex-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-accent-dim disabled:opacity-50"
      >
        {busy ? 'Saving…' : submitLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-dim transition hover:text-ink"
      >
        Cancel
      </button>
    </div>
  );
}
