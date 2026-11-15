import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { CircleAlert, CircleCheck, CircleMinus } from 'lucide-react';
import { CardHead, CardPad, DataTable, Drawer, HelpPopover, ListState, StatusPill, Tooltip, type Column, type RowMenuItem } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useBoqItems, useProjectBilling } from '@/src/hooks/useProgressBilling';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useSalesInvoices } from '@/src/hooks/useRevenue';
import { useWorkOrderBilling } from '@/src/hooks/useWorkOrderBilling';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { clientInvoiceOverdueDays } from '@/src/lib/repositories/revenueDisplay';
import { formatNumberMax2, formatNumberWhole, formatTableMoney, formatTileMoney } from '@/src/lib/format';
import { moneyUnits, selectContractInvoiceFigure } from '@/src/lib/projectFinances';
import { outstandingIn, settlementFromFinanceBuckets, settlementIn, sumOutstanding } from '@/src/lib/invoiceSettlement';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import ProjectDrawdown from './ProjectDrawdown';

type InvoiceRowWithWorkOrder = SalesInvoiceRow & { work_order_id?: string | null };

interface UnorderedLine {
  key: string;
  item: import('@/src/lib/db/progressBilling').BoqItemRow;
  balance: number;
  allocations: import('@/src/lib/progressBilling').AllocationFacts[];
}

const qty = (n: number) => formatNumberMax2(n);

const BILLABILITY_STATE_ICONS = {
  done: { icon: CircleCheck, className: 'text-success-foreground' },
  'not-needed': { icon: CircleMinus, className: 'text-muted-foreground' },
  needed: { icon: CircleAlert, className: 'text-warning-foreground' },
} as const;

/** Contract value summary and the customer's ordered → delivered → invoiced reading layer. */
export const ContractCascade: React.FC<{ project: ProjectWithRefs; children?: React.ReactNode; contractTools?: React.ReactNode }> = ({ project, children, contractTools }) => {
  const tileMoney = (value: number) => formatTileMoney(value, project.currency) ?? String(value);
  const tableMoney = (value: number) => formatTableMoney(value, project.currency) ?? String(value);
  const { t } = useTranslation('project');
  const [searchParams, setSearchParams] = useSearchParams();
  const openRecordId = searchParams.get('open');
  const openRecordType = searchParams.get('openType');
  const may = usePermission();
  const { currentUser } = useAuth();
  const boq = useBoqItems(project.id);
  const billing = useProjectBilling(project.id);
  const orders = useProjectWorkOrders(project.id);
  const canViewMoney = may('view', 'salesInvoice');
  const projectFinances = useProjectFinances(project.id, { enabled: canViewMoney });
  const invoices = useSalesInvoices(project.id, { enabled: canViewMoney });
  const orderBilling = useWorkOrderBilling(project.id, canViewMoney);
  // #1457: the org's business day (not the viewer's device day) bounds every overdue figure.
  const orgDay = useFxOrgDay(canViewMoney).day;
  const isCascadePending = boq.isPending || billing.isPending || orders.isPending;
  const isCascadeError = !isCascadePending && (boq.isError || billing.isError || orders.isError || !billing.data);

  const items = boq.data ?? [];
  const facts = new Map((billing.data?.contractLines ?? []).map((line) => [line.boqItemId, line]));
  const allocations = (billing.data?.contractLines ?? []).flatMap((line) => line.allocations);
  const hasReadingLayer = items.length > 0;
  const rate = new Map(items.map((item) => [item.id, Number(item.rate)]));
  const contract = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.rate), 0);
  const ordered = allocations.reduce((sum, allocation) => sum + allocation.quantity * (rate.get(allocation.boqItemId) ?? 0), 0);
  const delivered = allocations.reduce((sum, allocation) => sum + (allocation.acceptedQuantity ?? 0) * (rate.get(allocation.boqItemId) ?? 0), 0);
  const notYetOrdered = items.reduce((sum, item) => sum + (facts.get(item.id)?.contractBalance ?? 0) * Number(item.rate), 0);
  const invoiceRows = (invoices.data ?? []) as InvoiceRowWithWorkOrder[];
  // #2204: Paid reads the server projection's per-currency bucket (gross basis); a second or other currency reads unknown.
  const settlementReading = settlementFromFinanceBuckets(projectFinances.data?.invoices);
  const settlement = settlementReading ? settlementIn(settlementReading, project.currency) : null;
  const contractInvoiceFigure = selectContractInvoiceFigure(projectFinances.data);
  // The Paid share is of the signed contract only when that contract is also stated including tax.
  const paidDenominator = project.tax_treatment === 'inclusive' ? moneyUnits(contractInvoiceFigure.denominator) : null;
  const paidPercentage = settlement?.settled != null && paidDenominator !== null && paidDenominator > 0n
    ? Math.max(0, Math.round(settlement.settled * 100 / (Number(paidDenominator) / 100)))
    : null;
  const showSummary = !isCascadePending && !isCascadeError && canViewMoney && (hasReadingLayer || (
    invoices.isPending || invoices.isError || invoiceRows.length > 0 || Number(project.contract_value) > 0
  ));
  const contractValue = hasReadingLayer
    ? contract
    : (billing.data?.contractNet ?? 0);
  const invoiceFiguresMissing = canViewMoney && (
    invoices.isPending || invoices.isError || (settlement !== null
      && !settlement.balancesKnown && invoiceRows.some((invoice) => invoice.status === 'Paid'))
  );
  const orderBillingRows = orderBilling.data ?? [];
  const lineCanInvoice = allocations.reduce((sum, allocation) => {
    const item = items.find((candidate) => candidate.id === allocation.boqItemId);
    if (!item || allocation.acceptedQuantity === null) return sum;
    return sum + Math.max(0, allocation.acceptedQuantity - allocation.claimedQuantity) * Number(item.rate);
  }, 0);
  const moneyOrderCanInvoice = orderBillingRows
    .filter((order) => order.lineCount === 0 && order.figuresComplete)
    .reduce((sum, order) => sum + Math.max(0, order.remaining), 0);
  const canInvoice = lineCanInvoice + moneyOrderCanInvoice;
  const customerOrders = orders.data ?? [];
  const issuedCustomerOrders = customerOrders.filter((order) => order.status === 'Issued' || order.status === 'Closed');
  const customerOrderRecorded = issuedCustomerOrders.length > 0;
  const hasContractLines = items.length > 0;
  const hasAllocatedLines = allocations.length > 0;
  const hasAcceptedQuantity = allocations.some((allocation) => allocation.acceptedQuantity !== null && allocation.acceptedQuantity > 0);
  const hasUnclaimedQuantity = allocations.some((allocation) => allocation.acceptedQuantity !== null && allocation.acceptedQuantity > allocation.claimedQuantity);
  const moneyOnlyOrders = orderBillingRows.filter((order) => order.lineCount === 0);
  const hasUnclaimedMoneyOrderValue = moneyOnlyOrders.some((order) => order.figuresComplete && order.remaining > 0);
  const incompleteMoneyOrder = moneyOnlyOrders.some((order) => !order.figuresComplete);
  const billableAmountUnavailable = orderBilling.isPending || orderBilling.isError || orderBilling.data == null || incompleteMoneyOrder;
  const billabilityDataReady = !isCascadePending && !isCascadeError && !billableAmountUnavailable;
  const draftOrder = customerOrders.find((order) => order.status === 'Draft');
  const orderStepAction = !customerOrderRecorded
    ? draftOrder
      ? may('transition', 'workOrder')
        ? { label: t('projectDetail.cascade.openDraftOrder', 'Open draft order'), to: `/projects/${encodeURIComponent(project.id)}/contract?wo=${encodeURIComponent(draftOrder.id)}` }
        : undefined
      : may('create', 'workOrder')
        ? { label: t('projectDetail.workOrders.action.addCustomerOrder', 'Add customer order'), to: `/projects/${encodeURIComponent(project.id)}/contract#add-customer-order` }
        : undefined
    : undefined;
  const allocationOrder = !hasAllocatedLines
    ? customerOrders.find((order) => may('create', 'workOrderLine', { record: { status: order.status } }))
    : undefined;
  const acceptanceOrder = !hasAcceptedQuantity
    ? customerOrders.find((order) => order.status === 'Issued'
      && allocations.some((allocation) => allocation.workOrderId === order.id)
      && may('create', 'workOrderAcceptance', {
        currentUserId: currentUser?.id,
        record: { status: order.status, project_manager_id: project.project_manager_id },
      }))
    : undefined;
  const billabilityReason = canInvoice > 0
    ? null
    : !customerOrderRecorded
      ? draftOrder
        ? t('projectDetail.cascade.reasonDraftOrder', 'The customer order is still a draft.')
        : null
      : hasContractLines && !hasAllocatedLines
        ? t('projectDetail.cascade.reasonNoAllocations', 'No contract lines are allocated.')
        : hasContractLines && !hasAcceptedQuantity
          ? t('projectDetail.cascade.reasonNoAcceptance', 'No accepted quantities.')
          : hasContractLines && !hasUnclaimedQuantity
            ? t('projectDetail.cascade.reasonAlreadyClaimed', 'Accepted quantities are already claimed.')
            : !hasContractLines && moneyOnlyOrders.length > 0 && moneyOnlyOrders.every((order) => order.figuresComplete && order.remaining <= 0)
              ? t('projectDetail.cascade.reasonMoneyOrdersClaimed', 'Customer order value is already invoiced.')
              : t('projectDetail.cascade.reasonComputedZero', 'The billable total is zero at current contract rates.');
  const billabilitySteps = [
    {
      id: 'order',
      label: t('projectDetail.cascade.stepOrder', 'Order'),
      state: customerOrderRecorded ? 'done' as const : 'needed' as const,
    },
    {
      id: 'allocation',
      label: t('projectDetail.cascade.stepAllocation', 'Lines'),
      state: !hasContractLines ? 'not-needed' as const : hasAllocatedLines ? 'done' as const : 'needed' as const,
      action: allocationOrder ? {
        label: t('projectTabs:contractQuantities.workOrders.contractLines.edit', 'Allocate contract lines'),
        to: `/projects/${encodeURIComponent(project.id)}/contract?wo=${encodeURIComponent(allocationOrder.id)}`,
      } : undefined,
    },
    {
      id: 'acceptance',
      label: t('projectDetail.cascade.stepAcceptance', 'Accepted'),
      state: !hasContractLines ? 'not-needed' as const : hasAcceptedQuantity ? 'done' as const : 'needed' as const,
      action: acceptanceOrder ? {
        label: t('projectDetail.cascade.recordAcceptedQuantity', 'Record accepted quantity'),
        to: `/projects/${encodeURIComponent(project.id)}/contract?wo=${encodeURIComponent(acceptanceOrder.id)}`,
      } : undefined,
    },
    {
      id: 'unclaimed',
      label: t('projectDetail.cascade.stepUnclaimed', 'Unclaimed'),
      state: hasUnclaimedQuantity || hasUnclaimedMoneyOrderValue ? 'done' as const : 'needed' as const,
      action: undefined,
    },
  ];
  // #1457: the one shared overdue rule (status + derived due date + org day) decides each row;
  // #2204: balances add up only within the project currency, otherwise the overdue figure is unknown.
  const overdueSum = sumOutstanding(invoiceRows.filter((invoice) => clientInvoiceOverdueDays(invoice, orgDay) !== null));
  const overdue = outstandingIn(overdueSum, project.currency);
  const overdueUnknown = overdueSum.denomination !== 'none' && overdue === null;
  const percent = (value: number | null) => contractValue > 0 && value !== null
    ? Math.max(0, Math.round(value / contractValue * 100))
    : null;
  const ofContract = (value: number | null) => value === null
    ? undefined
    : t('projectDetail.cascade.percentOfContract', '{{percent}}% of contract', { percent: value });
  // The bar's percent stays on the contract's own tax basis (calculated server-side); name it when it is not gross.
  const invoicedSupporting = contractInvoiceFigure.percentage === null
    ? undefined
    : project.tax_treatment === 'inclusive'
      ? ofContract(contractInvoiceFigure.percentage)
      : project.tax_treatment === 'exclusive'
        ? t('projectDetail.cascade.percentOfContractExcludingTax', '{{percent}}% of contract, excluding tax', { percent: contractInvoiceFigure.percentage })
        : undefined;
  const unorderedRows: UnorderedLine[] = items.flatMap((item) => {
    const balance = facts.get(item.id)?.contractBalance ?? 0;
    return balance > 0 ? [{ key: item.id, item, balance, allocations: facts.get(item.id)?.allocations ?? [] }] : [];
  });
  const selectedUnorderedLine = openRecordType === 'contractBoq'
    ? unorderedRows.find((line) => line.key === openRecordId) ?? null
    : null;
  const openBoqLine = (line: UnorderedLine) => {
    const next = new URLSearchParams(searchParams);
    next.set('open', line.key);
    next.set('openType', 'contractBoq');
    setSearchParams(next);
  };
  const closeUnorderedLine = (id: string) => {
    if (openRecordId !== id || openRecordType !== 'contractBoq') return;
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    next.delete('openType');
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="flex min-w-0 flex-col gap-[var(--space-panel-gap)]">
      {isCascadePending && (
        <section aria-label={t('projectDetail.cascade.title', 'Contract')} className="min-w-0">
          <ListState variant="loading" rows={6} />
        </section>
      )}
      {/* Preserve the tools subtree while the summary siblings are inserted as cascade reads settle. */}
      {(isCascadeError || showSummary || contractTools) && (
        <section
          key="contract-summary-tools"
          aria-labelledby={showSummary ? 'pd-cascade' : undefined}
          className="panel-card min-w-0"
        >
          {showSummary && <CardHead
            key="contract-summary-heading"
            id="pd-cascade"
            subline={`${project.currency} · ${t('projectDetail.cascade.taxBasisSubline', 'Invoiced and paid include tax')}`}
            // The heading stays plain text (its accessible name is the title alone); the percentage
            // basis sits behind the card's one help affordance instead of wrapping the title word.
            actions={
              <HelpPopover subject={t('projectDetail.cascade.title', 'Contract')}>
                {t('projectDetail.cascade.percentOfContractSource', 'Computed as this stage value divided by the contract value.')}
              </HelpPopover>
            }
          >
            {t('projectDetail.cascade.title', 'Contract')}
          </CardHead>}
          <CardPad key="contract-summary-body" className={showSummary ? 'pt-0' : undefined}>
          {isCascadeError && <ListState variant="error" title={t('projectDetail.cascade.error', "Couldn't load the contract")} onRetry={() => { void boq.refetch(); void billing.refetch(); void orders.refetch(); }} />}
          {showSummary && <React.Fragment key="contract-summary-content">
          <ol className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-5" aria-label={t('projectDetail.cascade.title', 'Contract')}>
            <MoneyStep label={t('projectDetail.cascade.contract', 'Contract value')} value={tileMoney(contractValue)} detail={hasReadingLayer ? t('projectDetail.cascade.source.contract', 'Source: priced contract lines (quantity × rate), excluding tax.') : t('projectDetail.cascade.source.contractFallback', 'Source: the project billing summary, excluding tax.')} />
            {hasReadingLayer && <>
              <MoneyStep label={t('projectDetail.cascade.ordered', 'Ordered')} value={tileMoney(ordered)} supporting={ofContract(percent(ordered))} detail={t('projectDetail.cascade.source.ordered', 'Source: contract allocation quantities × contract rates.')} />
              <MoneyStep label={t('projectDetail.cascade.delivered', 'Delivered')} value={tileMoney(delivered)} supporting={ofContract(percent(delivered))} detail={t('projectDetail.cascade.source.delivered', 'Source: quantities accepted on confirmed BASTs × contract rates.')} />
            </>}
            {canViewMoney && !projectFinances.isPending && <MoneyStep
              label={t('projectDetail.cascade.invoiced', 'Invoiced')}
              value={settlement?.gross == null ? '—' : tileMoney(settlement.gross)}
              supporting={invoicedSupporting}
              detail={t('projectDetail.cascade.source.invoiced', 'Invoices including tax, in the project currency: the same basis as Paid. The percentage is the signed-contract billing share, on the contract basis named beside it.')}
            />}
            {canViewMoney && settlementReading !== null && !projectFinances.isPending && (settlement === null || settlement.balancesKnown) && <>
              {settlement?.settled == null
                ? <MoneyStep label={t('projectDetail.cascade.paid', 'Paid')} value="—" detail={t('projectDetail.cascade.source.paidUnknown', 'Unknown: an invoice is in another currency, or its amount or tax basis is missing, so settlement is not added up.')} />
                : <MoneyStep label={t('projectDetail.cascade.paid', 'Paid')} value={tileMoney(settlement.settled)} supporting={ofContract(paidPercentage)}
                  detail={t('projectDetail.cascade.source.paid', 'Source: invoice amount including tax, less the accounting balance outstanding.')} />}
            </>}
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {billableAmountUnavailable ? (
              <span className="text-sm text-muted-foreground" role={orderBilling.isError ? 'alert' : 'status'}>
                {orderBilling.isError
                  ? t('projectDetail.cascade.orderBillingError', "Couldn't load the billable amount.")
                  : incompleteMoneyOrder
                    ? t('projectDetail.cascade.orderBillingIncomplete', 'Can invoice is unavailable until the order value is complete.')
                    : t('projectDetail.cascade.orderBillingLoading', 'Can invoice is loading.')}
              </span>
            ) : <Tooltip content={t('projectDetail.cascade.source.canInvoice', 'Accepted quantity not yet claimed, priced at contract rates, plus remaining value on money-only orders.')}>
              <span className="inline-flex cursor-help items-center gap-2 tabular-nums">
                <span className="text-muted-foreground">{t('projectDetail.cascade.canInvoice', 'Can invoice')}</span>
                <strong className="font-semibold text-foreground">{tableMoney(canInvoice)}</strong>
              </span>
            </Tooltip>}
            {((overdue ?? 0) > 0 || overdueUnknown) && <Tooltip content={overdueUnknown
              ? t('projectDetail.cascade.source.overdueUnknown', 'Unknown: overdue invoices are in more than one currency, so their balances are not added up.')
              : t('projectDetail.cascade.source.overdue', 'Sum of positive outstanding balances on invoices past their due date.')}>
              <span data-testid="contract-overdue" className="inline-flex cursor-help items-center gap-2 text-warning-foreground tabular-nums">
                <StatusPill variant="overdue">{t('projectDetail.cascade.overdue', 'Overdue')}</StatusPill>
                <strong className="font-semibold">{overdue === null ? '—' : tableMoney(overdue)}</strong>
              </span>
            </Tooltip>}
          </div>
          {(hasReadingLayer || Boolean(billing.data && billing.data.dpBilled > 0)) && <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums text-muted-foreground">
            {hasReadingLayer && <Tooltip content={t('projectDetail.cascade.source.notOrderedValue', 'Source: unallocated contract quantity multiplied by its contract rate.') }><span className="cursor-help">{t('projectDetail.cascade.notOrdered', 'Not yet ordered')} <strong className="font-semibold text-foreground">{tableMoney(notYetOrdered)}</strong></span></Tooltip>}
            {Boolean(billing.data && billing.data.dpBilled > 0) && <Tooltip content={t('projectDetail.cascade.source.downPayment', 'Source: project billing totals for down payment billed and recovered.') }><span className="cursor-help">· {t('projectDetail.cascade.downPaymentSummary', 'Down payment {{billed}} · recovered {{recovered}}', {
              billed: tableMoney(billing.data!.dpBilled),
              recovered: tableMoney(billing.data!.dpRecovered),
              interpolation: { escapeValue: false },
            })}</span></Tooltip>}
          </p>}
          {billabilityDataReady && canViewMoney && (
            <section className="mt-4 border-t border-border pt-4" aria-labelledby="pd-before-bill">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <h3 id="pd-before-bill" className="text-base font-semibold text-foreground">
                  {t('projectDetail.cascade.beforeBill', 'Billing')}
                </h3>
                {orderStepAction && (
                  <Link className="touch-target ml-auto inline-flex min-h-11 items-center rounded-sm font-medium text-primary-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" to={orderStepAction.to}>
                    {orderStepAction.label}
                  </Link>
                )}
              </div>
              {canInvoice === 0 && billabilityReason && (
                <p role="status" className="mt-2 text-control text-muted-foreground" data-testid="billability-reason">
                  {billabilityReason}
                </p>
              )}
              <ol aria-label={t('projectDetail.cascade.billingSteps', 'Billing steps')} className="mt-3 space-y-2">
                {billabilitySteps.map((step) => (
                  <li key={step.id} aria-label={step.label} data-testid={`billability-step-${step.id}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-control">
                    {!step.action && <span className="min-w-0 font-medium text-foreground">{step.label}</span>}
                    {(() => {
                      const { icon: StateIcon, className } = BILLABILITY_STATE_ICONS[step.state];
                      const stateLabel = step.state === 'done'
                        ? t('projectDetail.cascade.done', 'Done')
                        : step.state === 'not-needed'
                          ? t('projectDetail.cascade.notNeeded', 'None')
                          : t('projectDetail.cascade.needed', 'Missing');
                      return (
                        <span className={`ml-auto inline-flex shrink-0 items-center gap-1.5 ${className}`}>
                          <StateIcon aria-hidden="true" className="size-4" />
                          <span>{stateLabel}</span>
                        </span>
                      );
                    })()}
                    {step.action && (
                      <Link className="touch-target inline-flex min-h-11 items-center rounded-sm font-medium text-primary-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" to={step.action.to}>
                        {step.action.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {invoiceFiguresMissing && !children && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role={invoices.isError ? 'alert' : 'status'}>
              <span>{invoices.isError
                ? t('projectDetail.cascade.invoiceError', "Couldn't load invoice figures.")
                : invoices.isPending
                  ? t('projectDetail.cascade.invoiceLoading', 'Invoice figures are loading.')
                  : t('projectDetail.cascade.partialPaymentNote', 'Paid and unpaid amounts will appear once the accounting system reports an invoice balance.')}</span>
              {invoices.isError && <button type="button" className="touch-target min-h-8 rounded-sm text-primary-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => void invoices.refetch()}>
                {t('common.retry', 'Retry')}
              </button>}
            </p>
          )}
          </React.Fragment>}
          {contractTools && <div key="contract-tools" className={showSummary ? 'mt-4' : undefined}>{contractTools}</div>}
          </CardPad>
        </section>
      )}

      {canViewMoney && !isCascadeError && <ProjectDrawdown key={project.id} projectId={project.id} />}

      {!isCascadeError && children}

      {!isCascadeError && hasReadingLayer && unorderedRows.length > 0 && (() => {
        const columns: Column<UnorderedLine>[] = [
          { key: 'item', header: t('projectDetail.cascade.colItem', 'Item'), kind: 'primary', rowHeader: true,
            cell: (line) => <span>{line.item.item_code && <span className="mr-2 text-sm text-muted-foreground">{line.item.item_code}</span>}{line.item.description}</span>,
            secondaryCell: (line) => line.item.unit },
          { key: 'contract', header: t('projectDetail.cascade.colContract', 'Contract'), align: 'num', kind: 'number',
            cell: (line) => <Tooltip content={t('projectDetail.cascade.source.contractQuantity', 'Source: priced contract line quantity.') }><span className="cursor-help tabular-nums">{qty(Number(line.item.quantity))} {line.item.unit}</span></Tooltip>,
            exportValue: (line) => Number(line.item.quantity) },
          { key: 'ordered', header: t('projectDetail.cascade.colOrdered', 'Ordered'), align: 'num', kind: 'number',
            cell: (line) => <Tooltip content={t('projectDetail.cascade.source.customerOrderQuantities', 'Source: quantities allocated to customer orders.') }><span className="cursor-help tabular-nums">{qty(Number(line.item.quantity) - line.balance)} {line.item.unit}</span></Tooltip>,
            exportValue: (line) => Number(line.item.quantity) - line.balance },
          { key: 'left', header: t('projectDetail.cascade.colLeft', 'Remaining'), align: 'num', kind: 'number',
            cell: (line) => <Tooltip content={t('projectDetail.cascade.source.leftToOrder', 'Contract quantity less quantities already allocated to customer orders.') }><span data-testid={`contract-balance-${line.item.id}`} className="cursor-help tabular-nums font-semibold">{qty(line.balance)} {line.item.unit}</span></Tooltip>,
            exportValue: (line) => line.balance },
          ...(canViewMoney ? [{ key: 'value', header: t('projectDetail.cascade.colValue', 'Value'), align: 'num' as const, kind: 'money' as const,
            cell: (line: UnorderedLine) => <Tooltip content={t('projectDetail.cascade.unorderedValueFormula', 'Unordered contract quantity multiplied by its contract rate.') }><span className="cursor-help tabular-nums">{formatNumberWhole(line.balance * Number(line.item.rate))}</span></Tooltip>,
            exportValue: (line: UnorderedLine) => line.balance * Number(line.item.rate) }] : []),
        ];
        const menu = (line: UnorderedLine): RowMenuItem[] => [
          { label: t('projectDetail.cascade.viewQuantityHistory', 'View quantity history'), onClick: () => openBoqLine(line) },
        ];
        return (
          <section aria-labelledby="pd-not-ordered" className="panel-card min-w-0">
            <CardHead level={3} id="pd-not-ordered">{t('projectDetail.cascade.notOrderedTitle', 'Not yet ordered')}</CardHead>
            <CardPad className="pt-0">
            <DataTable<UnorderedLine>
              embedded
              rows={unorderedRows}
              columns={columns}
              rowKey={(line) => line.key}
              rowLabel={(line) => t('projectDetail.cascade.openUnorderedLine', 'Open {{item}} quantity history', { item: line.item.description })}
              accessibleName={t('projectDetail.cascade.notOrderedTitle', 'Not yet ordered')}
              onActivate={openBoqLine}
              rowMenu={menu}
              cardBelow={720}
              tableId="project-detail-not-yet-ordered"
            />
            </CardPad>
          </section>
        );
      })()}

      {!isCascadeError && selectedUnorderedLine && <Drawer open title={selectedUnorderedLine.item.description}
        subtitle={`${selectedUnorderedLine.item.item_code} · ${selectedUnorderedLine.item.unit}`}
        status={<StatusPill variant="neutral">{t('projectDetail.billing.boq.lineStatus', 'Contract line')}</StatusPill>}
        onClose={() => closeUnorderedLine(selectedUnorderedLine.key)}
        headerActions={<Link className="inline-flex min-h-10 items-center text-sm font-medium text-primary-text underline underline-offset-2" to={`/projects/${encodeURIComponent(project.id)}/billing`} onClick={() => closeUnorderedLine(selectedUnorderedLine.key)}>{t('projectDetail.drawer.openFullPage', 'Open full page')}</Link>}>
        <div className="flex flex-col gap-5 p-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <UnorderedFigure label={t('projectDetail.cascade.colContract', 'Contract')} value={`${qty(Number(selectedUnorderedLine.item.quantity))} ${selectedUnorderedLine.item.unit}`} detail={t('projectDetail.cascade.source.contractQuantity', 'Source: priced contract line quantity.')} />
            <UnorderedFigure label={t('projectDetail.cascade.colOrdered', 'Ordered')} value={`${qty(Number(selectedUnorderedLine.item.quantity) - selectedUnorderedLine.balance)} ${selectedUnorderedLine.item.unit}`} detail={t('projectDetail.cascade.source.customerOrderQuantities', 'Source: quantities allocated to customer orders.')} />
            <UnorderedFigure label={t('projectDetail.cascade.colLeft', 'Remaining')} value={`${qty(selectedUnorderedLine.balance)} ${selectedUnorderedLine.item.unit}`} detail={t('projectDetail.cascade.source.leftToOrder', 'Contract quantity less quantities already allocated to customer orders.')} />
            {canViewMoney && <UnorderedFigure label={t('projectDetail.cascade.colValue', 'Value')} value={`${project.currency} ${formatNumberWhole(selectedUnorderedLine.balance * Number(selectedUnorderedLine.item.rate))}`} detail={t('projectDetail.cascade.unorderedValueFormula', 'Unordered contract quantity multiplied by its contract rate.')} />}
          </dl>
          <section aria-labelledby="unordered-line-history">
            <h3 id="unordered-line-history" className="mb-2 text-sm font-semibold">{t('projectDetail.cascade.quantityHistory', 'Quantity history')}</h3>
            {selectedUnorderedLine.allocations.length === 0 ? <p className="text-sm text-muted-foreground">{t('projectDetail.cascade.noQuantityHistory', 'No customer order quantities yet.')}</p> : <ul className="divide-y divide-border text-sm">
              {selectedUnorderedLine.allocations.map((allocation) => {
                const order = orders.data?.find((candidate) => candidate.id === allocation.workOrderId);
                return <li key={allocation.workOrderId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{order?.wo_number ?? order?.title ?? allocation.workOrderId}</span>
                  <Tooltip content={t('projectDetail.cascade.source.lineOrdered', 'Source: quantity allocated to this work order.')}><span className="cursor-help tabular-nums">{qty(allocation.quantity)} {selectedUnorderedLine.item.unit}</span></Tooltip>
                </li>;
              })}
            </ul>}
          </section>
        </div>
      </Drawer>}

    </div>
  );
};

const MoneyStep: React.FC<{ label: string; value: string; supporting?: string; detail: string }> = ({ label, value, supporting, detail }) => (
  <li aria-label={`${label} ${value}${supporting ? ` ${supporting}` : ''}`} className="min-w-0 border-l border-border pl-3 first:border-l-0 first:pl-0">
    <Tooltip content={detail}>
      <span className="block w-fit cursor-help text-sm text-muted-foreground">{label}</span>
    </Tooltip>
    <Tooltip content={detail}><span className="mt-1 block w-fit cursor-help text-lg font-semibold tabular-nums leading-tight text-foreground">{value}</span></Tooltip>
    {supporting && <span className="mt-1 block text-sm text-muted-foreground">{supporting}</span>}
  </li>
);

const UnorderedFigure: React.FC<{ label: string; value: string; detail: string }> = ({ label, value, detail }) => (
  <div><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 w-fit cursor-help font-semibold tabular-nums"><Tooltip content={detail}><span>{value}</span></Tooltip></dd></div>
);

