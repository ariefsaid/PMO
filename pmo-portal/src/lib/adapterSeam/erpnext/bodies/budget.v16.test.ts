import { describe, expect, it } from 'vitest';
import { budgetBodiesForYear, budgetFromDoc, budgetFromDocFields, budgetToBody } from './budget.ts';
import { AdapterError } from '../../contract.ts';
import type { PmoRecord } from '../../contract.ts';
import type { ErpCtx } from '../doctypeRegistry.ts';

const V15_JSON = '{"company":"Test Co","fiscal_year":"2026","budget_against":"Project","project":"PROJ-1","accounts":[{"account":"Salary","budget_amount":"50000.00"},{"account":"COGS","budget_amount":"25000.00"}],"applicable_on_material_request":1,"applicable_on_purchase_order":1,"applicable_on_booking_actual_expenses":1,"action_if_annual_budget_exceeded":"Warn","action_if_accumulated_monthly_budget_exceeded":"Warn","action_if_annual_budget_exceeded_on_mr":"Warn","action_if_accumulated_monthly_budget_exceeded_on_mr":"Warn","action_if_annual_budget_exceeded_on_po":"Warn","action_if_accumulated_monthly_budget_exceeded_on_po":"Warn"}';
const record = {
  id: 'ver-1', fiscal_year: '2026',
  line_items: [
    { category: 'Labor', budgeted_amount: '50000.00' },
    { category: 'Materials', budgeted_amount: '25000.00' },
  ],
} as unknown as PmoRecord;
function ctx(versionMajor: 15 | 16): ErpCtx {
  return {
    versionMajor,
    refs: { project: 'PROJ-1' },
    config: {
      company: 'Test Co',
      category_account_map: [
        { category: 'Labor', erp_account: 'Salary' },
        { category: 'Materials', erp_account: 'COGS' },
      ],
      budget_applicable_on: {
        material_request: true, purchase_order: true, booking_actual_expenses: true,
      },
    },
  };
}

describe('ERP Budget v16 body contract', () => {
  it('AC-BV16-001 builds two v16 account bodies', () => {
    const bodies = budgetBodiesForYear(record, ctx(16));
    expect(bodies).toEqual([
      {
        company: 'Test Co', budget_against: 'Project', project: 'PROJ-1', account: 'Salary',
        budget_amount: 50000, from_fiscal_year: '2026', to_fiscal_year: '2026',
        distribution_frequency: 'Monthly', distribute_equally: 1,
        applicable_on_material_request: 1, applicable_on_purchase_order: 1,
        applicable_on_booking_actual_expenses: 1,
        action_if_annual_budget_exceeded: 'Warn',
        action_if_accumulated_monthly_budget_exceeded: 'Warn',
        action_if_annual_budget_exceeded_on_mr: 'Warn',
        action_if_accumulated_monthly_budget_exceeded_on_mr: 'Warn',
        action_if_annual_budget_exceeded_on_po: 'Warn',
        action_if_accumulated_monthly_budget_exceeded_on_po: 'Warn',
      },
      {
        company: 'Test Co', budget_against: 'Project', project: 'PROJ-1', account: 'COGS',
        budget_amount: 25000, from_fiscal_year: '2026', to_fiscal_year: '2026',
        distribution_frequency: 'Monthly', distribute_equally: 1,
        applicable_on_material_request: 1, applicable_on_purchase_order: 1,
        applicable_on_booking_actual_expenses: 1,
        action_if_annual_budget_exceeded: 'Warn',
        action_if_accumulated_monthly_budget_exceeded: 'Warn',
        action_if_annual_budget_exceeded_on_mr: 'Warn',
        action_if_accumulated_monthly_budget_exceeded_on_mr: 'Warn',
        action_if_annual_budget_exceeded_on_po: 'Warn',
        action_if_accumulated_monthly_budget_exceeded_on_po: 'Warn',
      },
    ]);
    for (const body of bodies) {
      expect(body).not.toHaveProperty('accounts');
      expect(body).not.toHaveProperty('fiscal_year');
    }
    expect(budgetToBody({ ...record, erp_account: 'COGS' }, ctx(16))).toEqual(bodies[1]);
    expect(() => budgetToBody({ ...record, budget_intent: 'remove' }, ctx(16))).toThrow(/remove intent/i);
  });

  it('AC-BV16-002 preserves the frozen v15 JSON bytes', () => {
    expect(JSON.stringify(budgetBodiesForYear(record, ctx(15))[0])).toBe(V15_JSON);
  });

  it('AC-BV16-003 refuses a shared non-zero account before building', () => {
    const sharedRecord = {
      ...record,
      line_items: [
        { category: 'Labor', budgeted_amount: '50000.00' },
        { category: 'Overtime', budgeted_amount: '100.00' },
      ],
    } as unknown as PmoRecord;
    const sharedCtx = {
      ...ctx(16),
      config: {
        ...ctx(16).config,
        category_account_map: [
          { category: 'Labor', erp_account: 'Salary' },
          { category: 'Overtime', erp_account: 'Salary' },
        ],
      },
    };
    try {
      budgetBodiesForYear(sharedRecord, sharedCtx);
      throw new Error('expected shared-account refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(AdapterError);
      expect((error as AdapterError).code).toBe('commit-rejected');
      expect((error as Error).message).toContain('Salary');
    }
  });

  it('maps v16 lifecycle dimensions without amounts and preserves v15 mapping shape', () => {
    expect(budgetFromDocFields(16)).toEqual([
      'name', 'modified', 'docstatus', 'amended_from', 'from_fiscal_year', 'to_fiscal_year', 'account',
    ]);
    expect(budgetFromDocFields(15)).toBeDefined();
    expect(budgetFromDocFields()).toBe(budgetFromDocFields(15));
    expect(budgetFromDoc({ name: 'BUD-1', modified: 'now', docstatus: 1, from_fiscal_year: '2026', account: 'Salary' }))
      .toEqual({
        id: 'BUD-1', erp_budget_name: 'BUD-1', erp_docstatus: 1, erp_modified: 'now',
        erp_amended_from: null, fiscal_year: '2026', erp_account: 'Salary',
      });
    expect(budgetFromDoc({ name: 'BUD-1', fiscal_year: '2026' })).toEqual({
      id: 'BUD-1', erp_budget_name: 'BUD-1', erp_docstatus: null, erp_modified: null,
      erp_amended_from: null, fiscal_year: '2026',
    });
  });
});
