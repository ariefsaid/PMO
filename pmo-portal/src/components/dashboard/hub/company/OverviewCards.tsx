import React from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad } from '@/src/components/ui/Card';
import { Icon } from '@/src/components/ui/icons';
import { ListState } from '@/src/components/ui/ListState';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { PROCUREMENT_STAGES, type ProcurementStage } from '@/src/lib/procurement/stage';
import { formatMonthShort, formatTileMoney } from '@/src/lib/format';
import { tileMoneyLines } from '@/src/components/dashboard/restructure/currencyOrder';
import type { InvoicedTrend } from '@/src/lib/dashboardTrend';
import type { BudgetReviewRow, PipelineStage, TopProject } from '@/src/lib/db/dashboard';
import type { AgeingBuckets } from '@/src/lib/finance/financePosition';
import { BarList, ChartCard, MonthColumns, SeriesKey, StackedBar, type BarRow, type ChartTone } from '@/src/components/dashboard/charts';
import { LossBreakdown } from '@/src/components/dashboard/LossBreakdown';
import { WinRateCard } from '@/src/components/dashboard/WinRateCard';
import type { WinRateRange } from '@/src/hooks/useDashboard';
import { budgetSpendKnown } from './financeData';
import { budgetVsSpentRows } from './overviewData';
import { openPipelineStages } from './pipelineStages';

const linkClass = 'inline-flex items-center gap-1 text-control font-medium text-primary-text hover:underline pointer-coarse:min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
export const CardLink: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
  <Link to={to} className={linkClass}><span>{children}</span><Icon name="chev" className="size-4" /></Link>
);

const money = (amount: number, currency: string) => formatTileMoney(amount, currency) ?? '';

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
  pending: boolean;
  error: boolean;
  retry: () => void;
  currency: string;
  period: string;
  won?: { count: number; amounts: Array<{ currency: string; amount: number }>; href?: string };
  range: WinRateRange;
  className?: string;
}> = ({ weighted, forecastMargin, stages, pending, error, retry, currency, period, won, range, className }) => {
  const { t } = useTranslation('dashboard');
  const navigate = useNavigate();
  const statusLabel = useProjectStatusLabel();
  const open = openPipelineStages(stages);
  const rows: BarRow[] = open.map((stage) => ({ id: String(stage.status), name: `${statusLabel(stage.status as string)} · ${stage.count}`, value: stage.weighted_value, label: money(stage.weighted_value, currency), tone: 'neutral' }));
  const wonValue = won ? tileMoneyLines(won.amounts, currency, formatTileMoney).join(' ') : '';
  return (
    <Card data-testid="sales-overview" className={className}>
      <CardHead level={2} actions={<CardLink to="/sales">{t('dashboard:hub.company.openSales', 'Open sales')}</CardLink>}>{t('home.sales', 'Sales')}</CardHead>
      <CardPad className="grid gap-4">
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
              <span className="block text-control text-muted-foreground">{t('home.wonThisYear', 'Won')} · {period} · {won.count}</span>
              <span className="block text-[23px] font-bold leading-tight tabular">{wonValue}</span>
            </button>
          )}
        </div>
        {pending ? <ListState variant="loading" shape="chart" rows={2} />
          : error ? <ListState variant="error" title={t('dashboard:hub.company.pipelineError', "Couldn't load pipeline stages")} onRetry={retry} />
            : rows.length === 0 ? <ListState variant="empty" icon="pipe" title={t('hub.company.noPipeline', 'No open pipeline stages')} />
              : <BarList rows={rows} ariaLabel={t('home.pipelineChart', 'Weighted pipeline by stage')} nameWidth={150} />}
        <WinRateCard currency={currency} range={range} hidePeriodControl embedded />
      </CardPad>
    </Card>
  );
};

/** Invoiced by month (neutral), with what was collected beside it (accent) when receipts are recorded. */
export const InvoicedCollectedCard: React.FC<{
  trend: InvoicedTrend | null;
  collectedByMonth: Map<string, number> | undefined;
  collectedUnsynced: boolean;
  pending: boolean;
  error: boolean;
  retry: () => void;
  orgCurrency: string;
  className?: string;
}> = ({ trend, collectedByMonth, collectedUnsynced, pending, error, retry, orgCurrency, className }) => {
  const { t } = useTranslation('dashboard');
  const withCollected = Boolean(trend && trend.currency === orgCurrency && collectedByMonth && !collectedUnsynced);
  const title = withCollected ? t('home.invoicedVsCollected', 'Invoiced and collected by month') : t('home.invoicedByMonth', 'Invoiced by month');
  const invoicedName = t('home.chartInvoiced', 'Invoiced, excl. tax');
  const collectedName = t('home.chartCollected', 'Collected');
  const points = (trend?.points ?? []).map((point) => {
    const collected = withCollected ? collectedByMonth!.get(point.month.slice(0, 7)) ?? 0 : undefined;
    return {
      key: point.month,
      tick: formatMonthShort(new Date(Number(point.month.slice(0, 4)), Number(point.month.slice(5, 7)) - 1, 1)),
      a: point.amount,
      labelA: money(point.amount, trend!.currency),
      ...(collected === undefined ? {} : { b: collected, labelB: money(collected, trend!.currency) }),
    };
  });
  return (
    <ChartCard title={title} actions={<CardLink to="/finance/receivables">{t('dashboard:hub.company.openInvoices', 'Open invoices')}</CardLink>}
      known={Boolean(trend?.hasLine)} hiddenReason={t('home.reasonTrend', 'invoicing has fewer than three months of history')}
      pending={pending} error={error ? { title: t('trend.error', "Couldn't load the invoiced trend"), retry } : undefined} testId="chart-invoiced-collected" className={className}>
      {withCollected && <SeriesKey items={[{ label: invoicedName, tone: 'neutral' }, { label: collectedName, tone: 'accent' }]} />}
      <MonthColumns points={points} ariaLabel={title} seriesNames={[invoicedName, collectedName]} />
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

/** Why deals were lost (bars by reason) with win and loss by client as rows under it. */
export const LossReasonsCard: React.FC<{ range: WinRateRange; className?: string }> = ({ range, className }) => {
  const { t } = useTranslation('dashboard');
  return (
    <Card data-testid="chart-loss-reasons" className={className}>
      <CardHead level={2} actions={<CardLink to="/sales">{t('dashboard:hub.company.openSales', 'Open sales')}</CardLink>}>{t('home.whyLost', 'Why deals were lost')}</CardHead>
      <div className="px-[var(--panel-inset)] pb-4"><LossBreakdown range={range} bare chart /></div>
    </Card>
  );
};

const AGE_TONE: Record<keyof AgeingBuckets, ChartTone> = { notDue: 'neutral', d1_30: 'accent', d31_60: 'accent', d61_90: 'bad', over90: 'bad' };
const AGE_KEYS = ['notDue', 'd1_30', 'd31_60', 'd61_90', 'over90'] as const;

/** What clients owe, by how long it has been due (known balances only, in the organisation currency). */
export const ReceivablesAgeCard: React.FC<{ ageing: Record<string, AgeingBuckets>; unknownCount: number; currency: string; pending: boolean; error: boolean; retry: () => void }> = ({ ageing, unknownCount, currency, pending, error, retry }) => {
  const { t } = useTranslation();
  const buckets = ageing[currency];
  const labels: Record<keyof AgeingBuckets, string> = {
    notDue: t('finance:area.notDue', 'Not yet due'),
    d1_30: t('finance:area.days1to30', '1–30 days'),
    d31_60: t('finance:area.days31to60', '31–60 days'),
    d61_90: t('finance:area.days61to90', '61–90 days'),
    over90: t('finance:area.over90Days', 'Over 90 days'),
  };
  const rows: BarRow[] = buckets ? AGE_KEYS.map((key) => ({ id: key, name: labels[key], value: buckets[key] / 100, label: money(buckets[key] / 100, currency), tone: AGE_TONE[key] })) : [];
  const title = t('dashboard:home.receivablesByAge', 'Owed by clients, by age');
  return (
    <ChartCard title={title} actions={<CardLink to="/finance/receivables">{t('dashboard:hub.company.openInvoices', 'Open invoices')}</CardLink>}
      known={Boolean(buckets) && rows.some((row) => (row.value ?? 0) > 0)} hiddenReason={t('dashboard:home.reasonAgeing', 'no client balance is known')}
      pending={pending} error={error ? { title: t('dashboard:home.overdueError', "Couldn't load overdue invoices"), retry } : undefined} testId="chart-receivables-age">
      <BarList rows={rows} ariaLabel={title} nameWidth={112} />
      {unknownCount > 0 && <p className="mt-2 text-control text-muted-foreground">{t('dashboard:home.ageingUnknown', { count: unknownCount, defaultValue_one: '{{count}} invoice with an unknown balance is not drawn', defaultValue_other: '{{count}} invoices with unknown balances are not drawn' })}</p>}
    </ChartCard>
  );
};

/** Budget used per project (spending known only), largest first; over 100% is red. */
export const BudgetUsedCard: React.FC<{ rows: BudgetReviewRow[]; name: (row: BudgetReviewRow) => string; pending: boolean; error: boolean; retry: () => void }> = ({ rows, name, pending, error, retry }) => {
  const { t } = useTranslation('dashboard');
  const used = rows.filter((row) => budgetSpendKnown(row) && row.budget > 0 && row.budget_currency === row.currency)
    .map((row) => ({ row, pct: Math.round((row.spent as number) / row.budget * 100) })).sort((a, b) => b.pct - a.pct).slice(0, 8);
  const title = t('home.budgetUsedByProject', 'Budget used by project');
  const bars: BarRow[] = used.map(({ row, pct }) => ({ id: row.id, name: name(row), value: pct, label: `${pct}%`, tone: pct > 100 ? 'bad' : 'neutral' }));
  if (!pending && !error && rows.length === 0) return null;
  return (
    <ChartCard title={title} actions={<CardLink to="/projects">{t('dashboard:hub.company.openProjects', 'Open projects')}</CardLink>}
      known={bars.length > 0} hiddenReason={t('home.reasonBudgetSpend', 'project spending is not recorded')}
      pending={pending} error={error ? { title: t('dashboard:hub.company.budgetReviewError', "Couldn't load budget review"), retry } : undefined} testId="chart-budget-used">
      <BarList rows={bars} ariaLabel={title} domainMax={Math.max(100, ...used.map((item) => item.pct))} />
    </ChartCard>
  );
};
