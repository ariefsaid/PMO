import { useMemo } from 'react';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useIncomingPayments, useSalesInvoices } from '@/src/hooks/useRevenue';
import { buildFinancePosition } from '@/src/lib/finance/financePosition';

export function useFinancePosition(enabled = true) {
  const { currentUser } = useAuth();
  const may = usePermission();
  const invoices = useSalesInvoices(undefined, { enabled });
  const payments = useIncomingPayments(undefined, enabled);
  // Shared-details select: the supplier invoice and payment rows behind the unpaid balance.
  const procurements = useProcurements({ withSharedDetails: true, enabled });
  const orgDay = useFxOrgDay(enabled);

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
    isPending: invoices.isPending || payments.isPending || procurements.isPending || orgDay.isPending,
    isError: invoices.isError || payments.isError || procurements.isError || orgDay.isError,
    retry: () => {
      void invoices.refetch();
      void payments.refetch();
      void procurements.refetch();
      orgDay.retry();
    },
  };
}
