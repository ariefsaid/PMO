import { describe, expect, it } from 'vitest';
import type { ErpSetupReadiness } from '@/src/lib/repositories/types';
import { getErpSetupIncompleteness, requiredBudgetCategories } from './erpSetupIncompleteness';

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
