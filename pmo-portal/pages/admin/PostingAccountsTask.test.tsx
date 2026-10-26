import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import PostingAccountsTask from './PostingAccountsTask';

vi.mock('./BudgetAccountMap', () => ({
  default: ({ filters }: { filters: unknown }) => <div data-testid="budget-filters">{JSON.stringify(filters)}</div>,
}));
vi.mock('./ExpenseAccountMap', () => ({
  default: ({ filters }: { filters: unknown }) => <div data-testid="expense-filters">{JSON.stringify(filters)}</div>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const Location = () => {
  const location = useLocation();
  return <output data-testid="location">{location.search}{location.hash}</output>;
};

describe('PostingAccountsTask toolbar (AC-ADMIA-017)', () => {
  it('restores URL filters and sorts within the selected purpose while retaining unrelated query state', () => {
    render(
      <MemoryRouter initialEntries={['/administration/accounting?keep=1&posting_search=travel&posting_purpose=expense&posting_coverage=needs-setup&posting_sort=desc#posting-accounts']}>
        <PostingAccountsTask />
        <Location />
      </MemoryRouter>,
    );

    expect(screen.getByRole('searchbox', { name: 'Search posting accounts' })).toHaveValue('travel');
    expect(screen.queryByTestId('budget-filters')).not.toBeInTheDocument();
    expect(screen.getByTestId('expense-filters')).toHaveTextContent('"purpose":"expense"');
    expect(screen.getByTestId('expense-filters')).toHaveTextContent('"coverage":"needs-setup"');
    expect(screen.getByTestId('expense-filters')).toHaveTextContent('"sort":"desc"');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search posting accounts' }), { target: { value: 'meal' } });
    expect(screen.getByTestId('location')).toHaveTextContent('keep=1');
    expect(screen.getByTestId('location')).toHaveTextContent('posting_search=meal');
    expect(screen.getByTestId('location')).toHaveTextContent('#posting-accounts');
  });

  it('clears search, coverage, purpose, and sort together', () => {
    render(
      <MemoryRouter initialEntries={['/administration/accounting?keep=1&posting_search=missing&posting_coverage=needs-setup&posting_sort=desc']}>
        <PostingAccountsTask />
        <Location />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByTestId('location')).toHaveTextContent('?keep=1');
    expect(screen.getByRole('searchbox', { name: 'Search posting accounts' })).toHaveValue('');
  });
});
