import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  DataTable,
  ListState,
  MenuButton,
  ProgressBar,
  StatusPill,
  Tooltip,
  cn,
  type Column,
  type RowMenuItem,
  type StatusVariant,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { formatCurrency, formatDateOnly, formatNumberExact, formatNumberWhole } from '@/src/lib/format';
import { clientInvoiceOverdueDays } from '@/src/lib/repositories/revenueDisplay';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import type { WorkOrderAcceptanceWithLines, WorkOrderLineRow } from '@/src/lib/db/workOrderAcceptances';
import type { WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';
import type { BoqItemRow } from '@/src/lib/db/progressBilling';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import type { ProjectBillingSummary } from '@/src/lib/progressBilling';
import { deriveWorkOrderBillingState, type WorkOrderBillingState } from '@/src/lib/workOrderBilling';
import { summarizeInvoiceSettlement } from '@/src/lib/invoiceSettlement';
import WorkOrderAcceptances from '../WorkOrderAcceptances';
import { WorkOrderCostVariations } from '../WorkOrderCostVariations';
import { MoneyFigure, type InvoiceWithWorkOrder, type OrderLineView } from './workOrdersTabFigures';

/** The billing/invoice figure reads the card's incompleteness states surface. */
export interface FigureReadState {
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}

interface WorkOrderCustomerOrderCardProps {
  row: WorkOrderRow;
  currency: string;
  canViewBilling: boolean;
  /** The org's business day (#1457) — bounds every overdue figure below. */
  orgDay: string | null;
  boqRows: BoqItemRow[];
  documentRows: ProjectDocumentRow[];
  /** Who may prepare a BAST (the project's own PM or Finance rank). */
  projectManagerId: string | null;
  /** This work order's contract-line allocations, grouped per work order. */
  allocationsByWo: Map<string, WorkOrderLineRow[]>;
  acceptancesByWo: Map<string, WorkOrderAcceptanceWithLines[]>;
  invoicesByWo: Map<string, InvoiceWithWorkOrder[]>;
  billingById: Map<string, WorkOrderBillingRow>;
  ageById: Map<string, number>;
  drawerLineRows: OrderLineView[];
  lineReadsPending: boolean;
  lineReadsFailed: boolean;
  invoiceReadReady: boolean;
  invoicesRead: FigureReadState;
  billingRead: FigureReadState;
  /** The project billing read (contract lines) — only what the card renders. */
  contractLines: ProjectBillingSummary['contractLines'] | undefined;
  /** Retries the three contract-line reads together (boq, project billing, allocations). */
  retryLineReads: () => void;
  canPrepareForOrder: (row: WorkOrderRow) => boolean;
  orderInvoiceAction: (row: WorkOrderRow) => (() => void) | null;
  closeByBast: (id: string) => boolean;
  currentUserId: string | null;
  openPoDrawer: (row: WorkOrderRow) => void;
  openLineDrawer: (line: OrderLineView) => void;
  openInvoiceDrawer: (invoice: InvoiceWithWorkOrder) => void;
  setFormFor: (row: WorkOrderRow | null) => void;
  setPending: (pending: import('./workOrdersTabFigures').PendingTransition) => void;
  setBastFor: (value: { row: WorkOrderRow; draft: WorkOrderAcceptanceWithLines | null }) => void;
  setConfirmFor: (value: { acceptance: WorkOrderAcceptanceWithLines; error: string | null }) => void;
  setWithdrawFor: (value: WorkOrderAcceptanceWithLines | null) => void;
  setLinesFor: (row: WorkOrderRow | null) => void;
  acceptancesRead: FigureReadState;
  linesRead: FigureReadState;
}

const WorkOrderCustomerOrderCard: React.FC<WorkOrderCustomerOrderCardProps> = ({
  row,
  currency,
  canViewBilling,
  orgDay,
  boqRows,
  documentRows,
  projectManagerId,
  allocationsByWo,
  acceptancesByWo,
  invoicesByWo,
  billingById,
  ageById,
  drawerLineRows,
  lineReadsPending,
  lineReadsFailed,
  invoiceReadReady,
  invoicesRead,
  billingRead,
  contractLines,
  retryLineReads,
  canPrepareForOrder,
  orderInvoiceAction,
  closeByBast,
  currentUserId,
  openPoDrawer,
  openLineDrawer,
  openInvoiceDrawer,
  setFormFor,
  setPending,
  setBastFor,
  setConfirmFor,
  setWithdrawFor,
  setLinesFor,
  acceptancesRead,
  linesRead,
}) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  const billingStateLabels: Record<Exclude<WorkOrderBillingState, 'not-billable'>, string> = {
    incomplete: t('common:projectDetail.workOrders.billing.status.incomplete', "Can't total"),
    'over-invoiced': t('common:projectDetail.workOrders.billing.status.overInvoiced', 'Over-invoiced'),
    'not-invoiced': t('common:projectDetail.workOrders.billing.status.notInvoiced', 'Not invoiced'),
    paid: t('common:projectDetail.workOrders.billing.status.paid', 'Fully paid'),
    'awaiting-submission': t('common:projectDetail.workOrders.billing.status.awaitingSubmission', 'Awaiting submission'),
    'fully-invoiced': t('common:projectDetail.workOrders.billing.status.fullyInvoiced', 'Fully invoiced'),
    'partly-invoiced': t('common:projectDetail.workOrders.billing.status.partlyInvoiced', 'Partly invoiced'),
  };
  const billingStateTones: Record<Exclude<WorkOrderBillingState, 'not-billable'>, StatusVariant> = {
    incomplete: 'warn',
    'over-invoiced': 'lost',
    'not-invoiced': 'open',
    paid: 'won',
    'awaiting-submission': 'neutral',
    'fully-invoiced': 'neutral',
    'partly-invoiced': 'progress',
  };

  const orderAllocations = (contractLines ?? []).flatMap((line) =>
    line.allocations.filter((allocation) => allocation.workOrderId === row.id).map((allocation) => ({ line, allocation })),
  );
  const rawLines = allocationsByWo.get(row.id) ?? [];
  const hasOrderLines = orderAllocations.length > 0 || rawLines.length > 0;
  const orderLineFactsReady = !lineReadsPending && !lineReadsFailed && (!hasOrderLines || Boolean(contractLines));
  const bastList = acceptancesByWo.get(row.id) ?? [];
  const pendingBast = [...bastList].filter((acceptance) => acceptance.status === 'Draft')
    .sort((a, b) => b.prepared_at.localeCompare(a.prepared_at))[0];
  const billingRow = billingById.get(row.id);
  const orderInvoices = invoicesByWo.get(row.id) ?? [];
  // NFR-BWO-005: no figures until BOTH the invoices and the order billing are read — a pending or failed
  // billing read must not look like an order with nothing invoiced.
  const settlement = invoiceReadReady && !billingRead.isPending && !billingRead.isError ? summarizeInvoiceSettlement(orderInvoices) : null;
  // SUB-C: invoiced / paid / unpaid appear once something has been invoiced.
  const hasInvoiced = (settlement?.invoiced ?? 0) > 0;
  const canPrepare = canPrepareForOrder(row);
  const canConfirm = Boolean(pendingBast) && row.status === 'Issued' && may('confirm', 'workOrderAcceptance', {
    currentUserId,
    record: { status: pendingBast?.status, prepared_by: pendingBast?.prepared_by },
  });
  const canEdit = may('edit', 'workOrder', { record: { status: row.status } });
  const canTransition = may('transition', 'workOrder');
  const raiseOrderInvoice = orderInvoiceAction(row);
  const canRaiseOrderInvoice = raiseOrderInvoice !== null;
  const orderFiguresComplete = Boolean(settlement)
    && settlement?.invoiced !== null
    && settlement?.balancesKnown
    && billingRow?.figuresComplete !== false;
  const orderFiguresMissing = canViewBilling && !orderFiguresComplete;
  const billingState = billingRow ? deriveWorkOrderBillingState(row.status, billingRow) : null;
  const workOrderStatusTone: StatusVariant = row.status === 'Closed' ? 'won' : row.status === 'Cancelled' ? 'lost' : 'progress';
  const latestConfirmedBast = bastList.find((acceptance) => acceptance.status === 'Confirmed');
  const orderOverdue = orderInvoices.reduce((sum, invoice) => {
    // #1457: the one shared overdue rule (status + derived due date + org day) decides each row.
    if (clientInvoiceOverdueDays(invoice, orgDay) === null) return sum;
    const balance = invoice.erp_outstanding_amount;
    return balance === null ? sum : sum + Math.max(0, balance);
  }, 0);
  const canEditLines = !lineReadsPending && !lineReadsFailed && may('create', 'workOrderLine', { record: { status: row.status } });
  const orderActions: RowMenuItem[] = [
    ...(canPrepare ? [{ label: t('projectDetail.workOrders.action.recordDelivery', 'Record delivery'), onClick: () => setBastFor({ row, draft: null }) }] : []),
    ...(canConfirm && pendingBast ? [{ label: t('projectTabs:contractQuantities.workOrders.acceptances.confirmDelivery', 'Confirm draft BAST'), onClick: () => setConfirmFor({ acceptance: pendingBast, error: null }) }] : []),
    ...(canRaiseOrderInvoice ? [{ label: t('projectDetail.workOrders.billing.invoiceAction', 'Raise invoice'), onClick: raiseOrderInvoice }] : []),
    ...(canEditLines ? [{ label: t('projectTabs:contractQuantities.workOrders.contractLines.edit', 'Allocate contract lines'), onClick: () => setLinesFor(row) }] : []),
    ...(row.client_po_number ? [{ label: t('projectDetail.workOrders.action.viewPo', 'View customer PO'), onClick: () => openPoDrawer(row) }] : []),
    ...(canEdit ? [{ label: t('projectDetail.workOrders.action.editOrder', 'Edit order'), onClick: () => setFormFor(row) }] : []),
    ...(row.status === 'Issued' && canTransition && !closeByBast(row.id) ? [{ label: t('projectDetail.workOrders.action.close', 'Close order'), onClick: () => setPending({ row, to: 'Closed' }) }] : []),
    ...((row.status === 'Issued' || row.status === 'Draft') && canTransition ? [{ label: t('projectDetail.workOrders.action.cancel', 'Cancel order'), danger: true, onClick: () => setPending({ row, to: 'Cancelled' }) }] : []),
  ];
  const orderLineRows = drawerLineRows.filter((line) => line.order.id === row.id);
  const lineColumns: Column<OrderLineView>[] = [
    {
      key: 'item', header: t('projectDetail.cascade.colItem', 'Item'), kind: 'primary', rowHeader: true,
      cell: (line) => <span>{line.item?.item_code ? <span className="mr-2 text-xs text-muted-foreground">{line.item.item_code}</span> : null}{line.item?.description ?? line.allocation.boqItemId}</span>,
      secondaryCell: (line) => t('projectDetail.cascade.contractQuantity', 'Contract quantity {{quantity}} {{unit}}', { quantity: formatNumberExact(line.allocation.quantity), unit: line.item?.unit ?? '' }),
    },
    { key: 'unit', header: t('projectDetail.cascade.colUnit', 'Unit'), cell: (line) => <span className="text-muted-foreground">{line.item?.unit ?? '—'}</span>, kind: 'meta' },
    ...(canViewBilling ? [{ key: 'rate', header: t('projectDetail.cascade.colRate', 'Rate'), align: 'num' as const, kind: 'money' as const,
      cell: (line: OrderLineView) => <Tooltip content={t('projectDetail.cascade.source.rate', 'Source: the rate on this bill of quantities line.') }><span className="cursor-help tabular-nums">{line.rate === null ? '—' : formatNumberWhole(line.rate)}</span></Tooltip>,
      exportValue: (line: OrderLineView) => line.rate ?? '',
    }] : []),
    { key: 'ordered', header: t('projectDetail.cascade.colOrdered', 'Ordered'), align: 'num', kind: 'number', cell: (line) => <Tooltip content={t('projectDetail.cascade.source.lineOrdered', 'Source: quantity allocated to this work order.') }><span className="cursor-help tabular-nums">{formatNumberExact(line.allocation.quantity)}</span></Tooltip>, exportValue: (line) => line.allocation.quantity },
    { key: 'delivered', header: t('projectDetail.cascade.colDelivered', 'Delivered'), cell: (line) => {
      const deliveredQuantity = line.allocation.acceptedQuantity;
      const short = deliveredQuantity !== null && deliveredQuantity < line.allocation.quantity && line.allocation.final;
      const percentDone = deliveredQuantity === null || line.allocation.quantity <= 0 ? null : Math.round(deliveredQuantity / line.allocation.quantity * 100);
      return <div className="min-w-24">
        <Tooltip content={t('projectDetail.cascade.source.lineDelivered', 'Source: total quantity accepted on confirmed BASTs for this work order.') }>
          <span data-testid={`contract-accepted-${line.allocation.boqItemId}`} className={cn('cursor-help tabular-nums', short && 'text-warning-foreground')}>
            {deliveredQuantity === null ? '—' : `${formatNumberExact(deliveredQuantity)} ${line.item?.unit ?? ''}`}
          </span>
        </Tooltip>
        {percentDone !== null && <Tooltip content={t('projectDetail.cascade.source.lineDeliveryProgress', 'Accepted quantity ÷ ordered quantity. A final short delivery is flagged.') }>
          <span className="mt-1 block w-full max-w-24 cursor-help"><ProgressBar value={percentDone} widthless aria-label={t('projectDetail.cascade.deliveryProgress', 'Delivered percentage')} /></span>
        </Tooltip>}
        {short && <span className="block text-[11px] text-warning-foreground">{t('projectDetail.cascade.short', '({{n}} short)', { n: formatNumberExact(line.allocation.quantity - deliveredQuantity) })}</span>}
      </div>;
    }, exportValue: (line) => line.allocation.acceptedQuantity ?? '' },
    { key: 'invoiced', header: t('projectDetail.cascade.colInvoiced', 'Invoiced'), align: 'num', kind: 'number', cell: (line) => <Tooltip content={t('projectDetail.cascade.source.lineInvoiced', 'Source: quantity already claimed against this work order allocation.') }><span className="cursor-help tabular-nums">{formatNumberExact(line.allocation.claimedQuantity)}</span></Tooltip>, exportValue: (line) => line.allocation.claimedQuantity },
    { key: 'canInvoice', header: t('projectDetail.cascade.colCanInvoice', 'Can invoice'), align: 'num', kind: 'number', cell: (line) => <Tooltip content={t('projectDetail.cascade.source.lineCanInvoice', 'Accepted quantity less already claimed quantity. No figure appears until a BAST is confirmed.') }><span className="cursor-help tabular-nums font-semibold">{line.allocation.acceptedQuantity === null ? '—' : formatNumberExact(Math.max(0, line.allocation.acceptedQuantity - line.allocation.claimedQuantity))}</span></Tooltip>, exportValue: (line) => line.allocation.acceptedQuantity === null ? '' : Math.max(0, line.allocation.acceptedQuantity - line.allocation.claimedQuantity) },
  ];

  return (
    <article data-testid={`customer-order-${row.id}`} className="min-w-0 rounded-md border border-border p-4">
      <header className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 data-wo-anchor={row.id} tabIndex={-1}
            className="rounded-sm text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <button type="button"
              className="touch-target rounded-sm text-left underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={t('projectDetail.workOrders.action.openDetails', 'View details for {{order}}', { order: row.wo_number ?? row.title })}
              onClick={() => openPoDrawer(row)}>
              {row.wo_number ?? t('projectDetail.workOrders.notYetIssued', 'Not issued yet')}
            </button>
          </h3>
          <span className="min-w-0 break-words text-sm text-foreground">{row.title}</span>
          <StatusPill variant={workOrderStatusTone}>{row.status}</StatusPill>
          {canViewBilling && billingState && billingState !== 'not-billable' && <StatusPill variant={billingStateTones[billingState]}>
            {billingStateLabels[billingState]}
          </StatusPill>}
          {row.client_po_number && <span className="text-xs text-muted-foreground">{t('projectDetail.workOrders.clientPo', 'Customer PO')} {row.client_po_number}</span>}
          {row.order_date && <span className="text-xs text-muted-foreground">{t('projectDetail.workOrders.orderDate', 'Order date')} {formatDateOnly(row.order_date)}</span>}
          {canViewBilling && ageById.has(row.id) && <Tooltip content={t('projectDetail.workOrders.acceptanceAgeSource', 'Counted from the earliest confirmed BAST not yet followed by a submitted invoice.')}>
            <span tabIndex={0} className="text-xs font-semibold text-warning-foreground">
              {t('projectDetail.workOrders.acceptanceAge', 'Days since acceptance, not invoiced: {{days}}', { days: ageById.get(row.id) })}
            </span>
          </Tooltip>}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canRaiseOrderInvoice && billingRow && <Tooltip content={`${t('projectDetail.workOrders.billing.orderRemainingSource', 'Source: work-order billing balance after invoices and pending drafts.')} ${t('common:projectDetail.workOrders.billing.lineNet', 'Net value {{amount}}', { amount: formatNumberWhole(billingRow.orderNet) })}`}>
              {/* L6: the amount is the order's "Still to invoice" figure below; the action does not repeat it. */}
              <Button variant="primary" size="sm" onClick={raiseOrderInvoice ?? undefined}>
                {t('projectDetail.workOrders.billing.invoiceAction', 'Raise invoice')}
              </Button>
            </Tooltip>}
            {canPrepare && <Button variant="outline" size="sm" onClick={() => setBastFor({ row, draft: null })}>
              {t('projectDetail.workOrders.action.recordDelivery', 'Record delivery')}
            </Button>}
            {orderActions.length > 0 && <MenuButton items={orderActions} ariaLabel={t('projectDetail.workOrders.action.orderMenuLabel', 'Actions for {{order}}', { order: row.wo_number ?? row.title })} />}
          </div>
        </div>

        {canViewBilling && <dl className="flex flex-wrap gap-x-6 gap-y-2" data-testid={`wo-money-${row.id}`} aria-label={t('common:projectDetail.workOrders.billing.column', 'Billing')}>
          {/* AC-BWO-004: what is still to invoice leads, ahead of invoiced and paid. */}
          {billingRow?.figuresComplete && row.status !== 'Draft' && row.status !== 'Cancelled' && <div className="min-w-0 text-xs">
              <dt className="sr-only">{t('common:projectDetail.workOrders.billing.stillToInvoice', 'Still to invoice')}</dt>
              <dd data-testid={`wo-still-${row.id}`} className="cursor-help text-muted-foreground tabular-nums"><Tooltip content={t('projectDetail.workOrders.billing.pendingNote', 'Drafts and unraised claims count as not yet invoiced.') }><span>{billingRow.remaining < 0
                ? t('common:projectDetail.workOrders.billing.lineOver', 'Over by {{amount}}', { amount: formatNumberWhole(Math.abs(billingRow.remaining)) })
                : t('common:projectDetail.workOrders.billing.lineRemaining', 'Still to invoice {{amount}}', { amount: formatNumberWhole(billingRow.remaining) })}</span></Tooltip></dd>
            </div>}
          {row.status === 'Closed' && row.closing_value !== null && row.closing_value !== undefined && <div className="min-w-0 text-xs">
            <dt className="sr-only">{t('projectDetail.workOrders.closingValue', 'Closing value')}</dt>
            <dd data-testid={`wo-closing-${row.id}`} className="text-muted-foreground tabular-nums">
              {t('projectTabs:contractQuantities.workOrders.closing.closedAt', 'Closed at {{amount}} (excl. PPN)', {
                amount: formatCurrency(Number(row.closing_value), currency),
                interpolation: { escapeValue: false },
              })}
            </dd>
          </div>}
          {hasInvoiced && settlement?.invoiced !== null && settlement?.invoiced !== undefined && billingRow?.figuresComplete !== false && <MoneyFigure label={t('common:projectDetail.workOrders.billing.invoiced', 'Invoiced')} value={formatNumberWhole(settlement.invoiced)} detail={settlement.balancesKnown
            ? t('common:projectDetail.workOrders.billing.lineInvoiced', 'Invoiced {{invoiced}} · paid {{paid}}', { invoiced: formatNumberWhole(settlement.invoiced), paid: formatNumberWhole(settlement.paid) })
            : t('projectDetail.cascade.source.invoiced', 'Source: non-draft, non-cancelled invoice amounts.')} />}
          {hasInvoiced && settlement?.balancesKnown && billingRow?.figuresComplete !== false && <MoneyFigure label={t('common:projectDetail.workOrders.billing.paid', 'Paid')} value={formatNumberWhole(settlement.paid)} detail={t('projectDetail.cascade.source.paid', 'Source: invoice amount less the accounting balance outstanding.')} />}
          {hasInvoiced && settlement?.unpaid !== null && settlement?.unpaid !== undefined && billingRow?.figuresComplete !== false && <MoneyFigure label={t('projectDetail.cascade.unpaid', 'Unpaid')} value={formatNumberWhole(settlement.unpaid)} detail={t('projectDetail.cascade.source.invoiceUnpaid', 'Source: accounting balance outstanding for this invoice.')} destructive={settlement.unpaid > 0} />}
        </dl>}

        {orderFiguresMissing && <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role={invoicesRead.isError || billingRead.isError ? 'alert' : 'status'}>
          <span>{invoicesRead.isError || billingRead.isError
            ? billingRead.isError
              ? t('common:projectDetail.workOrders.billing.loadError', "Couldn't load billing for these work orders")
              : t('projectDetail.cascade.invoiceError', "Couldn't load invoice figures.")
            : invoicesRead.isPending || billingRead.isPending
              ? t('projectDetail.cascade.invoiceLoading', 'Invoice figures are loading.')
              : t('projectDetail.workOrders.billing.figuresIncomplete', 'Invoice figures are incomplete.')}</span>
          <button type="button" className="touch-target min-h-8 rounded-sm text-primary-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" aria-label={t('projectDetail.workOrders.billing.retryFigures', 'Retry invoice figures')} onClick={() => { void invoicesRead.refetch(); void billingRead.refetch(); }}>
            {t('common.retry', 'Retry')}
          </button>
        </p>}

        {canViewBilling && billingRow?.figuresComplete === false && <div className="text-xs text-muted-foreground" role="note">
          <p>{t('common:projectDetail.workOrders.billing.incompleteNote', 'An invoice on one of these work orders has no amount or is in another currency, so the totals cannot be added up.')}</p>
          {billingRow.problems && billingRow.problems.length > 0 && <ul className="mt-1 list-inside list-disc">
            {billingRow.problems.map((problem) => {
              const invoiceName = problem.number
                ? `${t('common:projectDetail.workOrders.billing.cause.anInvoice', 'An invoice')} ${problem.number}`
                : t('common:projectDetail.workOrders.billing.cause.anInvoice', 'An invoice');
              return <li key={problem.recordId}>{problem.cause === 'no-amount'
                ? t('common:projectDetail.workOrders.billing.cause.noAmount', '{{number}} has no amount', { number: invoiceName })
                : t('common:projectDetail.workOrders.billing.cause.otherCurrency', '{{number}} is in {{currency}}', { number: invoiceName, currency: problem.currency ?? '—' })}</li>;
            })}
          </ul>}
        </div>}

        {canViewBilling && orderOverdue > 0 && <Tooltip content={t('projectDetail.cascade.source.overdue', 'Sum of positive outstanding balances on invoices past their due date.')}>
          <span className="inline-flex w-fit cursor-help items-center gap-2 text-xs text-warning-foreground tabular-nums">
            <StatusPill variant="overdue">{t('projectDetail.cascade.overdue', 'Overdue')}</StatusPill>
            <strong>{formatNumberWhole(orderOverdue)}</strong>
          </span>
        </Tooltip>}
      </header>

      {pendingBast && <p className="mt-2 text-xs text-muted-foreground" role="status">
        {t('projectDetail.cascade.pendingAcceptance', 'Delivery awaiting confirmation')} · {pendingBast.acceptance_date} · {pendingBast.is_final
          ? t('projectTabs:contractQuantities.workOrders.acceptances.final', 'Final')
          : t('projectTabs:contractQuantities.workOrders.acceptances.stage', 'Stage')}
      </p>}

      {!orderLineFactsReady ? (
        lineReadsFailed
          ? <ListState variant="error" title={t('projectDetail.cascade.error', "Couldn't load the contract")} onRetry={retryLineReads} />
          : <ListState variant="loading" rows={3} />
      ) : hasOrderLines ? (
        <div className="mt-4" data-testid={`wo-lines-table-scroll-${row.id}`}>
          <DataTable<OrderLineView>
            rows={orderLineRows}
            columns={lineColumns}
            rowKey={(line) => line.key}
            rowLabel={(line) => t('projectDetail.cascade.openLine', 'Open {{item}} quantity history', { item: line.item?.description ?? line.allocation.boqItemId })}
            accessibleName={t('projectDetail.cascade.linesScroll', 'Contract quantities for {{wo}}', { wo: row.wo_number ?? row.title })}
            onActivate={openLineDrawer}
            embedded
            rowMenu={(line) => [
              { label: t('projectDetail.cascade.viewQuantityHistory', 'View quantity history'), onClick: () => openLineDrawer(line) },
              ...(canEditLines ? [{ label: t('projectTabs:contractQuantities.workOrders.contractLines.edit', 'Allocate contract lines'), onClick: () => setLinesFor(row) }] : []),
            ]}
            cardBelow={720}
            tableId={`project-detail-contract-order-${row.id}`}
          />
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">{t('projectDetail.cascade.moneyOnly', 'Money-only order')}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">{t('projectTabs:contractQuantities.workOrders.acceptances.heading', 'BAST state')}</span>
          {pendingBast ? <StatusPill variant="warn">{t('projectDetail.cascade.pendingAcceptance', 'Delivery awaiting confirmation')}</StatusPill>
            : latestConfirmedBast ? <StatusPill variant="won">{latestConfirmedBast.is_final
              ? t('projectTabs:contractQuantities.workOrders.acceptances.finalConfirmed', 'Final confirmed')
              : t('projectTabs:contractQuantities.workOrders.acceptances.confirmed', 'Confirmed')}</StatusPill>
              : <StatusPill variant="neutral">{t('projectDetail.cascade.noBast', 'No BAST yet')}</StatusPill>}
        </div>
        {canViewBilling && <div className="flex flex-wrap items-center gap-2" aria-label={t('projectDetail.cascade.invoiceStatusLabel', 'Invoice status')}>
          <span className="text-muted-foreground">{t('projectDetail.cascade.invoices', 'Invoices')}</span>
          {orderInvoices.length === 0 ? <span className="text-muted-foreground">—</span> : orderInvoices.map((invoice) => {
            const tone: StatusVariant = invoice.status === 'Paid' ? 'won'
              : invoice.status === 'Unpaid' || invoice.status === 'Submitted' ? 'warn'
                : invoice.status === 'Cancelled' ? 'lost' : 'neutral';
            return <Tooltip key={invoice.id} content={t('projectDetail.cascade.invoicePillSource', 'Source: invoice status mirrored from accounting.') }>
              <button type="button" className="touch-target rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" aria-label={t('projectDetail.cascade.openInvoice', 'Open invoice {{invoice}}', { invoice: invoice.si_number ?? invoice.status })} onClick={() => openInvoiceDrawer(invoice)}>
                <span className="mr-1 text-[11px] text-muted-foreground">{invoice.si_number ?? t('projectDetail.cascade.invoiceDraft', 'Invoice draft')}</span>
                <StatusPill variant={tone}>{invoice.status}</StatusPill>
              </button>
            </Tooltip>;
          })}
        </div>}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <WorkOrderCostVariations workOrderId={row.id} currency={currency} />
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {linesRead.isError && <ListState variant="error" title={t('projectTabs:contractQuantities.workOrders.contractLines.loadError', 'Couldn’t load the contract lines')} onRetry={() => void linesRead.refetch()} />}
        {acceptancesRead.isError && <ListState variant="error" title={t('projectTabs:contractQuantities.workOrders.acceptances.error', 'Couldn’t load the BASTs')} onRetry={() => void acceptancesRead.refetch()} />}
        {(hasOrderLines || bastList.length > 0 || canPrepare || row.status === 'Issued') && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              {t('projectTabs:contractQuantities.workOrders.quantities.summary', 'Contract lines and BAST: {{wo}}', { wo: row.wo_number ?? row.title })}
              <span className="ml-2">{t('projectTabs:contractQuantities.workOrders.quantities.counts', '{{lines}} lines · {{basts}} BAST', { lines: rawLines.length, basts: bastList.length })}</span>
            </summary>
            <div className="mt-3 flex flex-col gap-4">
              {orderLineFactsReady && !hasOrderLines && row.status === 'Issued' && <section aria-label={t('projectTabs:contractQuantities.workOrders.contractLines.heading', 'Contract lines')}>
                <p className="text-[13px] text-muted-foreground">{t('projectTabs:contractQuantities.workOrders.acceptances.form.noAllocations', 'Allocate contract lines to this work order first.')}</p>
                {canEditLines && <Button variant="outline" size="sm" className="mt-2" onClick={() => setLinesFor(row)}>
                  {t('projectTabs:contractQuantities.workOrders.contractLines.edit', 'Allocate contract lines')}
                </Button>}
              </section>}
              {hasOrderLines && <section aria-label={t('projectTabs:contractQuantities.workOrders.contractLines.heading', 'Contract lines')}>
                <h4 className="mb-1 text-xs font-semibold text-muted-foreground">{t('projectTabs:contractQuantities.workOrders.contractLines.heading', 'Contract lines')}</h4>
                <ul className="flex flex-col gap-0.5 text-xs" data-testid={`wo-lines-${row.id}`}>
                  {rawLines.map((line) => {
                    const item = boqRows.find((boqItem) => boqItem.id === line.boq_item_id);
                    return <li key={line.id} className="tabular">{item ? `${item.item_code} — ${item.description}` : line.boq_item_id} <span className="font-semibold">{formatNumberExact(Number(line.quantity))}{item ? ` ${item.unit}` : ''}</span></li>;
                  })}
                </ul>
                {canEditLines && <Button variant="ghost" size="sm" className="mt-1 px-0 text-xs text-muted-foreground" onClick={() => setLinesFor(row)}>{t('projectTabs:contractQuantities.workOrders.contractLines.edit', 'Edit lines')}</Button>}
              </section>}
              <section aria-label={t('projectTabs:contractQuantities.workOrders.acceptances.heading', 'Acceptances (BAST)')}>
                <h4 className="mb-1 text-xs font-semibold text-muted-foreground">{t('projectTabs:contractQuantities.workOrders.acceptances.heading', 'Acceptances (BAST)')}</h4>
                <WorkOrderAcceptances
                  workOrder={row}
                  boqItems={boqRows}
                  documents={documentRows}
                  acceptances={bastList}
                  state={acceptancesRead.isError ? 'error' : acceptancesRead.isPending ? 'loading' : 'ready'}
                  onRetry={() => void acceptancesRead.refetch()}
                  currentUserId={currentUserId ?? null}
                  projectManagerId={projectManagerId}
                  hasAllocations={rawLines.length > 0}
                  onPrepare={() => setBastFor({ row, draft: null })}
                  onEdit={(acceptance) => setBastFor({ row, draft: acceptance })}
                  onWithdraw={setWithdrawFor}
                  onConfirm={(acceptance) => setConfirmFor({ acceptance, error: null })}
                />
              </section>
            </div>
          </details>
        )}
      </div>
    </article>
  );
};

export default WorkOrderCustomerOrderCard;
