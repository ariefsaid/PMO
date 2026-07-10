import React from 'react';
import { Icon } from '@/src/components/ui';
import type { PendingPushState } from '@/src/lib/adapterSeam/pendingPush';

/**
 * ADR-0056 / AC-CUA-060 — the per-task pending-push badge for an externally-owned task write.
 * Renders nothing for `idle`, so PMO-owned surfaces stay byte-for-byte (AC-CUA-061 — TasksTab wires
 * this in only when `routeTaskWrite() === 'external'`). DESIGN.md tokens only; the distinct LABEL
 * always rides alongside the icon (never colour-only — DESIGN.md Tinted-Status / color-not-only).
 *
 * The three non-idle states map to the shared `PendingPushState` machine:
 *   pushing    → neutral muted pill + a spinning sync icon (the write is in-flight to ClickUp)
 *   pushed     → success pill + a check (the mirrored read-model has converged)
 *   push-failed → destructive pill + an alert, carrying the classified external-error headline
 */
export interface TaskPushBadgeProps {
  state: PendingPushState;
}

export const TaskPushBadge: React.FC<TaskPushBadgeProps> = ({ state }) => {
  if (state.status === 'idle') return null;

  if (state.status === 'pushing') {
    return (
      <span
        role="status"
        aria-label="pushing to external system"
        title="Syncing to ClickUp"
        className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
      >
        <Icon name="refresh" className="size-3 animate-spin" />
        Pushing…
      </span>
    );
  }

  if (state.status === 'pushed') {
    return (
      <span
        role="status"
        aria-label="pushed to external system"
        title="Synced to ClickUp"
        className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success"
      >
        <Icon name="check" className="size-3" />
        Pushed
      </span>
    );
  }

  // push-failed — carries the classified external-error headline (AC-CUA-062).
  const headline = state.error?.headline ?? 'Push failed';
  return (
    <span
      role="status"
      aria-label={`push failed: ${headline}`}
      title={state.error?.detail ?? 'The push to ClickUp failed'}
      className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive"
    >
      <Icon name="alert" className="size-3" />
      Push failed
    </span>
  );
};
