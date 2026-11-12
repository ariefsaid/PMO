import React from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead } from '@/src/components/ui/Card';
import { cn } from '@/src/components/ui/cn';
import { ListState } from '@/src/components/ui/ListState';
import { RowMenu } from '@/src/components/ui/RowMenu';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { statusLabel, statusTone, toneVariant } from '@/src/lib/status/statusMap';
import { formatTileMoney } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import type { AttentionProject } from '@/src/lib/db/dashboard';
import { CardLink } from './OverviewCards';
import { bulletFor, contractShare, overBudget, overdueTaskCount, type Bullet, type BulletTone } from './homeHealth';

const FILL: Record<BulletTone, string> = { data: 'bg-primary', ahead: 'bg-warning', over: 'bg-destructive' };

/** Budget track with the spent share filled and a tick at the share delivered. The words beside it carry the values. */
const BulletBar: React.FC<{ bullet: Bullet | null }> = ({ bullet }) => (
  <span aria-hidden data-testid="health-bullet" data-tone={bullet?.tone} className={cn('relative block h-2 w-full rounded-full', bullet?.spent == null ? 'border border-dashed border-input' : 'bg-muted')}>
    {bullet?.spent != null && <span className={cn('absolute inset-y-0 left-0 rounded-full', FILL[bullet.tone])} style={{ width: `${Math.min(1, bullet.spent) * 100}%` }} />}
    {bullet?.delivered != null && <span data-testid="health-delivered-tick" className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: `${bullet.delivered * 100}%` }} />}
  </span>
);

/**
 * Project health: one row per project, worst first. What is wrong in words (non-zero only; overdue and late in red),
 * then budget against actual spending as a bullet bar with the share delivered marked.
 */
export const ProjectHealthCard: React.FC<{
  rows: AttentionProject[];
  delivery: Record<string, number> | undefined;
  pending: boolean;
  error: boolean;
  retry: () => void;
  className?: string;
  /** Project manager per project id (from the project list); unknown managers are left out of the row. */
  owners?: Map<string, string | null>;
  /** How many projects the "All projects" list holds; the link names it once known. */
  projectCount?: number;
}> = ({ rows, delivery, pending, error, retry, className, owners, projectCount }) => {
  const { t } = useTranslation('dashboard');
  const { t: ts } = useTranslation('status');
  const navigate = useNavigate();
  const money = (amount: number, currency: string) => formatTileMoney(amount, currency) ?? '';
  // The count is the list the link opens (every project), not the rows above it.
  const allLabel = projectCount ? t('home.allProjects', 'All {{count}} projects', { count: projectCount }) : t('home.allProjectsBare', 'All projects');
  return (
    <Card data-testid="project-health" className={cn('flex flex-col', className)}>
      <CardHead level={2} actions={<CardLink to="/projects">{allLabel}</CardLink>}>{t('home.projectHealth', 'Project health')}</CardHead>
      <div className="flex-1 px-[var(--panel-inset)] pb-2">
        {pending ? <ListState variant="loading" rows={4} />
          : error ? <ListState variant="error" title={t('home.projectsError', "Couldn't load projects")} onRetry={retry} />
            : rows.length === 0 ? <p className="pb-2 text-control text-muted-foreground">{t('home.noActiveProjects', 'No active projects.')}</p>
              : (
                <ul className="divide-y divide-border">
                  {rows.map((row) => {
                    const tasks = overdueTaskCount(row);
                    const wrong = [
                      tasks ? { key: 'tasks', red: true, text: t('home.mobileTasksOverdue', { count: tasks, defaultValue_one: '{{count}} task overdue', defaultValue_other: '{{count}} tasks overdue' }) } : null,
                      row.overdue_milestones > 0 ? { key: 'phases', red: true, text: t('home.mobilePhasesLate', { count: row.overdue_milestones, defaultValue_one: '{{count}} phase late', defaultValue_other: '{{count}} phases late' }) } : null,
                      row.overdue_invoices > 0 ? { key: 'invoices', red: true, text: t('home.mobileInvoicesOverdue', { count: row.overdue_invoices, defaultValue_one: '{{count}} invoice overdue', defaultValue_other: '{{count}} invoices overdue' }) } : null,
                      overBudget(row) ? { key: 'budget', red: true, text: t('home.overBudget', 'Over budget') } : null,
                      row.waiting_approvals > 0 ? { key: 'approvals', red: false, text: t('home.mobileAwaitingApproval', { count: row.waiting_approvals, defaultValue_one: '{{count}} awaiting approval', defaultValue_other: '{{count}} awaiting approval' }) } : null,
                    ].filter((fact): fact is { key: string; red: boolean; text: string } => fact !== null);
                    const deliveredPct = delivery?.[row.id] ?? null;
                    const bullet = bulletFor(row, deliveredPct);
                    const currency = row.budget_currency ?? row.currency;
                    const delivered = deliveredPct === null ? '' : ` · ${t('home.deliveredPct', '{{percent}}% delivered', { percent: Math.round(deliveredPct) })}`;
                    const budgetWords = !bullet
                      ? t('home.noActiveBudget', 'No active budget')
                      : bullet.spent === null
                        ? `${t('home.noSpendingRecorded', 'No spending recorded')} · ${t('home.budgetOf', '{{amount}} budget', { amount: money(row.budget as number, currency) })}`
                        : t('home.spentOfBudget', '{{spent}} spent of {{budget}} budget', { spent: money(row.spent as number, currency), budget: money(row.budget as number, currency) });
                    const name = projectDisplayName(row);
                    const manager = owners?.get(row.id) ?? null;
                    const share = contractShare(row);
                    const contractWords = row.contract_value == null ? null : [
                      t('home.contractShort', 'Contract {{amount}}', { amount: money(row.contract_value, row.currency) }),
                      share === null ? null : t('home.contractSharePct', '{{percent}}% of contract', { percent: share }),
                    ].filter(Boolean).join(' · ');
                    return (
                      <li key={row.id} className="flex items-start gap-1">
                        <Link to={`/projects/${row.id}`} title={name !== row.name ? row.name : undefined} className="grid min-w-0 flex-1 gap-y-1 py-4 text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          <span className="flex min-w-0 items-center justify-between gap-3">
                            <span className="min-w-0 truncate text-control"><span className="font-medium">{name}</span>{manager && <span className="text-muted-foreground"> · {manager}</span>}</span>
                            <StatusPill wrap={false} className="shrink-0" variant={toneVariant(statusTone('project', row.status) === 'exception' ? 'exception' : 'neutral')}>{statusLabel('project', row.status, ts)}</StatusPill>
                          </span>
                          <span data-testid="health-wrong" className="text-control tabular">
                            {wrong.length === 0
                              ? <span className="text-muted-foreground">{t('home.nothingOverdue', 'Nothing overdue')}</span>
                              : wrong.map((fact, index) => (
                                // The dot travels with the phrase after it, so a wrapped line never ends on a separator.
                                <React.Fragment key={fact.key}>
                                  {index > 0 && ' '}
                                  <span className="whitespace-nowrap">
                                    {index > 0 && <span aria-hidden className="text-muted-foreground">·&nbsp;</span>}
                                    <span className={fact.red ? 'text-destructive-text' : 'text-foreground'}>{fact.text}</span>
                                  </span>
                                </React.Fragment>
                              ))}
                          </span>
                          <span className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 text-control tabular">
                            <span className={cn(bullet?.spent == null ? 'text-muted-foreground' : 'text-foreground')}>{budgetWords}{bullet ? delivered : ''}</span>
                            {contractWords && <span className="text-muted-foreground">{contractWords}</span>}
                          </span>
                          <BulletBar bullet={bullet} />
                        </Link>
                        <span className="pt-3">
                          <RowMenu ariaLabel={t('dashboard:hub.company.rowActionsFor', 'Row actions for {{name}}', { name })} items={[
                            { label: t('dashboard:hub.company.openProject', 'Open project'), onClick: () => navigate(`/projects/${row.id}`) },
                            { label: t('dashboard:hub.company.openBudget', 'Open budget'), onClick: () => navigate(`/projects/${row.id}/budget`) },
                            { label: t('dashboard:hub.company.openProcurements', 'Open procurements'), onClick: () => navigate(`/procurement?project=${encodeURIComponent(row.id)}`) },
                          ]} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
      </div>
    </Card>
  );
};
