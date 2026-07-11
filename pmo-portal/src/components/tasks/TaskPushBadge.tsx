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
 *   pushing    → neutral muted pill + a spinning sync icon (the write is in-flight)
 *   pushed     → success pill + a check (the mirrored read-model has converged)
 *   push-failed → destructive pill + an alert, carrying the classified external-error headline
 *
 * Confinement (FR-CUA-012, review fix #6): the badge is a GENERIC task-surface molecule — no
 * external-system brand vocabulary lives here. The label/tooltip wording is generic 'external system'
 * to match the aria-labels (the tier is unnamed at this layer); the brand label is rendered only at
 * the Integrations view boundary, where it belongs.
 *
 * AA contrast (review fix #8): the pushed/push-failed text uses the AA-darkened tinted-status label
 * tokens (`--status-won-text` / `--status-lost-text`, the StatusPill `won`/`lost` idiom — ≥6:1 on the
 * canvas in both themes), NOT the raw `--success`/`--destructive` tokens (which failed AA at 4.17:1 on
 * the tinted fill). Text sits on the board 11.5px register.
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
        title="Syncing to the external system"
        className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11.5px] font-semibold text-muted-foreground"
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
        title="Synced to the external system"
        style={{ color: 'hsl(var(--status-won-text))' }}
        className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11.5px] font-semibold"
      >
        <Icon name="check" className="size-3" />
        Pushed
      </span>
    );
  }

  // push-failed — carries the classified external-error headline (AC-CUA-062).
  const headline = state.error?.headline ?? 'Push failed';
  // Review fix #8: avoid the duplicated 'push failed: Push failed' when the headline is the generic
  // default — the visible 'Push failed' label already conveys the state; the aria carries the reason
  // only when there IS a specific one.
  const ariaLabel = headline === 'Push failed' ? 'push failed' : `push failed: ${headline}`;
  return (
    <span
      role="status"
      aria-label={ariaLabel}
      title={state.error?.detail ?? 'The push to the external system failed'}
      style={{ color: 'hsl(var(--status-lost-text))' }}
      className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[11.5px] font-semibold"
    >
      <Icon name="alert" className="size-3" />
      Push failed
    </span>
  );
};
