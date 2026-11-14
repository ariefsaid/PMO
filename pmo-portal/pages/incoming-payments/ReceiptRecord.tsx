import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Icon, RecordHeader, StatusPill, type Column } from '@/src/components/ui';
import { formatCurrency, formatDay } from '@/src/lib/format';
import type { IncomingPaymentRow } from '@/src/lib/db/revenue';
import { knownUnappliedCash, type ReceiptAllocation } from '@/src/lib/revenue/receiptAllocation';
import { receiptNumber } from '@/src/lib/revenue/nativeInvoice';
import { incomingPaymentStatusVariant, salesInvoiceStatusVariant } from '@/src/lib/status/statusVariants';
import { OdooReceiptStatus } from './OdooReceiptStatus';

interface Props {
  receipt: IncomingPaymentRow;
  /** Allocations to show (`null` = the source has not reported them). */
  allocations: ReceiptAllocation[] | null;
  onBack: () => void;
  odoo?: boolean;
}

/** S-06 (RF-030..034) — the read-only receipt page: every invoice allocation, cash not yet applied, and recorded withholding. */
export const ReceiptRecord: React.FC<Props> = ({ receipt, allocations, onBack, odoo = false }) => {
  const { t } = useTranslation();
  const money = (n: number) => formatCurrency(n, receipt.currency, { precision: 'minor' });
  const cancelled = Boolean(receipt.cancelled_at || receipt.erp_cancelled_at);
  const unapplied = knownUnappliedCash({ ...receipt, allocation_details: allocations });
  const notReported = t('uxs06.notReported', 'Not reported');
  const notReportedValue = () => <span className="font-normal text-muted-foreground">{notReported}</span>;
  const slip = receipt.withholding_slip_number;

  // FIN-S5: the payment total always; other known figures appear when they differ from the total or are non-zero.
  // Missing figures are labelled in the header so each unknown stays attached to the figure it describes.
  const withheldShown = receipt.withheld_amount != null && receipt.withheld_amount > 0;
  const cashDiffers = receipt.received_amount != null && receipt.received_amount !== receipt.amount && (!odoo || withheldShown);
  const unappliedShown = unapplied !== null && unapplied > 0;
  const missingHeaderFacts: Array<{ label: string; value: React.ReactNode }> = [
    ...(receipt.received_amount == null ? [{ label: t('financeCopy.cashReceived', 'Cash received'), value: notReportedValue() }] : []),
    ...(receipt.withheld_amount == null ? [{ label: t('financeCopy.taxWithheld', 'Tax withheld'), value: notReportedValue() }] : []),
    ...(unapplied === null ? [{ label: t('uxs06.unappliedCol', 'Not yet applied'), value: notReportedValue() }] : []),
  ];
  const facts: Array<{ label: string; testId?: string; value: React.ReactNode }> = [
    ...(cashDiffers ? [{ label: t('financeCopy.cashReceived', 'Cash received'), value: money(receipt.received_amount!) }] : []),
    ...(withheldShown ? [{
      label: t('financeCopy.taxWithheld', 'Tax withheld'), testId: 'receipt-withheld',
      value: <>
        {money(receipt.withheld_amount!)}
        {slip && <span className="mt-0.5 block font-mono text-control font-normal text-muted-foreground">{slip}</span>}
      </>,
    }] : []),
    ...(withheldShown ? [{
      label: t('finance:financeCopy.withholdingArticle', 'Withholding article'), testId: 'receipt-withholding-article',
      value: receipt.withholding_article === 'pph23' ? t('finance:financeCopy.withholdingArticlePph23', 'PPh 23')
        : receipt.withholding_article === 'pph4_2' ? t('finance:financeCopy.withholdingArticlePph42', 'PPh 4(2)')
        : t('finance:financeCopy.withholdingArticleNotStated', 'Not stated'),
    }] : []),
    ...(unappliedShown ? [{ label: t('uxs06.unappliedCol', 'Not yet applied'), testId: 'receipt-unapplied', value: money(unapplied) }] : []),
  ];
  const allocationColumns = useMemo<Column<ReceiptAllocation & { rowKey: string }>[]>(() => [
    { key: 'invoice', header: t('financeCopy.invoice', 'Invoice #'), kind: 'primary', cell: (allocation) => allocation.invoice_id
      ? <Link to={`/sales-invoices/${encodeURIComponent(allocation.invoice_id)}`} className="font-mono text-control text-primary-text hover:underline focus-visible:underline">{allocation.invoice_number}</Link>
      : <span className="font-mono text-control" title={t('uxs06.invoiceNotInPmo', 'This invoice is not in PMO yet.')}>{allocation.invoice_number}</span>, primaryTitle: (allocation) => allocation.invoice_number },
    { key: 'amount', header: t('uxs06.applied', 'Applied'), kind: 'money', align: 'num', cell: (allocation) => allocation.amount != null && allocation.currency != null ? formatCurrency(Number(allocation.amount), allocation.currency, { precision: 'minor' }) : notReported },
  ], [notReported, t]);
  const number = receiptNumber(receipt);
  const status = odoo
    ? <OdooReceiptStatus receipt={receipt} fallback={cancelled
      ? <StatusPill variant={salesInvoiceStatusVariant('Cancelled')}>{t('financeCopy.statusCancelled', 'Cancelled')}</StatusPill>
      : <StatusPill variant={incomingPaymentStatusVariant(receipt.status)}>{receipt.status === 'Paid' ? t('uxs06.statusReceived', 'Received') : t('uxs06.statusExpected', 'Expected')}</StatusPill>}
    />
    : cancelled
    ? <StatusPill variant={salesInvoiceStatusVariant('Cancelled')}>{t('financeCopy.statusCancelled', 'Cancelled')}</StatusPill>
    : <StatusPill variant={incomingPaymentStatusVariant(receipt.status)}>
        {receipt.status === 'Paid' ? t('uxs06.statusReceived', 'Received') : t('uxs06.statusExpected', 'Expected')}
      </StatusPill>;

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6">
      <Button variant="ghost" onClick={onBack} className="mb-4 -ml-3">
        <Icon name="back" className="size-4" />
        {t('uxs06.backToReceipts', 'Back to Incoming Payments')}
      </Button>
      <RecordHeader
        icon={null}
        name={odoo && !number
          ? t('finance:receipts.incomingPaymentUnnumbered', 'Incoming payment, not numbered yet')
          : t('finance:receipts.incomingPaymentTitle', 'Incoming payment {{number}}', { number: number ?? receipt.id })}
        status={status}
        meta={receipt.customer_name ?? '—'}
        stats={[
          { label: t('financeCopy.date', 'Date'), value: receipt.date ? formatDay(receipt.date) : '—' },
          {
            label: t('finance:receipts.paymentTotal', 'Payment total'),
            value: receipt.amount != null ? money(receipt.amount) : notReportedValue(),
          },
          ...missingHeaderFacts,
        ]}
      />

      <dl className="mb-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
        {facts.map((f) => (
          <div key={f.label}>
            <dt className="text-control text-muted-foreground">{f.label}</dt>
            <dd data-testid={f.testId} className="tabular mt-0.5 text-[15px] font-medium">{f.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-heading font-semibold">{t('finance:receipts.invoicesThisPaymentSettled', 'Invoices this payment settled')}</h2>
        {receipt.customer_id && (
          <Link
            to={`/finance/receivables?view=invoices&customer=${encodeURIComponent(receipt.customer_id)}`}
            className="touch-target touch-target-overlay inline-flex items-center rounded-sm text-control text-primary-text hover:underline focus-visible:underline"
          >
            {t('uxs06.openClientInvoices', "Open client's invoices")}
          </Link>
        )}
      </div>
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
          accessibleName={t('finance:receipts.invoicesThisPaymentSettled', 'Invoices this payment settled')}
        />
      )}
    </main>
  );
};
