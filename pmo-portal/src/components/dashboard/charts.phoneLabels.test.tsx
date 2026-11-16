/**
 * The billing chart on a phone: columns are narrower than their labels, yet the tallest month and the latest month
 * still carry their values, each directly above its own column (never parked at the top of the plot).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const COLUMN = 8; // px: a phone's column, narrower than any money label
const BASE = 200; // px: the plot's floor
let rows: Array<Record<string, unknown>> = [];

vi.mock('recharts', () => ({
  BarChart: ({ data, children }: { data: Array<Record<string, unknown>>; children?: React.ReactNode }) => { rows = data; return <g>{children}</g>; },
  Bar: ({ children }: { children?: React.ReactNode }) => <g>{children}</g>,
  LabelList: ({ content, dataKey }: { content: (props: object) => React.ReactNode; dataKey: string }) => {
    const series = dataKey === 'labelA' ? 'a' : 'b';
    return <g>{rows.map((row, index) => <g key={index}>{content({ x: index * 20, y: BASE - Number(row[series] ?? 0), width: COLUMN, height: Number(row[series] ?? 0), index, value: row[dataKey] })}</g>)}</g>;
  },
  CartesianGrid: () => null,
  Cell: () => null,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

import { MonthColumns } from './charts';

const months = [40, 176, 20, 15, 10, 34].map((a, index) => ({ key: `m${index}`, tick: `M${index}`, a, labelA: `$${a}K` }));

describe('Billing chart value labels on a phone', () => {
  it('labels the tallest and the latest month, each above its own column', () => {
    render(<MonthColumns points={months} ariaLabel="Invoiced" valueAxis={(value) => String(value)} />);

    const peak = screen.getByText('$176K');
    const latest = screen.getByText('$34K');
    expect(Number(peak.getAttribute('y'))).toBe(BASE - 176 - 5);
    expect(Number(latest.getAttribute('y'))).toBe(BASE - 34 - 5);
    // Anchored to its own column: the latest ends at its column's right edge, the peak is centred on its column.
    expect(Number(latest.getAttribute('x'))).toBe(5 * 20 + COLUMN);
    expect(Number(peak.getAttribute('x'))).toBe(1 * 20 + COLUMN / 2);
    expect(screen.queryByText('$20K')).toBeNull();
  });

  it('lifts the latest label clear of a taller neighbouring column it runs over', () => {
    // The latest label is wider than its column and ends at it, so it runs over the month before; that month's
    // collected column is taller, so the label sits above it instead of touching it.
    const points = [
      { key: 'm0', tick: 'M0', a: 150, labelA: '$150K', b: 20, labelB: '$20K' },
      { key: 'm1', tick: 'M1', a: 30, labelA: '$30K', b: 70, labelB: '$70K' },
      { key: 'm2', tick: 'M2', a: 40, labelA: '$40K', b: 10, labelB: '$10K' },
    ];
    render(<MonthColumns points={points} ariaLabel="Invoiced" seriesNames={['Invoiced', 'Collected']} valueAxis={(value) => String(value)} />);

    const latest = screen.getByText('$40K');
    expect(Number(latest.getAttribute('y'))).toBeLessThanOrEqual(BASE - 70 - 5);
  });
});
