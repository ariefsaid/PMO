import React from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, ListState, TaxBasisLabel } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import { usePermission } from '@/src/auth/usePermission';
import { useBoqItems, useProjectBilling } from '@/src/hooks/useProgressBilling';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useSalesInvoices } from '@/src/hooks/useRevenue';
import { formatCurrency, formatNumberMax2 } from '@/src/lib/format';
import { isTaxTreatment } from '@/src/lib/taxTreatment';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

type InvoiceRowWithWorkOrder = SalesInvoiceRow & { work_order_id?: string | null };

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
  const { t } = useTranslation();
  const may = usePermission();
  const boq = useBoqItems(project.id);
  const billing = useProjectBilling(project.id);
  const orders = useProjectWorkOrders(project.id);
  const canViewMoney = may('view', 'salesInvoice');
  const invoices = useSalesInvoices(project.id, { enabled: canViewMoney });

  if (boq.isPending || billing.isPending || orders.isPending) return <ListState variant="loading" rows={6} />;
  if (boq.isError || billing.isError || orders.isError || !billing.data) {
    return <ListState variant="error" title={t('projectDetail.cascade.error', "Couldn't load the contract")} onRetry={() => { void boq.refetch(); void billing.refetch(); void orders.refetch(); }} />;
  }

  const items = boq.data ?? [];
  const facts = new Map(billing.data.contractLines.map((line) => [line.boqItemId, line]));
  const allocations = billing.data.contractLines.flatMap((line) => line.allocations);
  const hasReadingLayer = items.length > 0;
  const rate = new Map(items.map((item) => [item.id, Number(item.rate)]));
  const contract = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.rate), 0);
  const ordered = allocations.reduce((sum, allocation) => sum + allocation.quantity * (rate.get(allocation.boqItemId) ?? 0), 0);
  const delivered = allocations.reduce((sum, allocation) => sum + (allocation.acceptedQuantity ?? 0) * (rate.get(allocation.boqItemId) ?? 0), 0);
  const notYetOrdered = items.reduce((sum, item) => sum + (facts.get(item.id)?.contractBalance ?? 0) * Number(item.rate), 0);
  const invoiceRows = (invoices.data ?? []) as InvoiceRowWithWorkOrder[];
  const settlement = summarizeInvoiceSettlement(invoiceRows);

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {hasReadingLayer && (
        <section aria-labelledby="pd-cascade" className="min-w-0">
          <div className="mb-4 flex flex-wrap items-baseline gap-x-2">
            <h2 id="pd-cascade" className="text-sm font-semibold text-foreground">{t('projectDetail.cascade.title', 'Contract')}</h2>
            <span className="text-xs text-muted-foreground">{project.currency}
              {isTaxTreatment(project.tax_treatment) && <> · <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} className="inline text-xs text-muted-foreground" /></>}
            </span>
          </div>
          <dl className="flex flex-wrap items-start gap-x-5 gap-y-3">
            <MoneyStep label={t('projectDetail.cascade.contract', 'Contract')} value={formatCurrency(contract, project.currency)} />
            <Arrow />
            <MoneyStep label={t('projectDetail.cascade.ordered', 'Ordered')} value={formatCurrency(ordered, project.currency)} />
            <Arrow />
            <MoneyStep label={t('projectDetail.cascade.delivered', 'Delivered')} value={formatCurrency(delivered, project.currency)} />
            {canViewMoney && <>
              <Arrow />
              {invoices.isPending ? <ListState variant="loading" rows={1} className="w-24 p-0" /> : invoices.isError
                ? <span className="text-xs text-muted-foreground">{t('projectDetail.cascade.invoiceUnavailable', 'Invoice totals unavailable')}</span>
                : <MoneyStep label={t('projectDetail.cascade.invoiced', 'Invoiced')} value={settlement.invoiced === null ? t('projectDetail.workOrders.billing.unavailable', 'Unavailable') : formatCurrency(settlement.invoiced, project.currency)} />}
              <Arrow />
              {invoices.isPending ? <ListState variant="loading" rows={1} className="w-24 p-0" /> : invoices.isError
                ? <span className="text-xs text-muted-foreground">{t('projectDetail.cascade.paidUnavailable', 'Paid total unavailable')}</span>
                : <MoneyStep label={t('projectDetail.cascade.paid', 'Paid')} value={formatCurrency(settlement.paid, project.currency)} />}
            </>}
          </dl>
          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
            <span>{t('projectDetail.cascade.notOrdered', 'Not yet ordered')} <strong className="font-semibold text-foreground">{formatCurrency(notYetOrdered, project.currency)}</strong></span>
            {canViewMoney && !invoices.isPending && !invoices.isError && <>
              <span>· {t('projectDetail.cascade.deliveredNotInvoiced', 'Delivered, not invoiced')} <strong className="font-semibold text-foreground">{settlement.invoiced === null ? '—' : formatCurrency(Math.max(0, delivered - settlement.invoiced), project.currency)}</strong></span>
              <span>· {t('projectDetail.cascade.unpaid', 'Unpaid')} <strong className="font-semibold text-foreground">{settlement.unpaid === null ? t('projectDetail.cascade.balancePending', 'balances pending') : formatCurrency(settlement.unpaid, project.currency)}</strong></span>
            </>}
            {billing.data.dpBilled > 0 && <span>· {t('projectDetail.cascade.downPaymentSummary', 'Down payment {{billed}} · recovered {{recovered}}', {
              billed: formatCurrency(billing.data.dpBilled, project.currency),
              recovered: formatCurrency(billing.data.dpRecovered, project.currency),
              interpolation: { escapeValue: false },
            })}</span>}
          </p>
          {canViewMoney && !invoices.isPending && !invoices.isError && !settlement.balancesKnown && (
            <p className="mt-2 text-xs text-muted-foreground" role="note">{t('projectDetail.cascade.partialPaymentNote', 'Part payments appear once invoice balances arrive from accounting.')}</p>
          )}
          {canViewMoney && invoices.isError && <ListState variant="error" title={t('projectDetail.cascade.invoiceError', "Couldn't load invoices")} onRetry={() => void invoices.refetch()} />}
        </section>
      )}

      {children}

      {hasReadingLayer && (() => {
        const open = items.filter((item) => (facts.get(item.id)?.contractBalance ?? 0) > 0);
        if (!open.length) return null;
        return (
          <section aria-labelledby="pd-not-ordered" className="min-w-0">
            <h3 id="pd-not-ordered" className="mb-3 text-sm font-semibold text-foreground">{t('projectDetail.cascade.notOrderedTitle', 'Not yet ordered')}</h3>
            <LineTable
              head={[t('projectDetail.cascade.colContract', 'Contract'), t('projectDetail.cascade.colLeft', 'Left to order')]}
              rows={open.map((item) => {
                const fact = facts.get(item.id)!;
                return { key: item.id, code: item.item_code, name: item.description, unit: item.unit, cells: [qty(Number(item.quantity)), <span key="l" className="font-semibold">{qty(fact.contractBalance)}</span>] };
              })}
            />
          </section>
        );
      })()}
    </div>
  );
};

const MoneyStep: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="min-w-0">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="mt-1 text-lg font-semibold tabular-nums leading-tight text-foreground">{value}</dd>
  </div>
);

const Arrow: React.FC = () => <Icon name="chev" className="mt-6 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;

interface Row { key: string; code: string; name: string; unit: string; cells: React.ReactNode[]; sub?: boolean }

const LineTable: React.FC<{ head: string[]; rows: Row[] }> = ({ head, rows }) => {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[40rem] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pl-3 pr-4 font-medium">{t('projectDetail.cascade.colItem', 'Item')}</th>
            <th scope="col" className="w-16 py-2 pr-4 font-medium">{t('projectDetail.cascade.colUnit', 'Unit')}</th>
            {head.map((heading) => <th key={heading} scope="col" className="w-28 py-2 pl-4 pr-3 text-right font-medium">{heading}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={cn(row.sub ? 'text-xs text-muted-foreground' : 'border-t border-border/70')}>
              <td className={cn('py-2 pl-3 pr-4', row.sub && 'py-1 pl-8')}>
                {row.code && <span className="mr-2 text-xs tabular-nums text-muted-foreground">{row.code}</span>}
                <span className={cn(!row.sub && 'text-foreground')}>{row.name}</span>
              </td>
              <td className={cn('py-2 pr-4 text-muted-foreground', row.sub && 'py-1')}>{row.unit}</td>
              {row.cells.map((cell, index) => <td key={index} className={cn('py-2 pl-4 pr-3 text-right tabular-nums', row.sub && 'py-1')}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
