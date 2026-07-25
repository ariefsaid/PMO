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
  const calls = { table: '' as string, ranges: [] as Array<[number, number]>, tieRotations: 0, requests: 0 };
  let nextData: Record<string, unknown>[] | null = null;
  const stamp = (d: Record<string, unknown>[]) =>
    d.map((r, i) => ({ id: r.id ?? `row-${String(i).padStart(6, '0')}`, ...r }));
  /**
   * ⚑ Audit round 10. Scheduled mid-read snapshot REPLACES — the sweep swapping a generation while the
   * DAL is part-way through paging it. Round 9 added the fail-closed machinery for exactly this and
   * left it untested (the `replaceWith` hook written for it was never called by anything). It is
   * driven here: `replaceAfterRequest(n, rows)` swaps the table's contents immediately AFTER the nth
   * PostgREST request, so a scan can be torn between two of its own pages.
   */
  const scheduledReplaces = new Map<number, Record<string, unknown>[]>();
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
        settle();
        return Promise.resolve({ data: window, error: null });
      },
      then(resolve: (v: unknown) => unknown) {
        const rows = b.rows().slice(0, MAX_ROWS);
        settle();
        return resolve({ data: rows, error: null });
      },
    };
    /** One PostgREST request has completed — apply any replace scheduled for this point. */
    function settle() {
      calls.requests += 1;
      const swap = scheduledReplaces.get(calls.requests);
      if (swap) nextData = stamp(swap);
    }
    return b;
  }
  const from = vi.fn((table: string) => { calls.table = table; return makeBuilder(); });
  return {
    from, calls, MAX_ROWS,
    setData: (d: Record<string, unknown>[] | null) => {
      nextData = d === null ? null : stamp(d);
      calls.ranges = []; calls.tieRotations = 0; calls.requests = 0;
      scheduledReplaces.clear();
    },
    /** Swap the table's whole contents right AFTER the nth PostgREST request of the current test. */
    replaceAfterRequest: (n: number, d: Record<string, unknown>[]) => { scheduledReplaces.set(n, d); },
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

  // The stale-generation filter. Two `snapshot_id`s in one table is unreachable in production since
  // migration 0150 made snapshot-replace one statement — but the read does not DEPEND on that: it
  // resolves the newest `snapshot_id` and pins it SERVER-side (`.eq('snapshot_id', anchor)`).
  //
  // ⚑ Audit round 10 (LOW-2): the client-side `latestSnapshotOnly()` these two tests used to exercise
  // is DELETED. It claimed to take "the first row's snapshot_id, since the query orders created_at
  // desc" — but the query orders the `id` PK ascending, so under the obvious mutation (drop the
  // server-side filter) it would have kept the LOWEST-id row and silently preserved the STALE
  // generation, and these fixtures passed under exactly that mutation because the newer row was seeded
  // first and got the lower synthetic id. The assertions below now bind the SERVER-side filter, which
  // is the real one: remove the `.eq('snapshot_id', anchor)` and both go red.
  it('listActualsSnapshot returns only the newest generation when two coexist (server-side snapshot_id pin)', async () => {
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

  it('listApAgingSnapshot returns only the newest generation when two coexist', async () => {
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
/**
 * ⚑ Audit round 10 (MED-1) — THE MID-READ REPLACE, finally driven.
 *
 * Round 9 added an anchor re-assert, a bounded retry and a fail-closed error for the case where the
 * sweep swaps the snapshot generation while the DAL is part-way through paging it — and covered NONE
 * of it. The fake even grew a `replaceWith` hook for the purpose that nothing ever called. So the
 * retry, the bound and the error were all assertions-by-comment.
 *
 * Migration 0150 made snapshot-replace ONE statement, which removes the torn MIX and the
 * zero-generation window — but NOT this: the READ is still multi-statement. Anchor S1, take page 0,
 * the sweep atomically publishes S2, ask for page 1 of S1 and get zero rows — an ordinary-looking
 * SHORT PAGE — and a pager without the re-assert stops there and returns a PREFIX of a generation that
 * no longer exists, with `error === null`. Understated money that nothing on screen can question.
 * That is why the re-assert survived round 10's deletions, and it is why it is pinned here.
 */
describe('erpSnapshots — a snapshot REPLACED mid-read is never returned truncated', () => {
  /** `n` rows of one generation, id-ordered so the keyset scan pages them deterministically. */
  function generation(snapshotId: string, n: number, net: number): Record<string, unknown>[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `row-${String(i).padStart(6, '0')}`,
      project_id: `p-${i}`, cost_center: null, account: `acct-${i}`, fiscal_year: '2026',
      debit: net, credit: 0, net, as_of: '2026-07-22T00:00:00Z', source_report: 'GL',
      snapshot_id: snapshotId, created_at: `2026-07-22T00:00:0${snapshotId === 'snap-1' ? '0' : '1'}Z`,
    }));
  }

  it('retries against the new generation instead of returning the prefix it had in hand', async () => {
    h.setData(generation('snap-1', 2400, 10));
    // Request 1 = the anchor read, request 2 = page 0 of the scan. Swap right after page 0, so page 1
    // of `snap-1` comes back EMPTY and the pager would otherwise stop on 1000 of 2400 rows.
    h.replaceAfterRequest(2, generation('snap-2', 1500, 20));

    const out = await listActualsSnapshot();

    expect(out).toHaveLength(1500);
    expect(out.every((r) => r.snapshotId === 'snap-2')).toBe(true);
    // The falsifier: without the anchor re-assert this is 1000 rows of the generation that is gone.
    expect(out).not.toHaveLength(1000);
  });

  it('fails closed when the snapshot keeps moving — never a partial money table with error === null', async () => {
    h.setData(generation('snap-1', 2400, 10));
    // Attempt 1 = requests 1-5 (anchor, 3 pages, re-assert); attempt 2 starts at request 6. Swap after
    // page 0 of BOTH attempts, so neither can ever hold a whole generation.
    h.replaceAfterRequest(2, generation('snap-2', 2400, 20));
    h.replaceAfterRequest(6, generation('snap-3', 2400, 30));

    await expect(listActualsSnapshot()).rejects.toMatchObject({ code: 'snapshot-replaced-mid-read' });
  });

  it('a replace that lands entirely BEFORE the read is simply read — the happy path stays quiet', async () => {
    h.setData(generation('snap-1', 3, 10));
    h.replaceAfterRequest(99, generation('snap-2', 3, 20)); // never reached
    const out = await listActualsSnapshot();
    expect(out).toHaveLength(3);
    expect(out.every((r) => r.snapshotId === 'snap-1')).toBe(true);
  });
});

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
