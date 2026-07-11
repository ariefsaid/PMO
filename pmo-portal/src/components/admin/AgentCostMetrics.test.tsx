/**
 * AgentCostMetrics tests (AC-ACD-009) — presentational panel, props-only.
 *
 * Covers: KPI derivation from summaryRows/runStatsRows (cache hit-rate, reasoning
 * share, cost/run p50 weighted-by-runs, cost/run p95 max, p95 latency max), the
 * division-guard "—" fallback on empty denominators, the loading/error(+retry)/empty
 * ListState variants, and an axe-core zero-blocking-violations check per state.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { axeViolations } from '../__tests__/axe';
import { AgentCostMetrics, type AgentCostSummaryRow, type AgentCostRunStatsRow } from './AgentCostMetrics';
import { monthToUtcEpoch } from './agentCostMetrics.utils';

/** Extract a display name from any React element type (function, memo object, or string). */
function getTypeName(type: unknown): string | undefined {
  if (typeof type === 'string') return type;
  if (type && typeof type === 'object') {
    return (type as { displayName?: string }).displayName;
  }
  if (typeof type === 'function') {
    return (type as { displayName?: string; name?: string }).displayName ??
      (type as { name?: string }).name;
  }
  return undefined;
}

// Tooltip's labelFormatter/formatter, captured to verify the recharts-signature
// coercion (Number(label)/Number(value)) still produces the correct display string.
let capturedTooltipLabelFormatter: ((label: unknown) => React.ReactNode) | undefined;
let capturedTooltipFormatter: ((value: unknown) => React.ReactNode) | undefined;
// XAxis's tickFormatter — the SAME underlying formatMonthTick used (unwrapped) by
// labelFormatter, so it's the ground truth to compare labelFormatter's output against.
let capturedXAxisTickFormatter: ((v: number) => string) | undefined;

// recharts' ResponsiveContainer needs a non-zero parent size under jsdom; force it
// (mirrors ProjectSCurve.test.tsx's established pattern for testing recharts under jsdom).
// Also intercept LineChart to capture the Tooltip's formatter props (mirrors
// ProjectSCurve.test.tsx's LineChart-children-scan pattern).
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 200 }}>{children}</div>
    ),
    LineChart: ({ children, ...rest }: React.ComponentProps<typeof actual.LineChart>) => {
      React.Children.forEach(children as React.ReactNode, (child) => {
        if (!React.isValidElement(child)) return;
        const name = getTypeName(child.type);
        if (name === 'Tooltip') {
          const p = child.props as {
            labelFormatter?: (label: unknown) => React.ReactNode;
            formatter?: (value: unknown) => React.ReactNode;
          };
          capturedTooltipLabelFormatter = p.labelFormatter;
          capturedTooltipFormatter = p.formatter;
        }
        if (name === 'XAxis') {
          capturedXAxisTickFormatter = (child.props as { tickFormatter?: (v: number) => string })
            .tickFormatter;
        }
      });
      const ActualLineChart = actual.LineChart;
      return <ActualLineChart {...rest}>{children}</ActualLineChart>;
    },
  };
});

describe('monthToUtcEpoch (TZ-stable month parsing)', () => {
  it('parses a date-only month as UTC midnight regardless of the runner timezone', () => {
    // Must equal UTC epoch (the axis formatter uses timeZone:UTC). A local parse would shift this
    // by the runner's offset and mislabel the month for users east of UTC (code-quality finding).
    expect(monthToUtcEpoch('2026-06-01')).toBe(Date.UTC(2026, 5, 1));
    expect(monthToUtcEpoch('2026-06')).toBe(Date.UTC(2026, 5, 1)); // tolerate YYYY-MM
  });
});

const summaryRows: AgentCostSummaryRow[] = [
  {
    month: '2026-05-01',
    action: 'chat',
    prompt_tokens: 1000,
    completion_tokens: 500,
    cached_tokens: 200,
    reasoning_tokens: 100,
    cost: 1.5,
  },
  {
    month: '2026-06-01',
    action: 'chat',
    prompt_tokens: 3000,
    completion_tokens: 1500,
    cached_tokens: 1200,
    reasoning_tokens: 300,
    cost: 4.5,
  },
];

const runStatsRows: AgentCostRunStatsRow[] = [
  {
    action: 'chat',
    month: '2026-05-01',
    runs: 10,
    avg_rounds: 2.1,
    p50_cost: 0.02,
    p95_cost: 0.08,
    max_cost: 0.12,
    cache_hit_pct: 20,
    p50_ms: 800,
    p95_ms: 1500,
  },
  {
    action: 'chat',
    month: '2026-06-01',
    runs: 30,
    avg_rounds: 2.4,
    p50_cost: 0.04,
    p95_cost: 0.2,
    max_cost: 0.3,
    cache_hit_pct: 40,
    p50_ms: 900,
    p95_ms: 2200,
  },
];

const defaultProps = {
  summaryRows,
  runStatsRows,
  isPending: false,
  isError: false,
  onRetry: vi.fn(),
};

describe('AgentCostMetrics', () => {
  // ── Loading / error / empty states ────────────────────────────────────────

  it('loading state renders ListState loading skeleton', () => {
    render(<AgentCostMetrics {...defaultProps} isPending summaryRows={[]} runStatsRows={[]} />);
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('error state renders ListState error with retry, calling onRetry on click', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <AgentCostMetrics
        {...defaultProps}
        isError
        onRetry={onRetry}
        summaryRows={[]}
        runStatsRows={[]}
      />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('empty state (both arrays empty) renders ListState empty with a message', () => {
    render(<AgentCostMetrics {...defaultProps} summaryRows={[]} runStatsRows={[]} />);
    expect(screen.getByText(/no agent cost data yet/i)).toBeInTheDocument();
  });

  // ── KPI derivation ─────────────────────────────────────────────────────────

  it('renders the overall cache hit-rate (100·Σcached/Σprompt = 1400/4000 = 35.0%)', () => {
    render(<AgentCostMetrics {...defaultProps} />);
    expect(screen.getByText('35.0%')).toBeInTheDocument();
  });

  it('renders the overall reasoning share (100·Σreasoning/Σcompletion = 400/2000 = 20.0%)', () => {
    render(<AgentCostMetrics {...defaultProps} />);
    expect(screen.getByText('20.0%')).toBeInTheDocument();
  });

  it('renders cost/run p50 weighted by runs ((0.02*10 + 0.04*30)/40 = 0.035)', () => {
    render(<AgentCostMetrics {...defaultProps} />);
    expect(screen.getByText('$0.035')).toBeInTheDocument();
  });

  it('renders cost/run p95 as the max across rows (max(0.08, 0.2) = 0.2)', () => {
    render(<AgentCostMetrics {...defaultProps} />);
    expect(screen.getByText('$0.20')).toBeInTheDocument();
  });

  it('renders p95 latency as the max p95_ms formatted as seconds (max(1500, 2200) = 2.2s)', () => {
    render(<AgentCostMetrics {...defaultProps} />);
    expect(screen.getByText('2.2s')).toBeInTheDocument();
  });

  it('formats a sub-1000ms p95 latency in ms', () => {
    render(
      <AgentCostMetrics
        {...defaultProps}
        runStatsRows={[
          { ...runStatsRows[0], p95_ms: 850 },
        ]}
      />,
    );
    expect(screen.getByText('850ms')).toBeInTheDocument();
  });

  // ── Division guards ────────────────────────────────────────────────────────

  it('shows "—" for cache hit-rate when Σprompt_tokens is 0', () => {
    render(
      <AgentCostMetrics
        {...defaultProps}
        summaryRows={[{ ...summaryRows[0], prompt_tokens: 0, cached_tokens: 0 }]}
      />,
    );
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows "—" for reasoning share when Σcompletion_tokens is 0', () => {
    render(
      <AgentCostMetrics
        {...defaultProps}
        summaryRows={[{ ...summaryRows[0], completion_tokens: 0, reasoning_tokens: 0 }]}
      />,
    );
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows "—" for cost/run and latency tiles when runStatsRows is empty', () => {
    render(<AgentCostMetrics {...defaultProps} runStatsRows={[]} />);
    // 3 run-stats-derived tiles (p50 cost, p95 cost, p95 latency) all fall back.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  // ── Chart graceful single-month fallback ─────────────────────────────────

  it('renders a graceful placeholder (no chart) when summaryRows span only one month', () => {
    const { container } = render(
      <AgentCostMetrics {...defaultProps} summaryRows={[summaryRows[0]]} />,
    );
    expect(container.querySelector('.recharts-wrapper')).not.toBeInTheDocument();
    expect(screen.getByText(/more months/i)).toBeInTheDocument();
  });

  it('renders the trend chart when summaryRows span 2+ months', () => {
    const { container } = render(<AgentCostMetrics {...defaultProps} />);
    expect(container.querySelector('.recharts-wrapper')).toBeInTheDocument();
  });

  it('Tooltip labelFormatter/formatter still produce the correct display string for numeric axis values (recharts wide-signature coercion)', () => {
    render(<AgentCostMetrics {...defaultProps} />);

    expect(capturedTooltipLabelFormatter).toBeDefined();
    expect(capturedTooltipFormatter).toBeDefined();
    expect(capturedXAxisTickFormatter).toBeDefined();

    // recharts hands these numeric-axis formatters ReactNode-typed values that are
    // actually numbers at runtime; Number(...) recovers the number for formatting.
    // labelFormatter must agree with the axis's own tick formatter (same underlying
    // formatMonthTick, just wrapped for the Tooltip's wider signature).
    const epochMs = monthToUtcEpoch('2026-06-01');
    expect(capturedTooltipLabelFormatter!(epochMs)).toBe(capturedXAxisTickFormatter!(epochMs));
    expect(capturedTooltipFormatter!(40)).toEqual(['40.0%', 'Cache hit-rate']);
  });

  // ── a11y ───────────────────────────────────────────────────────────────────

  it('AC-ACD-009 ready state: axe-core zero blocking violations', async () => {
    const { container } = render(<AgentCostMetrics {...defaultProps} />);
    const { blocking } = await axeViolations(container);
    if (blocking.length > 0) console.error('Axe violations (ready):', blocking);
    expect(blocking).toEqual([]);
  });

  it('AC-ACD-009 loading state: axe-core zero blocking violations', async () => {
    const { container } = render(
      <AgentCostMetrics {...defaultProps} isPending summaryRows={[]} runStatsRows={[]} />,
    );
    const { blocking } = await axeViolations(container);
    expect(blocking).toEqual([]);
  });

  it('AC-ACD-009 error state: axe-core zero blocking violations', async () => {
    const { container } = render(
      <AgentCostMetrics {...defaultProps} isError summaryRows={[]} runStatsRows={[]} />,
    );
    const { blocking } = await axeViolations(container);
    expect(blocking).toEqual([]);
  });

  it('AC-ACD-009 empty state: axe-core zero blocking violations', async () => {
    const { container } = render(
      <AgentCostMetrics {...defaultProps} summaryRows={[]} runStatsRows={[]} />,
    );
    const { blocking } = await axeViolations(container);
    expect(blocking).toEqual([]);
  });
});
