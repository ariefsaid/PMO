import React from 'react';
import { Button, StatusPill, type StatusVariant } from '@/src/components/ui';
import type { TimesheetPushState } from '@/src/lib/db/timesheetPush';

const LABEL: Record<TimesheetPushState['push_state'], string> = {
  pending: 'Pending ERP push',
  pushing: 'Pushing to ERP…',
  pushed: 'Pushed to ERP',
  failed: 'ERP push failed',
  held: 'ERP push held',
};

const VARIANT: Record<TimesheetPushState['push_state'], StatusVariant> = {
  pending: 'neutral',
  pushing: 'progress',
  pushed: 'won',
  failed: 'lost',
  held: 'warn',
};

export interface PushStateBadgeProps {
  /** `null` ⇒ no mirror row exists (an unflipped org, or a sheet that hasn't reached the push path).
   *  FR-TSP-173: this renders NOTHING — the badge is supplementary and its absence never blocks the
   *  page's render. */
  state: TimesheetPushState | null;
  /** ADR-0016 UX gate result — `can('push_timesheet', 'timesheet', ctx)`. The Retry affordance is
   *  offered ONLY when true AND the state is `failed`/`held`; the RPC (`approved_timesheet_for_push`
   *  + `approvalGuard.ts`) is the real authority regardless of this flag. */
  canRetry: boolean;
  onRetry?: () => void;
  retryLoading?: boolean;
}

/**
 * P3b (FR-TSP-085, FR-TSP-173) — the ERP push-state badge. One of the four
 * `timesheet_erp_mirror.push_state` values, `DESIGN.md`-tokened via the shared `StatusPill` (the
 * Quiet-Status Rule — dot + label, never a loud filled slab). `failed`/`held` additionally surface the
 * classified `push_error` and, when the viewer is authorized, a Retry affordance.
 */
export const PushStateBadge: React.FC<PushStateBadgeProps> = ({
  state,
  canRetry,
  onRetry,
  retryLoading = false,
}) => {
  if (!state) return null;
  const needsAttention = state.push_state === 'failed' || state.push_state === 'held';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusPill variant={VARIANT[state.push_state] ?? 'neutral'}>
        {LABEL[state.push_state] ?? state.push_state}
      </StatusPill>
      {state.push_state === 'pushed' && state.ts_number && (
        <span className="text-[12px] text-muted-foreground">{state.ts_number}</span>
      )}
      {needsAttention && state.push_error && (
        <span className="text-[12px] text-muted-foreground">{state.push_error}</span>
      )}
      {needsAttention && canRetry && onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} loading={retryLoading} disabled={retryLoading}>
          Retry
        </Button>
      )}
    </div>
  );
};
