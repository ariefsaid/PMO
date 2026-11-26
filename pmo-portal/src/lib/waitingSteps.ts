import type { WaitingStep } from '@/src/lib/db/billingSteps';

/**
 * #2680 — the needs-you pointer for billing steps waiting on the viewer's role (docs/specs/claim-billing-steps.spec.md FR-CBS-041).
 * Pure: the rows come from `my_waiting_billing_steps`, which derives them from the claims' own step rows, so a step that completes,
 * is skipped or is removed simply is not in the next read. Nothing is stored here and nothing is cleared.
 */
export interface WaitingStepsFact {
  count: number;
  /** Steps already past their target date. */
  overdue: number;
  /** Days over target of the longest-overdue step, null when none is overdue. */
  oldestOverdueDays: number | null;
  /** The waiting claim, its project billing tab, or the project list. */
  href: string;
}

export function summariseWaitingSteps(rows: ReadonlyArray<WaitingStep>): WaitingStepsFact | null {
  if (rows.length === 0) return null;
  const overdue = rows.filter((r) => r.daysOver > 0);
  const projects = new Set(rows.map((r) => r.projectId));
  const billingHref = projects.size === 1 ? `/projects/${encodeURIComponent(rows[0].projectId)}/billing` : '/projects';
  const href = rows.every((row) => row.claimId === rows[0].claimId) && projects.size === 1
    ? `${billingHref}?open=${encodeURIComponent(rows[0].claimId)}&openType=billingClaim`
    : billingHref;
  return {
    count: rows.length,
    overdue: overdue.length,
    oldestOverdueDays: overdue.length > 0 ? Math.max(...overdue.map((r) => r.daysOver)) : null,
    href,
  };
}
