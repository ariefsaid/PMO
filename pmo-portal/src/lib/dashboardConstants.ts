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
