import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MonthColumns } from './charts';

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
});

describe('MonthColumns value-axis labels', () => {
  it('labels only the tallest column and the latest month (first series)', async () => {
    const { peakLabelIndexes } = await import('./chartLabels');
    const data = [{ a: 10, b: 5 }, { a: 30, b: 80 }, { a: 20, b: 0 }, { a: 15, b: 12 }, { a: 0, b: 0 }];
    expect(peakLabelIndexes(data)).toEqual({ peak: { index: 1, series: 'b' }, last: 3 });
    expect(peakLabelIndexes([{ a: 0, b: 0 }])).toEqual({ peak: null, last: -1 });
  });
});
