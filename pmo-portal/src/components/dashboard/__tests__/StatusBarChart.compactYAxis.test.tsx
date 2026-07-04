/**
 * StatusBarChart — item 4 (F2, Discover finding): the data_chart axis is
 * garbled at panel width (~365px). StatusBarChart's existing `useIsNarrow()`
 * branch keys off the GLOBAL viewport width (<640px) — a 400px-wide desktop
 * panel renders inside a much wider viewport, so useIsNarrow() stays false
 * and the chart uses the desktop axis config (rotated X labels + a normal
 * YAxis) inside a container far narrower than it assumes, producing
 * non-monotonic/garbled Y ticks.
 *
 * Fix (WITHOUT touching the dashboard's rendering — no existing StatusBarChart
 * caller passes these props, so their behavior is unchanged): a new opt-in
 * `compactYAxis` prop hides the Y-axis ticks (the figcaption legend already
 * carries every count — same rationale as the existing mobile X-axis hide)
 * and sets an explicit `domain={[0,'dataMax']}` so a cramped render can never
 * compute a non-monotonic/degenerate tick set.
 *
 * Strategy mirrors StatusBarChart.mobileAxis.test.tsx: mock recharts so
 * YAxis/XAxis surface their received props as data-* attributes.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('@/src/components/ui/useIsNarrow', () => ({
  useIsNarrow: () => false,
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => <div data-testid="bar" />,
  XAxis: () => <div data-testid="xaxis-stub" />,
  YAxis: ({ tick, width, domain }: { tick?: boolean | object; width?: number; domain?: unknown }) => (
    <div
      data-testid="yaxis-stub"
      data-tick={JSON.stringify(tick)}
      data-width={String(width)}
      data-domain={JSON.stringify(domain)}
    />
  ),
  CartesianGrid: () => null,
  Tooltip: () => null,
  Cell: () => null,
}));

import { StatusBarChart } from '../StatusBarChart';

const data = [
  { status: 'Draft' as const, count: 2 },
  { status: 'Ordered' as const, count: 5 },
  { status: 'Paid' as const, count: 3 },
];

const toneFor = () => 'hsl(142 70% 45%)';

describe('StatusBarChart compactYAxis (item 4, F2 — panel-width axis garbling)', () => {
  it('compactYAxis: YAxis renders with tick={false} (relies on the legend for counts)', () => {
    render(
      <MemoryRouter>
        <StatusBarChart data={data} toneFor={toneFor} label="By status" noun="items" compactYAxis />
      </MemoryRouter>,
    );
    const yaxis = screen.getByTestId('yaxis-stub');
    expect(yaxis.dataset.tick).toBe('false');
  });

  it('compactYAxis: YAxis has an explicit domain={[0,"dataMax"]} (never non-monotonic)', () => {
    render(
      <MemoryRouter>
        <StatusBarChart data={data} toneFor={toneFor} label="By status" noun="items" compactYAxis />
      </MemoryRouter>,
    );
    const yaxis = screen.getByTestId('yaxis-stub');
    expect(JSON.parse(yaxis.dataset.domain ?? 'null')).toEqual([0, 'dataMax']);
  });

  it('default (no compactYAxis): YAxis keeps its normal tick style — behavior-unchanged for existing callers', () => {
    render(
      <MemoryRouter>
        <StatusBarChart data={data} toneFor={toneFor} label="By status" noun="items" />
      </MemoryRouter>,
    );
    const yaxis = screen.getByTestId('yaxis-stub');
    expect(yaxis.dataset.tick).not.toBe('false');
  });
});
