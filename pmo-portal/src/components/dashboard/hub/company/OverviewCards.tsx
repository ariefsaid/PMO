import React from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad } from '@/src/components/ui/Card';
import { Icon } from '@/src/components/ui/icons';
import { ListState } from '@/src/components/ui/ListState';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { lostReasonLabel } from '@/src/lib/lostReasons';
import { useFigureReport } from '@/src/components/ui/useFigureScope';
import { PROCUREMENT_STAGES, type ProcurementStage } from '@/src/lib/procurement/stage';
import { formatMonthShort, formatTileMoney } from '@/src/lib/format';
import { tileMoneyLines } from '@/src/components/dashboard/restructure/currencyOrder';
import type { BudgetReviewRow, PipelineProject, PipelineStage, TopProject } from '@/src/lib/db/dashboard';
import type { AgeingBuckets } from '@/src/lib/finance/financePosition';
import { BarList, ChartCard, MonthColumns, SeriesKey, StackedBar, type BarRow, type ChartTone } from '@/src/components/dashboard/charts';
import { WinRateCard } from '@/src/components/dashboard/WinRateCard';
import { useLossBreakdown, type WinRateRange } from '@/src/hooks/useDashboard';
import { budgetSpendKnown } from './financeData';
import { budgetVsSpentRows } from './overviewData';
import { openPipelineStages, stageCurrencyState } from './pipelineStages';

const linkClass = 'inline-flex items-center gap-1 text-control font-medium text-primary-text hover:underline pointer-coarse:min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
export const CardLink: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
  <Link to={to} className={linkClass}><span>{children}</span><Icon name="chev" className="size-4" /></Link>
);

const money = (amount: number, currency: string) => formatTileMoney(amount, currency) ?? '';
const cnJoin = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(' ');

/** Budget against spending per project, worst first. Spending nobody recorded draws no bar; with none recorded the chart is left out. */
export const BudgetVsSpentCard: React.FC<{ projects: TopProject[]; currency: string; pending: boolean; error: boolean; retry: () => void; className?: string }> = ({ projects, currency, pending, error, retry, className }) => {
  const { t } = useTranslation('dashboard');
  const rows = budgetVsSpentRows(projects, currency);
  const spentName = t('home.chartSpent', 'Spent');
  const budgetName = t('home.chartBudget', 'Budget');
  return (
    <ChartCard title={t('home.budgetVsSpent', 'Budget and spending by project')} actions={<CardLink to="/projects">{t('dashboard:hub.company.openProjects', 'Open projects')}</CardLink>}
      known={rows.some((row) => row.value2 != null)} hiddenReason={rows.length === 0 ? t('home.reasonNoBudgets', 'no project has an active budget') : t('home.reasonBudgetSpend', 'project spending is not recorded')}
      pending={pending} error={error ? { title: t('dashboard:hub.company.projectsError', "Couldn't load delivery projects"), retry } : undefined} testId="chart-budget-vs-spent" className={className}>
      <SeriesKey items={[{ label: budgetName, tone: 'neutral' }, { label: spentName, tone: 'accent' }]} />
      <BarList rows={rows} ariaLabel={t('home.budgetVsSpent', 'Budget and spending by project')} seriesNames={[budgetName, spentName]} />
    </ChartCard>
  );
};

/** The weighted pipeline: total, the open stages as descending bars on one scale, what was won, and the win rates. */
export const SalesOverviewCard: React.FC<{
  weighted: { value: React.ReactNode; exact?: string } | null;
  forecastMargin: number | null | undefined;
  stages: PipelineStage[];
  projects?: PipelineProject[];
  pending: boolean;
  error: boolean;
  retry: () => void;
  currency: string;
  period: string;
  won?: { count: number; amounts: Array<{ currency: string; amount: number }>; href?: string };
  range: WinRateRange;
  className?: string;
  /** Pipeline and win rate side by side (a two-thirds-wide card). */
  wide?: boolean;
  /** Drawn under the win rate (e.g. win and loss by client). */
  aside?: React.ReactNode;
}> = ({ weighted, forecastMargin, stages, projects, pending, error, retry, currency, period, won, range, className, wide = false, aside }) => {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const statusLabel = useProjectStatusLabel();
  const open = openPipelineStages(stages);
  const state = stageCurrencyState(stages, projects);
  const max = Math.max(1, ...open.map((stage) => stage.weighted_value));
  const wonValue = won ? tileMoneyLines(won.amounts, currency, formatTileMoney) : [];
  return (
    <Card data-testid="sales-overview" className={cnJoin('flex flex-col', className)}>
      <CardHead level={2} actions={<CardLink to="/sales">{t('dashboard:hub.company.openSales', 'Open sales')}</CardLink>}>{t('home.sales', 'Sales')}</CardHead>
      <CardPad className={wide ? 'grid flex-1 gap-x-[var(--space-panel-gap)] gap-y-4 min-[900px]:grid-cols-2' : 'grid gap-4'}>
        <div className={wide ? 'flex flex-col gap-4' : 'contents'}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          {weighted && (
            <div>
              <div className="text-control text-muted-foreground">{t('home.pipelineWeighted', 'Weighted pipeline')}</div>
              <div className="text-[23px] font-bold leading-tight tabular" title={weighted.exact}>{weighted.value}</div>
              {forecastMargin != null && <div className="text-control text-muted-foreground">{t('dashboard:hub.company.forecastMargin', 'Forecast margin')}: {(forecastMargin * 100).toFixed(1)}%</div>}
            </div>
          )}
          {won && (
            <button type="button" onClick={() => navigate(won.href ?? '/projects?filter=won')} className="min-h-11 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <span className="block text-control text-muted-foreground">{t('home.wonThisYear', 'Won')}{period ? ` · ${period}` : ''} · {won.count}</span>
              <span className="block text-[23px] font-bold leading-tight tabular">{wonValue.map((line) => <span key={line} data-currency-line className="block">{line}</span>)}</span>
            </button>
          )}
        </div>
        {pending ? <ListState variant="loading" shape="chart" rows={2} />
          : error ? <ListState variant="error" title={t('dashboard:hub.company.pipelineError', "Couldn't load pipeline stages")} onRetry={retry} />
            : open.length === 0 ? <ListState variant="empty" icon="pipe" title={t('hub.company.noPipeline', 'No open pipeline stages')} />
              : (
                // AC-1117: each stage bar is a link to the pipeline filtered to that stage (one scale, weighted value).
                <ul aria-label={t('home.pipelineChart', 'Weighted pipeline by stage')} className="flex flex-1 flex-col justify-between gap-1">
                  {open.map((stage) => {
                    const name = `${statusLabel(stage.status as string)} · ${stage.count}`;
                    const currencies = state.forStage(stage);
                    const value = state.complete && (currencies.size === 1 || stage.count === 0) ? money(stage.weighted_value, [...currencies][0] ?? currency) : null;
                    return (
                      <li key={String(stage.status)}>
                        <Link to={`/sales?status=${encodeURIComponent(stage.status as string)}`} aria-label={value ? `${name}: ${value}` : name}
                          className="grid min-h-11 grid-cols-[minmax(7rem,9.5rem)_minmax(0,1fr)] items-center gap-x-3 text-control text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          <span className="truncate text-right">{name}</span>
                          <span className="flex min-w-0 items-center gap-2">
                            {state.complete && state.currencies.size === 1 && <span aria-hidden className="h-[18px] min-w-0.5 rounded-r bg-primary" style={{ width: `${Math.max(1, (stage.weighted_value / max) * 75)}%` }} />}
                            <span className="shrink-0 font-semibold tabular">{value}</span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
        </div>
        <div className={wide ? 'grid content-start gap-4' : 'contents'}>
          <WinRateCard currency={currency} range={range} hidePeriodControl embedded helpInPage />
          {aside}
        </div>
      </CardPad>
    </Card>
  );
};

/** Invoiced and collected by month. The caller supplies the last completed-month window; sparse windows stay figures. */
export const InvoicedCollectedCard: React.FC<{
  months: Array<{ month: string; amount: number }> | undefined;
  /** Completed-month window used when collections are known but monthly invoicing is not. */
  periodMonths?: string[];
  collectedByMonth: Map<string, number> | undefined;
  collectedUnsynced: boolean;
  pending: boolean;
  error: boolean;
  retry: () => void;
  currency: string;
  className?: string;
  /** Inside the Finances card: no frame, no link of its own, a value axis with faint lines. */
  embedded?: boolean;
  chartHeight?: number;
}> = ({ months, periodMonths = [], collectedByMonth, collectedUnsynced, pending, error, retry, currency, className, embedded = false, chartHeight }) => {
  const { t } = useTranslation('dashboard');
  const withCollected = Boolean(collectedByMonth && !collectedUnsynced);
  const hasInvoices = months !== undefined;
  const collectionsPrimary = !hasInvoices && withCollected;
  const title = withCollected
    ? t('home.billedWorkWithCollected', 'Billed work and collected · last 12 completed months')
    : t('home.billedWorkByMonth', 'Billed work · last 12 completed months');
  const invoicedName = t('home.chartBilledWork', 'Billed work, excl. tax');
  const collectedName = t('home.chartCollected', 'Collected');
  const sourceMonths = months ?? (withCollected ? periodMonths.map((month) => ({ month, amount: 0 })) : []);
  const points = sourceMonths.map((point) => {
    const monthKey = point.month.slice(0, 7);
    const collected = withCollected ? collectedByMonth!.get(monthKey) ?? 0 : undefined;
    const invoiced = hasInvoices ? point.amount : undefined;
    const primary = collectionsPrimary ? collected : invoiced;
    return {
      key: monthKey,
      tick: formatMonthShort(new Date(Number(point.month.slice(0, 4)), Number(point.month.slice(5, 7)) - 1, 1)),
      a: primary ?? 0,
      labelA: primary === undefined ? undefined : money(primary, currency),
      ...(hasInvoices && withCollected && !collectionsPrimary ? { b: collected ?? 0, labelB: money(collected ?? 0, currency) } : {}),
    };
  });
  const activeMonths = points.filter((point) => point.a !== 0 || (point.b !== undefined && point.b !== 0)).length;
  const collectionGap = !withCollected
    ? t('home.collectedBilledWorkTrendGap', 'Collected is incomplete; billed-work amounts are shown.')
    : null;
  const invoiceGap = !hasInvoices && withCollected
    ? t('home.billedWorkTrendGap', 'Billed work is incomplete; collected amounts are shown.')
    : null;
  const gap = [invoiceGap, collectionGap].filter(Boolean).join(' ');
  return (
    <ChartCard title={title} embedded={embedded} className={className} actions={embedded ? undefined : <CardLink to="/finance/receivables">{t('dashboard:hub.company.openInvoices', 'Open invoices')}</CardLink>}
      known={activeMonths >= 3} hiddenReason={t('home.reasonTrend', 'fewer than three months have invoiced or collected amounts')}
      pending={pending} error={error ? { title: t('trend.error', "Couldn't load the invoiced trend"), retry } : undefined} testId="chart-invoiced-collected">
      <MonthColumns points={points} ariaLabel={collectionsPrimary ? `${title} · ${collectedName}` : title} seriesNames={collectionsPrimary ? [collectedName] : [invoicedName, collectedName]} tickInterval={points.length > 8 ? 1 : 0} height={chartHeight}
        valueAxis={embedded ? (value) => (value === 0 ? '0' : money(value, currency)) : undefined} />
      {gap && <p data-testid="invoiced-collected-gap" className="mt-2 text-control text-muted-foreground">{gap}</p>}
    </ChartCard>
  );
};

/** Purchasing cases by stage as one stacked bar. */
export const PurchasingCard: React.FC<{ counts: Array<{ status: ProcurementStage; count: number }>; stageName: (stage: ProcurementStage) => string; pending: boolean; error: boolean; retry: () => void; className?: string }> = ({ counts, stageName, pending, error, retry, className }) => {
  const { t } = useTranslation('dashboard');
  const title = t('dashboard:hub.company.purchasingByStage', 'Purchasing by stage');
  const empty = counts.every((row) => row.count === 0);
  return (
    <ChartCard title={title} actions={<CardLink to="/procurement">{t('dashboard:hub.company.openProcurements', 'Open procurements')}</CardLink>} pending={pending}
      error={error ? { title: t('dashboard:hub.company.purchasesError', "Couldn't load purchasing stages"), retry } : undefined} testId="chart-purchasing" className={className}>
      {empty
        ? <p className="text-control text-muted-foreground">{t('dashboard:hub.company.noPurchases', 'No procurements to show')}</p>
        : <StackedBar ariaLabel={title} parts={PROCUREMENT_STAGES.map((stage) => ({ key: stage, label: stageName(stage), value: counts.find((row) => row.status === stage)?.count ?? 0 }))} />}
    </ChartCard>
  );
};

/**
 * Why deals were lost: bars for the reasons that were recorded. With none recorded the chart is left out (and counted in
 * the page's hidden line); win and loss by client stay as rows under their own heading.
 */
export const LossReasonsCard: React.FC<{ range: WinRateRange; className?: string; /** A titled section inside another card. */ embedded?: boolean }> = ({ range, className, embedded = false }) => {
  const { t } = useTranslation('dashboard');
  const { t: tl } = useTranslation('lostReason');
  const { data, isPending, isError, refetch } = useLossBreakdown(range);
  const reasons = (data?.by_reason ?? []).filter((row) => row.reason !== null).map((row) => ({ ...row, total: row.losses_count + row.declined_count })).filter((row) => row.total > 0);
  const clients = data?.by_client ?? [];
  const title = t('home.whyLost', 'Why deals were lost');
  const noneRecorded = Boolean(data) && (data?.by_reason.length ?? 0) > 0 && reasons.length === 0;
  useFigureReport(noneRecorded ? [{ label: title, reason: t('home.reasonLossReasons', 'no loss reason is recorded') }] : []);
  if (isPending) return null;
  const clientRows = clients.length > 0 && (
    <section aria-label={tl('breakdown.clientsTitle', 'Win and loss by client')} className={reasons.length > 0 ? 'mt-4' : undefined}>
      {reasons.length > 0 && <h3 className="mb-1.5 text-control font-semibold">{tl('breakdown.clientsTitle', 'Win and loss by client')}</h3>}
      <ul className="grid gap-1 text-control">
        {clients.map((c) => (
          <li key={c.client_id ?? 'unknown'} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate">{c.client_name ?? tl('breakdown.unknownClient', 'Unknown client')}</span>
            <span className="shrink-0 tabular text-muted-foreground">{tl('breakdown.wonLost', '{{won}} won, {{lost}} lost', { won: c.wins_count, lost: c.losses_count })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
  const nothing = reasons.length === 0 && clients.length === 0;
  if (!isError && noneRecorded && !clientRows) return null;
  const heading = reasons.length > 0 || nothing ? title : tl('breakdown.clientsTitle', 'Win and loss by client');
  const body = (
    <>
        {isError ? <ListState variant="error" title={tl('breakdown.errorTitle', "Couldn't load the loss breakdown")} onRetry={() => void refetch()} />
          : (
            <>
              {reasons.length > 0 && <BarList ariaLabel={title} rows={reasons.map((row) => ({ id: row.reason as string, name: lostReasonLabel((key, d) => String(tl(key, d)), row.reason), value: row.total, label: String(row.total), tone: 'accent' as const }))} />}
              {nothing && <p className="text-control text-muted-foreground">{tl('breakdown.none', 'No lost deals in this period.')}</p>}
              {reasons.length > 0 ? clientRows : <div>{clientRows}</div>}
            </>
          )}
    </>
  );
  if (embedded) {
    return (
      <section data-testid="chart-loss-reasons" aria-label={heading} className={cnJoin('border-t border-border pt-4', className)}>
        <h3 className="mb-2 text-control font-semibold">{heading}</h3>
        {body}
      </section>
    );
  }
  return (
    <Card data-testid="chart-loss-reasons" className={className}>
      <CardHead level={2} actions={<CardLink to="/sales">{t('dashboard:hub.company.openSales', 'Open sales')}</CardLink>}>{heading}</CardHead>
      <div className="px-[var(--panel-inset)] pb-4">{body}</div>
    </Card>
  );
};

const AGE_TONE: Record<keyof AgeingBuckets, ChartTone> = { notDue: 'accent', noDueDate: 'neutral', d1_30: 'accent', d31_60: 'accent', d61_90: 'bad', over90: 'bad' };
const AGE_KEYS = ['notDue', 'noDueDate', 'd1_30', 'd31_60', 'd61_90', 'over90'] as const;

/** What clients owe, by how long it has been due (known balances only, in the organisation currency). */
export const ReceivablesAgeCard: React.FC<{ ageing: Record<string, AgeingBuckets>; unknownCount: number; noDueDateCount?: number; currency: string; pending: boolean; error: boolean; retry: () => void; className?: string; embedded?: boolean; rowPitch?: number }> = ({ ageing, unknownCount, noDueDateCount = 0, currency, pending, error, retry, className, embedded = false, rowPitch }) => {
  const { t } = useTranslation();
  const buckets = ageing[currency];
  const labels: Record<keyof AgeingBuckets, string> = {
    notDue: t('finance:area.notDue', 'Not yet due'),
    noDueDate: t('finance:area.noDueDate', 'No due date'),
    d1_30: t('finance:area.days1to30', '1–30 days'),
    d31_60: t('finance:area.days31to60', '31–60 days'),
    d61_90: t('finance:area.days61to90', '61–90 days'),
    over90: t('finance:area.over90Days', 'Over 90 days'),
  };
  const rows: BarRow[] = buckets ? AGE_KEYS.map((key) => ({ id: key, name: labels[key], value: buckets[key] / 100, label: money(buckets[key] / 100, currency), tone: AGE_TONE[key] })) : [];
  const title = t('dashboard:home.receivablesByAge', 'Owed by clients, by age');
  return (
    <ChartCard title={title} embedded={embedded} actions={embedded ? undefined : <CardLink to="/finance/receivables">{t('dashboard:hub.company.openInvoices', 'Open invoices')}</CardLink>}
      known={Boolean(buckets) && (noDueDateCount > 0 || rows.some((row) => (row.value ?? 0) > 0))} hiddenReason={t('dashboard:home.reasonAgeing', 'no client balance is known')}
      pending={pending} error={error ? { title: t('dashboard:home.overdueError', "Couldn't load overdue invoices"), retry } : undefined} testId="chart-receivables-age" className={className}>
      <BarList rows={rows} ariaLabel={title} rowPitch={rowPitch} />
      {noDueDateCount > 0 && <p className="mt-2 text-control text-muted-foreground">{t('finance:area.ageingNoDueDateSummary', { count: noDueDateCount, defaultValue_one: '{{count}} invoice with no due date', defaultValue_other: '{{count}} invoices with no due date' })}</p>}
      {unknownCount > 0 && <p className="mt-2 text-control text-muted-foreground">{t('dashboard:home.ageingUnknown', { count: unknownCount, defaultValue_one: '{{count}} invoice with an unknown balance is not drawn', defaultValue_other: '{{count}} invoices with unknown balances are not drawn' })}</p>}
    </ChartCard>
  );
};

/** Budget used per project (spending known only), largest first; over 100% is red. */
export const BudgetUsedCard: React.FC<{ rows: BudgetReviewRow[]; name: (row: BudgetReviewRow) => string; pending: boolean; error: boolean; retry: () => void; className?: string }> = ({ rows, name, pending, error, retry, className }) => {
  const { t } = useTranslation('dashboard');
  const used = rows.filter((row) => budgetSpendKnown(row) && row.budget > 0 && row.budget_currency === row.currency)
    .map((row) => ({ row, pct: Math.round((row.spent as number) / row.budget * 100) })).sort((a, b) => b.pct - a.pct).slice(0, 8);
  const title = t('home.budgetUsedByProject', 'Budget used by project');
  const bars: BarRow[] = used.map(({ row, pct }) => ({ id: row.id, name: name(row), value: pct, label: `${pct}%`, tone: pct > 100 ? 'bad' : 'accent' }));
  if (!pending && !error && rows.length === 0) return null;
  return (
    <ChartCard title={title} actions={<CardLink to="/projects">{t('dashboard:hub.company.openProjects', 'Open projects')}</CardLink>}
      known={bars.length > 0} hiddenReason={t('home.reasonBudgetSpend', 'project spending is not recorded')}
      pending={pending} error={error ? { title: t('dashboard:hub.company.budgetReviewError', "Couldn't load budget review"), retry } : undefined} testId="chart-budget-used" className={className}>
      <BarList rows={bars} ariaLabel={title} domainMax={Math.max(100, ...used.map((item) => item.pct))} />
    </ChartCard>
  );
};
