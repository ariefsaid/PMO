import React from 'react';
import type { IncomingPaymentRow } from '@/src/lib/db/revenue';
import { LedgerDateLine } from '@/src/components/revenue/LedgerDateLine';

/** #2290: phone card title: customer, receipt number, then the ledger-date line on its own line (same place as the desktop identity). */
export const ReceiptCardTitle: React.FC<{ payment: IncomingPaymentRow; number: string | null }> = ({ payment, number }) => (
  <span className="flex min-w-0 flex-col gap-0.5">
    <span className="min-w-0 truncate text-control font-semibold">{payment.customer_name ?? '—'}</span>
    <span className="min-w-0 truncate font-mono text-control font-normal text-muted-foreground">{number ?? '—'}</span>
    <LedgerDateLine entered={payment.date} posted={payment.erp_posting_date} className="block whitespace-nowrap text-sm font-normal text-muted-foreground" />
  </span>
);
