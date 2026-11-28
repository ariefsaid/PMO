import { useMemo } from 'react';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useIncomingPayments, useSalesInvoices } from '@/src/hooks/useRevenue';
import { buildFinancePosition } from '@/src/lib/finance/financePosition';

/** Reads the routed lean purchase list under the one key the dashboards and Payables share, so moving between screens fetches the org's procurements once. */
export function useFinancePosition(enabled = true) {
  const { currentUser } = useAuth();
  const may = usePermission();
  const invoices = useSalesInvoices(undefined, { enabled });
  const payments = useIncomingPayments(undefined, enabled);
  // Shared-details select: the supplier invoice and payment rows behind the unpaid balance.
  const procurements = useProcurements({ lean: true, enabled });
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
    invoicesPending: invoices.isPending,
    invoicesError: invoices.isError,
    paymentsPending: payments.isPending,
    paymentsError: payments.isError,
    procurementsPending: procurements.isPending,
    procurementsError: procurements.isError,
    orgDayPending: orgDay.isPending,
    orgDayError: orgDay.isError,
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
