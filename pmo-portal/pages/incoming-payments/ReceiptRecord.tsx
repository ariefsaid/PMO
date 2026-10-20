import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Icon, StatusPill, type Column } from '@/src/components/ui';
import { formatCurrencyAuto, formatCurrencyCents, formatDateOnly } from '@/src/lib/format';
import type { IncomingPaymentRow } from '@/src/lib/db/revenue';
import { knownUnappliedCash, type ReceiptAllocation } from '@/src/lib/revenue/receiptAllocation';
import { receiptNumber } from '@/src/lib/revenue/nativeInvoice';
import { incomingPaymentStatusVariant, salesInvoiceStatusVariant } from '@/src/lib/status/statusVariants';

interface Props {
  receipt: IncomingPaymentRow;
  /** Allocations to show (`null` = the source has not reported them). */
  allocations: ReceiptAllocation[] | null;
  onBack: () => void;
}

/** S-06 (RF-030..034) — the read-only receipt page: every invoice allocation, cash not yet applied, and recorded withholding. */
export const ReceiptRecord: React.FC<Props> = ({ receipt, allocations, onBack }) => {
  const { t } = useTranslation();
  const money = (n: number) => formatCurrencyCents(n, receipt.currency);
  const cancelled = Boolean(receipt.cancelled_at || receipt.erp_cancelled_at);
  const unapplied = knownUnappliedCash({ ...receipt, allocation_details: allocations });
  const notReported = t('uxs06.notReported', 'Not reported');

  const facts: Array<{ label: string; testId?: string; value: React.ReactNode }> = [
    { label: t('uxs06.receiptTotal', 'Receipt total'), value: receipt.amount != null ? money(receipt.amount) : notReported },
    { label: t('financeCopy.cashReceived', 'Cash received'), value: receipt.received_amount != null ? money(receipt.received_amount) : notReported },
    {
      label: t('financeCopy.taxWithheld', 'Tax withheld'), testId: 'receipt-withheld',
      value: receipt.withheld_amount == null ? notReported : receipt.withheld_amount === 0 ? t('uxs06.none', 'None') : money(receipt.withheld_amount),
    },
    {
      label: t('uxs06.unappliedCol', 'Not yet applied'), testId: 'receipt-unapplied',
      value: unapplied === null ? notReported : unapplied === 0 ? t('uxs06.none', 'None') : money(unapplied),
    },
  ];
  const slip = receipt.withholding_slip_number;
  const allocationColumns = useMemo<Column<ReceiptAllocation & { rowKey: string }>[]>(() => [
    { key: 'invoice', header: t('financeCopy.invoice', 'Invoice #'), kind: 'primary', cell: (allocation) => allocation.invoice_id
      ? <Link to={`/sales-invoices/${encodeURIComponent(allocation.invoice_id)}`} className="font-mono text-[13px] text-primary-text hover:underline focus-visible:underline">{allocation.invoice_number}</Link>
      : <span className="font-mono text-[13px]" title={t('uxs06.invoiceNotInPmo', 'This invoice is not in PMO yet.')}>{allocation.invoice_number}</span>, primaryTitle: (allocation) => allocation.invoice_number },
    { key: 'amount', header: t('uxs06.applied', 'Applied'), kind: 'money', align: 'num', cell: (allocation) => allocation.amount != null && allocation.currency != null ? formatCurrencyAuto(Number(allocation.amount), allocation.currency) : notReported },
  ], [notReported, t]);

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6">
      <Button variant="ghost" onClick={onBack} className="mb-4 -ml-3">
        <Icon name="back" className="size-4" />
        {t('uxs06.backToReceipts', 'Back to Incoming Payments')}
      </Button>
      <header className="mb-5 border-b border-border pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">
            {t('uxs06.receiptTitle', 'Receipt {{number}}', { number: receiptNumber(receipt) ?? receipt.id })}
          </h1>
          {cancelled
            ? <StatusPill variant={salesInvoiceStatusVariant('Cancelled')}>{t('financeCopy.statusCancelled', 'Cancelled')}</StatusPill>
            : <StatusPill variant={incomingPaymentStatusVariant(receipt.status)}>
                {receipt.status === 'Paid' ? t('uxs06.statusReceived', 'Received') : t('uxs06.statusExpected', 'Expected')}
              </StatusPill>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {[receipt.customer_name, receipt.date ? formatDateOnly(receipt.date) : null].filter(Boolean).join(' · ') || '—'}
        </p>
      </header>

      <dl className="mb-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label}>
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd data-testid={f.testId} className="tabular mt-0.5 text-[15px] font-medium">{f.value}</dd>
          </div>
        ))}
      </dl>
      {slip && (
        <p className="-mt-3 mb-6 text-sm text-muted-foreground">
          {t('financeCopy.withholdingSlip', 'Withholding slip')}: <span className="font-mono text-[13px]">{slip}</span>
        </p>
      )}

      <h2 className="mb-2 text-heading font-semibold">{t('uxs06.settledTitle', 'Invoices this receipt settled')}</h2>
      {allocations === null ? (
        <p className="text-sm text-muted-foreground">
          {t('uxs06.coverageUnknown', 'The accounting system has not reported which invoices this receipt settled.')}
        </p>
      ) : allocations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('uxs06.onAccount', 'This receipt is not applied to any invoice. The cash is held on account.')}
        </p>
      ) : (
        <DataTable
          rows={allocations.map((allocation, index) => ({ ...allocation, rowKey: `${allocation.invoice_number}-${index}` }))}
          columns={allocationColumns}
          rowKey={(allocation) => allocation.rowKey}
          tableId="receipt-settled-invoices"
          accessibleName={t('uxs06.settledTitle', 'Invoices this receipt settled')}
        />
      )}
      {unapplied !== null && unapplied > 0 && (
        <p className="mt-3 text-sm">
          {t('uxs06.unappliedNote', '{{amount}} of this receipt is not yet applied to an invoice.', { amount: money(unapplied) })}
        </p>
      )}
    </main>
  );
};
