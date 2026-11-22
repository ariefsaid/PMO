import { useMemo } from 'react';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { can } from '@/src/auth/policy';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useHasTimesheetApprovalWork, useTimesheetsAwaitingApproval } from '@/src/hooks/useTimesheetApproval';
import { useExpenseClaimsAwaitingDecision } from '@/src/hooks/useExpenseClaims';
import { useInvoicesAwaitingViewer } from '@/src/hooks/useInvoicesAwaitingViewer';
import { useWaitingForMe } from '@/src/hooks/useMaterialRequests';
import { useLeaveRequests } from '@/src/hooks/useLeave';
import { useImprestAwaiting } from '@/src/hooks/useImprest';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useDatabaseWaiting, useDecisionStanding } from '@/src/hooks/useWaitingDecisions';
import type { WaitingDecisionRow } from '@/src/lib/db/waitingDecisions';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';
import type { ExpenseClaimAwaiting } from '@/src/hooks/useExpenseClaims';
import type { WaitingStep } from '@/src/lib/repositories/materialRequests';
import type { LeaveRequestRow } from '@/src/lib/db/leave';
type AwaitingImprest = Awaited<ReturnType<typeof import('@/src/lib/db/imprest').listAwaitingImprest>>;
import { claimsAwaitingViewer } from '@/src/lib/expenses/expenseRules';
import { availablePlanActions, availableReplenishmentActions } from '@/src/lib/imprest/imprestRules';
import { approvalPopulation, pendingProcurementApprovals, type ApprovalPopulationEntry } from '@/src/lib/selectors/approvals';
import { WAITING_KINDS, type WaitingKind } from '@/src/lib/approvals/waitingKinds';


interface QueryRead<T> { data: T | undefined; isPending: boolean; isError: boolean; refetch: () => unknown }
const UNKNOWN = { data: undefined, isPending: false, isError: false, refetch: () => undefined };

/**
 * A bare render has no data layer: the real query hooks then throw "No QueryClient set" at their first internal hook, the same place on every
 * render, so the order of hooks never changes. That kind is then unknown (pending), never "nothing waiting". Any other error is a bug and
 * still throws. With a data layer this never catches anything.
 */
function withoutDataLayer<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof Error && /No QueryClient set/.test(error.message)) return fallback;
    throw error;
  }
}

export interface WaitingForYou {
  /** Everything the viewer can decide now, oldest first, one entry per record. The home list, the badge and the inbox all read THIS. */
  entries: ApprovalPopulationEntry[];
  /** The headline number: always `entries.length`; undefined while any kind is unread or failed (a partial count is never shown as the total). */
  count: number | undefined;
  countFor: (kind: WaitingKind) => number;
  pendingKinds: WaitingKind[];
  failedKinds: WaitingKind[];
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * fix-waiting item 1: the one waiting list. Each kind is read once, by the read its own screen already trusts (the database
 * stays the authority), then combined and de-duplicated by `approvalPopulation`. The kinds are the registry in
 * `src/lib/approvals/waitingKinds.ts`; `Record<WaitingKind, ...>` below makes a kind with no read a compile error.
 */
function useLiveWaitingForYou(): WaitingForYou {
  const { currentUser } = useAuth();
  const { realRole } = useEffectiveRole();
  const orgId = useOrgId();
  const userId = currentUser?.id;
  const signedIn = Boolean(orgId && userId && realRole);

  const procurementRole = can('transition', 'procurement', { realRole });
  const invoiceRole = can('transition', 'salesInvoice', { realRole });
  const expenseRole = ['Admin', 'Executive', 'Finance', 'Project Manager'].includes(realRole ?? '');

  /* eslint-disable react-hooks/rules-of-hooks -- each read is called exactly once per render, in a fixed order; the wrapper only turns "no data layer" into an unknown read */
  const procurements = withoutDataLayer(() => useProcurements({ status: 'Requested', enabled: signedIn && procurementRole }), UNKNOWN as QueryRead<ProcurementWithRefs[]>);
  // Any authenticated real role can be an assigned timesheet approver; the read is caller-filtered.
  const timesheets = withoutDataLayer(() => useTimesheetsAwaitingApproval(), UNKNOWN as QueryRead<TimesheetAwaitingApproval[]>);
  const expenses = withoutDataLayer(() => useExpenseClaimsAwaitingDecision(), UNKNOWN as QueryRead<ExpenseClaimAwaiting[]>);
  const invoices = withoutDataLayer(() => useInvoicesAwaitingViewer(), { rows: [], isPending: false, isError: false, enabled: false, refetch: () => undefined } as ReturnType<typeof useInvoicesAwaitingViewer>);
  // A material-request step is the viewer's whenever the database says so: the organisation's inbox setting only decides
  // whether a notification is also written, never whether the step is counted.
  const material = withoutDataLayer(() => useWaitingForMe(signedIn), UNKNOWN as QueryRead<WaitingStep[]>);
  const leave = withoutDataLayer(() => useLeaveRequests(), UNKNOWN as QueryRead<LeaveRequestRow[]>);
  const imprest = withoutDataLayer(() => useImprestAwaiting(), UNKNOWN as QueryRead<AwaitingImprest>);
  const database = withoutDataLayer(() => useDatabaseWaiting(orgId, userId, signedIn), UNKNOWN as QueryRead<WaitingDecisionRow[]>);
  /* eslint-enable react-hooks/rules-of-hooks */

  const entries = useMemo<ApprovalPopulationEntry[]>(() => {
    const procurementRows = procurementRole ? pendingProcurementApprovals(procurements.data, userId, realRole === 'Admin') : [];
    const expenseRows = expenseRole ? claimsAwaitingViewer(expenses.data ?? [], userId, realRole) : [];
    const imprestData = imprest.data;
    const imprestEntries: ApprovalPopulationEntry[] = [
      ...(imprestData?.plans ?? [])
        .filter((p) => p.float && availablePlanActions({ userId, realRole, custodianId: p.float.custodian_id, plan: p }).includes('approvePlan'))
        .map((p) => ({ key: `imprest:plan:${p.id}`, kind: 'imprest' as const, createdAt: p.submitted_at ?? '', row: p })),
      ...(imprestData?.replenishments ?? [])
        .filter((r) => r.float && availableReplenishmentActions({ userId, realRole, custodianId: r.float.custodian_id, rep: r })
          .some((a) => a === 'approveReplenishment' || a === 'payReplenishment'))
        .map((r) => ({ key: `imprest:rep:${r.id}`, kind: 'imprest' as const, createdAt: r.requested_at ?? '', row: r })),
    ];
    const byKind: Record<WaitingKind, ApprovalPopulationEntry[]> = {
      procurement: procurementRows.map((row) => ({ key: `procurement:${row.id}`, kind: 'procurement', createdAt: row.created_at, row })),
      timesheets: (timesheets.data ?? []).map((row) => ({ key: `timesheets:${row.id}`, kind: 'timesheets', createdAt: row.week_start_date, row })),
      expense: expenseRows.map((entry) => ({ key: `expense:${entry.claim.id}`, kind: 'expense', createdAt: entry.claim.created_at, row: entry })),
      invoice: (invoiceRole && invoices.enabled !== false ? invoices.rows : []).map((row) => ({ key: `invoice:${row.id}`, kind: 'invoice', createdAt: row.created_at, row })),
      material: (material.data ?? []).map((row) => ({ key: `material:${row.requestId}`, kind: 'material', createdAt: row.submittedAt, row })),
      leave: (leave.data ?? []).filter((r) => r.can_decide).map((row) => ({ key: `leave:${row.id}`, kind: 'leave', createdAt: row.start_date, row })),
      imprest: imprestEntries,
      daily_report: [], work_order_issue: [], delivery_record: [], transfer_receipt: [], quantity_change: [], certificate: [], equipment_plan: [],
    };
    for (const row of database.data ?? []) byKind[row.kind].push({ key: `${row.kind}:${row.recordId}`, kind: row.kind, createdAt: row.createdAt, row });
    return WAITING_KINDS.flatMap((kind) => byKind[kind]);
  }, [database.data, expenseRole, expenses.data, imprest.data, invoiceRole, invoices.enabled, invoices.rows, leave.data, material.data, procurementRole, procurements.data, realRole, timesheets.data, userId]);

  const population = useMemo(() => approvalPopulation(entries, 'all'), [entries]);

  // A kind that does not apply to this viewer is not "pending": a disabled query stays pending by convention.
  const state: Record<WaitingKind, { pending: boolean; error: boolean }> = {
    procurement: { pending: procurementRole && procurements.isPending, error: procurementRole && procurements.isError },
    timesheets: { pending: signedIn && timesheets.isPending, error: timesheets.isError },
    expense: { pending: expenseRole && expenses.isPending, error: expenseRole && expenses.isError },
    invoice: { pending: invoiceRole && invoices.isPending, error: invoiceRole && invoices.isError },
    material: { pending: signedIn && material.isPending, error: material.isError },
    leave: { pending: false, error: false },   // switched off or failing leave never blocks the rest of the list
    imprest: { pending: false, error: false }, // a failed site-cash read keeps its own message in the inbox section
    daily_report: { pending: signedIn && database.isPending, error: database.isError },
    work_order_issue: { pending: signedIn && database.isPending, error: database.isError },
    delivery_record: { pending: signedIn && database.isPending, error: database.isError },
    transfer_receipt: { pending: signedIn && database.isPending, error: database.isError },
    quantity_change: { pending: signedIn && database.isPending, error: database.isError },
    certificate: { pending: signedIn && database.isPending, error: database.isError },
    equipment_plan: { pending: signedIn && database.isPending, error: database.isError },
  };
  const pendingKinds = WAITING_KINDS.filter((kind) => state[kind].pending);
  const failedKinds = WAITING_KINDS.filter((kind) => state[kind].error);
  const refetch = () => {
    void procurements.refetch(); void timesheets.refetch(); void expenses.refetch(); void invoices.refetch(); void material.refetch();
    void leave.refetch(); void imprest.refetch(); void database.refetch();
  };

  return {
    entries: population,
    count: pendingKinds.length > 0 || failedKinds.length > 0 ? undefined : population.length,
    countFor: (kind) => population.filter((entry) => entry.kind === kind).length,
    pendingKinds,
    failedKinds,
    isPending: pendingKinds.length > 0 && failedKinds.length === 0,
    isError: failedKinds.length > 0,
    refetch,
  };
}

export const useWaitingForYou = useLiveWaitingForYou;

/**
 * Whether to offer the Approvals entry to a login whose role is not on the entry's role list: anyone who can decide anything
 * (`my_decision_standing`: a chain-step role, a pin, a stand-in, a line manager) or has something waiting now (a requester
 * whose delivery is due). Optimistic while the answer loads or fails, so the entry never flickers out.
 */
export function useApprovalsEntryOffered(): boolean {
  const standing = useDecisionStanding();
  const waiting = useWaitingForYou();
  // A manager whose only week is approved still has the correction path to reach: the timesheet eligibility read keeps counting it.
  const timesheetWork = useHasTimesheetApprovalWork();
  return Boolean(standing.data || standing.isPending || standing.isError || waiting.entries.length > 0 || timesheetWork.data || timesheetWork.isPending || timesheetWork.isError);
}
