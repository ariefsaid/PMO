import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import type { NeedsYouResult } from '../blocks/needsYou';
import { daysSince, totalsByCurrency, type CurrencyTotal, type ProcurementListRole } from './model';
import { MoneyTotalLines } from './MoneyTotalLines';

export type ProcurementTab = 'needs-you' | 'all' | 'orphans';

interface ProcurementKpiRowProps {
  rows: ProcurementWithRefs[];
  needsYouRows: Array<{ row: ProcurementWithRefs; result: NeedsYouResult }>;
  /** Accounting-system documents not in a procurement; undefined when the role can't see them. */
  orphans?: ErpPurchaseRow[];
  tab: ProcurementTab;
  role: ProcurementListRole;
  onSelectTab: (tab: ProcurementTab) => void;
}

function orphanTotals(orphans: readonly ErpPurchaseRow[]): CurrencyTotal[] {
  const totals = new Map<string, CurrencyTotal>();
  for (const doc of orphans) {
    const currency = doc.currency ?? '';
    const current = totals.get(currency) ?? { currency, amount: 0, unknown: false };
    if (doc.grandTotal == null) { current.unknown = true; current.amount = null; }
    else if (!current.unknown) current.amount = (current.amount ?? 0) + doc.grandTotal;
    totals.set(currency, current);
  }
  return [...totals.values()];
}

/**
 * Company-wide figures above the shared procurement list: what waits on you, what is owed, what is ordered.
 * L6: the tabs own the "Needs you" and "Not in a procurement" counts, so those tiles carry money and meaning
 * only (and still select their tab); tiles with no tab say their count in the meaning line.
 */
export const ProcurementKpiRow: React.FC<ProcurementKpiRowProps> = ({ rows, needsYouRows, orphans, tab, role, onSelectTab }) => {
  const { t } = useTranslation('procurementList');
  const engineer = role === 'Engineer';
  const reasons = new Map(needsYouRows.map(({ row, result }) => [row.id, result.reason]));
  const unpaidRows = rows.filter((row) => row.status === 'Vendor Invoiced');
  const oldestInvoice = unpaidRows
    .flatMap((row) => (row.procurement_invoices ?? []).map((invoice) => invoice.invoice_date ?? invoice.created_at))
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const orderedRows = rows.filter((row) => row.status === 'Ordered' || row.status === 'Received');
  const mostRealTip = t('money.mostReal', 'Most real amount per procurement: paid, then supplier invoice, then purchase order, then request. Summed by currency.');

  const cells = [
    {
      key: 'needs-you', label: t('tab.needsYou', 'Needs you'), count: null as number | null,
      totals: totalsByCurrency(needsYouRows.map(({ row }) => row), role, 'needs-you', reasons),
      tooltip: engineer ? t('money.engineer', 'Request amount only. Supplier invoice and payment amounts are not shown.') : mostRealTip,
      meaning: t('meaning.needsYou', 'Waiting on your next step'),
      onClick: () => onSelectTab('needs-you'), active: tab === 'needs-you',
    },
    ...(engineer ? [] : [{
      key: 'unpaid', label: t('kpi.unpaid', 'Supplier invoices unpaid'), count: unpaidRows.length,
      totals: totalsByCurrency(unpaidRows, role, 'pay'),
      tooltip: t('money.pay', 'Supplier invoices use the unpaid balance; paid procurements contribute zero. Kept in each procurement currency.'),
      meaning: oldestInvoice
        ? t('kpi.oldestUnpaid', { count: daysSince(new Date(oldestInvoice)), defaultValue: `Oldest invoiced ${daysSince(new Date(oldestInvoice))} days ago` })
        : t('kpi.noneUnpaid', 'Nothing waiting for payment'),
      onClick: undefined, active: false,
    }]),
    {
      key: 'ordered', label: t('kpi.ordered', 'Ordered, not invoiced'), count: orderedRows.length,
      totals: totalsByCurrency(orderedRows, role, 'most-real'), tooltip: mostRealTip,
      meaning: t('kpi.orderedMeaning', 'Committed with suppliers, no invoice yet'),
      onClick: undefined, active: false,
    },
    ...(orphans ? [{
      key: 'orphans', label: t('tab.orphans', 'Not in a procurement'), count: null,
      totals: orphanTotals(orphans),
      tooltip: t('kpi.orphansTip', 'Accounting-system purchase documents no procurement holds yet. Their cost is already in project actuals; linking never counts it twice.'),
      meaning: t('kpi.orphansMeaning', 'From the accounting system, to link'),
      onClick: () => onSelectTab('orphans'), active: tab === 'orphans',
    }] : []),
  ];

  return (
    <section aria-label={t('summary.label', 'Procurement summary')} className="overflow-hidden rounded-lg border border-border bg-border">
      <div className={`grid grid-cols-2 gap-px bg-border ${cells.length === 4 ? 'md:grid-cols-4' : cells.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {cells.map((cell) => {
          const body = (
            <>
              <span className="text-[13px] font-medium text-muted-foreground">{cell.label}</span>
              <MoneyTotalLines lead totals={cell.totals} tooltip={cell.tooltip} testId={`summary-total-${cell.key}`} className="mt-1" />
              <span className="mt-auto pt-2 text-[12px] leading-snug text-muted-foreground">
                {cell.count === null ? cell.meaning : `${t('count.procurements', { count: cell.count, defaultValue_one: '{{count}} procurement', defaultValue: '{{count}} procurements' })} · ${cell.meaning}`}
              </span>
            </>
          );
          const base = 'flex min-h-[112px] min-w-0 flex-col items-start bg-card px-3.5 py-3 text-left md:px-4 border-b-2 pb-[10px]';
          return cell.onClick ? (
            <button key={cell.key} type="button" data-testid={`summary-cell-${cell.key}`} aria-pressed={cell.active} onClick={cell.onClick}
              className={`${base} transition-colors hover:bg-accent focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${cell.active ? 'border-primary' : 'border-transparent'}`}>
              {body}
            </button>
          ) : (
            <div key={cell.key} data-testid={`summary-cell-${cell.key}`} className={`${base} border-transparent`}>{body}</div>
          );
        })}
      </div>
    </section>
  );
};
