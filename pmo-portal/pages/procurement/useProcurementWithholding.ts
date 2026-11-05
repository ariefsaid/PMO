import { useRef, useState } from 'react';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';

type Invoice = ProcurementDetail['invoices'][number];

/**
 * The page's withholding-slip panels: which bill's record form or history is open, and where focus
 * goes back to when the history closes. The page keeps only the slip-detail URL selection.
 */
export function useProcurementWithholding() {
  const [recordInvoice, setRecordInvoice] = useState<Invoice | null>(null);
  const [historyInvoiceId, setHistoryInvoiceId] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  return {
    recordInvoice,
    historyInvoiceId,
    openRecord: setRecordInvoice,
    closeRecord: () => setRecordInvoice(null),
    openHistory: (invoiceId: string) => {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setHistoryInvoiceId(invoiceId);
    },
    closeHistory: () => {
      setHistoryInvoiceId(null);
      requestAnimationFrame(() => returnFocus.current?.focus());
    },
    /** Opening a slip from the history closes it without pulling focus back. */
    dismissHistory: () => setHistoryInvoiceId(null),
  };
}
