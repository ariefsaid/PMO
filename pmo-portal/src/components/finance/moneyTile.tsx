import React from 'react';
import { formatMoneyLines } from '@/src/lib/format';

/** Integer cents keyed by ISO currency code (the finance position's shape). */
export type CentsByCurrency = Record<string, number>;

/**
 * Figure-tile value for a multi-currency total: the home currency is the figure ("IDR 7.7B"), any other
 * currency sits on its own second line ("USD 5.3K"), zeros left out. Never "A · B" in one figure.
 */
export function moneyTileProps(cents: CentsByCurrency, home: string): { value: React.ReactNode; exactValue?: string } {
  const entries = Object.entries(cents).map(([currency, amount]) => ({ currency, amount: amount / 100 }));
  const shownEntries = entries.filter((entry) => entry.currency === home || entry.amount !== 0);
  const [lead, ...others] = formatMoneyLines(shownEntries, home, 'tile', { prefixOtherCurrencies: false });
  return {
    value: (
      <>
        {lead}
        {others.map((line) => <span key={line} className="mt-1 block text-control font-medium text-muted-foreground">{line}</span>)}
      </>
    ),
    exactValue: formatMoneyLines(shownEntries, home, 'table', { prefixOtherCurrencies: false }).join('; ') || undefined,
  };
}

/** Grid columns for a tile row that is as wide as its visible tiles: a hidden tile leaves no empty cell. */
export function figureCols(visible: number): string {
  if (visible <= 1) return 'grid-cols-1';
  if (visible === 2) return 'grid-cols-2';
  if (visible === 3) return 'grid-cols-2 sm:grid-cols-3';
  return 'grid-cols-2 xl:grid-cols-4';
}
