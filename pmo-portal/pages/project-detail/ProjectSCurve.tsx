import React, { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { ChartFrame, type ChartState } from '@/src/components/dashboard/ChartFrame';
import { usePrefersReducedMotion } from '@/src/components/dashboard/usePrefersReducedMotion';
import { tooltipContentStyle, tooltipLabelStyle, axisTickStyle } from '@/src/components/dashboard/chartChrome';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { useMilestones } from '@/src/hooks/useMilestones';
import { useTasks } from '@/src/hooks/useTasks';
import { buildSCurve, evenAxisTicks, formatSCurveAxisDate } from '@/src/lib/delivery/sCurve';

export interface ProjectSCurveProps {
  projectId: string;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Per-project cumulative S-curve on the Delivery lens (FR-SC-001), below the
 * milestone stepper. Reuses `useMilestones(projectId)` + `useTasks(projectId)` which
 * are already loaded on the project-detail page (NFR-SCA-004 — no extra round-trip;
 * RLS on the security-invoker RPC scopes rows, NFR-SC-SEC-001).
 *
 * Planned = dashed multi-point cumulative curve at each milestone `target_date`
 * (monotonic → 100%). Actual = solid multi-point line via the hybrid source rule
 * (FR-SCA-008): task-tracked milestones step at each Done task's `completed_at` (or
 * `end_date` proxy); overridden/task-less milestones contribute at `target_date`.
 * Falls back to a single as-of-today dot when tasks are absent (FR-SCA-011).
 * Both lines share One-Blue (DESIGN.md single-blue identity); style-only distinction.
 */
const ProjectSCurve: React.FC<ProjectSCurveProps> = ({ projectId }) => {
  const { data, isPending, isError, refetch } = useMilestones(projectId);
  // NFR-SCA-004: reuse tasks already loaded on the project-detail page — no extra round-trip.
  const { data: tasksData } = useTasks(projectId);
  const prefersReducedMotion = usePrefersReducedMotion();

  const model = useMemo(
    () => buildSCurve(data ?? [], todayIso(), tasksData ?? []),
    [data, tasksData],
  );

  // FR-SCA-013: suppress the lone dot only when the actual series has ≥2 points.
  const hasActualSeries = model.points.filter((p) => p.actual !== null).length >= 2;

  // Explicit evenly-spaced first-of-month ticks so recharts never auto-ticks
  // at clustered data coordinates (fixes overlapping labels on the left when
  // actual-line points cluster early in the timeline).
  const axisTicks = useMemo(() => {
    if (model.points.length === 0) return undefined;
    const tsList = model.points.map((p) => p.ts);
    const tsMin = Math.min(...tsList);
    const tsMax = Math.max(...tsList);
    return evenAxisTicks(tsMin, tsMax);
  }, [model.points]);

  const state: ChartState = isPending
    ? 'loading'
    : isError
      ? 'error'
      : model.points.length === 0
        ? 'empty'
        : 'ready';

  const plannedToday = model.plannedToDate;
  const summary = plannedToday != null
    ? `Project S-curve: actual to date ${model.actualToDate}%, plan expected ${Math.round(plannedToday)}% by today.`
    : `Project S-curve: actual to date ${model.actualToDate}%.`;

  return (
    <div>
      <h2 className="mb-3 text-[14px] font-bold tracking-[-0.01em]">Progress curve</h2>

      <ChartFrame
        state={state}
        loadingRows={4}
        emptyIcon="cal"
        emptyTitle="No dated milestones yet"
        emptySub="Add target dates to your delivery phases to see the planned-vs-actual curve."
        errorTitle="Couldn't load the progress curve"
        errorSub="The request failed. Check your connection and try again."
        onRetry={() => refetch()}
      >
        <figure role="img" aria-label={summary} className="m-0">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={model.points} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax']}
                ticks={axisTicks}
                tickFormatter={formatSCurveAxisDate}
                tick={axisTickStyle}
                tickLine={false}
                axisLine={{ stroke: chartTheme.grid }}
                minTickGap={32}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={axisTickStyle}
                tickLine={false}
                axisLine={{ stroke: chartTheme.grid }}
                width={44}
              />
              <Tooltip
                contentStyle={tooltipContentStyle}
                labelStyle={tooltipLabelStyle}
                labelFormatter={(label: number) => formatSCurveAxisDate(label)}
                formatter={(value: number) => `${value}%`}
              />
              {/* Planned = dashed One-Blue (the "target"). */}
              <Line
                type="monotone"
                dataKey="planned"
                name="Planned"
                stroke={chartTheme.series.primary}
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                connectNulls
                isAnimationActive={!prefersReducedMotion}
              />
              {/* Actual = solid One-Blue; linear type gives a stepped real-history shape.
                  Drop the lone dot at ≥2 actual points (FR-SCA-012/013). */}
              <Line
                type="linear"
                dataKey="actual"
                name="Actual to date"
                stroke={chartTheme.series.primary}
                strokeWidth={2}
                dot={hasActualSeries ? false : { r: 4, fill: chartTheme.series.primary }}
                connectNulls
                isAnimationActive={!prefersReducedMotion}
              />
            </LineChart>
          </ResponsiveContainer>

          <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span
                data-testid="legend-dot"
                aria-hidden="true"
                className="h-0.5 w-4 shrink-0 rounded-full"
                style={{
                  background: `repeating-linear-gradient(to right, ${chartTheme.series.primary} 0 5px, transparent 5px 9px)`,
                }}
              />
              Planned
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                data-testid="legend-dot"
                aria-hidden="true"
                className="h-0.5 w-4 shrink-0 rounded-full"
                style={{ background: chartTheme.series.primary }}
              />
              Actual to date
              <span className="tabular font-semibold text-foreground">{model.actualToDate}%</span>
            </span>
          </figcaption>

          {/* FR-SCA-014 backfill caveat — proxy dates (completed_at absent) are estimates. */}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Completion dates before today are estimated; live tracking starts now.
          </p>
        </figure>
      </ChartFrame>
    </div>
  );
};

export default ProjectSCurve;
