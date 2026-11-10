import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  Button,
  Card,
  CardHead,
  CardPad,
  DataTable,
  ListState,
  StatusPill,
  Tooltip,
  type Column,
  type StatusVariant,
} from '@/src/components/ui';
import { formatDay, formatNumberExact, formatNumberWhole, formatUtcMonthYear } from '@/src/lib/format';
import type { ProgressClaimWithInvoice } from '@/src/lib/db/progressBilling';
import { claimNet } from '@/src/lib/progressBilling';
import { invoiceBalanceFigures, MoneyFigure, type InvoiceWithWorkOrder } from './workOrdersTabFigures';

/** The claims & down payment card on the work orders tab (#913/#1640 family). */
const WorkOrdersClaimsCard: React.FC<{
  visible: boolean;
  boqRows: import('@/src/lib/db/progressBilling').BoqItemRow[];
  /** The project billing summary (`summarizeBilling`) or null while unavailable. */
  summary: import('@/src/lib/progressBilling').ProjectBillingSummary | null;
  canAssess: boolean;
  canRecordPercent: boolean;
  canBill: boolean;
  claimsRead: { isPending: boolean; isError: boolean; refetch: () => void };
  claimRows: ProgressClaimWithInvoice[];
  openClaimDrawer: (claim: ProgressClaimWithInvoice) => void;
  onOpenAssessment: () => void;
  onOpenPercent: () => void;
  onOpenNewClaim: () => void;
  onAttachEvidence: (claimId: string) => void;
  onRaiseClaim: (claim: ProgressClaimWithInvoice) => void;
  onWithdrawClaim: (claim: ProgressClaimWithInvoice) => void;
}> = ({
  visible,
  boqRows,
  summary,
  canAssess,
  canRecordPercent,
  canBill,
  claimsRead,
  claimRows,
  openClaimDrawer,
  onOpenAssessment,
  onOpenPercent,
  onOpenNewClaim,
  onAttachEvidence,
  onRaiseClaim,
  onWithdrawClaim,
}) => {
  const { t } = useTranslation('project');
  if (!visible) return null;

  const projectClaimColumns: Column<ProgressClaimWithInvoice>[] = [
    { key: 'claim', header: t('projectDetail.billing.claims.column.claim', 'Claim'), kind: 'primary', rowHeader: true,
      cell: (claim) => claim.kind === 'down_payment' ? t('projectDetail.billing.claims.kind.downPayment', 'Down payment') : t('projectDetail.billing.claims.kind.progress', 'Progress'),
      secondaryCell: (claim) => formatDay(claim.created_at) },
    { key: 'gross', header: t('projectDetail.billing.claims.column.gross', 'Gross'), align: 'num', kind: 'money',
      cell: (claim) => <Tooltip content={t('projectDetail.billing.claims.source.gross', 'Source: the progress claim gross amount, copied from accepted quantities and contract rates.') }><span className="cursor-help tabular-nums">{formatNumberWhole(Number(claim.gross_amount))}</span></Tooltip>,
      exportValue: (claim) => Number(claim.gross_amount) },
    { key: 'recovery', header: t('projectDetail.billing.claims.column.recovery', 'DP recovery'), align: 'num', kind: 'money',
      cell: (claim) => <Tooltip content={t('projectDetail.billing.claims.source.recovery', 'Source: the down-payment amount recovered on this claim.') }><span className="cursor-help tabular-nums">{formatNumberWhole(Number(claim.dp_recovery_amount))}</span></Tooltip>,
      exportValue: (claim) => Number(claim.dp_recovery_amount) },
    { key: 'net', header: t('projectDetail.billing.claims.column.net', 'Net'), align: 'num', kind: 'money',
      cell: (claim) => <Tooltip content={t('projectDetail.billing.claims.source.net', 'Computed as gross less down-payment recovery.') }><span className="cursor-help tabular-nums font-semibold">{formatNumberWhole(claimNet(Number(claim.gross_amount), Number(claim.dp_recovery_amount)))}</span></Tooltip>,
      exportValue: (claim) => claimNet(Number(claim.gross_amount), Number(claim.dp_recovery_amount)) },
    { key: 'invoice', header: t('projectDetail.billing.claims.column.invoice', 'Invoice'), cell: (claim) => {
      const invoiceId = claim.invoice ? claim.id : null;
      const label = claim.withdrawn_at ? t('projectDetail.billing.claims.withdrawn', 'Withdrawn') : claim.invoice?.status ?? t('projectDetail.billing.claims.notRaised', 'Not raised');
      const variant: StatusVariant = claim.withdrawn_at ? 'lost' : claim.invoice?.status === 'Paid' ? 'won' : claim.invoice?.status === 'Unpaid' || claim.invoice?.status === 'Submitted' ? 'warn' : 'neutral';
      return <Tooltip content={t('projectDetail.billing.claims.source.invoice', 'Source: invoice status linked to this claim.') }>
        {invoiceId ? <Link to={`/sales-invoices/${encodeURIComponent(invoiceId)}`} className="cursor-help"><StatusPill variant={variant}>{claim.invoice?.si_number ?? label}</StatusPill></Link> : <StatusPill variant={variant}>{label}</StatusPill>}
      </Tooltip>;
    } },
    { key: 'evidence', header: t('projectDetail.billing.claims.column.evidence', 'Evidence'), align: 'num', kind: 'number',
      cell: (claim) => <Tooltip content={t('projectDetail.billing.claims.source.evidence', 'Source: linked evidence documents on the claim.') }><span className="cursor-help tabular-nums">{formatNumberExact(claim.evidence?.length ?? 0)}</span></Tooltip>,
      exportValue: (claim) => claim.evidence?.length ?? 0 },
  ];

  return (
    <Card className="min-w-0">
      <CardHead level={2} className="text-base" actions={<div className="flex flex-wrap items-center gap-2">
        {canAssess && boqRows.length > 0 && <Button variant="outline" size="sm" onClick={onOpenAssessment}>
          {t('projectDetail.billing.assessment.record', 'Record progress')}
        </Button>}
        {canRecordPercent && <Button variant="outline" size="sm" onClick={onOpenPercent}>
          {t('projectDetail.billing.assessment.record', 'Record progress')}
        </Button>}
        {canBill && <Button variant="primary" size="sm" onClick={onOpenNewClaim}>
          {t('projectDetail.billing.claims.new', 'New claim')}
        </Button>}
      </div>}>
        {t('projectDetail.billing.claims.title', 'Claims & down payment')}
      </CardHead>
      <CardPad className="pt-0">
        <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border pb-4 sm:grid-cols-3">
          {/* C4: an unknown figure is left out, never a "—"; N13: billing ahead of the work done reads as that, not a negative. */}
          {summary?.unbilledWork !== null && summary?.unbilledWork !== undefined && <div data-testid="claims-gap">
            <dt className="text-sm text-muted-foreground">{summary.unbilledWork < 0
              ? t('projectDetail.billing.summary.billedAhead', 'Billed ahead of progress')
              : t('projectDetail.billing.summary.gap', 'Work done, not yet billed')}</dt>
            <dd className="mt-1 w-fit cursor-help text-base font-semibold tabular-nums"><Tooltip content={t('projectDetail.billing.claims.source.unbilled', 'Computed as earned work from the latest assessment or accepted quantities, less work billed to date.') }><span>{formatNumberWhole(Math.abs(summary.unbilledWork))}</span></Tooltip></dd>
          </div>}
          {summary && <div>
            <dt className="text-sm text-muted-foreground">{t('projectDetail.billing.summary.dpHeld', 'Down payment held')}</dt>
            <dd className="mt-1 w-fit cursor-help text-base font-semibold tabular-nums"><Tooltip content={t('projectDetail.billing.claims.source.dpHeld', 'Computed as invoiced down payment less recovered down payment.') }><span>{formatNumberWhole(summary.dpHeld)}</span></Tooltip></dd>
          </div>}
        </dl>
        <p className="mb-4 text-sm text-muted-foreground">
          {t('projectDetail.billing.claims.evidenceFirst', 'Claims need evidence attached before an invoice draft can be raised.')}
        </p>
        <details className="mb-4 border-b border-border pb-4">
          <summary className="touch-target w-fit cursor-pointer rounded-sm text-sm font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            {t('projectDetail.billing.summary.details', 'Billing summary details')}
          </summary>
          {summary ? <dl data-testid="work-orders-billing-detail" className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            <MoneyFigure label={t('projectDetail.billing.summary.billed', 'Billed to date')} value={formatNumberWhole(summary.workBilled)} detail={t('projectDetail.billing.source.billed', 'Source: work and down-payment claims billed to date.')} />
            <MoneyFigure label={t('projectDetail.billing.summary.contract', 'Contract value')} value={formatNumberWhole(summary.contractNet)} detail={t('projectDetail.billing.source.contract', 'Source: net contract value from the project billing summary.')} />
            <MoneyFigure label={t('projectDetail.billing.summary.remaining', 'Contract not yet billed')} value={formatNumberWhole(summary.remaining)} detail={t('projectDetail.billing.source.remaining', 'Computed as net contract value less claims billed to date.')} />
            <MoneyFigure
              testId={summary.contractLines.length > 0 ? 'work-orders-earned' : undefined}
              label={summary.contractLines.length > 0
                ? t('projectTabs:contractQuantities.billing.summary.earned', 'Earned to date')
                : t('projectDetail.billing.summary.assessed', 'Assessed to date')}
              value={summary.assessedToDate === null ? '—' : formatNumberWhole(summary.assessedToDate)}
              detail={t('projectDetail.billing.source.assessed', 'Source: earned contract line value or the latest recorded progress assessment.')} />
            {summary.assessment && <p className="col-span-2 text-sm text-muted-foreground sm:col-span-3" data-testid="work-orders-assessment-period">
              {t('projectDetail.billing.summary.assessedAsOf', 'as of {{month}}, {{pct}}% complete', { month: formatUtcMonthYear(new Date(`${summary.assessment.month}T00:00:00Z`)), pct: formatNumberExact(summary.assessment.pctComplete) })}
            </p>}
            {!summary.assessment && <p className="col-span-2 text-sm text-muted-foreground sm:col-span-3" data-testid="work-orders-no-assessment">{t('projectTabs:contractQuantities.billing.summary.noAssessment', 'No assessment yet')}</p>}
            <MoneyFigure label={t('projectDetail.billing.summary.notSubmitted', 'Claims raised, not yet submitted')} value={formatNumberWhole(summary.notSubmitted)} detail={t('projectDetail.billing.source.notSubmitted', 'Source: claim invoices created in accounting but not yet submitted.')} />
          </dl> : <p className="mt-3 text-sm text-muted-foreground">{t('projectDetail.billing.summary.unavailable', 'Billing summary is unavailable.')}</p>}
        </details>
        {!claimsRead.isPending && !claimsRead.isError && claimRows.length === 0 ? <ListState variant="empty"
          title={t('projectDetail.billing.claims.empty', 'No billing claims yet')}
          sub={t('projectDetail.billing.claims.emptySub', 'A claim bills a down payment or accepted quantities as one invoice.')} /> : <DataTable<ProgressClaimWithInvoice>
          embedded
          rows={claimRows}
          columns={projectClaimColumns}
          rowKey={(claim) => claim.id}
          rowLabel={(claim) => t('projectDetail.billing.claims.openLabel', 'Open {{kind}} claim from {{date}}', {
            kind: claim.kind === 'down_payment' ? t('projectDetail.billing.claims.kind.downPayment', 'Down payment') : t('projectDetail.billing.claims.kind.progress', 'Progress'),
            date: formatDay(claim.created_at),
          })}
          accessibleName={t('projectDetail.billing.claims.title', 'Claims & down payment')}
          onActivate={openClaimDrawer}
          rowMenu={(claim) => {
            const open = !claim.withdrawn_at && !claim.invoice;
            return [
              ...(open && canBill ? [{ label: t('projectDetail.billing.claims.attachEvidence', 'Attach evidence'), onClick: () => onAttachEvidence(claim.id) }] : []),
              ...(open && canBill && (claim.evidence?.length ?? 0) > 0 ? [{ label: t('projectDetail.billing.claims.raise', 'Raise invoice'), onClick: () => onRaiseClaim(claim) }] : []),
              ...(open && canBill ? [{ label: t('projectDetail.billing.claims.withdraw', 'Withdraw'), danger: true, onClick: () => onWithdrawClaim(claim) }] : []),
            ];
          }}
          state={claimsRead.isPending ? 'loading' : claimsRead.isError ? 'error' : claimRows.length === 0 ? 'empty' : undefined}
          emptyTitle={t('projectDetail.billing.claims.empty', 'No billing claims yet')}
          emptySub={t('projectDetail.billing.claims.emptySub', 'A claim bills a down payment or accepted quantities as one invoice.')}
          errorTitle={t('projectDetail.billing.claims.error', 'Couldn’t load the billing claims')}
          errorSub={t('projectDetail.billing.claims.errorSub', 'Retry, or reopen the project.')}
          onRetry={() => void claimsRead.refetch()}
          cardBelow={1000}
          tableId="project-detail-claims-register"
        />}
      </CardPad>
    </Card>
  );
};

/** Invoices without a customer order, listed under the claims card on the work orders tab. */
export const WorkOrdersOrderlessInvoices: React.FC<{
  orderlessInvoices: InvoiceWithWorkOrder[];
  invoicesRead: { isPending: boolean; isError: boolean; refetch: () => void };
  openInvoiceDrawer: (invoice: InvoiceWithWorkOrder) => void;
}> = ({ orderlessInvoices, invoicesRead, openInvoiceDrawer }) => {
  const { t } = useTranslation('project');
  const orderlessColumns: Column<InvoiceWithWorkOrder>[] = [
    { key: 'invoice', header: t('projectDetail.cascade.invoiceNumber', 'Invoice'), kind: 'primary', rowHeader: true,
      cell: (invoice) => <span className="font-medium">{invoice.si_number ?? t('projectDetail.cascade.invoiceDraft', 'Invoice draft')}</span>,
      exportValue: (invoice) => invoice.si_number ?? '' },
    { key: 'date', header: t('projectDetail.cascade.invoiceDate', 'Date'), kind: 'date',
      cell: (invoice) => invoice.invoice_date ? <Tooltip content={t('projectDetail.cascade.invoiceDateSource', 'Source: invoice date from accounting.')}><span className="cursor-help tabular-nums">{formatDay(invoice.invoice_date)}</span></Tooltip> : null,
      exportValue: (invoice) => invoice.invoice_date ?? '' },
    { key: 'amount', header: t('projectDetail.cascade.invoiceAmount', 'Amount'), kind: 'money', align: 'num',
      cell: (invoice) => invoice.amount === null ? null : <Tooltip content={t('projectDetail.cascade.source.invoiceAmount', 'Source: invoice amount mirrored from accounting.')}><span className="cursor-help tabular-nums">{formatNumberWhole(invoice.amount)}</span></Tooltip>,
      exportValue: (invoice) => invoice.amount ?? '' },
    { key: 'status', header: t('projectDetail.cascade.invoiceStatus', 'Status'), kind: 'status',
      cell: (invoice) => <StatusPill variant={invoice.status === 'Paid' ? 'won' : invoice.status === 'Unpaid' || invoice.status === 'Submitted' ? 'warn' : invoice.status === 'Cancelled' ? 'lost' : 'neutral'}>{invoice.status}</StatusPill>,
      exportValue: (invoice) => invoice.status },
    { key: 'paid', header: t('projectDetail.cascade.paid', 'Paid'), kind: 'money', align: 'num',
      cell: (invoice) => {
        const notApplicable = invoice.status === 'Draft' || invoice.status === 'Cancelled';
        const paid = invoiceBalanceFigures(invoice).paid;
        return notApplicable || paid === null ? '—' : <Tooltip content={t('projectDetail.cascade.source.invoicePaid', 'Computed as invoice amount less accounting balance outstanding.')}><span className="cursor-help tabular-nums">{formatNumberWhole(paid)}</span></Tooltip>;
      } },
    { key: 'unpaid', header: t('projectDetail.cascade.unpaid', 'Unpaid'), kind: 'money', align: 'num',
      cell: (invoice) => {
        const notApplicable = invoice.status === 'Draft' || invoice.status === 'Cancelled';
        const unpaid = invoiceBalanceFigures(invoice).unpaid;
        return notApplicable || unpaid === null ? '—' : <Tooltip content={t('projectDetail.cascade.source.invoiceUnpaid', 'Source: accounting balance outstanding for this invoice.')}><span className="cursor-help tabular-nums">{formatNumberWhole(unpaid)}</span></Tooltip>;
      } },
  ];
  return (
    <section className="panel-card min-w-0" role="region" aria-label={t('projectDetail.workOrders.billing.orderlessHeading', 'Invoices without a customer order')} data-testid="orderless-invoices">
      <CardHead>{t('projectDetail.workOrders.billing.orderlessHeading', 'Invoices without a customer order')}</CardHead>
      <CardPad className="pt-0">
        {invoicesRead.isPending ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="status">
            <span>{t('projectDetail.cascade.invoiceLoading', 'Invoice figures are loading.')}</span>
          </p>
        ) : invoicesRead.isError ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="alert">
            <span>{t('projectDetail.cascade.invoiceError', "Couldn't load invoice figures.")}</span>
            <button type="button" className="touch-target min-h-8 rounded-sm text-primary-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => void invoicesRead.refetch()}>{t('common.retry', 'Retry')}</button>
          </p>
        ) : <>
          {orderlessInvoices.some((invoice) => invoice.status !== 'Draft' && invoice.status !== 'Cancelled' && (invoice.amount === null || invoice.erp_outstanding_amount === null)) && <p className="mb-2 text-sm text-muted-foreground" role="status">
            {t('projectDetail.workOrders.billing.orderlessFiguresIncomplete', 'Paid and unpaid amounts will appear once the accounting system reports an invoice balance.')}
          </p>}
          {/* F10: the shared DataTable (resizable columns, mobile cards, row → drawer). */}
          <DataTable<InvoiceWithWorkOrder>
            embedded
            rows={orderlessInvoices}
            columns={orderlessColumns}
            rowKey={(invoice) => invoice.id}
            rowLabel={(invoice) => t('projectDetail.cascade.openInvoice', 'Open invoice {{invoice}}', { invoice: invoice.si_number ?? invoice.status })}
            onActivate={openInvoiceDrawer}
            accessibleName={t('projectDetail.workOrders.billing.orderlessHeading', 'Invoices without a customer order')}
            cardBelow={720}
            tableId="project-detail-orderless-invoices"
          />
        </>}
      </CardPad>
    </section>
  );
};

export default WorkOrdersClaimsCard;
