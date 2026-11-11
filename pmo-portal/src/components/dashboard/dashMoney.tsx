import React from 'react';
import { formatMoneyLines } from '@/src/lib/format';

/** A money tile's value from per-currency totals: the organisation currency first, another currency on its own second line. */
export function moneyTileValue(totals: ReadonlyArray<{ currency: string; amount: number }> | null | undefined, home: string): { value: React.ReactNode; exact?: string } | null {
  if (!totals) return null;
  const tile = formatMoneyLines(totals, home, 'tile', { prefixOtherCurrencies: false });
  if (tile.length === 0) return null;
  const table = formatMoneyLines(totals, home, 'table', { prefixOtherCurrencies: false });
  return {
    value: <>
      <span>{tile[0]}</span>
      {tile.slice(1).map((line) => <span key={line} className="mt-1 block text-control font-medium text-muted-foreground">{line}</span>)}
    </>,
    exact: table.join('; '),
  };
}
