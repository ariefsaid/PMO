import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MonthColumns } from './charts';

// Each LabelList draws its label for every month of the chart, as the real chart does.
const chart = vi.hoisted(() => ({ data: [] as Array<Record<string, unknown>> }));
vi.mock('recharts', () => ({
  Bar: ({ children }: { children?: React.ReactNode }) => <g>{children}</g>,
  BarChart: ({ children, data }: { children?: React.ReactNode; data: Array<Record<string, unknown>> }) => {
    chart.data = data;
    return <g>{children}</g>;
  },
  Cell: () => null,
  CartesianGrid: () => null,
  LabelList: ({ content, dataKey }: { content: (props: { x: number; y: number; width: number; height: number; index: number; value: unknown }) => React.ReactNode; dataKey: string }) => (
    <g>{chart.data.map((point, index) => <React.Fragment key={index}>{content({ x: index * 100, y: 80, width: 40, height: 100, index, value: point[dataKey] })}</React.Fragment>)}</g>
  ),
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const points = [
  { key: 'may', tick: 'May', a: 1_040_000, labelA: '$1.04M', b: 1_050_000, labelB: '$1.05M' },
  { key: 'jun', tick: 'Jun', a: 1_530_000, labelA: '$1.53M', b: 1_040_000, labelB: '$1.04M' },
  { key: 'jul', tick: 'Jul', a: 340_000, labelA: '$340K', b: 87_500, labelB: '$87.5K' },
];

describe('MonthColumns paired labels on a value axis', () => {
  it('labels only the latest month pair; every month stays in the accessible name', () => {
    render(<MonthColumns ariaLabel="Invoiced and collected" seriesNames={['Invoiced', 'Collected']} pairedLabelsOnBars valueAxis={(value) => String(value)} points={points} />);

    expect(screen.getByText('$340K')).toBeInTheDocument();
    expect(screen.getByText('$87.5K')).toBeInTheDocument();
    expect(screen.queryByText('$1.53M')).not.toBeInTheDocument();
    expect(screen.queryByText('$1.05M')).not.toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName(/Jun: Invoiced \$1\.53M, Collected \$1\.04M/);
  });

  it('labels the latest month either series has a value in, as one pair', () => {
    const lastCollectedOnly = [...points.slice(0, 2), { key: 'jul', tick: 'Jul', a: 0, labelA: '$0', b: 87_500, labelB: '$87.5K' }];
    render(<MonthColumns ariaLabel="Invoiced and collected" seriesNames={['Invoiced', 'Collected']} pairedLabelsOnBars valueAxis={(value) => String(value)} points={lastCollectedOnly} />);

    expect(screen.getByText('$87.5K')).toBeInTheDocument();
    expect(screen.queryByText('$1.53M')).not.toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });
});
