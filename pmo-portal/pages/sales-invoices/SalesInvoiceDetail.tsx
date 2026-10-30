import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon, ListState, StatusPill } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useInvoicePdfDownload } from '@/src/hooks/useInvoicePdfDownload';
import { formatCurrencyAuto, formatDateOnly } from '@/src/lib/format';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { deriveArDueDate, overdueAgeDays } from '@/src/lib/repositories/revenueDisplay';
import { salesInvoiceStatusVariant } from '@/src/lib/status/statusVariants';
import { invoiceNumber, isPartlyPaid } from '@/src/lib/revenue/nativeInvoice';
import { SalesInvoiceApprovalPreview } from '@/pages/approvals/SalesInvoiceApprovalRow';
import FxEquivalent from '@/src/components/fx/FxEquivalent';
import { SalesInvoiceEvidenceSection } from './SalesInvoiceEvidence';
import { salesInvoiceStatusLabel } from './salesInvoiceListModel';

interface Props {
  viewTarget: SalesInvoiceRow | null;
  isPending: boolean;
  isError: boolean;
  data: SalesInvoiceRow[] | undefined;
  mode: ReturnType<typeof import('@/src/hooks/useRevenueMode').useRevenueMode>;
  organizationToday: string | null;
  onBack: () => void;
  refetch: () => unknown;
  recordPrimaryAction: { label: string; onClick: () => void } | null;
  invoiceDisplayLabel: (invoice: SalesInvoiceRow) => string;
  may: ReturnType<typeof usePermission>;
  pdfDownload: ReturnType<typeof useInvoicePdfDownload>;
  dialogs: React.ReactNode;
}
export function SalesInvoiceDetail({ viewTarget, isPending, isError, data, mode, organizationToday, onBack, refetch, recordPrimaryAction, invoiceDisplayLabel, may, pdfDownload, dialogs }: Props) {
  const { t } = useTranslation();
  const viewTargetNumber = viewTarget ? invoiceNumber(viewTarget) : null;
    return (
      <main className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6">
        <Button variant="ghost" onClick={onBack} className="mb-4 -ml-3">
          <Icon name="back" className="size-4" />
          {t('financeCopy.backToInvoices', 'Back to Sales Invoices')}
        </Button>
        {isPending || mode === undefined ? (
          <ListState variant="loading" rows={3} />
        ) : isError || !data ? (
          <ListState
            variant="error"
            title={t('financeCopy.salesInvoicesLoadFailed', "Couldn't load sales invoices")}
            sub={t('financeCopy.theRequestFailedCheckYourConnectionAndTryAgain', "The request failed. Check your connection and try again.")}
            onRetry={() => refetch()}
          />
        ) : viewTarget ? (
          <>
            <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
              <div>
                <h1 className="text-[24px] font-bold tracking-[-0.02em]">
                  {viewTargetNumber
                    ? t('financeCopy.invoiceRecordTitle', 'Invoice {{number}}', { number: viewTargetNumber })
                    : invoiceDisplayLabel(viewTarget)}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">{viewTarget.customer_name ?? '—'}</p>
              </div>
              {recordPrimaryAction && <Button variant="primary" onClick={recordPrimaryAction.onClick}>{recordPrimaryAction.label}</Button>}
            </header>
            <section aria-label={t('uxs17.collectionSummary', 'Invoice collection details')} className="mb-5 border-b border-border pb-4">
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">{t('uxs17.invoiceDate', 'Invoice date')}</dt>
                  <dd className="mt-1 text-sm">{viewTarget.invoice_date ? formatDateOnly(viewTarget.invoice_date) : t('uxs17.dateNotRecorded', 'Not recorded')}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">{t('uxs17.dueDate', 'Due date')}</dt>
                  <dd className="mt-1 text-sm">
                    {(() => {
                      const dueDate = deriveArDueDate(viewTarget.invoice_date, viewTarget.erp_payment_terms_days, viewTarget.erp_due_date, viewTarget.received_date);
                      return dueDate ? formatDateOnly(dueDate) : t('uxs17.dueDateUnavailable', 'Due date not available');
                    })()}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">{t('uxs17.status', 'Status')}</dt>
                  <dd className="mt-1">
                    {isPartlyPaid(viewTarget)
                      ? <StatusPill variant={salesInvoiceStatusVariant('Unpaid')}>{t('financeCopy.statusPartlyPaid', 'Partly paid')}</StatusPill>
                      : <StatusPill variant={salesInvoiceStatusVariant(viewTarget.status)}>{salesInvoiceStatusLabel(viewTarget.status, t)}</StatusPill>}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">{t('financeCopy.outstanding', 'Outstanding')}</dt>
                  <dd className="mt-1 text-sm tabular">
                    {viewTarget.erp_outstanding_amount == null
                      ? t('uxs17.outstandingUnavailable', 'Outstanding amount not available')
                      : <>
                        {formatCurrencyAuto(viewTarget.erp_outstanding_amount, viewTarget.currency)}
                        <FxEquivalent amount={viewTarget.erp_outstanding_amount} currency={viewTarget.currency} date="latest" />
                      </>}
                  </dd>
                </div>
                {(() => {
                  const dueDate = deriveArDueDate(viewTarget.invoice_date, viewTarget.erp_payment_terms_days, viewTarget.erp_due_date, viewTarget.received_date);
                  const overdueDays = overdueAgeDays(dueDate, organizationToday);
                  return overdueDays != null && overdueDays > 0 && (viewTarget.status === 'Submitted' || viewTarget.status === 'Unpaid') ? (
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">{t('uxs17.overdue', 'Overdue')}</dt>
                      <dd className="mt-1 text-sm font-medium">{t('uxs17.daysOverdue', '{{count}} days overdue', { count: overdueDays })}</dd>
                    </div>
                  ) : null;
                })()}
              </dl>
            </section>
            {viewTarget.erp_docstatus === 1 && (viewTarget.status === 'Submitted' || viewTarget.status === 'Unpaid' || viewTarget.status === 'Paid') && (
              <section aria-label={t('uxs17.deliverySection', 'Client delivery')} className="mb-5 space-y-2 border-b border-border pb-4">
                <div>
                  <h2 className="text-base font-semibold">
                    {viewTarget.received_date
                      ? t('uxs17.receivedByClient', 'Received by client')
                      : t('uxs17.readyToSend', 'Ready to send')}
                  </h2>
                  <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">
                    {viewTarget.received_date
                      ? t('uxs17.receivedDateSummary', 'Client receipt was recorded for {{date}}.', { date: formatDateOnly(viewTarget.received_date) })
                      : t('uxs17.manualHandoffHelp', 'Download the PDF and send it to your client yourself.')}
                  </p>
                </div>
                {!viewTarget.received_date && (
                  <div className="flex flex-wrap gap-2">
                    {may('download_pdf', 'salesInvoice', { record: { status: viewTarget.status, erp_docstatus: viewTarget.erp_docstatus } }) && (
                      <Button
                        variant="outline"
                        disabled={pdfDownload.inFlightIds.has(viewTarget.id)}
                        onClick={() => void pdfDownload.download(viewTarget)}
                      >
                        <Icon name="download" />
                        {pdfDownload.inFlightIds.has(viewTarget.id)
                          ? t('uxs17.preparingPdf', 'Preparing PDF…')
                          : t('uxs17.downloadApprovedPdf', 'Download approved PDF')}
                      </Button>
                    )}
                  </div>
                )}
              </section>
            )}
            <SalesInvoiceEvidenceSection invoice={viewTarget} />
            {/* hideLines: the Bill evidence section above is the record page's single lines render
                (AC-991-001's accessible "Line items" list lives there); the approvals panel keeps
                the preview as its own lines surface. */}
            <SalesInvoiceApprovalPreview inv={viewTarget} showFx hideLines />
          </>
        ) : (
          <ListState
            variant="empty"
            icon="doc"
            title={t('financeCopy.invoiceRecordNotFound', 'Invoice not found')}
            sub={t('financeCopy.invoiceRecordNotFoundBody', 'This invoice is no longer available.')}
          />
        )}
        {dialogs}
      </main>
    );
}
