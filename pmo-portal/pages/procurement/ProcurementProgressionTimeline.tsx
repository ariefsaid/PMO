/**
 * ProcurementProgressionTimeline — the Overview-bento progression slot.
 *
 * A vertical dot+rail timeline that folds in what was the standalone "Progression
 * history" section (there is NO separate History tab). Presents the output of
 * `buildProcurementHistory(detail)` NEWEST-FIRST so the current state is at the top;
 * the latest event carries a current-state ring (decorative, `aria-hidden`) — "current"
 * is conveyed to assistive tech by the event being first plus its label text, never by
 * color/dot alone (NFR-PR-A11Y-002, WCAG SC 1.4.1).
 *
 * Semantic `<ol aria-label="Progression history">`; each event's kind, label, actor, and
 * UTC-safe timestamp render as TEXT. Token-pure (DESIGN.md §6) — rail `bg-border`, event
 * dot `bg-success`, current dot `bg-background border-primary` + a primary-ring halo; no
 * raw hex/px beyond the on-token `text-[11/12/13.5px]` family the app already uses.
 */
import React from 'react';
import type { HistoryEvent } from '@/src/lib/db/procurementHistory';

// ---------------------------------------------------------------------------
// Date formatting — UTC-safe (avoids a 1-day shift in behind-UTC zones)
// ---------------------------------------------------------------------------
function formatEventTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

export interface ProcurementProgressionTimelineProps {
  /** Events from `buildProcurementHistory` (ASCENDING by time). */
  events: HistoryEvent[];
  className?: string;
}

export const ProcurementProgressionTimeline: React.FC<ProcurementProgressionTimelineProps> = ({
  events,
  className,
}) => {
  if (events.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No history yet — events appear here as the procurement progresses.
      </p>
    );
  }

  // Present newest-first: the current state sits at the top with the ring.
  const ordered = [...events].reverse();

  return (
    <ol
      aria-label="Progression history"
      className={['relative flex flex-col', className].filter(Boolean).join(' ')}
    >
      {ordered.map((ev, i) => {
        const isCurrent = i === 0;
        const isLast = i === ordered.length - 1;
        return (
          <li
            key={`${ev.kind}-${ev.at}-${i}`}
            data-current={isCurrent ? 'true' : undefined}
            className="relative flex gap-3 pb-4 last:pb-0"
          >
            {/* Rail + dot column. The vertical rail (border) connects events; it
                stops at the last event. Decorative — semantics are carried by text. */}
            <div className="relative flex w-4 shrink-0 justify-center" aria-hidden="true">
              {!isLast && (
                <span className="absolute left-1/2 top-4 h-[calc(100%-0.5rem)] w-px -translate-x-1/2 bg-border" />
              )}
              <span
                className={[
                  'relative z-10 mt-0.5 size-4 rounded-full border-2 box-border',
                  isCurrent
                    ? 'border-primary bg-background shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]'
                    : 'border-success bg-success',
                ].join(' ')}
              />
            </div>

            {/* Text column — all data as text (NFR-PR-A11Y-002). */}
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                {ev.kind === 'transition' ? 'Transition' : 'Record'}
              </div>
              <p className="mt-px text-[13.5px] font-semibold text-foreground">{ev.label}</p>
              <div className="mt-px flex flex-wrap gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground">
                {ev.actor && (
                  <span>
                    by <span className="font-mono">{ev.actor}</span>
                  </span>
                )}
                <time dateTime={ev.at}>{formatEventTime(ev.at)}</time>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
};

ProcurementProgressionTimeline.displayName = 'ProcurementProgressionTimeline';
