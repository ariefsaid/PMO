import type { ActiveBudgetCategoryPhasing, BudgetProjectionCellRow } from '@/src/lib/repositories/budgetProjection';

type Reason = { kind: 'other-year'; years: string[] } | { kind: 'no-ledger' | 'no-account' | 'stale-attribution' | 'partial-attribution' | 'no-budget-year' | 'no-budget-line' };

function reasonFor(row: BudgetProjectionCellRow, year: string, phasing: ActiveBudgetCategoryPhasing | undefined): Reason | null {
  if (row.pmoBudgetAmount !== null || phasing === undefined) return null;
  const years = phasing.years[row.category] ?? [];
  const unphased = phasing.unphased[row.category] === true;
  const otherYears = years.filter((value) => value !== year);
  if (otherYears.length && !unphased) return { kind: 'other-year', years: otherYears };
  if ((years.length || unphased) && unphased) return { kind: 'stale-attribution' };
  if (row.attributionKnown === false) return { kind: 'partial-attribution' };
  if (!Object.values(phasing.years).some((values) => values.includes(year))) return { kind: 'no-budget-year' };
  return { kind: 'no-budget-line' };
}

export function interpretForecast(rows: BudgetProjectionCellRow[], year: string, phasing: ActiveBudgetCategoryPhasing | undefined, commitments: Record<string, number | null>, canRead: boolean) {
  const total = (select: (row: BudgetProjectionCellRow) => number | null) => rows.every((row) => select(row) !== null)
    ? rows.reduce((sum, row) => sum + (select(row) ?? 0), 0) : null;
  return {
    rows: rows.map((row) => {
      const budgetReason = reasonFor(row, year, phasing);
      const budgetStatus = row.pmoBudgetAmount !== null ? 'present' :
        budgetReason && ['other-year', 'no-budget-year', 'no-budget-line'].includes(budgetReason.kind) ? 'known-absent' : 'unknown';
      const reason: Reason | null = row.actualsToDate === null
        ? { kind: row.actualsAsOf === null ? 'no-ledger' : 'no-account' }
        : budgetReason;
      return { row, incomplete: row.actualsToDate === null || row.pmoBudgetAmount === null, reason, budgetStatus };
    }),
    summary: {
      budget: total((row) => row.pmoBudgetAmount), actuals: total((row) => row.actualsToDate),
      etc: rows.reduce((sum, row) => sum + row.pmoEtc, 0), final: total((row) => row.projectedFinalCost),
      remaining: total((row) => row.projectedVariance),
      committed: canRead ? rows.reduce((sum, row) => sum + (commitments[row.category] ?? 0), 0) : null,
    },
  };
}
