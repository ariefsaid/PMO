import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  Button,
  Drawer,
  StatusPill,
  Tooltip,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { formatCurrency, formatDateOnly, formatNumberExact } from '@/src/lib/format';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import type { WorkOrderAcceptanceWithLines } from '@/src/lib/db/workOrderAcceptances';
import type { ProgressClaimWithInvoice } from '@/src/lib/db/progressBilling';
import { claimNet } from '@/src/lib/progressBilling';
import { invoiceBalanceFigures, QuantityFigure, type InvoiceWithWorkOrder, type OrderLineView, basisNote } from './workOrdersTabFigures';

/** The delivery-selector drawer picks the work order a new BAST is recorded against. */
export const DeliverySelectorDrawer: React.FC<{
  open: boolean;
  candidates: WorkOrderRow[];
  onClose: () => void;
  onPick: (order: WorkOrderRow) => void;
}> = ({ open, candidates, onClose, onPick }) => {
  const { t } = useTranslation('project');
  if (!open) return null;
  return <Drawer open title={t('projectDetail.workOrders.action.recordDelivery', 'Record delivery')} onClose={onClose}>
    <div className="flex flex-col gap-2 p-4">
      <p className="text-sm text-muted-foreground">{t('projectDetail.workOrders.delivery.chooseOrder', 'Choose the customer order receiving this delivery.')}</p>
      {candidates.map((order) => <Button key={order.id} variant="outline" className="justify-start" onClick={() => onPick(order)}>{order.wo_number ?? order.title} · {order.title}</Button>)}
    </div>
  </Drawer>;
};

/** One contract-line allocation: quantities, per-order split and confirmed-BAST quantity history. */
export const WorkOrderLineDrawer: React.FC<{
  selected: OrderLineView;
  contractLines: import('@/src/lib/progressBilling').ProjectBillingSummary['contractLines'] | undefined;
  orders: WorkOrderRow[];
  acceptancesByWo: Map<string, WorkOrderAcceptanceWithLines[]>;
  lineReadsPending: boolean;
  lineReadsFailed: boolean;
  canViewBilling: boolean;
  currency: string;
  projectId: string;
  onClose: () => void;
  onAllocateLines: (order: WorkOrderRow) => void;
}> = ({ selected, contractLines, orders, acceptancesByWo, lineReadsPending, lineReadsFailed, canViewBilling, currency, projectId, onClose, onAllocateLines }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  const fact = contractLines?.find((line) => line.boqItemId === selected.allocation.boqItemId);
  const split = fact?.allocations ?? [];
  const history = (acceptancesByWo.get(selected.order.id) ?? []).flatMap((acceptance) => acceptance.lines
    .filter((line) => line.boq_item_id === selected.allocation.boqItemId)
    .map((line) => ({ acceptance, quantity: Number(line.quantity) })));
  return <Drawer open title={selected.item?.description ?? selected.allocation.boqItemId}
    subtitle={`${selected.item?.item_code ?? ''}${selected.item?.unit ? ` · ${selected.item.unit}` : ''}`}
    status={<StatusPill variant={selected.order.status === 'Closed' ? 'won' : 'progress'}>{selected.order.status}</StatusPill>}
    onClose={onClose}
    headerActions={<div className="flex flex-wrap items-center gap-2">
      {!lineReadsPending && !lineReadsFailed && may('create', 'workOrderLine', { record: { status: selected.order.status } }) && <Button variant="outline" size="sm" onClick={() => onAllocateLines(selected.order)}>{t('projectTabs:contractQuantities.workOrders.contractLines.edit', 'Allocate contract lines')}</Button>}
      <Link className="inline-flex min-h-10 items-center text-sm font-medium text-primary-text underline underline-offset-2" to={`/projects/${encodeURIComponent(projectId)}/work-orders?wo=${encodeURIComponent(selected.order.id)}`} onClick={onClose}>
        {t('projectDetail.drawer.openFullPage', 'Open full page')}
      </Link>
    </div>}>
    <div className="flex flex-col gap-5 p-4">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <QuantityFigure label={t('projectDetail.cascade.colOrdered', 'Ordered')} value={`${formatNumberExact(selected.allocation.quantity)} ${selected.item?.unit ?? ''}`} detail={t('projectDetail.cascade.source.lineOrdered', 'Source: quantity allocated to this work order.')} />
        <QuantityFigure label={t('projectDetail.cascade.colDelivered', 'Delivered')} value={selected.allocation.acceptedQuantity === null ? '—' : `${formatNumberExact(selected.allocation.acceptedQuantity)} ${selected.item?.unit ?? ''}`} detail={t('projectDetail.cascade.source.lineDelivered', 'Source: total quantity accepted on confirmed BASTs for this work order.')} />
        <QuantityFigure label={t('projectDetail.cascade.colInvoiced', 'Invoiced')} value={`${formatNumberExact(selected.allocation.claimedQuantity)} ${selected.item?.unit ?? ''}`} detail={t('projectDetail.cascade.source.lineInvoiced', 'Source: quantity already claimed against this work order allocation.')} />
        <QuantityFigure label={t('projectDetail.cascade.colCanInvoice', 'Can invoice')} value={selected.allocation.acceptedQuantity === null ? '—' : `${formatNumberExact(Math.max(0, selected.allocation.acceptedQuantity - selected.allocation.claimedQuantity))} ${selected.item?.unit ?? ''}`} detail={t('projectDetail.cascade.source.lineCanInvoice', 'Accepted quantity less already claimed quantity. No figure appears until a BAST is confirmed.')} />
        {canViewBilling && selected.rate !== null && <QuantityFigure label={t('projectDetail.cascade.colRate', 'Rate')} value={formatCurrency(selected.rate, currency)} detail={t('projectDetail.cascade.source.rate', 'Source: the rate on this bill of quantities line.')} />}
      </dl>
      <section aria-labelledby="line-order-split">
        <h2 id="line-order-split" className="mb-2 text-sm font-semibold">{t('projectDetail.cascade.lineSplit', 'Per-order split')}</h2>
        {split.length === 0 ? <p className="text-sm text-muted-foreground">{t('projectDetail.cascade.noLineSplit', 'No order allocation history is available.')}</p> : <ul className="divide-y divide-border text-sm">
          {split.map((allocation) => {
            const order = orders.find((candidate) => candidate.id === allocation.workOrderId);
            return <li key={allocation.workOrderId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{order?.wo_number ?? order?.title ?? allocation.workOrderId}</span>
              <Tooltip content={t('projectDetail.cascade.source.lineOrdered', 'Source: quantity allocated to this work order.')}>
                <span className="cursor-help tabular-nums">{formatNumberExact(allocation.quantity)} {selected.item?.unit ?? ''}</span>
              </Tooltip>
            </li>;
          })}
        </ul>}
      </section>
      <section aria-labelledby="line-quantity-history">
        <h2 id="line-quantity-history" className="mb-2 text-sm font-semibold">{t('projectDetail.cascade.quantityHistory', 'Quantity history')}</h2>
        {history.length === 0 ? <p className="text-sm text-muted-foreground">{t('projectDetail.cascade.noConfirmedBastHistory', 'No confirmed BAST quantity history yet.')}</p> : <ul className="divide-y divide-border text-sm">
          {history.map(({ acceptance, quantity }) => <li key={acceptance.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>{formatDateOnly(acceptance.acceptance_date)} · {acceptance.is_final ? t('projectTabs:contractQuantities.workOrders.acceptances.final', 'Final') : t('projectTabs:contractQuantities.workOrders.acceptances.stage', 'Stage')}</span>
            <Tooltip content={t('projectDetail.cascade.source.acceptedHistory', 'Source: quantity recorded on this BAST.') }><span className="cursor-help tabular-nums">{formatNumberExact(quantity)} {selected.item?.unit ?? ''}</span></Tooltip>
          </li>)}
        </ul>}
      </section>
    </div>
  </Drawer>;
};

/** The customer-PO drawer: one work order's recorded PO fields and value. */
export const WorkOrderPoDrawer: React.FC<{
  row: WorkOrderRow;
  canViewBilling: boolean;
  currency: string;
  projectId: string;
  onClose: () => void;
  onEdit: (row: WorkOrderRow) => void;
}> = ({ row, canViewBilling, currency, projectId, onClose, onEdit }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  return <Drawer open title={t('projectDetail.workOrders.action.viewPo', 'View customer PO')} subtitle={row.title}
    status={<StatusPill variant={row.status === 'Closed' ? 'won' : 'progress'}>{row.status}</StatusPill>}
    onClose={onClose}
    headerActions={<div className="flex flex-wrap items-center gap-2">
      {may('edit', 'workOrder', { record: { status: row.status } }) && <Button variant="outline" size="sm" onClick={() => onEdit(row)}>{t('projectDetail.workOrders.action.editOrder', 'Edit order')}</Button>}
      <Link className="inline-flex min-h-10 items-center text-sm font-medium text-primary-text underline underline-offset-2" to={`/projects/${encodeURIComponent(projectId)}/work-orders?wo=${encodeURIComponent(row.id)}`} onClick={onClose}>{t('projectDetail.drawer.openFullPage', 'Open full page')}</Link>
    </div>}>
    <dl className="space-y-4 p-4 text-sm">
      <div><dt className="text-xs text-muted-foreground">{t('projectDetail.workOrders.clientPo', 'Customer PO')}</dt><dd className="mt-1 font-medium">{row.client_po_number ?? '—'}</dd></div>
      {row.order_date && <div><dt className="text-xs text-muted-foreground">{t('projectDetail.workOrders.orderDate', 'Order date')}</dt><dd className="mt-1 font-medium">{formatDateOnly(row.order_date)}</dd></div>}
      {row.description && <div><dt className="text-xs text-muted-foreground">{t('projectDetail.workOrders.description', 'Description')}</dt><dd className="mt-1 whitespace-pre-wrap">{row.description}</dd></div>}
      {canViewBilling && row.order_value !== null && <div><dt className="text-xs text-muted-foreground">{t('projectDetail.workOrders.orderValue', 'Order value')}</dt><dd className="mt-1 w-fit cursor-help font-semibold tabular-nums"><Tooltip content={t('projectDetail.workOrders.orderValueSource', 'Source: the customer order value set by an authorized reviewer.') }><span>{formatCurrency(Number(row.order_value), currency)} · {basisNote(row, t)}</span></Tooltip></dd></div>}
      {canViewBilling && row.closing_value !== null && <p className="text-sm font-semibold tabular-nums">{t('projectTabs:contractQuantities.workOrders.closing.closedAt', 'Closed at {{amount}} (excl. PPN)', { amount: formatCurrency(Number(row.closing_value), currency), interpolation: { escapeValue: false } })}</p>}
    </dl>
  </Drawer>;
};

/** The invoice drawer: one work-order invoice's mirrored figures. */
export const WorkOrderInvoiceDrawer: React.FC<{
  invoice: InvoiceWithWorkOrder;
  currency: string;
  onClose: () => void;
}> = ({ invoice, currency, onClose }) => {
  const { t } = useTranslation('project');
  const figures = invoiceBalanceFigures(invoice);
  const invoiceCurrency = invoice.currency || currency;
  return <Drawer open title={invoice.si_number ?? t('projectDetail.cascade.invoiceDraft', 'Invoice draft')}
    status={<StatusPill variant={invoice.status === 'Paid' ? 'won' : invoice.status === 'Unpaid' || invoice.status === 'Submitted' ? 'warn' : invoice.status === 'Cancelled' ? 'lost' : 'neutral'}>{invoice.status}</StatusPill>}
    onClose={onClose}
    headerActions={<Link className="inline-flex min-h-10 items-center text-sm font-medium text-primary-text underline underline-offset-2" to={`/sales-invoices/${encodeURIComponent(invoice.id)}`} onClick={onClose}>{t('projectDetail.drawer.openFullPage', 'Open full page')}</Link>}>
    <dl className="grid grid-cols-2 gap-4 p-4 text-sm">
      {invoice.invoice_date && <QuantityFigure label={t('projectDetail.cascade.invoiceDate', 'Date')} value={formatDateOnly(invoice.invoice_date)} />}
      {invoice.amount !== null && <QuantityFigure label={t('projectDetail.cascade.invoiceAmount', 'Amount')} value={formatCurrency(invoice.amount, invoiceCurrency)} detail={t('projectDetail.cascade.source.invoiceAmount', 'Source: invoice amount mirrored from accounting.') } />}
      {figures.paid !== null && <QuantityFigure label={t('projectDetail.cascade.paid', 'Paid')} value={formatCurrency(figures.paid, invoiceCurrency)} detail={t('projectDetail.cascade.source.invoicePaid', 'Computed as invoice amount less accounting balance outstanding.') } />}
      {figures.unpaid !== null && <QuantityFigure label={t('projectDetail.cascade.unpaid', 'Unpaid')} value={formatCurrency(figures.unpaid, invoiceCurrency)} detail={t('projectDetail.cascade.source.invoiceUnpaid', 'Source: accounting balance outstanding for this invoice.') } />}
      {invoice.erp_due_date && <QuantityFigure label={t('projectDetail.cascade.invoiceDueDate', 'Due date')} value={formatDateOnly(invoice.erp_due_date)} />}
    </dl>
  </Drawer>;
};

/** The claim drawer: one progress claim's figures, evidence and raise path. */
export const WorkOrderClaimDrawer: React.FC<{
  claim: ProgressClaimWithInvoice;
  canBill: boolean;
  currency: string;
  projectId: string;
  onClose: () => void;
  onRaise: (claim: ProgressClaimWithInvoice) => void;
  onAttachEvidence: (claimId: string) => void;
}> = ({ claim, canBill, currency, projectId, onClose, onRaise, onAttachEvidence }) => {
  const { t } = useTranslation('project');
  return <Drawer open title={claim.kind === 'down_payment'
    ? t('projectDetail.billing.claims.kind.downPayment', 'Down payment')
    : t('projectDetail.billing.claims.kind.progress', 'Progress')}
    subtitle={formatDateOnly(claim.created_at)}
    status={<StatusPill variant={claim.withdrawn_at ? 'lost' : claim.invoice?.status === 'Paid' ? 'won' : 'neutral'}>{claim.withdrawn_at ? t('projectDetail.billing.claims.withdrawn', 'Withdrawn') : claim.invoice?.status ?? t('projectDetail.billing.claims.notRaised', 'Not raised')}</StatusPill>}
    onClose={onClose}
    headerActions={<div className="flex flex-wrap items-center gap-2">
      {!claim.withdrawn_at && !claim.invoice && canBill && ((claim.evidence?.length ?? 0) > 0
        ? <Button variant="primary" size="sm" onClick={() => onRaise(claim)}>{t('projectDetail.billing.claims.raise', 'Raise invoice')}</Button>
        : <Button variant="outline" size="sm" onClick={() => onAttachEvidence(claim.id)}>{t('projectDetail.billing.claims.attachEvidence', 'Attach evidence')}</Button>)}
      <Link className="inline-flex min-h-10 items-center text-sm font-medium text-primary-text underline underline-offset-2" to={claim.invoice ? `/sales-invoices/${encodeURIComponent(claim.id)}` : `/projects/${encodeURIComponent(projectId)}/billing`} onClick={onClose}>{t('projectDetail.drawer.openFullPage', 'Open full page')}</Link>
    </div>}>
    <dl className="grid grid-cols-2 gap-4 p-4 text-sm">
      <QuantityFigure label={t('projectDetail.billing.claims.column.gross', 'Gross')} value={formatCurrency(Number(claim.gross_amount), currency)} detail={t('projectDetail.billing.claims.source.gross', 'Source: the progress claim gross amount, copied from accepted quantities and contract rates.') } />
      <QuantityFigure label={t('projectDetail.billing.claims.column.recovery', 'DP recovery')} value={formatCurrency(Number(claim.dp_recovery_amount), currency)} detail={t('projectDetail.billing.claims.source.recovery', 'Source: the down-payment amount recovered on this claim.') } />
      <QuantityFigure label={t('projectDetail.billing.claims.column.net', 'Net')} value={formatCurrency(claimNet(Number(claim.gross_amount), Number(claim.dp_recovery_amount)), currency)} detail={t('projectDetail.billing.claims.source.net', 'Computed as gross less down-payment recovery.') } />
      <QuantityFigure label={t('projectDetail.billing.claims.column.evidence', 'Evidence')} value={formatNumberExact(claim.evidence?.length ?? 0)} detail={t('projectDetail.billing.claims.source.evidence', 'Source: linked evidence documents on the claim.') } />
    </dl>
    <section className="border-t border-border px-4 py-3">
      <h3 className="text-sm font-semibold">{t('projectDetail.billing.claims.evidence', 'Evidence')}</h3>
      {(claim.evidence ?? []).length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{t('projectDetail.billing.claims.noEvidence', 'No evidence attached yet.')}</p> : <ul className="mt-2 divide-y divide-border text-sm">
        {(claim.evidence ?? []).map((evidence) => <li key={evidence.id} className="flex items-center justify-between gap-3 py-2"><span>{evidence.document_id}</span><StatusPill variant={evidence.document_status === 'active' ? 'won' : 'neutral'}>{evidence.document_status}</StatusPill></li>)}
      </ul>}
    </section>
  </Drawer>;
};
