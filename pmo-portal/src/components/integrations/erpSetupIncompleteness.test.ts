import { describe, expect, it } from 'vitest';
import type { ErpSetupReadiness } from '@/src/lib/repositories/types';
import { getErpSetupIncompleteness, missingAccountCategories, requiredBudgetCategories, fiscalYearOperatorTask } from './erpSetupIncompleteness';

const ORIGINAL_EIGHT = ['Labor', 'Materials', 'Subcontractors', 'Equipment', 'Permits & Fees', 'Overheads', 'Contingency', 'Special expenses'];

const setup = (over: Partial<ErpSetupReadiness> = {}): ErpSetupReadiness => ({
  defaults: {}, domains: ['companies'], unmappedProjects: [], budgetMappedCategories: [...ORIGINAL_EIGHT],
  unlinkedEmployeeCount: 0, ...over,
});

describe('getErpSetupIncompleteness — budget (#1326)', () => {
  it('AC-TVC-002 an org with no Travel & accommodation or Vehicle lines is complete once the original eight are mapped', () => {
    expect(getErpSetupIncompleteness(setup()).budget).toBe(false);
    expect(getErpSetupIncompleteness(setup({ budgetUsedOptionalCategories: [] })).budget).toBe(false);
    expect(requiredBudgetCategories(setup())).toEqual(ORIGINAL_EIGHT);
  });

  it('AC-TVC-002 an org with Vehicle budget lines is incomplete until Vehicle is mapped', () => {
    const used = setup({ budgetUsedOptionalCategories: ['Vehicle'] });
    expect(getErpSetupIncompleteness(used).budget).toBe(true);
    expect(requiredBudgetCategories(used)).toEqual([...ORIGINAL_EIGHT, 'Vehicle']);
    expect(getErpSetupIncompleteness(setup({
      budgetUsedOptionalCategories: ['Vehicle'], budgetMappedCategories: [...ORIGINAL_EIGHT, 'Vehicle'],
    })).budget).toBe(false);
  });

  it('a missing original category is still incomplete, whatever the optional ones', () => {
    expect(getErpSetupIncompleteness(setup({ budgetMappedCategories: ORIGINAL_EIGHT.slice(1) })).budget).toBe(true);
  });
});

describe('FR-ECA-020 missingAccountCategories', () => {
  it('FR-ECA-020 a category with no direct-cost account is a setup task for the operator', () => {
    expect(missingAccountCategories(setup({ budgetMappedCategories: ORIGINAL_EIGHT.filter((c) => c !== 'Labor' && c !== 'Equipment') }))).toEqual(['Labor', 'Equipment']);
  });
  it('every required category linked: no task', () => {
    expect(missingAccountCategories(setup())).toEqual([]);
  });
  it('an optional category nobody budgets in is not a task; once budgeted it is', () => {
    expect(missingAccountCategories(setup({ budgetMappedCategories: ORIGINAL_EIGHT }))).toEqual([]);
    expect(missingAccountCategories(setup({ budgetUsedOptionalCategories: ['Vehicle'] }))).toEqual(['Vehicle']);
  });
});

describe('#1599 ECX-5 fiscalYearOperatorTask', () => {
  it('returns null when fiscalYear is null, undefined, ready, or not-due', () => {
    expect(fiscalYearOperatorTask(setup({ fiscalYear: null }))).toBeNull();
    expect(fiscalYearOperatorTask(setup({ fiscalYear: undefined }))).toBeNull();
    expect(fiscalYearOperatorTask(setup({ fiscalYear: { state: 'ready', next: '2027' } }))).toBeNull();
    expect(fiscalYearOperatorTask(setup({ fiscalYear: { state: 'not-due' } }))).toBeNull();
  });

  it('maps needs-operator states to their corresponding operator task kinds', () => {
    expect(fiscalYearOperatorTask(setup({ fiscalYear: { state: 'needs-operator', reason: 'missing-role' } }))).toEqual({
      kind: 'missing-role',
    });
    expect(fiscalYearOperatorTask(setup({ fiscalYear: { state: 'needs-operator', reason: 'no-current-year' } }))).toEqual({
      kind: 'no-current-year',
    });
    expect(fiscalYearOperatorTask(setup({ fiscalYear: { state: 'needs-operator', reason: 'disabled-year', year: '2027' } }))).toEqual({
      kind: 'disabled-year',
      year: '2027',
    });
    expect(fiscalYearOperatorTask(setup({ fiscalYear: { state: 'needs-operator', reason: 'held', intentId: 'intent-uuid-1' } }))).toEqual({
      kind: 'held',
      intentId: 'intent-uuid-1',
    });
  });

  it('maps refused state to refused kind with reason or null', () => {
    expect(fiscalYearOperatorTask(setup({ fiscalYear: { state: 'refused', message: 'Permission denied' } }))).toEqual({
      kind: 'refused',
      reason: 'Permission denied',
    });
    expect(fiscalYearOperatorTask(setup({ fiscalYear: { state: 'refused', message: null } }))).toEqual({
      kind: 'refused',
      reason: null,
    });
  });

  it('fiscal-year operator tasks are never client steps and do not count toward setup incompleteness', () => {
    const completeDefaults = {
      company: 'Example Co',
      default_payable_account: 'Creditors',
      default_expense_account: 'COGS',
      default_cash_account: 'Cash',
      default_bank_account: 'Bank',
      cost_center: 'Main',
      default_activity_type: 'Delivery',
      default_receivable_account: 'Debtors',
    };
    const s = setup({
      defaults: completeDefaults,
      fiscalYear: { state: 'needs-operator', reason: 'missing-role' },
    });
    const inc = getErpSetupIncompleteness(s);
    expect(Object.values(inc).some(Boolean)).toBe(false);
    expect((inc as Record<string, unknown>).fiscalYear).toBeUndefined();
  });
});
