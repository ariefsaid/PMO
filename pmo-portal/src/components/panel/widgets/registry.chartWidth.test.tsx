/**
 * registry.tsx — item 4 (F2, Discover finding): the data_chart panel-registry
 * path must pass container-appropriate props to StatusBarChart (compactYAxis)
 * — the panel is a fixed ~365px-content-width container that never matches
 * StatusBarChart's own useIsNarrow() viewport-width branch. Mocks
 * StatusBarChart directly (not recharts) so the prop pass-through is asserted
 * without depending on jsdom's zero-width ResponsiveContainer rendering.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const statusBarChartSpy = vi.fn();

vi.mock('@/src/components/dashboard/StatusBarChart', () => ({
  StatusBarChart: (props: Record<string, unknown>) => {
    statusBarChartSpy(props);
    return <div data-testid="status-bar-chart-stub" />;
  },
}));

import { renderWidget } from './registry';

describe('renderWidget data_chart — item 4 panel-width axis fix', () => {
  it('passes compactYAxis to StatusBarChart', () => {
    render(
      <MemoryRouter>
        {renderWidget({
          kind: 'data_chart',
          chartType: 'bar',
          series: [{ label: 'Alpha', value: 3 }],
        })}
      </MemoryRouter>,
    );

    expect(screen.getByTestId('status-bar-chart-stub')).toBeInTheDocument();
    expect(statusBarChartSpy).toHaveBeenCalledWith(
      expect.objectContaining({ compactYAxis: true }),
    );
  });
});
