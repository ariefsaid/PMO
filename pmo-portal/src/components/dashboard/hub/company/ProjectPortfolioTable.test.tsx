import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ProjectPortfolioTable } from './ProjectPortfolioTable';
import type { ProjectPortfolioRow } from '@/src/lib/projectPortfolio';

const row = (overrides: Partial<ProjectPortfolioRow>): ProjectPortfolioRow => ({
  id: 'p1', name: 'Project A', spent: 80, actualCurrency: 'IDR', budget: 100, budgetCurrency: 'IDR',
  doneMilestones: 2, totalMilestones: 4, lateMilestones: 0, plannedPct: 60, actualPct: 50,
  ...overrides,
});

describe('ProjectPortfolioTable', () => {
  it('AC-MV-001 orders risk first, links every project, and can sort by displayed measures', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('768px'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(
      <MemoryRouter>
        <ProjectPortfolioTable
          rows={[
            row({ id: 'p1', name: 'Project A', spent: 120 }),
            row({ id: 'p2', name: 'Project B', spent: 100, lateMilestones: 1, plannedPct: 80, actualPct: 30 }),
            row({ id: 'p3', name: 'Project C', spent: 80, plannedPct: 50, actualPct: 50 }),
          ]}
          pending={false}
          error={false}
          retry={vi.fn()}
        />
      </MemoryRouter>,
    );

    const bodyRows = () => screen.getAllByRole('row').slice(1);
    expect(bodyRows().map((tr) => within(tr).getByRole('link').getAttribute('href'))).toEqual([
      '/projects/p2', '/projects/p1', '/projects/p3',
    ]);
    expect(screen.getByRole('link', { name: 'Open Project B' })).toHaveAttribute('href', '/projects/p2');
    fireEvent.click(screen.getByRole('button', { name: 'Spent' }));
    expect(bodyRows().map((tr) => within(tr).getByRole('link').getAttribute('href'))).toEqual([
      '/projects/p3', '/projects/p2', '/projects/p1',
    ]);
  });

  it('AC-MV-001 preserves loading, retryable error, and empty states', async () => {
    const retry = vi.fn();
    const { rerender } = render(
      <MemoryRouter><ProjectPortfolioTable rows={[]} pending={true} error={false} retry={retry} /></MemoryRouter>,
    );
    expect(screen.queryByText('No active delivery projects')).toBeNull();
    rerender(<MemoryRouter><ProjectPortfolioTable rows={[]} pending={false} error={true} retry={retry} /></MemoryRouter>);
    expect(screen.getByText("Couldn't load the project portfolio")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    rerender(<MemoryRouter><ProjectPortfolioTable rows={[]} pending={false} error={false} retry={retry} /></MemoryRouter>);
    expect(screen.getByText('No active delivery projects')).toBeInTheDocument();
  });
});
