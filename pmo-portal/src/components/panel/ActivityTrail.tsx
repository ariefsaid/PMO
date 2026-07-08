/**
 * ActivityTrail — a compact, persistent vertical checklist of what the agent has done
 * and is doing during a run. Surfaces the live step trail (useAssistantPanel's
 * `activityTrail`) so a slow or thrashing run is transparent, not a frozen mystery box.
 *
 * Each step is either done (✓ + friendly label + optional detail like "4 found") or the
 * current/active step (small spinner + friendly label + "…"). The region is a polite,
 * non-atomic live log: SR users hear each step as it lands, not a re-read of the whole
 * list on every change.
 *
 * UX-only — driven by the SAME step/tool events the panel already consumes; no new event
 * type. Renders nothing when the trail is empty (the StreamingIndicator covers that case).
 */
import React from 'react';
import type { TrailStep } from '@/src/hooks/useAssistantPanel';
import { friendlyActivity } from '@/src/lib/agent/activityLabel';

interface ActivityTrailProps {
  items: TrailStep[];
}

/** A small inline spinner (matches Button.tsx's Spinner, sized to text-xs). aria-hidden. */
const Spinner: React.FC = () => (
  <svg
    aria-hidden="true"
    className="size-3 shrink-0 animate-spin motion-reduce:animate-none"
    viewBox="0 0 24 24"
    fill="none"
  >
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

export const ActivityTrail: React.FC<ActivityTrailProps> = ({ items }) => {
  if (items.length === 0) return null;

  return (
    <ul
      role="log"
      aria-live="polite"
      aria-atomic="false"
      aria-label="Assistant activity"
      className="space-y-1 px-4 py-1 text-xs text-muted-foreground motion-reduce:animate-none"
    >
      {items.map((step) => (
        <li
          key={step.id}
          className="flex items-center gap-1.5 motion-reduce:animate-none"
        >
          {step.done ? (
            // ✓ glyph — aria-hidden; the friendly label is the accessible text.
            <span aria-hidden className="shrink-0 text-muted-foreground/70">
              ✓
            </span>
          ) : (
            <Spinner />
          )}
          <span className={step.done ? 'text-muted-foreground/70' : 'text-muted-foreground'}>
            {friendlyActivity(step.label)}
            {!step.done && '…'}
          </span>
          {step.done && step.detail && (
            <span className="tabular-nums text-muted-foreground/70">· {step.detail}</span>
          )}
        </li>
      ))}
    </ul>
  );
};
