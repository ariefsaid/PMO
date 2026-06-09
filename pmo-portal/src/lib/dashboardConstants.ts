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

/**
 * Returns true if the project is active AND has spent ≥ AT_RISK_THRESHOLD of its budget.
 * Shared helper used by PMDashboard, Projects list, and BvACard for consistent at-risk
 * classification (OD-W5-C2-A: one rule in one place).
 */
export function isAtRisk(p: { status: string; budget: number; spent: number }): boolean {
  return (
    ACTIVE_PROJECT_STATUSES.has(p.status) &&
    p.budget > 0 &&
    p.spent / p.budget >= AT_RISK_THRESHOLD
  );
}

/**
 * Returns the budget utilization percentage (spent/budget × 100), or null if budget is zero.
 * Used to display the budget-basis reason on at-risk rows (I3).
 */
export function budgetUtilPct(p: { budget: number; spent: number }): number | null {
  return p.budget > 0 ? Math.round((p.spent / p.budget) * 100) : null;
}
