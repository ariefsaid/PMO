import { describe, expect, it } from 'vitest';
import { budgetFromDoc, budgetFromDocFields, budgetToBody } from './budget.ts';
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
const rangeRecord = {
  id: 'ver-range',
  budget_mode: 'whole_project',
  fiscal_year: 'FY27',
  to_fiscal_year: 'FY28',
  project_start_date: '2028-02-28',
  project_end_date: '2028-03-01',
  line_items: [
    { category: 'Labor', budgeted_amount: '100.01' },
    { category: 'Materials', budgeted_amount: '0.10' },
  ],
  fiscal_years: [
    { name: 'FY27', start: '2027-03-01', end: '2028-02-29' },
    { name: 'FY28', start: '2028-03-01', end: '2029-02-28' },
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
  it('AC-BV16-001 builds one v16 account body per account-selected record (the live dispatch shape)', () => {
    const salary = budgetToBody({ ...record, erp_account: 'Salary' }, ctx(16)) as Record<string, unknown>;
    const cogs = budgetToBody({ ...record, erp_account: 'COGS' }, ctx(16)) as Record<string, unknown>;
    const bodies = [salary, cogs];
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

  it('AC-009 builds exact yearly range bodies per account with dated zero rows and existing controls', () => {
    const salary = budgetToBody({
      ...rangeRecord,
      erp_account: 'Salary',
      year_amounts: [{ year: 'FY27', amount: '50.01' }, { year: 'FY28', amount: '50.00' }],
    }, ctx(16)) as Record<string, unknown>;
    const cogs = budgetToBody({
      ...rangeRecord,
      erp_account: 'COGS',
      year_amounts: [{ year: 'FY27', amount: '0.10' }, { year: 'FY28', amount: '0.00' }],
    }, ctx(16)) as Record<string, unknown>;

    expect(salary).toMatchObject({
      company: 'Test Co', budget_against: 'Project', project: 'PROJ-1', account: 'Salary',
      budget_amount: 100.01, from_fiscal_year: 'FY27', to_fiscal_year: 'FY28',
      distribution_frequency: 'Yearly', distribute_equally: 0,
      budget_distribution: [
        { start_date: '2027-03-01', end_date: '2028-02-29', amount: 50.01, percent: 50.005 },
        { start_date: '2028-03-01', end_date: '2029-02-28', amount: 50, percent: 49.995 },
      ],
      applicable_on_material_request: 1, applicable_on_purchase_order: 1, applicable_on_booking_actual_expenses: 1,
      action_if_annual_budget_exceeded: 'Warn',
      action_if_accumulated_monthly_budget_exceeded: 'Warn',
      action_if_annual_budget_exceeded_on_mr: 'Warn',
      action_if_accumulated_monthly_budget_exceeded_on_mr: 'Warn',
      action_if_annual_budget_exceeded_on_po: 'Warn',
      action_if_accumulated_monthly_budget_exceeded_on_po: 'Warn',
    });
    expect(cogs).toMatchObject({
      budget_amount: 0.1,
      budget_distribution: [
        { start_date: '2027-03-01', end_date: '2028-02-29', amount: 0.1, percent: 100 },
        { start_date: '2028-03-01', end_date: '2029-02-28', amount: 0, percent: 0 },
      ],
    });
    expect(salary.distribution_frequency).not.toBe('Monthly');
    const salaryRows = salary.budget_distribution as Array<Record<string, number>>;
    const salaryTotalCents = salaryRows.reduce((sum, row) => sum + BigInt(Math.round(row.amount * 100)), 0n);
    expect(salaryTotalCents).toBe(10001n);
    expect(Number(salaryTotalCents) / 100).toBe(salary.budget_amount);
    expect((cogs.budget_distribution as Array<Record<string, number>>).map((row) => row.amount)).toEqual([0.1, 0]);
  });

  it('AC-009 refuses malformed, negative, duplicate, missing, and unreconciled range rows before producing a body', () => {
    const bodyFor = (overrides: Record<string, unknown>) => budgetToBody({
      ...rangeRecord,
      erp_account: 'Salary',
      year_amounts: [{ year: 'FY27', amount: '50.01' }, { year: 'FY28', amount: '50.00' }],
      ...overrides,
    } as unknown as PmoRecord, ctx(16));

    expect(() => bodyFor({ year_amounts: [{ year: 'FY27', amount: '50.01' }] })).toThrow();
    expect(() => bodyFor({ year_amounts: [{ year: 'FY27', amount: '50.01' }, { year: 'FY27', amount: '50.00' }] })).toThrow();
    expect(() => bodyFor({ year_amounts: [{ year: 'FY27', amount: '-0.01' }, { year: 'FY28', amount: '100.02' }] })).toThrow();
    expect(() => bodyFor({ year_amounts: [{ year: 'FY27', amount: '50.00' }, { year: 'FY28', amount: '50.00' }] })).toThrow();
    expect(() => bodyFor({ year_amounts: [{ year: 'FY27', amount: '50.01' }, { year: 'FY28', amount: '50.00' }], to_fiscal_year: 'FY27' })).toThrow();
    expect(() => bodyFor({ fiscal_years: [{ name: 'FY27', start: '2028-02-29', end: '2028-02-28' }, { name: 'FY28', start: '2028-03-01', end: '2029-02-28' }] })).toThrow();
  });

  it('AC-009 same-total but different yearly vectors remain distinct body payloads', () => {
    const original = budgetToBody({
      ...rangeRecord,
      line_items: [{ category: 'Labor', budgeted_amount: '100.00' }],
      erp_account: 'Salary',
      year_amounts: [{ year: 'FY27', amount: '100.00' }, { year: 'FY28', amount: '0.00' }],
    }, ctx(16)) as Record<string, unknown>;
    const changed = budgetToBody({
      ...rangeRecord,
      line_items: [{ category: 'Labor', budgeted_amount: '100.00' }],
      erp_account: 'Salary',
      year_amounts: [{ year: 'FY27', amount: '0.00' }, { year: 'FY28', amount: '100.00' }],
    }, ctx(16)) as Record<string, unknown>;

    expect(original.budget_amount).toBe(changed.budget_amount);
    expect(original.budget_distribution).not.toEqual(changed.budget_distribution);
  });

  it('AC-009 refuses a positive yearly amount whose percent cannot be represented at four decimal places', () => {
    const lineTotal = '999999999999.99';
    expect(() => budgetToBody({
      ...rangeRecord,
      line_items: [{ category: 'Labor', budgeted_amount: lineTotal }],
      erp_account: 'Salary',
      year_amounts: [{ year: 'FY27', amount: '0.01' }, { year: 'FY28', amount: '999999999999.98' }],
    }, ctx(16))).toThrow(/percent/i);
  });

  it('AC-BV16-002 preserves the frozen v15 JSON bytes', () => {
    expect(JSON.stringify(budgetToBody(record, ctx(15)))).toBe(V15_JSON);
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
      budgetToBody({ ...sharedRecord, erp_account: 'Salary' }, sharedCtx);
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
