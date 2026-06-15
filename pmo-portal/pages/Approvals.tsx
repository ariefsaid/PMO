import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AccessDenied, ViewToggle } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useTimesheetsAwaitingApproval } from '@/src/hooks/useTimesheetApproval';
import { useAuth } from '@/src/auth/useAuth';
import { ApprovalsQueue } from './timesheets/ApprovalsQueue';
import { ProcurementApprovalSection } from './approvals/ProcurementApprovalSection';
import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';

/**
 * `/approvals` — the single canonical "Approvals" inbox (CW-6 / audit P7 / C-IMP-4).
 *
 * This is the ONE approver home: the rail nav, every dashboard approvals card, the
 * Timesheets "approvals queue" cross-link, and the Procurement "Needs approval" filter
 * all route here. The page title is "Approvals" (matching the rail label, reconciling
 * the old "Needs my approval" H1 mismatch); "Needs my approval" survives as the subtitle.
 *
 * Two module sections, each shown only when the REAL role may act on that entity (UX-only
 * clarity — RLS is the enforcement authority, ADR-0016):
 *   • Procurement — PRs in `Requested` the role may approve, not-self (SoD). Rows
 *     expand in place (ProcurementApprovalRow): budget impact + line items revealed on
 *     click, with adjacent Approve / Reject actions — no navigation away from the inbox.
 *   • Timesheets  — the enhanced ApprovalsQueue (expand-in-place + bulk approve).
 *
 * When a role can act on BOTH modules, the sections are split into deep-linkable scope
 * tabs (`?scope=procurement` / `?scope=timesheets`) so a dashboard card or a Timesheets
 * cross-link can land directly on the right queue. A single-module role sees that one
 * section with no tab-switcher (nothing to switch to).
 *
 * Role map (from policy.ts): procurement.transition = Admin·Exec·PM·Finance;
 * approval.transition (timesheets) = Admin·Exec·PM. So Finance → procurement only,
 * PM/Exec/Admin → both, Engineer → neither (the no-access surface).
 */

type Scope = 'procurement' | 'timesheets';

const ApprovalsPage: React.FC = () => {
  const may = usePermission();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const selfId = currentUser?.id;
  const [searchParams, setSearchParams] = useSearchParams();

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

  // Which module sections this role can act on, in display order.
  const availableScopes: Scope[] = [
    ...(canApproveProcurement ? (['procurement'] as const) : []),
    ...(canApproveTimesheets ? (['timesheets'] as const) : []),
  ];
  // Tabs only when there's a real choice (both modules); a single-module role gets no
  // switcher. The active scope comes from the deep-link, falling back to the first
  // section the role can see (so a dashboard card / cross-link lands on the right queue).
  const hasTabs = availableScopes.length > 1;
  const urlScope = searchParams.get('scope') as Scope | null;
  const activeScope: Scope =
    urlScope && availableScopes.includes(urlScope) ? urlScope : availableScopes[0];

  const selectScope = (next: Scope) => {
    const params = new URLSearchParams(searchParams);
    params.set('scope', next);
    setSearchParams(params, { replace: true });
  };

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
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">Approvals</h1>
        <p className="mt-0.5 max-w-[72ch] text-sm text-muted-foreground">
          Needs my approval — everything waiting on your decision, across procurement and timesheets.
        </p>
      </div>

      {/* Deep-linkable scope tabs (only when the role can act on both modules). */}
      {hasTabs && !allCaughtUp && (
        <div className="mb-4">
          <ViewToggle<Scope>
            options={[
              { value: 'procurement', label: 'Procurement', icon: 'cart', count: pendingProc },
              { value: 'timesheets', label: 'Timesheets', icon: 'clock', count: pendingTs },
            ]}
            value={activeScope}
            onChange={selectScope}
            ariaLabel="Approvals scope"
          />
        </div>
      )}

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
          {canApproveProcurement && activeScope === 'procurement' && (
            <section aria-label="Purchase requests awaiting you">
              <ProcurementApprovalSection />
            </section>
          )}
          {canApproveTimesheets && activeScope === 'timesheets' && (
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
