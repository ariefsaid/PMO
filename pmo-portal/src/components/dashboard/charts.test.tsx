import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MonthColumns } from './charts';

vi.mock('recharts', () => ({
  Bar: ({ children }: { children?: React.ReactNode }) => <g>{children}</g>,
  BarChart: ({ children }: { children?: React.ReactNode }) => <g>{children}</g>,
  Cell: () => null,
  LabelList: ({ content, dataKey }: {
    content: (props: { x: number; y: number; width: number; index: number; value: string }) => React.ReactNode;
    dataKey: string;
  }) => {
    const label = dataKey === 'labelA' ? '$180K' : '$100K';
    const x = dataKey === 'labelA' ? 100 : 152;
    return <g>{content({ x, y: 80, width: 48, index: 0, value: label })}</g>;
  },
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

describe('MonthColumns series labels', () => {
  it('visibly names both series when paired columns use two colours', () => {
    render(
      <MonthColumns
        ariaLabel="Invoiced and collected by month"
        seriesNames={['Invoiced, excl. tax', 'Collected']}
        points={[{ key: 'jan', tick: 'Jan', a: 100, labelA: '$100', b: 60, labelB: '$60' }]}
      />,
    );

    const legend = screen.getByRole('list');
    expect(legend).toHaveTextContent('Invoiced, excl. tax');
    expect(legend).toHaveTextContent('Collected');
  });

  it('does not add a two-series legend to a single-series chart', () => {
    render(
      <MonthColumns
        ariaLabel="Collected by month"
        seriesNames={['Collected']}
        points={[{ key: 'jan', tick: 'Jan', a: 100, labelA: '$100' }]}
      />,
    );

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('centers each paired month value over its own column', () => {
    render(
      <MonthColumns
        ariaLabel="Invoiced and collected by month"
        seriesNames={['Invoiced', 'Collected']}
        pairedLabelsOnBars
        points={[{ key: 'may', tick: 'May', a: 180_000, labelA: '$180K', b: 100_000, labelB: '$100K' }]}
      />,
    );

    const invoiced = screen.getByText('$180K');
    const collected = screen.getByText('$100K');

    expect(invoiced).toHaveAttribute('text-anchor', 'middle');
    expect(collected).toHaveAttribute('text-anchor', 'middle');
    expect(invoiced.getAttribute('x')).not.toBe(collected.getAttribute('x'));
    expect(invoiced.getAttribute('y')).not.toBe(collected.getAttribute('y'));
  });

  it('keeps chart marks unlabeled when the caller provides a separate visible value row', () => {
    render(
      <MonthColumns
        ariaLabel="Invoiced and collected by month"
        seriesNames={['Invoiced', 'Collected']}
        showValueLabels={false}
        points={[{ key: 'jan', tick: 'Jan', a: 100, labelA: '$100', b: 60, labelB: '$60' }]}
      />,
    );

    expect(screen.queryByText('$180K')).not.toBeInTheDocument();
    expect(screen.queryByText('$100K')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Jan: Invoiced \$100, Collected \$60/ })).toBeInTheDocument();
  });
});

describe('MonthColumns value-axis labels', () => {
  it('labels only the tallest column and the latest month (first series)', async () => {
    const { peakLabelIndexes } = await import('./chartLabels');
    const data = [{ a: 10, b: 5 }, { a: 30, b: 80 }, { a: 20, b: 0 }, { a: 15, b: 12 }, { a: 0, b: 0 }];
    expect(peakLabelIndexes(data)).toEqual({ peak: { index: 1, series: 'b' }, last: 3 });
    expect(peakLabelIndexes([{ a: 0, b: 0 }])).toEqual({ peak: null, last: -1 });
  });
});
