import React from 'react';
import { formatMoneyLines, formatTileMoney } from '@/src/lib/format';

/** How a second-currency line reads: "+ USD 1.85M contracts". It is a separate amount, never a conversion. */
export type OtherCurrencyLine = (amount: string, currency: string) => string;

/**
 * A money tile's value from per-currency totals: the organisation currency first, then each other currency as its
 * own labelled "+ …" line. A zero in another currency is left out (it says nothing); a home zero stays.
 */
export function moneyTileValue(
  totals: ReadonlyArray<{ currency: string; amount: number }> | null | undefined,
  home: string,
  otherLine: OtherCurrencyLine = (amount) => `+ ${amount}`,
): { value: React.ReactNode; exact?: string } | null {
  if (!totals) return null;
  const shown = totals.filter((row) => row.currency === home || row.amount !== 0);
  const kept = shown.length > 0 ? shown : totals.slice(0, 1);
  const tile = formatMoneyLines(kept, home, 'tile', { prefixOtherCurrencies: false }).lines;
  if (tile.length === 0) return null;
  const table = formatMoneyLines(kept, home, 'table', { prefixOtherCurrencies: false }).lines;
  // The lead line is the home currency when present; every other currency is a labelled addition under it.
  const lead = kept.some((row) => row.currency === home) ? home : kept[0].currency;
  const extra = [...new Set(kept.map((row) => row.currency))].filter((currency) => currency !== lead).map((currency) => {
    const amount = kept.filter((row) => row.currency === currency).reduce((sum, row) => sum + row.amount, 0);
    return otherLine(formatTileMoney(amount, currency, { code: true }) ?? '', currency);
  });
  return {
    value: <>
      <span>{tile[0]}</span>
      {extra.map((line) => <span key={line} className="mt-1 block text-control font-medium text-muted-foreground">{line}</span>)}
    </>,
    exact: table.join('; '),
  };
}
