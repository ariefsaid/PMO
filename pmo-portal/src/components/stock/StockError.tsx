import React from 'react';
import { useStockErrorText } from './useStockErrorText';

/** A `<p>`'s own props (including `ref`), minus the children the banner fills itself. */
type StockErrorProps = { error: unknown } & Omit<React.ComponentPropsWithRef<'p'>, 'children'>;

/** Banner for a failed submit (`role="alert"`). A shortfall is also placed beside the quantity by the form. */
export const StockError: React.FC<StockErrorProps> = ({ error, ...rest }) => {
  const text = useStockErrorText();
  if (!error) return null;
  return (
    <p role="alert" {...rest} className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
      {text(error)}
    </p>
  );
};
