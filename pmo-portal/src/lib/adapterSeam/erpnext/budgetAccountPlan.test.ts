import { describe, expect, it } from 'vitest';
import { AdapterError } from '../contract';
import { BudgetCategoryUnmappedError, type BudgetLineItem, type CategoryAccountMapRow } from '../../budget/categoryAccountMap';
import { resolveV16BudgetAccounts } from './budgetAccountPlan';

const map: CategoryAccountMapRow[] = [
  { category: 'Labor', erp_account: 'Salary' },
  { category: 'Overtime', erp_account: 'Salary' },
  { category: 'Materials', erp_account: 'COGS' },
];

describe('resolveV16BudgetAccounts', () => {
  it('aggregates repeated lines within a category and rejects shared non-zero category accounts', () => {
    const laborLines: BudgetLineItem[] = [
      { category: 'Labor', budgeted_amount: '10.00' },
      { category: 'Labor', budgeted_amount: '20.50' },
    ];
    expect(resolveV16BudgetAccounts(laborLines, map)).toEqual([
      { account: 'Salary', budget_amount: '30.50' },
    ]);

    const shared: BudgetLineItem[] = [
      { category: 'Labor', budgeted_amount: '10.00' },
      { category: 'Overtime', budgeted_amount: '20.00' },
    ];
    try {
      resolveV16BudgetAccounts(shared, map);
      throw new Error('expected shared account refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(AdapterError);
      expect((error as AdapterError).code).toBe('commit-rejected');
      expect((error as Error).message).toContain('Salary');
    }
  });

  it('ignores a zero-total category for account collision and preserves unmapped failures', () => {
    expect(resolveV16BudgetAccounts([
      { category: 'Labor', budgeted_amount: '10.00' },
      { category: 'Overtime', budgeted_amount: '10.00' },
      { category: 'Overtime', budgeted_amount: '-10.00' },
    ], map)).toEqual([{ account: 'Salary', budget_amount: '10.00' }]);
    expect(() => resolveV16BudgetAccounts([
      { category: 'Travel', budgeted_amount: '1.00' },
    ], map)).toThrow(BudgetCategoryUnmappedError);
  });
});
