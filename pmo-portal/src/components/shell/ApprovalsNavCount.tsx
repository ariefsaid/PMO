import React, { useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/src/auth/AuthContext';
import { can } from '@/src/auth/policy';
import { claimsAwaitingViewer } from '@/src/lib/expenses/expenseRules';
import { pendingProcurementApprovals, type ApprovalPopulationEntry } from '@/src/lib/selectors/approvals';
import { routeWrite, type OwnershipMap } from '@/src/lib/adapterSeam/router';
import { useApprovalPopulation } from '@/src/hooks/useApprovalPopulation';
import type { ExpenseClaimAwaiting } from '@/src/hooks/useExpenseClaims';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import type { TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';
import {
  awaitingApprovalKey,
  expenseClaimsAwaitingKey,
  externalDomainOwnershipKey,
  nativeDraftInvoicesKey,
  procurementsKey,
  requestedProcurementsKey,
} from '@/src/hooks/approvalsQueryKeys';

/**
 * Read the inbox count only from data already loaded by its owning screens. The global rail must
 * not trigger list reads on every route; until every applicable queue is cached and current, omit
 * the count rather than announce a partial total as complete.
 */
export const ApprovalsNavCount: React.FC = () => {
  const { t } = useTranslation();
  const queryClient = useContext(QueryClientContext);
  const auth = useContext(AuthContext);
  const currentUser = auth?.currentUser;
  // Authorization and counts use the real role, never the view-as role.
  const role = auth?.role ?? null;
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;
  const canApproveProcurement = can('transition', 'procurement', { realRole: role });
  // OD-TS-5: assigned managers of any real role can approve timesheets. The awaiting-approval
  // cache is caller-filtered and applies whenever a real role is authenticated.
  const canApproveTimesheets = role !== null;
  const canApproveExpenses = ['Admin', 'Executive', 'Finance', 'Project Manager'].includes(role ?? '');
  const canApproveInvoices = can('transition', 'salesInvoice', { realRole: role });

  const ownershipKey = useMemo(() => externalDomainOwnershipKey(orgId), [orgId]);
  const ownershipState = queryClient?.getQueryState(ownershipKey);
  const ownership = queryClient?.getQueryData<{ domain: string; externalTier: string | null }[]>(ownershipKey);
  const ownershipMap = Object.fromEntries(
    (ownership ?? [])
      .filter((row): row is typeof row & { externalTier: string } => row.externalTier !== null)
      .map((row) => [row.domain, row.externalTier]),
  ) as OwnershipMap;
  const invoiceMode = ownershipState?.status === 'success' ? routeWrite('revenue', ownershipMap) : undefined;
  const includeInvoices = canApproveInvoices && invoiceMode !== 'external';

  // The approvals queue reads the Requested-only list; the dashboard's "needs you" reads the lean list of the same
  // rows (same filter below). Either, when current, gives the count, so it shows wherever one of them is already loaded.
  const procurementCandidates = useMemo(
    () => canApproveProcurement ? [requestedProcurementsKey(orgId), procurementsKey(orgId, false, false, true, false)] : [],
    [canApproveProcurement, orgId],
  );
  const procurementKey = procurementCandidates.find((key) => {
    const state = queryClient?.getQueryState(key);
    return state?.status === 'success' && !state.isInvalidated && queryClient?.getQueryData(key) !== undefined;
  }) ?? procurementCandidates[0];  // none current: first candidate, so the count stays omitted
  const queueKeys = useMemo(() => [
    ...(canApproveProcurement ? [procurementKey] : []),
    ...(canApproveExpenses ? [expenseClaimsAwaitingKey(orgId)] : []),
    ...(canApproveTimesheets ? [awaitingApprovalKey(orgId, userId, role)] : []),
    ...(includeInvoices ? [nativeDraftInvoicesKey(orgId)] : []),
  ], [canApproveProcurement, canApproveExpenses, canApproveTimesheets, includeInvoices, orgId, procurementKey, role, userId]);
  const getSnapshot = useCallback(() => {
    const currentOwnershipState = queryClient?.getQueryState(ownershipKey);
    return JSON.stringify([
      ...[...queueKeys, ...procurementCandidates].map((key) => {
        const state = queryClient?.getQueryState(key);
        return state ? [state.status, state.dataUpdatedAt, state.errorUpdatedAt, state.isInvalidated] : null;
      }),
      currentOwnershipState
        ? [currentOwnershipState.status, currentOwnershipState.dataUpdatedAt, currentOwnershipState.errorUpdatedAt]
        : null,
    ]);
  }, [queueKeys, procurementCandidates, queryClient, ownershipKey]);
  const subscribe = useCallback(
    (onStoreChange: () => void) => queryClient?.getQueryCache().subscribe(() => {
      // Query observers can publish while another route component is rendering; defer the rail
      // notification so React never receives a cross-component update during that render.
      queueMicrotask(onStoreChange);
    }) ?? (() => undefined),
    [queryClient],
  );
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const queues = (queryClient ? queueKeys : []).map((key) => ({
    data: queryClient?.getQueryData<unknown[]>(key),
    state: queryClient?.getQueryState(key),
  }));
  const ownershipReady = ownershipState?.status === 'success';
  const ready = Boolean(queryClient && currentUser && role) &&
    (!includeInvoices || ownershipReady) &&
    queues.every(({ data, state }) => data !== undefined && state?.status === 'success' && !state.isInvalidated);

  const entries: ApprovalPopulationEntry[] = [];
  if (ready && queryClient && currentUser && role) {
    let index = 0;
    if (canApproveProcurement) {
      const rows = pendingProcurementApprovals(
        queues[index++].data as ProcurementWithRefs[],
        userId,
        role === 'Admin',
      );
      entries.push(...rows.map((row) => ({ key: `procurement:${row.id}`, kind: 'procurement' as const, createdAt: row.created_at, row })));
    }
    if (canApproveExpenses) {
      const rows = claimsAwaitingViewer(
        queues[index++].data as ExpenseClaimAwaiting[],
        userId,
        role,
      );
      entries.push(...rows.map((row) => ({ key: `expense:${row.claim.id}`, kind: 'expense' as const, createdAt: row.claim.created_at, row })));
    }
    if (canApproveTimesheets) {
      const rows = queues[index++].data as TimesheetAwaitingApproval[];
      entries.push(...rows.map((row) => ({ key: `timesheets:${row.id}`, kind: 'timesheets' as const, createdAt: row.week_start_date, row })));
    }
    if (includeInvoices) {
      const rows = (queues[index].data as SalesInvoiceRow[]).filter((invoice) =>
        can('submit_sales_invoice', 'salesInvoice', {
          realRole: role,
          currentUserId: userId,
          record: { author_id: invoice.author_user_id, author_ids: invoice.author_user_ids },
        }),
      );
      entries.push(...rows.map((row) => ({ key: `invoice:${row.id}`, kind: 'invoice' as const, createdAt: row.created_at, row })));
    }
  }
  const population = useApprovalPopulation(entries, 'all');
  if (!ready) return null;

  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1.5">
      <span className="tabular text-support text-muted-foreground" aria-hidden="true">
        {population.length}
      </span>
      <span className="sr-only">
        , {t('shell.rail.approvalsCountSuffix', '{{count}} pending', { count: population.length })}
      </span>
    </span>
  );
};
