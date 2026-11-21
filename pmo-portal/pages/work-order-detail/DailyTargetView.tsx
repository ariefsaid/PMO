import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, ListState, RecordSection } from '@/src/components/ui';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { axisTickStyle, tooltipContentStyle, tooltipLabelStyle } from '@/src/components/dashboard/chartChrome';
import { useWorkOrderDailyTarget } from '@/src/hooks/useWorkOrderDailyTarget';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { formatDate, formatExactMoney, formatNumberMax2, formatShortAmount, formatUtcMonthYearFull } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { revenueGap } from '@/src/lib/revenuePlan';
import { asOfForMonth, shiftMonth, visibleDays } from '@/src/lib/dailyTarget';

interface Props { workOrderId: string }

/**
 * Daily target on the work-order page (#2672, FR-WDT-020): the month's days against the target, month to date and the
 * projection to month end. The target is the #2671 plan row (entered with "Enter plan" above); nothing here calculates
 * one (OD-SCOPE-7). Shows ONLY what the database derived. A refused caller sees "restricted", never a zero; a month with
 * no target says so (FR-WDT-015). The parent mounts this only while the organisation's switch is on.
 */
export const DailyTargetView: React.FC<Props> = ({ workOrderId }) => {
  const { t } = useTranslation('workOrderRevenuePlan');
  const today = useOrgToday();
  const currentMonth = `${today.slice(0, 7)}-01`;
  const [month, setMonth] = useState(currentMonth);
  const q = useWorkOrderDailyTarget(workOrderId, asOfForMonth(month, currentMonth));
  const data = q.data;
  const title = t('daily.title', 'Daily target');
  const rows = useMemo(() => visibleDays(data?.days ?? []), [data]);
  const chart = useMemo(() => rows.map((d) => ({ date: d.date.slice(8), target: Number(d.target), actual: Number(d.actual) })), [rows]);
  const monthLabel = formatUtcMonthYearFull(new Date(`${month}T00:00:00Z`));

  const nav = (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" aria-label={t('daily.prevMonth', 'Previous month')} onClick={() => setMonth(shiftMonth(month, -1))}>‹</Button>
      <span className="min-w-[8rem] text-center text-control" data-testid="daily-target-month">{monthLabel}</span>
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

  const money = (v: string) => formatExactMoney(v, data.currency, getNumberLocale()) ?? v;
  const gapWords = (gap: string) => {
    const g = revenueGap(gap);
    return g.state === 'behind' ? t('daily.behind', '{{amount}} behind target', { amount: money(g.by) })
      : g.state === 'ahead' ? t('daily.ahead', '{{amount}} ahead of target', { amount: money(g.by) })
      : t('daily.onTarget', 'On target');
  };
  const figure = (testId: string, label: string, value: React.ReactNode) => (
    <div key={testId}><dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums" data-testid={testId}>{value}</dd></div>
  );
  const none = t('daily.noTarget', 'No target entered');
  const summary = t('daily.chartSummary', 'Daily revenue for {{month}}: target against actual per day.', { month: monthLabel });

  return (
    <RecordSection title={title} data-testid="wo-page-daily-target" actions={nav}>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-control sm:grid-cols-4">
        {figure('wo-daily-mtd-target', t('daily.mtdTarget', 'Target to date'), data.hasTarget ? money(data.mtdTarget) : none)}
        {figure('wo-daily-mtd-actual', t('daily.mtdActual', 'Actual to date'), money(data.mtdActual))}
        {figure('wo-daily-mtd-gap', t('daily.mtdGap', 'Gap to date'), data.hasTarget ? gapWords(data.mtdGap) : none)}
        {figure('wo-daily-projection', t('daily.projection', 'Projection to month end'),
          data.projection === null ? t('daily.projectionNone', 'Not enough working days yet') : money(data.projection))}
      </dl>
      {data.hasTarget && data.projection !== null && data.projectedGap !== null && (
        <p className="mt-2 text-control" data-testid="wo-daily-projected-gap">
          {t('daily.projectedGap', 'Month target {{target}}: the projection is {{words}}.', { target: money(data.monthTarget), words: gapWords(data.projectedGap) })}
        </p>
      )}
      <p className="mt-1 text-control text-muted-foreground">
        {t('daily.note', 'The projection continues the average actual per working day so far. It is a projection, not a target. Enter targets with "Enter plan" above.')}
      </p>
      {data.days.some((d) => d.pendingReports > 0) && (
        <p className="mt-1 text-control text-muted-foreground" data-testid="wo-daily-pending">
          {t('daily.pending', 'Daily reports not yet validated are not counted as actual.')}
        </p>
      )}
      {rows.length > 0 && (
        <figure role="img" aria-label={summary} className="m-0 mt-4 hidden sm:block" data-testid="wo-daily-chart">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis dataKey="date" tick={axisTickStyle} tickLine={false} axisLine={{ stroke: chartTheme.grid }} />
              <YAxis tick={axisTickStyle} tickLine={false} axisLine={{ stroke: chartTheme.grid }} width={56} tickFormatter={(v: number) => formatShortAmount(v)} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => formatNumberMax2(Number(v))} />
              <Bar dataKey="target" name={t('daily.seriesTarget', 'Target')} fill={chartTheme.series.primary} isAnimationActive={false} />
              <Bar dataKey="actual" name={t('daily.seriesActual', 'Actual')} fill={chartTheme.series.success} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </figure>
      )}
      {rows.length === 0 ? <p className="mt-3 text-control text-muted-foreground">{t('daily.empty', 'No working days in this month.')}</p> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-control" data-testid="wo-daily-table">
            <caption className="sr-only">{t('daily.caption', 'Daily target and actual for {{month}}', { month: monthLabel })}</caption>
            <thead><tr className="text-right text-muted-foreground">
              <th scope="col" className="py-1 pr-4 text-left font-normal">{t('daily.day', 'Day')}</th>
              <th scope="col" className="py-1 pr-4 font-normal">{t('daily.target', 'Target')}</th>
              <th scope="col" className="py-1 pr-4 font-normal">{t('daily.actual', 'Actual')}</th>
              <th scope="col" className="py-1 font-normal">{t('daily.dayGap', 'Gap')}</th>
            </tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.date} className="border-t border-border" data-testid={`wo-daily-row-${d.date}`}>
                  <th scope="row" className="py-1 pr-4 text-left font-normal">
                    {formatDate(d.date)}
                    {d.listed && (
                      <div className="text-muted-foreground" data-testid={`wo-daily-nonworking-${d.date}`}>
                        {d.nonWorkingLabel ? t('daily.nonWorkingLabelled', 'Non-working day: {{label}}', { label: d.nonWorkingLabel }) : t('daily.nonWorking', 'Non-working day')}
                      </div>
                    )}
                  </th>
                  <td className="py-1 pr-4 text-right tabular-nums">{d.hasTarget ? money(d.target) : '—'}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">
                    {money(d.actual)}
                    {d.pendingReports > 0 && <div className="text-muted-foreground">{t('daily.dayPending', '{{count}} not yet validated', { count: d.pendingReports })}</div>}
                  </td>
                  <td className="py-1 text-right tabular-nums">{d.hasTarget ? gapWords(d.gap) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </RecordSection>
  );
};
