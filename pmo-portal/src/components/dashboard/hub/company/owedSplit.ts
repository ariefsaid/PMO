import type { OwedSplit } from '@/src/components/dashboard/restructure/useCompanyFigures';

/** Known balances per currency: not yet due plus overdue. */
export function owedTotals(split: OwedSplit): Array<{ currency: string; amount: number }> {
  const totals = new Map<string, number>();
  for (const row of [...split.notDue, ...split.overdue]) totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.amount);
  return [...totals].map(([currency, amount]) => ({ currency, amount }));
}

/** The bar's two shares (0–1) in one currency; null when that currency has no known balance. */
export function owedShares(split: OwedSplit, currency: string): { notDue: number; overdue: number; notDueAmount: number; overdueAmount: number } | null {
  const notDueAmount = split.notDue.find((row) => row.currency === currency)?.amount ?? 0;
  const overdueAmount = split.overdue.find((row) => row.currency === currency)?.amount ?? 0;
  const total = notDueAmount + overdueAmount;
  if (total <= 0) return null;
  return { notDue: notDueAmount / total, overdue: overdueAmount / total, notDueAmount, overdueAmount };
}
