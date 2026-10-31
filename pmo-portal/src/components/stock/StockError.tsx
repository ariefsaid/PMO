import React from 'react';
import { useStockErrorText } from './useStockErrorText';

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
