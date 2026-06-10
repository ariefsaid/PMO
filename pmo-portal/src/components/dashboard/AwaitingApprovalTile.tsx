/**
 * AC-IXD-PROC-W5-3 — AwaitingApprovalTile (N15)
 *
 * A KPITile-as-link shortcut to the unified `/approvals` inbox. Now that `/approvals`
 * hosts both procurement PRs and timesheets (Surface C), this tile is honest.
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
  label = 'Awaiting your approval',
  testId = 'kpi-awaiting-approval',
}) => {
  const { currentUser } = useAuth();
  const { realRole } = useEffectiveRole();
  const selfId = currentUser?.id;

  const { data: procurements, isPending: procPending } = useProcurements();
  const { data: timesheets, isPending: tsPending } = useTimesheetsAwaitingApproval();
  // Loading until BOTH contributing queries settle, else the tile briefly shows a
  // procurement-only count as if final (review #4).
  const loading = procPending || (includeTimesheets && tsPending);

  // PR count: Requested + this role may approve procurement + not raised by me (SoD).
  // pendingProcurementApprovals is the single source of truth for this predicate (H7).
  const canApproveProc = can('transition', 'procurement', { realRole });
  const procCount = canApproveProc
    ? pendingProcurementApprovals(procurements, selfId).length
    : 0;

  const tsCount = includeTimesheets ? (timesheets?.length ?? 0) : 0;
  const total = procCount + tsCount;

  const help = includeTimesheets
    ? 'Purchase requests and timesheets waiting on your decision. Open the approvals inbox.'
    : 'Purchase requests waiting on your decision. Open the approvals inbox.';

  const vs = total === 0 ? 'nothing waiting' : `${total === 1 ? '1 item' : `${total} items`} waiting`;

  return (
    <KPITile
      testId={testId}
      tone="amber"
      icon="check"
      label={label}
      value={String(total)}
      vs={vs}
      help={help}
      loading={loading}
      to="/approvals"
      linkLabel={`${label}: ${total} ${total === 1 ? 'item' : 'items'} awaiting`}
    />
  );
};
