import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { tooltipContentStyle, tooltipLabelStyle, tooltipCursorFill, axisTickStyle } from './chartChrome';

export interface StatusDatum<S extends string> {
  status: S;
  count: number;
}

export interface StatusBarChartProps<S extends string> {
  data: StatusDatum<S>[];
  /** Maps a status to its DESIGN.md chart-series token (the bug-fix helper). */
  toneFor: (status: S) => string;
  /** Section label for the aria insight summary. */
  label: string;
  /** Plural noun for the summary ("requests" / "projects"). */
  noun: string;
  height?: number;
}

/**
 * Status-toned bar chart: one `<Cell>` per datum colored by `toneFor` so color
 * carries the status meaning (fixes the legacy single-fill `#10b981` bug). Color
 * is never the only channel — the x-axis names each status, the legend is dot +
 * **text**, and the section carries an aria summary naming the top status
 * (color-not-only / screen-reader-summary / contrast-data).
 */
export function StatusBarChart<S extends string>({
  data,
  toneFor,
  label,
  noun,
  height = 260,
}: StatusBarChartProps<S>) {
  const prefersReducedMotion = usePrefersReducedMotion();

  const { total, topStatus } = useMemo(() => {
    const sum = data.reduce((a, d) => a + d.count, 0);
    const top = data.reduce<StatusDatum<S> | null>(
      (best, d) => (best === null || d.count > best.count ? d : best),
      null,
    );
    return { total: sum, topStatus: top?.status ?? '—' };
  }, [data]);

  const summary = `${label}, ${total} ${noun}, most in ${topStatus}.`;

  return (
    <figure role="img" aria-label={summary} className="m-0">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
          <XAxis
            dataKey="status"
            tick={axisTickStyle}
            tickLine={false}
            axisLine={{ stroke: chartTheme.grid }}
            interval={0}
            angle={-30}
            textAnchor="end"
            height={64}
          />
          <YAxis
            allowDecimals={false}
            tick={axisTickStyle}
            tickLine={false}
            axisLine={{ stroke: chartTheme.grid }}
            width={32}
          />
          <Tooltip
            contentStyle={tooltipContentStyle}
            labelStyle={tooltipLabelStyle}
            cursor={tooltipCursorFill}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={!prefersReducedMotion}>
            {data.map((d) => (
              <Cell key={d.status} fill={toneFor(d.status)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-muted-foreground">
        {data.map((d) => (
          <span key={d.status} className="inline-flex items-center gap-1.5">
            <span
              data-testid="legend-dot"
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: toneFor(d.status) }}
            />
            {d.status}
            <span className="tabular font-semibold text-foreground">{d.count}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
