import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChartCard } from './charts';

describe('ChartCard: one failing read is one message', () => {
  it('a cell whose read is owned by another panel links to that panel instead of drawing a second error', () => {
    render(
      <ChartCard title="Owed by clients, by age" error={{ title: "Couldn't load overdue invoices", retry: vi.fn() }} errorSeeOwner={{ label: 'Client overdue', href: '#client-overdue' }}>
        <div>chart</div>
      </ChartCard>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Client overdue/ })).toHaveAttribute('href', '#client-overdue');
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
