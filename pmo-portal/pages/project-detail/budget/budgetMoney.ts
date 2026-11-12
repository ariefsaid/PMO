import { formatCurrency, formatNumberMax2, formatTileMoney } from '@/src/lib/format';

/** Preserve a non-zero amount that whole-unit budget displays would round to zero. */
export function formatBudgetAmount(value: number, currency: string): string {
  if (value !== 0 && Math.abs(value) < 0.5) return `${currency} ${formatBudgetExactNumber(value)}`;
  return formatCurrency(value, currency);
}

export function formatBudgetExactNumber(value: number): string {
  if (value !== 0 && Math.abs(value) < 0.5 && (Math.abs(value) < 0.005 || Math.abs(value - Math.round(value * 100) / 100) > 1e-9)) return String(value);
  return formatNumberMax2(value);
}

export function formatBudgetTile(value: number, currency: string): string {
  return value !== 0 && Math.abs(value) < 0.5
    ? formatBudgetAmount(value, currency)
    : formatTileMoney(value, currency) ?? formatBudgetAmount(value, currency);
}
