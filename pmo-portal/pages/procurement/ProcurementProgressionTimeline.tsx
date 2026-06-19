/**
 * ProcurementProgressionTimeline — the Overview-bento progression slot.
 *
 * A vertical dot+rail timeline that presents the output of `buildProgressionTimeline(detail)`
 * NEWEST-FIRST so the current state is at the top; the latest event carries a current-state
 * ring (decorative, `aria-hidden`) — "current" is conveyed to assistive tech by the event
 * being first plus its label text, never by color/dot alone (NFR-PR-A11Y-002, WCAG SC 1.4.1).
 *
 * Each event that has an associated document shows its system number as a link (`<a>`)
 * pointing to the Documents tab (`docHref`). Events without a doc ref show the label
 * as plain text only.
 *
 * Default cap: shows the latest 6 events. A "Show N earlier" button (keyboard-operable,
 * `aria-expanded`) reveals the rest when more than 6 exist.
 *
 * Semantic `<ol aria-label="Progression history">`; each event's label, actor, and
 * UTC-safe timestamp render as TEXT. Token-pure (DESIGN.md §6) — rail `bg-border`,
 * event dot `bg-success`, current dot `bg-background border-primary` + a primary-ring
 * halo; no raw hex/px.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProgressionEvent } from '@/src/lib/db/procurementHistory';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of most-recent events to show by default before the "Show N earlier" expander. */
const DEFAULT_CAP = 6;

// ---------------------------------------------------------------------------
// Date formatting — UTC-safe (avoids a 1-day shift in behind-UTC zones)
// ---------------------------------------------------------------------------
function formatEventTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export interface ProcurementProgressionTimelineProps {
  /** Events from `buildProgressionTimeline` (ASCENDING by time). */
  events: ProgressionEvent[];
  className?: string;
}

export const ProcurementProgressionTimeline: React.FC<ProcurementProgressionTimelineProps> = ({
  events,
  className,
}) => {
  const [expanded, setExpanded] = useState(false);

  if (events.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No history yet — events appear here as the procurement progresses.
      </p>
    );
  }

  // Present newest-first: the current state sits at the top with the ring.
  const ordered = [...events].reverse();
  const hiddenCount = Math.max(0, ordered.length - DEFAULT_CAP);
  const visible = expanded ? ordered : ordered.slice(0, DEFAULT_CAP);

  return (
    <div className={className}>
      <ol
        aria-label="Progression history"
        className="relative flex flex-col"
      >
        {visible.map((ev, i) => {
          const isCurrent = i === 0;
          const isLast = i === visible.length - 1 && (expanded || hiddenCount === 0);
          return (
            <li
              key={`${ev.kind}-${ev.at}-${i}`}
              data-current={isCurrent ? 'true' : undefined}
              className="relative flex gap-3 pb-4 last:pb-0"
            >
              {/* Rail + dot column. The vertical rail (border) connects events; it
                  stops at the last visible event. Decorative — semantics are carried
                  by text. */}
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
                {/* Label row: status name + optional doc-ref link */}
                <p className="mt-px text-[13.5px] font-semibold text-foreground">
                  {ev.label}
                  {ev.docRef && ev.docHref && (
                    <>
                      {' · '}
                      <Link
                        to={ev.docHref}
                        className="font-mono text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                      >
                        {ev.docRef}
                      </Link>
                    </>
                  )}
                </p>
                {/* Meta: actor + date */}
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

      {/* Expander — only shown when there are hidden events */}
      {hiddenCount > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-3 text-[12px] text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        >
          {expanded ? 'Show fewer' : `Show ${hiddenCount} earlier`}
        </button>
      )}
    </div>
  );
};

ProcurementProgressionTimeline.displayName = 'ProcurementProgressionTimeline';
