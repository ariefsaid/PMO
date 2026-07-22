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
import { FakePostgrest, DEFAULT_MAX_ROWS, type FakeRow } from '@/test/postgrestFake.ts';

/**
 * A recording structural service client over the PostgREST-FAITHFUL fake (`test/postgrestFake.ts`).
 *
 * ⚑ It used to be `Promise.resolve({ data: [...glRows] })` with `eq: () => builder` — a fake that
 * could not express the ONE behaviour that matters for a money sum: PostgREST caps every response at
 * `db-max-rows` (1000) and signals NOTHING when it truncates. That blindness is why an unpaged read
 * of the GL mirror survived eight audit rounds. The fake now caps, honours `.range()`/`.gt()`/`.limit()`,
 * and returns an UNSTABLE row order when no `.order()` is applied — so a truncated or unordered read
 * fails loudly.
 */
interface RecordingClient {
  readonly tables: string[];
  readonly deletedScopes: Record<string, unknown>[];
  readonly inserted: Record<string, unknown>[][];
  /** The column list the refresh asked the GL mirror for — the read half of the attribution contract. */
  readonly selectedColumns: string[];
  /** Every request issued against the GL mirror (one per page) — proves the read was PAGED + ORDERED. */
  readonly mirrorReads: { orderBy: string[]; cursors: unknown[]; returned: number }[];
  from(table: string): unknown;
}

function makeClient(glRows: Record<string, unknown>[], maxRows = DEFAULT_MAX_ROWS): RecordingClient {
  // `erp_gl_entry_mirror.id` is a NOT NULL uuid PK (0101) — model it, since it is the total, stable
  // order a paged scan must sort by. Zero-padded so the fake's string sort matches insertion order.
  const seeded: FakeRow[] = glRows.map((r, i) => ({ id: `gl-${String(i).padStart(8, '0')}`, ...r }));
  const fake = new FakePostgrest({ erp_gl_entry_mirror: seeded, erp_actuals_snapshot: [] }, { maxRows });
  return {
    get tables() { return fake.tablesTouched; },
    get deletedScopes() {
      return (fake.deletedScopes['erp_actuals_snapshot'] ?? []).map((filters) =>
        Object.fromEntries(filters.map((f) => [f.column, f.value])));
    },
    get inserted() { return (fake.inserted['erp_actuals_snapshot'] ?? []) as Record<string, unknown>[][]; },
    get selectedColumns() { return fake.reads.map((r) => r.columns); },
    get mirrorReads() {
      return fake.reads.filter((r) => r.table === 'erp_gl_entry_mirror').map((r) => ({
        orderBy: r.orderBy,
        cursors: r.filters.filter((f) => f.op === 'gt').map((f) => f.value),
        returned: r.returned,
      }));
    },
    from: (table: string) => fake.from(table),
  };
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
    const client = { from: () => { throw new Error('boom'); } };
    await expect(refreshActuals(client as unknown as never, 'org-1', {})).rejects.toThrow('boom');
  });

  it('propagates a PostgREST-shaped read error and NEVER deletes the prior snapshot (fail-closed)', async () => {
    const fake = new FakePostgrest(
      { erp_gl_entry_mirror: [{ id: 'gl-1', account: '5100', debit: 1, credit: 0 }], erp_actuals_snapshot: [{ net: 999 }] },
      { readErrors: { erp_gl_entry_mirror: { message: 'connection reset', code: '08006' } } },
    );
    await expect(refreshActuals(fake as unknown as never, 'org-1', {})).rejects.toThrow('connection reset');
    // A partial/failed read must never be allowed to replace a good snapshot with a worse one.
    expect(fake.rowsOf('erp_actuals_snapshot')).toEqual([{ net: 999 }]);
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

/**
 * ⚑ HIGH-1 (Luna audit round 8, 2026-07-22) — THE SILENTLY TRUNCATED MONEY READ (AC-ENA-062).
 *
 * `refreshActuals` read the org's ENTIRE `erp_gl_entry_mirror` in ONE PostgREST request with no
 * `.range()` and no `.order()`. PostgREST caps every response at `db-max-rows` (`supabase/config.toml`
 * `max_rows = 1000`; also Supabase Cloud's default) and signals NOTHING when it truncates — HTTP 200,
 * short body, `error === null` — and with no `ORDER BY`, WHICH 1000 rows come back is arbitrary and
 * may differ between ticks. The refresh then DELETEd the org's whole prior snapshot and inserted the
 * partial sums with a FRESH `as_of`.
 *
 * That is the worst variant of the money-honesty class shipped so far. Every earlier defect rendered
 * an UNKNOWN figure as a number; this one renders a WRONG figure as a CONFIDENTLY-KNOWN one: the
 * projection sees a non-null `as_of` on a mapped category, so the money-honesty invariant CERTIFIES
 * it — understated actuals, an inflated favourable variance and a deflated utilization, dated, under
 * the green "Enforced by ERPNext" pill, and a DIFFERENT wrong number on the next tick.
 *
 * The repo had already found, documented and fixed exactly this class at another scope
 * (`src/lib/db/revenue.ts` `fetchAllPages`, whose comment names `max_rows`), and the ERPNext side of
 * this very pipeline pages correctly (`ledgerFetch.ts`). The one hop nobody paged was reading the
 * mirror back OUT of Postgres. Both halves are pinned here: page it, and order it.
 */
describe('erpnext/actualsSnapshot — HIGH-1: the mirror read is PAGED past PostgREST max_rows (AC-ENA-062)', () => {
  const PROJ_A = '11111111-1111-4111-8111-111111111111';

  /** 2,500 GL rows across 3 groups — 2.5× the 1000-row cap, so a single request cannot see them all. */
  function bigMirror(): { rows: Record<string, unknown>[]; expected: Record<string, number> } {
    const rows: Record<string, unknown>[] = [];
    const expected: Record<string, number> = { '5100': 0, '5200': 0, '5300': 0 };
    for (let i = 0; i < 2500; i += 1) {
      const account = ['5100', '5200', '5300'][i % 3]!;
      const debit = 100 + i; // distinct amounts, so a missed row cannot be masked by a coincidence
      rows.push({ project: 'PROJ-0001', cost_center: null, account, fiscal_year: '2026', debit, credit: 0 });
      expected[account] += debit;
    }
    return { rows, expected };
  }

  it('sums EVERY mirrored GL row, not the first 1000 PostgREST chose to return', async () => {
    const { rows, expected } = bigMirror();
    const client = makeClient(rows);
    const summary = await refreshActuals(client as unknown as never, 'org-1', { projectMap: { [PROJ_A]: 'PROJ-0001' } });

    const inserted = client.inserted[0]!;
    const byAccount = Object.fromEntries(inserted.map((r) => [String(r.account), r]));
    expect(byAccount['5100']).toMatchObject({ net: expected['5100'] });
    expect(byAccount['5200']).toMatchObject({ net: expected['5200'] });
    expect(byAccount['5300']).toMatchObject({ net: expected['5300'] });
    // The falsifier in aggregate: the snapshot's total net === the mirror's total debit − credit.
    const snapshotTotal = inserted.reduce((acc, r) => acc + Number(r.net), 0);
    const mirrorTotal = Object.values(expected).reduce((a, b) => a + b, 0);
    expect(snapshotTotal).toBe(mirrorTotal);
    expect(summary).toEqual({ rows: 3, undatedRows: 0 });
  });

  it('issues MULTIPLE bounded requests (a short page proves the end of the set)', async () => {
    const { rows } = bigMirror();
    const client = makeClient(rows);
    await refreshActuals(client as unknown as never, 'org-1', { projectMap: { [PROJ_A]: 'PROJ-0001' } });
    // 2500 rows at a 1000-row page size ⇒ 1000 + 1000 + 500 (the short page terminates the scan).
    expect(client.mirrorReads.map((r) => r.returned)).toEqual([1000, 1000, 500]);
    // KEYSET, not offset: page 1 opens the scan, pages 2-3 resume strictly AFTER the previous last id.
    // (Offset would re-count a row when the sweep's own ledger feed inserts during the scan — the
    // 5-minute cron has no single-flight guard, so a slow backfill tick overlaps the next tick.)
    expect(client.mirrorReads.map((r) => r.cursors)).toEqual([[], ['gl-00000999'], ['gl-00001999']]);
  });

  it('applies a deterministic ORDER BY so a truncated or resumed read is stable (no row read twice)', async () => {
    const { rows } = bigMirror();
    const client = makeClient(rows);
    await refreshActuals(client as unknown as never, 'org-1', { projectMap: { [PROJ_A]: 'PROJ-0001' } });
    // `id` is the mirror's uuid PK (0101) — a TOTAL order, so consecutive pages cannot overlap or gap.
    expect(client.mirrorReads.every((r) => r.orderBy.includes('id'))).toBe(true);
    // Every row lands EXACTLY once: 2500 distinct debits, so a duplicate or a gap moves the total.
    const total = client.inserted[0]!.reduce((acc, r) => acc + Number(r.net), 0);
    expect(total).toBe(Array.from({ length: 2500 }, (_, i) => 100 + i).reduce((a, b) => a + b, 0));
  });

  it('an exact multiple of the page size still terminates (the empty trailing page)', async () => {
    const rows = Array.from({ length: DEFAULT_MAX_ROWS }, (_, i) => ({
      project: 'PROJ-0001', cost_center: null, account: '5100', fiscal_year: '2026', debit: i + 1, credit: 0,
    }));
    const client = makeClient(rows);
    await refreshActuals(client as unknown as never, 'org-1', { projectMap: { [PROJ_A]: 'PROJ-0001' } });
    const expectedNet = (DEFAULT_MAX_ROWS * (DEFAULT_MAX_ROWS + 1)) / 2;
    expect(client.inserted[0]![0]).toMatchObject({ net: expectedNet });
  });
});
