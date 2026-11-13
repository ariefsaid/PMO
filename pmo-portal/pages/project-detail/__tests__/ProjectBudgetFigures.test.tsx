import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const h = vi.hoisted(() => ({ position: undefined as unknown }));

vi.mock('@/src/hooks/useProjectBudgetPositions', () => ({
  useProjectBudgetPositions: () => ({ data: h.position ? { p1: h.position } : {} }),
}));

import { ProjectBudgetFigures } from '../ProjectBudgetFigures';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';

const project = { id: 'p1', currency: 'USD' } as ProjectWithRefs;
const position = (ledgerBasis: 'pmo' | 'erp' = 'pmo') => ({
  projectId: 'p1', ledgerBasis, currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '100.00',
  spent: '50.00', openCommitment: '40.00', consumption: '90.00', complete: true, usedRatio: '0.9', usedPercent: '90',
});

beforeEach(() => {
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  h.position = position();
});

describe('ProjectBudgetFigures', () => {
  it('AC-S04: shows canonical budget use before tax and labels spending as a separate measure', () => {
    render(<ProjectBudgetFigures project={project} />);

    const figures = screen.getByRole('group', { name: 'Budget figures' });
    expect(figures).toHaveTextContent('Budget used before tax');
    expect(figures).toHaveTextContent('90%');
    expect(figures).toHaveTextContent('Spent (% of budget before tax)');
    expect(figures).toHaveTextContent('50%');
    expect(figures).toHaveAccessibleDescription('Spent + open orders, before tax. Spending share of budget, before tax');
  });

  it('keeps missing project budget figures unavailable instead of rendering zero', () => {
    h.position = undefined;
    render(<ProjectBudgetFigures project={project} />);

    expect(screen.queryByTestId('project-budget-figures')).not.toBeInTheDocument();
    expect(screen.queryByText(/0%/)).not.toBeInTheDocument();
  });

  it('names the before-tax ledger basis when commitments are unavailable', () => {
    h.position = position('erp');
    render(<ProjectBudgetFigures project={project} />);

    expect(screen.getByRole('group', { name: 'Budget figures' })).toHaveAccessibleDescription(
      'Ledger spending, before tax. Spending share of budget, before tax',
    );
  });
});
