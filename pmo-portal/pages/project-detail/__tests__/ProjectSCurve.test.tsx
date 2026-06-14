import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

// ── Stub the milestone read (the S-curve's only data source) ─────────────────
const milestoneState = {
  data: [] as MilestoneWithProgress[] | undefined,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => milestoneState,
}));

// Captured props from LineChart mock — set on every render.
let capturedLineChartMargin: { top?: number; right?: number; bottom?: number; left?: number } | undefined;
// YAxis width extracted from LineChart children (recharts wraps YAxis in React.memo so
// el.type is an object with a `displayName` property, not a plain function).
let capturedYAxisWidth: number | undefined;

/** Extract a display name from any React element type (function, memo object, or string). */
function getTypeName(type: unknown): string | undefined {
  if (typeof type === 'string') return type;
  if (type && typeof type === 'object') {
    // React.memo / React.forwardRef wrapper — has displayName directly on the object
    return (type as { displayName?: string }).displayName;
  }
  if (typeof type === 'function') {
    return (type as { displayName?: string; name?: string }).displayName ??
      (type as { name?: string }).name;
  }
  return undefined;
}

// recharts' ResponsiveContainer needs a non-zero parent size under jsdom; force it.
// Also intercept LineChart to capture its margin prop (AC-SC-009) and scan its children
// for a YAxis element to capture the width prop (AC-SC-010).
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 240 }}>{children}</div>
    ),
    LineChart: ({ children, margin, ...rest }: React.ComponentProps<typeof actual.LineChart>) => {
      capturedLineChartMargin = margin as typeof capturedLineChartMargin;
      // Recharts treats YAxis as a config child — scan children for YAxis element to
      // capture its `width` prop before passing to the real LineChart.
      React.Children.forEach(children as React.ReactNode, (child) => {
        if (React.isValidElement(child)) {
          const name = getTypeName(child.type);
          if (name === 'YAxis') {
            capturedYAxisWidth = (child.props as { width?: number }).width;
          }
        }
      });
      const ActualLineChart = actual.LineChart;
      return <ActualLineChart margin={margin} {...rest}>{children}</ActualLineChart>;
    },
  };
});

import ProjectSCurve from '../ProjectSCurve';

const dated: MilestoneWithProgress[] = [
  {
    id: 'a', project_id: 'p1', name: 'Design', sort_order: 0,
    target_date: '2026-01-01', weight: 1, input_pct: 100, task_count: 2,
    calculated_pct: 100, effective_pct: 100,
  },
  {
    id: 'b', project_id: 'p1', name: 'Build', sort_order: 1,
    target_date: '2026-07-01', weight: 1, input_pct: 0, task_count: 2,
    calculated_pct: 0, effective_pct: 0,
  },
];

const undated: MilestoneWithProgress[] = dated.map((m) => ({ ...m, target_date: null }));

const render$ = () => render(<ProjectSCurve projectId="p1" />);

describe('ProjectSCurve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    milestoneState.data = [];
    milestoneState.isPending = false;
    milestoneState.isError = false;
    milestoneState.refetch = vi.fn();
    capturedLineChartMargin = undefined;
    capturedYAxisWidth = undefined;
  });

  it('AC-SC-005: ready with dated milestones renders the chart figure with a Planned/Actual two-item text legend', () => {
    milestoneState.data = dated;
    render$();

    const figure = screen.getByRole('img');
    expect(figure.tagName.toLowerCase()).toBe('figure');
    // Two legend swatches + their text.
    expect(screen.getAllByTestId('legend-dot')).toHaveLength(2);
    expect(screen.getByText('Planned')).toBeInTheDocument();
    expect(screen.getByText('Actual to date')).toBeInTheDocument();
  });

  it('AC-SC-006: ready with no dated milestones shows the empty state, not a chart', () => {
    milestoneState.data = undated;
    render$();

    expect(screen.getByText('No dated milestones yet')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('AC-SC-007: pending read shows the loading skeleton', () => {
    milestoneState.isPending = true;
    render$();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('AC-SC-007: errored read shows an error + Retry that calls refetch', () => {
    milestoneState.isError = true;
    const refetchSpy = vi.fn();
    milestoneState.refetch = refetchSpy;
    render$();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });

  it('AC-SC-008: ready figure carries an aria-label summary naming actual-to-date %, with on-token legend swatches (no raw hex)', () => {
    milestoneState.data = dated;
    render$();

    const figure = screen.getByRole('img');
    const label = figure.getAttribute('aria-label') ?? '';
    expect(label).toMatch(/actual to date/i);
    // rollup = (1·100 + 1·0)/2 = 50%
    expect(label).toMatch(/50%/);

    // Legend swatches use the One-Blue token, never a raw hex.
    for (const dot of screen.getAllByTestId('legend-dot')) {
      const bg = (dot as HTMLElement).style.background;
      expect(bg).toContain('hsl(var(--primary))');
      expect(bg).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });

  it('AC-SC-009: the LineChart left margin is ≥ 0 so Y-axis tick labels (0/25/50/75/100%) are not clipped (round-2 drift fix)', () => {
    // A negative `margin.left` in recharts pulls the YAxis outside the container
    // edge — the % tick labels render off-screen. The fix sets margin.left = 0.
    // This regression guard ensures it stays non-negative.
    capturedLineChartMargin = undefined;
    milestoneState.data = dated;
    render$();
    // capturedLineChartMargin is set by the LineChart mock above on every render.
    expect(capturedLineChartMargin).toBeDefined();
    expect(capturedLineChartMargin!.left ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('AC-SC-010: YAxis width is ≥ 44px so the "100%" tick label renders in full without clipping (round-2 drift fix)', () => {
    // recharts renders "100%" as the widest Y-axis label; a width of 32px clips the
    // leading "1" off-canvas, producing "00%". The fix sets width=44 which is wide
    // enough for the full "100%" string at the axis tick font size.
    milestoneState.data = dated;
    render$();
    // capturedYAxisWidth is extracted from LineChart's children by the mock above.
    // recharts wraps YAxis in React.memo; getTypeName() handles memo object displayName.
    expect(capturedYAxisWidth).toBeDefined();
    expect(capturedYAxisWidth!).toBeGreaterThanOrEqual(44);
  });
});
