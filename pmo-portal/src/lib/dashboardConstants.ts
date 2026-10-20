/**
 * Shared dashboard constants — single source of truth so KPI tiles, drill-filter,
 * and sort logic all agree (OD-W5-C2-A).
 */

/**
 * A project is "at-risk" when its actual spend reaches or exceeds this fraction of
 * its budget. Mirrors the `projects_at_risk` RPC rule already in PMDashboard and
 * BvACard — centralized here so every consumer agrees (Wave-5 Cluster-2 PR-A).
 */
export const AT_RISK_THRESHOLD = 0.9;

/** A risk result is meaningful only when every active-delivery project has a usable basis. */
export function riskCheckableFor(activeDeliveryProjects: number, uncheckedProjects: number): boolean {
  return activeDeliveryProjects > 0 && uncheckedProjects === 0;
}

export interface MoneyRiskInput {
  status: string;
  budget: number | null;
  budgetCurrency: string | null;
  projectCurrency: string;
  spent: number | null;
  actualCurrency: string | null;
  actualComplete: boolean;
}

/** One cross-surface at-risk rule: known complete Actual, same currency, positive budget. */
export function isMoneyAtRisk(p: MoneyRiskInput): boolean {
  return ACTIVE_PROJECT_STATUSES.has(p.status)
    && p.actualComplete
    && p.budget !== null && Number.isFinite(p.budget) && p.budget > 0
    && p.spent !== null && Number.isFinite(p.spent)
    && p.actualCurrency !== null && p.actualCurrency === p.budgetCurrency
    && p.actualCurrency === p.projectCurrency
    && p.spent / p.budget >= AT_RISK_THRESHOLD;
}

/**
 * Statuses that count as "active" (delivery in progress) for the at-risk gate.
 * Aligns with the ONGOING partition in Projects.tsx and the at-risk filter.
 * Internal Project is included because it is an active delivery engagement.
 * AC-IXD-DASH-W5-C2C (N18): used by PMDashboard + Projects list sort.
 */
export const ACTIVE_PROJECT_STATUSES = new Set([
  'Ongoing Project',
  'Won, Pending KoM',
  'On Hold',
  'Internal Project',
]);

/** Progress may be recorded during pending handover, active delivery, or a pause; terminal and internal work is excluded. */
export const PROGRESS_RECORDABLE_PROJECT_STATUSES = new Set([
  'Won, Pending KoM',
  'Ongoing Project',
  'On Hold',
]);

/**
 * Returns the budget utilization percentage (spent/budget × 100), or null if budget is zero.
 * Used to display the budget-basis reason on at-risk rows (I3).
 */
export function budgetUtilPct(p: { budget: number; spent: number }): number | null {
  return p.budget > 0 ? Math.round((p.spent / p.budget) * 100) : null;
}
