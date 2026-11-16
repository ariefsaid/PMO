import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChartCard } from './charts';

describe('ChartCard: a failed read is recovered where it failed', () => {
  it('the failed cell says what failed once and Retry re-runs its read', () => {
    const retry = vi.fn();
    render(
      <ChartCard title="Owed by clients, by age" error={{ title: "Couldn't load overdue invoices", retry }} skeleton={{ shape: 'bars', rows: 4 }}>
        <div>chart</div>
      </ChartCard>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load overdue invoices");
    expect(screen.queryByText('chart')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('the owning cell keeps the one error with its Retry', () => {
    render(
      <ChartCard title="Invoiced" error={{ title: "Couldn't load the invoiced trend", retry: vi.fn() }}>
        <div>chart</div>
      </ChartCard>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the invoiced trend");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
