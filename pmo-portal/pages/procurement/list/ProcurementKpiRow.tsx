import React from 'react';
import { useTranslation } from 'react-i18next';
import { StatTiles, type StatTile } from '@/src/components/ui';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { formatMoneyLines } from '@/src/lib/format';
import { daysSince, shownAmount, totalsByCurrency, type CurrencyTotal, type ProcurementListRole } from '@/src/lib/procurement/listModel';

export type ProcurementTab = 'needs-you' | 'all' | 'orphans';

interface ProcurementKpiRowProps {
  rows: ProcurementWithRefs[];
  role: ProcurementListRole;
}

/** The recorded part of a money total, one line per currency (home first); null when nothing is recorded, never 0. */
export function figureLines(totals: readonly CurrencyTotal[], home: string): { lines: string[] | null; unrecorded: number } {
  const known = totals.flatMap((total) => {
    const amount = shownAmount(total);
    return amount === null ? [] : [{ currency: total.currency, amount }];
  });
  const unrecorded = totals.reduce((sum, total) => sum + (total.unknown ? (total.unknownCount ?? 0) : 0), 0);
  if (totals.length === 0) return { lines: formatMoneyLines([], home, 'tile'), unrecorded: 0 };
  return { lines: known.length === 0 ? null : formatMoneyLines(known, home, 'tile'), unrecorded };
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
  const home = useOrgCurrency();
  const engineer = role === 'Engineer';
  const unpaidRows = rows.filter((row) => row.status === 'Vendor Invoiced');
  const oldestInvoice = unpaidRows
    .flatMap((row) => (row.procurement_invoices ?? []).map((invoice) => invoice.invoice_date ?? invoice.created_at))
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const orderedRows = rows.filter((row) => row.status === 'Ordered' || row.status === 'Received');

  const tile = (label: string, totals: CurrencyTotal[], caption: string | undefined, testId: string): StatTile => {
    const { lines, unrecorded } = figureLines(totals, home);
    return {
      label,
      value: lines === null ? null : <span data-testid={`summary-total-${testId}`} className="block">{lines.map((line) => <span key={line} className="block">{line}</span>)}</span>,
      unavailableReason: lines === null ? t('kpi.notRecorded', 'amounts are not recorded') : undefined,
      // One caption: an incomplete total says so before anything else.
      sub: unrecorded > 0 && lines !== null ? t('kpi.partial', { count: unrecorded, defaultValue: '{{count}} not recorded' }) : caption,
    };
  };

  const tiles: StatTile[] = [
    // An engineer's figures are request amounts only; supplier invoices are not theirs to see, so no unpaid tile.
    ...(engineer ? [] : [tile(
      t('kpi.unpaid', 'Supplier invoices unpaid'),
      totalsByCurrency(unpaidRows, role, 'pay'),
      oldestInvoice ? t('kpi.invoiceAge', { count: daysSince(new Date(oldestInvoice)), defaultValue_one: 'Invoice age {{count}} day', defaultValue_other: 'Invoice age {{count}} days' }) : undefined,
      'unpaid',
    )]),
    tile(t('kpi.ordered', 'Ordered, not invoiced'), totalsByCurrency(orderedRows, role, 'most-real'), undefined, 'ordered'),
  ];

  return (
    <section aria-label={t('summary.label', 'Procurement summary')}>
      <StatTiles tiles={tiles} columns={2} />
    </section>
  );
});
