import React from 'react';
import { useTranslation } from 'react-i18next';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { parseStockError } from '@/src/lib/stockErrors';
import { formatQuantity } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';

/** One line of plain words for a failed stock RPC: the stable `STK_*` copy, else the shared classifier. */
export function useStockErrorText(): (err: unknown) => string {
  const { t } = useTranslation('stock');
  return (err) => {
    const s = parseStockError(err);
    if (!s) return classifyMutationError(err, undefined, { operation: 'create', suppressCapture: true }).headline;
    if (s.code === 'STK_INSUFFICIENT' && s.numbers.available !== undefined && s.numbers.requested !== undefined) {
      const loc = getNumberLocale();
      return t('errors.STK_INSUFFICIENT_DETAIL', { available: formatQuantity(s.numbers.available, loc), requested: formatQuantity(s.numbers.requested, loc) });
    }
    return t(`errors.${s.code}`);
  };
}

/** Banner for a failed submit (`role="alert"`). A shortfall is also placed beside the quantity by the form. */
export const StockError: React.FC<{ error: unknown }> = ({ error }) => {
  const text = useStockErrorText();
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
      {text(error)}
    </p>
  );
};
