import { formatNumber } from '@/src/lib/format';

/** Whole-unit amount with an ISO code for a secondary-currency line. */
export function formatCurrencyWithCode(value: number, currency: string): string {
  return `${currency} ${formatNumber(Math.round(value))}`;
}
