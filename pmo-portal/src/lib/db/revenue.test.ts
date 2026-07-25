/**
 * db/revenue.ts — the project revenue rollup (`getRevenueByProject`).
 *
 * Money-safety audit SHOULD-FIX 3: the rollup fetched every non-cancelled `sales_invoices` row and
 * aggregated CLIENT-side with no pagination. PostgREST caps a response at `max_rows = 1000`
 * (supabase/config.toml) and signals NOTHING when it truncates — so past 1000 invoices
 * `total_amount`, `open_ar` and `invoice_count` are all silently UNDERSTATED on every revenue view,
 * and the understatement grows with the org. These tests drive the paged read that closes it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    /** Successive `sales_invoices` responses, one per `.range()` page the DAL requests. */
    invoicePages: [] as Array<Array<Record<string, unknown>>>,
    projects: [] as Array<{ id: string; name: string }>,
    /** Every `[from, to]` the DAL asked PostgREST for, in order. */
    ranges: [] as Array<[number, number]>,
    /** Every keyset cursor (`.gt('id', …)`) the DAL asked for, in order. */
    cursors: [] as Array<[string, unknown]>,
    /** Every `.limit(n)` the DAL asked for, in order. */
    limits: [] as number[],
    /** The `.in(column, values)` filters the DAL applied to the invoice scan. */
    inFilters: [] as Array<{ column: string; values: unknown }>,
    /** Every `.order(column, opts)` the DAL applied, in order. */
    orders: [] as Array<{ column: string; ascending?: boolean }>,
    invoiceQueries: 0,
    /** LIVE-TABLE mode: when set, invoice queries are served from this mutable, id-ordered table. */
    table: null as Array<Record<string, unknown>> | null,
    /** Fired ONCE, after the next invoice query is served — simulates a concurrent write. */
    mutateAfterQuery: null as (() => void) | null,
  };

  function builder(table: string) {
    /** This query's own cursor/limit/range, for the LIVE-TABLE mode below. */
    let cursor: string | null = null;
    let cap = Number.POSITIVE_INFINITY;
    let window: [number, number] | null = null;
    const b = {
      select() { return b; },
      neq() { return b; },
      order(column: string, opts?: { ascending?: boolean }) {
        state.orders.push({ column, ascending: opts?.ascending });
        return b;
      },
      in(column: string, values: unknown) { state.inFilters.push({ column, values }); return b; },
      gt(column: string, value: unknown) { state.cursors.push([column, value]); cursor = String(value); return b; },
      range(from: number, to: number) { state.ranges.push([from, to]); window = [from, to]; return b; },
      limit(n: number) { state.limits.push(n); cap = n; return b; },
      then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
        if (table === 'projects') return resolve({ data: state.projects, error: null });
        state.invoiceQueries += 1;
        // LIVE-TABLE mode (NIT 2): a real, id-ordered table that a hook may MUTATE between page
        // reads — the only way to observe an offset scan double-counting a row.
        if (state.table) {
          const ordered = [...state.table].sort((x, y) => String(x.id).localeCompare(String(y.id)));
          const after = cursor === null ? ordered : ordered.filter((r) => String(r.id) > cursor!);
          const page = window ? after.slice(window[0], window[1] + 1) : after.slice(0, cap);
          const mutate = state.mutateAfterQuery;
          if (mutate) { state.mutateAfterQuery = null; mutate(); }
          return resolve({ data: page, error: null });
        }
        return resolve({ data: state.invoicePages.shift() ?? [], error: null });
      },
    };
    return b;
  }

  return { from: vi.fn((table: string) => builder(table)), state };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { getRevenueByProject } from './revenue';

/** `n` invoices for one project, each `amount` billed with `outstanding` still open. Ids are unique
 *  and sort in insertion order — the keyset scan reads its cursor from the last row of each page. */
let nextInvoiceId = 0;
function invoices(n: number, projectId: string | null, amount: number, outstanding: number) {
  return Array.from({ length: n }, () => ({
    id: `si-${String(nextInvoiceId++).padStart(6, '0')}`,
    project_id: projectId,
    amount,
    erp_outstanding_amount: outstanding,
  }));
}

beforeEach(() => {
  h.state.invoicePages = [];
  h.state.projects = [];
  h.state.ranges = [];
  h.state.cursors = [];
  h.state.limits = [];
  h.state.inFilters = [];
  h.state.orders = [];
  h.state.invoiceQueries = 0;
  h.state.table = null;
  h.state.mutateAfterQuery = null;
  nextInvoiceId = 0;
  h.from.mockClear();
});

describe('db/revenue getRevenueByProject — the rollup must not silently truncate at PostgREST max_rows', () => {
  it('aggregates EVERY invoice past the 1000-row PostgREST cap (no silent understatement)', async () => {
    h.state.projects = [{ id: 'proj-1', name: 'Alpha' }];
    // A full page (exactly the cap) followed by a partial one — what PostgREST returns for 1500 rows.
    h.state.invoicePages = [
      invoices(1000, 'proj-1', 10, 4),
      invoices(500, 'proj-1', 10, 4),
    ];

    const rows = await getRevenueByProject();

    expect(rows).toEqual([
      { project_id: 'proj-1', project_name: 'Alpha', total_amount: 15_000, open_ar: 6_000, invoice_count: 1500 },
    ]);
    // It kept paging until a SHORT page proved the end of the set — in bounded, cursor-advanced
    // pages (NIT 2: keyset, not offset).
    expect(h.state.limits).toEqual([1000, 1000]);
    expect(h.state.cursors).toEqual([['id', 'si-000999']]);
  });

  it('scans ONLY submitted-invoice statuses — a Draft never inflates project revenue (SHOULD-FIX 4, owner ruling)', async () => {
    h.state.projects = [{ id: 'proj-1', name: 'Alpha' }];
    h.state.invoicePages = [invoices(3, 'proj-1', 10, 4)];

    await getRevenueByProject();

    // The exclusion is a server-side filter (drafts must never reach the client aggregate), so the
    // oracle is the query the DAL issues: a positive allow-list of the submitted states, never a
    // bare "not Cancelled" that would let Draft through, and never omitted. (A separate `.in('id',…)`
    // on `projects` resolves names — assert on the `status` filter specifically, not every `.in`.)
    const statusFilter = h.state.inFilters.find((f) => f.column === 'status');
    expect(statusFilter?.values).toEqual(['Submitted', 'Unpaid', 'Paid']);
    expect(statusFilter?.values).not.toContain('Draft');
    expect(statusFilter?.values).not.toContain('Cancelled');
  });

  it('pages on a STABLE order (id asc) — without one, a concurrent write can double-count or skip an invoice (S1)', async () => {
    h.state.projects = [{ id: 'proj-1', name: 'Alpha' }];
    h.state.invoicePages = [invoices(1000, 'proj-1', 10, 4), invoices(1, 'proj-1', 10, 4)];

    await getRevenueByProject();

    // Postgres guarantees NO row order across statements: `.range()` without an ORDER BY can move a
    // tuple between page reads, so Total Revenue silently drifts by up to a whole invoice.
    expect(h.state.orders).toContainEqual({ column: 'id', ascending: true });
  });

  it('stops after a single request when the first page is short (no needless round-trips)', async () => {
    h.state.projects = [{ id: 'proj-1', name: 'Alpha' }];
    h.state.invoicePages = [invoices(3, 'proj-1', 100, 25)];

    const rows = await getRevenueByProject();

    expect(rows).toEqual([
      { project_id: 'proj-1', project_name: 'Alpha', total_amount: 300, open_ar: 75, invoice_count: 3 },
    ]);
    expect(h.state.invoiceQueries).toBe(1);
  });

  it('stops when a full page is followed by an empty one (an exact multiple of the page size)', async () => {
    h.state.projects = [{ id: 'proj-1', name: 'Alpha' }];
    h.state.invoicePages = [invoices(1000, 'proj-1', 1, 0), []];

    const rows = await getRevenueByProject();

    expect(rows[0].invoice_count).toBe(1000);
    expect(h.state.invoiceQueries).toBe(2);
  });

  it('keeps the Unassigned bucket and the per-project names across pages', async () => {
    h.state.projects = [{ id: 'proj-1', name: 'Alpha' }];
    h.state.invoicePages = [
      [...invoices(999, 'proj-1', 10, 0), ...invoices(1, null, 50, 50)],
      invoices(1, null, 50, 50),
    ];

    const rows = await getRevenueByProject();

    expect(rows).toEqual(
      expect.arrayContaining([
        { project_id: 'proj-1', project_name: 'Alpha', total_amount: 9_990, open_ar: 0, invoice_count: 999 },
        { project_id: null, project_name: null, total_amount: 100, open_ar: 100, invoice_count: 2 },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  // ── Round-6 re-audit, NIT 2: OFFSET paging is repeatable under a stable ORDER BY, but it still
  // MIS-COUNTS when a row is written between page reads — an insert with a lower-sorting id shifts
  // every later row one slot right, so `range(1000, 1999)` re-reads the invoice that was already
  // counted as the last row of page 0. Total Revenue then silently overstates by a whole invoice,
  // on every org past 1000 invoices. A keyset cursor (`id > last-seen`) cannot: it names the row it
  // resumes AFTER, so a concurrent insert can neither duplicate nor skip an already-scanned row.
  it('NIT 2: a concurrent insert between page reads never double-counts (keyset cursor, not offset)', async () => {
    h.state.projects = [{ id: 'proj-1', name: 'Alpha' }];
    // Exactly one full page of invoices, each 10.00 — so the scan must ask for a second page.
    h.state.table = invoices(1000, 'proj-1', 10, 0);
    // …and, between the two reads, someone raises an invoice that sorts BEFORE every existing row.
    h.state.mutateAfterQuery = () => {
      h.state.table!.push({ id: 'si-000000-a', project_id: 'proj-1', amount: 10, erp_outstanding_amount: 0 });
    };

    const rows = await getRevenueByProject();

    expect(rows[0].invoice_count).toBe(1000);
    expect(rows[0].total_amount).toBe(10_000);
  });

  it('returns an empty rollup (and asks for no project names) when the org has no invoices', async () => {
    h.state.invoicePages = [[]];
    const rows = await getRevenueByProject();
    expect(rows).toEqual([]);
    expect(h.from).not.toHaveBeenCalledWith('projects');
  });
});
