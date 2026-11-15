import type { CanonicalBudgetReading } from '@/src/lib/db/projectMoney';

type DashboardProjectRow = { id: string; currency: string; spent?: number | null; actual_complete?: boolean | null; actual_currency?: string | null };

/**
 * #2132: the company dashboard reads each project's spending from the Budget tab's canonical reading. Fixtures that
 * describe spending on the dashboard rows get the matching reading: a complete actual is that amount in its
 * currency; an incomplete one is unknown.
 */
export function budgetPositionsMirroring(dashboard: Record<string, unknown> | null | undefined, ids: string[]): Record<string, CanonicalBudgetReading> {
  const rows = [...((dashboard?.attention_projects as DashboardProjectRow[] | undefined) ?? []), ...((dashboard?.top_projects as DashboardProjectRow[] | undefined) ?? [])];
  const result: Record<string, CanonicalBudgetReading> = {};
  for (const row of rows) {
    if (!ids.includes(row.id)) continue;
    const known = row.spent != null && row.actual_complete === true;
    result[row.id] = {
      projectId: row.id, ledgerBasis: 'pmo', currency: known ? row.actual_currency ?? row.currency : row.currency, budgetCurrency: row.currency,
      activeBudgetAmount: null, spent: known ? String(row.spent) : null, openCommitment: null, consumption: null, complete: known,
      usedRatio: null, usedPercent: null, consumptionVariance: null, riskEligible: false, atRisk: null,
    };
  }
  return result;
}
