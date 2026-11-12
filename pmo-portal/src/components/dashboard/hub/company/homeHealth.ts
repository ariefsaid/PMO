import type { AttentionProject } from '@/src/lib/db/dashboard';

/** Over budget on the dashboard's at-risk basis (consumption against the active budget). */
export const overBudget = (row: AttentionProject) => row.over_budget || (row.budget_used_ratio !== null && row.budget_used_ratio >= 1);

/** Overdue tasks, or null when the count is unknown (never a 0 that was not counted). */
export const overdueTaskCount = (row: AttentionProject): number | null => (typeof row.overdue_tasks === 'number' ? row.overdue_tasks : null);

export const isOffTrack = (row: AttentionProject) => overBudget(row) || (overdueTaskCount(row) ?? 0) > 0 || row.overdue_milestones > 0 || row.overdue_invoices > 0;

/**
 * Project health rows, worst first: off-track projects before the rest; then more kinds of trouble (the server's
 * attention signals), then more overdue items, then the larger share of budget used. At most `limit`.
 */
export function healthOrder(rows: AttentionProject[], limit = 6): AttentionProject[] {
  const score = (row: AttentionProject) => [isOffTrack(row) ? 1 : 0, row.attention_signals, (overdueTaskCount(row) ?? 0) + row.overdue_milestones + row.overdue_invoices, row.budget_used_ratio ?? -1];
  return [...rows].sort((a, b) => {
    const sa = score(a); const sb = score(b);
    for (let i = 0; i < sa.length; i += 1) if (sa[i] !== sb[i]) return sb[i] - sa[i];
    return 0;
  }).slice(0, limit);
}

export type BulletTone = 'data' | 'ahead' | 'over';

export interface Bullet {
  /** Spent as a share of budget (may pass 1); null when spending is not recorded. */
  spent: number | null;
  /** Share delivered (0–1); null when unknown. */
  delivered: number | null;
  /** Within plan = the data hue; spending ahead of delivery = warning; past the budget = over. */
  tone: BulletTone;
}

/**
 * Budget against ACTUAL spending for one project: the track is the budget, the fill the share spent, the tick the
 * share delivered. Spending counts only when complete and in the budget's currency; otherwise it is unknown.
 */
export function bulletFor(project: Pick<AttentionProject, 'budget' | 'spent' | 'actual_complete' | 'actual_currency' | 'budget_currency' | 'currency'>, deliveredPct: number | null): Bullet | null {
  const budgetCurrency = project.budget_currency ?? project.currency;
  if (project.budget == null || project.budget <= 0) return null;
  const known = project.spent != null && Boolean(project.actual_complete) && (project.actual_currency ?? project.currency) === budgetCurrency;
  const spent = known ? (project.spent as number) / project.budget : null;
  const delivered = deliveredPct == null ? null : Math.max(0, Math.min(1, deliveredPct / 100));
  const tone: BulletTone = spent === null ? 'data' : spent > 1 ? 'over' : delivered !== null && spent > delivered ? 'ahead' : 'data';
  return { spent, delivered, tone };
}
