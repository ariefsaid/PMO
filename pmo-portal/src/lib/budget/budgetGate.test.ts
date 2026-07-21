import { describe, it, expect } from 'vitest';
import { runBudgetGate, BudgetGateError, type BudgetGateDeps, type BudgetVersionGateRow, type BudgetGateProjectRow } from './budgetGate';
import type { BudgetLineItem, CategoryAccountMapRow } from './categoryAccountMap';

// The missing half of P3c slice 3 (ADR-0059 §3.3): the served boundary must re-read the budget version's
// state FROM THE DB under the caller's own JWT — never trust the command payload — and must also assert
// (a) the version + its project belong to the caller's org, (b) the project resolves to exactly ONE fiscal
// year (OQ-BUD-3(a)'s proposed-default fail-closed policy — still pending final owner ratification), and
// (c) every non-zero category on the Active version has a mapped ERP account. `runBudgetGate` is the pure
// orchestration `adapter-dispatch/index.ts`'s budget path wires to the caller-scoped + service-role clients.

const ORG = 'org-a';
const OTHER_ORG = 'org-b';

const DEFAULT_VERSION: BudgetVersionGateRow = {
  id: 'ver-1',
  org_id: ORG,
  project_id: 'proj-1',
  status: 'Active',
  activated_at: '2026-07-16T10:00:00Z',
};

const DEFAULT_PROJECT: BudgetGateProjectRow = {
  id: 'proj-1',
  org_id: ORG,
  start_date: '2026-01-01',
  end_date: '2026-12-31',
};

const DEFAULT_LINE_ITEMS: BudgetLineItem[] = [{ category: 'Labor', budgeted_amount: '50000.00' }];
const DEFAULT_MAP: CategoryAccountMapRow[] = [{ category: 'Labor', erp_account: '5100 - Direct Costs' }];

function makeDeps(overrides: {
  version?: BudgetVersionGateRow | null;
  project?: BudgetGateProjectRow | null;
  lineItems?: BudgetLineItem[];
  map?: CategoryAccountMapRow[];
} = {}): BudgetGateDeps {
  const version = 'version' in overrides ? overrides.version : DEFAULT_VERSION;
  const project = 'project' in overrides ? overrides.project : DEFAULT_PROJECT;
  return {
    orgId: ORG,
    versionId: 'ver-1',
    readVersion: async () => version ?? null,
    readProject: async () => project ?? null,
    readLineItems: async () => overrides.lineItems ?? DEFAULT_LINE_ITEMS,
    readCategoryMap: async () => overrides.map ?? DEFAULT_MAP,
  };
}

describe('runBudgetGate', () => {
  it('AC-BUD-020 ⚑ re-reads the version status from the DB and rejects a version that is not Active — the payload is never trusted', async () => {
    const deps = makeDeps({ version: { ...DEFAULT_VERSION, status: 'Draft' } });
    await expect(runBudgetGate(deps)).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('AC-BUD-020 an ABSENT version is never treated as permission (no null/fall-through branch)', async () => {
    const deps = makeDeps({ version: null });
    await expect(runBudgetGate(deps)).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('AC-BUD-020 a version belonging to ANOTHER org is rejected before any other read (cross-org, the version half)', async () => {
    const deps = makeDeps({ version: { ...DEFAULT_VERSION, org_id: OTHER_ORG } });
    await expect(runBudgetGate(deps)).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('AC-BUD-014 cross-org pre-flight: a project belonging to ANOTHER org is rejected before any ERP call', async () => {
    const deps = makeDeps({ project: { ...DEFAULT_PROJECT, org_id: OTHER_ORG } });
    await expect(runBudgetGate(deps)).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('AC-BUD-021 a version carrying no activation stamp fails closed (no deterministic key could be derived)', async () => {
    const deps = makeDeps({ version: { ...DEFAULT_VERSION, activated_at: null } });
    await expect(runBudgetGate(deps)).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('AC-BUD-124 a project with no start date fails closed — there is no fiscal year to resolve', async () => {
    const deps = makeDeps({ project: { ...DEFAULT_PROJECT, start_date: null, end_date: null } });
    await expect(runBudgetGate(deps)).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('AC-BUD-033 ⚑ a multi-fiscal-year project fails closed — no pro-rata split is invented, no partial budget pushed', async () => {
    const deps = makeDeps({ project: { ...DEFAULT_PROJECT, start_date: '2026-06-01', end_date: '2027-03-31' } });
    await expect(runBudgetGate(deps)).rejects.toMatchObject({ code: 'budget-multi-fiscal-year', fiscalYear: '2026' });
  });

  it('AC-BUD-020 a rejection BEFORE the project/fiscal-year step carries no fiscalYear (nothing to key a durable-failure row on)', async () => {
    const deps = makeDeps({ version: { ...DEFAULT_VERSION, status: 'Draft' } });
    let err: unknown;
    try {
      await runBudgetGate(deps);
    } catch (e) {
      err = e;
    }
    expect((err as BudgetGateError).fiscalYear).toBeUndefined();
  });

  it('AC-BUD-033 an open-ended project (no end date) is single-FY by construction — resolves the start year', async () => {
    const deps = makeDeps({ project: { ...DEFAULT_PROJECT, start_date: '2026-06-01', end_date: null } });
    const result = await runBudgetGate(deps);
    expect(result.fiscalYear).toBe('2026');
  });

  it('AC-BUD-011 ⚑ an unmapped non-zero category is rejected at the boundary, naming every unmapped category', async () => {
    const deps = makeDeps({
      lineItems: [
        { category: 'Labor', budgeted_amount: '50000.00' },
        { category: 'Contingency', budgeted_amount: '1000.00' },
        { category: 'Overheads', budgeted_amount: '500.00' },
      ],
      map: [{ category: 'Labor', erp_account: '5100 - Direct Costs' }],
    });
    let err: unknown;
    try {
      await runBudgetGate(deps);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BudgetGateError);
    expect((err as BudgetGateError).code).toBe('budget-category-unmapped');
    expect((err as BudgetGateError).unmappedCategories).toEqual(['Contingency', 'Overheads']);
    expect((err as BudgetGateError).fiscalYear).toBe('2026'); // known by this point — the mirror can be keyed
  });

  it('AC-BUD-011 a ZERO-amount unmapped category is not an error (nothing would be pushed for it)', async () => {
    const deps = makeDeps({
      lineItems: [
        { category: 'Labor', budgeted_amount: '50000.00' },
        { category: 'Contingency', budgeted_amount: '0.00' },
      ],
      map: [{ category: 'Labor', erp_account: '5100 - Direct Costs' }],
    });
    await expect(runBudgetGate(deps)).resolves.toMatchObject({ fiscalYear: '2026' });
  });

  it('resolves the full gate result (versionId/projectId/fiscalYear/activatedAt/lineItems) for a fully valid command', async () => {
    const result = await runBudgetGate(makeDeps());
    expect(result).toEqual({
      versionId: 'ver-1',
      projectId: 'proj-1',
      fiscalYear: '2026',
      activatedAt: '2026-07-16T10:00:00Z',
      lineItems: DEFAULT_LINE_ITEMS,
    });
  });
});
