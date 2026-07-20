/**
 * db/revenue.ts — the money LIST reads (`listSalesInvoices` / `listIncomingPayments`).
 *
 * Read-model audit S6: both reads only applied a `.range()` when the caller opted into
 * `page`/`pageSize`, and the pages call them with NOTHING — so PostgREST silently capped the
 * response at `max_rows` (1000, `supabase/config.toml`). Past 1000 invoices the list AND its
 * client-side search see only the newest 1000: searching an invoice that EXISTS answers
 * "No invoices match your filters". These tests drive the exhaustive paged scan that closes it,
 * while keeping the explicit-page opt-in behaviour byte-for-byte.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface Call {
  table: string;
  orders: Array<{ column: string; ascending?: boolean }>;
  range: [number, number] | null;
  eq: Array<[string, unknown]>;
}

const h = vi.hoisted(() => {
  const state = {
    /** Successive responses per table, one per request the DAL issues. */
    pages: {} as Record<string, Array<Array<Record<string, unknown>>>>,
    calls: [] as Call[],
  };

  function builder(table: string) {
    const call: Call = { table, orders: [], range: null, eq: [] };
    const b = {
      select() { return b; },
      eq(column: string, value: unknown) { call.eq.push([column, value]); return b; },
      order(column: string, opts?: { ascending?: boolean }) {
        call.orders.push({ column, ascending: opts?.ascending });
        return b;
      },
      range(from: number, to: number) { call.range = [from, to]; return b; },
      then(resolve: (v: { data: unknown; error: unknown }) => unknown) {
        state.calls.push(call);
        const queue = state.pages[table] ?? [];
        return resolve({ data: queue.shift() ?? [], error: null });
      },
    };
    return b;
  }

  return { from: vi.fn((table: string) => builder(table)), state };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listSalesInvoices, listIncomingPayments } from './revenue';

/** `n` invoice rows, numbered so the caller can identify the LAST one returned. */
function invoiceRows(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: `si-${offset + i}`,
    si_number: `ACC-SINV-${offset + i}`,
    companies: { erp_payment_terms_days: 30 },
  }));
}

function paymentRows(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({ id: `ip-${offset + i}`, ip_number: `ACC-PAY-${offset + i}` }));
}

beforeEach(() => {
  h.state.pages = {};
  h.state.calls = [];
  h.from.mockClear();
});

describe('db/revenue listSalesInvoices — the list must not silently stop at PostgREST max_rows', () => {
  it('returns EVERY invoice past the 1000-row cap, so search can still find an older invoice', async () => {
    h.state.pages.sales_invoices = [invoiceRows(1000), invoiceRows(500, 1000)];

    const rows = await listSalesInvoices();

    expect(rows).toHaveLength(1500);
    // The oldest invoice — the one an unpaged read would silently drop — is present.
    expect(rows.some((r) => r.si_number === 'ACC-SINV-1499')).toBe(true);
    expect(h.state.calls.map((c) => c.range)).toEqual([[0, 999], [1000, 1999]]);
  });

  it('pages on a STABLE order (an id tiebreaker) so a concurrent write cannot duplicate or skip a row', async () => {
    h.state.pages.sales_invoices = [invoiceRows(1000), invoiceRows(1, 1000)];

    await listSalesInvoices();

    for (const call of h.state.calls) {
      expect(call.orders[call.orders.length - 1]).toEqual({ column: 'id', ascending: true });
    }
  });

  it('stops after one request when the first page is short (no needless round-trips)', async () => {
    h.state.pages.sales_invoices = [invoiceRows(3)];

    const rows = await listSalesInvoices();

    expect(rows).toHaveLength(3);
    expect(h.state.calls).toHaveLength(1);
  });

  it('honours an explicit page/pageSize as ONE bounded request (the opt-in contract is unchanged)', async () => {
    h.state.pages.sales_invoices = [invoiceRows(50)];

    const rows = await listSalesInvoices({ page: 1, pageSize: 50 });

    expect(rows).toHaveLength(50);
    expect(h.state.calls).toHaveLength(1);
    expect(h.state.calls[0].range).toEqual([50, 99]);
  });

  it('still filters to one project and flattens the customer payment terms', async () => {
    h.state.pages.sales_invoices = [invoiceRows(1)];

    const rows = await listSalesInvoices({ projectId: 'proj-1' });

    expect(h.state.calls[0].eq).toContainEqual(['project_id', 'proj-1']);
    expect(rows[0].erp_payment_terms_days).toBe(30);
  });
});

describe('db/revenue listIncomingPayments — same cap, same fix', () => {
  it('returns EVERY payment past the 1000-row cap', async () => {
    h.state.pages.incoming_payments = [paymentRows(1000), paymentRows(20, 1000)];

    const rows = await listIncomingPayments();

    expect(rows).toHaveLength(1020);
    expect(rows.some((r) => r.ip_number === 'ACC-PAY-1019')).toBe(true);
    expect(h.state.calls.map((c) => c.range)).toEqual([[0, 999], [1000, 1999]]);
  });

  it('pages on a STABLE order (an id tiebreaker)', async () => {
    h.state.pages.incoming_payments = [paymentRows(1000), []];

    await listIncomingPayments();

    for (const call of h.state.calls) {
      expect(call.orders[call.orders.length - 1]).toEqual({ column: 'id', ascending: true });
    }
  });

  it('honours an explicit page/pageSize as ONE bounded request', async () => {
    h.state.pages.incoming_payments = [paymentRows(10)];

    await listIncomingPayments({ page: 0, pageSize: 10 });

    expect(h.state.calls).toHaveLength(1);
    expect(h.state.calls[0].range).toEqual([0, 9]);
  });
});
