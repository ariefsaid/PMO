import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

const { projectQuery } = vi.hoisted(() => ({ projectQuery: { data: null as unknown, isPending: false, isError: false, refetch: vi.fn() } }));

vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => projectQuery }));
vi.mock('@/src/hooks/useBudget', () => ({ useBudgetVersions: () => ({ data: [{ status: 'Active' }] }) }));
vi.mock('@/src/hooks/useErpnextBinding', () => ({ useErpnextBinding: () => ({ data: { status: 'active' } }) }));
vi.mock('../../ProjectBudget', () => ({
  default: ({ projectId, project }: { projectId: string; project: { currency: string } }) => (
    <div data-testid="pmo-budget">{projectId} · {project.currency}</div>
  ),
}));

import BudgetTab from './BudgetTab';

describe('BudgetTab', () => {
  it('passes the project context to the budget view without mounting forecast surfaces', () => {
    projectQuery.data = { id: 'p-1', currency: 'USD' };

    render(<BudgetTab projectId="p-1" />);

    expect(screen.getByTestId('pmo-budget')).toHaveTextContent('p-1 · USD');
    expect(screen.queryByText(/forecast|cost-to-finish|attributed spending/i)).not.toBeInTheDocument();
  });

  it('shows a loading state until the project context is available', () => {
    projectQuery.data = null;
    projectQuery.isPending = true;

    render(<BudgetTab projectId="p-1" />);

    expect(screen.getByTestId('budget-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('pmo-budget')).not.toBeInTheDocument();
    projectQuery.isPending = false;
  });
});
