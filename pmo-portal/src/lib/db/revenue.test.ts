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
    /** The `.in(column, values)` filters the DAL applied to the invoice scan. */
    inFilters: [] as Array<{ column: string; values: unknown }>,
    /** Every `.order(column, opts)` the DAL applied, in order. */
    orders: [] as Array<{ column: string; ascending?: boolean }>,
    invoiceQueries: 0,
  };

  function builder(table: string) {
    const b = {
      select() { return b; },
      neq() { return b; },
      order(column: string, opts?: { ascending?: boolean }) {
        state.orders.push({ column, ascending: opts?.ascending });
        return b;
      },
      in(column: string, values: unknown) { state.inFilters.push({ column, values }); return b; },
      range(from: number, to: number) { state.ranges.push([from, to]); return b; },
      then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
        if (table === 'projects') return resolve({ data: state.projects, error: null });
        state.invoiceQueries += 1;
        return resolve({ data: state.invoicePages.shift() ?? [], error: null });
      },
    };
    return b;
  }

  return { from: vi.fn((table: string) => builder(table)), state };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { getRevenueByProject } from './revenue';

/** `n` invoices for one project, each `amount` billed with `outstanding` still open. */
function invoices(n: number, projectId: string | null, amount: number, outstanding: number) {
  return Array.from({ length: n }, () => ({ project_id: projectId, amount, erp_outstanding_amount: outstanding }));
}

beforeEach(() => {
  h.state.invoicePages = [];
  h.state.projects = [];
  h.state.ranges = [];
  h.state.inFilters = [];
  h.state.orders = [];
  h.state.invoiceQueries = 0;
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
    // It kept paging until a SHORT page proved the end of the set.
    expect(h.state.ranges).toEqual([[0, 999], [1000, 1999]]);
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

  it('returns an empty rollup (and asks for no project names) when the org has no invoices', async () => {
    h.state.invoicePages = [[]];
    const rows = await getRevenueByProject();
    expect(rows).toEqual([]);
    expect(h.from).not.toHaveBeenCalledWith('projects');
  });
});
