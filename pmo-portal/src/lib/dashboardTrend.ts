import { addMonths } from '@/src/lib/reports/months';

/** The slice of the management pack's totals this needs; a full `ManagementPack` satisfies it. */
interface PackTotals {
  totals: Array<{ currency: string; months: Array<{ month: string; invoiced: number }> }>;
}

/** A line needs this many months of history (AC-DTR-001/002). */
export const MIN_TREND_MONTHS = 3;

export type TrendDirection = 'up' | 'down' | 'flat';

export interface InvoicedTrend {
  currency: string;
  /** Net of tax, whole currency units, from the first invoiced month on. */
  points: Array<{ month: string; amount: number }>;
  /** Sum of `points`, the headline figure. */
  total: number;
  first: number;
  last: number;
  direction: TrendDirection;
  hasLine: boolean;
}

/**
 * The dashboard headline and its line come from the management pack's own monthly totals (ADR-0048:
 * nothing is recomputed from invoices). One currency, never summed across; history starts at the first
 * invoiced month because months before it are "no history", not a zero.
 */
export function selectInvoicedTrend(
  pack: PackTotals | undefined,
  preferredCurrency: string,
): InvoicedTrend | null {
  const series = pack?.totals.find((row) => row.currency === preferredCurrency) ?? pack?.totals[0];
  if (!series) return null;
  const start = series.months.findIndex((m) => m.invoiced !== 0);
  if (start < 0) return null;
  const months = series.months.slice(start);
  const first = months[0].invoiced;
  const last = months[months.length - 1].invoiced;
  return {
    currency: series.currency,
    points: months.map((m) => ({ month: m.month, amount: m.invoiced / 100 })),
    total: months.reduce((sum, m) => sum + m.invoiced, 0) / 100,
    first: first / 100,
    last: last / 100,
    direction: last > first ? 'up' : last < first ? 'down' : 'flat',
    hasLine: months.length >= MIN_TREND_MONTHS,
  };
}

/**
 * The twelve completed months before the org's current month: the month in progress is partial and
 * would read as a fall. Independent of the dashboard period, so the line always has its history.
 */
export function trendWindow(orgDay: string | null): { from?: string; to?: string } {
  if (!orgDay) return {};
  const to = addMonths(`${orgDay.slice(0, 7)}-01`, -1);
  return { from: addMonths(to, -11), to };
}
