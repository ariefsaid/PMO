/**
 * AC-IXD-PROC-W5-3 — AwaitingApprovalTile (N15)
 *
 * A KPITile-as-link shortcut to the unified `/approvals` inbox. Now that `/approvals`
 * hosts both procurement PRs and timesheets (Surface C), this tile is honest.
 *
 * Rendered only while something waits (or the count failed) — SL-A.
 *
 * Honest, role-scoped count (never sum a real count with a placeholder):
 *   procurement = useProcurements() filtered to
 *     status === 'Requested' AND can('transition','procurement', realRole) AND not-self (SoD-a)
 *   timesheet  = useTimesheetsAwaitingApproval().length  (already excludes own)
 *
 *   PM / Exec   → includeTimesheets=true  (procurement + timesheets)
 *   Finance     → includeTimesheets=false (procurement only — no timesheet approval)
 *   Engineer    → not rendered (cannot approve; OD-W2-2). If rendered defensively, the
 *                 `can()` gate yields 0 PRs and timesheets are excluded.
 *
 * Reuses the KPITile link variant (`to`) — NOT an inline fork of the tile markup
 * (the PR-2 reviewer flagged the fork as drift-risk). Strictly DESIGN.md tokens.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { KPITile } from '@/src/components/ui/KPITile';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useTimesheetsAwaitingApproval } from '@/src/hooks/useTimesheetApproval';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { can } from '@/src/auth/policy';
import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';

export interface AwaitingApprovalTileProps {
  /** Include the timesheet count (PM/Exec=true; Finance=false). */
  includeTimesheets: boolean;
  /** Label override (default "Awaiting your approval"). */
  label?: string;
  testId?: string;
}

export const AwaitingApprovalTile: React.FC<AwaitingApprovalTileProps> = ({
  includeTimesheets,
  label,
  testId = 'kpi-awaiting-approval',
}) => {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t('dashboard.kpi.awaitingApproval.label', 'Awaiting your approval');
  const { currentUser } = useAuth();
  const { realRole } = useEffectiveRole();
  const selfId = currentUser?.id;

  const { data: procurements, isPending: procPending, isError: procError } = useProcurements();
  const { data: timesheets, isPending: tsPending, isError: tsError } = useTimesheetsAwaitingApproval();
  // Loading until BOTH contributing queries settle, else the tile briefly shows a
  // procurement-only count as if final (review #4).
  const loading = procPending || (includeTimesheets && tsPending);
  // B-0.5: on error surface "—" / error tone (match ExecutiveDashboard's approvalError)
  // instead of silently falling back to 0 / "nothing waiting".
  const hasError = procError || (includeTimesheets && tsError);

  // PR count: Requested + this role may approve procurement + not raised by me (SoD).
  // pendingProcurementApprovals is the single source of truth for this predicate (H7).
  const canApproveProc = can('transition', 'procurement', { realRole });
  const procCount = canApproveProc
    ? pendingProcurementApprovals(procurements, selfId, realRole === 'Admin').length
    : 0;

  const tsCount = includeTimesheets ? (timesheets?.length ?? 0) : 0;
  const total = procCount + tsCount;

  // SL-A (owner 2026-10-20, simpler dashboards): nothing waiting → no tile; the nav count still
  // carries the inbox. An error keeps the red "—" so a failure never reads as "nothing waiting".
  if (!loading && !hasError && total === 0) return null;

  const vs = hasError
    ? t('dashboard.kpi.awaitingApproval.unavailable', 'unavailable — check connection')
    : total === 1
        ? t('dashboard.kpi.awaitingApproval.one', '{{count}} item waiting', { count: total })
        : t('dashboard.kpi.awaitingApproval.many', '{{count}} items waiting', { count: total });

  const linkLabel = hasError
    ? t('dashboard.kpi.awaitingApproval.linkUnavailable', '{{label}}: unavailable', { label: resolvedLabel })
    : total === 1
      ? t('dashboard.kpi.awaitingApproval.linkOne', '{{label}}: {{count}} item awaiting', { label: resolvedLabel, count: total })
      : t('dashboard.kpi.awaitingApproval.linkMany', '{{label}}: {{count}} items awaiting', { label: resolvedLabel, count: total });

  return (
    <KPITile
      testId={testId}
      tone={hasError ? 'red' : 'amber'}
      icon="check"
      label={resolvedLabel}
      value={hasError ? '—' : String(total)}
      vs={vs}
      loading={loading}
      to="/approvals"
      linkLabel={linkLabel}
      ctaLabel={t('dashboard.kpi.awaitingApproval.review', 'Review')}
    />
  );
};
