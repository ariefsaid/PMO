import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon, LifecycleStepper, ListState, RecordHeader, StatusPill } from '@/src/components/ui';
import { invoiceTimelineSteps } from './invoiceTimeline';
import { usePermission } from '@/src/auth/usePermission';
import { useInvoicePdfDownload } from '@/src/hooks/useInvoicePdfDownload';
import { formatCurrency, formatDayYear } from '@/src/lib/format';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { clientInvoiceOverdueDays, deriveArDueDate } from '@/src/lib/repositories/revenueDisplay';
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
  receiptAwaitingOdoo?: boolean;
  odoo?: boolean;
  may: ReturnType<typeof usePermission>;
  pdfDownload: ReturnType<typeof useInvoicePdfDownload>;
  dialogs: React.ReactNode;
}
export function SalesInvoiceDetail({ viewTarget, isPending, isError, data, mode, organizationToday, onBack, refetch, recordPrimaryAction, invoiceDisplayLabel, receiptAwaitingOdoo = false, odoo = false, may, pdfDownload, dialogs }: Props) {
  const { t } = useTranslation();
  const viewTargetNumber = viewTarget ? invoiceNumber(viewTarget) : null;
  const dueDate = viewTarget ? deriveArDueDate(viewTarget.invoice_date, viewTarget.erp_payment_terms_days, viewTarget.erp_due_date, viewTarget.received_date) : null;
  // #1457: the one shared overdue rule gates the stat and supplies the day count.
  const overdueDays = viewTarget ? clientInvoiceOverdueDays(viewTarget, organizationToday) : null;
  const timeline = viewTarget ? invoiceTimelineSteps(viewTarget, t) : null;
    return (
      <main className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6">
        <Button variant="ghost" onClick={onBack} className="mb-4 -ml-3">
          <Icon name="back" className="size-4" />
          {t('financeCopy.backToInvoices', 'Back to Receivables')}
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
            <RecordHeader
              icon={null}
              name={viewTargetNumber
                ? t('financeCopy.invoiceRecordTitle', 'Invoice {{number}}', { number: viewTargetNumber })
                : invoiceDisplayLabel(viewTarget)}
              status={receiptAwaitingOdoo
                ? <StatusPill variant="progress">{t('finance:receivables.statusReceiptAwaitingOdoo', 'Receipt sent, awaiting Odoo')}</StatusPill>
                : isPartlyPaid(viewTarget)
                ? <StatusPill variant={salesInvoiceStatusVariant('Unpaid')}>{t('financeCopy.statusPartlyPaid', 'Partly paid')}</StatusPill>
                : <StatusPill variant={salesInvoiceStatusVariant(viewTarget.status)}>{salesInvoiceStatusLabel(viewTarget.status, t)}</StatusPill>}
              meta={<>
                {viewTarget.customer_name ?? '—'}
                {viewTarget.paired_erp_invoice_id && (
                  <span className="mt-1 block text-foreground">
                    {t('finance:receivables.pairedCountedOnce', 'Counted once with the ERP invoice {{number}}.', { number: viewTarget.paired_erp_number ?? '—' })}
                  </span>
                )}
              </>}
              primaryAction={recordPrimaryAction ? <Button variant="primary" size="sm" onClick={recordPrimaryAction.onClick}>{recordPrimaryAction.label}</Button> : undefined}
              stats={[
                { label: t('uxs17.invoiceDate', 'Invoice date'), value: viewTarget.invoice_date ? formatDayYear(viewTarget.invoice_date) : t('uxs17.dateNotRecorded', 'Not recorded') },
                { label: t('uxs17.dueDate', 'Due date'), value: dueDate ? formatDayYear(dueDate) : t('uxs17.dueDateUnavailable', 'Due date not available') },
                // Unknown outstanding is left out; the receivables page carries the one hidden-figures line.
                ...(viewTarget.erp_outstanding_amount == null ? [] : [{
                  label: t('financeCopy.outstanding', 'Outstanding'),
                  value: <>
                    {formatCurrency(viewTarget.erp_outstanding_amount, viewTarget.currency, { precision: 'minor' })}
                    <FxEquivalent amount={viewTarget.erp_outstanding_amount} currency={viewTarget.currency} date="latest" />
                  </>,
                }]),
                ...(overdueDays !== null ? [{ label: t('uxs17.overdue', 'Overdue'), value: t('uxs17.daysOverdue', '{{count}} days overdue', { count: overdueDays }) }] : []),
              ]}
            />
            {timeline && <LifecycleStepper variant="bar" steps={timeline} aria-label={t('finance:invoiceTimeline.label', 'Invoice status timeline')} className="mb-5" />}
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
                      ? t('uxs17.receivedDateSummary', 'Client receipt was recorded for {{date}}.', { date: formatDayYear(viewTarget.received_date) })
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
            <SalesInvoiceEvidenceSection invoice={viewTarget} odoo={odoo} />
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
