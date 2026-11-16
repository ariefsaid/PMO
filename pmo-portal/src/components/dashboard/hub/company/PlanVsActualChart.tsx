import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { tooltipContentStyle, tooltipCursorFill, tooltipLabelStyle } from '@/src/components/dashboard/chartChrome';
import { usePrefersReducedMotion } from '@/src/components/dashboard/usePrefersReducedMotion';
import { formatCompactCurrency, formatCurrency, formatTileMoney } from '@/src/lib/format';
import { planVsActualRows } from './planVsActual';
import type { TopProject } from '@/src/lib/db/dashboard';

export interface PlanVsActualChartProps {
  projects: TopProject[];
  currency: string;
  /** Two bars a project (budget, spent) with the contract as a tick on the budget bar: about half the height. */
  dense?: boolean;
}

/** Words on up to `maxLines` lines of `max` characters; only text beyond the last line ends in an ellipsis. */
function wrapNameLines(name: string, max: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of name.trim().split(/\s+/u).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= max || !current) { current = candidate; continue; }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, max - 1).trimEnd()}…`;
  return kept;
}

const NameTick: React.FC<{
  x?: number | string;
  y?: number | string;
  payload?: { value: string };
  compact: boolean;
}> = ({ x = 0, y = 0, payload, compact }) => {
  const name = payload?.value ?? '';
  // A long name takes a third line rather than being cut off (a two-bar row is tall enough for three).
  const lines = wrapNameLines(name, compact ? 15 : 18, 3);
  const textX = Number(x) - 4;
  return (
    <text x={textX} y={Number(y) + (lines.length > 2 ? -13 : lines.length > 1 ? -6 : 4)} textAnchor="end" style={{ fontSize: 12, fill: 'hsl(var(--foreground))' }}>
      <title>{name}</title>
      {lines.map((line, index) => <tspan key={index} x={textX} dy={index === 0 ? 0 : 14}>{line}</tspan>)}
    </text>
  );
};

type BarLabelTone = 'contract' | 'budget' | 'spent';
interface DirectBarLabelProps { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown }
const CONTRACT_BAR_FILL = 'hsl(var(--mark-neutral) / 0.54)';
const CONTRACT_LABEL_FILL = 'hsl(var(--foreground))';

// Every label sits right after its bar, in the open track, in the ink colour (the scale leaves room for it).
const directBarLabel = (_tone: BarLabelTone) => ({ x = 0, y = 0, width = 0, height = 0, value }: DirectBarLabelProps) => {
  if (typeof value !== 'string' || value.length === 0) return null;
  const textX = Number(x) + Number(width) + 6;
  return <text x={textX} y={Number(y) + Number(height) / 2 + 5} textAnchor="start" style={{ fontSize: 14, fontWeight: 600, fill: CONTRACT_LABEL_FILL }}>{value}</text>;
};

const BAR_LABEL_CONTRACT = directBarLabel('contract');
const BAR_LABEL_BUDGET = directBarLabel('budget');
const BAR_LABEL_SPENT = directBarLabel('spent');

/** The home's short money ("$260K", "$5M"), the same as the figures and lists around the chart. */
const shortMoney = (amount: number, currency: string) => formatTileMoney(amount, currency) ?? formatCompactCurrency(amount, currency);

const DENSE_BAR = 15;
const DENSE_GAP = 2;
const LABEL_STYLE = { fontSize: 14, fontWeight: 600, fill: CONTRACT_LABEL_FILL } as const;

export const PlanVsActualChart: React.FC<PlanVsActualChartProps> = ({ projects, currency, dense = false }) => {
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
    labelPlan: `${planLabel} ${shortMoney(row.plan, currency)}`,
    labelBudget: row.budget == null ? null : `${budgetShortLabel} ${shortMoney(row.budget, currency)}`,
    labelActual: row.actual == null ? null : `${actualLabel} ${shortMoney(row.actual, currency)}`,
    used: row.actual != null && row.budget ? Math.round((row.actual / row.budget) * 100) : null,
    budgetBar: row.budget ?? 0,
  })), [projects, currency, planLabel, budgetShortLabel, actualLabel]);
  const name = t('hub.company.planVsActual.name', 'Plan vs actual by project');
  // Empty is one line, like every other empty panel on the home.
  if (rows.length === 0) return <p className="text-control text-muted-foreground">{t('hub.company.planVsActual.empty', 'No projects to compare yet')}</p>;
  const incomplete = rows.filter((row) => row.actual == null).length;
  const noBudget = rows.filter((row) => row.budget == null).length;
  const otherCurrency = projects.filter((project) => project.currency !== currency).length;
  const maxValue = Math.max(1, ...rows.flatMap((row) => [row.plan, row.budget ?? 0, row.actual ?? 0]));
  // Dense: a project is two bars; on a phone the contract figure takes a third line under them (no room beside).
  const densePitch = DENSE_BAR * 2 + DENSE_GAP + (compact ? 34 : 14);
  const chartHeight = dense ? rows.length * densePitch + 8 : Math.max(300, rows.length * 72);
  // The longest bar ends where its label still fits inside the plot (14px bold is about 7.5px a character).
  const nameColumn = compact ? 112 : 148;
  const denseBudgetLabel = (row: (typeof rows)[number]) => (compact ? row.labelBudget ?? '' : [row.labelBudget, row.labelPlan].filter(Boolean).join(' · '));
  const labelChars = dense
    ? rows.flatMap((row) => [denseBudgetLabel(row), row.labelActual ?? '', compact ? row.labelPlan : ''])
    : rows.flatMap((row) => [row.labelPlan, row.labelBudget ?? '', row.labelActual ?? '']);
  const labelPx = Math.max(0, ...labelChars.map((label) => label.length)) * 7.5 + 14;
  const plotWidth = chartWidth > 0 ? chartWidth - nameColumn : 0;
  const domainMax = plotWidth > 0 ? maxValue * plotWidth / Math.max(plotWidth - labelPx, plotWidth * 0.35) : maxValue * 1.3;
  const xFor = (value: number) => (plotWidth > 0 ? plotWidth * value / domainMax : 0);
  // The budget bar carries the contract as a tick at its value, and the label starts after whichever ends further.
  const DenseBudgetLabel = ({ x = 0, y = 0, height = 0, index = 0 }: DirectBarLabelProps & { index?: number }) => {
    const row = rows[index];
    if (!row || plotWidth <= 0) return null;
    const start = Number(x);
    const top = Number(y);
    const tickX = start + xFor(row.plan);
    const end = Math.max(start + xFor(row.budget ?? 0), tickX);
    const mid = top + Number(height) / 2 + 5;
    return (
      <g>
        {tickX > start + xFor(row.budget ?? 0) + 1 && <line x1={start + xFor(row.budget ?? 0)} x2={tickX} y1={mid - 5} y2={mid - 5} stroke={CONTRACT_BAR_FILL} strokeWidth={1} strokeDasharray="2 3" />}
        <line data-testid="plan-actual-contract-tick" x1={tickX} x2={tickX} y1={top - 3} y2={top + Number(height) + 3} stroke={CONTRACT_LABEL_FILL} strokeWidth={2} />
        <text x={end + 6} y={mid} textAnchor="start" style={LABEL_STYLE}>{denseBudgetLabel(row)}</text>
        {compact && <text x={start} y={top + DENSE_BAR * 2 + DENSE_GAP + 15} textAnchor="start" style={LABEL_STYLE}>{row.labelPlan}</text>}
      </g>
    );
  };
  return (
    <div className="flex h-full flex-col">
      {dense && (
        <ul aria-hidden className="mb-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-control text-muted-foreground">
          <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-primary" />{actualLabel}</li>
          <li className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] border border-primary bg-primary/10" />{budgetLabel}</li>
          <li className="inline-flex items-center gap-1.5"><span className="h-3.5 w-0.5 bg-foreground" />{planLabel}</li>
        </ul>
      )}
      <div className={dense ? 'flex-1' : 'min-h-[300px] flex-1'}><div role="img" aria-label={`${name}. ${rows.map((row) => `${row.name}: ${planLabel} ${formatCurrency(row.plan, currency)}, ${budgetShortLabel} ${row.budget == null ? 'unknown' : formatCurrency(row.budget, currency)}, ${actualLabel} ${row.actual == null ? 'unknown' : formatCurrency(row.actual, currency)}`).join('; ')}`} data-contract-fill={CONTRACT_BAR_FILL} data-contract-label-fill={CONTRACT_LABEL_FILL} className={dense ? 'h-full' : 'h-full min-h-[300px]'}>
        <ResponsiveContainer width="100%" height={chartHeight} onResize={(width) => setChartWidth(width)}>
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 0, bottom: 4, left: 0 }} barGap={dense ? DENSE_GAP : 4} barCategoryGap={dense ? (compact ? '0%' : '14%') : '16%'}>
            <XAxis type="number" domain={[0, domainMax]} tick={false} tickLine={false} stroke={chartTheme.grid} height={2} />
            <YAxis type="category" dataKey="name" tick={<NameTick compact={compact} />} stroke={chartTheme.grid} width={nameColumn} interval={0} tickLine={false} axisLine={false} />
            <Tooltip cursor={tooltipCursorFill} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value, key, item) => [formatCurrency(Number(value), currency) + (key === 'actual' && item?.payload?.used != null ? ` (${t('common:uxs02.budgetUsed', '{{percent}}% of Active budget before tax', { percent: item.payload.used })})` : ''), key === 'actual' ? actualLabel : key === 'budget' ? budgetLabel : planLabel]} />
            {!dense && <Bar dataKey="plan" name={planLabel} fill={CONTRACT_BAR_FILL} radius={[0, 3, 3, 0]} isAnimationActive={!reduced} minPointSize={2} barSize={16}>
              <LabelList dataKey="labelPlan" content={BAR_LABEL_CONTRACT} />
            </Bar>}
            <Bar dataKey={dense ? 'budgetBar' : 'budget'} name={budgetShortLabel} fill={chartTheme.series.primary} fillOpacity={0.12} stroke={chartTheme.series.primary} radius={[0, 3, 3, 0]} isAnimationActive={!reduced} minPointSize={dense ? 0 : 2} barSize={dense ? DENSE_BAR : 16}>
              <LabelList dataKey="labelBudget" content={dense ? DenseBudgetLabel : BAR_LABEL_BUDGET} />
            </Bar>
            <Bar dataKey="actual" name={actualLabel} fill={chartTheme.series.primary} radius={[0, 3, 3, 0]} isAnimationActive={!reduced} minPointSize={2} barSize={dense ? DENSE_BAR : 16}>
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
        <thead><tr><th>{t('hub.company.project', 'Project')}</th><th className="text-right tabular tabular-nums">{planLabel}</th><th className="text-right tabular tabular-nums">{budgetLabel}</th><th className="text-right tabular tabular-nums">{actualLabel}</th><th className="text-right tabular tabular-nums">{t('hub.company.planVsActual.share', 'Spent of contract')}</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}><th scope="row">{row.name}</th><td className="text-right tabular tabular-nums">{formatCurrency(row.plan, currency)}</td><td className="text-right tabular tabular-nums">{row.budget == null ? t('dashboard:executive.noActiveBudget', 'No active budget') : formatCurrency(row.budget, currency)}</td><td className="text-right tabular tabular-nums">{row.actual == null ? '—' : formatCurrency(row.actual, currency)}</td><td className="text-right tabular tabular-nums">{row.percent == null ? '—' : `${row.percent}%`}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
