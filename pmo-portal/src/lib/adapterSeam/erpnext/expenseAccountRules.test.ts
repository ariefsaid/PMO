import { describe, expect, it } from 'vitest';
import { EXPENSE_ACCOUNT_KEYS, expenseAccountProblem, isExpenseAccountKey, type ErpAccountFacts } from './expenseAccountRules';

const ctx = { company: 'PMO Smoke Co', companyCurrency: 'IDR', defaultPayableAccount: 'Creditors - PSC' };
const acct = (over: Partial<ErpAccountFacts>): ErpAccountFacts =>
  ({ name: 'X - PSC', root_type: 'Expense', account_type: '', is_group: 0, disabled: 0, company: 'PMO Smoke Co', account_currency: 'IDR', ...over });

describe('expenseAccountProblem (AC-EXP-118)', () => {
  it('AC-EXP-118 accepts the spike accounts', () => {
    expect(expenseAccountProblem('employee_payable', acct({ name: 'Spike Employee Payable - PSC', root_type: 'Liability', account_type: 'Payable' }), ctx)).toBeNull();
    expect(expenseAccountProblem('employee_advance', acct({ name: 'Employee Advances - PSC', root_type: 'Asset', account_type: 'Payable' }), ctx)).toBeNull();
    expect(expenseAccountProblem('Travel', acct({ name: 'Travel Expenses - PSC' }), ctx)).toBeNull();
  });

  it('AC-EXP-118 refuses the supplier payable account (Creditors) as employee payable', () => {
    expect(expenseAccountProblem('employee_payable', acct({ name: 'Creditors - PSC', root_type: 'Liability', account_type: 'Payable' }), ctx))
      .toMatch(/supplier payable/);
    expect(expenseAccountProblem('employee_payable', acct({ name: 'Any - PSC', root_type: 'Liability', account_type: 'Payable' }),
      { ...ctx, defaultPayableAccount: null })).toMatch(/cannot confirm/);
  });

  it('AC-EXP-118 refuses an untyped advance account and wrong root types', () => {
    expect(expenseAccountProblem('employee_advance', acct({ root_type: 'Asset', account_type: '' }), ctx)).toMatch(/Asset account of type Payable/);
    expect(expenseAccountProblem('employee_payable', acct({ root_type: 'Liability', account_type: '' }), ctx)).toMatch(/Liability account of type Payable/);
    expect(expenseAccountProblem('Meals', acct({ root_type: 'Asset' }), ctx)).toMatch(/Expense account/);
  });

  it('AC-EXP-118 refuses a missing, group, disabled, other-company or foreign-currency account', () => {
    expect(expenseAccountProblem('Travel', null, ctx)).toMatch(/does not exist/);
    expect(expenseAccountProblem('Travel', acct({ is_group: 1 }), ctx)).toMatch(/group/);
    expect(expenseAccountProblem('Travel', acct({ disabled: 1 }), ctx)).toMatch(/disabled/);
    expect(expenseAccountProblem('Travel', acct({ company: 'Other Co' }), ctx)).toMatch(/another company/);
    expect(expenseAccountProblem('Travel', acct({ account_currency: 'USD' }), ctx)).toMatch(/USD/);
  });

  it('AC-EXP-118 the keys are the two party keys plus every expense type', () => {
    expect(EXPENSE_ACCOUNT_KEYS).toEqual(['employee_payable', 'employee_advance', 'Travel', 'Accommodation', 'Meals', 'Local transport', 'Other']);
    expect(isExpenseAccountKey('Meals')).toBe(true);
    expect(isExpenseAccountKey('Bogus')).toBe(false);
  });
});
