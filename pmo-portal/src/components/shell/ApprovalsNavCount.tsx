import React, { useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/src/auth/AuthContext';
import { can } from '@/src/auth/policy';
import { claimsAwaitingViewer } from '@/src/lib/expenses/expenseRules';
import { pendingProcurementApprovals } from '@/src/lib/selectors/approvals';
import { routeWrite, type OwnershipMap } from '@/src/lib/adapterSeam/router';

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
  const realRole = auth?.role ?? null;
  const role = auth?.role ?? null;
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;
  const canApproveProcurement = can('transition', 'procurement', { realRole });
  const canApproveTimesheets = can('transition', 'approval', { realRole });
  const canApproveInvoices = can('transition', 'salesInvoice', { realRole });

  const ownershipKey = useMemo(() => ['external-domain-ownership', orgId] as const, [orgId]);
  const ownershipState = queryClient?.getQueryState(ownershipKey);
  const ownership = queryClient?.getQueryData<{ domain: string; externalTier: string | null }[]>(ownershipKey);
  const ownershipMap = Object.fromEntries(
    (ownership ?? [])
      .filter((row): row is typeof row & { externalTier: string } => row.externalTier !== null)
      .map((row) => [row.domain, row.externalTier]),
  ) as OwnershipMap;
  const invoiceMode = ownershipState?.status === 'success' ? routeWrite('revenue', ownershipMap) : undefined;
  const includeInvoices = canApproveInvoices && invoiceMode !== 'external';

  const queueKeys = useMemo(() => [
    ...(canApproveProcurement ? [['procurements', orgId] as const, ['expense-claims-awaiting', orgId] as const] : []),
    ...(canApproveTimesheets ? [['timesheets-awaiting', orgId, userId, role] as const] : []),
    ...(includeInvoices ? [['salesInvoices', orgId, 'native-drafts'] as const] : []),
  ], [canApproveProcurement, canApproveTimesheets, includeInvoices, orgId, role, userId]);
  const getSnapshot = useCallback(() => {
    const currentOwnershipState = queryClient?.getQueryState(ownershipKey);
    return JSON.stringify([
      ...queueKeys.map((key) => {
        const state = queryClient?.getQueryState(key);
        return state ? [state.status, state.dataUpdatedAt, state.errorUpdatedAt, state.isInvalidated] : null;
      }),
      currentOwnershipState
        ? [currentOwnershipState.status, currentOwnershipState.dataUpdatedAt, currentOwnershipState.errorUpdatedAt]
        : null,
    ]);
  }, [queueKeys, queryClient, ownershipKey]);
  const subscribe = useCallback(
    (onStoreChange: () => void) => queryClient?.getQueryCache().subscribe(() => {
      // Query observers can publish while another route component is rendering; defer the rail
      // notification so React never receives a cross-component update during that render.
      queueMicrotask(onStoreChange);
    }) ?? (() => undefined),
    [queryClient],
  );
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (!queryClient || !currentUser || !realRole) return null;

  const queues = queueKeys.map((key) => ({
    data: queryClient.getQueryData<unknown[]>(key),
    state: queryClient.getQueryState(key),
  }));
  const ownershipReady = ownershipState?.status === 'success';
  if (
    !ownershipReady ||
    queues.some(({ data, state }) => data === undefined || state?.status !== 'success' || state.isInvalidated)
  ) return null;

  let index = 0;
  const procurementRows = canApproveProcurement
    ? pendingProcurementApprovals(
        queues[index++].data as Parameters<typeof pendingProcurementApprovals>[0],
        userId,
        realRole === 'Admin',
      ).length
    : 0;
  const expenseRows = canApproveProcurement
    ? claimsAwaitingViewer(
        queues[index++].data as Parameters<typeof claimsAwaitingViewer>[0],
        userId,
        realRole,
      ).length
    : 0;
  const timesheetRows = canApproveTimesheets ? queues[index++].data!.length : 0;
  const invoiceRows = includeInvoices
    ? (queues[index].data as Record<string, unknown>[]).filter((invoice) =>
        can('submit_sales_invoice', 'salesInvoice', {
          realRole,
          currentUserId: userId,
          record: {
            author_id: invoice.author_user_id as string | null,
            author_ids: invoice.author_user_ids as string[] | null,
          },
        }),
      ).length
    : 0;
  const count = procurementRows + expenseRows + timesheetRows + invoiceRows;

  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1.5">
      <span className="tabular text-xs text-muted-foreground" aria-hidden="true">
        {count}
      </span>
      <span className="sr-only">
        , {t('uxs25.approvalsCountSuffix', '{{count}} pending', { count })}
      </span>
    </span>
  );
};
