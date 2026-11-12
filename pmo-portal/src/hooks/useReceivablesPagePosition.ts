import { useMemo } from 'react';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useIncomingPayments, useSalesInvoices } from '@/src/hooks/useRevenue';
import type { IncomingPaymentRow, SalesInvoiceRow } from '@/src/lib/db/revenue';
import { buildFinancePosition } from '@/src/lib/finance/financePosition';

const EMPTY_INVOICES: SalesInvoiceRow[] = [];
const EMPTY_PAYMENTS: IncomingPaymentRow[] = [];

/** Receivables page facts with independent invoice and cash loading/error states. */
export function useReceivablesPagePosition() {
  const invoicesQuery = useSalesInvoices();
  const paymentsQuery = useIncomingPayments();
  const orgDay = useFxOrgDay(true);
  const invoices = invoicesQuery.data ?? EMPTY_INVOICES;
  const payments = paymentsQuery.data ?? EMPTY_PAYMENTS;

  const position = useMemo(() => buildFinancePosition({
    invoices,
    payments: [],
    procurements: [],
    today: orgDay.day,
    canApproveDraft: () => false,
  }), [invoices, orgDay.day]);

  const receivablesError = invoicesQuery.isError || orgDay.isError;
  const cashError = paymentsQuery.isError || orgDay.isError;

  return {
    position,
    today: orgDay.day,
    invoices,
    payments,
    invoiceError: invoicesQuery.isError,
    paymentError: paymentsQuery.isError,
    invoiceCount: invoicesQuery.isPending || invoicesQuery.isError ? null : invoices.length,
    paymentCount: paymentsQuery.isPending || paymentsQuery.isError ? null : payments.length,
    receivablesPending: !receivablesError && (invoicesQuery.isPending || orgDay.isPending),
    receivablesError,
    retryReceivables: () => {
      void invoicesQuery.refetch();
      orgDay.retry();
    },
    cashPending: !cashError && (paymentsQuery.isPending || orgDay.isPending),
    cashError,
    retryCash: () => {
      void paymentsQuery.refetch();
      orgDay.retry();
    },
  };
}
