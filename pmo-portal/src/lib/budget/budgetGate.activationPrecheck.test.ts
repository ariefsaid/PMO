import { describe, expect, it, vi } from 'vitest';
import {
  runBudgetActivationPrecheck,
  type BudgetGateDeps,
  type BudgetGateProjectRow,
  type BudgetLineItem,
  type CategoryAccountMapRow,
  type FiscalYearRow,
} from './budgetGate';

const ORG = 'org-1';
const VERSION = 'version-1';
const PROJECT: BudgetGateProjectRow = {
  id: 'project-1',
  org_id: ORG,
  start_date: '2026-06-01',
  end_date: '2027-06-30',
};
const FISCAL_YEARS: FiscalYearRow[] = [
  { name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' },
  { name: '2027', year_start_date: '2027-01-01', year_end_date: '2027-12-31' },
];

function makeDeps(overrides: Partial<BudgetGateDeps> = {}): BudgetGateDeps {
  const deps: BudgetGateDeps = {
    orgId: ORG,
    versionId: VERSION,
    readVersion: vi.fn(async () => ({ id: VERSION, org_id: ORG, project_id: PROJECT.id, status: 'Draft', activated_at: null })),
    readProject: vi.fn(async () => PROJECT),
    readLineItems: vi.fn(async () => [
      { category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2026' },
      { category: 'Materials', budgeted_amount: '25000.00', fiscal_year: null },
      { category: 'Travel', budgeted_amount: '10000.00', fiscal_year: '2027' },
    ] satisfies BudgetLineItem[]),
    readCategoryMap: vi.fn(async () => [
      { category: 'Labor', erp_account: '5100' },
      { category: 'Materials', erp_account: '5200' },
    ] satisfies CategoryAccountMapRow[]),
    readFiscalYears: vi.fn(async () => FISCAL_YEARS),
  };
  return { ...deps, ...overrides };
}

describe('runBudgetActivationPrecheck (issue #1421)', () => {
  it('reports every definite readiness blocker on a Draft without requiring an activation stamp', async () => {
    const result = await runBudgetActivationPrecheck(makeDeps());

    expect(result.status).toBe('blocked');
    expect(result.erpCheck).toBe('available');
    expect(result.fiscalYearNames).toEqual(['2026', '2027']);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'budget-multi-fiscal-year-unphased', categories: ['Materials'] }),
      expect.objectContaining({ code: 'budget-category-unmapped', categories: ['Travel'] }),
    ]));
  });

  it('allows activation to continue when ERPNext cannot be checked, while still reporting PMO-side map blockers', async () => {
    const result = await runBudgetActivationPrecheck(makeDeps({
      readFiscalYears: vi.fn(async () => { throw new Error('external-unreachable'); }),
    }));

    expect(result.status).toBe('blocked');
    expect(result.erpCheck).toBe('unavailable');
    expect(result.fiscalYearNames).toBeNull();
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'budget-category-unmapped', categories: ['Travel'] }),
    ]);
  });

  it('marks an otherwise-ready Draft as ERP-unavailable instead of silently claiming it is ready', async () => {
    const result = await runBudgetActivationPrecheck(makeDeps({
      readLineItems: vi.fn(async () => [{ category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2026' }]),
      readFiscalYears: vi.fn(async () => { throw new Error('external-unreachable'); }),
    }));

    expect(result.status).toBe('erp-unavailable');
    expect(result.erpCheck).toBe('unavailable');
    expect(result.issues).toEqual([]);
  });

  it('still blocks a missing project start date when the ERP calendar cannot be read', async () => {
    const result = await runBudgetActivationPrecheck(makeDeps({
      readProject: vi.fn(async () => ({ ...PROJECT, start_date: null })),
      readLineItems: vi.fn(async () => []),
      readCategoryMap: vi.fn(async () => []),
      readFiscalYears: vi.fn(async () => { throw new Error('external-unreachable'); }),
    }));

    expect(result.status).toBe('blocked');
    expect(result.erpCheck).toBe('unavailable');
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'budget-project-start-date-missing' }),
    ]);
  });

  it('returns ready with the live ERP year names when the shared readiness checks pass', async () => {
    const result = await runBudgetActivationPrecheck(makeDeps({
      readLineItems: vi.fn(async () => [
        { category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2026' },
        { category: 'Materials', budgeted_amount: '25000.00', fiscal_year: '2027' },
      ]),
      readCategoryMap: vi.fn(async () => [
        { category: 'Labor', erp_account: '5100' },
        { category: 'Materials', erp_account: '5200' },
      ]),
    }));

    expect(result.status).toBe('ready');
    expect(result.erpCheck).toBe('available');
    expect(result.fiscalYearNames).toEqual(['2026', '2027']);
    expect(result.issues).toEqual([]);
  });

  it('rejects a version that is no longer a Draft', async () => {
    await expect(runBudgetActivationPrecheck(makeDeps({
      readVersion: vi.fn(async () => ({ id: VERSION, org_id: ORG, project_id: PROJECT.id, status: 'Active', activated_at: '2026-01-01' })),
    }))).rejects.toMatchObject({ code: 'commit-rejected' });
  });
});
