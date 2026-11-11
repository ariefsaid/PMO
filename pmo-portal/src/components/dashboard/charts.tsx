import React from 'react';
import { Bar, BarChart, Cell, Line, LineChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardHead } from '@/src/components/ui/Card';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { ListState } from '@/src/components/ui/ListState';
import { useFigureReport } from '@/src/components/ui/useFigureScope';
import { tooltipContentStyle, tooltipCursorFill, tooltipLabelStyle } from '@/src/components/dashboard/chartChrome';
import { usePrefersReducedMotion } from '@/src/components/dashboard/usePrefersReducedMotion';

/**
 * Home graphics (screen-rules "Graphics"): bars carry their value as a direct label, one neutral series colour,
 * one accent, red only for an exception. Nothing is drawn for a value that is unknown (the row or series is left
 * out). Each chart's accessible name carries its values.
 */
export type ChartTone = 'neutral' | 'accent' | 'bad';
const toneFill: Record<ChartTone, string> = {
  neutral: chartTheme.series.neutral,
  accent: chartTheme.series.primary,
  bad: chartTheme.series.destructive,
};

const INK = 'hsl(var(--foreground))';
/** Direct labels are read, so they stay at 14px; only axis ticks drop to 12px. */
const LABEL_STYLE = { fontSize: 14, fontWeight: 600, fill: INK } as const;
const TICK_STYLE = { fontSize: 12, fill: chartTheme.axis } as const;

export interface BarRow {
  id: string;
  name: string;
  /** Null = unknown: no bar and no label. */
  value: number | null;
  /** The direct label ("$1.2M", "47%"). */
  label?: string;
  tone?: ChartTone;
  /** Second series (paired bars). */
  value2?: number | null;
  label2?: string;
  tone2?: ChartTone;
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const NameTick: React.FC<{ x?: number; y?: number; payload?: { value: string }; max: number }> = ({ x = 0, y = 0, payload, max }) => (
  <text x={x - 6} y={y} dy={5} textAnchor="end" style={{ fontSize: 14, fill: INK }}>
    <title>{payload?.value}</title>
    {truncate(payload?.value ?? '', max)}
  </text>
);

/**
 * Horizontal bars, one row per item (a comparison, a ranking, a funnel on one scale). Pass `value2` for paired bars
 * (e.g. budget and spent). Rows keep the order given: sort before passing.
 */
export const BarList: React.FC<{
  rows: BarRow[];
  ariaLabel: string;
  /** Names of the two series for the tooltip and the text twin. */
  seriesNames?: [string, string?];
  nameWidth?: number;
  /** A fixed upper bound for the value scale (e.g. 100 for percentages). */
  domainMax?: number;
}> = ({ rows, ariaLabel, seriesNames, nameWidth = 128, domainMax }) => {
  const reduced = usePrefersReducedMotion();
  const paired = rows.some((row) => row.value2 !== undefined);
  const data = rows.map((row) => ({ ...row, a: row.value, b: row.value2 ?? null }));
  const rowHeight = paired ? 62 : 34;
  const max = domainMax ?? Math.max(1, ...rows.flatMap((row) => [row.value ?? 0, row.value2 ?? 0]));
  return (
    <div>
      <div role="img" aria-label={`${ariaLabel}. ${rows.map((row) => `${row.name}: ${[row.label && `${paired && seriesNames?.[0] ? `${seriesNames[0]} ` : ''}${row.label}`, row.label2 && `${seriesNames?.[1] ? `${seriesNames[1]} ` : ''}${row.label2}`].filter(Boolean).join(', ')}`).join('; ')}`} style={{ height: rows.length * rowHeight + 4 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 2, right: 80, bottom: 2, left: 0 }} barCategoryGap="20%" barGap={4} barSize={paired ? 16 : 18}>
            <XAxis type="number" hide domain={[0, max]} />
            <YAxis type="category" dataKey="name" width={nameWidth} tick={<NameTick max={Math.floor(nameWidth / 8.4)} />} tickLine={false} axisLine={false} interval={0} />
            <Tooltip cursor={tooltipCursorFill} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(_value, key, item) => [(key === 'a' ? item.payload.label : item.payload.label2) ?? '', key === 'a' ? seriesNames?.[0] ?? '' : seriesNames?.[1] ?? '']} />
            <Bar dataKey="a" radius={[0, 4, 4, 0]} isAnimationActive={!reduced} minPointSize={2}>
              {data.map((row) => <Cell key={row.id} fill={toneFill[row.tone ?? 'neutral']} />)}
              <LabelList dataKey="label" position="right" style={LABEL_STYLE} />
            </Bar>
            {paired && (
              <Bar dataKey="b" radius={[0, 4, 4, 0]} isAnimationActive={!reduced} minPointSize={2}>
                {data.map((row) => <Cell key={row.id} fill={toneFill[row.tone2 ?? 'accent']} />)}
                <LabelList dataKey="label2" position="right" style={LABEL_STYLE} />
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

/** A two-item key under a paired chart: a swatch and the series name, in text. */
export const SeriesKey: React.FC<{ items: Array<{ label: string; tone: ChartTone }> }> = ({ items }) => (
  <ul className="mb-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-control text-muted-foreground">
    {items.map((item) => (
      <li key={item.label} className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: toneFill[item.tone] }} />{item.label}</li>
    ))}
  </ul>
);

export interface ColumnPoint {
  key: string;
  /** Tick under the column ("Jan", "Mon"). */
  tick: string;
  a: number | null;
  labelA?: string;
  b?: number | null;
  labelB?: string;
  /** The column to mark with the accent (today, the latest month). */
  accentA?: boolean;
}

/** One value label above a column: all of them (a week), or only the latest (a trend). */
const columnLabel = (lastOnly: boolean, count: number, side: 'middle' | 'end' | 'start' = 'middle') => (props: { x?: number | string; y?: number | string; width?: number | string; index?: number; value?: unknown }) => {
  const { x = 0, y = 0, width = 0, index = 0, value } = props;
  if (value == null || value === '' || (lastOnly && index !== count - 1)) return null;
  const anchorX = side === 'end' ? Number(x) + Number(width) : side === 'start' ? Number(x) : Number(x) + Number(width) / 2;
  return <text x={anchorX} y={Number(y) - 5} textAnchor={side} style={LABEL_STYLE}>{String(value)}</text>;
};

/**
 * Columns over time or over days. One neutral series (the accent marks the column that matters) or two series
 * (a neutral, an accent). With `labelAll` every column carries its value, otherwise only the latest.
 */
export const MonthColumns: React.FC<{
  points: ColumnPoint[];
  ariaLabel: string;
  seriesNames?: [string, string?];
  labelAll?: boolean;
  height?: number;
}> = ({ points, ariaLabel, seriesNames, labelAll = false, height = 168 }) => {
  const reduced = usePrefersReducedMotion();
  const two = points.some((point) => point.b !== undefined);
  const data = points.map((point) => ({ ...point }));
  return (
    <div>
      <div role="img" aria-label={`${ariaLabel}. ${points.map((point) => `${point.tick}: ${[point.labelA && `${two && seriesNames?.[0] ? `${seriesNames[0]} ` : ''}${point.labelA}`, point.labelB && `${seriesNames?.[1] ? `${seriesNames[1]} ` : ''}${point.labelB}`].filter(Boolean).join(', ')}`).join('; ')}`} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 22, right: two ? 44 : 4, bottom: 0, left: 4 }} barGap={2} barCategoryGap="18%">
            <XAxis dataKey="tick" tick={TICK_STYLE} tickLine={false} stroke={chartTheme.grid} interval="preserveStartEnd" />
            <YAxis hide domain={[0, 'auto']} />
            <Tooltip cursor={tooltipCursorFill} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(_value, key, item) => [(key === 'a' ? item.payload.labelA : item.payload.labelB) ?? '', key === 'a' ? seriesNames?.[0] ?? '' : seriesNames?.[1] ?? '']} />
            <Bar dataKey="a" radius={[4, 4, 0, 0]} isAnimationActive={!reduced} minPointSize={2}>
              {data.map((point) => <Cell key={point.key} fill={point.accentA && !two ? toneFill.accent : toneFill.neutral} />)}
              <LabelList dataKey="labelA" content={columnLabel(!labelAll, data.length, two ? 'end' : 'middle')} />
            </Bar>
            {two && (
              <Bar dataKey="b" radius={[4, 4, 0, 0]} isAnimationActive={!reduced} minPointSize={2} fill={toneFill.accent}>
                <LabelList dataKey="labelB" content={columnLabel(!labelAll, data.length, 'start')} />
              </Bar>
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export interface Part { key: string; label: string; value: number }

/** One-hue steps, darkest first: parts of a whole read as ordered, no rainbow. */
const PART_FILL = [0.55, 0.4, 0.3, 0.2, 0.12].map((alpha) => `hsl(var(--primary) / ${alpha})`);

/**
 * Parts of a whole as ONE stacked bar: each part's count sits inside its segment and its name in the line under
 * the bar. Parts with no value are left out.
 */
export const StackedBar: React.FC<{ parts: Part[]; ariaLabel: string }> = ({ parts, ariaLabel }) => {
  const reduced = usePrefersReducedMotion();
  const shown = parts.filter((part) => part.value > 0);
  const row = Object.fromEntries(shown.map((part) => [part.key, part.value]));
  return (
    <div>
      <div role="img" aria-label={`${ariaLabel}. ${shown.map((part) => `${part.label} ${part.value}`).join(', ')}`} className="h-12">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={[row]} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis type="category" hide dataKey={() => ''} />
            {shown.map((part, index) => (
              <Bar key={part.key} dataKey={part.key} stackId="whole" fill={PART_FILL[Math.min(index, PART_FILL.length - 1)]} stroke="hsl(var(--card))" strokeWidth={2} isAnimationActive={!reduced} radius={index === 0 ? [4, 0, 0, 4] : index === shown.length - 1 ? [0, 4, 4, 0] : 0}>
                <LabelList dataKey={part.key} position="center" style={LABEL_STYLE} />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-control text-muted-foreground">
        {shown.map((part, index) => (
          <li key={part.key} className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: PART_FILL[Math.min(index, PART_FILL.length - 1)] }} />{part.label} <span className="tabular text-foreground">{part.value}</span></li>
        ))}
      </ul>
    </div>
  );
};

/** A small line for a figure tile: three points or more, the latest point marked. */
export const Spark: React.FC<{ values: number[]; ariaLabel: string }> = ({ values, ariaLabel }) => {
  const data = values.map((value, index) => ({ index, value }));
  const last = data.length - 1;
  return (
    <div role="img" aria-label={ariaLabel} className="h-8 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 6, bottom: 4, left: 6 }}>
          <YAxis hide domain={[0, 'auto']} />
          <Line type="monotone" dataKey="value" stroke={chartTheme.series.primary} strokeWidth={2} isAnimationActive={false} dot={(props: { cx?: number; cy?: number; index?: number }) => props.index === last ? <circle key="last" cx={props.cx} cy={props.cy} r={3.5} fill={chartTheme.series.primary} /> : <g key={props.index} />} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

/**
 * The card around one chart. `known === false` draws nothing: the chart is left out and counted, with its reason,
 * in the page's one hidden-figures line.
 */
export const ChartCard: React.FC<{
  title: string;
  actions?: React.ReactNode;
  /** Whether the chart has data to draw. Undefined while loading. */
  known?: boolean;
  hiddenReason?: string;
  pending?: boolean;
  error?: { title: string; retry?: () => void };
  className?: string;
  testId?: string;
  children: React.ReactNode;
}> = ({ title, actions, known = true, hiddenReason, pending = false, error, className, testId, children }) => {
  const hide = !pending && !error && !known;
  useFigureReport(hide && hiddenReason ? [{ label: title, reason: hiddenReason }] : []);
  if (hide) return null;
  return (
    <Card className={className} data-testid={testId} aria-label={title}>
      <CardHead level={2} actions={actions}>{title}</CardHead>
      <div className="px-[var(--panel-inset)] pb-4">
        {pending ? <ListState variant="loading" shape="chart" rows={2} />
          : error ? <ListState variant="error" title={error.title} onRetry={error.retry} />
            : children}
      </div>
    </Card>
  );
};
