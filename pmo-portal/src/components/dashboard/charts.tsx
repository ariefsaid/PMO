import React from 'react';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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
  /** Names of the two series for the tooltip and the accessible name. */
  seriesNames?: [string, string?];
  nameWidth?: number;
  /** A fixed upper bound for the value scale (e.g. 100 for percentages). */
  domainMax?: number;
}> = ({ rows, ariaLabel, seriesNames, nameWidth: fixedNameWidth, domainMax }) => {
  // The name column fits the longest name (up to 22 characters; longer names end in an ellipsis).
  const nameWidth = fixedNameWidth ?? Math.min(190, Math.max(96, Math.ceil(Math.max(0, ...rows.map((row) => row.name.length)) * 8.4)));
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
}

/** A value label above a column: every non-zero column, or only the latest (`lastOnly`). Zero columns carry no label. */
const columnLabel = (data: Array<{ a: number | null; b?: number | null }>, series: 'a' | 'b', lastOnly: boolean, side: 'middle' | 'end' | 'start' = 'middle', paired = false) => (props: { x?: number | string; y?: number | string; width?: number | string; index?: number; value?: unknown }) => {
  const { x = 0, y = 0, width = 0, index = 0, value } = props;
  const lastNonZero = data.reduce((last, point, pointIndex) => point[series] != null && point[series] !== 0 ? pointIndex : last, -1);
  if (value == null || value === '' || !data[index]?.[series] || (lastOnly && index !== lastNonZero)) return null;
  const barX = Number(x);
  const barWidth = Number(width);
  // Paired labels meet at the midpoint between the columns. Each series keeps its own half of the month,
  // so their values stay readable even when both amounts are non-zero.
  // The pair's midpoint is the 2px gap between the columns; each label keeps 3px off it so the two never touch.
  const pairedCenter = side === 'end' ? barX + barWidth - 2 : barX + 2;
  const anchorX = paired ? pairedCenter : side === 'end' ? barX + barWidth : side === 'start' ? barX : barX + barWidth / 2;
  return <text x={anchorX} y={Number(y) - 5} textAnchor={side} style={LABEL_STYLE}>{String(value)}</text>;
};

/**
 * Columns over time or over days. The first series is the accent; a second series (a comparison) is grey. With
 * `labelAll` every non-zero column carries its value, otherwise only the latest. Beyond six months a second series
 * is not labelled on the bars (its values are in the tooltip and the accessible name).
 */
export const MonthColumns: React.FC<{
  points: ColumnPoint[];
  ariaLabel: string;
  seriesNames?: [string, string?];
  labelAll?: boolean;
  height?: number;
  /** Keep paired value labels legible on narrow screens; the chart can scroll horizontally. */
  minWidth?: number;
  tickInterval?: number;
  /** Fill the parent's remaining height (a flex column) instead of a fixed height; `height` is then the minimum. */
  fill?: boolean;
}> = ({ points, ariaLabel, seriesNames, labelAll = false, height = 168, minWidth, tickInterval = 0, fill = false }) => {
  const reduced = usePrefersReducedMotion();
  const two = points.some((point) => point.b !== undefined);
  const data = points.map((point) => ({ ...point }));
  const legendItems = two && seriesNames?.[0] && seriesNames[1]
    ? [
      { label: seriesNames[0], tone: 'accent' as const },
      { label: seriesNames[1], tone: 'neutral' as const },
    ]
    : null;
  return (
    <>
      {legendItems && <SeriesKey items={legendItems} />}
      <div className={[minWidth ? 'overflow-x-auto' : '', fill ? 'flex flex-1 flex-col' : ''].join(' ').trim() || undefined} role={minWidth ? 'region' : undefined} aria-label={minWidth ? ariaLabel : undefined} tabIndex={minWidth ? 0 : undefined}>
        <div role="img" className={fill ? 'flex-1' : undefined} aria-label={`${ariaLabel}. ${points.map((point) => `${point.tick}: ${[point.labelA && `${two && seriesNames?.[0] ? `${seriesNames[0]} ` : ''}${point.labelA}`, point.labelB && `${seriesNames?.[1] ? `${seriesNames[1]} ` : ''}${point.labelB}`].filter(Boolean).join(', ')}`).join('; ')}`} style={fill ? { minHeight: height, minWidth } : { height, minWidth }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 22, right: two ? 40 : 4, bottom: 0, left: 4 }} barGap={2} barCategoryGap="14%">
              <XAxis dataKey="tick" tick={TICK_STYLE} tickLine={false} stroke={chartTheme.grid} interval={tickInterval} />
              <YAxis hide domain={[0, 'auto']} />
              <Tooltip cursor={tooltipCursorFill} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(_value, key, item) => [(key === 'a' ? item.payload.labelA : item.payload.labelB) ?? '', key === 'a' ? seriesNames?.[0] ?? '' : seriesNames?.[1] ?? '']} />
              <Bar dataKey="a" fill={toneFill.accent} radius={[4, 4, 0, 0]} isAnimationActive={!reduced} minPointSize={2}>
                <LabelList dataKey="labelA" content={columnLabel(data, 'a', !labelAll, two ? 'end' : 'middle', two)} />
              </Bar>
              {two && (
                <Bar dataKey="b" fill={toneFill.neutral} radius={[4, 4, 0, 0]} isAnimationActive={!reduced} minPointSize={2}>
                  <LabelList dataKey="labelB" content={columnLabel(data, 'b', !labelAll || points.length > 6, 'start', true)} />
                </Bar>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
};

export interface Part { key: string; label: string; value: number }

/** One-hue steps in order, darkest first: parts of a whole read as ordered, no rainbow. */
const STEPS = [
  { fill: 'hsl(var(--primary))', ink: 'hsl(var(--primary-foreground))' },
  { fill: 'hsl(var(--primary) / 0.62)', ink: INK },
  { fill: 'hsl(var(--primary) / 0.4)', ink: INK },
  { fill: 'hsl(var(--primary) / 0.25)', ink: INK },
  { fill: 'hsl(var(--primary) / 0.14)', ink: INK },
];

/**
 * Parts of a whole as ONE stacked bar, labelled on the bar itself: each segment wide enough carries its name and
 * count; a segment too narrow for its name carries the count and its name follows under the bar, next to its own
 * swatch. No separate legend. Parts with no value are left out.
 */
export const StackedBar: React.FC<{ parts: Part[]; ariaLabel: string }> = ({ parts, ariaLabel }) => {
  const shown = parts.filter((part) => part.value > 0);
  const total = shown.reduce((sum, part) => sum + part.value, 0);
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(node.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // A name fits when its segment is wider than the text (14px bold ≈ 8.4px a character) plus padding.
  const fits = (part: Part) => total > 0 && (part.value / total) * width >= part.label.length * 8.4 + 16;
  const step = (index: number) => STEPS[Math.min(index, STEPS.length - 1)];
  const outside = shown.map((part, index) => ({ part, index })).filter(({ part }) => !fits(part));
  return (
    <div>
      <div ref={ref} role="img" aria-label={`${ariaLabel}. ${shown.map((part) => `${part.label} ${part.value}`).join(', ')}`} className="flex h-11 gap-0.5 overflow-hidden rounded-md">
        {shown.map((part, index) => (
          <div key={part.key} title={`${part.label} ${part.value}`} style={{ flex: `${part.value} 1 0`, background: step(index).fill, color: step(index).ink }} className="flex min-w-6 items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap px-1 text-control font-semibold tabular">
            {fits(part) && <span>{part.label}</span>}<span>{part.value}</span>
          </div>
        ))}
      </div>
      {outside.length > 0 && (
        <ul className="mt-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-control text-muted-foreground">
          {outside.map(({ part, index }) => (
            <li key={part.key} className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: step(index).fill }} />{part.label} <span className="tabular text-foreground">{part.value}</span></li>
          ))}
        </ul>
      )}
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
  /** Inside another card: a titled section with no frame of its own. */
  embedded?: boolean;
  children: React.ReactNode;
}> = ({ title, actions, known = true, hiddenReason, pending = false, error, className, testId, embedded = false, children }) => {
  const hide = !pending && !error && !known;
  useFigureReport(hide && hiddenReason ? [{ label: title, reason: hiddenReason }] : []);
  if (hide) return null;
  const body = pending ? <ListState variant="loading" shape="chart" rows={2} />
    : error ? <ListState variant="error" title={error.title} onRetry={error.retry} />
      : children;
  if (embedded) {
    return (
      <section className={className} data-testid={testId} aria-label={title}>
        <div className="mb-2 flex items-baseline justify-between gap-3"><h3 className="text-control font-semibold">{title}</h3>{actions}</div>
        {body}
      </section>
    );
  }
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
