/**
 * #2249 item 4: the header's "Budget used" and the Budget tab card read the same value through the same reader.
 * A USD budget against rupiah spending at a known rate reads "≈ 50%" in both; with no rate both read "—".
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const h = vi.hoisted(() => ({ rate: { status: 'ready', match: { rate: 18500, rate_date: '2026-11-14' } } as { status: string; match?: unknown } }));

vi.mock('@/src/hooks/useFxIdrRate', () => ({ useFxIdrRate: () => h.rate }));
vi.mock('@/src/hooks/useProjectBudgetPositions', () => ({
  useProjectBudgetPositions: () => ({
    data: { p1: { projectId: 'p1', ledgerBasis: 'erp', currency: 'IDR', budgetCurrency: 'USD', activeBudgetAmount: '6000.00', spent: '55500000', openCommitment: '0', consumption: null, complete: true, usedRatio: null, usedPercent: null } },
  }),
}));

import { ProjectBudgetFigures } from '../ProjectBudgetFigures';

const project = { id: 'p1', currency: 'USD' } as ProjectWithRefs;

beforeEach(() => { h.rate = { status: 'ready', match: { rate: 18500, rate_date: '2026-11-14' } }; });

describe('AC-ODA-024 header and card share one Budget-used reader (#2249)', () => {
  it('shows the approximate figure the card shows when it is known', () => {
    render(<ProjectBudgetFigures project={project} />);
    expect(screen.getByTestId('project-budget-figures')).toHaveTextContent('Budget used ≈ 50%');
  });

  it('reads — when it is unknown', () => {
    h.rate = { status: 'none' };
    render(<ProjectBudgetFigures project={project} />);
    expect(screen.getByTestId('project-budget-figures')).toHaveTextContent('Budget used —');
  });
});
