/**
 * ProcurementHistoryTimeline — progression-history for a procurement case.
 *
 * Renders the output of `buildProcurementHistory(detail)` as a semantic <ol> with
 * accessible name "Progression history" (NFR-PR-A11Y-002). Each event's kind, label,
 * actor, and timestamp appear as TEXT (not color-only). Token-pure; no horizontal bleed
 * at 360/390 (NFR-PR-RESP-001). DESIGN.md tokens only — no raw hex/px.
 */
import React from 'react';
import type { HistoryEvent } from '@/src/lib/db/procurementHistory';
import { Icon } from '@/src/components/ui';

// ---------------------------------------------------------------------------
// Date formatting — UTC-safe (avoids 1-day shift in behind-UTC zones)
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

// ---------------------------------------------------------------------------
// Per-event icons
// ---------------------------------------------------------------------------

const KIND_ICON: Record<HistoryEvent['kind'], React.ReactNode> = {
  transition: <Icon name="chev" className="size-3.5 rotate-90" aria-hidden />,
  record: <Icon name="doc" className="size-3.5" aria-hidden />,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ProcurementHistoryTimelineProps {
  events: HistoryEvent[];
  className?: string;
}

export const ProcurementHistoryTimeline: React.FC<ProcurementHistoryTimelineProps> = ({
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

  return (
    <ol
      aria-label="Progression history"
      className={[
        'flex flex-col gap-0 divide-y divide-border/40',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {events.map((ev, i) => (
        <li
          key={`${ev.kind}-${ev.at}-${i}`}
          className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
        >
          {/* Icon column — kept visually minimal (not color-coded alone) */}
          <span
            className="mt-0.5 shrink-0 rounded-sm bg-secondary p-1 text-muted-foreground"
            aria-hidden="true"
          >
            {KIND_ICON[ev.kind]}
          </span>

          {/* Text column — all data as text (NFR-PR-A11Y-002) */}
          <div className="min-w-0 flex-1">
            {/* Kind badge — in TEXT so screen readers and color-blind users get it */}
            <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              {ev.kind === 'transition' ? 'Transition' : 'Record'}
            </span>

            {/* Event label (e.g. "Draft → Requested", "Purchase Order PO-…") */}
            <p className="text-[13px] font-medium text-foreground">{ev.label}</p>

            {/* Meta: actor + timestamp */}
            <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              {ev.actor && (
                <span>
                  by <span className="font-mono">{ev.actor}</span>
                </span>
              )}
              <time dateTime={ev.at}>{formatEventTime(ev.at)}</time>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
};

ProcurementHistoryTimeline.displayName = 'ProcurementHistoryTimeline';
