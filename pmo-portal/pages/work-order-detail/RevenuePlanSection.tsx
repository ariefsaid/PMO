import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, ListState, RecordSection } from '@/src/components/ui';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { axisTickStyle, tooltipContentStyle, tooltipLabelStyle } from '@/src/components/dashboard/chartChrome';
import { usePermission } from '@/src/auth/usePermission';
import { useWorkOrderRevenuePlan } from '@/src/hooks/useWorkOrderRevenuePlan';
import { formatDay, formatIsoDay, formatNumberMax2, formatShortAmount, formatTableMoney } from '@/src/lib/format';
import { revenueGap } from '@/src/lib/revenuePlan';
import { RevenuePlanModal } from './RevenuePlanModal';
import { useAreaHelp } from './useAreaHelp';

interface Props { workOrderId: string; woLabel: string; frozen: boolean }

/**
 * Revenue plan on the work-order page (#2671, FR-WRP-020): plan to date, actual (validated daily revenue) and the gap,
 * a cumulative plan-versus-actual chart and the entry form. Shows ONLY what the database derived (FR-WRP-010). A caller
 * the database refuses sees "restricted", never a zero (FR-WRP-012); a work order with no plan says so (FR-WRP-014).
 * The parent mounts this only while the organisation's switch is on.
 */
export const RevenuePlanSection: React.FC<Props> = ({ workOrderId, woLabel, frozen }) => {
  const { t } = useTranslation('workOrderRevenuePlan');
  const may = usePermission();
  const canManage = may('manage', 'workOrderRevenuePlan') && !frozen;
  const q = useWorkOrderRevenuePlan(workOrderId);
  const [open, setOpen] = useState(false);
  const title = t('title', 'Revenue plan');
  useAreaHelp('revenue-plan', title, t('actualBasis', 'Actual is validated daily revenue.'));
  const data = q.data;
  const series = useMemo(() => (data?.series ?? []).map((p) => ({ date: p.date, plan: Number(p.cumPlan), actual: Number(p.cumActual) })), [data]);

  if (q.isPending) return <RecordSection title={title} data-testid="wo-page-revenue-plan"><ListState variant="loading" rows={3} /></RecordSection>;
  if ((q.error as { code?: string } | null)?.code === '42501') {
    return <RecordSection title={title} data-testid="wo-page-revenue-plan"><p role="status" className="text-control text-muted-foreground">{t('restricted', 'The revenue plan is restricted for your role.')}</p></RecordSection>;
  }
  if (q.isError) {
    return <RecordSection title={title} data-testid="wo-page-revenue-plan"><ListState variant="error" title={t('loadError', "Couldn't load the revenue plan")} retryLabel={t('retry', 'Try again')} onRetry={() => void q.refetch()} /></RecordSection>;
  }
  if (!data) return null;

  const money = (v: string) => formatTableMoney(v, data.currency) ?? v;
  const gap = revenueGap(data.gap);
  const gapText = !data.hasPlan
    ? t('noPlan', 'No plan entered')
    : gap.state === 'behind' ? t('behind', '{{amount}} behind plan', { amount: money(gap.by) })
    : gap.state === 'ahead' ? t('ahead', '{{amount}} ahead of plan', { amount: money(gap.by) })
    : t('onPlan', 'On plan');
  const figure = (testId: string, label: string, value: React.ReactNode) => (
    <div key={testId}><dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums" data-testid={testId}>{value}</dd></div>
  );
  const summary = t('chartSummary', 'Cumulative revenue: plan {{plan}}, actual {{actual}} to {{date}}.', { plan: money(data.planToDate), actual: money(data.actualToDate), date: formatIsoDay(data.asOf) });

  return (
    <RecordSection title={title} data-testid="wo-page-revenue-plan"
      actions={canManage ? <Button variant="outline" size="sm" onClick={() => setOpen(true)}>{t('enter', 'Enter plan')}</Button> : undefined}>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-control sm:grid-cols-4">
        {figure('wo-revenue-plan-plan', t('planToDate', 'Plan to date'), data.hasPlan ? money(data.planToDate) : t('noPlan', 'No plan entered'))}
        {figure('wo-revenue-plan-actual', t('actualToDate', 'Actual to date'), money(data.actualToDate))}
        {figure('wo-revenue-plan-gap', t('gap', 'Gap'), gapText)}
        {figure('wo-revenue-plan-total', t('planTotal', 'Whole plan'), data.hasPlan ? money(data.planTotal) : '—')}
      </dl>
      {data.pendingReports > 0 && (
        <p className="mt-2 text-control text-muted-foreground" data-testid="wo-revenue-plan-pending">
          {t('pending', '{{count}} daily report(s) not yet validated are not counted as actual.', { count: data.pendingReports })}
        </p>
      )}
      <p className="mt-2 text-control text-muted-foreground" data-testid="wo-revenue-plan-asof">{t('asOfDate', 'As of {{date}}', { date: formatIsoDay(data.asOf) })}</p>
      {data.hasPlan && series.length > 1 && (
        <figure role="img" aria-label={summary} className="m-0 mt-4" data-testid="wo-revenue-plan-chart">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis dataKey="date" tick={axisTickStyle} tickLine={false} axisLine={{ stroke: chartTheme.grid }} minTickGap={32} tickFormatter={(d: string) => formatDay(d)} />
              <YAxis tick={axisTickStyle} tickLine={false} axisLine={{ stroke: chartTheme.grid }} width={56} tickFormatter={(v: number) => formatShortAmount(v)} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} labelFormatter={(d) => formatDay(String(d))} formatter={(v) => formatNumberMax2(Number(v))} />
              <Line type="monotone" dataKey="plan" name={t('seriesPlan', 'Plan')} stroke={chartTheme.series.primary} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="actual" name={t('seriesActual', 'Actual')} stroke={chartTheme.series.success} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <figcaption className="mt-1 text-control text-muted-foreground">{t('legend', 'Dashed: plan. Solid: actual (cumulative).')}</figcaption>
        </figure>
      )}
      {open && <RevenuePlanModal workOrderId={workOrderId} woLabel={woLabel} currency={data.currency} onClose={() => setOpen(false)} />}
    </RecordSection>
  );
};
