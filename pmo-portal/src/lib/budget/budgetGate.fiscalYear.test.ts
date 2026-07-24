/**
 * budgetGate.fiscalYear.test.ts — BFY T4: the per-year push plan (AC-BFY-004..008,
 * FR-BFY-010/011/021/030/080). The gate moves from "resolve one year or refuse" to "produce a
 * per-year push plan": fan out one ERP `Budget` per phased fiscal year; refuse a multi-FY project that
 * still has NULL lines (naming them); validate every phased year against the client's own calendar; and
 * CARRY the project's date span (FR-BFY-080 — the push-time witness source).
 *
 * The served fan-out + the failure writers are owned by AC-BFY-009/011 (Deno/e2e); these unit tests own
 * the gate's pure per-year plan logic.
 */
import { describe, it, expect } from 'vitest';
import { runBudgetGate, BudgetGateError, type BudgetGateDeps, type BudgetVersionGateRow, type BudgetGateProjectRow, type FiscalYearRow } from './budgetGate';
import type { BudgetLineItem, CategoryAccountMapRow } from './categoryAccountMap';

const ORG = 'org-a';

const ACTIVE_VERSION: BudgetVersionGateRow = {
  id: 'ver-1', org_id: ORG, project_id: 'proj-1', status: 'Active', activated_at: '2026-07-16T10:00:00Z',
};

/** A CALENDAR-year client (Jan-Dec); `name` IS Budget's `fiscal_year` Link value. */
const CALENDAR_FISCAL_YEARS: FiscalYearRow[] = [
  { name: '2025', year_start_date: '2025-01-01', year_end_date: '2025-12-31' },
  { name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' },
  { name: '2027', year_start_date: '2027-01-01', year_end_date: '2027-12-31' },
];

function makeDeps(opts: {
  project: BudgetGateProjectRow;
  lineItems: BudgetLineItem[];
  map?: CategoryAccountMapRow[];
  version?: BudgetVersionGateRow;
  fiscalYears?: FiscalYearRow[];
}): BudgetGateDeps {
  const version = opts.version ?? ACTIVE_VERSION;
  const map = opts.map ?? [
    { category: 'Labor', erp_account: '5100' },
    { category: 'Materials', erp_account: '5200' },
    { category: 'Equipment', erp_account: '5300' },
  ];
  return {
    orgId: ORG, versionId: 'ver-1',
    readVersion: async () => version,
    readProject: async () => opts.project,
    readLineItems: async () => opts.lineItems,
    readCategoryMap: async () => map,
    readFiscalYears: async () => opts.fiscalYears ?? CALENDAR_FISCAL_YEARS,
  };
}

describe('runBudgetGate — BFY per-year push plan (AC-BFY-004..008)', () => {
  it('AC-BFY-004 a single-FY project with NULL (un-phased) lines produces ONE plan entry for that year carrying ALL lines, plus the project span (FR-BFY-011/080)', async () => {
    const project: BudgetGateProjectRow = { id: 'proj-1', org_id: ORG, start_date: '2026-01-01', end_date: '2026-12-31' };
    const lines: BudgetLineItem[] = [
      { category: 'Labor', budgeted_amount: '50000.00' },
      { category: 'Materials', budgeted_amount: '25000.00' },
    ];
    const result = await runBudgetGate(makeDeps({ project, lineItems: lines }));
    expect(result.plan).toEqual([{ fiscal_year: '2026', line_items: lines }]);
    expect(result.projectStartDate).toBe('2026-01-01');
    expect(result.projectEndDate).toBe('2026-12-31');
    expect(result.versionId).toBe('ver-1');
    expect(result.projectId).toBe('proj-1');
    expect(result.activatedAt).toBe('2026-07-16T10:00:00Z');
  });

  it('AC-BFY-004 a single-FY project also accepts lines ALREADY phased to that one year (no out-of-span)', async () => {
    const project: BudgetGateProjectRow = { id: 'proj-1', org_id: ORG, start_date: '2026-01-01', end_date: '2026-12-31' };
    const lines: BudgetLineItem[] = [{ category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2026' }];
    const result = await runBudgetGate(makeDeps({ project, lineItems: lines }));
    expect(result.plan).toEqual([{ fiscal_year: '2026', line_items: lines }]);
  });

  it('AC-BFY-005 a multi-FY project with ANY un-phased line FAILS CLOSED, naming those lines ("phase these lines") (FR-BFY-010)', async () => {
    const project: BudgetGateProjectRow = { id: 'proj-1', org_id: ORG, start_date: '2026-06-01', end_date: '2027-06-30' };
    const lines: BudgetLineItem[] = [
      { category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2026' },
      { category: 'Materials', budgeted_amount: '25000.00' }, // un-phased → the actionable line
    ];
    let err: unknown;
    try {
      await runBudgetGate(makeDeps({ project, lineItems: lines }));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BudgetGateError);
    expect((err as BudgetGateError).code).toBe('budget-multi-fiscal-year-unphased');
    expect((err as BudgetGateError).fiscalYear).toBe('2026'); // start-FY grain for the durable failure row
    expect((err as BudgetGateError).message).toContain('Materials'); // names the un-phased line
  });

  it('AC-BFY-006 a multi-FY project with ALL lines phased produces ONE plan entry per distinct phased year (FR-BFY-030)', async () => {
    const project: BudgetGateProjectRow = { id: 'proj-1', org_id: ORG, start_date: '2026-06-01', end_date: '2027-06-30' };
    const labor: BudgetLineItem = { category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2026' };
    const materials: BudgetLineItem = { category: 'Materials', budgeted_amount: '25000.00', fiscal_year: '2026' };
    const equipment: BudgetLineItem = { category: 'Equipment', budgeted_amount: '10000.00', fiscal_year: '2027' };
    const result = await runBudgetGate(makeDeps({ project, lineItems: [labor, materials, equipment] }));
    expect(result.plan).toEqual([
      { fiscal_year: '2026', line_items: [labor, materials] },
      { fiscal_year: '2027', line_items: [equipment] },
    ]);
  });

  it('AC-BFY-007 a line phased to a value that names NO ERPNext Fiscal Year FAILS CLOSED, naming the line and the bad year (FR-BFY-021)', async () => {
    const project: BudgetGateProjectRow = { id: 'proj-1', org_id: ORG, start_date: '2026-01-01', end_date: '2026-12-31' };
    const lines: BudgetLineItem[] = [{ category: 'Labor', budgeted_amount: '50000.00', fiscal_year: 'BOGUS' }];
    let err: unknown;
    try {
      await runBudgetGate(makeDeps({ project, lineItems: lines }));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BudgetGateError);
    expect((err as BudgetGateError).code).toBe('budget-fiscal-year-invalid');
    expect((err as BudgetGateError).fiscalYear).toBe('2026');
    expect((err as BudgetGateError).message).toContain('BOGUS');
    expect((err as BudgetGateError).message).toContain('Labor');
  });

  it('AC-BFY-008 a multi-FY project: a line phased to a VALID year OUTSIDE the project span fails closed (out-of-span) (FR-BFY-021)', async () => {
    const project: BudgetGateProjectRow = { id: 'proj-1', org_id: ORG, start_date: '2026-06-01', end_date: '2027-06-30' }; // span 2026–2027
    const lines: BudgetLineItem[] = [{ category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2025' }]; // 2025 is a real FY but outside the span
    await expect(runBudgetGate(makeDeps({ project, lineItems: lines }))).rejects.toMatchObject({
      code: 'budget-fiscal-year-out-of-span',
      fiscalYear: '2026',
    });
  });

  it('AC-BFY-008 a single-FY project: a line phased to a different valid year fails closed (out-of-span)', async () => {
    const project: BudgetGateProjectRow = { id: 'proj-1', org_id: ORG, start_date: '2026-01-01', end_date: '2026-12-31' }; // single-FY 2026
    const lines: BudgetLineItem[] = [{ category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2027' }]; // 2027 valid but ≠ 2026
    await expect(runBudgetGate(makeDeps({ project, lineItems: lines }))).rejects.toMatchObject({
      code: 'budget-fiscal-year-out-of-span',
      fiscalYear: '2026',
    });
  });

  it('FR-BFY-080 the plan carries the project span even for an open-ended (no end_date) single-FY project', async () => {
    const project: BudgetGateProjectRow = { id: 'proj-1', org_id: ORG, start_date: '2026-06-01', end_date: null };
    const lines: BudgetLineItem[] = [{ category: 'Labor', budgeted_amount: '50000.00' }];
    const result = await runBudgetGate(makeDeps({ project, lineItems: lines }));
    expect(result.plan).toEqual([{ fiscal_year: '2026', line_items: lines }]);
    expect(result.projectStartDate).toBe('2026-06-01');
    expect(result.projectEndDate).toBeNull();
  });

  it('AC-BFY-006 regression: the category→account map is still resolved over the plan union — an unmapped category fails closed (FR-BUD-113)', async () => {
    const project: BudgetGateProjectRow = { id: 'proj-1', org_id: ORG, start_date: '2026-06-01', end_date: '2027-06-30' };
    const lines: BudgetLineItem[] = [
      { category: 'Labor', budgeted_amount: '50000.00', fiscal_year: '2026' },
      { category: 'Contingency', budgeted_amount: '5000.00', fiscal_year: '2027' }, // unmapped
    ];
    const map: CategoryAccountMapRow[] = [{ category: 'Labor', erp_account: '5100' }]; // Contingency unmapped
    await expect(runBudgetGate(makeDeps({ project, lineItems: lines, map }))).rejects.toMatchObject({
      code: 'budget-category-unmapped',
      fiscalYear: '2026',
    });
  });
});
