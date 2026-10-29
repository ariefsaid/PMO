import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { DataTable, Drawer, ListState, ProgressBar, StatusPill, TaxBasisLabel, Tooltip, type Column, type RowMenuItem } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useBoqItems, useProjectBilling } from '@/src/hooks/useProgressBilling';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useSalesInvoices } from '@/src/hooks/useRevenue';
import { useWorkOrderBilling } from '@/src/hooks/useWorkOrderBilling';
import { formatNumberMax2, formatNumberWhole } from '@/src/lib/format';
import { isTaxTreatment } from '@/src/lib/taxTreatment';
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

export interface InvoiceSettlementInput {
  status: string;
  amount: number | null;
  erp_outstanding_amount: number | null;
}

export interface InvoiceSettlementSummary {
  invoiced: number | null;
  paid: number;
  unpaid: number | null;
  balancesKnown: boolean;
}

/** Submitted invoices settle from ERP balances; unknown balances contribute only fully Paid invoices. */
// eslint-disable-next-line react-refresh/only-export-components -- shared money summary is used by WorkOrdersTab.
export function summarizeInvoiceSettlement(invoices: readonly InvoiceSettlementInput[]): InvoiceSettlementSummary {
  const submitted = invoices.filter((invoice) => invoice.status !== 'Draft' && invoice.status !== 'Cancelled');
  const cents = (value: number | null): number | null => value !== null && Number.isFinite(value) ? Math.round(value * 100) : null;
  const amounts = submitted.map((invoice) => cents(invoice.amount));
  const balances = submitted.map((invoice) => cents(invoice.erp_outstanding_amount));
  const balancesKnown = amounts.every((value) => value !== null) && balances.every((value) => value !== null);
  const invoiced = amounts.every((value) => value !== null)
    ? amounts.reduce<number>((sum, value) => sum + (value ?? 0), 0) / 100
    : null;
  const paidCents = balancesKnown
    ? submitted.reduce((sum, invoice) => sum + (cents(invoice.amount) ?? 0) - (cents(invoice.erp_outstanding_amount) ?? 0), 0)
    : submitted.reduce((sum, invoice) => invoice.status === 'Paid' ? sum + (cents(invoice.amount) ?? 0) : sum, 0);
  const unpaid = balancesKnown ? balances.reduce<number>((sum, value) => sum + (value ?? 0), 0) / 100 : null;
  return { invoiced, paid: paidCents / 100, unpaid, balancesKnown };
}

const qty = (n: number) => formatNumberMax2(n);

/** Contract value summary and the customer's ordered → delivered → invoiced reading layer. */
export const ContractCascade: React.FC<{ project: ProjectWithRefs; children?: React.ReactNode }> = ({ project, children }) => {
  const { t } = useTranslation('project');
  const [searchParams, setSearchParams] = useSearchParams();
  const openRecordId = searchParams.get('open');
  const openRecordType = searchParams.get('openType');
  const may = usePermission();
  const boq = useBoqItems(project.id);
  const billing = useProjectBilling(project.id);
  const orders = useProjectWorkOrders(project.id);
  const canViewMoney = may('view', 'salesInvoice');
  const invoices = useSalesInvoices(project.id, { enabled: canViewMoney });
  const orderBilling = useWorkOrderBilling(project.id, canViewMoney);
  const isCascadePending = boq.isPending || billing.isPending || orders.isPending;
  const isCascadeError = boq.isError || billing.isError || orders.isError || (!isCascadePending && !billing.data);

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
  const settlement = summarizeInvoiceSettlement(invoiceRows);
  const showSummary = !isCascadePending && !isCascadeError && canViewMoney && (hasReadingLayer || (
    invoices.isPending || invoices.isError || invoiceRows.length > 0 || Number(project.contract_value) > 0
  ));
  const contractValue = hasReadingLayer
    ? contract
    : (billing.data?.contractNet ?? 0);
  const invoiceFiguresMissing = canViewMoney && (
    invoices.isPending || invoices.isError || settlement.invoiced === null || (!settlement.balancesKnown && invoiceRows.some((invoice) => invoice.status === 'Paid'))
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
  const currentDate = new Date();
  const today = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
  const overdue = invoiceRows.reduce((sum, invoice) => {
    if (!invoice.erp_due_date || invoice.erp_due_date >= today || invoice.status === 'Draft' || invoice.status === 'Cancelled') return sum;
    const balance = invoice.status === 'Paid' ? 0 : invoice.erp_outstanding_amount;
    return balance === null ? sum : sum + Math.max(0, balance);
  }, 0);
  const percent = (value: number | null) => contractValue > 0 && value !== null
    ? Math.max(0, Math.round(value / contractValue * 100))
    : null;
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

  if (!isCascadePending && isCascadeError) {
    return <ListState variant="error" title={t('projectDetail.cascade.error', "Couldn't load the contract")} onRetry={() => { void boq.refetch(); void billing.refetch(); void orders.refetch(); }} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {isCascadePending && (
        <section aria-label={t('projectDetail.cascade.title', 'Contract')} className="min-w-0">
          <ListState variant="loading" rows={6} />
        </section>
      )}
      {!isCascadePending && !isCascadeError && showSummary && (
        <section aria-labelledby="pd-cascade" className="min-w-0">
          <div className="mb-4 flex flex-wrap items-baseline gap-x-2">
            <h2 id="pd-cascade" className="text-sm font-semibold text-foreground">{t('projectDetail.cascade.title', 'Contract')}</h2>
            <span className="text-xs text-muted-foreground">{project.currency}
              {isTaxTreatment(project.tax_treatment) && <> · <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} className="inline text-xs text-muted-foreground" /></>}
            </span>
          </div>
          <ol className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-5" aria-label={t('projectDetail.cascade.title', 'Contract')}>
            <MoneyStep label={t('projectDetail.cascade.contract', 'Contract')} value={formatNumberWhole(contractValue)} percentage={contractValue > 0 ? 100 : null} detail={hasReadingLayer ? t('projectDetail.cascade.source.contract', 'Source: priced contract lines (quantity × rate), excluding tax.') : t('projectDetail.cascade.source.contractFallback', 'Source: the project billing summary, excluding tax.')} />
            {hasReadingLayer && <>
              <MoneyStep label={t('projectDetail.cascade.ordered', 'Ordered')} value={formatNumberWhole(ordered)} percentage={percent(ordered)} detail={t('projectDetail.cascade.source.ordered', 'Source: contract allocation quantities × contract rates.')} />
              <MoneyStep label={t('projectDetail.cascade.delivered', 'Delivered')} value={formatNumberWhole(delivered)} percentage={percent(delivered)} detail={t('projectDetail.cascade.source.delivered', 'Source: quantities accepted on confirmed BASTs × contract rates.')} />
            </>}
            {canViewMoney && settlement.invoiced !== null && !invoices.isPending && !invoices.isError && <>
              <MoneyStep label={t('projectDetail.cascade.invoiced', 'Invoiced')} value={formatNumberWhole(settlement.invoiced)} percentage={percent(settlement.invoiced)} detail={t('projectDetail.cascade.source.invoiced', 'Source: non-draft, non-cancelled invoice amounts.')} />
            </>}
            {canViewMoney && settlement.balancesKnown && !invoices.isPending && !invoices.isError && <>
              <MoneyStep label={t('projectDetail.cascade.paid', 'Paid')} value={formatNumberWhole(settlement.paid)} percentage={percent(settlement.paid)} detail={t('projectDetail.cascade.source.paid', 'Source: invoice amount less the accounting balance outstanding.')} />
            </>}
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {(orderBilling.isError || orderBilling.isPending) ? (
              <span className="text-xs text-muted-foreground" role={orderBilling.isError ? 'alert' : 'status'}>
                {orderBilling.isError ? t('projectDetail.cascade.orderBillingError', 'Can invoice is unavailable while work-order billing is loading.') : t('projectDetail.cascade.orderBillingLoading', 'Can invoice is loading.')}
              </span>
            ) : <Tooltip content={t('projectDetail.cascade.source.canInvoice', 'Delivered quantity not yet invoiced, priced at contract rates, plus remaining value on money-only orders.')}>
              <span className="inline-flex cursor-help items-center gap-2 tabular-nums">
                <span className="text-muted-foreground">{t('projectDetail.cascade.canInvoice', 'Can invoice')}</span>
                <strong className="font-semibold text-foreground">{formatNumberWhole(canInvoice)}</strong>
              </span>
            </Tooltip>}
            {overdue > 0 && <Tooltip content={t('projectDetail.cascade.source.overdue', 'Sum of positive outstanding balances on invoices past their ERP due date.')}>
              <span className="inline-flex cursor-help items-center gap-2 text-warning-foreground tabular-nums">
                <StatusPill variant="overdue">{t('projectDetail.cascade.overdue', 'Overdue')}</StatusPill>
                <strong className="font-semibold">{formatNumberWhole(overdue)}</strong>
              </span>
            </Tooltip>}
          </div>
          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
            {hasReadingLayer && <Tooltip content={t('projectDetail.cascade.source.notOrderedValue', 'Source: unallocated contract quantity multiplied by its contract rate.') }><span className="cursor-help">{t('projectDetail.cascade.notOrdered', 'Not yet ordered')} <strong className="font-semibold text-foreground">{formatNumberWhole(notYetOrdered)}</strong></span></Tooltip>}
            {Boolean(billing.data && billing.data.dpBilled > 0) && <Tooltip content={t('projectDetail.cascade.source.downPayment', 'Source: project billing totals for down payment billed and recovered.') }><span className="cursor-help">· {t('projectDetail.cascade.downPaymentSummary', 'Down payment {{billed}} · recovered {{recovered}}', {
              billed: formatNumberWhole(billing.data!.dpBilled),
              recovered: formatNumberWhole(billing.data!.dpRecovered),
              interpolation: { escapeValue: false },
            })}</span></Tooltip>}
          </p>
          {invoiceFiguresMissing && !children && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" role={invoices.isError ? 'alert' : 'status'}>
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
        </section>
      )}

      {canViewMoney && <ProjectDrawdown key={project.id} projectId={project.id} />}

      {children}

      {hasReadingLayer && unorderedRows.length > 0 && (() => {
        const columns: Column<UnorderedLine>[] = [
          { key: 'item', header: t('projectDetail.cascade.colItem', 'Item'), kind: 'primary', rowHeader: true,
            cell: (line) => <span>{line.item.item_code && <span className="mr-2 text-xs text-muted-foreground">{line.item.item_code}</span>}{line.item.description}</span>,
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
          <section aria-labelledby="pd-not-ordered" className="min-w-0">
            <h3 id="pd-not-ordered" className="mb-3 text-sm font-semibold text-foreground">{t('projectDetail.cascade.notOrderedTitle', 'Not yet ordered')}</h3>
            <DataTable<UnorderedLine>
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
          </section>
        );
      })()}

      {selectedUnorderedLine && <Drawer open title={selectedUnorderedLine.item.description}
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
            {selectedUnorderedLine.allocations.length === 0 ? <p className="text-sm text-muted-foreground">{t('projectDetail.cascade.noQuantityHistory', 'No customer order quantities yet.')}</p> : <ul className="divide-y divide-border border-y border-border text-sm">
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

const MoneyStep: React.FC<{ label: string; value: string; percentage: number | null; detail: string }> = ({ label, value, percentage, detail }) => {
  const { t } = useTranslation('project');
  return (
    <li className="min-w-0 border-l border-border pl-3 first:border-l-0 first:pl-0">
      <div className="block">
        <Tooltip content={detail}>
          <span className="block w-fit cursor-help text-xs text-muted-foreground">{label}</span>
        </Tooltip>
      </div>
      <div className="mt-1 block">
        <Tooltip content={detail}><span className="block w-fit cursor-help text-lg font-semibold tabular-nums leading-tight text-foreground">{value}</span></Tooltip>
      </div>
      {percentage !== null && <Tooltip content={t('projectDetail.cascade.percentOfContractSource', 'Computed as this stage value divided by the contract value.') }>
        <span className="mt-2 block w-full max-w-36 cursor-help"><ProgressBar value={percentage} showValue compact aria-label={label} tone={percentage > 100 ? 'destructive' : 'neutral'} /></span>
      </Tooltip>}
      {percentage === null && <span className="mt-2 block text-xs text-muted-foreground">—</span>}
    </li>
  );
};

const UnorderedFigure: React.FC<{ label: string; value: string; detail: string }> = ({ label, value, detail }) => (
  <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 w-fit cursor-help font-semibold tabular-nums"><Tooltip content={detail}><span>{value}</span></Tooltip></dd></div>
);

