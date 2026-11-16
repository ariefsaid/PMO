import { calendarAgeDays } from '@/src/lib/finance/financePosition';
import { projectStatusGroup } from '@/src/lib/db/projectTransitions';
import { projectBudgetUsedPercent } from '@/src/lib/projectFinances';
import type { ProjectMoneyRead } from '@/src/lib/db/projectMoney';

/**
 * Whole days a project is past its end date, or null when it cannot be late (lost, closed out, no
 * end date) or is not past it yet. ONE rule for the Projects list and the project record header, so
 * "late" on a row and the late pill on its record never disagree.
 */
export function projectLateDays(
  project: { status: string | null | undefined; end_date?: string | null },
  today: string | null | undefined,
): number | null {
  const status = (project.status ?? '') as string;
  if (projectStatusGroup(status as never) === 'lost' || status === 'Close Out') return null;
  const days = calendarAgeDays(project.end_date, today);
  return days !== null && days > 0 ? days : null;
}

/**
 * The list's "Budget used" percent for one project, or null when it cannot be stated (no Active
 * budget, a zero budget, a currency that differs from the project's). The figure itself is the
 * shared `projectBudgetUsedPercent` reading; this only names when the list may show it.
 */
export function projectBudgetUsed(
  project: { currency: string },
  money: ProjectMoneyRead | null | undefined,
): number | null {
  if (!money?.hasActiveBudget || money.activeBudgetAmount == null) return null;
  if (Number(money.activeBudgetAmount) === 0) return null;
  const reading = money.budgetPosition;
  if (reading?.budgetCurrency !== project.currency || reading?.currency !== project.currency) return null;
  return projectBudgetUsedPercent(reading, project.currency);
}

/** Over budget = spending past the Active budget (budget used above 100%). */
export function projectOverBudget(project: { currency: string }, money: ProjectMoneyRead | null | undefined): boolean {
  const used = projectBudgetUsed(project, money);
  return used !== null && used > 100;
}
