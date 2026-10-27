import type { ForgeDiff, ForgeJob } from '@mml/shared';
import { Icon } from '../Icon.tsx';

export type PromptMode = 'change' | 'new';

/**
 * Starting points that show the range of the artifact contract. A game is one
 * example, not the category: the same pipeline builds tools and small apps.
 */
const EXAMPLES = [
  {
    label: 'Memory game',
    prompt:
      'A colourful farmyard memory-matching game for children aged 4-7. Twelve cards (six pairs), large touch targets, score and moves, restart, a win overlay, and a responsive layout.',
  },
  {
    label: 'Focus timer',
    prompt:
      'A calm focus timer with 25-minute work and 5-minute rest cycles, a large countdown, start/pause/reset, and a session count. Keyboard accessible and responsive.',
  },
  {
    label: 'Expense tracker',
    prompt:
      'A small expense tracker where I can add an amount, category, and note; see the running total and a category breakdown; delete entries; and keep data in localStorage.',
  },
  {
    label: 'Recipe book',
    prompt:
      'A recipe book with a searchable list, a detail view, ingredient checkboxes, and a responsive two-column layout for desktop and a single column on mobile.',
  },
] as const;

/**
 * The development column: one place to ask Muse Spark for a change.
 *
 * The mode switch keeps iterative editing visible. "New app" stages a
 * replacement rather than silently overwriting the approved artifact.
 */
export function PromptPanel({
  mode,
  onMode,
  hasGame,
  prompt,
  onPrompt,
  change,
  onChange,
  screenshot,
  previewReady,
  canCapture,
  onCapture,
  onGenerate,
  onModify,
  running,
  busy,
  job,
  diff,
  onCancel,
}: {
  mode: PromptMode;
  onMode: (mode: PromptMode) => void;
  hasGame: boolean;
  prompt: string;
  onPrompt: (value: string) => void;
  change: string;
  onChange: (value: string) => void;
  screenshot: string | null;
  previewReady: boolean;
  canCapture: boolean;
  onCapture: () => void;
  onGenerate: () => void;
  onModify: () => void;
  running: boolean;
  busy: boolean;
  job: ForgeJob | null;
  diff: ForgeDiff | null;
  onCancel: () => void;
}) {
  const effectiveMode: PromptMode = hasGame ? mode : 'new';

  const submit = () => {
    if (running || busy) return;
    if (effectiveMode === 'new' && prompt.trim().length >= 10) onGenerate();
    if (effectiveMode === 'change' && change.trim().length >= 3) onModify();
  };

  return (
    <section aria-label="Development" className="panel flex shrink-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <Icon name="spark" className="size-3.5 text-accent" />
          Development
        </h2>
        <span className="chip" title="Generation engine">
          Muse Spark
        </span>
      </div>

      {hasGame ? (
        <div role="tablist" aria-label="Generation mode" className="flex gap-1 px-2.5 pt-2.5">
          <button
            type="button"
            role="tab"
            aria-selected={effectiveMode === 'change'}
            onClick={() => onMode('change')}
            className="tab flex-1 justify-center"
          >
            Change this app
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={effectiveMode === 'new'}
            onClick={() => onMode('new')}
            className="tab flex-1 justify-center"
          >
            New app
          </button>
        </div>
      ) : null}

      {effectiveMode === 'change' ? (
        <div className="space-y-2.5 p-3">
          <div className="flex items-center gap-2">
            {screenshot ? (
              <img
                src={screenshot}
                alt="Captured preview"
                data-capture-method="captured"
                className="h-10 w-16 shrink-0 rounded border border-line object-cover"
              />
            ) : null}
            <button
              type="button"
              onClick={onCapture}
              disabled={!canCapture || !previewReady}
              className="btn btn-sm"
            >
              <Icon name="system" className="size-3.5" />
              {screenshot ? 'Recapture' : 'Capture preview'}
            </button>
            <span className="text-[10px] leading-snug text-muted">
              {!canCapture
                ? 'Nothing to capture yet.'
                : previewReady
                  ? 'Optional visual reference'
                  : 'Waiting for the preview…'}
            </span>
          </div>

          <div>
            <label htmlFor="studio-change" className="text-[11px] font-medium text-ink-dim">
              What should change?
            </label>
            <textarea
              id="studio-change"
              value={change}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit();
              }}
              rows={3}
              maxLength={2000}
              placeholder="Make the cards larger, keep the ocean palette."
              className="field mt-1.5 resize-y"
              aria-label="Change request"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onModify}
              disabled={busy || running || change.trim().length < 3}
              className="btn btn-primary flex-1"
            >
              {running && job?.kind === 'modify' ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Generating…
                </>
              ) : (
                <>
                  <Icon name="spark" className="size-3.5" />
                  Generate change
                </>
              )}
            </button>
            {running ? (
              <button type="button" onClick={onCancel} className="btn btn-sm">
                Cancel
              </button>
            ) : null}
          </div>
          <p className="text-[10px] leading-relaxed text-muted">
            Staged until you approve it; the current version stays live.
          </p>
        </div>
      ) : (
        <div className="space-y-3 p-3">
          <div>
            <label htmlFor="studio-prompt" className="text-[11px] font-medium text-ink-dim">
              Describe the application
            </label>
            <textarea
              id="studio-prompt"
              value={prompt}
              onChange={(event) => onPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit();
              }}
              rows={6}
              maxLength={4000}
              placeholder="A children's memory-matching game with six animal pairs, large touch targets, and a win overlay."
              className="field mt-1.5 resize-y"
              aria-label="Application description"
            />
            <p className="mt-1 text-[10.5px] text-muted">⌘/Ctrl + Enter to generate.</p>
            <div className="mt-2">
              <p className="eyebrow">Try an example</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {EXAMPLES.map((example) => (
                  <button
                    key={example.label}
                    type="button"
                    onClick={() => onPrompt(example.prompt)}
                    className="chip transition-colors hover:border-accent/40 hover:text-accent"
                    title={`Use the ${example.label} prompt`}
                  >
                    {example.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onGenerate}
            disabled={busy || running || prompt.trim().length < 10}
            className="btn btn-primary w-full"
          >
            {running ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Generating…
              </>
            ) : (
              <>
                <Icon name="spark" className="size-3.5" />
                {hasGame ? 'Stage new version' : 'Generate HTML'}
              </>
            )}
          </button>
          {running ? (
            <button type="button" onClick={onCancel} className="btn btn-sm w-full">
              Cancel generation
            </button>
          ) : null}
          <p className="text-[10.5px] leading-relaxed text-muted">
            Muse Spark writes <span className="font-mono text-ink-dim">index.html</span> into a
            staging copy.
            {hasGame
              ? ' It is published as a new version only after you approve it.'
              : ' Nothing is published until you approve it.'}
          </p>
        </div>
      )}

      <GenerationStrip job={job} diff={diff} running={running} />
    </section>
  );
}

/** Truthful, backend-derived generation state; no invented percentages. */
export function GenerationStrip({
  job,
  diff,
  running,
}: {
  job: ForgeJob | null;
  diff: ForgeDiff | null;
  running: boolean;
}) {
  if (!job && !diff) return null;

  const state = diff
    ? 'Staged for review'
    : running
      ? jobLabel(job?.status ?? 'running')
      : jobLabel(job?.status ?? '');
  const tone = diff
    ? 'text-warn'
    : job?.status === 'succeeded'
      ? 'text-ok'
      : job?.status === 'failed' || job?.status === 'budget_exceeded'
        ? 'text-err'
        : 'text-accent';

  return (
    <div className="mt-auto border-t border-line px-3 py-2" aria-live="polite">
      <div className="flex items-center gap-2 text-[11px]">
        {running ? (
          <span className="spinner" aria-hidden="true" />
        ) : (
          <span
            className={`size-1.5 rounded-full ${
              diff ? 'bg-warn' : job?.status === 'succeeded' ? 'bg-ok' : 'bg-muted'
            }`}
            aria-hidden="true"
          />
        )}
        <span className={`font-medium ${tone}`}>{state}</span>
        {job ? <span className="ml-auto font-mono text-[10px] text-muted">{job.kind}</span> : null}
      </div>
      {job ? (
        <p className="mt-0.5 text-[10.5px] text-muted">
          {job.memory_ids.length} project decision{job.memory_ids.length === 1 ? '' : 's'} supplied
          {job.usage
            ? ` · ${job.usage.calls} model calls · ${(job.usage.runtime_ms / 1000).toFixed(1)}s`
            : ''}
        </p>
      ) : null}
    </div>
  );
}

export function jobLabel(status: string): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Muse Spark is writing…';
    case 'succeeded':
      return 'Generated';
    case 'failed':
      return 'Generation failed';
    case 'cancelled':
      return 'Cancelled';
    case 'budget_exceeded':
      return 'Stopped at budget';
    case 'rejected':
      return 'Rejected';
    default:
      return status.length > 0 ? status : 'Idle';
  }
}
