import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import type { AttentionProject } from '@/src/lib/db/dashboard';

/**
 * Ranking rule (#1418, 0732): the server ranks every active project by how many distinct attention signals it
 * carries (overdue work, over budget, waiting approvals), then by overdue items, and cuts to five. The array
 * arrives in that order; this list numbers it and never re-sorts it.
 */
export const AttentionProjects: React.FC<{ projects: AttentionProject[] }> = ({ projects }) => {
  const { t } = useTranslation('dashboard');
  const statusLabel = useProjectStatusLabel();
  if (projects.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{t('hub.company.attentionClear', 'Nothing needs attention right now')}</p>;
  return (
    <ol aria-label={t('hub.company.attentionListName', 'Projects that need attention, most urgent first')} className="divide-y divide-border">
      {projects.map((row, index) => {
        const reason = [
          row.overdue_items > 0 ? t('hub.company.attentionOverdue', { count: row.overdue_items, defaultValue: '{{count}} overdue', defaultValue_one: '{{count}} overdue' }) : null,
          row.over_budget && row.budget_used_ratio !== null && Number.isFinite(row.budget_used_ratio)
            ? t('hub.company.attentionOverBudget', '{{percent}}% over budget', { percent: Math.round((row.budget_used_ratio - 1) * 100) })
            : null,
          row.waiting_approvals > 0 ? t('hub.company.attentionApprovals', { count: row.waiting_approvals, defaultValue: '{{count}} awaiting approval', defaultValue_one: '{{count}} awaiting approval' }) : null,
        ].filter(Boolean).join(' · ');
        return (
          <li key={row.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
            <span className="w-4 shrink-0 pt-px text-right text-xs font-semibold tabular text-muted-foreground">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <Link to={`/projects/${row.id}`} className="block break-words text-sm font-medium hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{projectDisplayName(row)}</Link>
              {reason && <p className="break-words text-xs text-muted-foreground">{reason}</p>}
            </div>
            <StatusPill variant="warn">{statusLabel(row.status)}</StatusPill>
          </li>
        );
      })}
    </ol>
  );
};
