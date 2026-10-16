import { describe, expect, it } from 'vitest';
import { AdapterError } from '../contract';
import { BudgetCategoryUnmappedError, type BudgetLineItem, type CategoryAccountMapRow } from '../../budget/categoryAccountMap';
import { planBudgetAccountIntents, resolveV16BudgetAccounts } from './budgetAccountPlan';

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

describe('planBudgetAccountIntents', () => {
  const desired = [
    { account: 'Salary', budget_amount: '60000.00' },
    { account: 'COGS', budget_amount: '25000.00' },
    { account: 'Equipment', budget_amount: '10000.00' },
  ];
  const prior = [
    { fiscalYear: '2026', erpAccount: 'Salary', erpBudgetName: 'B-SAL', cancelledAt: null },
    { fiscalYear: '2026', erpAccount: 'COGS', erpBudgetName: 'B-COGS', cancelledAt: null },
    { fiscalYear: '2026', erpAccount: 'Travel', erpBudgetName: 'B-TRAVEL', cancelledAt: null },
  ];

  it('plans desired account ensures and removes dropped live accounts', () => {
    expect(planBudgetAccountIntents('2026', desired, prior)).toEqual([
      { fiscalYear: '2026', erpAccount: 'Salary', intent: 'ensure', amount: '60000.00', predecessor: null },
      { fiscalYear: '2026', erpAccount: 'COGS', intent: 'ensure', amount: '25000.00', predecessor: null },
      { fiscalYear: '2026', erpAccount: 'Equipment', intent: 'ensure', amount: '10000.00', predecessor: null },
      { fiscalYear: '2026', erpAccount: 'Travel', intent: 'remove', amount: null, predecessor: 'B-TRAVEL' },
    ]);
  });

  it('does not schedule Desk-tombstoned history, deduplicates identical history, and refuses conflicting live predecessors', () => {
    const history = [
      ...prior,
      prior[2],
      { ...prior[0], erpAccount: 'Archived', erpBudgetName: 'B-ARCHIVED', cancelledAt: '2026-10-01T00:00:00Z' },
    ];
    expect(planBudgetAccountIntents('2026', [], history)).toEqual([
      { fiscalYear: '2026', erpAccount: 'Salary', intent: 'remove', amount: null, predecessor: 'B-SAL' },
      { fiscalYear: '2026', erpAccount: 'COGS', intent: 'remove', amount: null, predecessor: 'B-COGS' },
      { fiscalYear: '2026', erpAccount: 'Travel', intent: 'remove', amount: null, predecessor: 'B-TRAVEL' },
    ]);
    expect(() => planBudgetAccountIntents('2026', [], [
      prior[2], { ...prior[2], erpBudgetName: 'B-TRAVEL-2' },
    ])).toThrow(/conflicting live predecessor.*Travel/i);
  });
});
