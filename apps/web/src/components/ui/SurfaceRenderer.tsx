import type { FieldOption, UiSurfaceRecord } from '@mml/ui-protocol';
import { useState } from 'react';
import { Icon } from '../Icon.tsx';
import { StatusPill, type Tone } from '../ui.tsx';

/**
 * Surface renderer.
 *
 * Renders a validated declarative spec through a fixed registry. Unknown block
 * kinds cannot reach this component — validation rejects them first — and no
 * value is ever interpreted as markup.
 */

const TONES: Record<string, Tone> = {
  ok: 'ok',
  warn: 'warn',
  err: 'err',
  idle: 'idle',
  accent: 'accent',
};

export type SurfaceValues = Record<string, string | number | boolean | string[]>;

export function SurfaceRenderer({
  surface,
  busy,
  onSubmit,
}: {
  surface: UiSurfaceRecord;
  busy: boolean;
  onSubmit: (input: { action_id: string; values: SurfaceValues }) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const submittedEvent = surface.events[0];

  return (
    <section
      className="rounded-xl border border-accent/25 bg-surface/70 p-3.5"
      aria-label={`Interface: ${surface.title}`}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-accent">
          <Icon name="layers" className="size-3" />
          Generated interface
        </div>
        {surface.status === 'submitted' ? (
          <StatusPill tone="ok">submitted</StatusPill>
        ) : (
          <span className="font-mono text-[9px] text-muted">validated spec</span>
        )}
      </header>

      <div className="space-y-3">
        {surface.spec.blocks.map((block, index) => {
          const key = `${block.kind}-${index}`;
          switch (block.kind) {
            case 'heading':
              return block.level === 2 ? (
                <h3 key={key} className="text-sm font-semibold tracking-tight text-ink">
                  {block.text}
                </h3>
              ) : (
                <h4 key={key} className="text-[12px] font-semibold text-ink-dim">
                  {block.text}
                </h4>
              );
            case 'text':
              return (
                <p key={key} className="text-[12px] leading-relaxed text-ink-dim">
                  {block.text}
                </p>
              );
            case 'status':
              return (
                <div key={key}>
                  <StatusPill tone={TONES[block.tone] ?? 'idle'}>{block.label}</StatusPill>
                </div>
              );
            case 'progress':
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-muted">
                    <span>{block.label}</span>
                    <span className="font-mono">{Math.round(block.value)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-accent/70"
                      style={{ width: `${Math.min(100, Math.max(0, block.value))}%` }}
                    />
                  </div>
                </div>
              );
            case 'tasklist':
              return (
                <div key={key}>
                  {block.title ? (
                    <p className="mb-1 text-[11px] font-medium text-ink-dim">{block.title}</p>
                  ) : null}
                  <ul className="space-y-1">
                    {block.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center gap-2 text-[11px] text-ink-dim"
                      >
                        <span
                          className={`flex size-3.5 items-center justify-center rounded border ${
                            item.done
                              ? 'border-ok/40 bg-ok/15 text-ok'
                              : 'border-line bg-base/60 text-transparent'
                          }`}
                        >
                          <Icon name="check" className="size-2.5" />
                        </span>
                        <span className={item.done ? 'text-muted line-through' : ''}>
                          {item.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            case 'table':
              return (
                <div key={key} className="overflow-x-auto">
                  {block.title ? (
                    <p className="mb-1 text-[11px] font-medium text-ink-dim">{block.title}</p>
                  ) : null}
                  <table className="w-full border-collapse text-left text-[11px]">
                    <thead>
                      <tr className="border-b border-line">
                        {block.columns.map((column) => (
                          <th key={column.key} className="px-2 py-1 font-medium text-muted">
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row) => (
                        <tr
                          key={block.columns.map((column) => row[column.key] ?? '').join('|')}
                          className="border-b border-line/50"
                        >
                          {block.columns.map((column) => (
                            <td key={column.key} className="px-2 py-1 text-ink-dim">
                              {row[column.key] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            case 'card':
              return (
                <div key={key} className="rounded-lg border border-line bg-base/40 p-2.5">
                  <p className="text-[11px] font-medium text-ink">{block.title}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">{block.body}</p>
                </div>
              );
            case 'button':
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDismissed(true)}
                  className="rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-[10px] text-ink-dim transition hover:text-ink"
                >
                  {block.label}
                </button>
              );
            case 'form':
              return (
                <SurfaceForm
                  key={`form-${block.id}`}
                  form={block}
                  busy={busy}
                  submittedValues={
                    surface.status === 'submitted' ? (submittedEvent?.values ?? null) : null
                  }
                  onSubmit={onSubmit}
                />
              );
            default:
              return null;
          }
        })}
      </div>
    </section>
  );
}

function SurfaceForm({
  form,
  busy,
  submittedValues,
  onSubmit,
}: {
  form: Extract<UiSurfaceRecord['spec']['blocks'][number], { kind: 'form' }>;
  busy: boolean;
  submittedValues: SurfaceValues | null;
  onSubmit: (input: { action_id: string; values: SurfaceValues }) => void;
}) {
  const [values, setValues] = useState<SurfaceValues>({});
  const [error, setError] = useState<string | null>(null);

  if (submittedValues) {
    return (
      <div className="rounded-lg border border-ok/25 bg-ok/5 p-2.5">
        <p className="text-[10px] font-medium text-ok">Submitted</p>
        <dl className="mt-1 space-y-0.5">
          {form.fields.map((field) => {
            const value = submittedValues[field.id];
            if (value === undefined) return null;
            return (
              <div key={field.id} className="flex justify-between gap-3 text-[11px]">
                <dt className="text-muted">{field.label}</dt>
                <dd className="text-right text-ink-dim">
                  {Array.isArray(value) ? value.join(', ') : String(value)}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    );
  }

  function update(id: string, value: SurfaceValues[string]): void {
    setValues((current) => ({ ...current, [id]: value }));
  }

  return (
    <form
      className="space-y-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        const missing = form.fields.filter(
          (field) => field.required && (values[field.id] === undefined || values[field.id] === ''),
        );
        if (missing.length > 0) {
          setError(`Please fill in: ${missing.map((field) => field.label).join(', ')}`);
          return;
        }
        setError(null);
        onSubmit({ action_id: form.id, values });
      }}
    >
      {form.fields.map((field) => (
        <div key={field.id} className="space-y-1">
          <label htmlFor={`${form.id}-${field.id}`} className="block text-[11px] text-ink-dim">
            {field.label}
            {field.required ? <span className="text-err"> *</span> : null}
          </label>

          {field.type === 'textarea' ? (
            <textarea
              id={`${form.id}-${field.id}`}
              rows={2}
              maxLength={field.max_length ?? 4_000}
              placeholder={field.placeholder}
              value={typeof values[field.id] === 'string' ? (values[field.id] as string) : ''}
              onChange={(event) => update(field.id, event.target.value)}
              className="w-full resize-none rounded-lg border border-line bg-base/70 px-2 py-1.5 text-[12px] text-ink placeholder:text-muted focus:border-line-bright focus:outline-none"
            />
          ) : field.type === 'select' ? (
            <select
              id={`${form.id}-${field.id}`}
              value={typeof values[field.id] === 'string' ? (values[field.id] as string) : ''}
              onChange={(event) => update(field.id, event.target.value)}
              className="w-full rounded-lg border border-line bg-base/70 px-2 py-1.5 text-[12px] text-ink focus:outline-none"
            >
              <option value="">Choose…</option>
              {(field.options ?? []).map((option: FieldOption) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : field.type === 'multiselect' ? (
            <div className="flex flex-wrap gap-1.5">
              {(field.options ?? []).map((option: FieldOption) => {
                const selected = Array.isArray(values[field.id])
                  ? (values[field.id] as string[])
                  : [];
                const checked = selected.includes(option.value);
                return (
                  <label
                    key={option.value}
                    className={`cursor-pointer rounded-full border px-2 py-0.5 text-[10px] transition ${
                      checked
                        ? 'border-accent/50 bg-accent/15 text-accent'
                        : 'border-line bg-surface-2 text-ink-dim'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() =>
                        update(
                          field.id,
                          checked
                            ? selected.filter((value) => value !== option.value)
                            : [...selected, option.value],
                        )
                      }
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          ) : field.type === 'checkbox' ? (
            <label className="flex items-center gap-1.5 text-[11px] text-ink-dim">
              <input
                id={`${form.id}-${field.id}`}
                type="checkbox"
                checked={values[field.id] === true}
                onChange={(event) => update(field.id, event.target.checked)}
                className="size-3 accent-[var(--color-accent)]"
              />
              {field.placeholder ?? 'Yes'}
            </label>
          ) : field.type === 'number' ? (
            <input
              id={`${form.id}-${field.id}`}
              type="number"
              min={field.min}
              max={field.max}
              value={typeof values[field.id] === 'number' ? (values[field.id] as number) : ''}
              onChange={(event) =>
                update(field.id, event.target.value === '' ? '' : Number(event.target.value))
              }
              className="w-full rounded-lg border border-line bg-base/70 px-2 py-1.5 text-[12px] text-ink focus:outline-none"
            />
          ) : (
            <input
              id={`${form.id}-${field.id}`}
              type="text"
              maxLength={field.max_length ?? 500}
              placeholder={field.placeholder}
              value={typeof values[field.id] === 'string' ? (values[field.id] as string) : ''}
              onChange={(event) => update(field.id, event.target.value)}
              className="w-full rounded-lg border border-line bg-base/70 px-2 py-1.5 text-[12px] text-ink placeholder:text-muted focus:outline-none"
            />
          )}

          {field.help ? <p className="text-[9px] text-muted">{field.help}</p> : null}
        </div>
      ))}

      {error ? <p className="text-[10px] text-err">{error}</p> : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-accent-dim disabled:opacity-50"
        >
          {busy ? 'Submitting…' : form.submit_label}
        </button>
        <span className="text-[9px] text-muted">
          Values are validated against this interface before they are used.
        </span>
      </div>
    </form>
  );
}
