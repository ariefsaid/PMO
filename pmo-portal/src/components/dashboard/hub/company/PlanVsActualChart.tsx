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
import type { TopProject } from '@/src/lib/db/dashboard';

export interface PlanVsActualChartProps { projects: TopProject[]; currency: string }

const NameTick: React.FC<{ x?: number; y?: number; payload?: { value: string } }> = ({ x = 0, y = 0, payload }) => (
  <text x={x - 2} y={y} dy={5} textAnchor="end" style={{ fontSize: 12, fill: 'hsl(var(--foreground))' }}>
    <title>{payload?.value}</title>
    {(payload?.value ?? '').length > 14 ? `${payload?.value.slice(0, 13)}…` : payload?.value}
  </text>
);
const VALUE_STYLE = { fontSize: 12, fontWeight: 600, fill: 'hsl(var(--foreground))' } as const;

export const PlanVsActualChart: React.FC<PlanVsActualChartProps> = ({ projects, currency }) => {
  const { t } = useTranslation('dashboard');
  const reduced = usePrefersReducedMotion();
  const rows = React.useMemo(() => planVsActualRows(projects, currency).map((row) => ({
    ...row,
    used: row.actual != null && row.budget ? Math.round((row.actual / row.budget) * 100) : null,
    planLabel: `${t('hub.company.planVsActual.plan', 'Contract')} ${formatCompactCurrency(row.plan, currency)}`,
    budgetLabel: row.budget == null ? null : `${t('hub.company.planVsActual.budgetShort', 'Budget')} ${formatCompactCurrency(row.budget, currency)}`,
    actualLabel: row.actual == null ? null : `${t('hub.company.planVsActual.actual', 'Spent')} ${formatCompactCurrency(row.actual, currency)}`,
  })), [projects, currency, t]);
  const name = t('hub.company.planVsActual.name', 'Plan vs actual by project');
  if (rows.length === 0) return <ListState variant="empty" icon="grid" title={t('hub.company.planVsActual.empty', 'No projects to compare yet')} />;
  const planLabel = t('hub.company.planVsActual.plan', 'Contract');
  const actualLabel = t('hub.company.planVsActual.actual', 'Spent');
  const budgetLabel = t('hub.company.planVsActual.budget', 'Active budget');
  const incomplete = rows.filter((row) => row.actual == null).length;
  const noBudget = rows.filter((row) => row.budget == null).length;
  const otherCurrency = projects.filter((project) => project.currency !== currency).length;
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-[300px] flex-1"><div role="img" aria-label={`${name}. ${rows.map((row) => `${row.name}: ${planLabel} ${formatCurrency(row.plan, currency)}, ${budgetLabel} ${row.budget == null ? 'unknown' : formatCurrency(row.budget, currency)}, ${actualLabel} ${row.actual == null ? 'unknown' : formatCurrency(row.actual, currency)}`).join('; ')}`} className="h-full min-h-[300px]">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 128, bottom: 4, left: 0 }} barGap={2} barCategoryGap="22%">
            <XAxis type="number" domain={[0, 'auto']} tick={false} tickLine={false} stroke={chartTheme.grid} />
            <YAxis type="category" dataKey="name" tick={<NameTick />} stroke={chartTheme.grid} width={112} interval={0} tickLine={false} axisLine={false} />
            <Tooltip cursor={tooltipCursorFill} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value, key, item) => [formatCurrency(Number(value), currency) + (key === 'actual' && item?.payload?.used != null ? ` (${t('common:uxs02.budgetUsed', '{{percent}}% of Active budget', { percent: item.payload.used })})` : ''), key === 'actual' ? actualLabel : key === 'budget' ? budgetLabel : planLabel]} />
            <Bar dataKey="plan" name={planLabel} fill={chartTheme.series.neutral} radius={[0, 3, 3, 0]} isAnimationActive={!reduced} minPointSize={2}>
              <LabelList dataKey="planLabel" position="right" style={VALUE_STYLE} />
            </Bar>
            <Bar dataKey="budget" name={budgetLabel} fill={chartTheme.series.primary} fillOpacity={0.12} stroke={chartTheme.series.primary} radius={[0, 3, 3, 0]} isAnimationActive={!reduced} minPointSize={2}>
              <LabelList dataKey="budgetLabel" position="right" style={VALUE_STYLE} />
            </Bar>
            <Bar dataKey="actual" name={actualLabel} fill={chartTheme.series.primary} radius={[0, 3, 3, 0]} isAnimationActive={!reduced} minPointSize={2}>
              {rows.map((row) => <Cell key={row.id} fill={row.used != null && row.used > 100 ? chartTheme.series.destructive : chartTheme.series.primary} />)}
              <LabelList dataKey="actualLabel" position="right" style={VALUE_STYLE} />
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
