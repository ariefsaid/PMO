import React, { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { monthToUtcEpoch } from './agentCostMetrics.utils';
import { ListState, StatTiles, type StatTile } from '@/src/components/ui';
import { ChartFrame, type ChartState } from '@/src/components/dashboard/ChartFrame';
import { usePrefersReducedMotion } from '@/src/components/dashboard/usePrefersReducedMotion';
import { tooltipContentStyle, tooltipLabelStyle, axisTickStyle } from '@/src/components/dashboard/chartChrome';
import { chartTheme } from '@/src/components/ui/chartTheme';

/**
 * Agent cost dashboard — presentational panel (ops-admin surface, agent-cost-dashboard
 * plan 2026-07-10). Props-only: no data fetching, no db/hook imports. Sourced entirely
 * from the two rows the caller passes in (the `org_agent_run_stats`/`org_usage_summary`
 * family + their operator equivalents) — the privacy line (NFR-PRIV-001, agent_usage-only)
 * is enforced by the caller, not this component.
 *
 * Row shapes are declared locally (not imported from `src/lib/db/usage`) so this component
 * stays decoupled from the parallel data-layer track — it only needs the fields it reads.
 */

export interface AgentCostSummaryRow {
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  cost: number;
  month: string;
  action: string;
}

export interface AgentCostRunStatsRow {
  action: string;
  month: string;
  runs: number;
  avg_rounds: number;
  p50_cost: number;
  p95_cost: number;
  max_cost: number;
  cache_hit_pct: number;
  p50_ms: number;
  p95_ms: number;
}

export interface AgentCostMetricsProps {
  summaryRows: AgentCostSummaryRow[];
  runStatsRows: AgentCostRunStatsRow[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
}

const DASH = '—';

/** Fine-grained USD formatter (matches AdministrationUsage's per-run sub-$1 costs). */
const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
function formatUsd(value: number): string {
  return usdFormatter.format(value);
}

/** ms → "X.Xs" at/above 1000ms, else "Xms" (rounded). */
function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return DASH;
  return `${((100 * numerator) / denominator).toFixed(1)}%`;
}

interface DerivedKpis {
  cacheHitRate: string;
  reasoningShare: string;
  costP50: string;
  costP95: string;
  latencyP95: string;
}

function deriveKpis(
  summaryRows: AgentCostSummaryRow[],
  runStatsRows: AgentCostRunStatsRow[],
): DerivedKpis {
  const totals = summaryRows.reduce(
    (acc, r) => ({
      prompt: acc.prompt + r.prompt_tokens,
      completion: acc.completion + r.completion_tokens,
      cached: acc.cached + r.cached_tokens,
      reasoning: acc.reasoning + r.reasoning_tokens,
    }),
    { prompt: 0, completion: 0, cached: 0, reasoning: 0 },
  );

  const totalRuns = runStatsRows.reduce((sum, r) => sum + r.runs, 0);
  const costP50 =
    totalRuns === 0
      ? DASH
      : formatUsd(runStatsRows.reduce((sum, r) => sum + r.p50_cost * r.runs, 0) / totalRuns);
  const costP95 =
    runStatsRows.length === 0
      ? DASH
      : formatUsd(Math.max(...runStatsRows.map((r) => r.p95_cost)));
  const latencyP95 =
    runStatsRows.length === 0
      ? DASH
      : formatMs(Math.max(...runStatsRows.map((r) => r.p95_ms)));

  return {
    cacheHitRate: pct(totals.cached, totals.prompt),
    reasoningShare: pct(totals.reasoning, totals.completion),
    costP50,
    costP95,
    latencyP95,
  };
}

interface MonthlyCacheHitPoint {
  ts: number;
  month: string;
  pct: number;
}

/** Groups summaryRows by month → 100·Σcached/Σprompt per month, sorted ascending by time. */
function deriveMonthlyCacheHit(summaryRows: AgentCostSummaryRow[]): MonthlyCacheHitPoint[] {
  const byMonth = new Map<string, { cached: number; prompt: number }>();
  for (const r of summaryRows) {
    const bucket = byMonth.get(r.month) ?? { cached: 0, prompt: 0 };
    bucket.cached += r.cached_tokens;
    bucket.prompt += r.prompt_tokens;
    byMonth.set(r.month, bucket);
  }
  return Array.from(byMonth.entries())
    .map(([month, { cached, prompt }]) => ({
      ts: monthToUtcEpoch(month),
      month,
      pct: prompt === 0 ? 0 : (100 * cached) / prompt,
    }))
    .sort((a, b) => a.ts - b.ts);
}

const monthAxisFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
function formatMonthTick(epochMs: number): string {
  return monthAxisFmt.format(new Date(epochMs));
}

export const AgentCostMetrics: React.FC<AgentCostMetricsProps> = ({
  summaryRows,
  runStatsRows,
  isPending,
  isError,
  onRetry,
}) => {
  const kpis = useMemo(() => deriveKpis(summaryRows, runStatsRows), [summaryRows, runStatsRows]);
  const monthlyCacheHit = useMemo(() => deriveMonthlyCacheHit(summaryRows), [summaryRows]);
  const prefersReducedMotion = usePrefersReducedMotion();

  if (isPending) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <ListState variant="loading" rows={4} />
      </div>
    );
  }

  if (isError) {
    return (
      <ListState
        variant="error"
        title="Couldn't load agent cost metrics"
        sub="The request failed. Check your connection and try again."
        onRetry={onRetry}
      />
    );
  }

  if (summaryRows.length === 0 && runStatsRows.length === 0) {
    return (
      <ListState
        variant="empty"
        icon="admin"
        title="No agent cost data yet"
        sub="Agent cost telemetry appears here once your workspace starts using the assistant."
      />
    );
  }

  const tiles: StatTile[] = [
    { label: 'Cache hit-rate', value: kpis.cacheHitRate },
    { label: 'Reasoning share', value: kpis.reasoningShare },
    { label: 'Cost / run (p50, weighted by runs)', value: kpis.costP50 },
    { label: 'Cost / run (p95, max)', value: kpis.costP95 },
    { label: 'Latency (p95, max)', value: kpis.latencyP95 },
  ];

  const chartState: ChartState = monthlyCacheHit.length >= 2 ? 'ready' : 'empty';
  const chartSummary = `Cache hit-rate by month, ${monthlyCacheHit.length} months.`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="mb-1 text-[14px] font-bold tracking-[-0.01em]">Agent cost overview</h2>
        {/* Honesty caption (code-quality review): the tiles blend all actions/months (and, on the
            unscoped Operator path, all orgs) — so the numbers read as a portfolio overview, not a
            single-cohort statistic. */}
        <p className="mb-3 text-[12px] text-muted-foreground">Across all actions and months.</p>
        <StatTiles tiles={tiles} columns={5} />
      </div>

      <div>
        <h3 className="mb-3 text-[13.5px] font-semibold text-muted-foreground">
          Cache hit-rate by month
        </h3>
        <ChartFrame
          state={chartState}
          emptyTitle="Not enough data yet"
          emptySub="Cache hit-rate trends appear once usage spans two or more months."
        >
          <figure role="img" aria-label={chartSummary} className="m-0">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={monthlyCacheHit} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={formatMonthTick}
                  tick={axisTickStyle}
                  tickLine={false}
                  axisLine={{ stroke: chartTheme.grid }}
                  minTickGap={32}
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  tick={axisTickStyle}
                  tickLine={false}
                  axisLine={{ stroke: chartTheme.grid }}
                  width={40}
                />
                <Tooltip
                  contentStyle={tooltipContentStyle}
                  labelStyle={tooltipLabelStyle}
                  labelFormatter={(label) => formatMonthTick(Number(label))}
                  formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Cache hit-rate']}
                />
                <Line
                  type="monotone"
                  dataKey="pct"
                  name="Cache hit-rate"
                  stroke={chartTheme.series.primary}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  isAnimationActive={!prefersReducedMotion}
                />
              </LineChart>
            </ResponsiveContainer>
          </figure>
        </ChartFrame>
      </div>
    </div>
  );
};
