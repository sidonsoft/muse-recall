import type { Project } from '@mml/shared';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon.tsx';

/**
 * Project switcher.
 *
 * HTML Studio is project-scoped. The primary header shows the artifact title;
 * this menu holds the technical project id and the few projects that exist on
 * this install. Opening an unknown id creates an empty project, matching the
 * Forge API contract.
 */
export function ProjectSwitcher({
  projectId,
  projects,
  onOpen,
  disabled,
}: {
  projectId: string;
  projects: Project[];
  onOpen: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(projectId);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const named = projects.find((project) => project.id === projectId)?.name;
  const currentLabel = named && named !== projectId ? named : projectId;

  useEffect(() => {
    setDraft(projectId);
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const submit = () => {
    const next = draft.trim();
    if (next.length < 2) return;
    setOpen(false);
    onOpen(next);
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        className="btn btn-sm max-w-[190px]"
        title={`Project: ${currentLabel} (${projectId})`}
      >
        <Icon name="branch" className="size-3.5 text-muted" />
        <span className="truncate text-[11px]">{currentLabel}</span>
        <Icon name="chevronDown" className="size-3 text-muted" />
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close project menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
            tabIndex={-1}
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Switch project"
            className="absolute right-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-line bg-surface p-3 shadow-2xl shadow-black/50"
          >
            <p className="eyebrow">Projects on this install</p>
            <ul className="mt-2 max-h-44 space-y-0.5 overflow-y-auto">
              {projects.length === 0 ? (
                <li className="rounded-md border border-dashed border-line px-2 py-2 text-[11px] text-muted">
                  No projects yet.
                </li>
              ) : null}
              {projects.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onOpen(project.id);
                    }}
                    aria-current={project.id === projectId ? 'true' : undefined}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-dim">
                      {project.name}
                    </span>
                    <span className="font-mono text-[10px] text-muted">{project.id}</span>
                    {project.id === projectId ? (
                      <Icon name="check" className="size-3 text-accent" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>

            <form
              className="mt-3 border-t border-line pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <label htmlFor="studio-project-id" className="eyebrow block">
                Open or create
              </label>
              <div className="mt-1.5 flex gap-1.5">
                <input
                  id="studio-project-id"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  aria-label="Project id"
                  autoComplete="off"
                  spellCheck={false}
                  className="field field-mono py-1.5"
                  placeholder="project-id"
                />
                <button
                  type="submit"
                  className="btn btn-sm shrink-0"
                  disabled={draft.trim().length < 2}
                >
                  Open
                </button>
              </div>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">
                Opening an id that does not exist starts an empty project. Nothing is generated
                until you ask.
              </p>
            </form>
          </div>
        </>
      ) : null}
    </div>
  );
}
