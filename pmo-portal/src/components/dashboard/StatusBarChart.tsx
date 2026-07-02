import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { chartTheme, tintStatusFill } from '@/src/components/ui/chartTheme';
import { useIsNarrow } from '@/src/components/ui/useIsNarrow';
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
  /**
   * Optional: when provided, each legend entry becomes a `<Link>` to the
   * returned href, enabling drill-down from the chart legend to a filtered
   * list view. When omitted, legend entries remain plain `<span>` elements —
   * no behavior change for other callers (AC-JR-W1-10).
   */
  hrefFor?: (status: S) => string;
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
  hrefFor,
}: StatusBarChartProps<S>) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const isNarrow = useIsNarrow();

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
          {/* On narrow viewports the rotated labels are cramped and redundant —
              the figcaption legend lists every status with dot+name+count. Hide
              the axis ticks on mobile and reclaim the vertical space. Desktop
              keeps the original rotated-label config unchanged. */}
          <XAxis
            dataKey="status"
            tickLine={false}
            axisLine={{ stroke: chartTheme.grid }}
            interval={0}
            {...(isNarrow
              ? { tick: false, height: 8 }
              : { tick: axisTickStyle, angle: -30, textAnchor: 'end', height: 64 }
            )}
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
              // Tinted status-hue fill (Tinted-Status Rule) — never a saturated
              // categorical fill. The solid hue is reserved for the legend dot.
              <Cell key={d.status} fill={tintStatusFill(toneFor(d.status))} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-muted-foreground">
        {data.map((d) => {
          const inner = (
            <>
              <span
                data-testid="legend-dot"
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: toneFor(d.status) }}
              />
              {d.status}
              <span className="tabular font-semibold text-foreground">{d.count}</span>
            </>
          );
          return hrefFor ? (
            <Link
              key={d.status}
              to={hrefFor(d.status)}
              className="inline-flex items-center gap-1.5 hover:text-primary-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              {inner}
            </Link>
          ) : (
            <span key={d.status} className="inline-flex items-center gap-1.5">
              {inner}
            </span>
          );
        })}
      </figcaption>
    </figure>
  );
}
