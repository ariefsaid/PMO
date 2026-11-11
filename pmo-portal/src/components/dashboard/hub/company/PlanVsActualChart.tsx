import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { ListState } from '@/src/components/ui/ListState';
import { tooltipContentStyle, tooltipCursorFill, tooltipLabelStyle } from '@/src/components/dashboard/chartChrome';
import { usePrefersReducedMotion } from '@/src/components/dashboard/usePrefersReducedMotion';
import { formatCompactCurrency, formatCurrency } from '@/src/lib/format';
import { planVsActualRows } from './planVsActual';
import { wrapProjectName } from './projectName';
import type { TopProject } from '@/src/lib/db/dashboard';

export interface PlanVsActualChartProps { projects: TopProject[]; currency: string }

const NameTick: React.FC<{
  x?: number | string;
  y?: number | string;
  payload?: { value: string };
  compact: boolean;
}> = ({ x = 0, y = 0, payload, compact }) => {
  const name = payload?.value ?? '';
  const lines = wrapProjectName(name, compact ? 19 : 22);
  const textX = Number(x) - 4;
  return (
    <text x={textX} y={Number(y) + (lines.length > 1 ? -6 : 4)} textAnchor="end" style={{ fontSize: 12, fill: 'hsl(var(--foreground))' }}>
      <title>{name}</title>
      {lines.map((line, index) => <tspan key={index} x={textX} dy={index === 0 ? 0 : 14}>{line}</tspan>)}
    </text>
  );
};

interface DirectRowSummaryProps {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  value?: unknown;
}

const DirectRowSummary: React.FC<DirectRowSummaryProps> = ({ x = 0, y = 0, width = 0, value }) => {
  if (typeof value !== 'string' || !value) return null;
  const lines = value.split('\n');
  const textX = Number(x) + Number(width) + 6;
  const textY = Number(y) + 4 - ((lines.length - 1) * 7);
  return (
    <text x={textX} y={textY} textAnchor="start" style={{ fontSize: 12, fontWeight: 600, fill: 'hsl(var(--foreground))' }}>
      {lines.map((line, index) => <tspan key={index} x={textX} dy={index === 0 ? 0 : 14}>{line}</tspan>)}
    </text>
  );
};

const rowSummary = () => (props: DirectRowSummaryProps) => <DirectRowSummary {...props} />;

export const PlanVsActualChart: React.FC<PlanVsActualChartProps> = ({ projects, currency }) => {
  const { t } = useTranslation('dashboard');
  const reduced = usePrefersReducedMotion();
  const [chartWidth, setChartWidth] = React.useState(0);
  const compact = chartWidth > 0 && chartWidth < 480;
  const planLabel = t('hub.company.planVsActual.plan', 'Contract');
  const actualLabel = t('hub.company.planVsActual.actual', 'Spent');
  const budgetLabel = t('hub.company.planVsActual.budget', 'Active budget');
  const budgetShortLabel = t('hub.company.planVsActual.budgetShort', 'Budget');
  const rows = React.useMemo(() => planVsActualRows(projects, currency).map((row) => {
    const planSummary = `${planLabel} ${formatCompactCurrency(row.plan, currency)}`;
    const budgetSummary = row.budget == null ? null : `${budgetShortLabel} ${formatCompactCurrency(row.budget, currency)}`;
    const actualSummary = row.actual == null ? null : `${actualLabel} ${formatCompactCurrency(row.actual, currency)}`;
    const summary = compact
      ? [planSummary, budgetSummary, actualSummary].filter((label): label is string => label !== null).join('\n')
      : [[planSummary, budgetSummary].filter((label): label is string => label !== null).join(' · '), actualSummary].filter((label): label is string => label !== null).join('\n');
    let anchor: 'plan' | 'budget' | 'actual' = 'plan';
    let maxValue = row.plan;
    if (row.budget != null && row.budget > maxValue) {
      anchor = 'budget';
      maxValue = row.budget;
    }
    if (row.actual != null && row.actual > maxValue) anchor = 'actual';
    return {
      ...row,
      used: row.actual != null && row.budget ? Math.round((row.actual / row.budget) * 100) : null,
      summaryOnPlan: anchor === 'plan' ? summary : null,
      summaryOnBudget: anchor === 'budget' ? summary : null,
      summaryOnActual: anchor === 'actual' ? summary : null,
    };
  }), [projects, currency, planLabel, budgetShortLabel, actualLabel, compact]);
  const name = t('hub.company.planVsActual.name', 'Plan vs actual by project');
  if (rows.length === 0) return <ListState variant="empty" icon="grid" title={t('hub.company.planVsActual.empty', 'No projects to compare yet')} />;
  const incomplete = rows.filter((row) => row.actual == null).length;
  const noBudget = rows.filter((row) => row.budget == null).length;
  const otherCurrency = projects.filter((project) => project.currency !== currency).length;
  const chartHeight = Math.max(300, rows.length * 50);
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-[300px] flex-1"><div role="img" aria-label={`${name}. ${rows.map((row) => `${row.name}: ${planLabel} ${formatCurrency(row.plan, currency)}, ${budgetLabel} ${row.budget == null ? 'unknown' : formatCurrency(row.budget, currency)}, ${actualLabel} ${row.actual == null ? 'unknown' : formatCurrency(row.actual, currency)}`).join('; ')}`} className="h-full min-h-[300px]">
        <ResponsiveContainer width="100%" height={chartHeight} onResize={(width) => setChartWidth(width)}>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: compact ? 128 : 200, bottom: 4, left: 0 }} barGap={2} barCategoryGap="22%">
            <XAxis type="number" domain={[0, 'auto']} tick={false} tickLine={false} stroke={chartTheme.grid} />
            <YAxis type="category" dataKey="name" tick={<NameTick compact={compact} />} stroke={chartTheme.grid} width={compact ? 142 : 160} interval={0} tickLine={false} axisLine={false} />
            <Tooltip cursor={tooltipCursorFill} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value, key, item) => [formatCurrency(Number(value), currency) + (key === 'actual' && item?.payload?.used != null ? ` (${t('common:uxs02.budgetUsed', '{{percent}}% of Active budget', { percent: item.payload.used })})` : ''), key === 'actual' ? actualLabel : key === 'budget' ? budgetLabel : planLabel]} />
            <Bar dataKey="plan" name={planLabel} fill={chartTheme.series.neutral} radius={[0, 3, 3, 0]} isAnimationActive={!reduced} minPointSize={2}>
              <LabelList dataKey="summaryOnPlan" position="right" content={rowSummary()} />
            </Bar>
            <Bar dataKey="budget" name={budgetLabel} fill={chartTheme.series.primary} fillOpacity={0.12} stroke={chartTheme.series.primary} radius={[0, 3, 3, 0]} isAnimationActive={!reduced} minPointSize={2}>
              <LabelList dataKey="summaryOnBudget" position="right" content={rowSummary()} />
            </Bar>
            <Bar dataKey="actual" name={actualLabel} fill={chartTheme.series.primary} radius={[0, 3, 3, 0]} isAnimationActive={!reduced} minPointSize={2}>
              {rows.map((row) => <Cell key={row.id} fill={row.used != null && row.used > 100 ? chartTheme.series.destructive : chartTheme.series.primary} />)}
              <LabelList dataKey="summaryOnActual" position="right" content={rowSummary()} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div></div>
      {noBudget > 0 && (
        <p data-testid="plan-actual-no-budget" className="mt-1 text-control text-muted-foreground">
          {t('hub.company.planVsActual.noBudget', { count: noBudget, defaultValue: '{{count}} projects have no active budget yet', defaultValue_one: '{{count}} project has no active budget yet' })}
          {' '}<Link to="/projects" className="font-medium text-primary-text hover:underline">{t('hub.company.planVsActual.setBudgets', 'Set budgets')}</Link>
        </p>
      )}
      {(incomplete > 0 || otherCurrency > 0) && (
        <p data-testid="plan-actual-caption" className="mt-2 text-control text-muted-foreground">
          {[
            incomplete > 0 ? t('hub.company.planVsActual.incomplete', { count: incomplete, defaultValue: 'Spent is incomplete for {{count}} projects; known bars are shown', defaultValue_one: 'Spent is incomplete for {{count}} project; known bars are shown' }) : null,
            otherCurrency > 0 ? t('hub.company.planVsActual.otherCurrency', { count: otherCurrency, defaultValue: '{{count}} projects in another currency are left out', defaultValue_one: '{{count}} project in another currency is left out' }) : null,
          ].filter(Boolean).join(' · ')}
        </p>
      )}
      <table aria-label={name} className="sr-only table-fixed">
        <thead><tr><th>{t('hub.company.project', 'Project')}</th><th>{planLabel}</th><th>{budgetLabel}</th><th>{actualLabel}</th><th>{t('hub.company.planVsActual.share', 'Spent of contract')}</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}><th scope="row">{row.name}</th><td>{formatCurrency(row.plan, currency)}</td><td>{row.budget == null ? t('dashboard:executive.noActiveBudget', 'No active budget') : formatCurrency(row.budget, currency)}</td><td>{row.actual == null ? '—' : formatCurrency(row.actual, currency)}</td><td>{row.percent == null ? '—' : `${row.percent}%`}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
