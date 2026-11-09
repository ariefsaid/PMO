import type { TFunction } from 'i18next';
import type { AttentionProject } from '@/src/lib/db/dashboard';

/** The strongest signal a project carries, as a pill: over budget, then overdue, then waiting approvals. `null` = no signal. */
export function attentionSignal(row: AttentionProject, t: TFunction<'dashboard'>): { label: string; variant: 'lost' | 'warn' } | null {
  const overPercent = row.over_budget && row.budget_used_ratio !== null && Number.isFinite(row.budget_used_ratio) ? Math.round((row.budget_used_ratio - 1) * 100) : null;
  if (overPercent !== null) return { label: t('hub.company.attentionOverBudget', '{{percent}}% over budget', { percent: overPercent }), variant: 'lost' };
  if (row.overdue_items > 0) return { label: t('hub.company.attentionOverdue', { count: row.overdue_items, defaultValue: '{{count}} overdue', defaultValue_one: '{{count}} overdue' }), variant: 'warn' };
  if (row.waiting_approvals > 0) return { label: t('hub.company.attentionApprovals', { count: row.waiting_approvals, defaultValue: '{{count}} awaiting approval', defaultValue_one: '{{count}} awaiting approval' }), variant: 'warn' };
  return null;
}
