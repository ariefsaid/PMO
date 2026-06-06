import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChartFrame } from './ChartFrame';

describe('ChartFrame (new AC — chart states)', () => {
  it('renders a loading skeleton (not a bare axis) while pending', () => {
    render(
      <ChartFrame state="loading" emptyTitle="x">
        <div data-testid="chart-body" />
      </ChartFrame>,
    );
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-body')).toBeNull();
  });

  it('renders a composed empty state when there are zero rows', () => {
    render(
      <ChartFrame state="empty" emptyTitle="No procurement activity yet" emptySub="Create one.">
        <div data-testid="chart-body" />
      </ChartFrame>,
    );
    expect(screen.getByText('No procurement activity yet')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-body')).toBeNull();
  });

  it('renders an error state with a retry handler', () => {
    const onRetry = vi.fn();
    render(
      <ChartFrame state="error" errorTitle="Could not load" onRetry={onRetry}>
        <div data-testid="chart-body" />
      </ChartFrame>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('chart-body')).toBeNull();
  });

  it('renders the chart body when ready', () => {
    render(
      <ChartFrame state="ready">
        <div data-testid="chart-body" />
      </ChartFrame>,
    );
    expect(screen.getByTestId('chart-body')).toBeInTheDocument();
  });
});
