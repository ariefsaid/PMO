import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useIncomingPayments, useSalesInvoices } from '@/src/hooks/useRevenue';
import { buildFinancePosition } from '@/src/lib/finance/financePosition';

export interface UseFinancePositionOptions {
  enabled?: boolean;
  deferred?: boolean;
}

export function useFinancePosition(
  enabledOrOptions: boolean | UseFinancePositionOptions = true,
) {
  const options = typeof enabledOrOptions === 'object' ? enabledOrOptions : { enabled: enabledOrOptions };
  const enabled = options.enabled ?? true;
  const deferred = options.deferred ?? false;

  const [active, setActive] = useState(!deferred);

  useEffect(() => {
    if (!enabled) {
      setActive(false);
      return;
    }
    if (!deferred) {
      setActive(true);
      return;
    }
    const idleId = typeof window !== 'undefined' && 'requestIdleCallback' in window
      ? window.requestIdleCallback(() => setActive(true))
      : setTimeout(() => setActive(true), 200);

    return () => {
      if (typeof window !== 'undefined' && 'cancelIdleCallback' in window && typeof idleId === 'number') {
        window.cancelIdleCallback(idleId);
      } else {
        clearTimeout(idleId as unknown as number);
      }
    };
  }, [enabled, deferred]);

  const effectiveEnabled = enabled && active;
  const { currentUser } = useAuth();
  const may = usePermission();
  const invoices = useSalesInvoices(undefined, { enabled: effectiveEnabled });
  const payments = useIncomingPayments(undefined, effectiveEnabled);
  // Shared-details select: the supplier invoice and payment rows behind the unpaid balance.
  const procurements = useProcurements({ withSharedDetails: true, enabled: effectiveEnabled });
  const orgDay = useFxOrgDay(effectiveEnabled);

  const hasLoadedData = Boolean(
    effectiveEnabled &&
    invoices.status === 'success' &&
    payments.status === 'success' &&
    procurements.status === 'success' &&
    orgDay.day,
  );

  const isPending = !active || invoices.isPending || payments.isPending || procurements.isPending || orgDay.isPending;
  const isError = invoices.isError || payments.isError || procurements.isError || orgDay.isError;

  const position = useMemo(() => buildFinancePosition({
    invoices: invoices.data ?? [],
    payments: payments.data ?? [],
    procurements: procurements.data ?? [],
    today: orgDay.day,
    currentUserId: currentUser?.id,
    canApproveDraft: (invoice) => may('submit_sales_invoice', 'salesInvoice', {
      currentUserId: currentUser?.id,
      record: { author_id: invoice.author_user_id, author_ids: invoice.author_user_ids },
    }),
  }), [invoices.data, payments.data, procurements.data, orgDay.day, currentUser?.id, may]);

  return {
    position,
    today: orgDay.day,
    isPending,
    isError,
    hasLoadedData,
    retry: () => {
      void invoices.refetch();
      void payments.refetch();
      void procurements.refetch();
      orgDay.retry();
    },
  };
}
