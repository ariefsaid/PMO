import React from 'react';
import { CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { tooltipContentStyle, tooltipCursorFill, tooltipLabelStyle } from '@/src/components/dashboard/chartChrome';
import { usePrefersReducedMotion } from '@/src/components/dashboard/usePrefersReducedMotion';

export interface RevenueTrendPoint {
  key: string;
  tick: string;
  a: number | null;
  labelA?: string;
  b?: number | null;
  labelB?: string;
}

const directEndLabel = (color: string, offset: number) => (props: { x?: number | string; y?: number | string; value?: unknown }) => {
  if (props.value == null || props.value === '') return null;
  return <text x={Number(props.x ?? 0) + 7} y={Number(props.y ?? 0) + offset} textAnchor="start" style={{ fontSize: 12, fontWeight: 600, fill: color }}>{String(props.value)}</text>;
};

/** Two monthly money series on one scale, named at their endpoints instead of decoded through a legend. */
export const RevenueTrendLineChart: React.FC<{
  points: RevenueTrendPoint[];
  ariaLabel: string;
  seriesNames: [string, string?];
  height?: number;
}> = ({ points, ariaLabel, seriesNames, height = 168 }) => {
  const reduced = usePrefersReducedMotion();
  const hasSecond = points.some((point) => point.b !== undefined);
  const nameA = seriesNames[0];
  const nameB = seriesNames[1] ?? '';
  const lastA = points.reduce((last, point, index) => point.labelA != null ? index : last, -1);
  const lastB = points.reduce((last, point, index) => point.labelB != null ? index : last, -1);
  const data = points.map((point, index) => ({
    ...point,
    endLabelA: index === lastA && point.labelA != null ? `${nameA} ${point.labelA}` : null,
    endLabelB: index === lastB && point.labelB != null ? `${nameB} ${point.labelB}` : null,
  }));
  const ariaValues = points.map((point) => [
    point.a == null || !point.labelA ? null : `${nameA} ${point.labelA}`,
    point.b == null || !point.labelB ? null : `${nameB} ${point.labelB}`,
  ].filter(Boolean).join(', ')).map((value, index) => value ? `${points[index].tick}: ${value}` : null).filter(Boolean).join('; ');
  return (
    <div role="img" aria-label={`${ariaLabel}. ${ariaValues}`} className="w-full min-w-0" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 20, right: 160, bottom: 2, left: 4 }}>
          <CartesianGrid horizontal={false} vertical={false} />
          <XAxis dataKey="tick" tick={{ fontSize: 12, fill: chartTheme.axis }} tickLine={false} stroke={chartTheme.grid} interval={points.length > 8 ? 1 : 0} />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip cursor={tooltipCursorFill} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(_value, key, item) => [
            (key === 'a' ? item?.payload?.labelA : item?.payload?.labelB) ?? '', key === 'a' ? nameA : nameB,
          ]} />
          <Line type="monotone" dataKey="a" name={nameA} stroke={chartTheme.series.primary} strokeWidth={2} dot={{ r: 2, fill: chartTheme.series.primary }} activeDot={{ r: 4 }} isAnimationActive={!reduced}>
            <LabelList dataKey="endLabelA" content={directEndLabel(chartTheme.series.primary, -8)} />
          </Line>
          {hasSecond && <Line type="monotone" dataKey="b" name={nameB} stroke={chartTheme.series.neutral} strokeWidth={2} dot={{ r: 2, fill: chartTheme.series.neutral }} activeDot={{ r: 4 }} isAnimationActive={!reduced}>
            <LabelList dataKey="endLabelB" content={directEndLabel(chartTheme.series.neutral, 14)} />
          </Line>}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
