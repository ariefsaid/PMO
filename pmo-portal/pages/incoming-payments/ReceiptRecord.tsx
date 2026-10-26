import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BackBar } from '@/src/components/shell';
import { Button, DataTable, StatusPill, type Column } from '@/src/components/ui';
import { formatCurrencyAuto, formatCurrencyCents, formatDateOnly } from '@/src/lib/format';
import type { IncomingPaymentRow } from '@/src/lib/db/revenue';
import { knownUnappliedCash, type ReceiptAllocation } from '@/src/lib/revenue/receiptAllocation';
import { receiptNumber } from '@/src/lib/revenue/nativeInvoice';
import { incomingPaymentStatusVariant, salesInvoiceStatusVariant } from '@/src/lib/status/statusVariants';
import { MoneyInPageHeader } from '../money-in/MoneyInPageHeader';

interface Props {
  receipt: IncomingPaymentRow;
  /** Allocations to show (`null` = the source has not reported them). */
  allocations: ReceiptAllocation[] | null;
  onBack: () => void;
  onCancel?: () => void;
}

/** S-06 (RF-030..034) — the read-only receipt page: every invoice allocation, cash not yet applied, and recorded withholding. */
export const ReceiptRecord: React.FC<Props> = ({ receipt, allocations, onBack, onCancel }) => {
  const { t } = useTranslation();
  const money = (n: number) => formatCurrencyCents(n, receipt.currency);
  const cancelled = Boolean(receipt.cancelled_at || receipt.erp_cancelled_at);
  const unapplied = knownUnappliedCash({ ...receipt, allocation_details: allocations });
  const notReported = t('uxs06.notReported', 'Not reported');
  const slip = receipt.withholding_slip_number;

  // FIN-S5: the receipt total always; the other figures only when they say something — they differ from the
  // total, are non-zero, or were never reported (collapsed into one line, never three "Not reported" cells).
  const cashDiffers = receipt.received_amount != null && receipt.received_amount !== receipt.amount;
  const withheldShown = receipt.withheld_amount != null && receipt.withheld_amount !== 0;
  const unappliedShown = unapplied !== null && unapplied > 0;
  const someUnreported = receipt.amount == null || receipt.received_amount == null || receipt.withheld_amount == null || unapplied === null;
  const facts: Array<{ label: string; testId?: string; value: React.ReactNode }> = [
    { label: t('uxs06.receiptTotal', 'Receipt total'), value: receipt.amount != null ? money(receipt.amount) : notReported },
    ...(cashDiffers ? [{ label: t('financeCopy.cashReceived', 'Cash received'), value: money(receipt.received_amount!) }] : []),
    ...(withheldShown ? [{
      label: t('financeCopy.taxWithheld', 'Tax withheld'), testId: 'receipt-withheld',
      value: <>
        {money(receipt.withheld_amount!)}
        {slip && <span className="mt-0.5 block font-mono text-[13px] font-normal text-muted-foreground">{slip}</span>}
      </>,
    }] : []),
    ...(unappliedShown ? [{ label: t('uxs06.unappliedCol', 'Not yet applied'), testId: 'receipt-unapplied', value: money(unapplied) }] : []),
  ];
  const allocationColumns = useMemo<Column<ReceiptAllocation & { rowKey: string }>[]>(() => [
    { key: 'invoice', header: t('financeCopy.invoice', 'Invoice #'), kind: 'primary', cell: (allocation) => allocation.invoice_id
      ? <Link to={`/sales-invoices/${encodeURIComponent(allocation.invoice_id)}`} className="inline-flex min-h-11 items-center font-mono text-[13px] text-primary-text hover:underline focus-visible:underline">{allocation.invoice_number}</Link>
      : <span className="font-mono text-[13px]" title={t('uxs06.invoiceNotInPmo', 'This invoice is not in PMO yet.')}>{allocation.invoice_number}</span>, primaryTitle: (allocation) => allocation.invoice_number },
    { key: 'amount', header: t('uxs06.applied', 'Applied'), kind: 'money', align: 'num', cell: (allocation) => allocation.amount != null && allocation.currency != null ? formatCurrencyAuto(Number(allocation.amount), allocation.currency) : notReported },
  ], [notReported, t]);

  const status = cancelled
    ? <StatusPill variant={salesInvoiceStatusVariant('Cancelled')}>{t('financeCopy.statusCancelled', 'Cancelled')}</StatusPill>
    : <StatusPill variant={incomingPaymentStatusVariant(receipt.status)}>
        {receipt.status === 'Paid' ? t('uxs06.statusReceived', 'Received') : t('uxs06.statusExpected', 'Expected')}
      </StatusPill>;
  const abnormalNotes = [
    someUnreported ? t('finance:receipts.someUnreported', "Some figures weren't reported.") : null,
    allocations === null ? t('uxs06.coverageUnknown', 'The accounting system has not reported which invoices this receipt settled.') : null,
  ].filter(Boolean);

  return (
    <div className="min-w-0">
      <MoneyInPageHeader
        kind="record"
        title={t('uxs06.receiptTitle', 'Receipt {{number}}', { number: receiptNumber(receipt) ?? receipt.id })}
        scope={[receipt.customer_name ?? t('moneyIn:uxs06.customerUnavailable', 'Customer unavailable'), receipt.date ? formatDateOnly(receipt.date) : t('moneyIn:uxs06.dateNotReported', 'Date not reported')].join(' · ')}
        status={status}
        returnAction={<BackBar label={t('shell.nav.incomingPayments', 'Incoming Payments')} onBack={onBack} phoneOnly />}
      />

      <dl className="mb-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label}>
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd data-testid={f.testId} className="tabular mt-0.5 text-[15px] font-medium">{f.value}</dd>
          </div>
        ))}
      </dl>
      {abnormalNotes.length > 0 && (
        <p role="note" className="-mt-3 mb-6 max-w-[80ch] text-sm text-muted-foreground">{abnormalNotes.join(' ')}</p>
      )}

      <h2 className="mb-2 text-heading font-semibold">{t('uxs06.settledTitle', 'Invoices this receipt settled')}</h2>
      {allocations === null ? null : allocations.length === 0 ? (
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
      {receipt.reference_number && (
        <details className="mt-5 max-w-2xl rounded-md border border-border px-3 py-2">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">{t('moneyIn:uxs06.referenceDetails', 'Reference details')}</summary>
          <p className="break-words pb-2 text-sm text-muted-foreground">{receipt.reference_number}</p>
        </details>
      )}
      {onCancel && (
        <div className="mt-6">
          <Button variant="ghost" onClick={onCancel} className="min-h-11 text-destructive hover:text-destructive">
            {t('financeCopy.cancel', 'Cancel')}
          </Button>
        </div>
      )}
    </div>
  );
};
