import type { ReviewItem, ReviewQueue } from '@mml/shared';

/**
 * Review queue (roadmap §7 / gap G-9): the memories that need a human
 * decision — unverified, disputed, expired, or about to expire. Actions are
 * transitions through the ordinary update path (PATCH with optimistic
 * revision), so the audit trail sees every triage decision.
 */

interface ReviewQueuePanelProps {
  queue: ReviewQueue | null;
  busyId: string | null;
  onVerify: (item: ReviewItem) => void;
  onDispute: (item: ReviewItem) => void;
  onExtend: (item: ReviewItem) => void;
  onOpen: (item: ReviewItem) => void;
}

function reasonLabel(item: ReviewItem): string {
  const parts: string[] = [];
  if (item.reasons.includes('disputed')) parts.push('disputed claim');
  else if (item.reasons.includes('unverified')) parts.push('unverified claim');
  if (item.reasons.includes('expired')) {
    parts.push(
      item.days_until_expiry !== null && item.days_until_expiry < 0
        ? `expired ${-item.days_until_expiry} day${item.days_until_expiry === -1 ? '' : 's'} ago`
        : 'expired',
    );
  } else if (item.reasons.includes('expiring')) {
    parts.push(
      item.days_until_expiry !== null
        ? `expires in ${item.days_until_expiry} day${item.days_until_expiry === 1 ? '' : 's'}`
        : 'expires soon',
    );
  }
  return parts.join(' · ');
}

const buttonClass =
  'rounded-lg border border-line bg-base/70 px-2 py-1 text-[11px] text-ink transition hover:border-line-bright focus:outline-none disabled:opacity-40';
const primaryClass =
  'rounded-lg bg-accent px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-accent-dim focus:outline-none disabled:opacity-40';

export function ReviewQueuePanel({
  queue,
  busyId,
  onVerify,
  onDispute,
  onExtend,
  onOpen,
}: ReviewQueuePanelProps) {
  if (!queue) {
    return (
      <section aria-label="Review queue" className="panel p-3">
        <h3 className="text-[12px] font-semibold text-ink">Review queue</h3>
        <p className="mt-1 text-[11px] text-muted">Checking memories that need a decision…</p>
      </section>
    );
  }

  if (queue.total === 0) {
    return (
      <section aria-label="Review queue" className="panel p-3">
        <h3 className="text-[12px] font-semibold text-ink">Review queue</h3>
        <p className="mt-1 text-[11px] text-muted">
          Nothing needs a decision: every memory is verified, none is disputed, and nothing expires
          within {queue.horizon_days} days.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Review queue" className="panel p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-ink">
          Review queue
          <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
            {queue.total}
          </span>
        </h3>
        <p className="text-[10px] text-muted">
          expiring within {queue.horizon_days} days counts too
        </p>
      </div>
      <ul className="mt-2 space-y-2">
        {queue.items.map((item) => (
          <li key={item.memory.id} className="rounded-lg border border-line bg-base/50 p-2.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[12px] text-ink">{item.memory.content}</p>
                <p className="mt-1 text-[10px] font-medium text-amber-400">{reasonLabel(item)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => onOpen(item)}
                  aria-label={`Open memory: ${item.memory.content.slice(0, 60)}`}
                >
                  Open
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => onDispute(item)}
                  disabled={
                    busyId === item.memory.id || item.memory.validation_status === 'disputed'
                  }
                  aria-label={`Mark disputed: ${item.memory.content.slice(0, 60)}`}
                >
                  Dispute
                </button>
                {item.memory.expires_at ? (
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => onExtend(item)}
                    disabled={busyId === item.memory.id}
                    aria-label={`Extend expiry thirty days: ${item.memory.content.slice(0, 60)}`}
                  >
                    Extend 30d
                  </button>
                ) : null}
                <button
                  type="button"
                  className={primaryClass}
                  onClick={() => onVerify(item)}
                  disabled={busyId === item.memory.id}
                  aria-label={`Mark verified: ${item.memory.content.slice(0, 60)}`}
                >
                  Verify
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
