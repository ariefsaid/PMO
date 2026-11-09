import React from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { ListState } from '@/src/components/ui/ListState';
import { axisTickStyle, tooltipContentStyle, tooltipCursorFill, tooltipLabelStyle } from '@/src/components/dashboard/chartChrome';
import { usePrefersReducedMotion } from '@/src/components/dashboard/usePrefersReducedMotion';
import { formatCompactCurrency, formatCurrency } from '@/src/lib/format';
import { planVsActualRows } from './planVsActual';
import type { TopProject } from '@/src/lib/db/dashboard';

export interface PlanVsActualChartProps { projects: TopProject[]; currency: string }

/** Project names wrap onto two lines (a third is cut with an ellipsis) so they never truncate to a stub. */
const wrapName = (name: string): string[] => {
  const lines: string[] = [];
  let line = '';
  for (const word of name.split(/\s+/)) {
    if (line && `${line} ${word}`.length > 22) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  lines.push(line);
  return lines.length > 2 ? [lines[0], `${lines[1].slice(0, 20)}…`] : lines;
};
const NameTick: React.FC<{ x?: number; y?: number; payload?: { value: string } }> = ({ x = 0, y = 0, payload }) => {
  const lines = wrapName(payload?.value ?? '');
  return <text x={x - 6} y={y - ((lines.length - 1) * 6.5)} textAnchor="end" dominantBaseline="central" style={axisTickStyle}>{lines.map((line, index) => <tspan key={index} x={x - 6} dy={index === 0 ? 0 : 13}>{line}</tspan>)}</text>;
};

export const PlanVsActualChart: React.FC<PlanVsActualChartProps> = ({ projects, currency }) => {
  const { t } = useTranslation('dashboard');
  const reduced = usePrefersReducedMotion();
  const rows = React.useMemo(() => planVsActualRows(projects, currency), [projects, currency]);
  const name = t('hub.company.planVsActual.name', 'Plan vs actual by project');
  if (rows.length === 0) return <ListState variant="empty" icon="grid" title={t('hub.company.planVsActual.empty', 'No projects to compare yet')} />;
  const planLabel = t('hub.company.planVsActual.plan', 'Contract');
  const actualLabel = t('hub.company.planVsActual.actual', 'Spent');
  const budgetLabel = t('hub.company.planVsActual.budget', 'Active budget');
  const incomplete = rows.filter((row) => row.actual == null).length;
  const otherCurrency = projects.filter((project) => project.currency !== currency).length;
  return (
    <div>
      <div role="img" aria-label={name} style={{ height: 40 + rows.length * 64 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid horizontal={false} stroke={chartTheme.grid} />
            <XAxis type="number" tick={axisTickStyle} stroke={chartTheme.grid} tickFormatter={(value: number) => formatCompactCurrency(value, currency)} />
            <YAxis type="category" dataKey="name" width={150} tick={<NameTick />} stroke={chartTheme.grid} interval={0} />
            <Tooltip cursor={tooltipCursorFill} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value, key, item) => [formatCurrency(Number(value), currency) + (key === 'actual' && item?.payload?.percent != null ? ` (${t('hub.company.planVsActual.percentOfContract', '{{percent}}% of contract', { percent: item.payload.percent })})` : ''), key === 'actual' ? actualLabel : key === 'budget' ? budgetLabel : planLabel]} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="plan" name={planLabel} fill={chartTheme.series.neutral} radius={[0, 3, 3, 0]} isAnimationActive={!reduced} />
            <Bar dataKey="budget" name={budgetLabel} fill={chartTheme.series.violet} radius={[0, 3, 3, 0]} isAnimationActive={!reduced} />
            <Bar dataKey="actual" name={actualLabel} fill={chartTheme.series.primary} radius={[0, 3, 3, 0]} isAnimationActive={!reduced} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {(incomplete > 0 || otherCurrency > 0) && (
        <p data-testid="plan-actual-caption" className="mt-2 text-xs text-muted-foreground">
          {[
            incomplete > 0 ? t('hub.company.planVsActual.incomplete', { count: incomplete, defaultValue: '{{count}} projects have incomplete spending', defaultValue_one: '{{count}} project has incomplete spending' }) : null,
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
