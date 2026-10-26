import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { isMoneyAtRisk, ACTIVE_PROJECT_STATUSES } from '@/src/lib/dashboardConstants';
import { isActualComplete } from '@/src/lib/projectFinances';
import type { TopProject } from '@/src/lib/db/dashboard';

export type ExecutiveRiskState = 'at-risk' | 'within-budget' | 'unchecked' | 'not-active';

export function executiveRiskState(project: TopProject): ExecutiveRiskState {
  if (!ACTIVE_PROJECT_STATUSES.has(project.status)) return 'not-active';
  const actualComplete = isActualComplete({
    basis: 'erp',
    readSucceeded: project.spent !== null,
    complete: project.actual_complete,
    coverageCount: project.actual_coverage_count,
    coverageTotal: project.actual_coverage_total,
  });
  const hasRiskBasis = actualComplete
    && typeof project.budget === 'number' && Number.isFinite(project.budget) && project.budget > 0
    && typeof project.spent === 'number' && Number.isFinite(project.spent)
    && (project.actual_currency ?? project.currency) === (project.budget_currency ?? project.currency)
    && (project.actual_currency ?? project.currency) === project.currency;
  if (!hasRiskBasis) return 'unchecked';
  return isMoneyAtRisk({
    status: project.status,
    budget: project.budget,
    budgetCurrency: project.budget_currency ?? project.currency,
    projectCurrency: project.currency,
    spent: project.spent,
    actualCurrency: project.actual_currency ?? project.currency,
    actualComplete,
  }) ? 'at-risk' : 'within-budget';
}

export function sortExecutiveProjects(projects: TopProject[]): TopProject[] {
  const riskOrder: Record<ExecutiveRiskState, number> = {
    'at-risk': 0,
    'within-budget': 1,
    'not-active': 1,
    unchecked: 1,
  };
  return [...projects].sort((left, right) => {
    const riskDifference = riskOrder[executiveRiskState(left)] - riskOrder[executiveRiskState(right)];
    if (riskDifference !== 0) return riskDifference;
    const nameDifference = projectDisplayName(left).localeCompare(projectDisplayName(right), undefined, { sensitivity: 'base' });
    return nameDifference || left.id.localeCompare(right.id);
  });
}
