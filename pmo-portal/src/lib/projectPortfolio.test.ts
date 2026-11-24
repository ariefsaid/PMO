import { describe, expect, it } from 'vitest';
import { sortPortfolioRows, type ProjectPortfolioRow } from './projectPortfolio';

const row = (overrides: Partial<ProjectPortfolioRow>): ProjectPortfolioRow => ({
  id: 'p1', name: 'Project', actualCurrency: 'IDR', spent: 80, budget: 100, budgetCurrency: 'IDR',
  doneMilestones: 2, totalMilestones: 4, lateMilestones: 0, plannedPct: 60, actualPct: 50,
  ...overrides,
});

describe('project portfolio sorting', () => {
  it('AC-MV-001 ranks the worst combined budget and schedule position first', () => {
    const rows = [
      row({ id: 'healthy', spent: 80, budget: 100, plannedPct: 40, actualPct: 40 }),
      row({ id: 'late', spent: 100, budget: 100, lateMilestones: 2, plannedPct: 80, actualPct: 30 }),
      row({ id: 'over', spent: 130, budget: 100, plannedPct: 50, actualPct: 50 }),
    ];
    expect(sortPortfolioRows(rows, { key: 'risk', dir: 'desc' }).map((item) => item.id)).toEqual(['late', 'over', 'healthy']);
  });

  it('AC-MV-001 sorts each displayed numeric measure in the requested direction and keeps unknowns last', () => {
    const rows = [
      row({ id: 'missing', spent: null, budget: null, actualCurrency: null, budgetCurrency: null, doneMilestones: null, totalMilestones: null, lateMilestones: null, plannedPct: null, actualPct: null }),
      row({ id: 'a', spent: 20, budget: 100, doneMilestones: 1, lateMilestones: 2, plannedPct: 60, actualPct: 40 }),
      row({ id: 'b', spent: 90, budget: 200, doneMilestones: 4, lateMilestones: 0, plannedPct: 20, actualPct: 60 }),
    ];
    expect(sortPortfolioRows(rows, { key: 'spent', dir: 'desc' }).map((item) => item.id)).toEqual(['b', 'a', 'missing']);
    expect(sortPortfolioRows(rows, { key: 'budget', dir: 'desc' }).map((item) => item.id)).toEqual(['b', 'a', 'missing']);
    expect(sortPortfolioRows(rows, { key: 'doneMilestones', dir: 'desc' }).map((item) => item.id)).toEqual(['b', 'a', 'missing']);
    expect(sortPortfolioRows(rows, { key: 'lateMilestones', dir: 'asc' }).map((item) => item.id)).toEqual(['b', 'a', 'missing']);
    expect(sortPortfolioRows(rows, { key: 'plannedPct', dir: 'asc' }).map((item) => item.id)).toEqual(['b', 'a', 'missing']);
    expect(sortPortfolioRows(rows, { key: 'actualPct', dir: 'asc' }).map((item) => item.id)).toEqual(['a', 'b', 'missing']);
  });
});
