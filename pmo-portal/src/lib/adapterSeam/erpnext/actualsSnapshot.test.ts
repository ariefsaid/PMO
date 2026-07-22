/**
 * erpnext/actualsSnapshot.ts (task 7.3, AC-ENA-060): refreshActuals — sums MIRRORED erp_gl_entry_mirror
 * rows into erp_actuals_snapshot. ADR-0048: PMO may SUM mirrored ledger rows (ERP truth); it may NEVER
 * invent an accounting figure or read procurement_invoices for actuals.
 *
 * RED until actualsSnapshot.ts exists. Asserts: given a fixed erp_gl_entry_mirror seed, the snapshot
 * holds the exact per-(cost_center, account, fiscal_year) sums (net = debit − credit), a refresh
 * REPLACES the prior scope (single snapshot_id / single as_of), source_report='GL Entry' is stamped,
 * and procurement_invoices is NEVER touched on any path (the FR-ENA-162/ADR-0048 prohibition).
 */
import { describe, expect, it } from 'vitest';
import { refreshActuals } from './actualsSnapshot.ts';

/** A recording structural service client: mirrors the supabase-js `.from(t).select(c).eq().eq()` +
 *  `.delete().eq()` + `.insert([])` shape (thenable filter builders). Every `from(table)` call is
 *  recorded so the test can assert procurement_invoices is never touched. */
interface RecordingClient {
  tables: string[];
  glRows: Record<string, unknown>[];
  deletedScopes: Record<string, string | null>[];
  inserted: Record<string, unknown>[][];
  /** The column list the refresh asked the GL mirror for — the read half of the attribution contract. */
  selectedColumns: string[];
  from?(table: string): unknown;
}

function makeClient(glRows: Record<string, unknown>[]): RecordingClient {
  const rec: RecordingClient = { tables: [], glRows, deletedScopes: [], inserted: [], selectedColumns: [] };
  rec.from = (table: string) => {
    rec.tables.push(table);
    if (table === 'erp_gl_entry_mirror') {
      // select + eq chain that resolves to the seeded rows (filters are structural here — the unit
      // test seeds ONLY the org's rows, so an unfiltered return is the exact read-model the refresh
      // consumes in production under RLS org-isolation).
      const selectBuilder = Promise.resolve({ data: [...glRows], error: null });
      Object.assign(selectBuilder, {
        eq: () => selectBuilder,
      });
      return {
        select: (columns: string) => {
          rec.selectedColumns.push(columns);
          return selectBuilder;
        },
      };
    }
    if (table === 'erp_actuals_snapshot') {
      return {
        delete: () => {
          const scope: Record<string, string | null> = {};
          const del = Promise.resolve({ error: null });
          Object.assign(del, {
            eq: (col: string, val: string | null) => {
              scope[col] = val;
              return del;
            },
          });
          // resolve records the delete scope when awaited
          void del.then(() => rec.deletedScopes.push(scope));
          return del;
        },
        insert: async (rows: Record<string, unknown>[]) => {
          rec.inserted.push(rows);
          return { error: null };
        },
      };
    }
    throw new Error(`unexpected table access: ${table}`);
  };
  return rec;
}

describe('erpnext/actualsSnapshot — refreshActuals (AC-ENA-060)', () => {
  it('sums mirrored GL rows per (cost_center, account, fiscal_year); net = debit − credit', async () => {
    const client = makeClient([
      { org_id: 'org-1', cost_center: 'Main - PSC', account: 'Creditors - PSC', fiscal_year: '2026', debit: 0, credit: 50000, is_cancelled: false },
      { org_id: 'org-1', cost_center: 'Main - PSC', account: 'Stock Received But Not Billed - PSC', fiscal_year: '2026', debit: 50000, credit: 0, is_cancelled: false },
      // a second Creditors row in the SAME group → must ADD into the group sum
      { org_id: 'org-1', cost_center: 'Main - PSC', account: 'Creditors - PSC', fiscal_year: '2026', debit: 0, credit: 25000, is_cancelled: false },
      // a different fiscal year → its own group
      { org_id: 'org-1', cost_center: 'Main - PSC', account: 'Creditors - PSC', fiscal_year: '2025', debit: 1000, credit: 0, is_cancelled: false },
    ]);
    await refreshActuals(client as unknown as never, 'org-1', {});
    expect(client.tables).toContain('erp_gl_entry_mirror');
    expect(client.tables).toContain('erp_actuals_snapshot');
    expect(client.inserted).toHaveLength(1);
    const rows = client.inserted[0]!;
    const byKey = Object.fromEntries(rows.map((r) => [`${r.cost_center}|${r.account}|${r.fiscal_year}`, r]));
    expect(byKey['Main - PSC|Creditors - PSC|2026']).toMatchObject({ debit: 0, credit: 75000, net: -75000 });
    expect(byKey['Main - PSC|Stock Received But Not Billed - PSC|2026']).toMatchObject({ debit: 50000, credit: 0, net: 50000 });
    expect(byKey['Main - PSC|Creditors - PSC|2025']).toMatchObject({ debit: 1000, credit: 0, net: 1000 });
    expect(rows).toHaveLength(3); // 3 distinct groups
  });

  it('stamps source_report="GL Entry" + a single as_of + a single snapshot_id on every row', async () => {
    const client = makeClient([
      { org_id: 'org-1', cost_center: 'Main - PSC', account: 'Cash - PSC', fiscal_year: '2026', debit: 100, credit: 0, is_cancelled: false },
    ]);
    await refreshActuals(client as unknown as never, 'org-1', {});
    const rows = client.inserted[0]!;
    expect(rows.every((r) => r.source_report === 'GL Entry')).toBe(true);
    expect(rows.every((r) => typeof r.snapshot_id === 'string')).toBe(true);
    const snapshotIds = new Set(rows.map((r) => r.snapshot_id));
    expect(snapshotIds.size).toBe(1); // single snapshot_id
    const asOfs = new Set(rows.map((r) => r.as_of));
    expect(asOfs.size).toBe(1); // single as_of (coherent snapshot)
  });

  it('a refresh REPLACES the prior scope (delete prior-scope rows THEN insert, single snapshot_id)', async () => {
    const client = makeClient([
      { org_id: 'org-1', cost_center: 'Main - PSC', account: 'Cash - PSC', fiscal_year: '2026', debit: 1, credit: 0, is_cancelled: false },
    ]);
    await refreshActuals(client as unknown as never, 'org-1', {});
    // a delete for the org's scope happened, scoped by org_id
    expect(client.deletedScopes).toHaveLength(1);
    expect(client.deletedScopes[0]).toMatchObject({ org_id: 'org-1' });
    // exactly one insert (the new snapshot), exactly one snapshot_id
    expect(client.inserted).toHaveLength(1);
  });

  it('NEVER reads or writes procurement_invoices (ADR-0048 / FR-ENA-162 prohibition)', async () => {
    const client = makeClient([
      { org_id: 'org-1', cost_center: 'Main - PSC', account: 'Cash - PSC', fiscal_year: '2026', debit: 1, credit: 0, is_cancelled: false },
    ]);
    await refreshActuals(client as unknown as never, 'org-1', {});
    expect(client.tables).not.toContain('procurement_invoices');
  });

  it('an empty mirror (no GL rows) still snapshot-replaces → a single empty insert (scope cleared)', async () => {
    const client = makeClient([]);
    await refreshActuals(client as unknown as never, 'org-1', {});
    expect(client.deletedScopes).toHaveLength(1);
    expect(client.inserted).toHaveLength(1);
    expect(client.inserted[0]).toEqual([]); // no rows, but the scope was replaced (cleared)
  });

  it('propagates a service-role read error (never silently swallows a mirror read failure)', async () => {
    const client: RecordingClient = { tables: [], glRows: [], deletedScopes: [], inserted: [], selectedColumns: [], from: () => { throw new Error('boom'); } };
    await expect(refreshActuals(client as unknown as never, 'org-1', {})).rejects.toThrow('boom');
  });
});

/**
 * ⚑ NEW-1 (Luna audit round 4, 2026-07-22) — PROJECT ATTRIBUTION OF GL ACTUALS.
 *
 * `refreshActuals` is the ONLY production writer of `erp_actuals_snapshot`, and it stamped
 * `project_id = scope.projectId ?? null` from a caller-supplied SCOPE that production always left
 * empty — so every snapshot row carried `project_id = NULL`, while `get_budget_projection` joins
 * `s.project_id = p_project_id`. `NULL = <uuid>` is never true, so "Actuals to date" was
 * STRUCTURALLY 0.00 for every project with real posted GL spend: variance = the entire budget,
 * utilization —, and not one error on the primary money screen.
 *
 * The fix reads the dimension ERP actually states. `erp_gl_entry_mirror.project` carries the ERPNext
 * `Project` NAME; the ERP-project↔PMO-project mapping already exists as the binding's
 * `config.project_map` (PMO project id → ERP project name — the SAME seam `dispatchFactory.ts` uses
 * to resolve `ctx.refs.project` for the budget push and the timesheet entries). This module consumes
 * that ONE seam inverted; it does not invent a second one.
 *
 * ⚑ AND IT NEVER GUESSES. A GL row that states no project, states a project this binding does not
 * map, or states one whose inverse is AMBIGUOUS (two PMO projects claiming the same ERP name) is NOT
 * attributable — it is stamped `project_id = null` (an explicit unattributed bucket, still summed and
 * still readable) and never folded into some project's actuals. Mis-attributed money is worse than
 * visibly unattributed money (the owner's standing honest-refusal ruling).
 */
describe('erpnext/actualsSnapshot — NEW-1 project attribution from the GL project dimension', () => {
  const PROJ_A = '11111111-1111-4111-8111-111111111111';
  const PROJ_B = '22222222-2222-4222-8222-222222222222';

  it('reads the GL `project` dimension (it cannot attribute a column it never selects)', async () => {
    const client = makeClient([]);
    await refreshActuals(client as unknown as never, 'org-1', {});
    expect(client.selectedColumns[0]).toContain('project');
  });

  it('stamps the PMO project_id resolved from the binding project_map — NOT a caller-supplied scope', async () => {
    const client = makeClient([
      { project: 'PROJ-0001', cost_center: 'Main - PSC', account: '5100 - Direct Costs - PSC', fiscal_year: '2026', debit: 600000, credit: 0 },
    ]);
    await refreshActuals(client as unknown as never, 'org-1', { projectMap: { [PROJ_A]: 'PROJ-0001' } });
    expect(client.inserted[0]).toEqual([
      expect.objectContaining({ project_id: PROJ_A, account: '5100 - Direct Costs - PSC', fiscal_year: '2026', net: 600000 }),
    ]);
  });

  it('sums per PROJECT — two projects on the same account+FY never merge into one bucket', async () => {
    const client = makeClient([
      { project: 'PROJ-0001', cost_center: null, account: '5100', fiscal_year: '2026', debit: 100, credit: 0 },
      { project: 'PROJ-0002', cost_center: null, account: '5100', fiscal_year: '2026', debit: 40, credit: 0 },
      { project: 'PROJ-0001', cost_center: null, account: '5100', fiscal_year: '2026', debit: 25, credit: 0 },
    ]);
    await refreshActuals(client as unknown as never, 'org-1', {
      projectMap: { [PROJ_A]: 'PROJ-0001', [PROJ_B]: 'PROJ-0002' },
    });
    const rows = client.inserted[0]!;
    const byProject = Object.fromEntries(rows.map((r) => [String(r.project_id), r]));
    expect(byProject[PROJ_A]).toMatchObject({ net: 125 });
    expect(byProject[PROJ_B]).toMatchObject({ net: 40 });
    expect(rows).toHaveLength(2);
  });

  it('a GL row stating NO project is unattributed (project_id null) — never folded into a mapped project', async () => {
    const client = makeClient([
      { project: 'PROJ-0001', cost_center: null, account: '5100', fiscal_year: '2026', debit: 100, credit: 0 },
      { project: null, cost_center: null, account: '5100', fiscal_year: '2026', debit: 999, credit: 0 },
    ]);
    await refreshActuals(client as unknown as never, 'org-1', { projectMap: { [PROJ_A]: 'PROJ-0001' } });
    const rows = client.inserted[0]!;
    expect(rows.find((r) => r.project_id === PROJ_A)).toMatchObject({ net: 100 });
    expect(rows.find((r) => r.project_id === null)).toMatchObject({ net: 999 });
    expect(rows).toHaveLength(2);
  });

  it('a GL project this binding does not map is unattributed, never silently attributed to another project', async () => {
    const client = makeClient([
      { project: 'PROJ-9999', cost_center: null, account: '5100', fiscal_year: '2026', debit: 500, credit: 0 },
    ]);
    await refreshActuals(client as unknown as never, 'org-1', { projectMap: { [PROJ_A]: 'PROJ-0001' } });
    expect(client.inserted[0]).toEqual([expect.objectContaining({ project_id: null, net: 500 })]);
  });

  it('an AMBIGUOUS inverse (two PMO projects claim one ERP project) attributes to NEITHER', async () => {
    const client = makeClient([
      { project: 'PROJ-0001', cost_center: null, account: '5100', fiscal_year: '2026', debit: 700, credit: 0 },
    ]);
    await refreshActuals(client as unknown as never, 'org-1', {
      projectMap: { [PROJ_A]: 'PROJ-0001', [PROJ_B]: 'PROJ-0001' },
    });
    expect(client.inserted[0]).toEqual([expect.objectContaining({ project_id: null, net: 700 })]);
  });

  /**
   * ⚑ NEW-1 companion (audit round 4) — the UNDATED fiscal year. `erp_actuals_snapshot.fiscal_year` is
   * nullable (0101), and both readers match it by EQUALITY: `get_budget_projection` selects
   * `s.fiscal_year = p_fiscal_year` (`= NULL` is never true) and `list_budget_fiscal_years` deliberately
   * never OFFERS a null year. So a GL row whose fiscal year ERPNext never stated is money that is
   * invisible under EVERY year. PMO does not own the client's fiscal calendar and must not invent a
   * year for it, so the row keeps its honest NULL — but the refresh must REPORT the gap so the sweep
   * can raise it to an operator. Silently succeeding over it is the NEW-1 failure class all over again.
   */
  it('reports undated rows (fiscal year ERP never stated) — stored honestly, never dropped, never guessed a year', async () => {
    const client = makeClient([
      { project: 'PROJ-0001', cost_center: null, account: '5100', fiscal_year: '2026', debit: 100, credit: 0 },
      { project: 'PROJ-0001', cost_center: null, account: '5100', fiscal_year: null, debit: 4200, credit: 0 },
    ]);
    const summary = await refreshActuals(client as unknown as never, 'org-1', { projectMap: { [PROJ_A]: 'PROJ-0001' } });
    // the money is STORED (never dropped) under its honest null year...
    const rows = client.inserted[0]!;
    expect(rows.find((r) => r.fiscal_year === null)).toMatchObject({ project_id: PROJ_A, net: 4200 });
    // ...and NOT folded into the dated bucket to make the year's total look complete
    expect(rows.find((r) => r.fiscal_year === '2026')).toMatchObject({ net: 100 });
    // ...and the gap is reported so a caller can surface it
    expect(summary).toEqual({ rows: 2, undatedRows: 1 });
  });

  it('reports no gap when every GL row states its fiscal year', async () => {
    const client = makeClient([
      { project: 'PROJ-0001', cost_center: null, account: '5100', fiscal_year: '2026', debit: 100, credit: 0 },
    ]);
    const summary = await refreshActuals(client as unknown as never, 'org-1', { projectMap: { [PROJ_A]: 'PROJ-0001' } });
    expect(summary).toEqual({ rows: 1, undatedRows: 0 });
  });

  it('a refresh replaces the WHOLE org scope (org-wide by construction — every project is re-stamped)', async () => {
    const client = makeClient([
      { project: 'PROJ-0001', cost_center: null, account: '5100', fiscal_year: '2026', debit: 1, credit: 0 },
    ]);
    await refreshActuals(client as unknown as never, 'org-1', { projectMap: { [PROJ_A]: 'PROJ-0001' } });
    expect(client.deletedScopes).toEqual([{ org_id: 'org-1' }]);
  });
});
