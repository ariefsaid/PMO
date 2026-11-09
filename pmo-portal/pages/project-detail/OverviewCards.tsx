import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, ListState, StatusPill } from '@/src/components/ui';
import { HelpPopover } from '@/src/components/ui/HelpPopover';
import { cn } from '@/src/components/ui/cn';
import { usePermission } from '@/src/auth/usePermission';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { useTasks } from '@/src/hooks/useTasks';
import { useProjectProcurements } from '@/src/hooks/useProcurements';
import { formatCompactCurrency, formatDateOnly, formatMonthYear } from '@/src/lib/format';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { BlockAction } from './ProjectBlocks';
import MilestoneStrip from './MilestoneStrip';
import { useBudgetUsage, useScheduleSummary } from './useProjectOverviewFigures';

const DAY_MS = 86_400_000;
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Schedule: one row per phase, plan (dashed) against actual progress, with today marked. */
export const ScheduleCard: React.FC<{ project: ProjectWithRefs }> = ({ project }) => {
  const { t } = useTranslation('project');
  const schedule = useScheduleSummary(project);
  const tasks = useTasks(project.id);
  const may = usePermission();
  const [managing, setManaging] = useState(false);
  const phases = schedule.milestones;
  const title = t('projectDetail.delivery.timelineTitle', 'Phase timeline');
  const manage = may('edit', 'project') && (
    <BlockAction onClick={() => setManaging((m) => !m)} expanded={managing}>
      {managing ? t('projectDetail.delivery.doneManaging', 'Done') : t('projectDetail.delivery.manage', 'Update phases')}
    </BlockAction>
  );
  const head = (
    <CardHead id="pd-delivery" className="py-3" subline={t('projectDetail.schedule.sub', 'Plan vs actual by phase')}
      actions={<>
        {!managing && <BlockAction to={`/projects/${project.id}/tasks?view=timeline`}>{t('projectDetail.delivery.openTimeline', 'Open timeline')}</BlockAction>}
        {manage}
      </>}>
      {title}
    </CardHead>
  );
  if (managing) return <section aria-labelledby="pd-delivery"><Card>{head}<CardPad><MilestoneStrip projectId={project.id} /></CardPad></Card></section>;
  if (schedule.isPending || tasks.isPending) return <section aria-labelledby="pd-delivery"><Card>{head}<CardPad><ListState variant="loading" rows={3} /></CardPad></Card></section>;
  if (phases.length === 0) {
    return (
      <section aria-labelledby="pd-delivery"><Card>{head}<CardPad>
        <p className="text-sm text-muted-foreground">{t('projectDetail.delivery.empty', 'No phases yet. Add phases to track delivery progress.')}</p>
      </CardPad></Card></section>
    );
  }
  // Plan window of a phase: from the previous phase's target (or the project start) to its own target.
  const rows = phases.map((phase, i) => {
    const start = i === 0 ? (project.start_date ?? phase.target_date) : (phases[i - 1].target_date ?? project.start_date);
    return { phase, start, end: phase.target_date };
  });
  const stamps = [project.start_date, project.end_date, schedule.today, ...rows.flatMap((r) => [r.start, r.end])]
    .filter((d): d is string => Boolean(d)).map(day);
  const min = Math.min(...stamps);
  const max = Math.max(...stamps);
  const span = Math.max(max - min, DAY_MS);
  const pos = (iso: string) => ((day(iso) - min) / span) * 100;
  const todayPos = pos(schedule.today);
  const ticks = Array.from({ length: 5 }, (_, k) => new Date(min + (span * k) / 4));
  return (
    <section aria-labelledby="pd-delivery">
      <Card>
        {head}
        <CardPad>
          <div className="mb-1 grid grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)_5.5rem] items-end gap-x-3 text-[10.5px] text-muted-foreground max-md:grid-cols-[minmax(0,1fr)_5.5rem]">
            <span className="max-md:hidden" />
            <span aria-hidden="true" className="flex justify-between max-md:hidden">{ticks.map((d, k) => <span key={k}>{formatMonthYear(d)}</span>)}</span>
            <span />
          </div>
          <ul className="flex flex-col gap-2.5" data-testid="phase-read-details">
            {rows.map(({ phase, start, end }) => {
              const done = phase.effective_pct >= 100;
              const started = phase.effective_pct > 0 || phase.task_count > 0;
              const overdue = Boolean(end && end < schedule.today && !done && started);
              const lateDays = overdue && end ? Math.floor((day(schedule.today) - day(end)) / DAY_MS) : 0;
              const phaseTasks = (tasks.data ?? []).filter((task) => task.milestone_id === phase.id && !task.parent_task_id);
              const doneTasks = phaseTasks.filter((task) => task.status === 'Done').length;
              const tone = done ? 'bg-success' : overdue ? (phase.effective_pct >= 50 ? 'bg-warning' : 'bg-destructive') : 'bg-primary';
              const planLeft = start && end ? Math.min(pos(start), pos(end)) : null;
              const planWidth = start && end ? Math.max(Math.abs(pos(end) - pos(start)), 1) : 0;
              return (
                <li key={phase.id} className="grid grid-cols-[minmax(7rem,10rem)_minmax(0,1fr)_5.5rem] items-center gap-x-3 text-sm max-md:grid-cols-[minmax(0,1fr)_5.5rem] max-md:gap-y-1">
                  <div className="min-w-0">
                    <div className={cn('truncate font-semibold text-foreground')}>{phase.name}</div>
                    <div className="text-xs text-muted-foreground">{t('projectDetail.milestones.taskCount', '{{done}} of {{total}} tasks', { done: doneTasks, total: phaseTasks.length || phase.task_count })}</div>
                  </div>
                  <div className="relative h-[18px] min-w-0 max-md:col-span-2 max-md:order-last" role="img"
                    aria-label={t('projectDetail.schedule.barAria', '{{name}}: {{pct}}% complete', { name: phase.name, pct: Math.round(phase.effective_pct) })}>
                    {planLeft !== null && (
                      <>
                        <span className="absolute top-0.5 h-3.5 rounded border border-dashed border-primary bg-primary/10" style={{ left: `${planLeft}%`, width: `${planWidth}%` }} />
                        {started && <span className={cn('absolute top-[5px] h-2 rounded', tone)} style={{ left: `${planLeft}%`, width: `${Math.max(planWidth * Math.min(phase.effective_pct, 100) / 100, 0.8)}%` }} />}
                      </>
                    )}
                    <span aria-hidden="true" className="absolute -bottom-1 -top-1 w-0.5 bg-destructive" style={{ left: `${todayPos}%` }} />
                  </div>
                  <div className="text-right">
                    {done
                      ? <StatusPill variant="won">{t('projectDetail.schedule.done', 'Done')}</StatusPill>
                      : overdue
                        ? <StatusPill variant={phase.effective_pct >= 50 ? 'warn' : 'lost'}>{t('projectDetail.schedule.lateChip', '{{pct}}% · {{days}}d', { pct: Math.round(phase.effective_pct), days: lateDays })}</StatusPill>
                        : <span className="text-xs tabular-nums text-muted-foreground">{Math.round(phase.effective_pct)}%{end ? ` · ${formatDateOnly(end)}` : ''}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-3.5 rounded-sm border border-dashed border-primary bg-primary/10" />{t('projectDetail.schedule.plan', 'Plan')}</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-1.5 w-3.5 rounded-sm bg-primary" />{t('projectDetail.schedule.actual', 'Actual')}</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-0.5 bg-destructive" />{t('projectDetail.schedule.today', 'Today')}</span>
            <HelpPopover subject={t('projectDetail.schedule.helpLabel', 'how phases are drawn')}>
              {t('projectDetail.schedule.help', "Each phase's plan runs from the previous phase's target date (the project start for the first) to its own target. The solid bar is the share of that window already done.")}
            </HelpPopover>
          </p>
        </CardPad>
      </Card>
    </section>
  );
};

/** Budget vs actual: spent and committed per category, from the same totals the Budget tab shows. */
export const BudgetBarsCard: React.FC<{ project: ProjectWithRefs; onOpenBudget: () => void }> = ({ project, onOpenBudget }) => {
  const { t } = useTranslation('project');
  const usage = useBudgetUsage(project);
  const { pos } = usage;
  const cur = project.currency;
  const head = (
    <CardHead id="pd-cost" className="py-3" actions={<BlockAction onClick={onOpenBudget}>{t('projectDetail.cost.openBudgetArea', 'Open budget')}</BlockAction>}>
      {t('projectDetail.cost.title', 'Budget vs actual')}
      <HelpPopover subject={t('projectDetail.cost.helpLabel', 'the budget view')}>
        {t('projectDetail.cost.summaryTooltip', 'Compares mapped actual spending with the active project budget. Source: active budget categories and project finance records.')}
      </HelpPopover>
    </CardHead>
  );
  if (pos.isPending) return <section aria-labelledby="pd-cost" className="min-w-0"><Card>{head}<CardPad><ListState variant="loading" rows={4} /></CardPad></Card></section>;
  if (pos.isError) return <section aria-labelledby="pd-cost" className="min-w-0"><Card>{head}<CardPad><ListState variant="error" title={t('projectDetail.cost.error', "Couldn't load the budget")} onRetry={() => void pos.refetch()} /></CardPad></Card></section>;
  if (!pos.hasBudget) {
    return <section aria-labelledby="pd-cost" className="min-w-0"><Card>{head}<CardPad><p className="text-sm text-muted-foreground">{t('projectDetail.cost.noBudget', 'No active budget yet, so spending can’t be compared.')}</p></CardPad></Card></section>;
  }
  return (
    <section aria-labelledby="pd-cost" className="min-w-0">
      <Card>
        {head}
        <CardPad>
          <ul className="flex flex-col">
            {pos.rows.map((row) => {
              const committed = usage.committedByCategory.get(row.category) ?? 0;
              const spent = row.actual;
              const base = row.budget > 0 ? row.budget : Math.max((spent ?? 0) + committed, 1);
              const spentPct = spent === null ? 0 : Math.min((spent / base) * 100, 100);
              const committedPct = Math.min((committed / base) * 100, 100 - spentPct);
              const over = spent !== null && spent > row.budget;
              return (
                <li key={row.category} className="grid grid-cols-[minmax(5.5rem,7rem)_minmax(0,1fr)_auto] items-center gap-x-3 py-1.5 text-sm tabular-nums">
                  <span className="truncate text-foreground">{budgetCategoryLabel(row.category, t)}</span>
                  <span className="relative h-2 overflow-hidden rounded bg-muted" role="img"
                    aria-label={t('projectDetail.cost.categoryUse', '{{category}} uses {{percent}}% of budget', { category: budgetCategoryLabel(row.category, t), percent: Math.round(spentPct) })}>
                    <i className={cn('absolute inset-y-0 left-0 rounded', over ? 'bg-destructive' : 'bg-primary')} style={{ width: `${spentPct}%` }} />
                    {committedPct > 0 && <i className="absolute inset-y-0 rounded bg-primary/25" style={{ left: `${spentPct}%`, width: `${committedPct}%` }} />}
                  </span>
                  <span className={cn('text-right text-xs', over ? 'font-semibold text-destructive-text' : 'text-muted-foreground')}>
                    {spent === null ? formatCompactCurrency(row.budget, cur) : `${formatCompactCurrency(spent, cur)} / ${formatCompactCurrency(row.budget, cur)}`}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><i className="inline-block h-1.5 w-2.5 rounded-sm bg-primary" />{t('projectDetail.cost.legendSpent', 'Spent')}</span>
            {usage.committed !== null && <span className="inline-flex items-center gap-1.5"><i className="inline-block h-1.5 w-2.5 rounded-sm bg-primary/25" />{t('projectDetail.cost.legendCommitted', 'Committed in orders')}</span>}
          </p>
        </CardPad>
      </Card>
    </section>
  );
};

const CLOSED = new Set(['Paid', 'Cancelled', 'Rejected']);

/** Open purchases: the project's procurement cases still in flight, newest first. */
export const OpenPurchasesCard: React.FC<{ project: ProjectWithRefs }> = ({ project }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  const canView = may('view', 'procurement');
  const query = useProjectProcurements(canView ? project.id : null);
  if (!canView) return null;
  const open = (query.data ?? []).filter((row) => !CLOSED.has(row.status))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const head = (
    <CardHead id="pd-purchases" className="py-3" subline={query.data ? t('projectDetail.purchases.total', '{{n}} open', { n: open.length }) : undefined}
      actions={<BlockAction to={`/projects/${project.id}/procurement`}>{t('projectDetail.purchases.all', 'All')}</BlockAction>}>
      {t('projectDetail.purchases.title', 'Open purchases')}
    </CardHead>
  );
  return (
    <section aria-labelledby="pd-purchases" className="min-w-0">
      <Card>
        {head}
        <CardPad>
          {query.isPending ? <ListState variant="loading" rows={3} />
            : query.isError ? <ListState variant="error" title={t('projectDetail.purchases.error', "Couldn't load purchases")} onRetry={() => void query.refetch()} />
              : open.length === 0 ? <p className="text-sm text-muted-foreground">{t('projectDetail.purchases.empty', 'No open purchases.')}</p>
                : (
                  <table className="w-full text-sm tabular-nums">
                    <thead>
                      <tr className="border-b border-border text-left text-xs font-medium text-muted-foreground">
                        <th scope="col" className="py-1.5 pr-2 font-medium">{t('projectDetail.purchases.purchase', 'Purchase')}</th>
                        <th scope="col" className="py-1.5 pr-2 font-medium">{t('projectDetail.purchases.stage', 'Stage')}</th>
                        <th scope="col" className="py-1.5 text-right font-medium">{t('projectDetail.purchases.amount', 'Amount')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {open.slice(0, 5).map((row) => (
                        <tr key={row.id} className="border-b border-border/60 last:border-b-0">
                          <td className="max-w-0 truncate py-2 pr-2">
                            <Link to={`/projects/${project.id}/procurement?open=${encodeURIComponent(row.id)}`} className="text-foreground hover:underline">
                              {[row.code, row.title].filter(Boolean).join(' ')}
                            </Link>
                          </td>
                          <td className="py-2 pr-2"><StatusPill variant={workflowVariant(row.status)}>{row.status}</StatusPill></td>
                          <td className="py-2 text-right">{formatCompactCurrency(Number(row.total_value), row.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
        </CardPad>
      </Card>
    </section>
  );
};

/** Progress curve: planned against actual completion, headed by where the two stand today. */
export const ProgressCurveCard: React.FC<{ project: ProjectWithRefs; children: React.ReactNode }> = ({ project, children }) => {
  const { t } = useTranslation('project');
  const schedule = useScheduleSummary(project);
  const behind = schedule.progress !== null && schedule.planned !== null && schedule.progress < schedule.planned
    ? schedule.planned - schedule.progress : null;
  return (
    <section aria-labelledby="pd-curve" className="min-w-0">
      <Card>
        <CardHead id="pd-curve" className="py-3"
          subline={schedule.planned !== null && schedule.progress !== null
            ? t('projectDetail.curve.sub', 'Planned {{planned}}% · actual {{actual}}%', { planned: schedule.planned, actual: schedule.progress })
            : undefined}
          actions={behind !== null ? <span className="text-xs font-semibold text-destructive-text">{t('projectDetail.curve.behind', '{{pts}} pts behind plan', { pts: behind })}</span> : undefined}>
          {t('projectDetail.curve.title', 'Progress curve')}
        </CardHead>
        <CardPad>{children}</CardPad>
      </Card>
    </section>
  );
};
