import type { ForgeJob } from '@mml/shared';
import { Icon } from '../Icon.tsx';

/**
 * Recent generation attempts for this project.
 *
 * Jobs are the honest history of work: including failed and rejected attempts
 * is more useful than only listing the versions that survived review.
 */
export function StudioActivity({ jobs }: { jobs: ForgeJob[] }) {
  if (jobs.length === 0) return null;
  return (
    <section aria-label="Recent generation activity" className="panel shrink-0">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h2 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
          <Icon name="history" className="size-3.5 text-muted" />
          Recent activity
        </h2>
        <span className="font-mono text-[10px] text-muted">{jobs.length}</span>
      </div>
      <ul className="divide-y divide-line/70">
        {jobs.slice(0, 4).map((job) => (
          <li key={job.id} className="flex items-center gap-2 px-3 py-1.5 text-[10.5px]">
            <span
              className={`size-1.5 shrink-0 rounded-full ${
                job.status === 'succeeded'
                  ? 'bg-ok'
                  : job.status === 'failed' || job.status === 'budget_exceeded'
                    ? 'bg-err'
                    : job.status === 'cancelled' || job.status === 'rejected'
                      ? 'bg-muted'
                      : 'bg-warn'
              }`}
              aria-hidden="true"
            />
            <span className="font-mono text-ink-dim">{job.kind}</span>
            <span className="text-muted">{job.status.replace('_', ' ')}</span>
            {job.version ? <span className="text-accent">v{job.version}</span> : null}
            <span className="ml-auto shrink-0 font-mono text-[9.5px] text-muted">
              {new Date(job.created_at).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
