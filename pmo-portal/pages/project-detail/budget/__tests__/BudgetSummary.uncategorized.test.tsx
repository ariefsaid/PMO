// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';
import BudgetSummary from '../BudgetSummary';

const version = {
  id: 'v1', status: 'Active',
  line_items: [
    { id: 'l1', category: 'Labor', description: 'Crew', budgeted_amount: 1000 },
    { id: 'l2', category: 'Materials', description: 'Steel', budgeted_amount: 1000 },
  ],
} as unknown as BudgetVersionWithItems;

const position = (uncategorized: { amount: number | null } | null) => ({
  actualsPending: false, actualsError: false, refetchActuals: () => undefined, canSeeActual: true, unknown: 0,
  rows: [{ category: 'Labor', budget: 1000, actual: 100 }, { category: 'Materials', budget: 1000, actual: 500 }],
  uncategorized,
});

const renderSummary = (uncategorized: { amount: number | null } | null) => render(
  <MemoryRouter>
    <BudgetSummary project={{ id: 'p1', currency: 'USD' } as unknown as ProjectWithRefs} activeVersion={version}
      position={position(uncategorized)} procurements={[]} canReadProcurements canManageAccounting={false} />
  </MemoryRouter>,
);

describe('BudgetSummary with paid spending that has no budget category', () => {
  it('AC-2330-005 never reads the sum of the categories as what was spent, and says why', () => {
    renderSummary({ amount: 50 });
    expect(screen.queryByText(/Spent 600 of/)).not.toBeInTheDocument();
    expect(screen.getByTestId('budget-answer')).toHaveTextContent(/^Budget 2,000$/);
    expect(screen.getByText('50 paid has no budget category, so it is not in any category.')).toBeInTheDocument();
  });

  it('AC-2330-005 states the reason when the uncategorized amount itself is unknown', () => {
    renderSummary({ amount: null });
    expect(screen.queryByText(/Spent 600 of/)).not.toBeInTheDocument();
    expect(screen.getByText('Some paid spending has no budget category, so it is not in any category.')).toBeInTheDocument();
  });

  it('AC-2330-005 reads the categories as the total when every paid purchase has a category', () => {
    renderSummary(null);
    expect(screen.getByText('Spent 600 of 2,000')).toBeInTheDocument();
  });
});
