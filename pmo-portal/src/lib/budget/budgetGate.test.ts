import { describe, it, expect } from 'vitest';
import { runBudgetGate, BudgetGateError, type BudgetGateDeps, type BudgetVersionGateRow, type BudgetGateProjectRow, type FiscalYearRow } from './budgetGate';
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

/** A CALENDAR-year client (Jan-Dec) — the shape ERPNext's own bench ships, which is why the original
 *  calendar-year derivation looked correct against it. `name` IS Budget's `fiscal_year` Link value. */
const CALENDAR_FISCAL_YEARS = [
  { name: '2025', year_start_date: '2025-01-01', year_end_date: '2025-12-31' },
  { name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' },
  { name: '2027', year_start_date: '2027-01-01', year_end_date: '2027-12-31' },
];

/** A JUL-JUN client. The whole point of OQ-BUD-3b: the SAME dates classify differently here. */
const JUL_JUN_FISCAL_YEARS = [
  { name: '2025-2026', year_start_date: '2025-07-01', year_end_date: '2026-06-30' },
  { name: '2026-2027', year_start_date: '2026-07-01', year_end_date: '2027-06-30' },
];

function makeDeps(overrides: {
  version?: BudgetVersionGateRow | null;
  project?: BudgetGateProjectRow | null;
  lineItems?: BudgetLineItem[];
  map?: CategoryAccountMapRow[];
  fiscalYears?: FiscalYearRow[];
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
    readFiscalYears: async () => overrides.fiscalYears ?? CALENDAR_FISCAL_YEARS,
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

describe('AC-BUD-124 ⚑ OQ-BUD-3b — the fiscal year comes from the CLIENT\'S calendar, never the calendar year', () => {
  // The project that made this defect concrete: PMO's flagship seed, 2025-09-01 -> 2026-06-30.
  const SPANNING_PROJECT: BudgetGateProjectRow = {
    ...DEFAULT_PROJECT, start_date: '2025-09-01', end_date: '2026-06-30',
  };

  it('AC-BUD-124 a Jul-Jun client: a project inside ONE fiscal year pushes, though it spans two CALENDAR years', async () => {
    // ⚑ The behaviour change. Calendar-year derivation refused this project as "multi-fiscal-year".
    // Under the client's real Jul-Jun calendar it sits entirely inside 2025-2026 and MUST push.
    const gate = await runBudgetGate(makeDeps({ project: SPANNING_PROJECT, fiscalYears: JUL_JUN_FISCAL_YEARS }));
    expect(gate.fiscalYear).toBe('2025-2026');
  });

  it('AC-BUD-124 the SAME project IS refused for a Jan-Dec client — the calendar decides, not the dates', async () => {
    // The mirror image, so the test above cannot pass by simply never refusing anything.
    await expect(
      runBudgetGate(makeDeps({ project: SPANNING_PROJECT, fiscalYears: CALENDAR_FISCAL_YEARS })),
    ).rejects.toMatchObject({ code: 'budget-multi-fiscal-year' });
  });

  it('AC-BUD-124 the returned value is the Fiscal Year NAME (Budget links by name), not a year number', async () => {
    // `fiscal_year` is a Link to Fiscal Year BY NAME (spike §3). '2025' is not a valid Link for this
    // client — it names no Fiscal Year at all, so ERP would reject or mis-link the budget.
    const gate = await runBudgetGate(makeDeps({ project: SPANNING_PROJECT, fiscalYears: JUL_JUN_FISCAL_YEARS }));
    expect(gate.fiscalYear).not.toBe('2025');
    expect(JUL_JUN_FISCAL_YEARS.map((fy) => fy.name)).toContain(gate.fiscalYear);
  });

  it('AC-BUD-124 an unresolvable calendar FAILS CLOSED — it never falls back to the calendar year', async () => {
    // The fallback IS the bug. An empty/unreadable Fiscal Year list must refuse, not guess '2026'.
    await expect(
      runBudgetGate(makeDeps({ fiscalYears: [] })),
    ).rejects.toMatchObject({ code: 'budget-fiscal-year-unresolved' });
  });

  it('AC-BUD-124 a project starting outside every declared fiscal year is refused, not silently placed', async () => {
    await expect(
      runBudgetGate(makeDeps({
        project: { ...DEFAULT_PROJECT, start_date: '2019-03-01', end_date: '2019-11-30' },
        fiscalYears: CALENDAR_FISCAL_YEARS,
      })),
    ).rejects.toMatchObject({ code: 'budget-fiscal-year-unresolved' });
  });

  it('AC-BUD-124 OVERLAPPING fiscal years are REFUSED, never silently resolved to one of them', async () => {
    // ERPNext does not prevent overlapping Fiscal Years and returns them unordered. With a bare
    // `.find()` the activation push and the sweep backstop could pick DIFFERENT years in separate
    // requests, derive different keys, and mint a SECOND ERP Budget — the exact duplicate the
    // deterministic key exists to prevent. Refusing is the same call the owner made for the multi-FY
    // split: PMO does not get to choose which fiscal year a client's money belongs to.
    await expect(
      runBudgetGate(makeDeps({
        project: { ...DEFAULT_PROJECT, start_date: '2026-03-01', end_date: '2026-03-31' },
        fiscalYears: [
          { name: '2026', year_start_date: '2026-01-01', year_end_date: '2026-12-31' },
          { name: 'FY26-legacy', year_start_date: '2025-07-01', year_end_date: '2026-06-30' },
        ],
      })),
    ).rejects.toMatchObject({ code: 'budget-fiscal-year-ambiguous' });
  });

  it('AC-BUD-124 a fiscal-year boundary date resolves to the year that CONTAINS it (inclusive ends)', async () => {
    // 2026-06-30 is the last day of 2025-2026 and 2026-07-01 the first of 2026-2027; an off-by-one
    // here files a whole budget against the neighbouring year.
    const last = await runBudgetGate(makeDeps({
      project: { ...DEFAULT_PROJECT, start_date: '2026-06-30', end_date: '2026-06-30' },
      fiscalYears: JUL_JUN_FISCAL_YEARS,
    }));
    expect(last.fiscalYear).toBe('2025-2026');
    const first = await runBudgetGate(makeDeps({
      project: { ...DEFAULT_PROJECT, start_date: '2026-07-01', end_date: '2026-07-01' },
      fiscalYears: JUL_JUN_FISCAL_YEARS,
    }));
    expect(first.fiscalYear).toBe('2026-2027');
  });
});
