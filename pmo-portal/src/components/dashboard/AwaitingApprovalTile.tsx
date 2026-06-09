/**
 * AC-IXD-PROC-W5-2h — AwaitingApprovalTile
 *
 * A KPITile-style component that:
 *  - Shows the count of items awaiting the signed-in user's approval
 *  - Is a single router <Link> to /approvals (a11y: ONE link, no nested interactive)
 *  - Tone: amber (DESIGN.md "needs attention" convention)
 *  - PM/Exec: includeTimesheets=true (procurement Requested not-self + timesheets)
 *  - Finance: includeTimesheets=false (procurement only — Finance has no timesheet approval)
 *  - Engineer: should not render this tile at all (never called from EngineerDashboard)
 *
 * Honest count rules (N15):
 *  procurement count = useProcurements() filtered to
 *    status === 'Requested' AND can('transition','procurement') AND not-self
 *  timesheet count = useTimesheetsAwaitingApproval().length
 *  Never sum a real count with a placeholder.
 *
 * Design tokens only — no raw hex.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/src/components/ui/icons';
import { Tooltip } from '@/src/components/ui/Tooltip';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useTimesheetsAwaitingApproval } from '@/src/hooks/useTimesheetApproval';
import { useAuth } from '@/src/auth/useAuth';
import { can } from '@/src/auth/policy';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { cn } from '@/src/components/ui/cn';

export interface AwaitingApprovalTileProps {
  /** Include timesheet count in the total (PM/Exec=true; Finance=false). */
  includeTimesheets: boolean;
  /** Optional label override (default "Awaiting your approval"). */
  label?: string;
  className?: string;
}

export const AwaitingApprovalTile: React.FC<AwaitingApprovalTileProps> = ({
  includeTimesheets,
  label = 'Awaiting your approval',
  className,
}) => {
  const { currentUser } = useAuth();
  const { realRole } = useEffectiveRole();
  const selfId = currentUser?.id;

  const { data: procurements, isPending: procPending } = useProcurements();
  const { data: timesheets } = useTimesheetsAwaitingApproval();

  const loading = procPending;

  // Procurement count: Requested + can approve + not self
  const procCount = (procurements ?? []).filter(
    (p) =>
      p.status === 'Requested' &&
      can('transition', 'procurement', { realRole: realRole as never }) &&
      p.requested_by_id !== selfId,
  ).length;

  const tsCount = includeTimesheets ? (timesheets?.length ?? 0) : 0;
  const total = procCount + tsCount;

  const helpText = includeTimesheets
    ? 'Purchase requests and timesheets waiting on your decision. Click to open the approvals inbox.'
    : 'Purchase requests waiting on your decision. Click to open the approvals inbox.';

  // ── Amber tone (DESIGN.md warning/attention convention) ──────────────────
  const iconTileClass = 'bg-warning/[0.18] text-warning-foreground';

  return (
    /*
     * The ENTIRE tile is a single <Link> (a11y: one interactive element, no nesting).
     * We replicate KPITile's visual structure inline so we can wrap it as a link
     * without nesting <a> inside an interactive KPITile. KPITile itself does not
     * accept a link wrapper, so we reuse its token classes directly here.
     */
    <Link
      to="/approvals"
      aria-label={`${label}: ${loading ? 'loading' : total} items`}
      className={cn(
        'group relative flex min-w-0 flex-col gap-2.5 rounded-lg border border-border bg-card px-4 pb-3.5 pt-4 transition-shadow duration-150',
        'hover:shadow-[0_2px_10px_hsl(240_6%_10%/0.06)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'grid size-[30px] shrink-0 place-items-center rounded-lg [&_svg]:size-4',
            iconTileClass,
          )}
        >
          <Icon name="check" />
        </span>
        <span className="text-[12.5px] font-medium text-muted-foreground">{label}</span>
        <Tooltip content={helpText}>
          {/* Tooltip's trigger must be a focusable element; since the parent Link
              already handles keyboard activation, this help button has tabIndex=-1
              to keep focus order clean (only ONE interactive in the tile). */}
          <span
            tabIndex={-1}
            aria-hidden="true"
            className="ml-auto grid size-[15px] cursor-help place-items-center text-muted-foreground opacity-55 group-hover:opacity-100 [&_svg]:size-3.5"
          >
            <Icon name="help" />
          </span>
        </Tooltip>
      </div>

      {loading ? (
        <div data-testid="kpi-skeleton" className="skel h-[23px] w-2/3" />
      ) : (
        <div className="text-[23px] font-bold leading-none tracking-[-0.02em] tabular">
          {total}
        </div>
      )}

      <div className="flex items-center gap-[7px] text-[12px]">
        <span className="text-muted-foreground">
          {total === 0 ? 'nothing waiting' : `item${total !== 1 ? 's' : ''} waiting`}
        </span>
      </div>
    </Link>
  );
};
