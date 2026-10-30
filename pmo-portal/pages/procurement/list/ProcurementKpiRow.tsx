import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { daysSince, totalsByCurrency, type ProcurementListRole } from './model';
import { MoneyTotalLines } from './MoneyTotalLines';

export type ProcurementTab = 'needs-you' | 'all' | 'orphans';

interface ProcurementKpiRowProps {
  rows: ProcurementWithRefs[];
  role: ProcurementListRole;
}

/**
 * Company-wide money above the shared procurement list: what is owed, what is ordered.
 * O7: the scope tabs own the "Needs you" and "Not in a procurement" counts and carry their money in the tab
 * label, so only the figures no tab owns are tiles here.
 */
export const ProcurementKpiRow: React.FC<ProcurementKpiRowProps> = ({ rows, role }) => {
  const { t } = useTranslation('procurementList');
  const engineer = role === 'Engineer';
  const unpaidRows = rows.filter((row) => row.status === 'Vendor Invoiced');
  const oldestInvoice = unpaidRows
    .flatMap((row) => (row.procurement_invoices ?? []).map((invoice) => invoice.invoice_date ?? invoice.created_at))
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const orderedRows = rows.filter((row) => row.status === 'Ordered' || row.status === 'Received');
  const mostRealTip = t('money.mostReal', 'Most real amount per procurement: paid, then supplier invoice, then purchase order, then request. Summed by currency.');

  const cells = [
    // C4: an engineer's figures are request amounts only; supplier invoices are not theirs to see, so no unpaid tile.
    ...(engineer ? [] : [{
      key: 'unpaid', label: t('kpi.unpaid', 'Supplier invoices unpaid'), count: unpaidRows.length,
      totals: totalsByCurrency(unpaidRows, role, 'pay'),
      tooltip: t('money.pay', 'Supplier invoices use the unpaid balance; paid procurements contribute zero. Kept in each procurement currency.'),
      meaning: oldestInvoice
        ? t('kpi.oldestUnpaid', { count: daysSince(new Date(oldestInvoice)), defaultValue: `Oldest invoiced ${daysSince(new Date(oldestInvoice))} days ago` })
        : t('kpi.noneUnpaid', 'Nothing waiting for payment'),
    }]),
    {
      key: 'ordered', label: t('kpi.ordered', 'Ordered, not invoiced'), count: orderedRows.length,
      totals: totalsByCurrency(orderedRows, role, 'most-real'),
      tooltip: engineer ? t('money.engineer', 'Request amount only. Supplier invoice and payment amounts are not shown.') : mostRealTip,
      meaning: t('kpi.orderedMeaning', 'Committed with suppliers, no invoice yet'),
    },
  ];

  return (
    <section aria-label={t('summary.label', 'Procurement summary')} className="overflow-hidden rounded-lg border border-border bg-border">
      <div className={`grid grid-cols-1 gap-px bg-border ${cells.length === 2 ? 'sm:grid-cols-2' : ''}`}>
        {cells.map((cell) => (
          <div key={cell.key} data-testid={`summary-cell-${cell.key}`} className="flex min-h-[96px] min-w-0 flex-col items-start bg-card px-3.5 py-3 text-left md:px-4">
            <span className="text-[13px] font-medium text-muted-foreground">{cell.label}</span>
            <MoneyTotalLines lead totals={cell.totals} tooltip={cell.tooltip} testId={`summary-total-${cell.key}`} className="mt-1" />
            <span className="mt-auto pt-2 text-[12px] leading-snug text-muted-foreground">
              {`${t('count.procurements', { count: cell.count, defaultValue_one: '{{count}} procurement', defaultValue: '{{count}} procurements' })} · ${cell.meaning}`}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
};
