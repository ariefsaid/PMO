import type { MoneyFigure } from '@/src/lib/dashboardMoney';
import { moneyFigure } from '@/src/lib/dashboardMoney';
import { formatNumberMax2 } from '@/src/lib/format';
import type { PMDashboardProject } from '@/src/lib/db/dashboard';
import type { TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';
import { isActualComplete, projectBudgetUsedPercent } from '@/src/lib/projectFinances';
import type { CanonicalBudgetReading } from '@/src/lib/db/projectMoney';
import { orderByCurrency } from '../../restructure/currencyOrder';

export type ProjectMoneyField = 'contract_value' | 'contract_remaining' | 'realized_margin';

/** Summarize one project money field without combining currencies or hiding incomplete rows. */
export function projectMoneyFigure(
  projects: readonly PMDashboardProject[],
  field: ProjectMoneyField,
  orgCurrency: string,
  unavailableReason: string,
): MoneyFigure {
  if (projects.length === 0) return moneyFigure(0, orgCurrency, unavailableReason);

  const totals = new Map<string, number>();
  for (const project of projects) {
    const amount = project[field];
    if (!project.currency || amount === null || amount === undefined || !Number.isFinite(amount)) {
      return { value: '—', unavailableReason };
    }
    totals.set(project.currency, (totals.get(project.currency) ?? 0) + amount);
  }

  const grouped = orderByCurrency([...totals].map(([currency, amount]) => ({ currency, amount })), orgCurrency);
  const figures = grouped.map(({ currency, amount }) => ({
    currency,
    figure: moneyFigure(amount, currency, unavailableReason, { code: currency !== orgCurrency }),
  }));
  if (figures.some(({ figure }) => figure.unavailableReason)) {
    return { value: '—', unavailableReason };
  }
  const value = figures.map(({ figure }) => figure.value).join(' · ');
  const exactValue = figures.map(({ figure }) => figure.exactValue ?? figure.value).join(' · ');
  return exactValue === value ? { value } : { value, exactValue };
}

export function sumAwaitingTimesheetHours(
  timesheets: readonly TimesheetAwaitingApproval[] | undefined,
): number | null {
  if (timesheets === undefined) return null;

  let total = 0;
  for (const timesheet of timesheets) {
    if (!Array.isArray(timesheet.entries)) return null;
    for (const entry of timesheet.entries) {
      if (!Number.isFinite(entry.hours)) return null;
      total += entry.hours;
    }
  }
  return Number.isFinite(total) ? total : null;
}

export function formatHours(hours: number): string {
  return formatNumberMax2(hours);
}

export function projectActualComplete(project: PMDashboardProject): boolean {
  return isActualComplete({
    basis: 'erp',
    readSucceeded: project.spent !== null,
    complete: project.actual_complete,
    coverageCount: project.actual_coverage_count,
    coverageTotal: project.actual_coverage_total,
  });
}

export function projectRiskBasisKnown(reading: CanonicalBudgetReading | undefined, projectCurrency?: string | null): boolean {
  if (!reading || reading.currency === null || reading.currency !== reading.budgetCurrency
    || (projectCurrency != null && reading.currency !== projectCurrency)) return false;
  return !reading.riskEligible || reading.atRisk !== null;
}

export function projectAtRisk(reading: CanonicalBudgetReading | undefined, projectCurrency?: string | null): boolean {
  return projectRiskBasisKnown(reading, projectCurrency) && reading?.atRisk === true;
}

export function projectSpendOfContractPct(project: PMDashboardProject): number | null {
  if (!projectActualComplete(project)
    || project.contract_value === null
    || !Number.isFinite(project.contract_value)
    || project.contract_value <= 0
    || project.spent === null
    || !Number.isFinite(project.spent)
    || (project.actual_currency ?? project.currency) !== project.currency) return null;

  return Math.round((project.spent / project.contract_value) * 100);
}

export function projectBudgetUsagePct(reading: CanonicalBudgetReading | undefined, projectCurrency?: string | null): number | null {
  return projectBudgetUsedPercent(reading, projectCurrency);
}

/**
 * At-risk projects. Unknown budget data never hides a project already known to be at risk:
 * then the count is a floor ("at least N"). Null only when nothing is known at risk and some are unknown.
 */
export function atRiskCount(
  projects: readonly PMDashboardProject[],
  positions: Readonly<Record<string, CanonicalBudgetReading>>,
): { count: number; partial: boolean } | null {
  const count = projects.filter((project) => projectAtRisk(positions[project.id], project.currency)).length;
  const partial = projects.some((project) => !projectRiskBasisKnown(positions[project.id], project.currency));
  if (partial && count === 0) return null;
  return { count, partial };
}
