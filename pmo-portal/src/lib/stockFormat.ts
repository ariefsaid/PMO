import { formatDecimalString, formatExactMoney } from '@/src/lib/format';

/** Exact decimal-string formatting: `Intl.NumberFormat` accepts a numeric string and keeps all digits (NFR-STK-007). */
export function formatQuantity(value: string, locale: string): string {
  return formatDecimalString(value, locale, 3);
}

/** Money for a stock value or average cost (up to 4 decimals for a cost); '' when the server omitted it (rank < 20). */
export function formatStockValue(value: string | undefined, currency: string, locale: string): string {
  if (value === undefined) return '';
  const exact = formatExactMoney(value, currency, locale);
  if (exact !== null) return exact;
  return `${currency} ${formatDecimalString(value, locale, 4)}`;
}

export const isWholeQuantity = (value: string): boolean => /^-?\d+(\.0+)?$/.test(value);

/** A user-typed quantity in a decimal-comma locale becomes the dot form the RPC takes. */
export const normalizeDecimal = (raw: string): string => raw.trim().replace(',', '.');
export const isPositiveDecimal = (v: string): boolean => /^\d+(\.\d{1,3})?$/.test(v) && /[1-9]/.test(v);
