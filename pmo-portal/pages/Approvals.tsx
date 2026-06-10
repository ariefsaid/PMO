import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AccessDenied } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useTimesheetsAwaitingApproval } from '@/src/hooks/useTimesheetApproval';
import { useAuth } from '@/src/auth/useAuth';
import { ApprovalsQueue } from './timesheets/ApprovalsQueue';
import { ProcurementApprovalSection } from './approvals/ProcurementApprovalSection';
import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';

/**
 * `/approvals` — the unified, role-aware "Needs my approval" inbox (Wave-5 N6, OD-W5-1).
 *
 * Two sections, each shown only when the REAL role may act on that entity (UX-only
 * clarity — RLS is the enforcement authority, ADR-0016):
 *   • Procurement — PRs in `Requested` the role may approve, not-self (SoD). Rows
 *     ROUTE to /procurement/:id (the reordered decision screen); no inline approve.
 *   • Timesheets  — the enhanced ApprovalsQueue (expand-in-place + bulk approve).
 *
 * Role map (from policy.ts): procurement.transition = Admin·Exec·PM·Finance;
 * approval.transition (timesheets) = Admin·Exec·PM. So Finance → procurement only,
 * PM/Exec/Admin → both, Engineer → neither (the no-access surface).
 */
const ApprovalsPage: React.FC = () => {
  const may = usePermission();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const selfId = currentUser?.id;

  const canApproveProcurement = may('transition', 'procurement');
  const canApproveTimesheets = may('transition', 'approval');

  // Counts for the "all caught up" page-level empty (only when the role can see a
  // section at all). These read the SAME cached queries the sections render from.
  const { data: procurements, isPending: procPending, isError: procError } = useProcurements();
  const { data: timesheets, isPending: tsPending, isError: tsError } = useTimesheetsAwaitingApproval();

  // No-access: a role that can approve neither (Engineer) reaching /approvals by URL.
  if (!canApproveProcurement && !canApproveTimesheets) {
    return (
      <AccessDenied
        title="You don't have access to approvals"
        sub="Approvals are for the roles that sign off purchase requests or timesheets. Your work lives on your dashboard, projects, and tasks."
        onBack={() => navigate('/')}
      />
    );
  }

  const pendingProc = canApproveProcurement
    ? pendingProcurementApprovals(procurements, selfId).length
    : 0;
  const pendingTs = canApproveTimesheets ? (timesheets?.length ?? 0) : 0;

  // The page-level "all caught up" empty only collapses BOTH sections when every
  // section the role can see has SETTLED successfully with zero items. While a query
  // is pending, or has errored, the sections render (each owns its own loading/error
  // skeleton + retry) so a transient state never masquerades as "caught up".
  const procSettledEmpty = !canApproveProcurement || (!procPending && !procError && pendingProc === 0);
  const tsSettledEmpty = !canApproveTimesheets || (!tsPending && !tsError && pendingTs === 0);
  const allCaughtUp = procSettledEmpty && tsSettledEmpty;

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">Needs my approval</h1>
        <p className="mt-0.5 max-w-[72ch] text-sm text-muted-foreground">
          Everything waiting on your decision, across procurement and timesheets.
        </p>
      </div>

      {allCaughtUp ? (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card px-6 py-14 text-center"
          data-testid="approvals-caught-up"
        >
          <div className="text-[15px] font-semibold">You&rsquo;re all caught up</div>
          <p className="max-w-[44ch] text-[13px] text-muted-foreground">
            Nothing is waiting on your approval right now. New purchase requests and submitted
            timesheets will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {canApproveProcurement && (
            <section aria-label="Purchase requests awaiting you">
              <ProcurementApprovalSection />
            </section>
          )}
          {canApproveTimesheets && (
            <section aria-label="Timesheets awaiting you">
              <h2 className="mb-2 text-sm font-semibold">Timesheets awaiting you</h2>
              <ApprovalsQueue />
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default ApprovalsPage;
