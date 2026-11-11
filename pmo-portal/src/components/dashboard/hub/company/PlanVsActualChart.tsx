import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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
  const lines = wrapProjectName(name, compact ? 15 : 20);
  const textX = Number(x) - 4;
  return (
    <text x={textX} y={Number(y) + (lines.length > 1 ? -6 : 4)} textAnchor="end" style={{ fontSize: 12, fill: 'hsl(var(--foreground))' }}>
      <title>{name}</title>
      {lines.map((line, index) => <tspan key={index} x={textX} dy={index === 0 ? 0 : 14}>{line}</tspan>)}
    </text>
  );
};

type BarLabelTone = 'contract' | 'budget' | 'spent';
interface DirectBarLabelProps { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown }

const directBarLabel = (tone: BarLabelTone) => ({ x = 0, y = 0, width = 0, height = 0, value }: DirectBarLabelProps) => {
  if (typeof value !== 'string' || value.length === 0) return null;
  const barX = Number(x);
  const barWidth = Number(width);
  const barY = Number(y);
  const barHeight = Number(height);
  // Long bars hold their own labels; shorter bars place them right after the bar in the open track.
  const inside = barWidth >= value.length * 7.5 + 10;
  const textX = inside ? barX + barWidth - 5 : barX + barWidth + 6;
  const fill = inside && tone === 'spent' ? 'hsl(var(--primary-foreground))' : 'hsl(var(--foreground))';
  return <text x={textX} y={barY + barHeight / 2 + 5} textAnchor={inside ? 'end' : 'start'} style={{ fontSize: 14, fontWeight: 600, fill }}>{value}</text>;
};

const BAR_LABEL_CONTRACT = directBarLabel('contract');
const BAR_LABEL_BUDGET = directBarLabel('budget');
const BAR_LABEL_SPENT = directBarLabel('spent');

export const PlanVsActualChart: React.FC<PlanVsActualChartProps> = ({ projects, currency }) => {
  const { t } = useTranslation('dashboard');
  const reduced = usePrefersReducedMotion();
  const [chartWidth, setChartWidth] = React.useState(0);
  const compact = chartWidth > 0 && chartWidth < 480;
  const planLabel = t('hub.company.planVsActual.plan', 'Contract');
  const actualLabel = t('hub.company.planVsActual.actual', 'Spent');
  const budgetLabel = t('hub.company.planVsActual.budget', 'Active budget');
  const budgetShortLabel = t('hub.company.planVsActual.budgetShort', 'Budget');
  const rows = React.useMemo(() => planVsActualRows(projects, currency).map((row) => ({
    ...row,
    labelPlan: `${planLabel} ${formatCompactCurrency(row.plan, currency)}`,
    labelBudget: row.budget == null ? null : `${budgetShortLabel} ${formatCompactCurrency(row.budget, currency)}`,
    labelActual: row.actual == null ? null : `${actualLabel} ${formatCompactCurrency(row.actual, currency)}`,
    used: row.actual != null && row.budget ? Math.round((row.actual / row.budget) * 100) : null,
  })), [projects, currency, planLabel, budgetShortLabel, actualLabel]);
  const name = t('hub.company.planVsActual.name', 'Plan vs actual by project');
  if (rows.length === 0) return <ListState variant="empty" icon="grid" title={t('hub.company.planVsActual.empty', 'No projects to compare yet')} />;
  const incomplete = rows.filter((row) => row.actual == null).length;
  const noBudget = rows.filter((row) => row.budget == null).length;
  const otherCurrency = projects.filter((project) => project.currency !== currency).length;
  const maxValue = Math.max(1, ...rows.flatMap((row) => [row.plan, row.budget ?? 0, row.actual ?? 0]));
  const chartHeight = Math.max(300, rows.length * 72);
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-[300px] flex-1"><div role="img" aria-label={`${name}. ${rows.map((row) => `${row.name}: ${planLabel} ${formatCurrency(row.plan, currency)}, ${budgetShortLabel} ${row.budget == null ? 'unknown' : formatCurrency(row.budget, currency)}, ${actualLabel} ${row.actual == null ? 'unknown' : formatCurrency(row.actual, currency)}`).join('; ')}`} className="h-full min-h-[300px]">
        <ResponsiveContainer width="100%" height={chartHeight} onResize={(width) => setChartWidth(width)}>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 0, bottom: 4, left: 0 }} barGap={4} barCategoryGap="16%">
            <XAxis type="number" domain={[0, maxValue * 1.3]} tick={false} tickLine={false} stroke={chartTheme.grid} />
            <YAxis type="category" dataKey="name" tick={<NameTick compact={compact} />} stroke={chartTheme.grid} width={compact ? 112 : 140} interval={0} tickLine={false} axisLine={false} />
            <Tooltip cursor={tooltipCursorFill} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value, key, item) => [formatCurrency(Number(value), currency) + (key === 'actual' && item?.payload?.used != null ? ` (${t('common:uxs02.budgetUsed', '{{percent}}% of Active budget', { percent: item.payload.used })})` : ''), key === 'actual' ? actualLabel : key === 'budget' ? budgetLabel : planLabel]} />
            <Bar dataKey="plan" name={planLabel} fill={chartTheme.series.neutral} radius={[0, 3, 3, 0]} isAnimationActive={!reduced} minPointSize={2} barSize={16}>
              <LabelList dataKey="labelPlan" content={BAR_LABEL_CONTRACT} />
            </Bar>
            <Bar dataKey="budget" name={budgetShortLabel} fill={chartTheme.series.primary} fillOpacity={0.12} stroke={chartTheme.series.primary} radius={[0, 3, 3, 0]} isAnimationActive={!reduced} minPointSize={2} barSize={16}>
              <LabelList dataKey="labelBudget" content={BAR_LABEL_BUDGET} />
            </Bar>
            <Bar dataKey="actual" name={actualLabel} fill={chartTheme.series.primary} radius={[0, 3, 3, 0]} isAnimationActive={!reduced} minPointSize={2} barSize={16}>
              <LabelList dataKey="labelActual" content={BAR_LABEL_SPENT} />
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
            incomplete > 0 ? t('hub.company.planVsActual.incomplete', { count: incomplete, defaultValue: 'Spend incomplete: {{count}} projects; known bars shown', defaultValue_one: 'Spend incomplete: {{count}} project; known bars shown' }) : null,
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
