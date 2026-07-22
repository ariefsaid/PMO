/**
 * db/erpSnapshots.ts (task 7.7): the read-only DAL over the three slice-7 snapshot tables. RLS-scoped
 * (org_id never sent); no write path — snapshots are machine-written by the sweep. Returns the
 * current-scope rows (single as_of — snapshot-replace keeps one snapshot_id per scope).
 *
 * RED until erpSnapshots.ts exists. Asserts: each read maps to camelCase, returns the current-scope
 * rows (single as_of), and is empty for a non-employing org (no snapshot rows).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * ⚑ Audit round 8: this fake used to be thenable-only — `select().order()` resolved the WHOLE set,
 * with no `eq`, no `range`, and NO CAP. It therefore could not express the one behaviour that matters
 * here: PostgREST truncates every response at `max_rows` (1000) and signals NOTHING when it does
 * (200, short body, `error === null`). A fake more permissive than the real system is how the
 * unpaged-read class survived eight audit rounds, so this one models the real thing: it honours
 * `.eq()` filtering and `.range()` windows, and it CAPS every window at `MAX_ROWS`.
 */
const h = vi.hoisted(() => {
  const MAX_ROWS = 1000;
  const calls = { table: '' as string, ranges: [] as Array<[number, number]>, tieRotations: 0 };
  let nextData: Record<string, unknown>[] | null = null;
  function makeBuilder() {
    const filters: Array<[string, string]> = [];
    let after: string | null = null;
    let orderCol: string | null = null;
    let orderAsc = true;
    let cap: number | null = null;
    const b = {
      select() { return b; },
      order(col?: string, opts?: { ascending?: boolean }) { orderCol = col ?? null; orderAsc = opts?.ascending !== false; return b; },
      eq(col: string, val: string) { filters.push([col, val]); return b; },
      gt(col: string, val: string) { if (col === 'id') after = val; return b; },
      limit(n: number) { cap = n; return b; },
      rows() {
        const all = nextData ?? [];
        let rows = filters.length === 0 ? all : all.filter((r) => filters.every(([c, v]) => r[c] === v));
        // ⚑ Audit round 9: model a NON-TOTAL order honestly. When the query orders on a column whose
        // values tie (every row of one snapshot shares `created_at`), the server is free to return
        // ties in ANY order — so the fake rotates them per call. A pager that depends on a stable
        // order across requests then loses rows here, exactly as Postgres would.
        if (orderCol) {
          // Sort like the DB would, respecting the direction the caller asked for.
          const dir = orderAsc ? 1 : -1;
          rows = [...rows].sort((x, y) => dir * String(x[orderCol!] ?? '').localeCompare(String(y[orderCol!] ?? '')));
          // ⚑ Then model a NON-TOTAL order honestly: rows whose order value TIES may come back in ANY
          // order, and in a different one each call. A pager that assumes a stable order across
          // requests loses rows here, exactly as Postgres would. `id` is the PK, so it never ties.
          if (orderCol !== 'id' && rows.length > 1 && rows.every((r) => r[orderCol!] === rows[0][orderCol!])) {
            calls.tieRotations += 1;
            const k = calls.tieRotations % rows.length;
            rows = rows.slice(k).concat(rows.slice(0, k));
          }
        }
        if (after !== null) rows = rows.filter((r) => String(r.id) > after!);
        return cap === null ? rows : rows.slice(0, cap);
      },
      range(from: number, to: number) {
        calls.ranges.push([from, to]);
        // PostgREST semantics: an inclusive window, hard-capped at MAX_ROWS, silent when it caps.
        const window = b.rows().slice(from, Math.min(to + 1, from + MAX_ROWS));
        return Promise.resolve({ data: window, error: null });
      },
      then(resolve: (v: unknown) => unknown) {
        return resolve({ data: b.rows().slice(0, MAX_ROWS), error: null });
      },
    };
    return b;
  }
  const from = vi.fn((table: string) => { calls.table = table; return makeBuilder(); });
  return {
    from, calls, MAX_ROWS,
    setData: (d: Record<string, unknown>[] | null) => {
      nextData = d === null ? null : d.map((r, i) => ({ id: r.id ?? `row-${String(i).padStart(6, '0')}`, ...r }));
      calls.ranges = []; calls.tieRotations = 0;
    },
    replaceWith: (d: Record<string, unknown>[]) => { nextData = d; },
  };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listActualsSnapshot, listApAgingSnapshot, listArAgingSnapshot } from './erpSnapshots';

beforeEach(() => { h.calls.table = ''; h.setData(null); h.from.mockClear(); });

describe('db/erpSnapshots — read-only snapshot DAL (task 7.7)', () => {
  it('listActualsSnapshot reads erp_actuals_snapshot + maps to camelCase', async () => {
    h.setData([
      { cost_center: 'Main - PSC', account: 'Cash - PSC', fiscal_year: '2026', debit: 50000, credit: 0, net: 50000, as_of: '2026-07-12T10:00:00Z', source_report: 'GL Entry', snapshot_id: 'snap-1', project_id: null },
    ]);
    const rows = await listActualsSnapshot();
    expect(h.calls.table).toBe('erp_actuals_snapshot');
    expect(rows).toEqual([
      { projectId: null, costCenter: 'Main - PSC', account: 'Cash - PSC', fiscalYear: '2026', debit: 50000, credit: 0, net: 50000, asOf: '2026-07-12T10:00:00Z', sourceReport: 'GL Entry', snapshotId: 'snap-1' },
    ]);
  });

  it('listActualsSnapshot returns the current scope only (single as_of — snapshot-replace keeps one snapshot_id)', async () => {
    h.setData([
      { cost_center: 'A', account: 'X', fiscal_year: '2026', debit: 1, credit: 0, net: 1, as_of: '2026-07-12T10:00:00Z', source_report: 'GL Entry', snapshot_id: 'snap-current', project_id: null },
      { cost_center: 'B', account: 'Y', fiscal_year: '2026', debit: 2, credit: 0, net: 2, as_of: '2026-07-12T10:00:00Z', source_report: 'GL Entry', snapshot_id: 'snap-current', project_id: null },
    ]);
    const rows = await listActualsSnapshot();
    expect(rows.map((r) => r.snapshotId)).toEqual(['snap-current', 'snap-current']); // one coherent snapshot
    expect(new Set(rows.map((r) => r.asOf)).size).toBe(1);
  });

  it('listApAgingSnapshot reads erp_ap_aging_snapshot + maps bucket/provenance cols to camelCase', async () => {
    h.setData([
      { party: 'Spike Supplier', party_type: 'Supplier', currency: 'IDR', total_outstanding: 75000, current: 0, b_0_30: 75000, b_31_60: 0, b_61_90: 0, b_90_plus: 0, range_labels: { range1: '0-30' }, report_date: '2026-07-12', ageing_based_on: 'Due Date', as_of: '2026-07-12T10:00:00Z', source_report: 'Accounts Payable', report_version: 'erpnext-15.94.3/frappe-15.96.0', snapshot_id: 'snap-1' },
    ]);
    const rows = await listApAgingSnapshot();
    expect(h.calls.table).toBe('erp_ap_aging_snapshot');
    expect(rows[0]).toEqual({
      party: 'Spike Supplier', partyType: 'Supplier', currency: 'IDR', totalOutstanding: 75000, current: 0,
      bucket0to30: 75000, bucket31to60: 0, bucket61to90: 0, bucketOver90: 0,
      rangeLabels: { range1: '0-30' }, reportDate: '2026-07-12', ageingBasedOn: 'Due Date',
      asOf: '2026-07-12T10:00:00Z', sourceReport: 'Accounts Payable', reportVersion: 'erpnext-15.94.3/frappe-15.96.0', snapshotId: 'snap-1',
    });
  });

  it('listArAgingSnapshot reads erp_ar_aging_snapshot', async () => {
    h.setData([
      { party: 'Cust A', party_type: 'Customer', currency: 'IDR', total_outstanding: 0, current: 0, b_0_30: 0, b_31_60: 0, b_61_90: 0, b_90_plus: 0, range_labels: null, report_date: null, ageing_based_on: null, as_of: '2026-07-12T10:00:00Z', source_report: 'Accounts Receivable', report_version: 'v', snapshot_id: 's' },
    ]);
    const rows = await listArAgingSnapshot();
    expect(h.calls.table).toBe('erp_ar_aging_snapshot');
    expect(rows[0]!.party).toBe('Cust A');
  });

  // task FIX-7 (Quality MINOR 5) — the latest-snapshot_id filter hardening: a concurrent double-sweep
  // race (delete of pass 2 racing the insert of pass 1) can leave rows from TWO snapshot_ids in the
  // table simultaneously. The read must not blindly trust "one snapshot_id per scope" — it filters to
  // only the MOST RECENT snapshot_id (the first row's, since the query already orders `created_at`
  // desc) so a stale generation's rows never mix into the rendered read.
  it('listActualsSnapshot filters out a stale snapshot_id when two generations coexist (concurrent-sweep race hardening)', async () => {
    h.setData([
      // Newest first (query orders created_at desc) — the CURRENT generation.
      { cost_center: 'A', account: 'X', fiscal_year: '2026', debit: 1, credit: 0, net: 1, as_of: '2026-07-13T10:00:00Z', source_report: 'GL Entry', snapshot_id: 'snap-new', project_id: null, created_at: '2026-07-13T10:00:00Z' },
      // A STALE row left behind from a prior generation that a racing delete failed to clear.
      { cost_center: 'B', account: 'Y', fiscal_year: '2026', debit: 2, credit: 0, net: 2, as_of: '2026-07-12T10:00:00Z', source_report: 'GL Entry', snapshot_id: 'snap-old', project_id: null, created_at: '2026-07-12T10:00:00Z' },
    ]);
    const rows = await listActualsSnapshot();
    expect(rows).toHaveLength(1);
    expect(rows[0].snapshotId).toBe('snap-new');
  });

  it('listApAgingSnapshot filters out a stale snapshot_id when two generations coexist', async () => {
    h.setData([
      { party: 'Fresh Co', party_type: 'Supplier', currency: 'USD', total_outstanding: 100, current: 100, b_0_30: 0, b_31_60: 0, b_61_90: 0, b_90_plus: 0, range_labels: null, report_date: '2026-07-13', ageing_based_on: 'Due Date', as_of: '2026-07-13T10:00:00Z', source_report: 'Accounts Payable', report_version: '15', snapshot_id: 'snap-new', created_at: '2026-07-13T10:00:00Z' },
      { party: 'Stale Co', party_type: 'Supplier', currency: 'USD', total_outstanding: 200, current: 200, b_0_30: 0, b_31_60: 0, b_61_90: 0, b_90_plus: 0, range_labels: null, report_date: '2026-07-12', ageing_based_on: 'Due Date', as_of: '2026-07-12T10:00:00Z', source_report: 'Accounts Payable', report_version: '15', snapshot_id: 'snap-old', created_at: '2026-07-12T10:00:00Z' },
    ]);
    const rows = await listApAgingSnapshot();
    expect(rows).toHaveLength(1);
    expect(rows[0].party).toBe('Fresh Co');
  });

  it('a non-employing org (no snapshot rows yet) returns [] — empty state, never throws', async () => {
    h.setData(null); // no rows
    expect(await listActualsSnapshot()).toEqual([]);
    expect(await listApAgingSnapshot()).toEqual([]);
    expect(await listArAgingSnapshot()).toEqual([]);
  });
});

/**
 * ⚑ Audit round 8, the `max_rows` class at THIS scope. These reads used to fetch the table unbounded
 * and filter to the newest snapshot CLIENT-side. `erp_actuals_snapshot` is one row per
 * (project x account x fiscal_year), which a mid-size client clears easily (50 projects x 30 accounts
 * x 2 years = 3,000), so PostgREST's silent 1000-row cap could slice through the MIDDLE of the latest
 * snapshot and render a PARTIAL one as complete — understated money, with nothing on screen or in the
 * response to say so.
 */
describe('erpSnapshots — a snapshot LARGER than PostgREST max_rows is returned WHOLE', () => {
  it('returns every row of the latest snapshot, not the first page of it', async () => {
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < 2400; i += 1) {
      rows.push({
        project_id: `p-${i}`, cost_center: null, account: `acct-${i}`, fiscal_year: '2026',
        debit: 10, credit: 0, net: 10, as_of: '2026-07-22T00:00:00Z',
        source_report: 'GL', snapshot_id: 'snap-current', created_at: '2026-07-22T00:00:00Z',
      });
    }
    // A previous generation that must still be excluded — the filter moved server-side, not away.
    rows.push({
      project_id: 'p-old', cost_center: null, account: 'acct-old', fiscal_year: '2025',
      debit: 99, credit: 0, net: 99, as_of: '2026-01-01T00:00:00Z',
      source_report: 'GL', snapshot_id: 'snap-previous', created_at: '2026-01-01T00:00:00Z',
    });
    h.setData(rows);

    const out = await listActualsSnapshot();

    expect(out).toHaveLength(2400);
    expect(out.every((r) => r.snapshotId === 'snap-current')).toBe(true);
    // It cannot have come back in one request: the cap is 1000, so paging is the only way to 2400.
    expect(h.calls.ranges.length).toBeGreaterThan(1);
  });
});
