import type { BudgetDistributionBasis } from '@/src/lib/db/budgets';
import { yearsInSpan, type FiscalYearSpan } from './budgetDistribution';

export interface StaleDistribution {
  projectEnd: string | null;
  coveredYears: string[];
}

/**
 * FR-022: an Active plan is stale when the project dates (or, when a live calendar is at hand, the fiscal
 * years the dates resolve to) differ from the basis it was saved on. Pure read, never mutates the plan.
 * An unresolvable calendar is not evidence of change, so it reads as current.
 */
export function staleDistributionBasis(
  basis: BudgetDistributionBasis,
  projectStart: string | null,
  projectEnd: string | null,
  liveYears: readonly FiscalYearSpan[] | null,
): StaleDistribution | null {
  let stale = basis.projectStart !== projectStart || basis.projectEnd !== projectEnd;
  if (!stale && projectStart && liveYears) {
    try {
      const years = yearsInSpan(projectStart, projectEnd, liveYears);
      stale = years.length !== basis.years.length || years.some((year, index) =>
        year.name !== basis.years[index].name || year.start !== basis.years[index].start || year.end !== basis.years[index].end);
    } catch {
      stale = false;
    }
  }
  return stale ? { projectEnd, coveredYears: basis.years.map((year) => year.name) } : null;
}
