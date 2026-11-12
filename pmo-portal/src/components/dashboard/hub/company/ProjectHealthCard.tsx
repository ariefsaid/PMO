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

type Fact = { key: string; red: boolean; text: string };
/** What a home adds to one project's row (the company home: the manager; the PM home: identifiers, margin, open items). */
export interface HealthExtras {
  /** After the name, muted ("Dana Lee", or "PRJ-26-0002 · Acme · USD"). */
  meta?: string;
  /** Replaces the row's own words for what is wrong. */
  facts?: Fact[];
  /** After the contract figure ("Margin to date $12K"). */
  figures?: string;
  /** Open items, each its own link under the row (a project's overdue tasks, each purchase to approve). */
  items?: Array<{ key: string; label: string; href: string; red?: boolean }>;
}

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
  /** Per-project additions, by project id. */
  extras?: Map<string, HealthExtras>;
  /** How many projects the "All projects" list holds; the link names it once known. */
  projectCount?: number;
  title?: string;
  /** Replaces the header link (e.g. "All 3 projects" scoped to my projects). */
  allLink?: { to: string; label: string };
  /** A row with nothing wrong (default "Nothing overdue"). */
  quietLabel?: string;
  emptyLabel?: string;
  testId?: string;
}> = ({ rows, delivery, pending, error, retry, className, extras, projectCount, title, allLink, quietLabel, emptyLabel, testId = 'project-health' }) => {
  const { t } = useTranslation('dashboard');
  const { t: ts } = useTranslation('status');
  const navigate = useNavigate();
  const money = (amount: number, currency: string) => formatTileMoney(amount, currency) ?? '';
  // The count is the list the link opens (every project), not the rows above it.
  const allLabel = projectCount ? t('home.allProjects', 'All {{count}} projects', { count: projectCount }) : t('home.allProjectsBare', 'All projects');
  return (
    <Card data-testid={testId} className={cn('flex flex-col', className)}>
      <CardHead level={2} actions={<CardLink to={allLink?.to ?? '/projects'}>{allLink?.label ?? allLabel}</CardLink>}>{title ?? t('home.projectHealth', 'Project health')}</CardHead>
      <div className="flex-1 px-[var(--panel-inset)] pb-2">
        {pending ? <ListState variant="loading" rows={4} />
          : error ? <ListState variant="error" title={t('home.projectsError', "Couldn't load projects")} onRetry={retry} />
            : rows.length === 0 ? <p className="pb-2 text-control text-muted-foreground">{emptyLabel ?? t('home.noActiveProjects', 'No active projects.')}</p>
              : (
                <ul className="@container divide-y divide-border">
                  {rows.map((row) => {
                    const extra = extras?.get(row.id);
                    const tasks = overdueTaskCount(row);
                    const wrong = extra?.facts ?? [
                      tasks ? { key: 'tasks', red: true, text: t('home.mobileTasksOverdue', { count: tasks, defaultValue_one: '{{count}} task overdue', defaultValue_other: '{{count}} tasks overdue' }) } : null,
                      row.overdue_milestones > 0 ? { key: 'phases', red: true, text: t('home.mobilePhasesLate', { count: row.overdue_milestones, defaultValue_one: '{{count}} phase late', defaultValue_other: '{{count}} phases late' }) } : null,
                      row.overdue_invoices > 0 ? { key: 'invoices', red: true, text: t('home.mobileInvoicesOverdue', { count: row.overdue_invoices, defaultValue_one: '{{count}} invoice overdue', defaultValue_other: '{{count}} invoices overdue' }) } : null,
                      overBudget(row) ? { key: 'budget', red: true, text: t('home.overBudget', 'Over budget') } : null,
                      row.waiting_approvals > 0 ? { key: 'approvals', red: false, text: t('home.mobileAwaitingApproval', { count: row.waiting_approvals, defaultValue_one: '{{count}} awaiting approval', defaultValue_other: '{{count}} awaiting approval' }) } : null,
                    ].filter((fact): fact is Fact => fact !== null);
                    const items = extra?.items ?? [];
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
                    const share = contractShare(row);
                    const contractWords = [
                      row.contract_value == null ? null : t('home.contractShort', 'Contract {{amount}}', { amount: money(row.contract_value, row.currency) }),
                      row.contract_value == null || share === null ? null : t('home.contractSharePct', '{{percent}}% of contract', { percent: share }),
                      extra?.figures ?? null,
                    ].filter(Boolean).join(' · ');
                    return (
                      <li key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-1">
                        <Link to={`/projects/${row.id}`} title={name !== row.name ? row.name : undefined} className="grid min-w-0 flex-1 gap-y-1 py-4 text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          <span className="flex min-w-0 items-center justify-between gap-3">
                            <span className="min-w-0 truncate text-control"><span className="font-medium">{name}</span>{extra?.meta && <span className="text-muted-foreground"> · {extra.meta}</span>}</span>
                            <StatusPill wrap={false} className="shrink-0" variant={toneVariant(statusTone('project', row.status) === 'exception' ? 'exception' : 'neutral')}>{statusLabel('project', row.status, ts)}</StatusPill>
                          </span>
                          {/* Reasons wrap as separate phrases: no separator can start a line. */}
                          {(wrong.length > 0 || items.length === 0) && <span data-testid="health-wrong" className="flex flex-wrap gap-x-3 text-control tabular">
                            {wrong.length === 0
                              ? <span className="text-muted-foreground">{quietLabel ?? t('home.nothingOverdue', 'Nothing overdue')}</span>
                              : wrong.map((fact) => <span key={fact.key} className={cn('whitespace-nowrap', fact.red ? 'text-destructive-text' : 'text-foreground')}>{fact.text}</span>)}
                          </span>}
                          {/* One shape in every row: spend left, contract right where the card is 48rem or wider (room for the longest row), else both on their own line. */}
                          <span data-testid="health-money" className="mt-1 grid gap-x-3 text-control tabular @[48rem]:grid-cols-[auto_auto] @[48rem]:justify-between @[48rem]:whitespace-nowrap">
                            <span data-testid="health-spend" className={cn(bullet?.spent == null ? 'text-muted-foreground' : 'text-foreground')}>{budgetWords}{bullet ? delivered : ''}</span>
                            {contractWords && <span data-testid="health-contract" className="text-muted-foreground @[48rem]:text-right">{contractWords}</span>}
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
                        {items.length > 0 && (
                          <ul data-testid="health-items" className="col-span-2 -mt-2 flex flex-wrap gap-x-4 pb-3 text-control">
                            {items.map((item) => (
                              <li key={item.key}><Link to={item.href} className={cn('inline-flex items-center underline decoration-border underline-offset-4 hover:decoration-foreground pointer-coarse:min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', item.red ? 'text-destructive-text' : 'text-foreground')}>{item.label}</Link></li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
      </div>
    </Card>
  );
};
