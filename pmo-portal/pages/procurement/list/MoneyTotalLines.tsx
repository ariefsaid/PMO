import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatNumber, formatShortMoney } from '@/src/lib/format';
import { shownAmount, type CurrencyTotal } from './model';

interface MoneyTotalLinesProps {
  totals: CurrencyTotal[];
  tooltip: string;
  testId?: string;
  className?: string;
  /** Summary tiles: the figure leads (larger) and reads short ("$2.4M"); the full amount stays in the accessible name. */
  lead?: boolean;
}

export const MoneyTotalLines: React.FC<MoneyTotalLinesProps> = ({ totals: allTotals, tooltip, testId, className = '', lead = false }) => {
  const { t } = useTranslation('procurementList');
  // A zero line beside a real one says nothing ("IDR 0 · $30,000"); keep it only when every currency is zero.
  const nonZero = allTotals.filter((total) => total.amount !== 0);
  const totals = nonZero.length > 0 ? nonZero : allTotals.slice(0, 1);
  // L12c: a currency with some unrecorded rows still shows the recorded part; only a currency with nothing recorded is named as unknown.
  const known = totals.flatMap((total) => {
    const amount = shownAmount(total);
    return amount === null ? [] : [{ total, amount }];
  });
  const unknownOnly = totals.filter((total) => shownAmount(total) === null);
  const unrecordedCount = totals.reduce((sum, total) => sum + (total.unknown && shownAmount(total) !== null ? (total.unknownCount ?? 0) : 0), 0);
  // An unknown total is never shown as a figure: it is named once, by currency, as not recorded.
  const unknownLabel = unknownOnly.length > 0
    ? t('money.notRecorded', { currencies: unknownOnly.map((total) => total.currency).join(', '), defaultValue: '{{currencies}} amount not recorded' })
    : null;
  const partialLabel = unrecordedCount > 0
    ? t('money.partialNotRecorded', { count: unrecordedCount, defaultValue_one: '{{count}} more has no amount recorded', defaultValue_other: '{{count}} more have no amount recorded' })
    : null;
  // C4: no rows at all is a known zero, not a missing amount.
  const empty = totals.length === 0;
  const show = ({ total, amount }: { total: CurrencyTotal; amount: number }) => (lead
    ? formatShortMoney(amount, total.currency)
    : formatCurrency(amount, total.currency));
  const valueLabel = [
    ...(empty ? [formatNumber(0)] : known.map(({ total, amount }) => formatCurrency(amount, total.currency))),
    partialLabel,
    unknownLabel,
  ].filter(Boolean).join(', ');

  return (
    <span
      data-testid={testId}
      title={tooltip}
      aria-label={`${valueLabel}. ${tooltip}`}
      tabIndex={0}
      className={`inline-flex flex-col items-start font-semibold tabular text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${lead ? 'text-[20px] leading-tight' : 'text-[13px] leading-snug'} ${className}`}
    >
      {empty ? (
        <span>{formatNumber(0)}</span>
      ) : (
        <>
          {known.map((entry) => <span key={entry.total.currency}>{show(entry)}</span>)}
          {partialLabel && <span className="text-[12px] font-normal text-muted-foreground">{partialLabel}</span>}
          {unknownLabel && <span className="text-[12px] font-normal text-muted-foreground">{unknownLabel}</span>}
        </>
      )}
    </span>
  );
};
