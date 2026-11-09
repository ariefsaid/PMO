import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { ListState } from '@/src/components/ui/ListState';
import { axisTickStyle, tooltipContentStyle, tooltipCursorFill, tooltipLabelStyle } from '@/src/components/dashboard/chartChrome';
import { usePrefersReducedMotion } from '@/src/components/dashboard/usePrefersReducedMotion';
import { formatCompactCurrency, formatCurrency } from '@/src/lib/format';
import { planVsActualRows } from './planVsActual';
import type { TopProject } from '@/src/lib/db/dashboard';

export interface PlanVsActualChartProps { projects: TopProject[]; currency: string }

/** Project names sit centred under their bars on two lines (a third is cut with an ellipsis). */
const wrapName = (name: string): string[] => {
  const lines: string[] = [];
  let line = '';
  for (const word of name.split(/\s+/)) {
    if (line && `${line} ${word}`.length > 16) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  lines.push(line);
  return lines.length > 2 ? [lines[0], `${lines[1].slice(0, 14)}…`] : lines;
};
const NameTick: React.FC<{ x?: number; y?: number; payload?: { value: string } }> = ({ x = 0, y = 0, payload }) => {
  const lines = wrapName(payload?.value ?? '');
  return <text x={x} y={y + 10} textAnchor="middle" style={axisTickStyle}>{lines.map((line, index) => <tspan key={index} x={x} dy={index === 0 ? 0 : 13}>{line}</tspan>)}</text>;
};

export const PlanVsActualChart: React.FC<PlanVsActualChartProps> = ({ projects, currency }) => {
  const { t } = useTranslation('dashboard');
  const reduced = usePrefersReducedMotion();
  const rows = React.useMemo(() => planVsActualRows(projects, currency).map((row) => ({ ...row, used: row.actual != null && row.budget ? Math.round((row.actual / row.budget) * 100) : null })), [projects, currency]);
  const name = t('hub.company.planVsActual.name', 'Plan vs actual by project');
  if (rows.length === 0) return <ListState variant="empty" icon="grid" title={t('hub.company.planVsActual.empty', 'No projects to compare yet')} />;
  const planLabel = t('hub.company.planVsActual.plan', 'Contract');
  const actualLabel = t('hub.company.planVsActual.actual', 'Spent');
  const budgetLabel = t('hub.company.planVsActual.budget', 'Active budget');
  const incomplete = rows.filter((row) => row.actual == null).length;
  const noBudget = rows.filter((row) => row.budget == null).length;
  const otherCurrency = projects.filter((project) => project.currency !== currency).length;
  const anyOver = rows.some((row) => row.used != null && row.used > 100);
  const legend = [
    { label: planLabel, swatch: <span aria-hidden className="size-[9px] rounded-[2px]" style={{ background: chartTheme.series.neutral }} /> },
    { label: budgetLabel, swatch: <span aria-hidden className="size-[9px] rounded-[2px] border border-primary bg-primary/15" /> },
    { label: actualLabel, swatch: <span aria-hidden className="size-[9px] rounded-[2px]" style={{ background: chartTheme.series.primary }} /> },
    ...(anyOver ? [{ label: t('hub.company.planVsActual.overBudget', 'Over budget'), swatch: <span aria-hidden className="size-[9px] rounded-[2px]" style={{ background: chartTheme.series.destructive }} /> }] : []),
  ];
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-[340px] flex-1 overflow-x-auto"><div role="img" aria-label={name} className="h-full min-h-[340px] min-w-[560px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 8, left: 0 }} barGap={3} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={chartTheme.grid} />
            <XAxis dataKey="name" tick={<NameTick />} stroke={chartTheme.grid} interval={0} height={44} tickLine={false} />
            <YAxis type="number" tick={axisTickStyle} stroke={chartTheme.grid} width={48} tickLine={false} axisLine={false} tickFormatter={(value: number) => formatCompactCurrency(value, currency)} />
            <Tooltip cursor={tooltipCursorFill} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value, key, item) => [formatCurrency(Number(value), currency) + (key === 'actual' && item?.payload?.used != null ? ` (${t('common:uxs02.budgetUsed', '{{percent}}% of Active budget', { percent: item.payload.used })})` : ''), key === 'actual' ? actualLabel : key === 'budget' ? budgetLabel : planLabel]} />
            <Legend verticalAlign="top" align="right" height={24} content={() => <ul className="m-0 flex list-none flex-wrap justify-end gap-x-3 p-0 text-xs text-muted-foreground">{legend.map((item) => <li key={item.label} className="inline-flex items-center gap-1.5">{item.swatch}{item.label}</li>)}</ul>} />
            <Bar dataKey="plan" name={planLabel} fill={chartTheme.series.neutral} radius={[3, 3, 0, 0]} isAnimationActive={!reduced} />
            <Bar dataKey="budget" name={budgetLabel} fill={chartTheme.series.primary} fillOpacity={0.12} stroke={chartTheme.series.primary} radius={[3, 3, 0, 0]} isAnimationActive={!reduced} />
            <Bar dataKey="actual" name={actualLabel} fill={chartTheme.series.primary} radius={[3, 3, 0, 0]} isAnimationActive={!reduced}>
              {rows.map((row) => <Cell key={row.id} fill={row.used != null && row.used > 100 ? chartTheme.series.destructive : chartTheme.series.primary} />)}
              <LabelList dataKey="used" position="top" formatter={(value: unknown) => (value == null ? '' : `${value}%`)} style={{ fontSize: 10.5, fontWeight: 600, fill: 'hsl(var(--foreground))' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div></div>
      {noBudget > 0 && (
        <p data-testid="plan-actual-no-budget" className="mt-1 text-xs text-muted-foreground">
          {t('hub.company.planVsActual.noBudget', { count: noBudget, defaultValue: '{{count}} projects have no active budget yet', defaultValue_one: '{{count}} project has no active budget yet' })}
          {' '}<Link to="/projects" className="font-medium text-primary-text hover:underline">{t('hub.company.planVsActual.setBudgets', 'Set budgets')}</Link>
        </p>
      )}
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
