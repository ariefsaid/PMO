/**
 * L12(h): one currency order wherever a dashboard joins per-currency money ("$33.1M · IDR 269M").
 * The organisation currency leads (as in the ageing strips), the rest follow alphabetically.
 */
export function orderByCurrency<T extends { currency: string }>(rows: readonly T[], orgCurrency: string): T[] {
  return [...rows].sort((a, b) => {
    if (a.currency === b.currency) return 0;
    if (a.currency === orgCurrency) return -1;
    if (b.currency === orgCurrency) return 1;
    return a.currency.localeCompare(b.currency);
  });
}

/**
 * Tile-sized money, one line per currency, never joined: the organisation currency first (when it has an amount),
 * every other currency on its own `+ …` line in alphabetical order. No amounts at all reads as zero in `home`.
 */
export function tileMoneyLines(totals: ReadonlyArray<{ currency: string; amount: number }>, home: string, format: (amount: number, currency: string, opts: { code: boolean }) => string | null): string[] {
  const ordered = orderByCurrency(totals, home);
  if (ordered.length === 0) return [format(0, home, { code: false }) ?? '—'];
  return ordered.flatMap(({ currency, amount }, index) => {
    const text = format(amount, currency, { code: currency !== home });
    return text === null ? [] : [index === 0 ? text : `+ ${text}`];
  });
}
