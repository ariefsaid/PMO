import { formatCurrency } from '@/src/lib/format';
import { formatCurrencyWithCode } from '@/src/lib/finance/format';

/**
 * #1459 — the one lead-currency + other-currencies figure rule. It existed three times (the Finance
 * hub's area cards, the Payables figures tile, the attention list) and had drifted: one surface still
 * printed a zero other-currency line. A known zero is stated once, as the lead; a zero secondary line
 * is never rendered (it was already dropped on the hub).
 *
 * Amounts are integer cents, keyed by ISO currency code.
 */
export type CurrencyCents = Record<string, number>;

/** Currencies in reading order: the org currency first, then ISO code order. */
export function currencyEntries(values: CurrencyCents, preferred?: string | null): Array<[string, number]> {
  return Object.entries(values)
    .sort(([left], [right]) => (left === preferred ? -1 : right === preferred ? 1 : left.localeCompare(right)));
}

/** The running-text reading: the lead as an exact amount with its symbol, the rest with their ISO code. */
export function currencyLines(values: CurrencyCents, preferred?: string | null): string[] {
  return currencyEntries(values, preferred)
    .map(([currency, cents], index) => (index === 0
      ? formatCurrency(cents / 100, currency)
      : formatCurrencyWithCode(cents / 100, currency)));
}
