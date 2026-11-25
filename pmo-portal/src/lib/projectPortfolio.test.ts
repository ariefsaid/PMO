import { describe, expect, it } from 'vitest';
import { packMoneyByProject, sortPortfolioRows, type ProjectPortfolioRow } from './projectPortfolio';
import type { ManagementPack } from './reports/managementPack';

const row = (overrides: Partial<ProjectPortfolioRow>): ProjectPortfolioRow => ({
  id: 'p1', name: 'Project', actualCurrency: 'IDR', spent: 80, budget: 100, budgetCurrency: 'IDR',
  doneMilestones: 2, totalMilestones: 4, lateMilestones: 0, plannedPct: 60, actualPct: 50,
  contractValue: null, billed: null, contractCurrency: null,
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

describe('packMoneyByProject', () => {
  it('TC-M-10 reads contract value and invoiced-to-date from the management pack at its latest month, in whole units', () => {
    const pack = {
      months: ['2026-10-01', '2026-11-01'],
      rows: [
        { kind: 'contract', projectId: 'p1', currency: 'USD', contractNet: 30000000, months: [{ month: '2026-10-01', invoicedToDate: 1 }, { month: '2026-11-01', invoicedToDate: 10000000 }] },
        { kind: 'contract', projectId: 'p2', currency: 'USD', contractNet: null, months: [{ month: '2026-11-01', invoicedToDate: 5000000 }] },
        { kind: 'other', projectId: null, currency: 'USD', contractNet: null, months: [] },
      ],
    } as unknown as ManagementPack;
    expect(packMoneyByProject(undefined)).toEqual({});
    expect(packMoneyByProject(pack)).toEqual({
      p1: { contractValue: 300000, billed: 100000, currency: 'USD' },
      p2: { contractValue: null, billed: 50000, currency: 'USD' },
    });
  });
});
