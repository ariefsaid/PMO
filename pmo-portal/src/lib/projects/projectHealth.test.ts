import { describe, expect, it } from 'vitest';
import type { ProjectMoneyRead } from '@/src/lib/db/projectMoney';
import { projectBudgetUsed, projectLateDays, projectOverBudget } from './projectHealth';

const money = (overrides: Partial<ProjectMoneyRead> = {}, used = '50'): ProjectMoneyRead => ({
  ledgerBasis: 'pmo',
  actuals: { currency: 'USD', total: '500', asOf: null, excludesRestrictedRows: false, categories: [] },
  activeBudgetAmount: '1000', activeBudgetCurrency: 'USD', hasActiveBudget: true,
  budgetPosition: { projectId: 'p', ledgerBasis: 'pmo', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '1000',
    spent: String(Number(used) * 10), openCommitment: '0', consumption: String(Number(used) * 10), complete: true,
    usedRatio: String(Number(used) / 100), usedPercent: used, consumptionVariance: '0', riskEligible: true, atRisk: false },
  ...overrides,
});

describe('projectLateDays', () => {
  it('counts whole days past the end date for an open project', () => {
    expect(projectLateDays({ status: 'Ongoing Project', end_date: '2026-11-10' }, '2026-11-15')).toBe(5);
  });
  it('is null on or before the end date, without one, and for closed or lost projects', () => {
    expect(projectLateDays({ status: 'Ongoing Project', end_date: '2026-11-15' }, '2026-11-15')).toBeNull();
    expect(projectLateDays({ status: 'Ongoing Project', end_date: null }, '2026-11-15')).toBeNull();
    expect(projectLateDays({ status: 'Close Out', end_date: '2026-01-01' }, '2026-11-15')).toBeNull();
    expect(projectLateDays({ status: 'Loss Tender', end_date: '2026-01-01' }, '2026-11-15')).toBeNull();
  });
});

describe('projectBudgetUsed / projectOverBudget', () => {
  it('reads the shared percent for a same-currency Active budget', () => {
    expect(projectBudgetUsed({ currency: 'USD' }, money())).toBe(50);
    expect(projectOverBudget({ currency: 'USD' }, money())).toBe(false);
    expect(projectOverBudget({ currency: 'USD' }, money({}, '110'))).toBe(true);
  });
  it('states nothing without an Active budget, with a zero budget or across currencies', () => {
    expect(projectBudgetUsed({ currency: 'USD' }, money({ hasActiveBudget: false }))).toBeNull();
    expect(projectBudgetUsed({ currency: 'USD' }, money({ activeBudgetAmount: '0' }))).toBeNull();
    expect(projectBudgetUsed({ currency: 'IDR' }, money())).toBeNull();
    expect(projectOverBudget({ currency: 'USD' }, undefined)).toBe(false);
  });
});
