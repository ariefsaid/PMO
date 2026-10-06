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
    /** Successive `sales_invoice_work_billed` responses (the net-of-tax billed-work view, #831). */
    workPages: [] as Array<Array<Record<string, unknown>>>,
    /** Tables the DAL scanned, in order. */
    scanned: [] as string[],
    projects: [] as Array<{ id: string; name: string }>,
    /** Singular reads: data served by `.maybeSingle()` per table. */
    singles: {} as Record<string, Record<string, unknown> | null>,
    /** Every `.select(columns)` the DAL issued, in order. */
    columnCalls: [] as Array<{ table: string; columns: string }>,
    /** Every `.eq(col, val)` the DAL issued, in order. */
    eqCalls: [] as Array<[string, unknown]>,
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
      select(columns?: string) {
        if (columns) state.columnCalls.push({ table, columns });
        return b;
      },
      eq(column: string, value: unknown) { state.eqCalls.push([column, value]); return b; },
      maybeSingle() { return Promise.resolve({ data: state.singles[table] ?? null, error: null }); },
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
        state.scanned.push(table);
        if (table === 'sales_invoice_work_billed' && !state.table) {
          return resolve({ data: state.workPages.shift() ?? [], error: null });
        }
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

import { getRevenueByProject, getSalesInvoice, getIncomingPayment } from './revenue';

/** `n` invoices for one project, each `amount` billed with `outstanding` still open. Ids are unique
 *  and sort in insertion order — the keyset scan reads its cursor from the last row of each page. */
let nextInvoiceId = 0;
function invoices(n: number, projectId: string | null, amount: number, outstanding: number) {
  return Array.from({ length: n }, () => ({
    id: `si-${String(nextInvoiceId++).padStart(6, '0')}`,
    project_id: projectId,
    currency: 'USD',
    amount,
    erp_outstanding_amount: outstanding,
  }));
}

/** `n` billed-work view rows (net of tax) — what `sales_invoice_work_billed` serves. */
function work(n: number, projectId: string | null, net: number, currency = 'USD', recovery = 0) {
  return Array.from({ length: n }, () => ({
    id: `si-${String(nextInvoiceId++).padStart(6, '0')}`,
    project_id: projectId,
    currency,
    net,
    recovery,
  }));
}

beforeEach(() => {
  h.state.invoicePages = [];
  h.state.workPages = [];
  h.state.scanned = [];
  h.state.projects = [];
  h.state.singles = {};
  h.state.columnCalls = [];
  h.state.eqCalls = [];
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

describe('db/revenue getRevenueByProject — net of tax, per currency, paged', () => {
  it('AC-831-1: sums the NET (shared work-billed view), never the gross amount, and reads Open AR from the invoices', async () => {
    h.state.projects = [{ id: 'proj-1', name: 'Alpha' }];
    // The view already nets tax out: a gross 111 PPN invoice arrives as net 100.
    h.state.workPages = [work(2, 'proj-1', 100)];
    h.state.invoicePages = [invoices(2, 'proj-1', 111, 40)];

    const rows = await getRevenueByProject();

    expect(rows).toEqual([
      { project_id: 'proj-1', project_name: 'Alpha', currency: 'USD', total_amount: 200, open_ar: 80, invoice_count: 2 },
    ]);
    expect(h.state.scanned).toEqual(['sales_invoice_work_billed', 'sales_invoices']);
    // Down-payment invoices are advances, not work — filtered server-side, as the management pack does.
    expect(h.state.eqCalls).toContainEqual(['is_down_payment', false]);
  });

  it('AC-831-1: a claim invoice counts at net plus the down-payment recovery its negative line removed', async () => {
    h.state.projects = [{ id: 'proj-1', name: 'Alpha' }];
    h.state.workPages = [work(1, 'proj-1', 80, 'USD', 20)];

    const rows = await getRevenueByProject();

    expect(rows[0].total_amount).toBe(100);
  });

  it('AC-831-2: a project billed in two currencies yields one row per currency, never a blended total', async () => {
    h.state.projects = [{ id: 'proj-1', name: 'Alpha' }];
    h.state.workPages = [[...work(1, 'proj-1', 100, 'USD'), ...work(1, 'proj-1', 5_000_000, 'IDR')]];

    const rows = await getRevenueByProject();

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ project_id: 'proj-1', currency: 'USD', total_amount: 100 }),
        expect.objectContaining({ project_id: 'proj-1', currency: 'IDR', total_amount: 5_000_000 }),
      ]),
    );
  });

  it('aggregates EVERY invoice past the 1000-row PostgREST cap (no silent understatement)', async () => {
    h.state.projects = [{ id: 'proj-1', name: 'Alpha' }];
    h.state.workPages = [work(1000, 'proj-1', 10), work(500, 'proj-1', 10)];
    h.state.invoicePages = [invoices(1000, 'proj-1', 10, 4), invoices(500, 'proj-1', 10, 4)];

    const rows = await getRevenueByProject();

    expect(rows).toEqual([
      { project_id: 'proj-1', project_name: 'Alpha', currency: 'USD', total_amount: 15_000, open_ar: 6_000, invoice_count: 1500 },
    ]);
    // Both scans kept paging until a SHORT page proved the end — bounded, cursor-advanced pages.
    expect(h.state.limits).toEqual([1000, 1000, 1000, 1000]);
  });

  it('scans ONLY submitted-invoice statuses — a Draft never inflates project revenue (SHOULD-FIX 4, owner ruling)', async () => {
    h.state.projects = [{ id: 'proj-1', name: 'Alpha' }];
    h.state.workPages = [work(3, 'proj-1', 10)];
    h.state.invoicePages = [invoices(3, 'proj-1', 10, 4)];

    await getRevenueByProject();

    const statusFilters = h.state.inFilters.filter((f) => f.column === 'status');
    expect(statusFilters).toHaveLength(2);
    for (const f of statusFilters) {
      expect(f.values).toEqual(['Submitted', 'Unpaid', 'Paid']);
    }
  });

  it('pages on a STABLE order (id asc) — without one, a concurrent write can double-count or skip an invoice (S1)', async () => {
    h.state.projects = [{ id: 'proj-1', name: 'Alpha' }];
    h.state.workPages = [work(1000, 'proj-1', 10), work(1, 'proj-1', 10)];

    await getRevenueByProject();

    expect(h.state.orders).toContainEqual({ column: 'id', ascending: true });
  });

  it('stops after a single request per scan when the first page is short (no needless round-trips)', async () => {
    h.state.projects = [{ id: 'proj-1', name: 'Alpha' }];
    h.state.workPages = [work(3, 'proj-1', 100)];
    h.state.invoicePages = [invoices(3, 'proj-1', 100, 25)];

    const rows = await getRevenueByProject();

    expect(rows).toEqual([
      { project_id: 'proj-1', project_name: 'Alpha', currency: 'USD', total_amount: 300, open_ar: 75, invoice_count: 3 },
    ]);
    expect(h.state.invoiceQueries).toBe(2);
  });

  it('keeps the Unassigned bucket and the per-project names across pages', async () => {
    h.state.projects = [{ id: 'proj-1', name: 'Alpha' }];
    h.state.workPages = [
      [...work(999, 'proj-1', 10), ...work(1, null, 50)],
      work(1, null, 50),
    ];

    const rows = await getRevenueByProject();

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ project_id: 'proj-1', project_name: 'Alpha', total_amount: 9_990, invoice_count: 999 }),
        expect.objectContaining({ project_id: null, project_name: null, total_amount: 100, invoice_count: 2 }),
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it('NIT 2: a concurrent insert between page reads never double-counts (keyset cursor, not offset)', async () => {
    h.state.projects = [{ id: 'proj-1', name: 'Alpha' }];
    h.state.table = work(1000, 'proj-1', 10);
    h.state.mutateAfterQuery = () => {
      h.state.table!.push({ id: 'si-000000-a', project_id: 'proj-1', currency: 'USD', net: 10, recovery: 0 });
    };

    const rows = await getRevenueByProject();

    expect(rows[0].invoice_count).toBe(1000);
    expect(rows[0].total_amount).toBe(10_000);
  });

  it('returns an empty rollup (and asks for no project names) when the org has no invoices', async () => {
    const rows = await getRevenueByProject();
    expect(rows).toEqual([]);
    expect(h.from).not.toHaveBeenCalledWith('projects');
  });
});

describe('db/revenue singular reads — getSalesInvoice / getIncomingPayment (AC-FIN-001)', () => {
  it('AC-FIN-001: getSalesInvoice uses the same customer/author projection and flattens customer_name', async () => {
    h.state.singles.sales_invoices = {
      id: 'si-1',
      si_number: 'ACC-SINV-1',
      companies: { erp_payment_terms_days: 30, name: 'Acme Co' },
      sales_invoice_authors: [{ user_id: 'u-1' }],
    };

    const row = await getSalesInvoice('si-1');

    expect(h.state.columnCalls).toContainEqual({
      table: 'sales_invoices',
      columns: '*, companies!sales_invoices_customer_id_fkey(erp_payment_terms_days,name), sales_invoice_authors(user_id)',
    });
    expect(h.state.eqCalls).toContainEqual(['id', 'si-1']);
    expect(row?.customer_name).toBe('Acme Co');
    expect(row?.author_user_ids).toEqual(['u-1']);
  });

  it('AC-FIN-001: getIncomingPayment uses the customer-qualified projection and flattens customer_name', async () => {
    h.state.singles.incoming_payments = {
      id: 'ip-1',
      ip_number: 'ACC-PAY-1',
      customer: { name: 'Acme Co' },
    };

    const row = await getIncomingPayment('ip-1');

    expect(h.state.columnCalls).toContainEqual({
      table: 'incoming_payments',
      columns: '*, customer:companies!incoming_payments_customer_id_fkey(name)',
    });
    expect(h.state.eqCalls).toContainEqual(['id', 'ip-1']);
    expect(row?.customer_name).toBe('Acme Co');
  });

  it('AC-FIN-001: a missing relation on a singular read yields customer_name null (never the id)', async () => {
    h.state.singles.incoming_payments = { id: 'ip-2', ip_number: 'ACC-PAY-2', customer: null };
    expect((await getIncomingPayment('ip-2'))?.customer_name).toBeNull();
  });
});
