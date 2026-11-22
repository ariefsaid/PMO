import React from 'react';
import { Link } from 'react-router';
import { useWorkOrder } from '@/src/hooks/useWorkOrderRecord';
import { useTranslation } from 'react-i18next';
import { Button, Icon, LifecycleStepper, ListState, ProjectNameLink, RecordHeader, RecordStack, StatusPill } from '@/src/components/ui';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import { invoiceTimelineSteps } from './invoiceTimeline';
import { usePermission } from '@/src/auth/usePermission';
import { waitingForText, waitingRoleLabel } from '@/src/lib/approvals/waitingFor';
import { useInvoicePdfDownload } from '@/src/hooks/useInvoicePdfDownload';
import { formatCurrency, formatDayYear } from '@/src/lib/format';
import { statusLabel } from '@/src/lib/status/statusMap';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { clientInvoiceOverdueDays, deriveArDueDate } from '@/src/lib/repositories/revenueDisplay';
import { salesInvoiceStatusVariant } from '@/src/lib/status/statusVariants';
import { invoiceNumber, isPartlyPaid } from '@/src/lib/revenue/nativeInvoice';
import { SalesInvoiceApprovalPreview } from '@/pages/approvals/SalesInvoiceApprovalRow';
import FxEquivalent from '@/src/components/fx/FxEquivalent';
import { SalesInvoiceEvidenceWithPayments } from './SalesInvoiceEvidence';
import { useIncomingPayments } from '@/src/hooks/useRevenue';
import { salesInvoicePaymentFacts } from './salesInvoicePaymentFacts';
import { cn } from '@/src/components/ui/cn';

function WorkOrderReference({ id }: { id: string }) {
  const { t } = useTranslation('finance');
  const order = useWorkOrder(id);
  if (!order.data) return null;
  return <span className="mt-1 block">{t('workOrderReference', 'Work order')} · <Link className="underline" to={`/work-orders/${order.data.id}`}>{order.data.wo_number ?? order.data.title}</Link></span>;
}

/** Who raised a PMO-native invoice (the assignable-profiles read is shared with the approvals preview). */
function RaisedBy({ userId }: { userId: string | null | undefined }) {
  const { data: profiles } = useAssignableProfiles();
  return <span className="text-control font-normal">{profiles?.find((profile) => profile.id === userId)?.full_name ?? '—'}</span>;
}

interface Props {
  viewTarget: SalesInvoiceRow | null;
  isPending: boolean;
  isError: boolean;
  data: SalesInvoiceRow[] | undefined;
  organizationToday: string | null;
  onBack: () => void;
  refetch: () => unknown;
  /** `pending`: the revenue mode has not answered, so the action's slot is held (a button-sized placeholder). */
  recordPrimaryAction: { label: string; onClick: () => void; pending?: never } | { pending: true; label?: never; onClick?: never } | null;
  invoiceDisplayLabel: (invoice: SalesInvoiceRow) => string;
  projectName?: string | null;
  receiptAwaitingOdoo?: boolean;
  odoo?: boolean;
  may: ReturnType<typeof usePermission>;
  pdfDownload: ReturnType<typeof useInvoicePdfDownload>;
  dialogs: React.ReactNode;
}
export function SalesInvoiceDetail({ viewTarget, isPending, isError, data, organizationToday, onBack, refetch, recordPrimaryAction, invoiceDisplayLabel, projectName = null, receiptAwaitingOdoo = false, odoo = false, may, pdfDownload, dialogs }: Props) {
  const { t } = useTranslation();
  const viewTargetNumber = viewTarget ? invoiceNumber(viewTarget) : null;
  const isPaid = viewTarget?.status === 'Paid';
  const payments = useIncomingPayments(undefined, Boolean(viewTarget), viewTarget?.id);
  const { amount: paidAmount, date: paidDate } = salesInvoicePaymentFacts(viewTarget, payments);
  const dueDate = viewTarget ? deriveArDueDate(viewTarget.invoice_date, viewTarget.erp_payment_terms_days, viewTarget.erp_due_date, viewTarget.received_date) : null;
  // #1457: the one shared overdue rule gates the stat and supplies the day count.
  const overdueDays = viewTarget ? clientInvoiceOverdueDays(viewTarget, organizationToday) : null;
  const timeline = viewTarget ? invoiceTimelineSteps(viewTarget, t) : null;
  // The delivery step (issued ERP invoice): a header note says where it stands, the download sits in the action slot.
  const deliveryStep = viewTarget != null && viewTarget.erp_docstatus === 1 && (viewTarget.status === 'Submitted' || viewTarget.status === 'Unpaid' || viewTarget.status === 'Paid');
  const canDownloadPdf = deliveryStep && !viewTarget.received_date
    && may('download_pdf', 'salesInvoice', { record: { status: viewTarget.status, erp_docstatus: viewTarget.erp_docstatus } });
  const isWaitingApproval = Boolean(viewTarget?.pmo_native && viewTarget?.status === 'Draft');
  const waitingLine = isWaitingApproval ? waitingForText({ names: [], role: waitingRoleLabel('roleFinanceAdmin', t) }, t) : null;
  const invoiceTitleLabel = viewTargetNumber
    ? t('financeCopy.invoiceRecordTitle', 'Invoice {{number}}', { number: '' }).trim()
    : null;
    return (
      <main data-testid="invoice-record" className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6">
        <Button variant="ghost" onClick={onBack} className="mb-4 -ml-3">
          <Icon name="back" className="size-4" />
          {t('financeCopy.backToInvoices', 'Back to Receivables')}
        </Button>
        {isPending && !viewTarget ? (
          <ListState variant="loading" rows={3} />
        ) : !viewTarget && (isError || !data) ? (
          <ListState
            variant="error"
            title={t('financeCopy.salesInvoicesLoadFailed', "Couldn't load sales invoices")}
            sub={t('financeCopy.theRequestFailedCheckYourConnectionAndTryAgain', "The request failed. Check your connection and try again.")}
            onRetry={() => refetch()}
          />
        ) : viewTarget ? (
          <>
            <RecordStack>
            {/* The record frame (as on the project record): one header panel holding identity, status, facts, the status
                steps, the actions and the delivery note; then the evidence panel. Nothing sits bare on the page. */}
            <RecordHeader
              panelInset
              className={cn('mb-0!', viewTargetNumber && '[&_h1]:whitespace-normal [&_h1]:overflow-visible [&_h1]:text-clip')}
              icon={null}
              name={viewTargetNumber ? (
                <>
                  <span>{invoiceTitleLabel}</span>{' '}
                  <span style={{ whiteSpace: 'nowrap' }}>{viewTargetNumber}</span>
                </>
              ) : invoiceDisplayLabel(viewTarget)}
              status={<span className="inline-flex flex-wrap items-center gap-x-2">
                {receiptAwaitingOdoo && !isPaid
                  ? <StatusPill variant="progress">{t('finance:receivables.statusReceiptAwaitingOdoo', 'Receipt sent, awaiting Odoo')}</StatusPill>
                  : isPartlyPaid(viewTarget)
                  ? <StatusPill variant={salesInvoiceStatusVariant('Unpaid')}>{statusLabel('salesInvoice', 'PartlyPaid', t)}</StatusPill>
                  : <StatusPill variant={salesInvoiceStatusVariant(viewTarget.status)}>{statusLabel('salesInvoice', viewTarget.status, t)}</StatusPill>}
                {waitingLine && (
                  <span data-testid="invoice-waiting-for" className="text-control font-normal text-muted-foreground">
                    {waitingLine}
                  </span>
                )}
              </span>}
              meta={<>
                {viewTarget.customer_name ?? '—'}
                {viewTarget.work_order_id && <WorkOrderReference id={viewTarget.work_order_id} />}
                {viewTarget.paired_erp_invoice_id && (
                  <span className="mt-1 block text-foreground">
                    {t('finance:receivables.pairedCountedOnce', 'Counted once with the ERP invoice {{number}}.', { number: viewTarget.paired_erp_number ?? '—' })}
                  </span>
                )}
              </>}
              primaryAction={recordPrimaryAction
                ? recordPrimaryAction.pending
                  ? <span data-testid="record-action-pending" aria-busy="true" aria-hidden="true" className="skel inline-block h-8 w-[9.5rem] rounded-md max-sm:h-11" />
                  : <Button variant="primary" size="sm" onClick={recordPrimaryAction.onClick}>{recordPrimaryAction.label}</Button>
                : undefined}
              actions={canDownloadPdf ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pdfDownload.inFlightIds.has(viewTarget.id)}
                  onClick={() => void pdfDownload.download(viewTarget)}
                >
                  <Icon name="download" />
                  {pdfDownload.inFlightIds.has(viewTarget.id)
                    ? t('uxs17.preparingPdf', 'Preparing PDF…')
                    : t('uxs17.downloadApprovedPdf', 'Download approved PDF')}
                </Button>
              ) : undefined}
              stats={[
                { label: t('financeCopy.project', 'Project'), value: <ProjectNameLink projectId={viewTarget.project_id} name={projectName} className="text-control" /> },
                { label: t('uxs17.invoiceDate', 'Invoice date'), value: viewTarget.invoice_date ? formatDayYear(viewTarget.invoice_date) : t('uxs17.dateNotRecorded', 'Not recorded') },
                ...(isPaid ? [
                  // #2442: one name for the fact in both languages, the app's established "Payment date".
                  { label: t('financeCopy.paymentDateLabel', 'Payment date'), value: paidDate ? formatDayYear(paidDate) : t('finance:receivables.paymentDateUnavailable', 'Payment date not available') },
                  {
                    label: t('finance:receivables.paidAmount', 'Amount paid'),
                    // #2442: a neutral statement, never "missing" — the settlement may live in the accounting system.
                    value: paidAmount == null ? t('finance:receivables.paidAmountUnavailable', 'Not available in this view') : <>
                      {formatCurrency(paidAmount, viewTarget.currency, { precision: 'minor' })}
                      <FxEquivalent amount={paidAmount} currency={viewTarget.currency} date="latest" />
                    </>,
                  },
                ] : [
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
                ]),
                // The invoice's remaining facts join the header (were boxed cards above the totals).
                ...(viewTarget.pmo_native || viewTarget.reference_number ? [{ label: t('financeCopy.customerPO', 'Customer PO'), value: <span className="text-control font-normal">{viewTarget.reference_number ?? '—'}</span> }] : []),
                ...(viewTarget.pmo_native ? [{ label: t('approvals.salesInvoices.raisedBy', 'Raised by'), value: <RaisedBy userId={viewTarget.author_user_id} /> }] : []),
                ...(!viewTarget.pmo_native && viewTarget.status === 'Draft' && !viewTarget.si_number ? [{ label: t('finance:financeCopy.invoiceNumber', 'Invoice number'), value: <span className="text-control font-normal">{t('finance:financeCopy.odooDraftNumber', 'Draft — Odoo assigns the number on approval')}</span> }] : []),
              ]}
              band={timeline ? <LifecycleStepper
                variant="bar"
                steps={timeline}
                aria-label={t('finance:invoiceTimeline.label', 'Invoice status timeline')}
                className="[&_[data-testid=stepper-scroll-container]>[role=list]]:gap-0 [&_[data-testid=stepper-scroll-container]>[role=list]>.jstep]:min-w-0 [&_[data-testid=stepper-scroll-container]>[role=list]>.jstep>span:first-child]:rounded-none [&_[data-testid=stepper-scroll-container]>[role=list]>.jstep:first-child>span:first-child]:rounded-l-full [&_[data-testid=stepper-scroll-container]>[role=list]>.jstep:last-child>span:first-child]:rounded-r-full [&_[data-testid=stepper-fade]]:hidden"
              /> : undefined}
            >
              {/* #2345 row 2 + #2442: the delivery band carries the delivery fact only — a Paid invoice never prompts
                  "Ready to send", and its paid amount/date live in the key facts above, never repeated here. A Paid
                  invoice with no recorded receipt has no delivery fact to state, so the band stays empty. */}
              {deliveryStep && (viewTarget.received_date || viewTarget.status !== 'Paid') ? (
                <p data-testid="invoice-delivery-note">
                  <span className="font-medium text-foreground">
                    {viewTarget.received_date
                      ? t('uxs17.receivedByClient', 'Received by client')
                      : t('uxs17.readyToSend', 'Ready to send')}
                  </span>
                  <span aria-hidden="true"> · </span>
                  <span>{viewTarget.received_date
                    ? t('uxs17.receivedDateSummary', 'Client receipt was recorded for {{date}}.', { date: formatDayYear(viewTarget.received_date) })
                    : t('uxs17.manualHandoffHelp', 'Download the PDF and send it to your client yourself.')}</span>
                </p>
              ) : null}
            </RecordHeader>
            {/* hideLines: the Bill evidence section is the record page's single lines render (AC-991-001's accessible
                "Line items" list lives there); its totals close the same panel, under the lines they sum. The approvals
                panel keeps the preview as its own lines surface. */}
            <SalesInvoiceEvidenceWithPayments invoice={viewTarget} odoo={odoo} payments={payments} totals={(
              <SalesInvoiceApprovalPreview
                inv={viewTarget}
                showFx
                hideLines
                hideProject
                hideInvoiceDate
                hideFacts
              />
            )} />
            </RecordStack>
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
