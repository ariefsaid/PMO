/**
 * #831: org-wide revenue figures are grouped PER CURRENCY — never summed across currencies and never
 * converted. One entry per currency present, in first-seen order.
 */
export function totalsByCurrency<T extends { currency: string }>(
  rows: readonly T[],
  pick: (row: T) => number,
): Array<{ currency: string; amount: number }> {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.currency, (totals.get(row.currency) ?? 0) + pick(row));
  return Array.from(totals, ([currency, amount]) => ({ currency, amount }));
}
