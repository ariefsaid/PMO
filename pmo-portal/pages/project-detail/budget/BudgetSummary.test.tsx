import React from 'react';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { renderWithQueryClient } from '@/test/renderWithQueryClient';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';
import BudgetSummary from './BudgetSummary';

const project = { id: 'p1', name: 'Primary', currency: 'USD' } as ProjectWithRefs;
const activeVersion = {
  id: 'v1', project_id: 'p1', name: 'Active', version: 1, status: 'Active', currency: 'USD',
  line_items: [{ id: 'line-1', category: 'Labor', description: 'Work', budgeted_amount: '1000' }],
} as unknown as BudgetVersionWithItems;

describe('BudgetSummary', () => {
  it('shows the S03 project total when category allocation is unknown', () => {
    renderWithQueryClient(
      <MemoryRouter>
        <BudgetSummary
          project={project}
          activeVersion={activeVersion}
          position={{
            actualsPending: false,
            actualsError: false,
            refetchActuals: () => undefined,
            rows: [{ category: 'Labor', budget: 1000, actual: null }],
            ledgerBasis: 'pmo',
            spent: 500,
            usedPercent: 90,
            consumptionVariance: '-100',
            budgetComparisonKnown: true,
            canSeeActual: true,
            unknown: 1,
          }}
          procurements={[]}
          canReadProcurements={true}
          canManageAccounting={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('100 left after open orders')).toBeInTheDocument();
    expect(screen.getByText('Budget used before tax: 90%')).toBeInTheDocument();
    expect(screen.getByText('Spent 500 of 1,000 before tax')).toBeInTheDocument();
    expect(screen.getByText('Project spending is known; some category amounts are not mapped.')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Committed' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Labor/u })).not.toHaveTextContent('500');
  });
});
