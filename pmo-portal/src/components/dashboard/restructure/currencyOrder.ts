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
