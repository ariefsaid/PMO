import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/src/components/ui/Avatar';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { cn } from '@/src/components/ui/cn';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import type { AttentionProject } from '@/src/lib/db/dashboard';

/** A non-project attention row (approvals waiting, projects without a budget, …) listed after the projects. */
export interface AttentionExtra { id: string; title: string; meta?: React.ReactNode; pill: string; href: string; tone: 'warn' | 'lost' | 'neutral' }

const AVATAR_TONE = { lost: 'bg-destructive-solid text-destructive-foreground', warn: 'bg-warning text-white', neutral: 'bg-primary text-primary-foreground' } as const;

const Row: React.FC<{ href: string; initialsOf: string; name: string; tone: keyof typeof AVATAR_TONE; title: string; meta?: React.ReactNode; pill: React.ReactNode; pillVariant: 'warn' | 'lost' | 'open' }> = ({ href, initialsOf, name, tone, title, meta, pill, pillVariant }) => (
  <li className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
    <Avatar name={name} initials={initialsOf} size="md" decorative className={cn(AVATAR_TONE[tone])} />
    <div className="min-w-0 flex-1">
      <Link to={href} className="block break-words text-sm font-semibold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{title}</Link>
      {meta && <p className="break-words text-xs text-muted-foreground">{meta}</p>}
    </div>
    <StatusPill variant={pillVariant}>{pill}</StatusPill>
  </li>
);

/**
 * Ranking rule (#1418, 0732): the server ranks every active project by how many distinct attention signals it
 * carries (overdue work, over budget, waiting approvals), then by overdue items, and cuts to five. The array
 * arrives in that order; this list shows it and never re-sorts it.
 */
export const AttentionProjects: React.FC<{ projects: AttentionProject[]; extras?: AttentionExtra[] }> = ({ projects, extras = [] }) => {
  const { t } = useTranslation('dashboard');
  const statusLabel = useProjectStatusLabel();
  if (projects.length === 0 && extras.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{t('hub.company.attentionClear', 'Nothing needs attention right now')}</p>;
  return (
    <ol aria-label={t('hub.company.attentionListName', 'Projects that need attention, most urgent first')} className="divide-y divide-border">
      {projects.map((row) => {
        const name = projectDisplayName(row);
        const overPercent = row.over_budget && row.budget_used_ratio !== null && Number.isFinite(row.budget_used_ratio) ? Math.round((row.budget_used_ratio - 1) * 100) : null;
        const meta = [
          row.overdue_items > 0 ? t('hub.company.attentionOverdue', { count: row.overdue_items, defaultValue: '{{count}} overdue', defaultValue_one: '{{count}} overdue' }) : null,
          row.waiting_approvals > 0 ? t('hub.company.attentionApprovals', { count: row.waiting_approvals, defaultValue: '{{count}} awaiting approval', defaultValue_one: '{{count}} awaiting approval' }) : null,
        ].filter(Boolean).join(' · ');
        const pill = overPercent !== null
          ? t('hub.company.attentionOverBudget', '{{percent}}% over budget', { percent: overPercent })
          : row.overdue_items > 0
            ? t('hub.company.attentionOverdue', { count: row.overdue_items, defaultValue: '{{count}} overdue', defaultValue_one: '{{count}} overdue' })
            : row.waiting_approvals > 0
              ? t('hub.company.attentionApprovals', { count: row.waiting_approvals, defaultValue: '{{count}} awaiting approval', defaultValue_one: '{{count}} awaiting approval' })
              : statusLabel(row.status);
        return <Row key={row.id} href={`/projects/${row.id}`} initialsOf={name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()} name={name} tone={overPercent !== null ? 'lost' : 'warn'} title={name} meta={meta} pill={pill} pillVariant={overPercent !== null ? 'lost' : 'warn'} />;
      })}
      {extras.map((item) => <Row key={item.id} href={item.href} initialsOf={item.title.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()} name={item.title} tone="neutral" title={item.title} meta={item.meta} pill={item.pill} pillVariant="open" />)}
    </ol>
  );
};
