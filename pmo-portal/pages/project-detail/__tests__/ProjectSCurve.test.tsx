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

// recharts' ResponsiveContainer needs a non-zero parent size under jsdom; force it.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 240 }}>{children}</div>
    ),
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
});
