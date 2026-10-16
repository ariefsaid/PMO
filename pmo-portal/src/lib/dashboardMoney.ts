import { formatExactMoney } from './format';

/** Exact dashboard money formatting; null means the read model lacks coverage. */
export function formatDashboardMoney(value: number | null, currency: string, locale: string): string | null {
  return value === null || !Number.isFinite(value)
    ? null
    : formatExactMoney(String(value), currency, locale);
}
