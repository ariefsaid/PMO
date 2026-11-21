import { describe, expect, it } from 'vitest';
import { budgetUsedFigure } from './budgetUsed';

const reading = (over: Record<string, unknown> = {}) => ({
  projectId: 'p', ledgerBasis: 'erp', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '100.00', spent: '50.00',
  openCommitment: '0', consumption: null, complete: true, usedRatio: null, usedPercent: null, ...over,
}) as never;

describe('AC-ODA-024 budgetUsedFigure, the one Budget-used reader (#2249)', () => {
  it('is exact in the project currency', () => {
    expect(budgetUsedFigure(reading(), 'USD', null)).toEqual({ percent: 50, approximate: false, value: '50%' });
  });
  it('is approximate across currencies at a rate, and unknown without one', () => {
    const cross = reading({ currency: 'IDR', spent: '55500000', activeBudgetAmount: '6000.00' });
    expect(budgetUsedFigure(cross, 'USD', 18500).value).toBe('≈ 50%');
    expect(budgetUsedFigure(cross, 'USD', null).value).toBeNull();
  });
  it('is unknown without a position', () => {
    expect(budgetUsedFigure(undefined, 'USD', 18500).value).toBeNull();
  });
});
