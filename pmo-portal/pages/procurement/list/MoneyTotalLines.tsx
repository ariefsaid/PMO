import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatShortMoney } from '@/src/lib/format';
import type { CurrencyTotal } from './model';

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
  const known = totals.filter((total) => !total.unknown && total.amount !== null);
  const unknown = totals.filter((total) => total.unknown || total.amount === null);
  // An unknown total is never shown as a figure: it is named once, by currency, as not recorded.
  const unknownLabel = unknown.length > 0
    ? t('money.notRecorded', { currencies: unknown.map((total) => total.currency).join(', '), defaultValue: '{{currencies}} amount not recorded' })
    : null;
  const valueLabel = totals.length === 0
    ? t('money.none', 'No amount')
    : [...known.map((total) => formatCurrency(total.amount as number, total.currency)), unknownLabel].filter(Boolean).join(', ');
  const show = (total: CurrencyTotal) => (lead
    ? formatShortMoney(total.amount as number, total.currency)
    : formatCurrency(total.amount as number, total.currency));

  return (
    <span
      data-testid={testId}
      title={tooltip}
      aria-label={`${valueLabel}. ${tooltip}`}
      tabIndex={0}
      className={`inline-flex flex-col items-start font-semibold tabular text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${lead ? 'text-[20px] leading-tight' : 'text-[13px] leading-snug'} ${className}`}
    >
      {totals.length === 0 ? (
        <span className="text-[13px] font-normal text-muted-foreground">{t('money.none', 'No amount')}</span>
      ) : (
        <>
          {known.map((total) => <span key={total.currency}>{show(total)}</span>)}
          {unknownLabel && <span className="text-[12px] font-normal text-muted-foreground">{unknownLabel}</span>}
        </>
      )}
    </span>
  );
};
