import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/src/lib/format';
import type { CurrencyTotal } from './model';

interface MoneyTotalLinesProps {
  totals: CurrencyTotal[];
  tooltip: string;
  testId?: string;
  className?: string;
}

export const MoneyTotalLines: React.FC<MoneyTotalLinesProps> = ({ totals: allTotals, tooltip, testId, className = '' }) => {
  const { t } = useTranslation('procurementList');
  // A zero line beside a real one says nothing ("IDR 0 · $30,000"); keep it only when every currency is zero.
  const nonZero = allTotals.filter((total) => total.amount !== 0);
  const totals = nonZero.length > 0 ? nonZero : allTotals.slice(0, 1);
  const valueLabel = totals.length === 0
    ? t('money.unavailable', 'Amount unavailable')
    : totals.map((total) => total.unknown || total.amount === null
      ? `${total.currency} —`
      : formatCurrency(total.amount, total.currency)).join(', ');

  return (
    <span
      data-testid={testId}
      title={tooltip}
      aria-label={`${valueLabel}. ${tooltip}`}
      tabIndex={0}
      className={`inline-flex flex-col items-start text-[13px] font-semibold leading-snug tabular text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    >
      {totals.length === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : totals.map((total) => (
        <span key={total.currency}>
          {total.unknown || total.amount === null
            ? `${total.currency} —`
            : formatCurrency(total.amount, total.currency)}
        </span>
      ))}
    </span>
  );
};
