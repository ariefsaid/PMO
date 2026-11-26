import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, ListState, RecordSection } from '@/src/components/ui';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { axisTickStyle, tooltipContentStyle, tooltipLabelStyle } from '@/src/components/dashboard/chartChrome';
import { useWorkOrderDailyTarget } from '@/src/hooks/useWorkOrderDailyTarget';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { formatDay, formatNumberMax2, formatTableMoney, formatShortAmount, formatUtcMonthYearFull } from '@/src/lib/format';
import { revenueGap } from '@/src/lib/revenuePlan';
import { asOfForMonth, shiftMonth, visibleDays } from '@/src/lib/dailyTarget';
import { buildDailyCost, DAY_CATEGORIES, type SourceGroup } from '@/src/lib/workOrderCostView';
import { useAreaHelp } from './useAreaHelp';
import { RevenuePlanModal } from './RevenuePlanModal';

interface Props {
  workOrderId: string;
  /** The cost list's own groups (lines + amounts): the days' cost is grouped from these, never re-read or re-priced (#1126). */
  costGroups?: SourceGroup[] | null;
  /** Where the reader may enter a target: the work order's label for the entry form (the empty month offers it). */
  plan?: { woLabel: string } | null;
  /** True when rendered beneath `RevenuePlanSection` on the same tab: omit cumulative to-date duplicates and keep month-specific projection + daily bars. */
  monthOnly?: boolean;
}

/**
 * Daily target on the work-order page (#2672, FR-WDT-020; per-day cost #1126). Two questions, two blocks:
 *   1. Are we on target this month? Target, actual and gap to date, the projection to month end, the chart.
 *   2. Did each day pay for itself? Per day: target, revenue, gap, cost by kind, revenue less cost.
 * The target is the #2671 plan row (entered with "Enter plan"); nothing here calculates one (OD-SCOPE-7). Shows ONLY
 * what the database derived and the cost list priced. A refused caller sees "restricted", never a zero; a month with no
 * target says so (FR-WDT-015). A day with nothing on it gets no row: the quiet days are counted under the table.
 * The parent mounts this only while the organisation's switch is on.
 */
export const DailyTargetView: React.FC<Props> = ({ workOrderId, costGroups = null, plan = null, monthOnly = false }) => {
  const { t } = useTranslation('workOrderRevenuePlan');
  const today = useOrgToday();
  const currentMonth = `${today.slice(0, 7)}-01`;
  const [month, setMonth] = useState(currentMonth);
  const [entering, setEntering] = useState(false);
  const q = useWorkOrderDailyTarget(workOrderId, asOfForMonth(month, currentMonth));
  const data = q.data;
  const title = t('daily.title', 'Daily target');
  useAreaHelp('daily-target', title, t('daily.note', 'The projection continues the average actual per working day so far. It is a projection, not a target. Enter targets with "Enter plan" above.'));
  const daily = useMemo(() => (costGroups && data ? buildDailyCost(costGroups, data.currency) : null), [costGroups, data]);
  // A day that carries cost stays on the table even when it is a non-working day, so the days always add up to the cost list.
  const shown = useMemo(() => (data?.days ?? []).filter((d) => visibleDays([d]).length > 0 || daily?.days[d.date] !== undefined), [data, daily]);
  const chart = useMemo(() => shown.map((d) => ({ date: d.date.slice(8), target: Number(d.target), actual: Number(d.actual) })), [shown]);
  // A day earns a row when something is on it: a target, revenue, a report waiting, cost, or a listed closure.
  const costCells = useMemo(() => (daily ? [...Object.values(daily.days), ...(daily.undated ? [daily.undated] : [])] : []), [daily]);
  const costCols = DAY_CATEGORIES.filter((k) => costCells.some((c) => typeof c[k] === 'number'));
  const hasCostTotal = costCells.some((c) => typeof c.total === 'number');
  // A day earns a row when something on it can be shown: a target, revenue, a report waiting, a listed closure, or cost
  // this reader can read. A day whose only cost cannot be read here (another currency, a restricted amount) is counted apart.
  const readableCost = (date: string) => {
    const c = daily?.days[date];
    return c !== undefined && (typeof c.total === 'number' || costCols.some((k) => typeof c[k] === 'number'));
  };
  const rows = shown.filter((d) => d.hasTarget || Number(d.actual) !== 0 || d.pendingReports > 0 || d.listed || readableCost(d.date));
  const unreadable = shown.filter((d) => !rows.includes(d) && daily?.days[d.date] !== undefined).length;
  const quiet = shown.length - rows.length - unreadable;
  const monthLabel = formatUtcMonthYearFull(new Date(`${month}T00:00:00Z`));

  const nav = (
    <div className="flex items-center gap-1.5">
      <Button variant="outline" size="sm" aria-label={t('daily.prevMonth', 'Previous month')} onClick={() => setMonth(shiftMonth(month, -1))}>‹</Button>
      <span className="min-w-[6.5rem] text-center text-control whitespace-nowrap" data-testid="daily-target-month">{monthLabel}</span>
      <Button variant="outline" size="sm" aria-label={t('daily.nextMonth', 'Next month')} onClick={() => setMonth(shiftMonth(month, 1))}>›</Button>
    </div>
  );

  if (q.isPending) return <RecordSection title={title} data-testid="wo-page-daily-target"><ListState variant="loading" rows={3} /></RecordSection>;
  if ((q.error as { code?: string } | null)?.code === '42501') {
    return <RecordSection title={title} data-testid="wo-page-daily-target"><p role="status" className="text-control text-muted-foreground">{t('restricted', 'The revenue plan is restricted for your role.')}</p></RecordSection>;
  }
  if (q.isError) {
    return <RecordSection title={title} data-testid="wo-page-daily-target"><ListState variant="error" title={t('daily.loadError', "Couldn't load the daily target")} retryLabel={t('retry', 'Try again')} onRetry={() => void q.refetch()} /></RecordSection>;
  }
  if (!data) return null;

  // Read-only money in whole units (screen rules), through the shared table formatter.
  const money = (v: string) => formatTableMoney(v, data.currency) ?? v;
  const gapWords = (gap: string) => {
    const g = revenueGap(gap);
    return g.state === 'behind' ? t('daily.behind', '{{amount}} behind target', { amount: money(g.by) })
      : g.state === 'ahead' ? t('daily.ahead', '{{amount}} ahead of target', { amount: money(g.by) })
      : t('daily.onTarget', 'On target');
  };
  const signedGap = (gap: string) => {
    const g = revenueGap(gap);
    if (g.state === 'behind') return `-${money(g.by)}`;
    if (g.state === 'ahead') return `+${money(g.by)}`;
    return money('0');
  };
  const figure = (testId: string, label: string, value: React.ReactNode) => (
    <div key={testId} className="row-span-2 grid min-w-0 grid-rows-subgrid gap-y-1">
      <dt className="self-end text-muted-foreground">{label}</dt>
      <dd className="self-start font-medium tabular-nums" data-testid={testId}>{value}</dd>
    </div>
  );
  const costFigure = (v: number | null | undefined) => (typeof v === 'number' ? money(toMoney(v)) : '—');
  const none = t('daily.noTarget', 'No target entered');
  const summary = t('daily.chartSummary', 'Daily revenue for {{month}}: target against actual per day.', { month: monthLabel });
  const undated = typeof daily?.undated?.total === 'number' ? daily.undated.total : null;

  // Nothing to compare yet: no target, nothing earned, nothing waiting and no cost in the month. Say so once and offer the one fix.
  if (!data.hasTarget && rows.length === 0 && undated === null) {
    return (
      <RecordSection title={title} data-testid="wo-page-daily-target" actions={nav}>
        <div className="flex flex-wrap items-center justify-between gap-3" data-testid="wo-daily-empty">
          <p className="text-control text-muted-foreground">{t('daily.nothing', 'No target and no actual in {{month}}.', { month: monthLabel })}</p>
          {plan && <Button variant="outline" size="sm" onClick={() => setEntering(true)}>{t('enter', 'Enter plan')}</Button>}
        </div>
        {entering && plan && <RevenuePlanModal workOrderId={workOrderId} woLabel={plan.woLabel} currency={data.currency} onClose={() => setEntering(false)} />}
      </RecordSection>
    );
  }

  // Phone: each day is a card (its date over labelled figures); wider screens read one table.
  const cell = 'py-2.5 text-right align-baseline tabular-nums max-sm:flex max-sm:justify-between max-sm:gap-4 max-sm:py-0.5 max-sm:before:text-muted-foreground max-sm:before:content-[attr(data-label)]';
  const L = {
    target: t('daily.target', 'Target'), actual: t('daily.actual', 'Actual'), gap: t('daily.dayGap', 'Gap'),
    total: t('daily.cost.total', 'Cost'), net: t('daily.cost.net', 'Revenue less cost'),
  };
  return (
    <div className="flex flex-col gap-[var(--space-section)]" data-testid="wo-page-daily-target">
      <RecordSection title={title} actions={nav}>
        {monthOnly ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-control sm:grid-cols-2">
            {figure('wo-daily-month-target', t('daily.monthTarget', 'Month target'), data.hasTarget ? money(data.monthTarget) : none)}
            {figure('wo-daily-projection', t('daily.projection', 'Projection to month end'),
              data.projection === null ? t('daily.projectionNone', 'Not enough working days yet') : money(data.projection))}
          </dl>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-control sm:grid-cols-4">
            {figure('wo-daily-mtd-target', t('daily.mtdTarget', 'Target to date'), data.hasTarget ? money(data.mtdTarget) : none)}
            {figure('wo-daily-mtd-actual', t('daily.mtdActual', 'Actual to date'), money(data.mtdActual))}
            {figure('wo-daily-mtd-gap', t('daily.mtdGap', 'Gap to date'), data.hasTarget ? gapWords(data.mtdGap) : none)}
            {figure('wo-daily-projection', t('daily.projection', 'Projection to month end'),
              data.projection === null ? t('daily.projectionNone', 'Not enough working days yet') : money(data.projection))}
          </dl>
        )}
        {data.hasTarget && data.projection !== null && data.projectedGap !== null && (
          <p className="mt-3 text-control" data-testid="wo-daily-projected-gap">
            {t('daily.projectedGap', 'Month target {{target}}: the projection is {{words}}.', { target: money(data.monthTarget), words: gapWords(data.projectedGap) })}
          </p>
        )}
        {data.days.some((d) => d.pendingReports > 0) && (
          <p className="mt-1 text-control text-muted-foreground" data-testid="wo-daily-pending">
            {t('daily.pending', 'Daily reports not yet validated are not counted as actual.')}
          </p>
        )}
        {shown.length > 0 && (
          <figure role="img" aria-label={summary} className="m-0 mt-4" data-testid="wo-daily-chart">
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-support text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block size-2.5 rounded-xs border" style={{ borderColor: chartTheme.series.neutral, backgroundColor: 'transparent' }} />
                {t('daily.seriesTarget', 'Target')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block size-2.5 rounded-xs" style={{ backgroundColor: chartTheme.series.success }} />
                {t('daily.seriesActual', 'Actual')}
              </span>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[440px] sm:min-w-0">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                    <XAxis dataKey="date" tick={axisTickStyle} tickLine={false} axisLine={{ stroke: chartTheme.grid }} />
                    <YAxis tick={axisTickStyle} tickLine={false} axisLine={{ stroke: chartTheme.grid }} width={56} tickFormatter={(v: number) => formatShortAmount(v)} />
                    <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatNumberMax2(Number(v))} />
                    <Bar dataKey="target" name={t('daily.seriesTarget', 'Target')} fill={chartTheme.series.neutral} fillOpacity={0.22} stroke={chartTheme.series.neutral} strokeWidth={1} isAnimationActive={false} />
                    <Bar dataKey="actual" name={t('daily.seriesActual', 'Actual')} fill={chartTheme.series.success} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </figure>
        )}
      </RecordSection>

      <RecordSection title={t('daily.byDay', 'Each day')} data-testid="wo-daily-days">
        {rows.length === 0 ? <p className="text-control text-muted-foreground">{shown.length === 0 ? t('daily.empty', 'No working days in this month.') : t('daily.allQuiet', 'No day in {{month}} has a target, revenue or cost yet.', { month: monthLabel })}</p> : (
          <table className="w-full text-control max-sm:block" data-testid="wo-daily-table">
            <caption className="sr-only">{t('daily.caption', 'Daily target and actual for {{month}}', { month: monthLabel })}</caption>
            <thead className="max-sm:sr-only"><tr className="text-right text-muted-foreground">
              <th scope="col" className="pb-2 pr-4 text-left font-normal">{t('daily.day', 'Day')}</th>
              <th scope="col" className="pb-2 pr-4 font-normal">{L.target}</th>
              <th scope="col" className="pb-2 pr-4 font-normal">{L.actual}</th>
              <th scope="col" className={`pb-2 font-normal ${costCols.length || hasCostTotal ? 'pr-4' : ''}`}>{L.gap}</th>
              {costCols.map((k) => <th key={k} scope="col" className="pb-2 pr-4 font-normal">{t(`daily.cost.${k}`, k)}</th>)}
              {hasCostTotal && <th scope="col" className="pb-2 pr-4 font-normal">{L.total}</th>}
              {hasCostTotal && <th scope="col" className="pb-2 font-normal">{L.net}</th>}
            </tr></thead>
            <tbody className="max-sm:block">
              {rows.map((d) => {
                const dayCost = daily?.days[d.date];
                return (
                  <tr key={d.date} className="border-t border-border max-sm:block max-sm:py-3" data-testid={`wo-daily-row-${d.date}`}>
                    <th scope="row" className="py-2.5 pr-4 text-left align-baseline font-normal whitespace-nowrap max-sm:block max-sm:pb-1 max-sm:font-medium">
                      {formatDay(d.date)}
                      {d.listed && (
                        <div className="font-normal whitespace-normal text-muted-foreground" data-testid={`wo-daily-nonworking-${d.date}`}>
                          {d.nonWorkingLabel ? t('daily.nonWorkingLabelled', 'Non-working day: {{label}}', { label: d.nonWorkingLabel }) : t('daily.nonWorking', 'Non-working day')}
                        </div>
                      )}
                    </th>
                    <td className={`${cell} pr-4 whitespace-nowrap max-sm:pr-0`} data-label={L.target}>{d.hasTarget ? money(d.target) : '—'}</td>
                    <td className={`${cell} pr-4 whitespace-nowrap max-sm:pr-0`} data-label={L.actual}>
                      <span>{money(d.actual)}{d.pendingReports > 0 && <span className="block whitespace-normal text-muted-foreground">{t('daily.dayPending', '{{count}} not yet validated', { count: d.pendingReports })}</span>}</span>
                    </td>
                    <td className={`${cell} whitespace-nowrap ${costCols.length || hasCostTotal ? 'pr-4 max-sm:pr-0' : ''}`} data-label={L.gap}>{d.hasTarget ? signedGap(d.gap) : '—'}</td>
                    {costCols.map((k) => <td key={k} className={`${cell} pr-4 max-sm:pr-0`} data-label={t(`daily.cost.${k}`, k)} data-testid={`wo-daily-cost-${k}-${d.date}`}>{costFigure(dayCost?.[k])}</td>)}
                    {hasCostTotal && <td className={`${cell} pr-4 max-sm:pr-0`} data-label={L.total} data-testid={`wo-daily-cost-total-${d.date}`}>{costFigure(dayCost?.total)}</td>}
                    {hasCostTotal && <td className={`${cell} font-medium`} data-label={L.net} data-testid={`wo-daily-cost-net-${d.date}`}>
                      {typeof dayCost?.total === 'number' ? money(toMoney((Math.round(Number(d.actual) * 100) - Math.round(dayCost.total * 100)) / 100)) : '—'}
                    </td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {(quiet > 0 || unreadable > 0 || undated !== null) && (
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-control text-muted-foreground">
            {quiet > 0 && rows.length > 0 && <span data-testid="wo-daily-quiet">{t('daily.quiet', { count: quiet, defaultValue_one: '1 day with nothing on it', defaultValue_other: '{{count}} days with nothing on them' })}</span>}
            {unreadable > 0 && <span data-testid="wo-daily-cost-unreadable">{t('daily.cost.unreadableDays', { count: unreadable, defaultValue_one: '1 day has cost in another currency or not shown to you', defaultValue_other: '{{count}} days have cost in another currency or not shown to you' })}</span>}
            {undated !== null && <span data-testid="wo-daily-cost-undated">{t('daily.cost.undated', 'Not dated to a day: {{amount}}', { amount: money(toMoney(undated)) })}</span>}
          </p>
        )}
      </RecordSection>
      {entering && plan && <RevenuePlanModal workOrderId={workOrderId} woLabel={plan.woLabel} currency={data.currency} onClose={() => setEntering(false)} />}
    </div>
  );
};

const toMoney = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
