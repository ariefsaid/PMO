import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead } from '@/src/components/ui/Card';
import { Icon } from '@/src/components/ui/icons';
import { ListState } from '@/src/components/ui/ListState';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { cn } from '@/src/components/ui/cn';
import { statusLabel, statusTone, toneVariant } from '@/src/lib/status/statusMap';
import { useMyTasks } from '@/src/hooks/useMyTasks';
import { useOrgToday } from '@/src/hooks/useOrgToday';

/** Colour means exception only: overdue / over budget = red (`lost`), waiting on someone = amber (`warn`), the rest grey. */
export type DashTone = 'lost' | 'warn' | 'neutral';

const COUNT_TONE: Record<DashTone, string> = {
  lost: 'text-destructive-text',
  warn: 'text-warning-foreground',
  neutral: 'text-foreground',
};

export interface WaitRow {
  id: string;
  /** The number the row is about (or a short phrase such as "At least 3"). */
  count: React.ReactNode;
  label: string;
  /** Money or hours the row stands for, right-aligned. */
  amount?: React.ReactNode;
  /** One short fact after the label ("oldest 118 days overdue"). */
  detail?: string;
  href: string;
  tone: DashTone;
}

const Chevron = () => <Icon name="chev" className="size-4 shrink-0 text-muted-foreground" />;

/**
 * "Waits on you": one row per kind of decision or exception, each a link to the fix. The first row is the
 * screen's dominant thing (largest, first in reading order). Nothing waiting is one plain line.
 */
export const WaitsOnYou: React.FC<{
  rows: WaitRow[];
  pending?: boolean;
  error?: boolean;
  onRetry: () => void;
  /** Overrides the shared title ("Waits on you"). */
  title?: string;
  emptyLabel?: string;
  testId?: string;
  /** Items listed before the kind rows (e.g. the first approvals themselves). */
  lead?: React.ReactNode;
  /** Header link ("All approvals"). */
  actions?: React.ReactNode;
  className?: string;
  /** A plain card with the waiting tone on its count only (the company home), instead of the tinted surface. */
  plain?: boolean;
  /** How many items wait, drawn beside the title in the waiting tone. */
  count?: number;
  /** The count the header link already states (e.g. "All 3 approvals"): the badge shows only when it says more. */
  linkCount?: number;
  /** A short band: on a wide screen the rows sit side by side (up to three a line) instead of one tall column. */
  band?: boolean;
  /** Rows the loading and failed states hold, so the panel keeps its filled height (default 3). */
  skeletonRows?: number;
}> = ({ rows, pending = false, error = false, onRetry, title, emptyLabel, testId = 'waits-on-you', lead, actions, className, plain = false, count, linkCount, band = false, skeletonRows = 3 }) => {
  const badge = count && count !== linkCount ? count : undefined;
  const { t } = useTranslation('dashboard');
  const held = band ? 1 : skeletonRows;
  // A band is one row wide on a desktop; on a phone its items stack, so the held state keeps that stacked height.
  const bandHold = band ? 'max-[899px]:min-h-[140px]' : undefined;
  return (
    <Card data-testid={testId} aria-label={title ?? t('home.waits', 'Waits on you')} className={cn('flex flex-col', !plain && 'bg-waiting-surface', className)}>
      <CardHead level={2} actions={actions}>
        {/* Title and badge never break inside; on a narrow card the badge drops whole under the title. */}
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="whitespace-nowrap">{title ?? t('home.waits', 'Waits on you')}</span>
          {/* Every item waiting (each approval, each invoice in a row), so it says "in all"; the header link and the summary count approvals alone. */}
          {badge ? <span data-testid="waits-count" className="inline-grid whitespace-nowrap min-w-6 place-items-center rounded-full bg-waiting-surface px-2 align-middle text-control font-medium leading-6 text-warning-foreground tabular">{t('home.waitingItemsAll', { count: badge, defaultValue_one: '{{count}} item in all', defaultValue_other: '{{count}} items in all' })}</span> : null}
        </span>
      </CardHead>
      <div className="flex flex-1 flex-col px-[var(--panel-inset)] pb-1">
        {pending ? <ListState variant="loading" shape="items" rows={held} className={bandHold} />
          : error ? <ListState variant="error" title={t('home.waitsError', "Couldn't load what waits on you")} onRetry={onRetry} quiet />
            : rows.length === 0 && !lead ? <p className="py-2.5 text-control text-muted-foreground">{emptyLabel ?? t('home.waitsNone', 'Nothing waits on you.')}</p>
              : (
                <ul className={cn('divide-y divide-border', band && 'min-[900px]:grid min-[900px]:grid-cols-3 min-[900px]:gap-x-[var(--space-panel-gap)] min-[900px]:divide-y-0')}>
                  {lead}
                  {rows.map((row) => <WaitItem key={row.id} row={row} />)}
                </ul>
              )}
      </div>
    </Card>
  );
};

/**
 * One row of "Waits on you", the same design as an approval item: what (the count in words, in the exception
 * colour only when overdue), its one supporting fact under it, the amount in its own right-aligned column.
 */
const WaitItem: React.FC<{ row: WaitRow }> = ({ row }) => (
  <li>
    <Link
      to={row.href}
      className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-3 py-2.5 text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="min-w-0">
        <span className="block break-words text-control font-medium"><span className={cn('tabular', COUNT_TONE[row.tone])}>{row.count}</span> {row.label}</span>
        {row.detail && <span className="block break-words text-control text-muted-foreground">{row.detail}</span>}
      </span>
      <span className="text-right text-control tabular">{row.amount}</span>
      <Chevron />
    </Link>
  </li>
);

/** Shared dashboard rows for the signed-in person's own overdue and due-today tasks. */
export const DashboardWaitsOnYou: React.FC<{
  rows: WaitRow[];
  pending?: boolean;
  error?: boolean;
  onRetry?: () => void;
  title?: string;
  emptyLabel?: string;
  testId?: string;
  lead?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  plain?: boolean;
  count?: number;
  /** The count the header link already states (e.g. "All 3 approvals"): the badge shows only when it says more. */
  linkCount?: number;
  band?: boolean;
  /** Colour only counts that are overdue (red); every other count, waiting ones included, reads neutral. */
  overdueOnly?: boolean;
  skeletonRows?: number;
}> = ({ rows, pending = false, error = false, onRetry, title, emptyLabel, testId, lead, actions, className, plain, count, linkCount, band, overdueOnly = false, skeletonRows }) => {
  const { t } = useTranslation('dashboard');
  const tasks = useMyTasks();
  const today = useOrgToday();

  const taskRows = useMemo<WaitRow[]>(() => {
    const open = (tasks.data ?? []).filter((task) => task.status !== 'Done');
    const overdueCount = open.filter((task) => task.end_date !== null && task.end_date < today).length;
    const dueTodayCount = open.filter((task) => task.end_date === today).length;
    const next: WaitRow[] = [];

    if (overdueCount > 0) {
      next.push({
        id: 'my-overdue-tasks',
        count: overdueCount,
        label: t(overdueCount === 1 ? 'needs.myTaskOverdueOne' : 'needs.myTaskOverdueOther', overdueCount === 1 ? 'task overdue' : 'tasks overdue'),
        href: '/my-tasks',
        tone: 'lost',
      });
    }
    if (dueTodayCount > 0) {
      next.push({
        id: 'my-tasks-due-today',
        count: dueTodayCount,
        label: t(dueTodayCount === 1 ? 'needs.myTaskDueTodayOne' : 'needs.myTaskDueTodayOther', dueTodayCount === 1 ? 'task due today' : 'tasks due today'),
        href: '/my-tasks',
        tone: 'warn',
      });
    }
    return next;
  }, [tasks.data, today, t]);

  const retry = () => {
    onRetry?.();
    void tasks.refetch();
  };
  const rowsWithTasks = [...taskRows, ...rows].map((row) => (overdueOnly && row.tone === 'warn' ? { ...row, tone: 'neutral' as const } : row));

  return (
    <WaitsOnYou
      rows={rowsWithTasks}
      // A15: the person's own task rows never hold back rows (or lead items) that are already here.
      pending={pending || (tasks.isPending && rows.length === 0 && !lead)}
      error={error || (tasks.isError && rows.length === 0 && !lead)}
      onRetry={retry}
      title={title}
      emptyLabel={emptyLabel}
      testId={testId}
      lead={lead}
      actions={actions}
      className={className}
      plain={plain}
      count={count}
      linkCount={linkCount}
      band={band}
      skeletonRows={skeletonRows}
    />
  );
};

export interface ProjectRow {
  id: string;
  name: string;
  /** What needs the person, in a few words ("9 overdue tasks · 1 purchase to approve"). */
  reason: string | null;
  /** Company dashboard counts are structured for desktop columns and labelled per project on phones. */
  needs?: {
    /** Null = unknown (never printed as 0). */
    tasksOverdue: number | null;
    phasesLate: number;
    invoicesOverdue: number;
    awaitingApproval: number;
    overBudget: boolean;
  };
  /** 0–100, or null when unknown. */
  delivery: number | null;
  /** Percent of budget used (can pass 100), or null when unknown. */
  budgetUsed: number | null;
  status: string;
  /** Red pill and red budget figure. */
  offTrack: boolean;
  href: string;
  /** Tooltip: the contractual name when a short name is shown. */
  title?: string;
}

const pct = (value: number | null) => value === null ? '—' : `${Math.round(value)}%`;

/**
 * Projects as ONE compact list: name · reason · delivery % · budget used % · status. A column nobody has a value
 * for is not drawn. Rows that need nothing (`reason` null, not off track) are quiet single lines at the end.
 */
export const ProjectRows: React.FC<{
  title: string;
  rows: ProjectRow[];
  pending?: boolean;
  error?: boolean;
  onRetry: () => void;
  /** "All 7 projects" link. */
  allLink?: { to: string; label: string };
  emptyLabel: string;
  /** One quiet line under the list (e.g. "6 projects can't be checked against budget"). */
  footer?: React.ReactNode;
  testId?: string;
  /** Rows the loading and failed states hold (default 5). */
  skeletonRows?: number;
}> = ({ title, rows, pending = false, error = false, onRetry, allLink, emptyLabel, footer, testId = 'project-rows', skeletonRows = 5 }) => {
  const { t } = useTranslation('dashboard');
  const { t: ts } = useTranslation('status');
  const showDelivery = rows.some((row) => row.delivery !== null);
  const showBudget = rows.some((row) => row.budgetUsed !== null);
  const showReason = rows.some((row) => row.reason);
  const showStructuredNeeds = rows.some((row) => row.needs !== undefined);
  const needColumns = [
    { key: 'tasksOverdue', label: t('home.colTasksOverdue', 'Tasks overdue') },
    { key: 'phasesLate', label: t('home.colPhasesLate', 'Phases late') },
    { key: 'invoicesOverdue', label: t('home.colInvoicesOverdue', 'Invoices overdue') },
    { key: 'awaitingApproval', label: t('home.colAwaitingApproval', 'Awaiting approval') },
  ] as const;
  const cols = [
    'minmax(0,1.6fr)',
    ...(showStructuredNeeds ? ['repeat(4,minmax(2.7rem,0.35fr))'] : showReason ? ['minmax(0,1.3fr)'] : []),
    showDelivery ? '5rem' : null,
    showBudget ? '6rem' : null,
    '9rem',
  ].filter(Boolean).join(' ');
  const sorted = [...rows.filter((row) => row.offTrack || row.reason), ...rows.filter((row) => !row.offTrack && !row.reason)];
  const firstExceptionIndex = sorted.findIndex((row) => row.offTrack);
  return (
    <Card data-testid={testId}>
      <CardHead level={2} actions={allLink ? <Link to={allLink.to} className="inline-flex items-center gap-1 text-control font-medium text-primary-text hover:underline pointer-coarse:min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{allLink.label}<Icon name="chev" className="size-4" /></Link> : undefined}>{title}</CardHead>
      <div className="px-[var(--panel-inset)] pb-2">
        {pending ? <ListState variant="loading" shape="items" rows={skeletonRows} className="max-[899px]:[&_[data-skeleton-shape]>div]:min-h-24" />
          : error ? <ListState variant="error" title={t('home.projectsError', "Couldn't load projects")} onRetry={onRetry} quiet />
            : sorted.length === 0 ? <p className="pb-2 text-control text-muted-foreground">{emptyLabel}</p>
              : (
                <>
                  {/* Same columns and the same gap as the rows, so each header sits on its column's edge. */}
                  <div style={{ gridTemplateColumns: cols }} className="hidden gap-x-3 pb-1 text-control text-muted-foreground min-[900px]:grid">
                    <span>{t('home.colProject', 'Project')}</span>
                    {showStructuredNeeds ? needColumns.map((column) => <span key={column.key} className="min-w-0 text-right">{column.label}</span>) : showReason && <span>{t('home.colNeeds', 'Needs you')}</span>}
                    {showDelivery && <span className="text-right">{t('home.colDelivery', 'Delivery')}</span>}
                    {showBudget && <span tabIndex={0} className="text-right" title={t('home.budgetUsedHelp', 'Spent as a share of budget, before tax')}>{t('home.colBudget', 'Budget used')}</span>}
                    <span className="text-right">{t('home.colStatus', 'Status')}</span>
                  </div>
                  <ul className="divide-y divide-border">
                    {sorted.map((row, index) => {
                      const quiet = !row.offTrack && !row.reason;
                      const emphasized = row.offTrack && index === firstExceptionIndex;
                      const rowStatus = statusLabel('project', row.status, ts);
                      const needFacts = row.needs ? needColumns.map((column) => {
                        const count = row.needs?.[column.key] ?? 0;
                        const label = column.key === 'tasksOverdue'
                          ? t('home.mobileTasksOverdue', { count, defaultValue_one: '{{count}} task overdue', defaultValue_other: '{{count}} tasks overdue' })
                          : column.key === 'phasesLate'
                            ? t('home.mobilePhasesLate', { count, defaultValue_one: '{{count}} phase late', defaultValue_other: '{{count}} phases late' })
                            : column.key === 'invoicesOverdue'
                              ? t('home.mobileInvoicesOverdue', { count, defaultValue_one: '{{count}} invoice overdue', defaultValue_other: '{{count}} invoices overdue' })
                              : t('home.mobileAwaitingApproval', { count, defaultValue_one: '{{count}} awaiting approval', defaultValue_other: '{{count}} awaiting approval' });
                        return { key: column.key, label, urgent: column.key !== 'awaitingApproval' };
                      }) : [];
                      const mobileFacts = row.needs ? [
                        ...needFacts.filter((fact) => (row.needs?.[fact.key] ?? 0) > 0),
                        showDelivery && row.delivery !== null && row.delivery > 0
                          ? { key: 'delivery', label: `${pct(row.delivery)} ${t('home.mobileDelivered', 'delivered')}`, urgent: false }
                          : null,
                        showBudget && row.budgetUsed !== null && row.budgetUsed > 0
                          ? { key: 'budget', label: `${pct(row.budgetUsed)} ${t('home.colBudget', 'Budget used').toLowerCase()}`, urgent: false }
                          : row.needs.overBudget && showBudget
                            ? { key: 'budget', label: t('home.overBudget', 'Over budget'), urgent: false }
                            : null,
                      ].filter((fact): fact is { key: string; label: string; urgent: boolean } => fact !== null) : [];
                      const structuredAriaLabel = row.needs ? [
                        row.name,
                        ...needFacts.filter((fact) => row.needs?.[fact.key] !== null).map((fact) => fact.label),
                        ...mobileFacts.filter((fact) => fact.key === 'delivery' || fact.key === 'budget').map((fact) => fact.label),
                        `${t('home.colStatus', 'Status')}: ${rowStatus}`,
                      ].filter(Boolean).join('; ') : undefined;
                      return (
                        <li key={row.id}>
                          <Link
                            to={row.href}
                            title={row.title}
                            aria-label={structuredAriaLabel}
                            style={{ '--cols': cols } as React.CSSProperties}
                            className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2.5 text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring min-[900px]:[grid-template-columns:var(--cols)]"
                          >
                            <span className="min-w-0 text-control font-medium">{row.name}</span>
                            {/* A long translated status wraps inside its cell: it never runs over the figure beside it. */}
                            <span className={cn(showStructuredNeeds ? 'min-[900px]:order-8' : 'min-[900px]:order-5', 'min-w-0 max-w-full justify-self-end text-right')}><StatusPill className="py-2" variant={toneVariant(statusTone('project', row.status) === 'exception' ? 'exception' : 'neutral')}>{rowStatus}</StatusPill></span>
                            {showStructuredNeeds && row.needs ? (
                              <>
                              <span className="col-span-2 hidden grid-cols-2 gap-x-5 gap-y-0.5 text-control tabular min-[900px]:contents">
                                {needColumns.map((column) => {
                                  const exceptionNeed = column.key !== 'awaitingApproval' && (row.needs?.[column.key] ?? 0) > 0;
                                  return (
                                    <span
                                      key={column.key}
                                      className={cn(
                                        'min-w-0 min-[900px]:order-2 min-[900px]:text-right',
                                        emphasized && exceptionNeed ? 'text-destructive-text' : 'font-normal text-foreground',
                                      )}
                                    >
                                      <span className="min-[900px]:hidden">{column.label}: </span>
                                      {row.needs?.[column.key] ?? '—'}
                                    </span>
                                  );
                                })}
                              </span>
                              <span data-testid="project-needs-mobile" className="col-span-2 flex flex-wrap gap-x-3 gap-y-1 text-control tabular min-[900px]:hidden">
                                {mobileFacts.map((fact) => <span key={fact.key} className={cn(fact.urgent ? 'text-destructive-text' : 'text-foreground')}>{fact.label}</span>)}
                              </span>
                              </>
                            ) : showReason && <span className={cn('col-span-2 min-w-0 text-control min-[900px]:order-2 min-[900px]:col-span-1', emphasized ? 'text-destructive-text' : quiet ? 'text-muted-foreground' : 'text-foreground')}>{row.reason ?? ''}</span>}
                            {(showDelivery || showBudget) && (
                              <span className={cn('col-span-2 flex gap-4 text-control tabular text-foreground min-[900px]:contents', row.needs && 'hidden min-[900px]:contents')}>
                                {showDelivery && <span className={cn(showStructuredNeeds ? 'min-[900px]:order-6' : 'min-[900px]:order-3', 'min-[900px]:text-right')}>
                                  {!row.needs && <span className="min-[900px]:hidden">{t('home.colDelivery', 'Delivery')} </span>}
                                  {pct(row.delivery)}
                                </span>}
                                {showBudget && <span className={cn(showStructuredNeeds ? 'min-[900px]:order-7' : 'min-[900px]:order-4', 'min-[900px]:text-right', emphasized && row.budgetUsed !== null && row.budgetUsed >= 90 && 'text-destructive-text')}>
                                  {!row.needs && <span className="min-[900px]:hidden">{t('home.colBudget', 'Budget used')} </span>}
                                  {pct(row.budgetUsed)}{row.needs?.overBudget && <span className={cn(emphasized ? 'text-destructive-text' : 'font-normal text-foreground')}> · {t('home.overBudget', 'Over budget')}</span>}
                                </span>}
                              </span>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
        {footer && !pending && !error && <p className="pt-2 text-control text-muted-foreground">{footer}</p>}
      </div>
    </Card>
  );
};

/** Secondary blocks that have no page of their own: closed until asked for, drawn only once opened. */
export const Analysis: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <Card data-testid="dashboard-analysis">
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="flex min-h-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden items-center justify-between gap-2 px-[var(--panel-inset)] text-group font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {title}<Icon name="chev" className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-90')} />
        </summary>
        {open && <div className="grid gap-[var(--space-panel-gap)] p-[var(--panel-inset)] pt-2">{children}</div>}
      </details>
    </Card>
  );
};
