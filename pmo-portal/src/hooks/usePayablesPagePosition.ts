import { useMemo } from 'react';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useErpPurchases } from '@/src/hooks/useErpPurchases';
import { useProcurements } from '@/src/hooks/useProcurements';
import { buildFinancePosition } from '@/src/lib/finance/financePosition';
import { withLinkedSupplierInvoices } from '@/src/lib/finance/payablesPosition';

/** Payables page reads only procurement, organization-day, and linked ERP purchase data. */
export function usePayablesPagePosition(enabled = true) {
  const procurements = useProcurements({ lean: true, enabled });
  const orgDay = useFxOrgDay(enabled);
  const erp = useErpPurchases(undefined, { enabled });

  const position = useMemo(() => buildFinancePosition({
    invoices: [],
    payments: [],
    procurements: procurements.data ?? [],
    today: orgDay.day,
    canApproveDraft: () => false,
  }), [procurements.data, orgDay.day]);
  const payables = useMemo(
    () => withLinkedSupplierInvoices(position, erp.data ?? []),
    [position, erp.data],
  );

  const isError = enabled && (procurements.isError || erp.isError);
  const isPending = enabled && !isError && (procurements.isPending || erp.isPending);
  const ageError = enabled && (procurements.isError || orgDay.isError);
  const agePending = enabled && !ageError && (procurements.isPending || orgDay.isPending);
  const ageingError = enabled && (procurements.isError || orgDay.isError || erp.isError);
  const ageingPending = enabled && !ageingError && (procurements.isPending || orgDay.isPending || erp.isPending);

  return {
    ...payables,
    isPending,
    isError,
    agePending,
    ageError,
    ageingPending,
    ageingError,
    retry: () => {
      if (!enabled) return;
      void procurements.refetch();
      void erp.refetch();
    },
    retryAge: () => { if (enabled) orgDay.retry(); },
  };
}
