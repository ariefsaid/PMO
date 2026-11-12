import React from 'react';
import { useTranslation } from 'react-i18next';
import { StatTiles, type StatTile } from '@/src/components/ui';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { formatCurrency, formatMoneyLines } from '@/src/lib/format';
import { calendarAgeDays, supplierInvoiceDate } from '@/src/lib/finance/financePosition';
import { shownAmount, totalsByCurrency, type CurrencyTotal, type ProcurementListRole } from '@/src/lib/procurement/listModel';

export type ProcurementTab = 'needs-you' | 'all' | 'orphans';

interface ProcurementKpiRowProps {
  rows: ProcurementWithRefs[];
  role: ProcurementListRole;
}

/** The recorded part of a money total, one line per currency (home first); null when nothing is recorded, never 0. */
function figureLines(totals: readonly CurrencyTotal[], home: string): { lines: string[] | null; exact: string; unrecorded: number } {
  const known = totals.flatMap((total) => {
    const amount = shownAmount(total);
    return amount === null ? [] : [{ currency: total.currency, amount }];
  });
  const unrecorded = totals.reduce((sum, total) => sum + (total.unknown ? (total.unknownCount ?? 0) : 0), 0);
  const exact = known.map((total) => formatCurrency(total.amount, total.currency)).join(' + ');
  if (totals.length === 0) return { lines: formatMoneyLines([{ currency: home, amount: 0 }], home, 'tile').lines, exact, unrecorded: 0 };
  return { lines: known.length === 0 ? null : formatMoneyLines(known, home, 'tile').lines, exact, unrecorded };
}

/**
 * Company-wide money above the shared procurement list: what is owed, what is ordered. The scope tabs own the
 * counts, so only the figures no tab owns are tiles. A total with nothing recorded is not drawn: the page's
 * one hidden-figures line (inside its `FigureScope`) says so.
 *
 * Memoised on (rows, role): the page re-renders once per query settle and on every tab/search change, and
 * this row totals every procurement — none of which changes unless the rows or the viewer do.
 */
export const ProcurementKpiRow = React.memo(function ProcurementKpiRow({ rows, role }: ProcurementKpiRowProps) {
  const { t } = useTranslation('procurementList');
  const summaryHeadingId = React.useId();
  const home = useOrgCurrency();
  const organizationDay = useFxOrgDay(true);
  const engineer = role === 'Engineer';
  const unpaidRows = rows.filter((row) => row.status === 'Vendor Invoiced');
  const oldestInvoice = unpaidRows
    .map((row) => supplierInvoiceDate(row))
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const orderedRows = rows.filter((row) => row.status === 'Ordered' || row.status === 'Received');

  const tile = (label: string, count: number, totals: CurrencyTotal[], caption: string | undefined, testId: string, basis: string): StatTile => {
    const { lines, exact, unrecorded } = figureLines(totals, home);
    return {
      label,
      value: lines === null ? null : <span data-testid={`summary-total-${testId}`} title={basis} aria-label={`${exact}. ${basis}`} tabIndex={0} className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{lines.map((line) => <span key={line} className="block">{line}</span>)}</span>,
      unavailableReason: lines === null ? t('kpi.notRecorded', 'amounts are not recorded') : undefined,
      // The caption counts the same procurements as the figure; an incomplete total says so.
      sub: [t('count.procurements', { count, defaultValue_one: '{{count}} procurement', defaultValue_other: '{{count}} procurements' }), unrecorded > 0 && lines !== null ? t('kpi.partial', { count: unrecorded, defaultValue: '{{count}} not recorded' }) : caption].filter(Boolean).join(' · '),
    };
  };

  const tiles: StatTile[] = [
    // An engineer's figures are request amounts only; supplier invoices are not theirs to see, so no unpaid tile.
    ...(engineer ? [] : [tile(
      t('kpi.unpaid', 'Supplier invoices unpaid'),
      unpaidRows.length,
      totalsByCurrency(unpaidRows, role, 'pay'),
      calendarAgeDays(oldestInvoice, organizationDay.day) === null ? undefined : t('kpi.invoiceAge', { count: calendarAgeDays(oldestInvoice, organizationDay.day)!, defaultValue_one: 'Invoice age {{count}} day', defaultValue_other: 'Invoice age {{count}} days' }),
      'unpaid',
      t('money.pay', 'Supplier invoices use the unpaid balance; paid procurements contribute zero. Kept in each procurement currency.'),
    )]),
    tile(t('kpi.ordered', 'Ordered, not invoiced'), orderedRows.length, totalsByCurrency(orderedRows, role, 'most-real'), undefined, 'ordered',
      engineer ? t('money.engineer', 'Request amount only. Supplier invoice and payment amounts are not shown.') : t('money.mostReal', 'Most real amount per procurement: paid, then supplier invoice, then purchase order, then request. Summed by currency.')),
  ];

  return (
    <section aria-labelledby={summaryHeadingId} className="space-y-2">
      <h2 id={summaryHeadingId} className="text-sm font-medium text-foreground">
        {t('scope.heading', 'All procurements')}
      </h2>
      <StatTiles tiles={tiles} columns={2} />
    </section>
  );
});
